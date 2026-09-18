import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

/**
 * 按「就近优先」顺序加载 .env：
 * apps/api/.env（包内） > 仓库根 .env
 * dotenv 不会覆盖已存在的 process.env，因此先加载者优先。
 */
function loadEnvFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(process.cwd(), '../../.env'),
  ]
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) loadDotenv({ path: file })
    } catch {
      /* 忽略无法读取的 env 文件 */
    }
  }
}

loadEnvFiles()

const RAW_NODE_ENV = process.env.NODE_ENV ?? 'development'

/* ------------------------------------------------------------------ */
/* 加密密钥：未提供时自动生成并落盘                                       */
/* ------------------------------------------------------------------ */

/** 密钥文件与 SQLite 数据库同目录 —— 备份数据目录即可把密钥一起带走 */
function resolveDataDir(): string {
  const raw = process.env.DATABASE_URL ?? './data/glimmer.db'
  const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  return path.dirname(abs)
}

const SECRETS_FILE_NAME = '.secrets.json'

function readPersistedKey(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    const key = (parsed as { encryptionKey?: unknown } | null)?.encryptionKey
    return typeof key === 'string' && key.length >= 8 ? key : null
  } catch {
    return null
  }
}

/**
 * 确保 `process.env.ENCRYPTION_KEY` 有值，没有就现场生成一个并持久化。
 *
 * ⚠️ 必须在 EnvSchema 解析**之前**执行：`lib/crypto.ts` 是在**模块顶层**读取
 * `env.ENCRYPTION_KEY` 的，若把这段逻辑放到启动脚本里后置处理，加密模块拿到的
 * 仍是解析前的旧值。
 *
 * 为什么必须落盘：该密钥用于解密后台保存的存储后端凭据（S3 的 secretAccessKey、
 * WebDAV 的 password）。若每次启动都换新值，这些凭据将永久解不回来。
 *
 * 优先级：环境变量（含 .env） > 已落盘的文件 > 现场生成。
 * 想自行管理密钥就设置 `ENCRYPTION_KEY` 环境变量，其优先级最高。
 */
