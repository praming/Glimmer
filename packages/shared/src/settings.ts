import {
  ALLOWED_INPUT_MIME,
  DEFAULT_ALLOWED_INPUT_MIME,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_LOCAL_BACKEND,
  SECRET_PLACEHOLDER,
} from './constants.js'
import type {
  BackendConfig,
  GlobalSettings,
  ImageProcessingSettings,
  S3BackendConfig,
  UserPreferences,
  WebdavBackendConfig,
} from './types.js'

/** 深合并图片处理设置 */
export function mergeProcessing(
  base: ImageProcessingSettings,
  patch?: Partial<ImageProcessingSettings>,
): ImageProcessingSettings {
  if (!patch) return { ...base }
  return {
    qualityJpeg: patch.qualityJpeg ?? base.qualityJpeg,
    qualityWebp: patch.qualityWebp ?? base.qualityWebp,
    qualityAvif: patch.qualityAvif ?? base.qualityAvif,
    qualityPng: patch.qualityPng ?? base.qualityPng,
    qualityGif: patch.qualityGif ?? base.qualityGif,
    maxWidth: patch.maxWidth ?? base.maxWidth,
    maxHeight: patch.maxHeight ?? base.maxHeight,
    outputFormats: patch.outputFormats?.length ? [...patch.outputFormats] : [...base.outputFormats],
    keepOriginal: patch.keepOriginal ?? base.keepOriginal,
    stripExif: patch.stripExif ?? base.stripExif,
  }
}

/** 规范化单个后端配置，补齐缺失字段 */
export function normalizeBackend(input: BackendConfig): BackendConfig {
  const base = {
    id: input.id,
    name: input.name || input.id,
    enabled: input.enabled ?? true,
    publicBaseUrl: (input.publicBaseUrl ?? '').replace(/\/+$/, ''),
    pathPrefix: (input.pathPrefix ?? '').replace(/^\/+|\/+$/g, ''),
  }

  if (input.type === 'local') {
    return { ...base, type: 'local', directory: input.directory ?? '' }
  }

  if (input.type === 's3') {
    return {
      ...base,
      type: 's3',
      endpoint: input.endpoint ?? '',
      region: input.region || 'us-east-1',
      bucket: input.bucket ?? '',
      accessKeyId: input.accessKeyId ?? '',
      secretAccessKey: input.secretAccessKey ?? '',
      forcePathStyle: input.forcePathStyle ?? false,
    } satisfies S3BackendConfig
  }

  return {
    ...base,
    type: 'webdav',
    url: input.url ?? '',
    username: input.username ?? '',
    password: input.password ?? '',
    directory: (input.directory ?? '').replace(/^\/+|\/+$/g, ''),
  } satisfies WebdavBackendConfig
}

/** 把任意（可能不完整的）对象规范化成完整 GlobalSettings */
export function normalizeGlobalSettings(raw: unknown): GlobalSettings {
  const input = (raw ?? {}) as Partial<GlobalSettings>
  const backends =
    Array.isArray(input.backends) && input.backends.length > 0
      ? input.backends.map((b) => normalizeBackend(b as BackendConfig))
      : [{ ...DEFAULT_LOCAL_BACKEND }]

  const enabledIds = backends.filter((b) => b.enabled).map((b) => b.id)
  const defaultBackends = (Array.isArray(input.defaultBackends) ? input.defaultBackends : []).filter(
    (id) => enabledIds.includes(id),
  )

  return {
    namingTemplate: input.namingTemplate?.trim() || DEFAULT_GLOBAL_SETTINGS.namingTemplate,
    processing: mergeProcessing(DEFAULT_GLOBAL_SETTINGS.processing, input.processing),
    galleryVisibility: input.galleryVisibility === 'private' ? 'private' : 'shared',
    publicBaseUrl: (input.publicBaseUrl ?? DEFAULT_GLOBAL_SETTINGS.publicBaseUrl).replace(/\/+$/, ''),
    filesPathPrefix: normalizeFilesPathPrefix(
      input.filesPathPrefix ?? DEFAULT_GLOBAL_SETTINGS.filesPathPrefix,
    ),
    backends,
    defaultBackends: defaultBackends.length > 0 ? defaultBackends : enabledIds.slice(0, 1),
    maxUploadSizeMb: input.maxUploadSizeMb ?? DEFAULT_GLOBAL_SETTINGS.maxUploadSizeMb,
    allowedInputMime: normalizeAllowedMime(input.allowedInputMime),
  }
}

/**
 * 归一化直链路径前缀：去空白与首尾斜杠。
 *
 * ⚠️ **空串是合法结果**，表示「直接挂在根路径」而非缺省值 —— 调用方不要用
 * 真值判断（`raw || fallback`）来兜底，否则「留空 = 根路径」会被悄悄吞掉。
 */
export function normalizeFilesPathPrefix(raw: string): string {
  return (raw ?? '').trim().replace(/^\/+|\/+$/g, '')
}

/**
 * 归一化允许上传的 MIME 白名单：
 * - 非数组（旧库缺字段）→ 回落到「全部允许」
 * - 数组 → 只保留已知类型并去重；**空数组是合法值**，表示禁止任何上传
 */
export function normalizeAllowedMime(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ALLOWED_INPUT_MIME]
  const known = new Set<string>(ALLOWED_INPUT_MIME)
  return [...new Set(raw.filter((item): item is string => typeof item === 'string' && known.has(item)))]
}

