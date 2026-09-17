import { imageListQuerySchema, imagePatchSchema } from '@glimmer/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../lib/context'
import { badRequest } from '../lib/errors'
import { ok, parseJson, parseQuery, parseWith } from '../lib/http'
import { requireAuth } from '../lib/session'
import {
  assertCanModify,
  deleteImageFiles,
  getImageDetail,
  getImageUrls,
  listImages,
  mustGetImage,
  purgeImage,
  renameImage,
  resetForRetry,
} from '../services/images'
import { ensureSourceAvailable } from '../services/processor'
import { enqueueImageProcessing, getQueueStats } from '../services/queue'
import { resetImageBudget, resetRecordBudget } from '../services/retry'
import { getGlobalSettings } from '../services/settings'

export const imageRoutes = new Hono<AppEnv>()

/* ------------------------------------------------------------------ */
/* 批量操作（需排在 /:id 之前，避免路径歧义）                            */
/* ------------------------------------------------------------------ */

const batchDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, '请至少选择一张图片').max(200, '单次最多删除 200 张'),
})

imageRoutes.post('/batch/delete', requireAuth, async (c) => {
  const me = c.get('user')
  const { ids } = await parseJson(c, batchDeleteSchema)

  const deleted: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  const warnings: Array<{ id: string; backendName: string; path: string; error: string }> = []

  for (const id of ids) {
    const row = dbLookup(id)
    if (!row) {
      skipped.push({ id, reason: '不存在或已被删除' })
      continue
    }
    try {
      assertCanModify(me, row)
    } catch {
      skipped.push({ id, reason: '没有权限' })
      continue
    }

    const outcome = await deleteImageFiles(id)
    for (const failure of outcome.failures) warnings.push({ id, ...failure })
    purgeImage(id)
    deleted.push(id)
  }

  return ok(c, { deleted, skipped, warnings, queue: getQueueStats() })
})

/* ------------------------------------------------------------------ */
/* GET /api/images                                                     */
/* ------------------------------------------------------------------ */

imageRoutes.get('/', requireAuth, (c) => {
  const query = parseQuery(c, imageListQuerySchema)
  return ok(c, listImages(query, c.get('user')))
})

/* ------------------------------------------------------------------ */
/* GET /api/images/:id                                                 */
/* ------------------------------------------------------------------ */

imageRoutes.get('/:id', requireAuth, (c) => ok(c, getImageDetail(c.req.param('id'), c.get('user'))))

/* ------------------------------------------------------------------ */
/* GET /api/images/:id/urls                                            */
/* ------------------------------------------------------------------ */

imageRoutes.get('/:id/urls', requireAuth, (c) => {
  const result = getImageUrls(c.req.param('id'), c.get('user'))
  return ok(c, { image: result.image, byFormat: result.byFormat })
})

/* ------------------------------------------------------------------ */
/* POST /api/images/:id/retry                                          */
/* ------------------------------------------------------------------ */

const retrySchema = z.object({
  backends: z.array(z.string().min(1)).max(20).optional(),
})

imageRoutes.post('/:id/retry', requireAuth, async (c) => {
  const id = c.req.param('id')
  const me = c.get('user')
  const settings = getGlobalSettings()

  const image = mustGetImage(id)
  assertCanModify(me, image)

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
  const { backends } = parseWith(retrySchema, body ?? {})

  if (backends && backends.length > 0) {
    const invalid = backends.filter((backendId) => {
      const config = settings.backends.find((b) => b.id === backendId)
      return !config || !config.enabled
    })
    if (invalid.length > 0) throw badRequest(`以下后端不可用：${invalid.join('、')}`)
  }

  // 手动重试视为「人工介入」：重置自动重试预算，让退避重新从 30s 起算
  resetImageBudget(id)
  resetRecordBudget(id)

  const touched = resetForRetry(id, backends)

  const available = await ensureSourceAvailable(id)
  if (!available) {
    throw badRequest('原始文件已不可用，无法重新处理，请删除后重新上传')
  }

  enqueueImageProcessing(id, 10)

  return ok(c, { touched, detail: getImageDetail(id, me), queue: getQueueStats() })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/images/:id —— 重命名 / 补充同步后端                        */
/* ------------------------------------------------------------------ */

imageRoutes.patch('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const me = c.get('user')
  const settings = getGlobalSettings()

  const image = mustGetImage(id)
  assertCanModify(me, image)

  const payload = await parseJson(c, imagePatchSchema)
  const result: Record<string, unknown> = {}

  if (payload.filename !== undefined) {
    const outcome = await renameImage(id, payload.filename, me)
    result.detail = outcome.detail
    result.failures = outcome.failures
  }

  if (payload.backends && payload.backends.length > 0) {
    const invalid = payload.backends.filter((backendId) => {
      const config = settings.backends.find((b) => b.id === backendId)
      return !config || !config.enabled
    })
    if (invalid.length > 0) throw badRequest(`以下后端不可用：${invalid.join('、')}`)

    result.touched = resetForRetry(id, payload.backends)

    const available = await ensureSourceAvailable(id)
    if (available) {
      enqueueImageProcessing(id, 5)
    } else {
      result.warning = '原始文件已不可用，新增后端的同步未能启动'
    }
  }

  return ok(c, result)
})

/* ------------------------------------------------------------------ */
/* DELETE /api/images/:id                                              */
/* ------------------------------------------------------------------ */

imageRoutes.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const me = c.get('user')

  const image = mustGetImage(id)
  assertCanModify(me, image)

  const outcome = await deleteImageFiles(id)
  purgeImage(id)

  return ok(c, {
    success: true,
    deletedFromStorage: outcome.deletedFromStorage,
    warnings: outcome.failures,
  })
})

/* ------------------------------------------------------------------ */
/* 内部：按 id 取行（避免直接依赖 db 层细节）                            */
/* ------------------------------------------------------------------ */

function dbLookup(id: string) {
  try {
    return mustGetImage(id)
  } catch {
    return null
  }
}
