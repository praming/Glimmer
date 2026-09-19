import type {
  CopyFormat,
  GlobalSettings,
  LocalBackendConfig,
  OutputFormat,
  StorageBackend,
  UserPreferences,
  VariantFormat,
} from './types.js'

/* ------------------------------------------------------------------ */
/* 存储后端                                                             */
/* ------------------------------------------------------------------ */

export const STORAGE_BACKEND_LABEL: Record<StorageBackend, string> = {
  local: '本地存储',
  s3: 'S3 兼容存储',
  webdav: 'WebDAV',
}

/** 默认本地后端 id */
export const DEFAULT_LOCAL_BACKEND_ID = 'local'

export const DEFAULT_LOCAL_BACKEND: LocalBackendConfig = {
  id: DEFAULT_LOCAL_BACKEND_ID,
  name: '本地存储',
  type: 'local',
  enabled: true,
  publicBaseUrl: '',
  pathPrefix: '',
  directory: '',
}

/**
 * 敏感字段占位符：前端回显配置时用它替换真实密钥，
 * PATCH 时若值等于占位符则保留数据库中的原值。
 */
export const SECRET_PLACEHOLDER = '__GLIMMER_SECRET_KEEP__'

/* ------------------------------------------------------------------ */
/* 图片格式                                                             */
/* ------------------------------------------------------------------ */

export const OUTPUT_FORMATS: OutputFormat[] = ['jpeg', 'png', 'webp', 'avif', 'gif']

/** 输出格式 → 文件扩展名 */
export const FORMAT_EXT: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
}

/** 输出格式 → MIME */
export const FORMAT_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
}

export const FORMAT_LABEL: Record<VariantFormat, string> = {
  original: '原图',
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  avif: 'AVIF',
  gif: 'GIF',
}

/** 允许上传的输入 MIME */
export const ALLOWED_INPUT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
] as const

export type InputMime = (typeof ALLOWED_INPUT_MIME)[number]

/** 供设置页渲染「允许上传的文件类型」开关组 */
export const INPUT_MIME_OPTIONS: Array<{ mime: InputMime; label: string; ext: string }> = [
  { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg / jpeg' },
  { mime: 'image/png', label: 'PNG', ext: 'png' },
  { mime: 'image/webp', label: 'WebP', ext: 'webp' },
  { mime: 'image/avif', label: 'AVIF', ext: 'avif' },
  { mime: 'image/gif', label: 'GIF', ext: 'gif' },
  { mime: 'image/tiff', label: 'TIFF', ext: 'tif / tiff' },
  { mime: 'image/bmp', label: 'BMP', ext: 'bmp' },
  { mime: 'image/svg+xml', label: 'SVG', ext: 'svg' },
]

/** 默认允许全部类型 */
export const DEFAULT_ALLOWED_INPUT_MIME: InputMime[] = [...ALLOWED_INPUT_MIME]

/** MIME → 简短的格式名，用于错误提示 */
export const INPUT_MIME_LABEL: Record<string, string> = Object.fromEntries(
  INPUT_MIME_OPTIONS.map((item) => [item.mime, item.label]),
)

/** 输入 MIME → 原图 variant 记录的 format 值 */
export const MIME_TO_FORMAT: Record<string, VariantFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/tiff': 'jpeg',
  'image/bmp': 'png',
  'image/svg+xml': 'png',
}

/** 扩展名 → MIME（用于按文件名兜底判断） */
export const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/* ------------------------------------------------------------------ */
/* 复制格式                                                             */
/* ------------------------------------------------------------------ */

export const COPY_FORMATS: CopyFormat[] = ['direct', 'markdown', 'html', 'bbcode']

export const COPY_FORMAT_LABEL: Record<CopyFormat, string> = {
  direct: '直链',
  markdown: 'Markdown',
  html: 'HTML',
  bbcode: 'BBCode',
}

