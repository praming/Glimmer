import {
  API_TOKEN_PREFIX,
  MAX_API_TOKENS,
  SECRET_PLACEHOLDER,
  backendConfigSchema,
  createApiTokenSchema,
  globalSettingsPatchSchema,
  maskGlobalSettings,
  mergeBackendSecrets,
  preferencesSchema,
  type BackendConfig,
  type GlobalSettings,
} from '@glimmer/shared'
import { Hono } from 'hono'
import { env, paths } from '../env'
import type { AppEnv } from '../lib/context'
import { notFound } from '../lib/errors'
import { ok, parseJson } from '../lib/http'
import { requireAdmin, requireAuth } from '../lib/session'
import { createApiToken, deleteApiToken, listApiTokens, revokeApiToken } from '../lib/tokens'
import { invalidateAccessPathCache } from '../services/access'
import { imageStatusSummary } from '../services/images'
import { getQueueStats } from '../services/queue'
import {
  getGlobalSettings,
  getUserPreferences,
  saveGlobalSettings,
  saveUserPreferences,
} from '../services/settings'
import { createAdapter, invalidateAdapterCache } from '../storage'
import { resolveFilesPrefix } from '../storage/prefix'

export const settingsRoutes = new Hono<AppEnv>()

/* ------------------------------------------------------------------ */
/* GET /api/settings —— 管理员：完整配置（密钥以占位符回显）             */
/* ------------------------------------------------------------------ */

settingsRoutes.get('/', requireAdmin, (c) => {
  const settings = getGlobalSettings()
  return ok(c, {
    settings: maskGlobalSettings(settings),
    stats: {
      images: imageStatusSummary(),
      queue: getQueueStats(),
    },
    runtime: {
      nodeEnv: env.NODE_ENV,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      /** env 里显式设置的直链前缀（空串 = 未设置，此时以库里的设置为准） */
      filesRoutePrefixEnv: env.FILES_ROUTE_PREFIX,
      /** 当前真正生效的直链前缀（空串 = 直接挂在根路径） */
      filesRoutePrefixEffective: resolveFilesPrefix(settings.filesPathPrefix),
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
      storageRoot: paths.uploads,
      database: paths.database,
      sessionTtlDays: env.SESSION_TTL_DAYS,
      queueConcurrency: env.QUEUE_CONCURRENCY,
    },
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/settings —— 管理员：保存全局配置                          */
/* ------------------------------------------------------------------ */

settingsRoutes.patch('/', requireAdmin, async (c) => {
  const patch = await parseJson(c, globalSettingsPatchSchema)
  const saved = saveGlobalSettings(patch as Partial<GlobalSettings>)
  invalidateAdapterCache()
  // 本地后端的目录 / pathPrefix 可能变化，路径→图片的映射缓存必须失效
  invalidateAccessPathCache()
  return ok(c, { settings: maskGlobalSettings(saved) })
})

/* ------------------------------------------------------------------ */
/* POST /api/settings/backends/test —— 测试存储后端连通性                */
/* ------------------------------------------------------------------ */

settingsRoutes.post('/backends/test', requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { backend?: unknown; id?: string }
    | null

  const rawConfig = body?.backend ?? (body?.id ? undefined : body)
  let config: BackendConfig

  if (rawConfig) {
    config = backendConfigSchema.parse(rawConfig) as BackendConfig
  } else if (body?.id) {
    const existing = getGlobalSettings().backends.find((b) => b.id === body.id)
    if (!existing) {
      return ok(c, { ok: false, message: `未找到后端：${body.id}` })
    }
    config = existing
  } else {
    return ok(c, { ok: false, message: '缺少 backend 或 id 参数' })
  }

  // 表单里密钥为占位符时，回退到已保存的真实密钥
  if (
    (config.type === 's3' && (config.secretAccessKey === SECRET_PLACEHOLDER || config.secretAccessKey === '')) ||
    (config.type === 'webdav' && (config.password === SECRET_PLACEHOLDER || config.password === ''))
  ) {
    config = mergeBackendSecrets(config, getGlobalSettings())
  }

  const started = Date.now()
  try {
    const adapter = createAdapter(config, getGlobalSettings())
    await adapter.test()
    return ok(c, {
      ok: true,
      message: `连接成功 · ${config.type.toUpperCase()}`,
      latencyMs: Date.now() - started,
    })
  } catch (error) {
    return ok(c, {
      ok: false,
      message: (error as Error).message,
      latencyMs: Date.now() - started,
    })
  }
})

/* ------------------------------------------------------------------ */
/* GET /api/settings/options —— 所有登录用户：上传页所需的公开选项        */
/* ------------------------------------------------------------------ */

settingsRoutes.get('/options', requireAuth, (c) => {
  const settings = getGlobalSettings()
  return ok(c, {
    namingTemplate: settings.namingTemplate,
    galleryVisibility: settings.galleryVisibility,
    publicBaseUrl: settings.publicBaseUrl,
    maxUploadSizeMb: settings.maxUploadSizeMb,
    allowedInputMime: settings.allowedInputMime,
    processing: settings.processing,
    defaultBackends: settings.defaultBackends,
    backends: settings.backends
      .filter((b) => b.enabled)
      .map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        publicBaseUrl: b.publicBaseUrl,
      })),
  })
})

/* ------------------------------------------------------------------ */
/* 个人偏好                                                            */
/* ------------------------------------------------------------------ */

export const meRoutes = new Hono<AppEnv>()

meRoutes.get('/preferences', requireAuth, (c) => ok(c, getUserPreferences(c.get('user').id)))

meRoutes.patch('/preferences', requireAuth, async (c) => {
  const patch = await parseJson(c, preferencesSchema)
  const saved = saveUserPreferences(c.get('user').id, patch)
  return ok(c, saved)
})

meRoutes.get('/usage', requireAuth, (c) => {
  const me = c.get('user')
  return ok(c, {
    user: me,
    preferences: getUserPreferences(me.id),
    queue: getQueueStats(),
  })
})

/* ------------------------------------------------------------------ */
/* API Token（P3-2）                                                    */
/* ------------------------------------------------------------------ */

meRoutes.get('/tokens', requireAuth, (c) => {
  const me = c.get('user')
  return ok(c, {
    tokens: listApiTokens(me.id),
    limit: MAX_API_TOKENS,
    prefix: API_TOKEN_PREFIX,
  })
})

meRoutes.post('/tokens', requireAuth, async (c) => {
  const me = c.get('user')
  const input = await parseJson(c, createApiTokenSchema)
  return ok(c, createApiToken(me.id, input), 201)
})

/** 软撤销（保留记录便于审计） */
meRoutes.delete('/tokens/:id', requireAuth, (c) => {
  const me = c.get('user')
  const id = c.req.param('id')

  // ?purge=1 → 彻底删除记录（用于清理已撤销 / 已过期的令牌）
  if (c.req.query('purge') === '1') {
    const removed = deleteApiToken(me.id, id)
    if (!removed) throw notFound('访问令牌不存在')
    return ok(c, { success: true, purged: true })
  }

  const revoked = revokeApiToken(me.id, id)
  if (!revoked) throw notFound('访问令牌不存在或已被撤销')
  return ok(c, { success: true })
})
