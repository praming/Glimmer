import type { CopyFormat, ImageProcessingSettings, OutputFormat, UrlSet } from './types.js'

/* ------------------------------------------------------------------ */
/* 通用格式化                                                           */
/* ------------------------------------------------------------------ */

const HEX = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 最小 WebCrypto 契约：让本包在 Node 与浏览器中都能通过类型检查 */
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T
}

/**
 * 生成指定长度的随机字符串（默认 8 位，小写字母 + 数字）。
 * 优先使用 WebCrypto，缺失时回落到 Math.random。
 */
export function randomString(length = 8): string {
  const bytes = new Uint8Array(length)
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto

  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }

  let out = ''
  for (let i = 0; i < length; i += 1) out += HEX[bytes[i]! % HEX.length]
  return out
}

/** `2026-09-16` */
export function formatDateOnly(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `2026-09-16`（UTC）—— 访问统计按 UTC 天聚合，与数据库默认值口径一致 */
export function formatUtcDateOnly(date: Date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 最小 WebCrypto 摘要契约 */
interface SubtleCryptoLike {
  subtle?: { digest(algorithm: string, data: ArrayBufferView | ArrayBuffer): Promise<ArrayBuffer> }
}

/**
 * 计算字节内容的 SHA-256（小写十六进制）。
 *
 * 走 WebCrypto，因此 Node（>= 20 全局 crypto）与浏览器**同一份实现**，
 * 前端做秒传预检、后端做兜底去重时结果必然一致。
 */
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView | Uint8Array): Promise<string> {
  const cryptoObj = (globalThis as { crypto?: SubtleCryptoLike }).crypto
  if (!cryptoObj?.subtle) throw new Error('当前运行环境缺少 WebCrypto，无法计算摘要')

  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  const digest = await cryptoObj.subtle.digest('SHA-256', view)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `2026-09-16-1235` */
export function formatDateTimeCompact(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${formatDateOnly(date)}-${hh}${mm}${ss}`
}

/** 人类可读体积 */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes == null || Number.isNaN(bytes)) return '—'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

/** ISO 时间 → `2026-09-16 12:35`（本地时区） */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 相对时间：3 分钟前 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatDateTime(iso).slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* 文件名安全处理                                                       */
/* ------------------------------------------------------------------ */

/**
 * 去掉路径分隔符与危险字符，保留中文、字母数字、`-` `_` `.`
 * 结果保证非空且长度受控。
 */
export function sanitizeFilename(input: string, fallback = 'image'): string {
  const base = input
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .trim()

  const safe = base.length > 0 ? base : fallback
  // 限制单段长度，避免超出文件系统限制
  return safe.length > 120 ? safe.slice(0, 120) : safe
}

/** 取扩展名（不含点，小写） */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx <= 0 || idx === filename.length - 1) return ''
  return filename.slice(idx + 1).toLowerCase()
}

/** 去掉扩展名 */
export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx > 0 ? filename.slice(0, idx) : filename
}

/**
 * 清理对象键 / 存储路径：移除 `..`、开头 `/`、连续斜杠，逐段 sanitize。
 */
export function sanitizeStoragePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[^0-9A-Za-z\u4e00-\u9fa5._\-@+]/g, '_'))
    .join('/')
}

/* ------------------------------------------------------------------ */
/* 命名模板                                                             */
/* ------------------------------------------------------------------ */

export interface NamingContext {
  /** 覆盖 {date} */
  date?: string
  /** 覆盖 {time} */
  time?: string
  /** 覆盖 {random}（仅当长度与模板请求的长度一致时采用） */
  random?: string
  /** 覆盖 {origin}（已去掉扩展名） */
  origin?: string
  /** 覆盖 {index}（从 1 开始） */
  index?: number
  /** 覆盖 {format} 与 {ext} */
  format?: string
  /** 覆盖 {ext}，缺省时跟随 format */
  ext?: string
  /** 覆盖 {uniqid} */
  uniqid?: string
  /**
   * 提供后 `{random}` / `{random:N}` 由种子**确定性派生**。
   * 用于设置页预览，避免每次重算都抖动。
   */
  randomSeed?: string
  /** 时间基准，缺省为当前时间 */
  now?: Date
}

/** FNV-1a + xorshift 派生：同一 `seed` 与长度总是得到同一结果 */
function seededRandomString(seed: string, length: number): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let out = ''
  for (let i = 0; i < length; i += 1) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    out += HEX[Math.abs(h) % HEX.length]
  }
  return out
}

let lastUniqueIdMs = 0
let uniqueIdSeq = 0

/**
 * PHP `uniqid()` 风格的 13 位唯一 ID：8 位秒级十六进制 + 5 位微秒十六进制。
 * 同一毫秒内重复调用会自增尾数，保证不撞车。
 */
export function uniqueId(): string {
  const now = Date.now()
  if (now === lastUniqueIdMs) uniqueIdSeq += 1
  else {
    lastUniqueIdMs = now
    uniqueIdSeq = 0
  }

  const seconds = Math.floor(now / 1000)
    .toString(16)
    .padStart(8, '0')
    .slice(-8)
  const micro = Math.min(Math.floor((now % 1000) * 1000) + uniqueIdSeq, 0xfffff)
  return seconds + micro.toString(16).padStart(5, '0')
}

/** 模板占位符：`{name}` 或 `{name:N}`（`N` 为位数参数，目前仅 random 使用） */
const NAMING_TOKEN_RE = /\{([A-Za-z]+)(?::(\d{1,3}))?\}/g

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 应用命名模板。
 *
 * 支持变量：
 * - 日期时间类：`{date}` `{time}` `{Y}` `{y}` `{m}` `{d}` `{Ymd}`
 * - 随机类：`{random}` `{random:N}` `{uniqid}`
 * - 文件类：`{origin}` `{index}` `{format}` `{ext}`
 *
 * 例：`{Ymd}/{uniqid}` → `20260917/667530e55196f`
 */
export function applyNamingTemplate(template: string, ctx: NamingContext = {}): string {
  const now = ctx.now ?? new Date()
  const format = ctx.format ?? 'webp'
  const year = now.getFullYear()

  const values: Record<string, string> = {
    date: ctx.date ?? formatDateOnly(now),
    time: ctx.time ?? formatDateTimeCompact(now),
    origin: ctx.origin ?? 'image',
    index: ctx.index != null ? String(ctx.index) : '',
    format,
    ext: ctx.ext ?? format,
    Y: String(year),
    y: pad2(year % 100),
    m: pad2(now.getMonth() + 1),
    d: pad2(now.getDate()),
    Ymd: `${year}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`,
    uniqid: ctx.uniqid ?? uniqueId(),
  }

  const replaced = template.replace(NAMING_TOKEN_RE, (match, rawName: string, rawLength?: string) => {
    // {random:N} —— 长度参数唯一作用于 random
    if (rawName.toLowerCase() === 'random') {
      const length = rawLength ? Math.min(Math.max(Number(rawLength), 1), 32) : 6
      if (ctx.random && ctx.random.length === length) return ctx.random
      if (ctx.randomSeed) return seededRandomString(`${ctx.randomSeed}:${length}`, length)
      return randomString(length)
    }

    // 先做大小写精确匹配（{Y} 与 {y} 必须区分），再回落到全小写兼容旧写法
    if (rawName in values) return values[rawName]!
    const lower = rawName.toLowerCase()
    return lower in values ? values[lower]! : match
  })

  // 折叠空的 `--` / `-_` 等由 {index} 缺失造成的残留
  const collapsed = replaced
    .replace(/[-_]{2,}/g, (m) => m[0]!)
    .replace(/\/{2,}/g, '/')
    .replace(/(^|[/])[-_]+(?=[/]|$)/g, '$1')

  return sanitizeStoragePath(collapsed)
}

/* ------------------------------------------------------------------ */
/* URL 与复制文本                                                       */
/* ------------------------------------------------------------------ */

/** 拼接 baseUrl 与 path，处理重复斜杠 */
/* ------------------------------------------------------------------ */
/* 字体栈                                                               */
/* ------------------------------------------------------------------ */

/**
 * CSS 泛型字体族与平台关键字。
 * 它们不是具体字体文件，无法（也不需要）用「本机是否安装」来判断，
 * 在字体可用性检测里要单独放行，否则会被误报成「未安装」。
 */
const GENERIC_FONT_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'math',
  'emoji',
  'fangsong',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

export function isGenericFontKeyword(name: string): boolean {
  return GENERIC_FONT_KEYWORDS.has(name.trim().toLowerCase())
}

/**
 * 单个字体名 → CSS 里安全的写法。
 *
 * 含空格的字体名（`Microsoft YaHei`）在 `font-family` 里必须加引号，
 * 否则会被拆成三个独立字体名而**静默失效**——这正是「字体设了没反应」的常见原因。
 */
export function quoteFontName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  // 已带引号 → 统一成双引号
  if (/^".*"$/.test(trimmed)) return trimmed
  if (/^'.*'$/.test(trimmed)) return `"${trimmed.slice(1, -1).replace(/"/g, '')}"`
  // 泛型关键字与「不含空格/中文的标识符」可以裸写
  if (isGenericFontKeyword(trimmed)) return trimmed
  if (/^-?[A-Za-z][\w-]*$/.test(trimmed)) return trimmed
  return `"${trimmed.replace(/"/g, '')}"`
}

