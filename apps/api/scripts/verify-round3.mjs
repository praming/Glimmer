/**
 * 第三轮迭代接口验证
 *
 * 覆盖：
 *  A. 访问令牌「删除」与「撤销」的语义差异
 *  B. 会话有效期：个人设置 → 即时续期 → 重新登录后持久化 → 非法值拒绝
 *  C. 字体栈规范化（含空格的字体名自动补引号）
 *
 * 用法（需先 pnpm start:api）：
 *   cd apps/api && node scripts/verify-round3.mjs
 *
 * 账号密码取自仓库根目录的 `.env`，可用 VERIFY_USER / VERIFY_PASS 覆盖。
 */
import { normalizeFontStack, quoteFontName } from '../../../packages/shared/dist/index.js'
import { loadDotEnv } from './_env.mjs'

loadDotEnv()

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3000'
const USER = process.env.VERIFY_USER || process.env.ADMIN_USERNAME || 'admin'
const PASS = process.env.VERIFY_PASS || process.env.ADMIN_PASSWORD || 'change-me'

let pass = 0
let fail = 0

function check(ok, label, detail = '') {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${label}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${detail ? `   ${detail}` : ''}`)
  }
}

let cookie = ''

async function call(path, init = {}) {
  return fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers || {}), ...(cookie ? { cookie } : {}) },
  })
}

async function json(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

async function post(path, body) {
  return call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patch(path, body) {
  return call(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 从 Set-Cookie 里解析 Expires 距今天数 */
function cookieDays(setCookie) {
  const m = /expires=([^;]+)/i.exec(setCookie || '')
  if (!m) return null
  const ts = Date.parse(m[1])
  if (!Number.isFinite(ts)) return null
  return (ts - Date.now()) / 86_400_000
}

/* ================================================================== */

console.log('\n=== A. 访问令牌：撤销 vs 删除 ===')

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const loginBody = await json(login)
check(login.status === 200, '登录成功', String(login.status))

const originalDays = loginBody?.data?.user?.sessionDays ?? null

// 1) 撤销：失效但保留记录
const created1 = await json(
  await post('/api/me/tokens', { name: 'round3-revoke', expiresInDays: 0 }),
)
const id1 = created1?.data?.id
check(Boolean(id1), '创建令牌 #1')

const revokeRes = await call(`/api/me/tokens/${id1}`, { method: 'DELETE' })
check(revokeRes.status === 200, '撤销令牌 #1', String(revokeRes.status))

let list = await json(await call('/api/me/tokens'))
const afterRevoke = list?.data?.tokens?.find((t) => t.id === id1)
check(Boolean(afterRevoke), '撤销后记录仍在列表中（软撤销）')
check(Boolean(afterRevoke?.revokedAt), '记录带 revokedAt 标记')
check(afterRevoke?.active === false, '记录标记为不再有效')

// 2) 删除：记录彻底消失
const purgeRes = await call(`/api/me/tokens/${id1}?purge=1`, { method: 'DELETE' })
check(purgeRes.status === 200, '删除已撤销的令牌 #1', String(purgeRes.status))
const purgeBody = await json(purgeRes)
check(purgeBody?.data?.purged === true, '删除接口回包标记 purged')

list = await json(await call('/api/me/tokens'))
check(
  !list?.data?.tokens?.some((t) => t.id === id1),
  '删除后记录从列表彻底消失',
)

// 3) 有效令牌也能直接删除，且删除后无法再认证
const created2 = await json(
  await post('/api/me/tokens', { name: 'round3-direct-purge', expiresInDays: 0 }),
)
const id2 = created2?.data?.id
const plain2 = created2?.data?.token
check(Boolean(id2 && plain2), '创建令牌 #2')

const beforeUse = await json(
  await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${plain2}` } }),
)
check(beforeUse?.data?.user?.username === USER, '删除前该令牌可正常认证')

const purge2 = await call(`/api/me/tokens/${id2}?purge=1`, { method: 'DELETE' })
check(purge2.status === 200, '有效令牌可直接删除', String(purge2.status))

