#!/usr/bin/env node
/**
 * 端到端冒烟测试
 *
 * 覆盖：健康检查 → 登录 → 会话 → 上传 → 异步处理 → 直链可访问
 *      → P3-1 秒传去重 → P3-2 API Token → P3-3 访问统计 → P3-4 失败自动重试
 *
 * 前置：已启动 API（`pnpm start:api` 或 `pnpm dev:api`），
 *       且已执行过 `pnpm db:migrate` 建库并创建管理员。
 *
 * 用法：
 *   node scripts/smoke.mjs
 *
 * 可覆盖的环境变量：
 *   SMOKE_BASE   默认 http://127.0.0.1:3000
 *   SMOKE_USER   默认取 .env 的 ADMIN_USERNAME
 *   SMOKE_PASS   默认取 .env 的 ADMIN_PASSWORD
 *   SMOKE_DB     默认 apps/api/data/glimmer.db（P3-4 需要直接改一行记录来制造失败）
 *   SMOKE_SKIP_DB=1  跳过 P3-4（只测 HTTP 层时使用）
 *
 * 说明：
 * - 账号密码从仓库根目录的 `.env` 读取，**不在源码里留任何口令**。
 * - 脚本可重复执行：同内容再上传会命中秒传，断言依然成立。
 * - P3-4 会强制把一条已成功的存储记录改成失败并把重试时间设为过去，
 *   然后等待自动重试调度器把它救回来；期间**只改这一行**，不影响其他数据。
 *
 * 退出码：0 = 全部通过，1 = 有失败项。
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import { API_DIR, loadDotEnv } from './_env.mjs'

// 必须在读取下面的环境变量之前执行
loadDotEnv()

const BASE = (process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
const USER = process.env.SMOKE_USER ?? process.env.ADMIN_USERNAME ?? 'admin'
const PASS = process.env.SMOKE_PASS ?? process.env.ADMIN_PASSWORD ?? 'change-me'
const DB_PATH = process.env.SMOKE_DB ?? path.join(API_DIR, 'data/glimmer.db')

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' }
let failed = 0

const step = (title) => console.log(`\n${C.b}${title}${C.x}`)
const ok = (name, extra) => console.log(`  ${C.g}✓${C.x} ${name}${extra ? `  ${C.d}${extra}${C.x}` : ''}`)
const bad = (name, extra) => {
  failed += 1
  console.log(`  ${C.r}✗${C.x} ${name}${extra ? `  ${C.d}${extra}${C.x}` : ''}`)
}
const check = (cond, name, extra) => (cond ? ok(name, extra) : bad(name, extra))
const note = (text) => console.log(`  ${C.d}· ${text}${C.x}`)

/** 把直链域名换成 BASE 的域名，规避 localhost→::1 而服务只监听 0.0.0.0 的假阴性 */
const localize = (url) => url.replace(/^https?:\/\/[^/]+/, BASE)

async function json(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text.slice(0, 300) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询直到 predicate 成立或超时 */
async function until(predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(intervalMs)
  }
}

const TOTAL = 10
let stepIndex = 0
const nextStep = (title) => {
  stepIndex += 1
  step(`[${stepIndex}/${TOTAL}] ${title}`)
}

/* ------------------------------------------------------------------ */
nextStep(`健康检查  ${BASE}`)

let health
try {
  health = await fetch(`${BASE}/api/health`)
} catch (error) {
  bad('无法连接 API', `${error.message}（请先启动服务）`)
  process.exit(1)
}
check(health.ok, 'GET /api/health', `HTTP ${health.status}`)

/* ------------------------------------------------------------------ */
nextStep('登录')

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
check(loginRes.ok, 'POST /api/auth/login', `HTTP ${loginRes.status}`)
if (!loginRes.ok) {
  console.log(`    ${C.d}${JSON.stringify(await json(loginRes))}${C.x}`)
  process.exit(1)
}

const cookie = (loginRes.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(';')[0])
  .join('; ')
