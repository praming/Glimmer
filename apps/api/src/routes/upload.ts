import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ALLOWED_INPUT_MIME,
  EXT_TO_MIME,
  INPUT_MIME_LABEL,
  UPLOAD_MAX_FILES_PER_REQUEST,
  getExtension,
  randomString,
  sanitizeFilename,
  stripExtension,
  uploadCheckSchema,
  uploadOptionsSchema,
  type OutputFormat,
  type UploadAccepted,
  type UploadCheckResult,
} from '@glimmer/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import sharp from 'sharp'
import { db, imageVariants, images, storageRecords } from '../db'
import { paths } from '../env'
import type { AppEnv } from '../lib/context'
import { sha256Hex } from '../lib/crypto'
import { badRequest } from '../lib/errors'
import { ok, parseJson, parseWith } from '../lib/http'
import { requireAuth } from '../lib/session'
import { computeDedupKey, findDedupHit, lookupDedup } from '../services/dedup'
import { buildVariantPlans, resolveSourceFormat } from '../services/pipeline'
import { tempSourcePath } from '../services/processor'
import { enqueueImageProcessing, getQueueStats } from '../services/queue'
import { getGlobalSettings } from '../services/settings'
import { resolveAdapters } from '../storage'

export const uploadRoutes = new Hono<AppEnv>()

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

/**
 * 从 `FormData` 派生「文件项」类型，而不是直接用全局 `File`。
 *
 * 本仓库 `lib: ["ES2023"]`、`types: ["node"]`，此时存在两套 `File`：
 * - `FormData` 的取值来自 undici（`undici-types/file.d.ts` 的 class File）
 * - 全局 `File` 是 `interface File extends import('buffer').File`
 * 二者结构相近但**标称不同**，会导致 `filter(isFile)` 的类型谓词不满足
 * `S extends FormDataEntryValue` 约束，从而退回非谓词重载、失去窄化
 * （表现为后续 `file.name` / `file.size` 全部报 TS2339）。
 * 直接派生即可保证与 `getAll()` 的返回元素严格同一。
 */
type UploadFile = Exclude<ReturnType<FormData['getAll']>[number], string>

const isFile = (value: unknown): value is UploadFile =>
  typeof value !== 'string' && typeof File !== 'undefined' && value instanceof File

function normalizeMime(file: UploadFile): string {
  const declared = (file.type || '').toLowerCase()
  if (declared && declared !== 'application/octet-stream') return declared
  return EXT_TO_MIME[getExtension(file.name)] ?? declared ?? ''
}

/** 内存 + 数据库双层去重，保证存储路径唯一 */
const reservedPaths = new Set<string>()

function uniqueStoragePath(candidate: string): string {
  const taken = (value: string): boolean => {
    if (reservedPaths.has(value)) return true
    const row = db
      .select({ id: imageVariants.id })
      .from(imageVariants)
      .where(eq(imageVariants.storagePath, value))
      .get()
    return Boolean(row)
  }

  if (!taken(candidate)) {
    reservedPaths.add(candidate)
    return candidate
  }

  const dir = path.posix.dirname(candidate)
  const ext = candidate.includes('.') ? candidate.slice(candidate.lastIndexOf('.')) : ''
  const base = path.posix.basename(candidate, ext)

  let attempt = 0
  for (;;) {
    const suffix = attempt === 0 ? randomString(4) : `${randomString(4)}${attempt}`
    const next = dir && dir !== '.' ? `${dir}/${base}-${suffix}${ext}` : `${base}-${suffix}${ext}`
    if (!taken(next)) {
      reservedPaths.add(next)
      return next
    }
    attempt += 1
  }
}

/* ------------------------------------------------------------------ */
/* 本次上传的「生效选项」                                                */
/* ------------------------------------------------------------------ */

interface EffectiveUploadOptions {
  formats: OutputFormat[]
  keepOriginal: boolean
  targets: ReturnType<typeof resolveAdapters>
}