const afterUse = await json(
  await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${plain2}` } }),
)
check(afterUse?.data?.user === null, '删除后该令牌立即失效')

// 4) 删除不存在的令牌 → 404
const purgeMissing = await call('/api/me/tokens/does-not-exist?purge=1', { method: 'DELETE' })
check(purgeMissing.status === 404, '删除不存在的令牌返回 404', String(purgeMissing.status))

/* ================================================================== */

console.log('\n=== B. 会话有效期 ===')

const set30 = await patch('/api/auth/me', { sessionDays: 30 })
check(set30.status === 200, 'PATCH sessionDays=30', String(set30.status))
const set30Body = await json(set30)
check(set30Body?.data?.user?.sessionDays === 30, '回包中的 sessionDays 为 30')
check(
  Number.isFinite(Date.parse(set30Body?.data?.sessionExpiresAt ?? '')),
  '回包带 sessionExpiresAt',
  String(set30Body?.data?.sessionExpiresAt),
)

const renewedDays = (Date.parse(set30Body.data.sessionExpiresAt) - Date.now()) / 86_400_000
check(
  renewedDays > 29 && renewedDays < 31,
  '当前会话已按新时长续期（≈30 天）',
  `${renewedDays.toFixed(2)} 天`,
)

const scDays = cookieDays(set30.headers.get('set-cookie'))
check(
  scDays !== null && scDays > 29 && scDays < 31,
  '响应头的 Cookie 也按 30 天重发',
  scDays === null ? '未找到 Expires' : `${scDays.toFixed(2)} 天`,
)

// 重新登录 → 新会话按 30 天签发，且设置被持久化
const login30 = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
const login30Body = await json(login30)
check(login30Body?.data?.user?.sessionDays === 30, '重新登录后 sessionDays 仍为 30（已持久化）')

const login30Days = (Date.parse(login30Body.data.expiresAt) - Date.now()) / 86_400_000
check(
  login30Days > 29 && login30Days < 31,
  '新签发的会话按 30 天计算',
  `${login30Days.toFixed(2)} 天`,
)

cookie = (login30.headers.get('set-cookie') || '').split(';')[0]

// 非法值
const bad = await patch('/api/auth/me', { sessionDays: 42 })
check(bad.status === 400, '非法天数 42 被拒绝', String(bad.status))
const bad2 = await patch('/api/auth/me', { sessionDays: 0 })
check(bad2.status === 400, '非法天数 0 被拒绝', String(bad2.status))

// 5 档全部可用
for (const d of [7, 15, 30, 60, 90]) {
  const r = await patch('/api/auth/me', { sessionDays: d })
  const b = await json(r)
  check(b?.data?.user?.sessionDays === d, `sessionDays=${d} 可正常设置`, String(r.status))
}

// 恢复原值
const restore = await patch('/api/auth/me', {
  sessionDays: originalDays && originalDays > 0 ? originalDays : 7,
})
check(restore.status === 200, `已恢复原值 ${originalDays ?? '(默认 7)'}`)

/* ================================================================== */

console.log('\n=== C. 字体栈规范化 ===')

const fontCases = [
  ['PingFang SC', '"PingFang SC"', '含空格 → 补引号'],
  ['Microsoft YaHei, SimSun', '"Microsoft YaHei", SimSun', '多字体逐个处理'],
  ['"PingFang SC", Arial', '"PingFang SC", Arial', '已带引号 → 保持'],
  ["'PingFang SC'", '"PingFang SC"', '单引号 → 统一为双引号'],
  ['system-ui', 'system-ui', '泛型关键字 → 裸写'],
  ['-apple-system', '-apple-system', '平台关键字 → 裸写'],
  ['微软雅黑', '"微软雅黑"', '中文名 → 补引号'],
  ['Inter', 'Inter', '无空格标识符 → 裸写'],
  ['', '', '空值 → 空串'],
  ['  ,  ', '', '只有分隔符 → 空串'],
  ['Noto Sans SC, Source Han Sans SC', '"Noto Sans SC", "Source Han Sans SC"', '多个含空格字体'],
]

for (const [input, expect, label] of fontCases) {
  const got = normalizeFontStack(input)
  check(got === expect, `${label}: ${JSON.stringify(input)}`, `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(expect)}`)
}

check(quoteFontName('Arial') === 'Arial', 'quoteFontName: Arial 保持裸写')
check(
  quoteFontName('Helvetica Neue') === '"Helvetica Neue"',
  'quoteFontName: Helvetica Neue 补引号',
)

// 偏好接口能存下带逗号的字体栈
const fontSave = await patch('/api/me/preferences', { fontSansZh: 'Microsoft YaHei, SimSun' })
const fontSaved = await json(fontSave)
check(fontSaved?.data?.fontSansZh === 'Microsoft YaHei, SimSun', '字体偏好可保存多字体栈')

const fontReset = await patch('/api/me/preferences', { fontSansZh: '', fontSansEn: '' })
const fontResetBody = await json(fontReset)
check(fontResetBody?.data?.fontSansZh === '', '字体偏好可清空')

/* ================================================================== */

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