check(cookie.includes('glimmer_session'), '下发会话 Cookie', cookie.split(';')[0])

const login = (await json(loginRes)).data
check(login?.user?.username === USER, '返回登录用户', `role=${login?.user?.role}`)
const H = { cookie }
const JSON_H = { ...H, 'content-type': 'application/json' }

/* ------------------------------------------------------------------ */
nextStep('会话校验')

const meRes = await fetch(`${BASE}/api/auth/me`, { headers: H })
const me = (await json(meRes)).data
check(me?.user?.username === USER, 'GET /api/auth/me', me?.user?.username)

/* ------------------------------------------------------------------ */
nextStep('上传')

/**
 * 每次运行刻意生成一张**内容唯一**的测试图。
 *
 * 若固定内容，第二次运行就会命中上一轮留下的秒传记录，
 * 于是「重试计数为 0」「没有待重试排期」这类断言读到的其实是上一轮人为制造的
 * 失败历史（attempt_count 按设计不会在恢复后清零），产生假失败。
 */
const RUN_TINT = 96 + (Date.now() % 160)
const png = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: { r: 62, g: 120, b: RUN_TINT } },
})
  .png()
  .toBuffer()
check(png.byteLength > 0, '用 sharp 生成测试图（验证原生模块可用）', `${png.byteLength} B`)

/** 与本脚本步骤 4/7 一致的“上传选项”，秒传指纹依赖它们完全一致 */
const OPTIONS = { formats: 'webp,jpeg', keepOriginal: 'true' }

function buildUploadForm(options, filename = 'smoke-test.png') {
  const form = new FormData()
  form.append('files', new Blob([png], { type: 'image/png' }), filename)
  form.append('formats', options.formats)
  form.append('keepOriginal', options.keepOriginal)
  return form
}

const upRes = await fetch(`${BASE}/api/upload`, {
  method: 'POST',
  headers: H,
  body: buildUploadForm(OPTIONS),
})
const up = (await json(upRes)).data
check(upRes.status === 202, 'POST /api/upload 返回 202', `HTTP ${upRes.status}`)
check(up?.images?.length === 1, '受理 1 张图片', `rejected=${up?.rejected?.length ?? '?'}`)
if (up?.rejected?.length) console.log(`    ${C.d}拒绝详情 ${JSON.stringify(up.rejected)}${C.x}`)

if (up?.images?.[0]?.deduplicated) {
  note('本次命中秒传（内容与配置此前已上传过），直接复用既有记录')
}

const id = up?.images?.[0]?.id
check(Boolean(id), '拿到 imageId', id)
if (!id) process.exit(1)

/* ------------------------------------------------------------------ */
nextStep('等待异步处理（p-queue）')

let detail = null
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  const res = await fetch(`${BASE}/api/images/${id}`, { headers: H })
  if (!res.ok) {
    bad(`GET /api/images/${id}`, `HTTP ${res.status}`)
    break
  }
  detail = (await json(res)).data
  if (detail.status !== 'pending') break
}

check(detail?.status === 'ready', '图片处理完成', `status=${detail?.status}`)
check(
  (detail?.variants?.length ?? 0) === 3,
  '生成 3 个变体（webp + jpeg + 原图）',
  `实际 ${detail?.variants?.length ?? 0}`,
)

for (const v of detail?.variants ?? []) {
  const allReady = (v.storages ?? []).every((s) => s.status === 'ready')
  check(
    v.status === 'ready' && allReady,
    `变体 ${v.format} 已就绪并同步`,
    `${v.width}x${v.height} ${v.size}B → ${v.primaryUrl}`,
  )
}

/* ------------------------------------------------------------------ */
nextStep('直链可访问')

const target = detail?.variants?.find((v) => v.format === 'webp') ?? detail?.variants?.[0]
check(Boolean(target?.primaryUrl), '拿到直链', target?.primaryUrl)

