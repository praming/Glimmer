/**
 * 浮光 / Glimmer —— 共享类型定义
 * 同时被 API 与 Web 消费，是所有数据契约的唯一来源。
 */

/* ------------------------------------------------------------------ */
/* 枚举与字面量类型                                                     */
/* ------------------------------------------------------------------ */

/** 用户角色 */
export type Role = 'admin' | 'member'

/** 图片整体处理状态 */
export type ImageStatus = 'pending' | 'ready' | 'failed'

/** 单个存储记录 / variant 的同步状态 */
export type SyncStatus = 'pending' | 'ready' | 'failed'

/** 存储后端类型 */
export type StorageBackend = 'local' | 's3' | 'webdav'

/** 图片变体格式（original 表示未压缩原图） */
export type VariantFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif'

/** 可作为输出目标的格式（不含 original） */
export type OutputFormat = Exclude<VariantFormat, 'original'>

/** 可复制的 URL 格式 */
export type CopyFormat = 'direct' | 'markdown' | 'html' | 'bbcode'

/** 图库可见性 */
export type GalleryVisibility = 'shared' | 'private'

/** 主题偏好 */
export type ThemePreference = 'light' | 'dark' | 'system'

/* ------------------------------------------------------------------ */
/* 传输对象（DTO）                                                      */
/* ------------------------------------------------------------------ */

export interface UserDTO {
  id: string
  username: string
  role: Role
  disabled: boolean
  createdAt: string
  updatedAt: string | null
  /** 头像地址：外部 URL 或本图库某张图片的直链；为空时回落到首字母占位 */
  avatarUrl: string | null
  /** 该用户上传的图片数量（管理员列表接口返回） */
  imageCount?: number
}

export interface SessionUserDTO {
  id: string
  username: string
  role: Role
  avatarUrl: string | null
  /** 会话有效期（天）；null 表示跟随服务端默认值（SESSION_TTL_DAYS） */
  sessionDays: number | null
}

export interface StorageRecordDTO {
  id: string
  /** 后端类型，便于前端取图标 */
  backend: StorageBackend
  /** 后端配置 id */
  backendId: string
  /** 后端显示名 */
  backendName: string
  path: string
  url: string | null
  status: SyncStatus
  errorMessage: string | null
  /** P3-4：该后端已尝试次数 */
  attemptCount: number
  /** P3-4：下次自动重试时间；null 表示不再自动重试 */
  nextRetryAt: string | null
  createdAt: string
}

/** 四种复制格式的 URL 集合 */
export interface UrlSet {
  direct: string
  markdown: string
  html: string
  bbcode: string
}

export interface VariantDTO {
  id: string
  format: VariantFormat
  storagePath: string
  size: number | null
  width: number | null
  height: number | null
  md5: string | null
  status: SyncStatus
  /** 各后端同步结果 */
  storages: StorageRecordDTO[]
  /** 该 variant 所有可用直链（按后端） */
  urls: string[]
  /** 主直链（优先 ready 的后端） */
  primaryUrl: string | null
  /** 四种格式的复制文本（基于主直链） */
  copy: UrlSet | null
}

/** 图片级自动重试摘要（P3-4） */
export interface ImageRetryInfo {
  /** 已自动重试次数 */
  attemptCount: number
  /** 下次自动重试时间；null 表示不会再自动重试 */
  nextRetryAt: string | null
  /** 自动重试配额是否已耗尽（耗尽后需手动重试） */
  exhausted: boolean
}

