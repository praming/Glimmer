import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { ZodError } from 'zod'
import { env, isDev } from './env'
import type { AppEnv } from './lib/context'
import { HttpError } from './lib/errors'
import { authRoutes } from './routes/auth'
import { fileRoutes } from './routes/files'
import { imageRoutes } from './routes/images'
import { meRoutes, settingsRoutes } from './routes/settings'
import { statsRoutes } from './routes/stats'
import { uploadRoutes } from './routes/upload'
import { userRoutes } from './routes/users'
import { getQueueStats } from './services/queue'
// 版本号唯一来源：仓库根 package.json（esbuild 会内联，运行时不读文件）
import pkg from '../../../package.json'

export function createApp(): Hono<AppEnv> {
  /* ------------------------------ API 路由 ------------------------------ */
  const api = new Hono<AppEnv>()

  api.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'glimmer-api',
      version: pkg.version,
      time: new Date().toISOString(),
      queue: getQueueStats(),
    }),
  )

  api.route('/auth', authRoutes)
  api.route('/users', userRoutes)
  api.route('/upload', uploadRoutes)
  api.route('/images', imageRoutes)
  api.route('/settings', settingsRoutes)
  api.route('/me', meRoutes)
  api.route('/stats', statsRoutes)

  /* ------------------------------ 应用装配 ------------------------------ */
  const app = new Hono<AppEnv>()

  app.use('*', logger())

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: isDev
        ? undefined
        : {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"],
          },
      xFrameOptions: false,
      crossOriginResourcePolicy: false,
    }),
  )

  // 跨域：开发时 Nuxt 在 3001，生产环境由 Nginx 同源代理
  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        if (!origin) return allowedOrigins[0] ?? '*'
        return allowedOrigins.includes(origin) || allowedOrigins.includes('*') ? origin : ''
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      // Authorization 供 API Token（P3-2）跨域调用；_wants_json 为前端协商标记
      allowHeaders: ['Content-Type', 'Accept', 'Authorization', '_wants_json'],
      maxAge: 86400,
    }),
  )

  /* ------------------------------ 错误处理 ------------------------------ */
  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {}),
          },
        },
        error.status,
      )
    }

    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'bad_request',
            message: error.issues[0]?.message ?? '参数校验失败',
            details: error.issues.map((i) => ({
              path: i.path.join('.') || '(root)',
              message: i.message,
            })),
          },
        },
        400,
      )
    }

    if (error instanceof HTTPException) {
      return c.json(
        { error: { code: 'http_error', message: error.message || '请求失败' } },
        error.status,
      )
    }

    // 未预期的异常：记录完整堆栈，但只向客户端暴露摘要
    // eslint-disable-next-line no-console
    console.error('[glimmer] 未处理的异常：', error)

    return c.json(
      {
        error: {
          code: 'internal_error',
          message: isDev ? (error as Error).message : '服务器内部错误，请稍后重试',
        },
      },
      500,
    )
  })

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: `接口不存在：${c.req.method} ${c.req.path}` } }, 404),
  )

  /* ------------------------------ 挂载 ------------------------------ */
  app.route('/api', api)
  app.route('/files', fileRoutes)

  return app
}
