import { z } from 'zod'
import { ALLOWED_INPUT_MIME, OUTPUT_FORMATS, SESSION_DAY_OPTIONS } from './constants.js'

/* ------------------------------------------------------------------ */
/* 基础片段                                                             */
/* ------------------------------------------------------------------ */

export const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[A-Za-z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和连字符')

export const passwordSchema = z
  .string()
  .min(8, '密码至少 8 个字符')
  .max(128, '密码最多 128 个字符')

export const roleSchema = z.enum(['admin', 'member'])
export const copyFormatSchema = z.enum(['direct', 'markdown', 'html', 'bbcode'])
export const themeSchema = z.enum(['light', 'dark', 'system'])
export const outputFormatSchema = z.enum(['jpeg', 'png', 'webp', 'avif', 'gif'])
export const storageBackendSchema = z.enum(['local', 's3', 'webdav'])
export const galleryVisibilitySchema = z.enum(['shared', 'private'])

/* ------------------------------------------------------------------ */
/* 认证                                                                 */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(64),
  password: z.string().min(1, '请输入密码').max(128),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(128),
  newPassword: passwordSchema,
})

/* ------------------------------------------------------------------ */
/* 用户管理（管理员）                                                   */
/* ------------------------------------------------------------------ */

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: roleSchema.default('member'),
})

export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    role: roleSchema.optional(),
    disabled: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的字段' })

/** 头像地址：支持 http(s) 外链、站内路径（本图库图片），空串表示恢复默认占位 */
export const avatarUrlSchema = z
  .string()
  .trim()
  .max(500, '头像地址最多 500 个字符')
  .refine(
    (v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('/'),
    '头像需为 http(s) 链接或站内路径，留空则恢复默认',
  )

/* ------------------------------------------------------------------ */
/* 个人资料（任何登录用户修改自己）                                     */
/* ------------------------------------------------------------------ */

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    avatarUrl: avatarUrlSchema.optional(),
    /** 会话有效期（天），只开放 SESSION_DAY_OPTIONS 里的档位 */
    sessionDays: z
      .number()
      .int()
      .refine((v) => (SESSION_DAY_OPTIONS as readonly number[]).includes(v), {
        message: `会话有效期只能是 ${SESSION_DAY_OPTIONS.join(' / ')} 天`,
      })
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的字段' })

/* ------------------------------------------------------------------ */
/* 个人偏好                                                             */
/* ------------------------------------------------------------------ */

/** 字体栈：允许引号（字体名含空格时需要），但不允许能拼出额外 CSS 声明的字符 */
export const fontFamilySchema = z
  .string()
  .trim()
  .max(200, '字体栈最多 200 个字符')
  .refine((v) => !/[;{}<>]/.test(v), '字体栈不能包含 ; { } < > 字符')

export const preferencesSchema = z.object({
  defaultCopyFormat: copyFormatSchema.optional(),
  autoCopy: z.boolean().optional(),
  theme: themeSchema.optional(),
  fontSansZh: fontFamilySchema.optional(),
  fontSansEn: fontFamilySchema.optional(),
})

/* ------------------------------------------------------------------ */
/* 图片处理设置                                                         */
/* ------------------------------------------------------------------ */

export const processingSettingsSchema = z.object({
  qualityJpeg: z.number().int().min(1).max(100).optional(),
  qualityWebp: z.number().int().min(1).max(100).optional(),
  qualityAvif: z.number().int().min(1).max(100).optional(),
  qualityPng: z.number().int().min(0).max(9).optional(),
  qualityGif: z.number().int().min(1).max(10).optional(),
  maxWidth: z.number().int().min(64).max(20000).optional(),
  maxHeight: z.number().int().min(64).max(20000).optional(),
  outputFormats: z.array(outputFormatSchema).min(1, '至少选择一种输出格式').max(5).optional(),
  keepOriginal: z.boolean().optional(),
  stripExif: z.boolean().optional(),
})

/* ------------------------------------------------------------------ */
/* 存储后端                                                             */
/* ------------------------------------------------------------------ */

const backendBase = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, '后端 id 只能包含小写字母、数字、下划线和连字符'),
  name: z.string().trim().min(1, '请填写后端名称').max(60),
  enabled: z.boolean(),
  publicBaseUrl: z.string().trim().max(300),
  pathPrefix: z.string().trim().max(200),
}

export const localBackendSchema = z.object({
  ...backendBase,
  type: z.literal('local'),
  directory: z.string().trim().max(500),
})

export const s3BackendSchema = z.object({
  ...backendBase,
  type: z.literal('s3'),
  endpoint: z.string().trim().max(300),
  region: z.string().trim().max(60),
  bucket: z.string().trim().min(1, '请填写 Bucket').max(120),
  accessKeyId: z.string().trim().max(200),
  secretAccessKey: z.string().max(400),
  forcePathStyle: z.boolean(),
})