if (target?.primaryUrl) {
  const img = await fetch(localize(target.primaryUrl))
  check(img.ok, 'GET 直链返回 200', `HTTP ${img.status}`)
  check(
    (img.headers.get('content-type') ?? '').startsWith('image/'),
    'Content-Type 为图片',
    img.headers.get('content-type'),
  )
  check(
    (img.headers.get('cache-control') ?? '').includes('immutable'),
    '带 immutable 缓存头',
    img.headers.get('cache-control'),
  )
  const bytes = Buffer.from(await img.arrayBuffer()).byteLength
  if (typeof target.size === 'number') {
    check(bytes === target.size, '直链字节数与数据库记录一致', `${bytes} vs ${target.size}`)
  } else {
    ok('直链字节数', `${bytes} B（记录中无 size，跳过比对）`)
  }
}

/* ------------------------------------------------------------------ */
nextStep('P3-1 秒传去重')

const contentHash = createHash('sha256').update(png).digest('hex')
note(`原图 SHA-256 ${contentHash.slice(0, 16)}…`)

const checkRes = await fetch(`${BASE}/api/upload/check`, {
  method: 'POST',
  headers: JSON_H,
  body: JSON.stringify({
    hash: contentHash,
    size: png.byteLength,
    formats: ['webp', 'jpeg'],
    keepOriginal: true,
  }),
})
const checkData = (await json(checkRes)).data
check(checkData?.hit === true, 'POST /api/upload/check 命中秒传', `hit=${checkData?.hit}`)
check(checkData?.image?.id === id, '预检返回既有图片 id', checkData?.image?.id)

// 服务端兜底：客户端不做预检、直接重复上传也要能命中
const up2Res = await fetch(`${BASE}/api/upload`, {
  method: 'POST',
  headers: H,
  body: buildUploadForm(OPTIONS),
})
const up2 = (await json(up2Res)).data
check(up2?.images?.[0]?.deduplicated === true, '重复上传被服务端识别为秒传')
check(up2?.images?.[0]?.id === id, '秒传复用同一个 imageId', up2?.images?.[0]?.id)

// 关键反例：内容相同但配置不同（少要了 jpeg）绝不能让秒传错误命中
const up3Res = await fetch(`${BASE}/api/upload`, {
  method: 'POST',
  headers: H,
  body: buildUploadForm({ formats: 'webp', keepOriginal: 'false' }, 'smoke-test-narrow.png'),
})
const up3 = (await json(up3Res)).data
const narrowId = up3?.images?.[0]?.id
check(
  up3?.images?.[0]?.deduplicated !== true && Boolean(narrowId) && narrowId !== id,
  '配置不同时不命中秒传（去重键包含处理配置指纹）',
  narrowId,
)

// 清理这张只为反例而上传的图
if (narrowId) {
  await fetch(`${BASE}/api/images/${narrowId}`, { method: 'DELETE', headers: H })
  ok('已清理反例图片', narrowId)
}

// 关键反例：同内容跨用户绝不复用（私有图库下不能泄露他人图片直链）
const memberName = `smoke${Date.now().toString(36)}`
const memberPass = `Sm0ke-${Math.random().toString(36).slice(2, 12)}`

const createUserRes = await fetch(`${BASE}/api/users`, {
  method: 'POST',
  headers: JSON_H,
  body: JSON.stringify({ username: memberName, password: memberPass, role: 'member' }),
})
const createdUser = (await json(createUserRes)).data

if (!createUserRes.ok || !createdUser?.user?.id) {
  bad('创建临时成员账号（跨用户去重反例需要）', `HTTP ${createUserRes.status}`)
} else {
  const memberLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: memberName, password: memberPass }),
  })
  const memberCookie = (memberLogin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

  const memberUp = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { cookie: memberCookie },
    body: buildUploadForm(OPTIONS),
  })
  const memberData = (await json(memberUp)).data
  const memberImageId = memberData?.images?.[0]?.id
  check(
    memberData?.images?.[0]?.deduplicated !== true && Boolean(memberImageId) && memberImageId !== id,
    '同内容跨用户不复用（去重作用域为 per-user）',
    memberImageId,
  )

  const delUserRes = await fetch(`${BASE}/api/users/${createdUser.user.id}`, {
    method: 'DELETE',
    headers: H,
  })
  check(
    delUserRes.ok,
    '清理临时成员账号（连同其图片）',
    `HTTP ${delUserRes.status}`,
  )
}

