import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** ISO-8601 UTC 时间戳默认值，如 2026-09-16T04:37:21.112Z */
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    /** 头像地址：外部 URL 或本图库图片直链 */
    avatarUrl: text('avatar_url'),
    /** 会话有效期（天）；NULL 表示跟随服务端默认值 SESSION_TTL_DAYS */
    sessionDays: integer('session_days'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at'),
  },
  (t) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(t.username),
  }),
)

/* ------------------------------------------------------------------ */
/* sessions                                                            */
/* ------------------------------------------------------------------ */

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    userIdx: index('idx_sessions_user_id').on(t.userId),
  }),
)

/* ------------------------------------------------------------------ */
/* images                                                              */
/* ------------------------------------------------------------------ */

export const images = sqliteTable(
  'images',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    originalName: text('original_name'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    width: integer('width'),
    height: integer('height'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    /** P3-1：原图字节的 SHA-256（十六进制），用于跨文件名识别同内容 */
    contentHash: text('content_hash'),
    /** P3-1：内容 + 上传/处理配置 的指纹；同用户同指纹可直接秒传 */
    dedupKey: text('dedup_key'),
    /** P3-4：已自动重试次数 */
    retryAttempts: integer('retry_attempts').notNull().default(0),
    /** P3-4：下次自动重试时间（ISO-8601），null 表示不再重试 */
    nextRetryAt: text('next_retry_at'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at'),
  },
  (t) => ({
    userIdx: index('idx_images_user_id').on(t.userId),
    createdAtIdx: index('idx_images_created_at').on(t.createdAt),
    statusIdx: index('idx_images_status').on(t.status),
    dedupIdx: index('idx_images_dedup').on(t.userId, t.dedupKey),
    retryIdx: index('idx_images_retry').on(t.status, t.nextRetryAt),
  }),
)

/* ------------------------------------------------------------------ */
/* image_variants                                                      */
/* ------------------------------------------------------------------ */

export const imageVariants = sqliteTable(
  'image_variants',
  {
    id: text('id').primaryKey(),
    imageId: text('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    format: text('format', {
      enum: ['original', 'jpeg', 'png', 'webp', 'avif', 'gif'],
    }).notNull(),
    /** 相对于存储后端根目录 / 对象键前缀的相对路径 */
    storagePath: text('storage_path').notNull(),
    size: integer('size'),
    width: integer('width'),
    height: integer('height'),
    md5: text('md5'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    imageIdx: index('idx_variants_image_id').on(t.imageId),
    formatIdx: index('idx_variants_format').on(t.format),
  }),
)

/* ------------------------------------------------------------------ */
/* storage_records                                                     */
/* ------------------------------------------------------------------ */

export const storageRecords = sqliteTable(
  'storage_records',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => imageVariants.id, { onDelete: 'cascade' }),
    /** 存储后端配置 id（如 local / s3-r2 / webdav-jianguo） */
    backend: text('backend').notNull(),
    /** 含后端 pathPrefix 的完整存储路径 */
    path: text('path').notNull(),
    url: text('url'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    /** P3-4：该后端已尝试次数（含手动重试） */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** P3-4：最后一次尝试时间 */
    lastAttemptAt: text('last_attempt_at'),
    /** P3-4：下次自动重试时间；null 表示不再重试 */
    nextRetryAt: text('next_retry_at'),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    variantIdx: index('idx_storage_records_variant_id').on(t.variantId),
    backendIdx: index('idx_storage_records_backend').on(t.backend),
    statusIdx: index('idx_storage_records_status').on(t.status),
    retryIdx: index('idx_storage_records_retry').on(t.status, t.nextRetryAt),
  }),
)

/* ------------------------------------------------------------------ */
/* api_tokens（P3-2 API Token）                                         */
/* ------------------------------------------------------------------ */

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 用户起的备注名，便于识别用途 */
    name: text('name').notNull(),
    /** 只存 SHA-256 哈希，明文仅在创建时返回一次 */
    tokenHash: text('token_hash').notNull(),
    /** 明文前若干位，用于在列表里区分不同 token */
    prefix: text('prefix').notNull(),
    lastUsedAt: text('last_used_at'),
    /** null 表示永不过期 */
    expiresAt: text('expires_at'),
    /** 软撤销时间；null 表示有效（保留记录以便审计） */
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex('api_tokens_token_hash_unique').on(t.tokenHash),
    userIdx: index('idx_api_tokens_user_id').on(t.userId),
  }),
)

/* ------------------------------------------------------------------ */
/* image_stats / access_daily（P3-3 访问统计）                          */
/* ------------------------------------------------------------------ */

export const imageStats = sqliteTable('image_stats', {
  imageId: text('image_id')
    .primaryKey()
    .references(() => images.id, { onDelete: 'cascade' }),
  views: integer('views').notNull().default(0),
  bytesServed: integer('bytes_served').notNull().default(0),
  lastAccessAt: text('last_access_at'),
})

export const accessDaily = sqliteTable(
  'access_daily',
  {
    imageId: text('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    /** UTC 日期，格式 YYYY-MM-DD */
    day: text('day').notNull(),
    views: integer('views').notNull().default(0),
    bytes: integer('bytes').notNull().default(0),
  },
  (t) => ({
    pk: uniqueIndex('access_daily_pk').on(t.imageId, t.day),
    dayIdx: index('idx_access_daily_day').on(t.day),
  }),
)

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at'),
})

/* ------------------------------------------------------------------ */
/* 类型导出                                                            */
/* ------------------------------------------------------------------ */

export type UserRow = typeof users.$inferSelect
export type ImageRow = typeof images.$inferSelect
export type ImageVariantRow = typeof imageVariants.$inferSelect
export type StorageRecordRow = typeof storageRecords.$inferSelect
export type ApiTokenRow = typeof apiTokens.$inferSelect