/* ------------------------------------------------------------------ */
/* 命名模板                                                             */
/* ------------------------------------------------------------------ */

export interface NamingVarMeta {
  /** 展示用的完整写法，如 `{random:10}` */
  token: string
  /** 中文名 */
  label: string
  /** 悬浮提示里的使用说明 */
  description: string
  /** 悬浮提示里的示例值 */
  example: string
}

/** 命名模板可用变量：同时驱动设置页的徽标列表与悬浮说明 */
export const NAMING_TEMPLATE_VARS: NamingVarMeta[] = [
  {
    token: '{date}',
    label: '日期',
    description: '上传当天的日期，常用作按日分目录。',
    example: '2026-09-17',
  },
  {
    token: '{time}',
    label: '时间',
    description: '上传时刻，精确到秒，适合避免同一秒内的重名。',
    example: '2026-09-17-093012',
  },
  {
    token: '{random}',
    label: '随机字符',
    description:
      '随机小写字母与数字。默认 6 位；写成 {random:N} 可指定任意 1–32 位，例如 {random:10} 得到 10 位。',
    example: 'a3f8c1',
  },
  {
    token: '{origin}',
    label: '原文件名',
    description: '上传文件的原名，已去掉扩展名并做过安全字符过滤。',
    example: 'photo',
  },
  {
    token: '{index}',
    label: '序号',
    description: '同一批上传中的顺序，从 1 开始；单张上传时该变量为空。',
    example: '1',
  },
  {
    token: '{format}',
    label: '输出格式',
    description: '该变体的输出格式名（不含点），同一张图的不同格式会得到不同路径。',
    example: 'webp',
  },
  {
    token: '{Y}',
    label: '当前年份',
    description: '四位年份。',
    example: '2026',
  },
  {
    token: '{y}',
    label: '年份简写',
    description: '两位年份。',
    example: '26',
  },
  {
    token: '{m}',
    label: '当前月份',
    description: '两位月份，不足补零。',
    example: '09',
  },
  {
    token: '{d}',
    label: '当日',
    description: '两位日期，不足补零。',
    example: '17',
  },
  {
    token: '{Ymd}',
    label: '年月日',
    description: '紧凑的八位年月日，不含分隔符。',
    example: '20260917',
  },
  {
    token: '{ext}',
    label: '文件扩展名',
    description: '输出文件的扩展名，与 {format} 取值一致；服务端已自动追加扩展名，重复写不会产生双后缀。',
    example: 'png',
  },
  {
    token: '{uniqid}',
    label: '唯一 ID',
    description: 'PHP uniqid() 风格的 13 位唯一标识，几乎不会重复。',
    example: '667530e55196f',
  },
]

export const NAMING_TEMPLATE_PRESETS = [
  { label: '日期 / 随机-原名', value: '{date}/{random}-{origin}' },
  { label: '日期 / 时间-原名', value: '{date}/{time}-{origin}' },
  { label: '随机短链', value: '{random}' },
  { label: '原名（冲突自动加后缀）', value: '{origin}' },
  { label: '日期 / 格式 / 随机', value: '{date}/{format}/{random}' },
  { label: '随机-原名-索引', value: '{random}-{origin}-{index}' },
  { label: '年月日 / 唯一 ID', value: '{Ymd}/{uniqid}' },
  { label: '年 / 月 / 日 / 原名', value: '{Y}/{m}/{d}/{origin}' },
] as const