/**
 * 规范化用户输入的字体栈。
 *
 * 用户天然会写成 `PingFang SC, Microsoft YaHei`，
 * 这里按逗号切分（尊重用户已写好的引号），逐个补齐引号再拼回去。
 */
export function normalizeFontStack(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''

  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of raw) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)

  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map(quoteFontName)
    .join(', ')
}

export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  const rel = (path ?? '').replace(/^\/+/, '')
  if (!base) return `/${rel}`
  return rel ? `${base}/${rel}` : base
}

/** 生成四种格式的复制文本 */
export function buildCopyText(format: CopyFormat, url: string, alt = ''): string {
  const safeAlt = alt.replace(/[[\]]/g, '').trim() || 'image'
  switch (format) {
    case 'markdown':
      return `![${safeAlt}](${url})`
    case 'html':
      return `<img src="${url}" alt="${escapeHtmlAttribute(safeAlt)}" />`
    case 'bbcode':
      return `[img]${url}[/img]`
    case 'direct':
    default:
      return url
  }
}

/** 一次性生成全部四种格式 */
export function buildUrlSet(url: string, alt = ''): UrlSet {
  return {
    direct: buildCopyText('direct', url, alt),
    markdown: buildCopyText('markdown', url, alt),
    html: buildCopyText('html', url, alt),
    bbcode: buildCopyText('bbcode', url, alt),
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/* ------------------------------------------------------------------ */
/* 秒传去重（P3-1）                                                     */
/* ------------------------------------------------------------------ */

export interface DedupFingerprintInput {
  /** 原图字节的 SHA-256（十六进制） */
  contentHash: string
  /** 本次请求的输出格式集合 */
  formats: OutputFormat[]
  /** 是否保留原图 */
  keepOriginal: boolean
  /** 本次请求的目标存储后端配置 id 列表 */
  backends: string[]
  /** 影响产物字节的处理参数 */
  processing: ImageProcessingSettings
  /** 影响存储路径的命名模板 */
  namingTemplate: string
}

/**
 * 生成秒传去重的「规范指纹」。
 *
 * 只有「内容 + 一切会改变产物或路径的配置」都一致时才允许复用已有图片。
 * 若只按内容哈希去重，会出现「先用 webp 上传过一次，第二次选 webp+jpeg
 * 却直接拿回只含 webp 的旧图片」这类错配 —— 包括后端集合、命名模板、
 * 质量与尺寸参数在内的差异都必须进入指纹。
 *
 * 调用方负责对返回值再做一次 SHA-256（服务端用 node:crypto 同步实现，
 * 避免为一串已知输入引入异步）。
 */
export function buildDedupFingerprint(input: DedupFingerprintInput): string {
  const p = input.processing
  return [
    'v1',
    input.contentHash,
    [...input.formats].sort().join('+'),
    input.keepOriginal ? 'orig' : 'noorig',
    [...input.backends].sort().join('+'),
    `q:${p.qualityJpeg}/${p.qualityWebp}/${p.qualityAvif}/${p.qualityPng}/${p.qualityGif}`,
    `wh:${p.maxWidth}x${p.maxHeight}`,
    `exif:${p.stripExif ? 'strip' : 'keep'}`,
    `tpl:${input.namingTemplate}`,
  ].join('|')
}
