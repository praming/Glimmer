import fs from 'node:fs'
import path from 'node:path'
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

/** `1/true/yes/on` 视为 true */
const boolish = (fallback: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return fallback
    if (typeof v === 'boolean') return v
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())
  }, z.boolean())

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  DATABASE_URL: z.string().default('./data/glimmer.db'),
  LOCAL_STORAGE_DIR: z.string().default('./data/uploads'),
  TEMP_DIR: z.string().default('./data/tmp'),

  SESSION_SECRET: z.string().min(8).default('glimmer-dev-session-secret-please-change'),
  ENCRYPTION_KEY: z.string().min(8).default('glimmer-dev-encryption-key-please-change'),
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

  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(500).default(20),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
})

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
  if (env.SESSION_SECRET.length < 24) weak.push('SESSION_SECRET 过短（建议 >= 32 字符）')
  if (env.ENCRYPTION_KEY.length < 24) weak.push('ENCRYPTION_KEY 过短（建议 >= 32 字符）')
  if (env.ADMIN_PASSWORD === 'change-me') weak.push('ADMIN_PASSWORD 仍为默认值 change-me')
  if (weak.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[glimmer] 安全提示：\n${weak.map((w) => `  - ${w}`).join('\n')}`)
  }
}