export interface ImageDTO {
  id: string
  userId: string
  /** 上传者用户名 */
  username: string
  originalName: string | null
  filename: string
  mimeType: string | null
  width: number | null
  height: number | null
  status: ImageStatus
  createdAt: string
  updatedAt: string | null
  /** 列表接口返回摘要，详情接口返回完整 variants */
  variants?: VariantDTO[]
  /** 预览用缩略图：优先 webp → 其他，取第一个 ready 的 variant */
  previewUrl: string | null
  /** 主格式（用于列表角标） */
  primaryFormat: VariantFormat | null
  /** 全部变体总大小 */
  totalSize: number
  /** P3-3：该图片直链被访问次数与出口字节（无记录时为 0） */
  views: number
  /** P3-3：最近一次被访问时间 */
  lastAccessAt: string | null
  /** P3-4：失败时的自动重试摘要 */
  retry: ImageRetryInfo
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

export interface ImageProcessingSettings {
  /** JPEG 质量 1-100 */
  qualityJpeg: number
  /** WebP 质量 1-100 */
  qualityWebp: number
  /** AVIF 质量 1-100 */
  qualityAvif: number
  /** PNG 压缩等级 0-9 */
  qualityPng: number
  /** GIF effort 1-10 */
  qualityGif: number
  /** 最大宽度（不放大） */
  maxWidth: number
  /** 最大高度（不放大） */
  maxHeight: number
  /** 默认输出格式（可多选） */
  outputFormats: OutputFormat[]
  /** 是否保留原图 */
  keepOriginal: boolean
  /** 是否移除 EXIF */
  stripExif: boolean
}

interface BackendConfigBase {
  id: string
  name: string
  type: StorageBackend
  enabled: boolean
  /** 该后端的对外访问前缀，为空则回落到全局 publicBaseUrl */
  publicBaseUrl: string
  /** 对象键前缀，如 `glimmer/` */
  pathPrefix: string
}

export interface LocalBackendConfig extends BackendConfigBase {
  type: 'local'
  /** 存储根目录，留空使用 LOCAL_STORAGE_DIR */
  directory: string
}

export interface S3BackendConfig extends BackendConfigBase {
  type: 's3'
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** MinIO 等需要 path-style */
  forcePathStyle: boolean
}

export interface WebdavBackendConfig extends BackendConfigBase {
  type: 'webdav'
  url: string
  username: string
  password: string
  /** 远端子目录 */
  directory: string
}

export type BackendConfig = LocalBackendConfig | S3BackendConfig | WebdavBackendConfig

export interface GlobalSettings {
  /** 命名模板，支持 {date} {time} {Y} {y} {m} {d} {Ymd} {random:N} {uniqid} {origin} {index} {format} {ext} */
  namingTemplate: string
  processing: ImageProcessingSettings
  galleryVisibility: GalleryVisibility
  /** 全局对外基地址（CDN 域名） */
  publicBaseUrl: string
  /** 存储后端列表 */
  backends: BackendConfig[]
  /** 默认选中的后端 id 列表 */
  defaultBackends: string[]
  /** 单文件上传上限（MB） */
  maxUploadSizeMb: number
  /** 允许上传的输入 MIME 白名单；为空数组表示全部允许 */
  allowedInputMime: string[]
}

export interface UserPreferences {
  defaultCopyFormat: CopyFormat
  autoCopy: boolean
  theme: ThemePreference
  /** 中文字体栈（CSS font-family 片段），留空使用内置默认 */
  fontSansZh: string
  /** 英文与数字字体栈，留空使用内置默认 */
  fontSansEn: string
}

/* ------------------------------------------------------------------ */
/* 公共 API 回包                                                        */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface UploadAccepted {
  images: Array<{
    id: string
    filename: string
    originalName: string
    status: ImageStatus
    /** P3-1：true 表示命中秒传去重，未写入任何新文件 */
    deduplicated?: boolean
  }>
  rejected: Array<{
    originalName: string
    reason: string
  }>
}

export interface BackendTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface QueueStats {
  waiting: number
  active: number
  completed: number
  failed: number
}

/* ------------------------------------------------------------------ */
/* P3-1 秒传去重                                                        */
/* ------------------------------------------------------------------ */

export interface UploadCheckResult {
  /** 是否命中秒传（同一用户 + 同内容 + 同处理配置） */
  hit: boolean
  /** 命中时返回已存在的图片详情，客户端可直接跳过文件传输 */
  image: ImageDTO | null
}

/* ------------------------------------------------------------------ */
/* P3-2 API Token                                                       */
/* ------------------------------------------------------------------ */

export interface ApiTokenDTO {
  id: string
  name: string
  /** 明文前若干位，用于在列表中辨认（明文本身不再可取回） */
  prefix: string
  lastUsedAt: string | null
  /** null 表示永不过期 */
  expiresAt: string | null
  /** 软撤销时间；null 表示未被撤销 */
  revokedAt: string | null
  createdAt: string
  /** 当前是否可用于认证（未撤销且未过期） */
  active: boolean
}

export interface CreatedApiTokenDTO extends ApiTokenDTO {
  /** 明文 token，**仅在创建时返回一次** */
  token: string
}

/* ------------------------------------------------------------------ */
/* P3-3 访问统计                                                        */
/* ------------------------------------------------------------------ */

export interface AccessDailyPoint {
  /** UTC 日期 YYYY-MM-DD */
  day: string
  views: number
  bytes: number
}

export interface TopImageStat {
  id: string
  filename: string
  userId: string
  username: string
  views: number
  bytesServed: number
  lastAccessAt: string | null
}

export interface BackendStat {
  backendId: string
  name: string
  type: StorageBackend
  /** 该后端承载的存储记录数 */
  records: number
  ready: number
  failed: number
  /** 已成功同步的产物字节数 */
  bytes: number
}

export interface AccessStatsDTO {
  /** admin 默认看全局，member 只能看自己 */
  scope: 'global' | 'self'
  /** 趋势统计的天数窗口 */
  days: number
  totals: {
    images: number
    variants: number
    /** 全部变体字节数（含多后端冗余） */
    bytes: number
    /** 被访问过的图片数 */
    accessedImages: number
    /** 直链访问总次数 */
    views: number
    /** 直链出口总字节 */
    bytesServed: number
  }
  status: {
    pending: number
    ready: number
    failed: number
  }
  /** P3-4：自动重试概况 */
  retry: {
    /** 已排期等待重试的存储记录数 */
    scheduled: number
    /** 已耗尽自动重试配额、仍处失败状态的存储记录数 */
    exhausted: number
    /** 失败中的存储记录总数 */
    failedRecords: number
  }
  backends: BackendStat[]
  topImages: TopImageStat[]
  daily: AccessDailyPoint[]
}