export const webdavBackendSchema = z.object({
  ...backendBase,
  type: z.literal('webdav'),
  url: z.string().trim().min(1, '请填写 WebDAV 地址').max(400),
  username: z.string().trim().max(200),
  password: z.string().max(400),
  directory: z.string().trim().max(300),
})

export const backendConfigSchema = z.discriminatedUnion('type', [
  localBackendSchema,
  s3BackendSchema,
  webdavBackendSchema,
])

/* ------------------------------------------------------------------ */
/* 全局设置 PATCH（全部可选，服务端做深合并）                            */
/* ------------------------------------------------------------------ */

export const globalSettingsPatchSchema = z.object({
  namingTemplate: z.string().trim().min(1, '命名模板不能为空').max(200),
  processing: processingSettingsSchema,
  galleryVisibility: galleryVisibilitySchema,
  publicBaseUrl: z.string().trim().max(300),
  // 允许空串（= 挂在根路径）；不允许空格与 ? # 等会破坏 URL 解析的字符
  filesPathPrefix: z
    .string()
    .trim()
    .max(120)
    .regex(/^[A-Za-z0-9._~\-/]*$/, '前缀只能包含字母、数字与 - _ . ~ / 等 URL 路径字符'),
  backends: z.array(backendConfigSchema).max(20),
  defaultBackends: z.array(z.string()).max(20),
  maxUploadSizeMb: z.number().int().min(1).max(500),
  allowedInputMime: z.array(z.enum(ALLOWED_INPUT_MIME)).max(20),
}).partial()

/* ------------------------------------------------------------------ */
/* 图片                                                                 */
/* ------------------------------------------------------------------ */

export const imagePatchSchema = z
  .object({
    /** 重命名（不含扩展名，服务端保留格式后缀） */
    filename: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^<>:"|?*\\/]+$/, '文件名包含非法字符')
      .optional(),
    /** 目标后端 id 列表：用于「重试同步 / 补充同步」 */
    backends: z.array(z.string()).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '没有需要更新的字段' })

export const imageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  q: z.string().trim().max(120).optional(),
  format: z.union([outputFormatSchema, z.literal('original')]).optional(),
  backend: storageBackendSchema.optional(),
  userId: z.string().max(64).optional(),
  status: z.enum(['pending', 'ready', 'failed']).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  sort: z.enum(['createdAt', 'size', 'name']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export type ImageListQuery = z.infer<typeof imageListQuerySchema>

/* ------------------------------------------------------------------ */
/* 上传（multipart 附带字段）                                            */
/* ------------------------------------------------------------------ */

const csvToArray = (value: unknown): string[] | undefined => {
  if (value == null) return undefined
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  const str = String(value).trim()
  if (!str) return undefined
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const uploadOptionsSchema = z.object({
  formats: z
    .preprocess(
      csvToArray,
      z.array(outputFormatSchema).min(1).max(5).optional(),
    )
    .optional(),
  backends: z.preprocess(csvToArray, z.array(z.string()).min(1).max(20).optional()),
  keepOriginal: z
    .preprocess((v) => (v == null || v === '' ? undefined : v === 'true' || v === true), z.boolean().optional())
    .optional(),
})

/* ------------------------------------------------------------------ */
/* P3-1 秒传预检                                                        */
/* ------------------------------------------------------------------ */

export const sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, 'hash 必须是 SHA-256 十六进制字符串')

/**
 * 秒传预检请求体。
 *
 * 客户端在本地算出原图 SHA-256 后先问一次服务端：命中则完全跳过文件传输。
 * `size` 用于在传输前就把「超出单文件上限」拒掉，避免白传一次。
 */
export const uploadCheckSchema = z.object({
  hash: sha256Schema,
  size: z
    .number()
    .int()
    .min(1, '文件内容为空')
    .max(2 * 1024 * 1024 * 1024)
    .optional(),
  formats: z.array(outputFormatSchema).min(1).max(5).optional(),
  backends: z.array(z.string().min(1)).max(20).optional(),
  keepOriginal: z.boolean().optional(),
})

/* ------------------------------------------------------------------ */
/* P3-2 API Token                                                       */
/* ------------------------------------------------------------------ */

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, '请填写用途备注').max(60, '备注最多 60 个字符'),
  /**
   * 有效期天数。不传 / 传 0 表示永不过期。
   * 图床常被脚本长期调用，默认给「永不过期 + 可随时撤销」。
   */
  expiresInDays: z.number().int().min(0).max(3650).optional(),
})

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>

/* ------------------------------------------------------------------ */
/* P3-3 访问统计查询                                                     */
/* ------------------------------------------------------------------ */

export const statsQuerySchema = z.object({
  /** 趋势窗口天数 */
  days: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * `auto`：admin 看全局、member 看自己；
   * `global`：强制全局（仅 admin，member 传了会被拒）；
   * `self`：只看自己。
   */
  scope: z.enum(['auto', 'global', 'self']).default('auto'),
})

export type StatsQuery = z.infer<typeof statsQuerySchema>
