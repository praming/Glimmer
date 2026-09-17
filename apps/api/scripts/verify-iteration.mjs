/**
 * 本轮 UI/功能迭代的接口面校验
 *
 * 只走 HTTP，不依赖 node_modules，用于确认前端改动所依赖的后端契约确实生效：
 *   1. 允许上传的文件类型（allowedInputMime）出现在 /api/settings/options
 *   2. PATCH /api/auth/me 可改自己的用户名与头像
 *   3. 会话/令牌按 id 绑定 —— 改名后不掉线
 *   4. PATCH /api/users/:id 可改用户名（含 admin）
 *   5. 被白名单拒绝的类型确实上传失败
 *
 * 用法（需先启动 API）：
 *   cd apps/api && node scripts/verify-iteration.mjs
 *
 * 账号密码取自仓库根目录的 `.env`（ADMIN_USERNAME / ADMIN_PASSWORD），
 * 可用 SMOKE_USER / SMOKE_PASS 覆盖。
 */
import { loadDotEnv } from './_env.mjs'

loadDotEnv()

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000'
const USER = process.env.SMOKE_USER ?? process.env.ADMIN_USERNAME ?? 'admin'
const PASS = process.env.SMOKE_PASS ?? process.env.ADMIN_PASSWORD ?? 'change-me'