/* ------------------------------------------------------------------ */
nextStep('P3-2 API Token')

const tokenRes = await fetch(`${BASE}/api/me/tokens`, {
  method: 'POST',
  headers: JSON_H,
  body: JSON.stringify({ name: 'smoke-test', expiresInDays: 1 }),
})
const created = (await json(tokenRes)).data
check(tokenRes.status === 201, 'POST /api/me/tokens 返回 201', `HTTP ${tokenRes.status}`)
check(
  typeof created?.token === 'string' && created.token.startsWith('glm_'),
  '返回一次性明文 token',
  created?.token ? `${created.token.slice(0, 12)}…` : undefined,
)
check(created?.prefix === created?.token?.slice(0, 12), '记录前缀可用于识别', created?.prefix)

const bearer = { authorization: `Bearer ${created?.token}` }

if (created?.token) {
  const viaToken = await fetch(`${BASE}/api/images?pageSize=1`, { headers: bearer })
  const viaTokenData = (await json(viaToken)).data
  check(viaToken.ok, 'Bearer token 可访问 /api/images', `HTTP ${viaToken.status}`)
  check(
    Array.isArray(viaTokenData?.items) && viaTokenData.items.length === 1,
    'token 认证返回图片列表',
    `items=${viaTokenData?.items?.length ?? '?'}`,
  )

  const meViaToken = (await json(await fetch(`${BASE}/api/auth/me`, { headers: bearer }))).data
  check(meViaToken?.user?.username === USER, 'Bearer token 可识别身份', meViaToken?.user?.username)

  const adminOnly = await fetch(`${BASE}/api/settings`, { headers: bearer })
  check(adminOnly.ok, 'Bearer token 可访问管理员接口', `HTTP ${adminOnly.status}`)

  const bogus = await fetch(`${BASE}/api/images`, {
    headers: { authorization: 'Bearer glm_not-a-real-token' },
  })
  check(bogus.status === 401, '伪造 token 被拒绝', `HTTP ${bogus.status}`)

  const noAuth = await fetch(`${BASE}/api/images`)
  check(noAuth.status === 401, '无凭据被拒绝', `HTTP ${noAuth.status}`)

  const listRes = await fetch(`${BASE}/api/me/tokens`, { headers: H })
  const listData = (await json(listRes)).data
  check(
    (listData?.tokens ?? []).some((t) => t.id === created.id && t.active === true),
    'GET /api/me/tokens 列出新令牌',
    `共 ${listData?.tokens?.length ?? 0} 个 / 上限 ${listData?.limit ?? '?'}`,
  )

  const revokeRes = await fetch(`${BASE}/api/me/tokens/${created.id}`, {
    method: 'DELETE',
    headers: H,
  })
  check(revokeRes.ok, 'DELETE 撤销令牌', `HTTP ${revokeRes.status}`)

  const afterRevoke = await fetch(`${BASE}/api/images`, { headers: bearer })
  check(afterRevoke.status === 401, '撤销后 token 立即失效', `HTTP ${afterRevoke.status}`)
}

/* ------------------------------------------------------------------ */
nextStep('P3-3 访问统计')

const statsBefore = (await json(await fetch(`${BASE}/api/stats?days=7`, { headers: H }))).data
check(statsBefore?.scope === 'global', 'GET /api/stats 返回全局口径（admin）', statsBefore?.scope)
check(typeof statsBefore?.totals?.views === 'number', '返回访问总量', `views=${statsBefore?.totals?.views}`)