/* ------------------------------------------------------------------ */
/* 默认值                                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  namingTemplate: '{date}/{random}-{origin}',
  processing: {
    qualityJpeg: 80,
    qualityWebp: 80,
    qualityAvif: 75,
    qualityPng: 9,
    qualityGif: 7,
    maxWidth: 2560,
    maxHeight: 2560,
    outputFormats: ['webp'],
    keepOriginal: false,
    stripExif: true,
  },
  galleryVisibility: 'shared',
  publicBaseUrl: '',
  filesPathPrefix: 'files',
  backends: [{ ...DEFAULT_LOCAL_BACKEND }],
  defaultBackends: [DEFAULT_LOCAL_BACKEND_ID],
  maxUploadSizeMb: 20,
  allowedInputMime: [...DEFAULT_ALLOWED_INPUT_MIME],
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultCopyFormat: 'direct',
  autoCopy: true,
  theme: 'system',
  fontSansZh: '',
  fontSansEn: '',
}

/**
 * 字体输入框的内置候选（设置页的快捷填充）。
 *
 * 这里一律写「不带引号」的字体名：含空格的字体由 `normalizeFontStack()`
 * 在写入 CSS 变量时统一补引号，避免手输时漏引号导致整条字体栈静默失效。
 * 列表覆盖 Windows 与 macOS 两边的常见预装字体。
 */
export const FONT_PRESETS_ZH = [
  'system-ui',
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans SC',
  'Source Han Sans SC',
  'SimSun',
] as const

export const FONT_PRESETS_EN = [
  'system-ui',
  'Inter',
  'Segoe UI',
  'Helvetica Neue',
  'Arial',
  'Georgia',
  'JetBrains Mono',
] as const

/* ------------------------------------------------------------------ */
/* 其他常量                                                             */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE_NAME = 'glimmer_session'

/**
 * 「个人资料 → 会话有效期」的可选天数。
 * 只开放这几档，避免用户填出 1 天或 3 年这类极端值。
 */
export const SESSION_DAY_OPTIONS = [7, 15, 30, 60, 90] as const

export type SessionDays = (typeof SESSION_DAY_OPTIONS)[number]

/** 用户未单独设置时的展示值（服务端默认 SESSION_TTL_DAYS 为 7） */
export const DEFAULT_SESSION_DAYS: SessionDays = 7

export const UPLOAD_MAX_FILES_PER_REQUEST = 20

/* ------------------------------------------------------------------ */
/* P3-1 秒传去重                                                        */
/* ------------------------------------------------------------------ */

/*
 * 秒传去重的作用域刻意限定为「同一用户」。
 *
 * 全局去重会让 A 上传的文件被 B 命中，从而在私有图库下把 A 的图片 URL
 * 暴露给 B；而本项目的验收标准要求「普通用户只能编辑/删除自己的图片」，
 * 同用户去重不会改变任何权限语义。
 *
 * 实现见 apps/api/src/services/dedup.ts（对应 README「秒传去重（P3-1）」）。
 */

/* ------------------------------------------------------------------ */
/* P3-2 API Token                                                       */
/* ------------------------------------------------------------------ */

/** token 明文前缀，便于在日志 / 泄露扫描中识别 */
export const API_TOKEN_PREFIX = 'glm_'

/** 列表中展示的明文字符数（含前缀） */
export const API_TOKEN_PREFIX_DISPLAY = 12

/** 单用户 token 数量上限 */
export const MAX_API_TOKENS = 10

/**
 * `last_used_at` 的写入节流窗口。
 * token 可能被脚本高频调用，每次都写库会造成明显的写放大。
 */
export const API_TOKEN_TOUCH_INTERVAL_MS = 60_000

/* ------------------------------------------------------------------ */
/* P3-4 失败任务自动重试                                                */
/* ------------------------------------------------------------------ */

/** 自动重试次数上限（不含首次尝试） */
export const RETRY_MAX_ATTEMPTS = 4

/** 第一次重试前等待时间 */
export const RETRY_BASE_DELAY_MS = 30_000

/** 退避倍率：30s → 2m → 8m → 32m */
export const RETRY_BACKOFF_FACTOR = 4

/** 单次退避上限（1 小时） */
export const RETRY_MAX_DELAY_MS = 60 * 60 * 1000

/** 自动重试扫描间隔 */
export const RETRY_SCAN_INTERVAL_MS = 15_000