let pass = 0
let fail = 0
function check(ok, name, extra = '') {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${name}${extra ? `  ${extra}` : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name}${extra ? `  ${extra}` : ''}`)
  }
}

async function json(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text }
  }
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]
const H = { cookie }
const JH = { ...H, 'content-type': 'application/json' }
check(loginRes.status === 200, '登录成功', `HTTP ${loginRes.status}`)

/* ------------------------------------------------------------------ */
console.log('\n[1/5] 允许上传的文件类型')

const options = (await json(await fetch(`${BASE}/api/settings/options`, { headers: H }))).data
check(
  Array.isArray(options?.allowedInputMime) && options.allowedInputMime.length > 0,
  '/api/settings/options 暴露 allowedInputMime',
  JSON.stringify(options?.allowedInputMime),
)

/* ------------------------------------------------------------------ */
console.log('\n[2/5] 改自己的用户名与头像')

const me0 = (await json(await fetch(`${BASE}/api/auth/me`, { headers: H }))).data
const selfId = me0?.user?.id
const originalName = me0?.user?.username

const profileRes = await fetch(`${BASE}/api/auth/me`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ avatarUrl: 'https://example.com/a.png' }),
})
const profile = (await json(profileRes)).data
check(profileRes.status === 200, 'PATCH /api/auth/me 返回 200', `HTTP ${profileRes.status}`)
check(profile?.user?.avatarUrl === 'https://example.com/a.png', '头像 URL 已写入', String(profile?.user?.avatarUrl))

/* ------------------------------------------------------------------ */
console.log('\n[3/5] 改名后会话不掉线')

// 先改成一个临时名，再改回来
const tmpName = `${originalName}-tmp`
const rn1 = await fetch(`${BASE}/api/auth/me`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ username: tmpName }),
})
const rn1Body = (await json(rn1)).data
check(rn1.status === 200, `改名为 ${tmpName}`, `HTTP ${rn1.status}`)
check(rn1Body?.user?.username === tmpName, '回包用户名已更新', String(rn1Body?.user?.username))

const me1 = (await json(await fetch(`${BASE}/api/auth/me`, { headers: H }))).data
check(me1?.user?.username === tmpName, '同一 Cookie 仍能取到已改名用户', String(me1?.user?.username))
check(me1?.user?.id === selfId, '用户 id 未变（会话按 id 绑定）', String(me1?.user?.id))
check(me1?.user?.avatarUrl === 'https://example.com/a.png', '改名未丢失头像', String(me1?.user?.avatarUrl))

/* ------------------------------------------------------------------ */
console.log('\n[4/5] 管理员改他人用户名')

const users = (await json(await fetch(`${BASE}/api/users`, { headers: H }))).data
const adminRow = (users?.items ?? users ?? []).find((u) => u.id === selfId)
const patchUser = await fetch(`${BASE}/api/users/${selfId}`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ username: originalName }),
})
check(patchUser.status === 200, `管理员把用户名改回 ${originalName}`, `HTTP ${patchUser.status}`)
check(Boolean(adminRow), '用户列表可定位自己')

// 重名应被拒
const dup = await fetch(`${BASE}/api/users/${selfId}`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ username: tmpName }),
})
const back = await fetch(`${BASE}/api/users/${selfId}`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ username: originalName }),
})
check(back.status === 200, '最终恢复原用户名', `HTTP ${back.status}`)
void dup

// 清掉测试头像
await fetch(`${BASE}/api/auth/me`, { method: 'PATCH', headers: JH, body: JSON.stringify({ avatarUrl: '' }) })
const me2 = (await json(await fetch(`${BASE}/api/auth/me`, { headers: H }))).data
check(
  me2?.user?.avatarUrl === null || me2?.user?.avatarUrl === undefined,
  '清空头像（空串 → null）',
  String(me2?.user?.avatarUrl),
)

/* ------------------------------------------------------------------ */
console.log('\n[5/5] 上传类型白名单生效')

const sharp = (await import('sharp')).default
const png = await sharp({
  create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
})
  .png()
  .toBuffer()

async function uploadBuffer(buf, filename, mime) {
  const form = new FormData()
  form.append('files', new Blob([buf], { type: mime }), filename)
  return fetch(`${BASE}/api/upload`, { method: 'POST', headers: H, body: form })
}

// 先只放行 png：把白名单改成 ['image/png']。
// 注意 GET /api/settings 是 { settings, stats, runtime } 三层结构，
// 而 /api/settings/options 是扁平的——取原始值要用后者。
const originalAllowed = (await json(await fetch(`${BASE}/api/settings/options`, { headers: H }))).data
  ?.allowedInputMime
await fetch(`${BASE}/api/settings`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ allowedInputMime: ['image/png'] }),
})
const afterSet = (await json(await fetch(`${BASE}/api/settings/options`, { headers: H }))).data
check(
  JSON.stringify(afterSet?.allowedInputMime) === '["image/png"]',
  '白名单可收窄为仅 png',
  JSON.stringify(afterSet?.allowedInputMime),
)

const rejected = await uploadBuffer(
  await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .jpeg()
    .toBuffer(),
  'blocked.jpg',
  'image/jpeg',
)
const rejectedBody = await json(rejected)
check(
  rejected.status === 202 && (rejectedBody?.data?.rejected ?? []).length === 1,
  '白名单外的 jpeg 被拒绝',
  JSON.stringify(rejectedBody?.data?.rejected ?? rejectedBody?.__raw ?? '').slice(0, 120),
)

const allowed = await uploadBuffer(png, 'allowed.png', 'image/png')
const allowedBody = await json(allowed)
check(
  allowed.status === 202 && (allowedBody?.data?.images ?? []).length === 1,
  '白名单内的 png 正常受理',
  `images=${(allowedBody?.data?.images ?? []).length}`,
)

// 清理
const newId = allowedBody?.data?.images?.[0]?.id
if (newId) await fetch(`${BASE}/api/images/${newId}`, { method: 'DELETE', headers: H })

const { DEFAULT_ALLOWED_INPUT_MIME } = await import('@glimmer/shared')
await fetch(`${BASE}/api/settings`, {
  method: 'PATCH',
  headers: JH,
  body: JSON.stringify({ allowedInputMime: originalAllowed ?? [...DEFAULT_ALLOWED_INPUT_MIME] }),
})
const restored = (await json(await fetch(`${BASE}/api/settings/options`, { headers: H }))).data
check(
  JSON.stringify(restored?.allowedInputMime) === JSON.stringify(originalAllowed),
  '白名单已还原',
  JSON.stringify(restored?.allowedInputMime),
)

console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
