#!/usr/bin/env node
/**
 * 存储一致性审计
 *
 * 逐条比对 image_variants 记录的 size/md5 与本地后端磁盘上的实际字节，
 * 并打印每个变体文件的魔数（用于发现「原图归档被 webp 派生物覆盖」这类污染）。
 *
 * 同时审计**临时原图**：`data/tmp/<imageId>.src` 必须与 `original` 变体的指纹一致，
 * 否则说明它已被派生变体顶替 —— 这正是历史上「重试把 webp 当原图」的源头。
 *
 * 用法（**必须在 apps/api 目录下运行**，因为 .env 里的路径是相对的）：
 *   cd apps/api && node scripts/audit-variants.mjs          # 只读审计
 *   cd apps/api && node scripts/audit-variants.mjs --orphans # 额外列出孤儿文件（只列不删）
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DB_PATH = process.env.AUDIT_DB ?? './data/glimmer.db'
const UPLOAD_ROOT = path.resolve(process.env.AUDIT_UPLOADS ?? './data/uploads')
const TEMP_ROOT = path.resolve(process.env.AUDIT_TEMP ?? './data/tmp')
const SHOW_ORPHANS = process.argv.includes('--orphans')

const MAGIC = [
  { name: 'PNG', check: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  { name: 'JPEG', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'WEBP', check: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { name: 'GIF', check: (b) => b.subarray(0, 3).toString('ascii') === 'GIF' },
  { name: 'AVIF', check: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii').startsWith('avi') },
  { name: 'SVG', check: (b) => b.subarray(0, 200).toString('utf8').includes('<svg') },
]

function detect(buf) {
  for (const m of MAGIC) if (m.check(buf)) return m.name
  return `?(${buf.subarray(0, 8).toString('hex')})`
}

const db = new Database(DB_PATH, { readonly: true })
const variants = db
  .prepare(
    `SELECT v.id, v.image_id, v.format, v.size, v.md5, v.status,
            i.filename, i.status AS image_status, i.mime_type
       FROM image_variants v
       JOIN images i ON i.id = v.image_id
      ORDER BY i.created_at, v.format`,
  )
  .all()

const records = db
  .prepare(`SELECT id, variant_id, backend, status, path FROM storage_records`)
  .all()
db.close()

const byVariant = new Map()
for (const r of records) {
  const list = byVariant.get(r.variant_id) ?? []
  list.push(r)
  byVariant.set(r.variant_id, list)
}

const problems = []
let checked = 0

console.log(`DB      ${DB_PATH}`)
console.log(`uploads ${UPLOAD_ROOT}\n`)

let currentImage = null
for (const v of variants) {
  if (v.image_id !== currentImage) {
    currentImage = v.image_id
    console.log(`\n# ${v.filename}  [${v.image_status}]  ${v.image_id}`)
  }

  for (const rec of byVariant.get(v.id) ?? []) {
    if (rec.status !== 'ready') {
      console.log(`  · ${v.format.padEnd(8)} ${rec.backend.padEnd(6)} ${rec.status}`)
      continue
    }
    const abs = path.join(UPLOAD_ROOT, rec.path)
    if (!fs.existsSync(abs)) {
      problems.push(`${v.filename} / ${v.format} @${rec.backend}: 记录 ready 但文件不存在 ${rec.path}`)
      console.log(`  ✗ ${v.format.padEnd(8)} ${rec.backend.padEnd(6)} 文件缺失 ${rec.path}`)
      continue
    }
    const buf = fs.readFileSync(abs)
    const md5 = createHash('md5').update(buf).digest('hex')
    const sizeOk = buf.byteLength === v.size
    const md5Ok = !v.md5 || md5 === v.md5
    checked += 1
    const magic = detect(buf)
    const flags = [sizeOk ? '' : `SIZE ${buf.byteLength}≠${v.size}`, md5Ok ? '' : `MD5 ${md5.slice(0, 8)}≠${v.md5.slice(0, 8)}`]
      .filter(Boolean)
      .join(' ')
    if (flags) problems.push(`${v.filename} / ${v.format} @${rec.backend}: ${flags}（磁盘 ${magic}）`)
    console.log(
      `  ${flags ? '✗' : '✓'} ${v.format.padEnd(8)} ${rec.backend.padEnd(6)} ${String(buf.byteLength).padStart(8)}B ` +
        `disk=${magic.padEnd(6)} db=${v.size}B ${flags}`,
    )
  }

  // 原图归档的格式必须与上传 mime 自洽
  if (v.format === 'original') {
    const rec = (byVariant.get(v.id) ?? []).find((r) => r.status === 'ready')
    if (rec) {
      const abs = path.join(UPLOAD_ROOT, rec.path)
      if (fs.existsSync(abs)) {
        const magic = detect(fs.readFileSync(abs))
        const expect = v.mime_type?.includes('png') ? 'PNG' : v.mime_type?.includes('jpeg') ? 'JPEG' : null
        if (expect && magic !== expect) {
          problems.push(`${v.filename}: 原图归档魔数为 ${magic}，但上传类型是 ${v.mime_type}（归档已被污染）`)
        }
      }
    }
  }
}

/* --- 临时原图审计 --------------------------------------------------- */