if (target?.primaryUrl) {
  // 额外访问 3 次，验证计数确实增长
  for (let i = 0; i < 3; i += 1) await fetch(localize(target.primaryUrl))

  const grown = await until(async () => {
    const res = await fetch(`${BASE}/api/stats?days=7`, { headers: H })
    const data = (await json(res)).data
    return (data?.totals?.views ?? 0) >= (statsBefore?.totals?.views ?? 0) + 3 ? data : null
  }, 20_000)

  if (grown) {
    ok(
      '直链访问被计数（内存聚合 + 定时落盘）',
      `${statsBefore?.totals?.views} → ${grown.totals.views}`,
    )
    check(grown.totals.bytesServed > (statsBefore?.totals?.bytesServed ?? 0), '出口流量被记账', `${grown.totals.bytesServed} B`)
    check(
      grown.topImages.some((item) => item.id === id),
      'Top 图片榜包含本次测试图',
      `榜单 ${grown.topImages.length} 项`,
    )
    check(grown.daily.length === 7, '趋势数据补齐到请求的天数', `${grown.daily.length} 天`)
    check(
      typeof grown.retry?.failedRecords === 'number',
      '返回自动重试概况',
      `失败记录 ${grown.retry?.failedRecords} / 已排期 ${grown.retry?.scheduled}`,
    )
    check(
      grown.status.ready >= 1 && grown.totals.images >= 1,
      '返回总量与状态分布',
      `images=${grown.totals.images} ready=${grown.status.ready}`,
    )
  } else {
    bad('直链访问被计数', '等待 20s 仍未看到计数增长')
  }
}

/* ------------------------------------------------------------------ */
nextStep('P3-4 失败任务自动重试')

