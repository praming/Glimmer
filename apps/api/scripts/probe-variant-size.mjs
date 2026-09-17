/**
 * 隔离验证：全新上传一张图片，比对「变体库记录」与「磁盘文件」是否一致。
 * 不触碰 P3-4 重试逻辑，用来判断体积/md5 不一致是「每次上传都发生」还是「重试引入」。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { API_DIR, loadDotEnv } from './_env.mjs'

loadDotEnv()

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000'
const USER = process.env.SMOKE_USER || process.env.ADMIN_USERNAME || 'admin'
const PASS = process.env.SMOKE_PASS || process.env.ADMIN_PASSWORD || 'change-me'
const DB_PATH = process.env.SMOKE_DB || path.join(API_DIR, 'data/glimmer.db')
const UPLOAD_DIR = path.join(API_DIR, 'data/uploads')

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', x: '\x1b[0m' }
let bad = 0

// 1) 登录
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((v) => v.split(';')[0]).join('; ')

// 2) 生成一张内容唯一的新图（加入随机噪点，保证不会命中秒传）
const noise = crypto.randomBytes(96).toString('hex')
const png = await sharp({
  create: { width: 640, height: 480, channels: 3, background: { r: 12, g: 200, b: 90 } },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="640" height="480"><text x="20" y="240" font-size="28" fill="#fff">${noise}</text></svg>`,
      ),
      top: 0,
      left: 0,
    },
  ])
  .png()
  .toBuffer()

console.log(`源文件：PNG ${png.byteLength} B  magic=${png.subarray(0, 4).toString('hex')}`)

// 3) 上传
const form = new FormData()
form.append('files', new Blob([png], { type: 'image/png' }), `probe-${noise.slice(0, 6)}.png`)
form.append('formats', 'webp,jpeg')
form.append('backends', 'local')
form.append('keepOriginal', 'true')

const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form })
const accepted = (await up.json()).data
const id = accepted.images[0].id
console.log(`已入队 imageId=${id}${accepted.images[0].deduplicated ? '（命中秒传，改用新图）' : ''}`)

// 4) 轮询到 ready
let detail = null
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 500))
  const res = await fetch(`${BASE}/api/images/${id}`, { headers: { Cookie: cookie } })
  detail = (await res.json()).data
  if (detail.status !== 'pending') break
}
console.log(`处理结果 status=${detail.status}\n`)

// 5) 比对
const db = new Database(DB_PATH, { readonly: true })
const rows = db
  .prepare(
    `SELECT v.format, v.storage_path, v.size AS var_size, v.md5
     FROM image_variants v JOIN storage_records s ON s.variant_id = v.id
     WHERE v.image_id = ? AND s.backend = 'local' AND s.status = 'ready'
     ORDER BY v.format`,
  )
  .all(id)
db.close()

const EXPECT_MAGIC = { png: '89504e47', original: '89504e47', webp: '52494646', jpeg: 'ffd8ff' }

console.log('格式     库size  磁盘size  md5  类型魔数   期望')
for (const r of rows) {
  const file = path.join(UPLOAD_DIR, r.storage_path)
  let diskSize = 'MISSING'
  let hash = ''
  let magic = ''
  try {
    const buf = fs.readFileSync(file)
    diskSize = buf.length
    hash = crypto.createHash('md5').update(buf).digest('hex')
    magic = buf.subarray(0, 4).toString('hex')
  } catch {}

  const sizeOk = diskSize === r.var_size
  const md5Ok = hash === r.md5
  const expect = EXPECT_MAGIC[r.format] ?? ''
  const magicOk = expect ? magic.startsWith(expect.slice(0, 6)) : true

  if (!sizeOk || !md5Ok || !magicOk) bad += 1

  const mark = sizeOk && md5Ok && magicOk ? `${c.g}OK  ${c.x}` : `${c.r}FAIL${c.x}`
  console.log(
    `${mark} ${r.format.padEnd(8)} ${String(r.var_size).padStart(6)}  ${String(diskSize).padStart(8)}  ` +
      `${(md5Ok ? 'OK ' : 'BAD')}  ${magic.padEnd(10)} ${expect}  attempts=?`,
  )
  if (!sizeOk) console.log(`      ${c.y}体积不一致：库 ${r.var_size} vs 磁盘 ${diskSize}${c.x}`)
  if (!magicOk) console.log(`      ${c.y}文件类型不符：磁盘魔数 ${magic} 期望 ${expect}${c.x}`)
}

console.log('')
console.log(bad === 0 ? `${c.g}全新上传：库记录与磁盘文件完全一致${c.x}` : `${c.r}全新上传即有 ${bad} 处不一致${c.x}`)
process.exit(bad === 0 ? 0 : 1)