const tempFiles = fs.existsSync(TEMP_ROOT)
  ? fs.readdirSync(TEMP_ROOT).filter((f) => f.endsWith('.src'))
  : []

console.log('\n## 临时原图  data/tmp/*.src')

for (const file of tempFiles) {
  const imageId = file.replace(/\.src$/, '')
  const abs = path.join(TEMP_ROOT, file)
  const buf = fs.readFileSync(abs)
  const md5 = createHash('md5').update(buf).digest('hex')
  const magic = detect(buf)

  const mine = variants.filter((v) => v.image_id === imageId)
  if (mine.length === 0) {
    problems.push(`临时原图 ${file} 属孤儿（对应图片已不存在）`)
    console.log(`  ✗ ${file}  ${magic}  图片已不存在（孤儿）`)
    continue
  }

  const original = mine.find((v) => v.format === 'original')
  const allReady = mine.every((v) => byVariant.get(v.id)?.every((r) => r.status === 'ready') ?? false)
  const mismatched = original?.md5 ? md5 !== original.md5 : false
  const note = mismatched
    ? '与 original 指纹不符（已被派生变体顶替）'
    : allReady
      ? '任务已完成，本应清理'
      : '重试中，属正常残留'
  if (mismatched) problems.push(`临时原图 ${file} 与 original 指纹不符（${magic}）`)
  console.log(`  ${mismatched ? '✗' : '·'} ${file}  ${magic.padEnd(6)}  ${note}`)
}
if (tempFiles.length === 0) console.log('  （空）')

/* --- 孤儿文件 ------------------------------------------------------- */

if (SHOW_ORPHANS) {
  const referenced = new Set(records.map((r) => path.resolve(UPLOAD_ROOT, r.path)))
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(abs))
      else out.push(abs)
    }
    return out
  }
  const onDisk = fs.existsSync(UPLOAD_ROOT) ? walk(UPLOAD_ROOT) : []
  const orphans = onDisk.filter((f) => !referenced.has(path.resolve(f)))
  console.log(`\n## 孤儿文件  data/uploads（${orphans.length} / ${onDisk.length}）`)
  for (const f of orphans) {
    console.log(`  - ${path.relative(UPLOAD_ROOT, f).split(path.sep).join('/')}  ${detect(fs.readFileSync(f))}`)
  }
  if (orphans.length === 0) console.log('  （无）')
}

/* --- 汇总 ----------------------------------------------------------- */

console.log(`\n共核对 ${checked} 个已就绪副本、${tempFiles.length} 个临时原图`)
if (problems.length === 0) {
  console.log('\n没有发现不一致')
} else {
  console.log(`\n发现 ${problems.length} 处不一致：`)
  for (const p of problems) console.log(`  - ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)