if (process.env.SMOKE_SKIP_DB === '1') {
  note('SMOKE_SKIP_DB=1，跳过')
} else {
  const localRecords = (detail?.variants ?? []).flatMap((v) =>
    (v.storages ?? []).map((s) => ({ ...s, format: v.format })),
  )

  // 刻意挑一个**派生**输出变体（webp / jpeg）来制造失败：
  // 原图归档若只剩单副本，丢的就是唯一一份原始字节，本就无法重建（属预期行为）；
  // 而派生变体可以从原图归档重新渲染回来，这才是真实世界最常见的失败形态。
  const localRecord =
    localRecords.find((s) => s.backend === 'local' && s.format !== 'original') ??
    localRecords.find((s) => s.backend === 'local')

  if (!localRecord) {
    bad('找到本地后端的存储记录')
  } else {
    check(localRecord.attemptCount === 0, '成功记录的重试计数为 0', `attemptCount=${localRecord.attemptCount}`)
    check(localRecord.nextRetryAt === null, '成功记录没有待重试排期', String(localRecord.nextRetryAt))

    // 回归守卫：先记下原图归档的字节指纹，重试走完必须一字不差。
    // 历史 bug —— 重试时用 webp 派生物覆盖了原图归档，磁盘魔数变成 RIFF....WEBP。
    const originalVariant = (detail?.variants ?? []).find((v) => v.format === 'original')
    let originalBefore = null
    if (originalVariant?.primaryUrl) {
      const res = await fetch(localize(originalVariant.primaryUrl))
      const buf = Buffer.from(await res.arrayBuffer())
      originalBefore = {
        url: originalVariant.primaryUrl,
        size: buf.byteLength,
        md5: createHash('md5').update(buf).digest('hex'),
      }
      check(
        buf.byteLength === originalVariant.size,
        '原图归档字节数与库记录一致',
        `${buf.byteLength} vs ${originalVariant.size}`,
      )
    }

    // 直接改一行记录制造“失败且已到期”，然后等调度器把它救回来
    const { default: Database } = await import('better-sqlite3')
    const past = new Date(Date.now() - 60_000).toISOString()
    const nowIso = new Date().toISOString()

    const db = new Database(DB_PATH)
    const updated = db
      .prepare(
        `UPDATE storage_records
            SET status = 'failed', error_message = ?, attempt_count = 1,
                last_attempt_at = ?, next_retry_at = ?
          WHERE id = ?`,
      )
      .run('smoke: 人为制造的失败', nowIso, past, localRecord.id)
    db.close()

    check(updated.changes === 1, '制造一条到期失败记录', `${localRecord.id} @ ${localRecord.format}`)

    const forced = await until(async () => {
      const data = (await json(await fetch(`${BASE}/api/images/${id}`, { headers: H }))).data
      const rec = (data?.variants ?? [])
        .flatMap((v) => v.storages ?? [])
        .find((s) => s.id === localRecord.id)
      return rec?.status === 'failed' ? rec : null
    }, 5_000)

    check(forced?.attemptCount === 1, '详情页暴露重试次数', `attemptCount=${forced?.attemptCount}`)
    check(Boolean(forced?.nextRetryAt), '详情页暴露下次重试时间', forced?.nextRetryAt)
    check(forced?.errorMessage?.includes('人为制造'), '失败原因透出到详情', forced?.errorMessage)

    note('等待自动重试调度器（默认 15s 扫描一次）…')

    const recovered = await until(async () => {
      const data = (await json(await fetch(`${BASE}/api/images/${id}`, { headers: H }))).data
      const rec = (data?.variants ?? [])
        .flatMap((v) => v.storages ?? [])
        .find((s) => s.id === localRecord.id)
      return rec?.status === 'ready' ? rec : null
    }, 60_000, 1_000)

    check(
      Boolean(recovered),
      '调度器自动重试成功（取回原图 → 重新处理 → 上传）',
      recovered ? `attemptCount=${recovered.attemptCount}` : '等待 60s 未恢复',
    )
    check(recovered?.nextRetryAt === null, '恢复后清空重试排期', String(recovered?.nextRetryAt))

    // 回归守卫（二）：重试不得改写原图归档
    if (originalBefore) {
      const res = await fetch(localize(originalBefore.url))
      const buf = Buffer.from(await res.arrayBuffer())
      const md5 = createHash('md5').update(buf).digest('hex')
      check(
        buf.byteLength === originalBefore.size && md5 === originalBefore.md5,
        '重试未改写原图归档（字节级一致）',
        `${buf.byteLength} B · md5 ${md5.slice(0, 8)}`,
      )
    }

    // 回归守卫（三）：库里的 size 必须与真正落到盘上的字节一致
    // （历史 bug：只重传了失败的变体，却把其它变体的元数据一起改成了新渲染尺寸）
    const afterDetail = (await json(await fetch(`${BASE}/api/images/${id}`, { headers: H }))).data
    for (const variant of afterDetail?.variants ?? []) {
      if (!variant.primaryUrl || typeof variant.size !== 'number') continue
      const res = await fetch(localize(variant.primaryUrl))
      const bytes = Buffer.from(await res.arrayBuffer()).byteLength
      check(
        bytes === variant.size,
        `变体 ${variant.format} 库记录与实际字节一致`,
        `${bytes} vs ${variant.size}`,
      )
    }

    const finalStats = (await json(await fetch(`${BASE}/api/stats?days=7`, { headers: H }))).data
    check(
      (finalStats?.retry?.failedRecords ?? 999) === 0,
      '统计接口显示已无失败记录',
      `failedRecords=${finalStats?.retry?.failedRecords}`,
    )
  }
}

/* ------------------------------------------------------------------ */
step('落库结果摘要')
console.log(`  imageId    ${id}`)
console.log(`  filename   ${detail?.filename}`)
console.log(`  status     ${detail?.status}`)
console.log(`  previewUrl ${detail?.previewUrl}`)
console.log(`  totalSize  ${detail?.totalSize} B`)
console.log(`  复制文本    ${JSON.stringify(target?.copy ?? null, null, 0)}`)

console.log(
  failed === 0
    ? `\n${C.g}${C.b}冒烟测试全部通过${C.x}\n`
    : `\n${C.r}${C.b}${failed} 项失败${C.x}\n`,
)
process.exit(failed === 0 ? 0 : 1)