/**
 * 深合并 PATCH。
 * `backends` 若传入则整体替换；其中密钥字段等于占位符时沿用旧值。
 */
export function mergeGlobalSettings(
  current: GlobalSettings,
  patch: Partial<GlobalSettings>,
): GlobalSettings {
  const next: GlobalSettings = {
    ...current,
    processing: mergeProcessing(current.processing, patch.processing),
  }

  if (patch.namingTemplate !== undefined) next.namingTemplate = patch.namingTemplate.trim()
  if (patch.galleryVisibility !== undefined) next.galleryVisibility = patch.galleryVisibility
  if (patch.publicBaseUrl !== undefined) next.publicBaseUrl = patch.publicBaseUrl.replace(/\/+$/, '')
  if (patch.filesPathPrefix !== undefined) {
    next.filesPathPrefix = normalizeFilesPathPrefix(patch.filesPathPrefix)
  }
  if (patch.maxUploadSizeMb !== undefined) next.maxUploadSizeMb = patch.maxUploadSizeMb
  if (patch.allowedInputMime !== undefined) next.allowedInputMime = normalizeAllowedMime(patch.allowedInputMime)

  if (patch.backends !== undefined) {
    const oldById = new Map(current.backends.map((b) => [b.id, b]))
    next.backends = patch.backends.map((incoming) => {
      const normalized = normalizeBackend(incoming as BackendConfig)
      const old = oldById.get(normalized.id)
      if (normalized.type === 's3') {
        const prev = old?.type === 's3' ? (old as S3BackendConfig) : undefined
        if (normalized.secretAccessKey === SECRET_PLACEHOLDER || normalized.secretAccessKey === '') {
          normalized.secretAccessKey = prev?.secretAccessKey ?? ''
        }
      }
      if (normalized.type === 'webdav') {
        const prev = old?.type === 'webdav' ? (old as WebdavBackendConfig) : undefined
        if (normalized.password === SECRET_PLACEHOLDER || normalized.password === '') {
          normalized.password = prev?.password ?? ''
        }
      }
      return normalized
    })
  }

  // 兜底：至少保留一个本地后端，避免系统不可用
  if (next.backends.length === 0) next.backends = [{ ...DEFAULT_LOCAL_BACKEND }]

  const enabledIds = next.backends.filter((b) => b.enabled).map((b) => b.id)
  const requested =
    patch.defaultBackends !== undefined ? patch.defaultBackends : next.defaultBackends
  const filtered = requested.filter((id) => enabledIds.includes(id))
  next.defaultBackends = filtered.length > 0 ? filtered : enabledIds.slice(0, 1)

  return next
}

/** 返回给管理员的配置：真实密钥替换为占位符 */
export function maskGlobalSettings(settings: GlobalSettings): GlobalSettings {
  return {
    ...settings,
    backends: settings.backends.map((b) => {
      if (b.type === 's3') {
        return { ...b, secretAccessKey: b.secretAccessKey ? SECRET_PLACEHOLDER : '' }
      }
      if (b.type === 'webdav') {
        return { ...b, password: b.password ? SECRET_PLACEHOLDER : '' }
      }
      return { ...b }
    }),
  }
}

/**
 * 表单提交的后端配置：若密钥为占位符或空串，则沿用已保存的真实密钥。
 * 用于「测试连接」等只需校验连通性的场景。
 */
export function mergeBackendSecrets(
  incoming: BackendConfig,
  current: GlobalSettings,
): BackendConfig {
  const normalized = normalizeBackend(incoming)
  const old = current.backends.find((b) => b.id === normalized.id)

  if (normalized.type === 's3') {
    const prev = old?.type === 's3' ? (old as S3BackendConfig) : undefined
    if (normalized.secretAccessKey === SECRET_PLACEHOLDER || normalized.secretAccessKey === '') {
      normalized.secretAccessKey = prev?.secretAccessKey ?? ''
    }
  }

  if (normalized.type === 'webdav') {
    const prev = old?.type === 'webdav' ? (old as WebdavBackendConfig) : undefined
    if (normalized.password === SECRET_PLACEHOLDER || normalized.password === '') {
      normalized.password = prev?.password ?? ''
    }
  }

  return normalized
}

/** 合并用户偏好 */
export function mergePreferences(
  base: UserPreferences,
  patch?: Partial<UserPreferences> | null,
): UserPreferences {
  if (!patch) return { ...base }
  return {
    defaultCopyFormat: patch.defaultCopyFormat ?? base.defaultCopyFormat,
    autoCopy: patch.autoCopy ?? base.autoCopy,
    theme: patch.theme ?? base.theme,
    fontSansZh: patch.fontSansZh ?? base.fontSansZh,
    fontSansEn: patch.fontSansEn ?? base.fontSansEn,
    // 数组整体替换而非合并：用户取消勾选某个后端时必须真的少一项，
    // 合并会让「取消」这个动作永远无法生效。空数组是合法值（= 未设置，回退全局默认）。
    uploadBackends: patch.uploadBackends ?? base.uploadBackends,
    uploadFormats: patch.uploadFormats ?? base.uploadFormats,
    // ⚠️ 这里**不能用 `??`**：`null` 是「重置为未设置」的真实取值，
    // 而 `??` 会把 null 当成空值回退到 base，导致「恢复默认」永远无法生效。
    uploadKeepOriginal:
      patch.uploadKeepOriginal !== undefined ? patch.uploadKeepOriginal : base.uploadKeepOriginal,
  }
}