function ensureEncryptionKey(): void {
  if (process.env.ENCRYPTION_KEY) return

  // 测试环境用固定值且不落盘：既不污染工作目录，结果也可复现
  if (RAW_NODE_ENV === 'test') {
    process.env.ENCRYPTION_KEY = 'glimmer-test-encryption-key-0123456789'
    return
  }

  const dir = resolveDataDir()
  const file = path.join(dir, SECRETS_FILE_NAME)

  const persisted = readPersistedKey(file)
  if (persisted) {
    process.env.ENCRYPTION_KEY = persisted
    return
  }

  const key = randomBytes(32).toString('base64url')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ encryptionKey: key }, null, 2)}\n`, { mode: 0o600 })
    // eslint-disable-next-line no-console
    console.warn(
      '[glimmer] 未设置 ENCRYPTION_KEY，已自动生成并保存到：\n' +
        `    ${file}\n` +
        '  该文件用于解密后台保存的存储后端凭据（S3 / WebDAV），请随数据目录一起备份；\n' +
        '  删除它会导致这些凭据无法解密，届时需重新填写。',
    )
  } catch (err) {
    // 落盘失败不阻断启动，但必须显式告警：本次进程内的密钥重启后就没了
    // eslint-disable-next-line no-console
    console.warn(
      `[glimmer] 无法写入密钥文件 ${file}，本次启动改用临时密钥（重启后失效）：${String(err)}`,
    )
  }
  process.env.ENCRYPTION_KEY = key
}

ensureEncryptionKey()

/** `1/true/yes/on` 视为 true */
const boolish = (fallback: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return fallback
    if (typeof v === 'boolean') return v
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
  }, z.boolean())

/**
 * `PUBLIC_BASE_URL` 的内置默认值。
 *
 * 单独导出是给 bootstrap 的迁移用的：早期版本会把「当时的 env 值」写进数据库，
 * 没人配置时写进去的就是这个常量，迁移需要凭它区分「当年写进去的默认值」与
 * 「管理员真的填了 localhost:3000」。详见 `db/bootstrap.ts`。
 */
export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:3000'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  DATABASE_URL: z.string().default('./data/glimmer.db'),
  LOCAL_STORAGE_DIR: z.string().default('./data/uploads'),
  TEMP_DIR: z.string().default('./data/tmp'),

  /**
   * 敏感配置加密主密钥（AES-256-GCM，见 lib/crypto.ts）。
   *
   * 无需手工配置：未提供时会自动生成并落盘（见上方 `ensureEncryptionKey()`）。
   * 这里刻意**不给默认值** —— 一旦有人塞进一个公开的固定兜底值，加密就形同虚设，
   * 宁可让配置错误在启动时显式报出来。
   */
  ENCRYPTION_KEY: z.string().min(8),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  SESSION_COOKIE_NAME: z.string().min(1).default('glimmer_session'),
  COOKIE_SECURE: boolish(RAW_NODE_ENV === 'production'),

  ADMIN_USERNAME: z.string().min(3).max(32).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('change-me'),

  /**
   * 是否信任反向代理传来的 `X-Forwarded-For` / `X-Real-IP`（登录限流据此取真实客户端 IP）。
   *
   * 生产默认开：本项目推荐 Nginx 反代，API 只在容器内网可达，请求头由 Nginx 覆写。
   * ⚠️ 若把 API 端口直接暴露在公网，**必须设为 false**，
   * 否则攻击者伪造该头即可绕过按 IP 的登录限流。
   */
  TRUST_PROXY: boolish(RAW_NODE_ENV === 'production'),

  /* --- 登录 / 改密限流（只统计失败次数，见 lib/rate-limit.ts） --- */
  /** 同一来源 IP 在窗口内允许的失败次数 */
  AUTH_RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().min(1).max(100000).default(20),
  /** 同一账号在窗口内允许的失败次数（键里不含 IP，故默认更严） */
  AUTH_RATE_LIMIT_MAX_PER_ACCOUNT: z.coerce.number().int().min(1).max(100000).default(5),
  /** 限流窗口长度（秒） */
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),

  PUBLIC_BASE_URL: z.string().default(DEFAULT_PUBLIC_BASE_URL),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(500).default(20),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
})

/*
 * 关于 `SESSION_SECRET`：本项目**没有**这个配置项。
 *
 * 会话 cookie 里放的是 32 字节随机 token，数据库只存它的 SHA-256 哈希
 * （见 lib/session.ts），校验靠「算哈希查表」而非 HMAC 签名，因此不存在
 * 「签名密钥」这一环。历史上曾有一个同名环境变量，但它没有任何调用点，
 * 已删除 —— 若你的 .env 里还留着它，删除即可，留着也会被忽略。
 */

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  // eslint-disable-next-line no-console
  console.error(`[glimmer] 环境变量校验失败：\n${issues}`)
  process.exit(1)
}

export const env = parsed.data

export const isDev = env.NODE_ENV === 'development'
/** 解析为绝对路径 */
function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

export const paths = {
  /** SQLite 数据库文件 */
  database: resolvePath(env.DATABASE_URL),
  /** 本地存储根目录 */
  uploads: resolvePath(env.LOCAL_STORAGE_DIR),
  /** 上传临时目录 */
  temp: resolvePath(env.TEMP_DIR),
} as const

/** 启动时保证运行所需目录存在 */
export function ensureRuntimeDirs(): void {
  for (const dir of [path.dirname(paths.database), paths.uploads, paths.temp]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 生产环境下的弱密钥告警（不阻断启动） */
export function warnWeakSecrets(): void {
  const weak: string[] = []
  if (env.ENCRYPTION_KEY.length < 24) weak.push('ENCRYPTION_KEY 过短（建议 >= 32 字符）')
  if (env.ADMIN_PASSWORD === 'change-me') weak.push('ADMIN_PASSWORD 仍为默认值 change-me')
  if (weak.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[glimmer] 安全提示：\n${weak.map((w) => `  - ${w}`).join('\n')}`)
  }
}