/**
 * 把「本次请求选项 + 全局设置」折算成实际生效的选项。
 *
 * 上传接口与秒传预检接口共用此函数 —— 两处对 formats / backends /
 * keepOriginal 的默认值处理必须完全一致，否则预检算出的 dedup_key
 * 会和真正上传时算出的不一致，秒传就会永远不命中。
 */
function resolveEffectiveOptions(
  input: { formats?: OutputFormat[]; backends?: string[]; keepOriginal?: boolean },
  settings: ReturnType<typeof getGlobalSettings>,
): EffectiveUploadOptions {
  const targets = resolveAdapters(settings, input.backends ?? null)
  if (targets.length === 0) {
    throw badRequest('没有可用的存储后端，请先在「设置 → 存储后端」中启用')
  }

  const formats = (input.formats ?? settings.processing.outputFormats) as OutputFormat[]
  if (formats.length === 0) throw badRequest('至少需要选择一种输出格式')

  return {
    targets,
    formats,
    keepOriginal: input.keepOriginal ?? settings.processing.keepOriginal,
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/upload/check —— 秒传预检                                    */
/* ------------------------------------------------------------------ */

/**
 * 客户端算好原图 SHA-256 后先问一次：命中则完全跳过文件传输。
 *
 * 判断口径与上传接口完全一致（同一个 dedup_key 公式），因此
 * 「预检命中 ⇒ 上传也一定命中」，不会出现虚假秒传。
 */
uploadRoutes.post('/check', requireAuth, async (c) => {
  const user = c.get('user')
  const settings = getGlobalSettings()
  const input = await parseJson(c, uploadCheckSchema)

  // 在传输前就把超限文件拒掉，省下一次白传
  if (input.size != null && input.size > settings.maxUploadSizeMb * 1024 * 1024) {
    throw badRequest(`超出单文件上限 ${settings.maxUploadSizeMb} MB`)
  }

  const { formats, keepOriginal, targets } = resolveEffectiveOptions(input, settings)

  const { image } = lookupDedup(
    {
      userId: user.id,
      contentHash: input.hash.toLowerCase(),
      formats,
      keepOriginal,
      backendIds: targets.map((t) => t.config.id),
      settings,
    },
    user,
  )

  return ok(c, { hit: Boolean(image), image } satisfies UploadCheckResult)
})

/* ------------------------------------------------------------------ */
/* POST /api/upload —— 上传（含服务端兜底去重）                          */
/* ------------------------------------------------------------------ */

uploadRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const settings = getGlobalSettings()
  const maxBytes = settings.maxUploadSizeMb * 1024 * 1024

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    throw badRequest('无法解析上传数据，请确认使用 multipart/form-data 提交')
  }

  const files = [...form.getAll('files'), ...form.getAll('file')].filter(isFile)

  if (files.length === 0) throw badRequest('没有收到任何文件')
  if (files.length > UPLOAD_MAX_FILES_PER_REQUEST) {
    throw badRequest(`单次最多上传 ${UPLOAD_MAX_FILES_PER_REQUEST} 个文件`)
  }

  const options = parseWith(uploadOptionsSchema, {
    formats: form.get('formats'),
    backends: form.get('backends'),
    keepOriginal: form.get('keepOriginal'),
  })

  const { formats, keepOriginal, targets } = resolveEffectiveOptions(options, settings)

  const accepted: UploadAccepted['images'] = []
  const rejected: UploadAccepted['rejected'] = []

  await fs.mkdir(paths.temp, { recursive: true })

  for (const file of files) {
    const rawName = file.name || 'image'

    try {
      if (file.size === 0) throw new Error('文件内容为空')
      if (file.size > maxBytes) {
        throw new Error(`超出单文件上限 ${settings.maxUploadSizeMb} MB`)
      }

      const mimeType = normalizeMime(file)
      if (!mimeType || !ALLOWED_INPUT_MIME.includes(mimeType as (typeof ALLOWED_INPUT_MIME)[number])) {
        throw new Error(`不支持的文件类型：${mimeType || '未知'}`)
      }

      // 管理员白名单：未勾选的类型一律拒收（空数组表示全部禁用）
      if (!settings.allowedInputMime.includes(mimeType)) {
        const label = INPUT_MIME_LABEL[mimeType] ?? mimeType
        throw new Error(`管理员已限制上传格式，当前不接受 ${label}`)
      }

      const buffer = Buffer.from(await file.arrayBuffer())

      // 真正解析一次，避免把伪装成图片的文件写入存储
      let probe: sharp.Metadata
      try {
        probe = await sharp(buffer).metadata()
      } catch {
        throw new Error('无法解析该图片文件，可能已损坏')
      }
      if (!probe.format) throw new Error('无法识别该图片的格式')

      // 秒传去重：内容 + 配置指纹完全一致时直接复用既有记录，不写任何文件。
      // 客户端未做预检（如 curl 直传）也能在这里命中，是服务端侧的兜底。
      const contentHash = sha256Hex(buffer)
      const dedupKey = computeDedupKey({
        userId: user.id,
        contentHash,
        formats,
        keepOriginal,
        backendIds: targets.map((t) => t.config.id),
        settings,
      })

      const hit = findDedupHit(user.id, dedupKey)
      if (hit) {
        accepted.push({
          id: hit.id,
          filename: hit.filename,
          originalName: hit.originalName ?? rawName,
          status: hit.status,
          deduplicated: true,
        })
        continue
      }

      const imageId = crypto.randomUUID()
      const now = new Date().toISOString()
      const displayName = sanitizeFilename(stripExtension(rawName), 'image')
      const sourceFormat = resolveSourceFormat(mimeType)

      const plans = buildVariantPlans({
        namingTemplate: settings.namingTemplate,
        originalName: rawName,
        mimeType,
        sourceFormat,
        formats,
        keepOriginal,
        now: new Date(),
      }).map((plan) => ({ ...plan, path: uniqueStoragePath(plan.path) }))

      if (plans.length === 0) throw new Error('没有生成任何输出格式，请检查设置')

      // 1) 先入库（status = pending）
      db.insert(images)
        .values({
          id: imageId,
          userId: user.id,
          originalName: rawName,
          filename: displayName,
          mimeType,
          width: probe.width ?? null,
          height: probe.height ?? null,
          status: 'pending',
          contentHash,
          dedupKey,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      // 2) 预建 variants 与各后端的 storage_records
      for (const plan of plans) {
        const variantId = crypto.randomUUID()
        db.insert(imageVariants)
          .values({
            id: variantId,
            imageId,
            format: plan.format,
            storagePath: plan.path,
            status: 'pending',
            createdAt: now,
          })
          .run()

        for (const target of targets) {
          db.insert(storageRecords)
            .values({
              id: crypto.randomUUID(),
              variantId,
              backend: target.config.id,
              path: plan.path,
              status: 'pending',
              createdAt: now,
            })
            .run()
        }
      }

      // 3) 原图落临时目录，交由异步队列处理
      await fs.writeFile(tempSourcePath(imageId), buffer)

      // 4) 推入队列
      enqueueImageProcessing(imageId)

      accepted.push({
        id: imageId,
        filename: displayName,
        originalName: rawName,
        status: 'pending',
      })
    } catch (error) {
      rejected.push({ originalName: rawName, reason: (error as Error).message })
    }
  }

  return ok(c, { images: accepted, rejected } satisfies UploadAccepted, 202)
})

/* ------------------------------------------------------------------ */
/* GET /api/upload/queue —— 队列状态                                    */
/* ------------------------------------------------------------------ */

uploadRoutes.get('/queue', requireAuth, (c) => ok(c, getQueueStats()))
