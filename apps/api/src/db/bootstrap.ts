import { randomUUID } from 'node:crypto'
import { env, ensureRuntimeDirs, paths } from '../env'
import { hashPassword } from '../lib/crypto'
import { DEFAULT_GLOBAL_SETTINGS, normalizeGlobalSettings } from '@glimmer/shared'
import { sqlite } from './index'

/**
 * 幂等建表 DDL。
 *
 * 与设计文档保持一致，另做若干工程化调整（已在 README 说明）：
 *  1. 时间戳统一使用 ISO-8601 UTC 文本（`2026-09-16T04:37:21.112Z`），
 *     避免 SQLite 默认 `CURRENT_TIMESTAMP` 产出无时区标识、易被误解析的格式；
 *  2. `images` 增加 `error_message` 列，用于在图库中展示处理失败原因；
 *  3. P3 新增：`images.content_hash` / `dedup_key`（秒传去重）、
 *     `images.retry_attempts` / `next_retry_at` 与 `storage_records.attempt_count` /
 *     `last_attempt_at` / `next_retry_at`（失败自动重试）；
 *  4. P3 新增表：`api_tokens`、`image_stats`、`access_daily`。
 *
 * 既有数据库由 `applyLightMigrations()` 通过 `ALTER TABLE ADD COLUMN` 补齐新列。
 */
