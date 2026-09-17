/**
 * 临时原图泄漏探针
 *
 * 目的：确认「上传 → 处理完成 → 是否清理 data/tmp/<id>.src」，以及
 *      「上传 → 立刻删除」这条竞态路径是否留下孤儿。
 *
 * 用法（需先启动 API）：
 *   cd apps/api && node scripts/probe-temp-leak.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { API_DIR, adminCredentials, loadDotEnv } from './_env.mjs'

loadDotEnv()

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000'
const TMP = path.join(API_DIR, 'data/tmp')
const UPLOADS = path.join(API_DIR, 'data/uploads')
const { username: USER, password: PASS } = adminCredentials()

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const H = { cookie }

const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])

/** base 参与图片尺寸，用于让每批内容互不相同——否则会命中秒传，探针就测不到真实路径 */
async function upload(tag, i, base = 300) {
  const buf = await sharp({
    create: {
      width: base + i,
      height: 200,
      channels: 3,
      background: { r: (30 * i) % 255, g: (base / 3) % 255, b: 160 },
    },
  })
    .png()
    .toBuffer()
  const form = new FormData()
  form.append('files', new Blob([buf], { type: 'image/png' }), `${tag}-${i}.png`)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: H, body: form })
  const body = await res.json()
  return body?.data?.images?.[0]?.id ?? null
}

async function waitReady(id, ms = 15_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const d = await (await fetch(`${BASE}/api/images/${id}`, { headers: H })).json()
    const img = d?.data?.image ?? d?.data
    if (img && img.status !== 'pending') return img.status
    await new Promise((r) => setTimeout(r, 200))
  }
  return 'timeout'
}

const before = new Set(list(TMP))
console.log('起始 tmp:', [...before])

/* --- A. 正常完成路径 ---------------------------------------------- */
const idsA = []
for (let i = 1; i <= 3; i += 1) {
  const id = await upload('probe-normal', i)
  if (id) idsA.push(id)
}
for (const id of idsA) console.log('  处理完成 status=', await waitReady(id))
await new Promise((r) => setTimeout(r, 1500))
const afterA = list(TMP).filter((f) => !before.has(f))
console.log('A) 正常完成后新增的 tmp:', afterA.length ? afterA : '（无，已正确清理）')

/* --- B. 上传后立刻删除（竞态） ------------------------------------- */
const uploadsBefore = new Set(list(UPLOADS).flatMap((d) =>
  fs.statSync(path.join(UPLOADS, d)).isDirectory() ? list(path.join(UPLOADS, d)).map((f) => `${d}/${f}`) : [d],
))

const idsB = []
for (let i = 1; i <= 3; i += 1) {
  const id = await upload('probe-race', i, 700)
  if (!id) continue
  idsB.push(id)
  const del = await fetch(`${BASE}/api/images/${id}`, { method: 'DELETE', headers: H })
  if (del.status !== 200) console.log('  删除失败', id, del.status)
}
await new Promise((r) => setTimeout(r, 3000))
const afterB = list(TMP).filter((f) => !before.has(f))
console.log('B) 竞态删除后新增的 tmp:', afterB.length ? afterB : '（无，已正确清理）')

/* --- C. 孤儿文件 --------------------------------------------------- */
const uploadsAfter = new Set(list(UPLOADS).flatMap((d) =>
  fs.statSync(path.join(UPLOADS, d)).isDirectory() ? list(path.join(UPLOADS, d)).map((f) => `${d}/${f}`) : [d],
))
const orphans = [...uploadsAfter].filter((f) => !uploadsBefore.has(f))
console.log('C) 新增上传文件（若 B 已删除则应为孤儿）:', orphans.length ? orphans : '（无）')

console.log('\n结论：', afterA.length === 0 && afterB.length === 0 && orphans.length === 0 ? '✅ 无泄漏' : '❌ 仍有泄漏')