const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  disabled      INTEGER NOT NULL DEFAULT 0,
  avatar_url    TEXT,
  session_days  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS images (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  original_name  TEXT,
  filename       TEXT NOT NULL,
  mime_type      TEXT,
  width          INTEGER,
  height         INTEGER,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  -- P3-1 秒传去重：原图字节的 SHA-256，以及「内容 + 上传/处理配置」的指纹
  content_hash   TEXT,
  dedup_key      TEXT,
  -- P3-4 失败自动重试
  retry_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS image_variants (
  id           TEXT PRIMARY KEY,
  image_id     TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  format       TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size         INTEGER,
  width        INTEGER,
  height       INTEGER,
  md5          TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS storage_records (
  id              TEXT PRIMARY KEY,
  variant_id      TEXT NOT NULL REFERENCES image_variants(id) ON DELETE CASCADE,
  backend         TEXT NOT NULL,
  path            TEXT NOT NULL,
  url             TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  -- P3-4 失败自动重试
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_retry_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- P3-2 API Token：只存哈希，明文仅在创建时返回一次
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  last_used_at TEXT,
  expires_at   TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- P3-3 访问统计：单图累计值
CREATE TABLE IF NOT EXISTS image_stats (
  image_id       TEXT PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  views          INTEGER NOT NULL DEFAULT 0,
  bytes_served   INTEGER NOT NULL DEFAULT 0,
  last_access_at TEXT
);

-- P3-3 访问统计：按 UTC 天聚合，增长有界（图片数 × 天数）
CREATE TABLE IF NOT EXISTS access_daily (
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,
  views    INTEGER NOT NULL DEFAULT 0,
  bytes    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (image_id, day)
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
CREATE INDEX IF NOT EXISTS idx_images_status ON images(status);
CREATE INDEX IF NOT EXISTS idx_variants_image_id ON image_variants(image_id);
CREATE INDEX IF NOT EXISTS idx_variants_format ON image_variants(format);
CREATE INDEX IF NOT EXISTS idx_storage_records_variant_id ON storage_records(variant_id);
CREATE INDEX IF NOT EXISTS idx_storage_records_backend ON storage_records(backend);
CREATE INDEX IF NOT EXISTS idx_storage_records_status ON storage_records(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_access_daily_day ON access_daily(day);
`

/**
 * 依赖 P3 新增列的索引。
 *
 * 必须与 DDL 分开：既有库上 `images` / `storage_records` 需要先
 * `ALTER TABLE ADD COLUMN` 补列，若把它们写进上面的 DDL，SQLite 会
 * 在建索引时报 `no such column: dedup_key` 并导致整个迁移回滚。
 */
const DDL_DEPENDENT_INDEXES = /* sql */ `
CREATE INDEX IF NOT EXISTS idx_images_dedup ON images(user_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_images_retry ON images(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_storage_records_retry ON storage_records(status, next_retry_at);
`

function tableExists(name: string): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name: string } | undefined
  return Boolean(row)
}

/** 取某张表当前已有的列名集合 */
function columnNames(table: string): Set<string> {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(cols.map((c) => c.name))
}

/**
 * 兼容既有数据库的轻量迁移。
 *
 * `CREATE TABLE IF NOT EXISTS` 不会给已存在的表补列，因此新增字段必须在这里
 * 用 `ALTER TABLE ADD COLUMN` 逐个补齐。整个过程幂等，可重复执行。
 */
function applyLightMigrations(): void {
  const addColumn = (table: string, column: string, definition: string): void => {
    if (!tableExists(table)) return
    if (columnNames(table).has(column)) return
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  // 早期版本：处理失败原因
  addColumn('images', 'error_message', 'TEXT')

  // P3-1 秒传去重
  addColumn('images', 'content_hash', 'TEXT')
  addColumn('images', 'dedup_key', 'TEXT')

  // P3-4 失败自动重试
  addColumn('images', 'retry_attempts', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('images', 'next_retry_at', 'TEXT')
  addColumn('storage_records', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('storage_records', 'last_attempt_at', 'TEXT')
  addColumn('storage_records', 'next_retry_at', 'TEXT')

  // 个人资料：头像地址（外部 URL 或本图库图片直链）
  addColumn('users', 'avatar_url', 'TEXT')
  // 会话有效期（天）：NULL 表示跟随服务端默认值 SESSION_TTL_DAYS
  addColumn('users', 'session_days', 'INTEGER')

  // 补列完成后再建依赖新列的索引（否则既有库会因缺列报错并回滚）
  sqlite.exec(DDL_DEPENDENT_INDEXES)
}

export interface BootstrapResult {
  createdAdmin: boolean
  adminUsername: string
  /**
   * 数据库里已有账号，但环境变量里仍显式设置了 ADMIN_PASSWORD。
   *
   * 该变量**只在首次启动、users 表为空时**用于创建管理员；密码哈希一旦落库，
   * 之后再改它不会有任何效果。这是最常见的一类困惑——「我在 .env 里换了密码，
   * 怎么还提示用户名或密码不正确」——所以这里显式报出来，由调用方提示改用
   * `cli/reset-password` 重置，而不是让用户对着一个被静默忽略的变量反复试。
   */
  ignoredAdminPassword: boolean
}

/**
 * 建表 + 写入默认设置 + 首次启动创建管理员账号。
 * 整个过程幂等，可安全地在每次启动时调用。
 */
export async function bootstrap(): Promise<BootstrapResult> {
  ensureRuntimeDirs()

  sqlite.exec('BEGIN')
  try {
    sqlite.exec(DDL)
    applyLightMigrations()
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }

  // 默认全局设置
  const existing = sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get('global') as
    | { value: string }
    | undefined

  if (!existing) {
    const initial = normalizeGlobalSettings({
      ...DEFAULT_GLOBAL_SETTINGS,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
    })
    sqlite
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run('global', JSON.stringify(initial), new Date().toISOString())
  }

  // 首次启动创建管理员
  const userCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }
  if (userCount.n === 0) {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD)
    const now = new Date().toISOString()
    sqlite
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, disabled, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', 0, ?, ?)`,
      )
      .run(randomUUID(), env.ADMIN_USERNAME, passwordHash, now, now)
    return { createdAdmin: true, adminUsername: env.ADMIN_USERNAME, ignoredAdminPassword: false }
  }

  // 清理过期会话
  sqlite.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(new Date().toISOString())

  return {
    createdAdmin: false,
    adminUsername: env.ADMIN_USERNAME,
    // 判据用 process.env 而非 env.ADMIN_PASSWORD：默认值 change-me 不算「用户设置过」，
    // 否则每个没建 .env 的部署都会在每次重启时收到这条提示。
    ignoredAdminPassword: Boolean(process.env.ADMIN_PASSWORD),
  }
}

export { paths }
