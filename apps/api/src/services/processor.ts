import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import type {
  GlobalSettings,
  ImageStatus,
  OutputFormat,
  SyncStatus,
  VariantFormat,
} from '@glimmer/shared'
import { FORMAT_MIME } from '@glimmer/shared'
import { eq, inArray } from 'drizzle-orm'
import {
  db,
  imageVariants,
  images,
  storageRecords,
  type ImageVariantRow,
  type StorageRecordRow,
} from '../db'
import { paths } from '../env'
import { md5Hex } from '../lib/crypto'
import { getAdapter } from '../storage'
import { renderVariants, type RenderedVariant } from './pipeline'
import { getGlobalSettings } from './settings'

/* ------------------------------------------------------------------ */
/* 临时原图                                                            */
/* ------------------------------------------------------------------ */

/** 上传阶段原图落盘的临时路径 */
export function tempSourcePath(imageId: string): string {
  return path.join(paths.temp, `${imageId}.src`)
}

async function cleanupTemp(imageId: string): Promise<void> {
  const target = tempSourcePath(imageId)
  try {
    await fs.unlink(target)
  } catch (error) {
    // ENOENT 说明已经清过，属正常。其余一律打出来 —— 静默失败会让
    // data/tmp 里的 .src 越积越多，而这个目录是「字节级原图」，泄漏代价很高。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn(`[glimmer] 清理临时原图失败 ${target}`, error)
  }
}

/**
 * 同步丢弃临时原图。
 * 删除图片时调用 —— 否则 `data/tmp` 会随着每次「上传后删除」慢慢泄漏 `.src` 残骸。
 */
export function discardTempSource(imageId: string): void {
  const target = tempSourcePath(imageId)
  try {
    fsSync.unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn(`[glimmer] 丢弃临时原图失败 ${target}`, error)
  }
}

/**
 * 已删除、不应再被处理的图片。
 *
 * 处理任务是异步的：图片在排队或处理途中被删除时，任务仍会跑完并把文件写进后端，
 * 结果就是「数据库没记录、磁盘上却留着文件」的孤儿。删除时登记 id，
 * 让任务在关键节点自我中止，杜绝这类泄漏。
 */
const cancelledImages = new Set<string>()

/** 删除图片时调用：中止尚未完成的处理任务 */
export function cancelImageProcessing(imageId: string): void {
  cancelledImages.add(imageId)
}

function isCancelled(imageId: string): boolean {
  return cancelledImages.has(imageId)
}

/**
 * 从某个存储后端取回字节；失败返回 null（交由调用方尝试下一份副本）。
 */
async function downloadFrom(
  record: StorageRecordRow,
  settings: GlobalSettings,
): Promise<Buffer | null> {
  const config = settings.backends.find((b) => b.id === record.backend)
  if (!config) return null
  try {
    const adapter = getAdapter(config)
    return await adapter.download(record.path)
  } catch {
    return null
  }
}

/** 按优先级依次尝试一组存储记录，返回第一份成功取回的字节 */
async function downloadFirstAvailable(
  records: StorageRecordRow[],
  settings: GlobalSettings,
): Promise<Buffer | null> {
  for (const record of records) {
    const buffer = await downloadFrom(record, settings)
    if (buffer) return buffer
  }
  return null
}

/**
 * 确保临时原图可用，供「无任何就绪副本」的变体重渲染使用。
 *
 * 恢复顺序（重要）：
 *  1. 上传留下的临时文件仍在 → 直接可用；
 *  2. 否则从任一就绪的 **`original` 变体**副本取回 —— 这是唯一与上传字节逐字节一致的来源；
 *  3. 原图归档也全部丢失时，退回**体积最大的就绪派生变体**，让重试至少还能救回派生输出。
 *
 * ⚠️ 第 3 步取回的字节**不是**上传原图。`processImage` 会用 md5 与 `original` 变体
 * 的指纹比对来识别这种情况，并**拒绝**用它重建原图归档 —— 否则会把归档静默替换成
 * webp/jpeg 派生物（历史 bug：原图文件魔数变成 `RIFF....WEBP`）。
 */
export async function ensureSourceAvailable(imageId: string): Promise<boolean> {
  const target = tempSourcePath(imageId)
  try {
    await fs.access(target)
    return true
  } catch {
    /* 需要从远端恢复 */
  }

  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  if (variants.length === 0) return false

  const records = db
    .select()
    .from(storageRecords)
    .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
    .all()

  const ready = records.filter((r) => r.status === 'ready')
  if (ready.length === 0) return false

  const settings = getGlobalSettings()
  const variantById = new Map(variants.map((v) => [v.id, v]))

  // 原图归档优先；同级按体积从大到小（越接近原图，重编码损失越小）
  const ordered = [...ready].sort((a, b) => {
    const aOriginal = variantById.get(a.variantId)?.format === 'original' ? 0 : 1
    const bOriginal = variantById.get(b.variantId)?.format === 'original' ? 0 : 1
    if (aOriginal !== bOriginal) return aOriginal - bOriginal
    return (variantById.get(b.variantId)?.size ?? 0) - (variantById.get(a.variantId)?.size ?? 0)
  })

  const buffer = await downloadFirstAvailable(ordered, settings)
  if (!buffer) return false

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, buffer)
  return true
}

/**
 * 临时原图是否为「上传时的字节级原图」。
 *
 * `original` 变体尚未渲染过（md5 为空）时视为一致 —— 此时临时文件就是上传落盘的原始字节。
 * 一旦存在指纹，就必须逐字节相符；不符说明它是从派生变体恢复来的近似替代。
 */
function isByteExactOriginal(source: Buffer, original: ImageVariantRow | undefined): boolean {
  if (!original) return false
  if (!original.md5) return true
  return md5Hex(source) === original.md5
}

/* ------------------------------------------------------------------ */
/* 状态计算                                                            */
/* ------------------------------------------------------------------ */

/**
 * variant 状态：任一后端 ready 即视为可用。
 * image 状态：任一变体可用即 ready；全部无望则 failed；否则继续 pending。
 */
export function recomputeImageState(imageId: string): void {
  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  if (variants.length === 0) return

  const records =
    variants.length > 0
      ? db
          .select()
          .from(storageRecords)
          .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
          .all()
      : []

  const byVariant = new Map<string, StorageRecordRow[]>()
  for (const record of records) {
    const list = byVariant.get(record.variantId)
    if (list) list.push(record)
    else byVariant.set(record.variantId, [record])
  }

  let anyReady = false
  let anyPending = false

  for (const variant of variants) {
    const list = byVariant.get(variant.id) ?? []
    let status: SyncStatus
    if (list.some((r) => r.status === 'ready')) status = 'ready'
    else if (list.some((r) => r.status === 'pending')) status = 'pending'
    else status = 'failed'

    if (status === 'ready') anyReady = true
    if (status === 'pending') anyPending = true

    if (variant.status !== status) {
      db.update(imageVariants).set({ status }).where(eq(imageVariants.id, variant.id)).run()
    }
  }

  const status: ImageStatus = anyReady ? 'ready' : anyPending ? 'pending' : 'failed'
  const current = db.select({ status: images.status }).from(images).where(eq(images.id, imageId)).get()
  if (current?.status !== status) {
    db.update(images)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(images.id, imageId))
      .run()
  }
}

function setImageFailed(imageId: string, message: string): void {
  db.update(images)
    .set({ status: 'failed', errorMessage: message.slice(0, 500), updatedAt: new Date().toISOString() })
    .where(eq(images.id, imageId))
    .run()
}

function failRecord(recordId: string, message: string): void {
  db.update(storageRecords)
    .set({ status: 'failed', errorMessage: message.slice(0, 500) })
    .where(eq(storageRecords.id, recordId))
    .run()
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function contentTypeFor(format: VariantFormat, fallbackMime: string | null): string {
  if (format === 'original') return fallbackMime ?? 'application/octet-stream'
  return FORMAT_MIME[format]
}

/**
 * 单张图片的完整异步任务：把**尚未成功**的存储记录补齐，然后汇总状态。
 *
 * 两条补齐路径，区分标准是「该变体是否还有就绪副本」：
 *
 * - **跨后端复制**：变体在别的后端已有 ready 副本 → `download` 后原样 `upload`。
 *   不经过 sharp，因而字节完全一致（尺寸、体积、md5 都不变）。
 * - **重新渲染**：变体在所有后端都没有 ready 副本（首次处理，或副本全丢）→
 *   用临时原图重新跑 sharp。仅此时才回填 `image_variants` 的
 *   size/width/height/md5，避免出现「库里是新尺寸、盘上还是旧文件」的错位。
 *
 * `original` 变体额外受一道保护：只有当临时原图与它的指纹逐字节一致时才允许重建，
 * 否则宁可让它保持失败，也不把 webp/jpeg 派生物写成原图归档。
 *
 * 任一后端失败都不会中断其他后端，失败原因写入 storage_records.error_message。
 */
export async function processImage(imageId: string): Promise<void> {
  try {
    await processImageInner(imageId)
  } finally {
    // 处理途中被删除：无论中途是正常返回还是抛错，临时原图都必须回收。
    // 放在 finally 里是因为 sharp 可能正占用着该文件（Windows 上 unlink 会 EBUSY），
    // 只有等渲染彻底结束（无论成败）才删得掉。
    if (isCancelled(imageId)) {
      cancelledImages.delete(imageId)
      await cleanupTemp(imageId)
    }
  }
}

async function processImageInner(imageId: string): Promise<void> {
  // 图片已在排队/处理途中被删除：立刻收手并清掉临时原图，不要往后端写孤儿文件
  if (isCancelled(imageId)) return

  const image = db.select().from(images).where(eq(images.id, imageId)).get()
  if (!image) {
    await cleanupTemp(imageId)
    return
  }

  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  if (variants.length === 0) {
    setImageFailed(imageId, '没有待处理的输出格式')
    return
  }

  const settings = getGlobalSettings()
  const records = db
    .select()
    .from(storageRecords)
    .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
    .all()

  const pending = records.filter((record) => record.status !== 'ready')

  // 没有待办（重复入队 / 纯状态修复）：只收敛状态，不重新渲染
  if (pending.length === 0) {
    recomputeImageState(imageId)
    await cleanupTemp(imageId)
    return
  }

  const recordsByVariant = new Map<string, StorageRecordRow[]>()
  for (const record of records) {
    const list = recordsByVariant.get(record.variantId)
    if (list) list.push(record)
    else recordsByVariant.set(record.variantId, [record])
  }

  const pendingOf = (variantId: string): StorageRecordRow[] =>
    (recordsByVariant.get(variantId) ?? []).filter((r) => r.status !== 'ready')
  const readyOf = (variantId: string): StorageRecordRow[] =>
    (recordsByVariant.get(variantId) ?? []).filter((r) => r.status === 'ready')

  /** 需要重新渲染的变体：有未就绪记录，且没有任何就绪副本可搬 */
  const toRender: ImageVariantRow[] = []
  /** 需要跨后端复制的变体：有未就绪记录，但另有就绪副本 */
  const toCopy: ImageVariantRow[] = []

  for (const variant of variants) {
    if (pendingOf(variant.id).length === 0) continue
    if (readyOf(variant.id).length > 0) toCopy.push(variant)
    else toRender.push(variant)
  }

  /* --- 1. 取源（仅重新渲染需要） ---------------------------------- */

  let source: Buffer | null = null
  if (toRender.length > 0) {
    try {
      source = await fs.readFile(tempSourcePath(imageId))
    } catch {
      if (await ensureSourceAvailable(imageId)) {
        source = await fs.readFile(tempSourcePath(imageId)).catch(() => null)
      }
    }
  }

  const originalVariant = variants.find((v) => v.format === 'original')
  const renderFormats = toRender
    .map((v) => v.format)
    .filter((f): f is OutputFormat => f !== 'original')
  const wantsOriginal = toRender.some((v) => v.format === 'original')
  const keepOriginal = wantsOriginal && source !== null && isByteExactOriginal(source, originalVariant)

  /* --- 2. 渲染（失败则整张图判失败，与旧行为一致） ------------------ */

  let rendered: RenderedVariant[] = []
  if (source !== null && (renderFormats.length > 0 || keepOriginal)) {
    try {
      rendered = await renderVariants(source, {
        formats: renderFormats,
        keepOriginal,
        processing: settings.processing,
      })
    } catch (error) {
      const message = `图片处理失败：${(error as Error).message}`.slice(0, 500)
      // 只判失败「需要重渲染」的变体，不能连累已经同步成功的记录
      for (const variant of toRender) {
        for (const record of pendingOf(variant.id)) failRecord(record.id, message)
      }
      recomputeImageState(imageId)
      const latest = db.select({ status: images.status }).from(images).where(eq(images.id, imageId)).get()
      if (latest?.status !== 'ready') setImageFailed(imageId, message)
      await cleanupTemp(imageId)
      return
    }
  }

  const renderedByFormat = new Map<VariantFormat, RenderedVariant>(
    rendered.map((item) => [item.format, item]),
  )

  // 仅回填重新渲染变体的元数据：这些变体的全部记录都会重传，不会与盘上文件错位
  for (const variant of toRender) {
    const result = renderedByFormat.get(variant.format)
    if (!result) continue
    db.update(imageVariants)
      .set({ size: result.size, width: result.width, height: result.height, md5: result.md5 })
      .where(eq(imageVariants.id, variant.id))
      .run()
  }

  // 主尺寸（优先第一个非 original 输出）—— 仅在它确实被重新渲染时更新
  const primary = variants.find((v) => v.format !== 'original') ?? variants[0]!
  if (toRender.some((v) => v.id === primary.id)) {
    const primaryRender = renderedByFormat.get(primary.format)
    if (primaryRender) {
      db.update(images)
        .set({
          width: primaryRender.width,
          height: primaryRender.height,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(images.id, imageId))
        .run()
    }
  }

  /* --- 3. 复制源字节（每个变体只下载一次） ------------------------- */

  const copiedByVariant = new Map<string, Buffer | null>()
  await Promise.all(
    toCopy.map(async (variant) => {
      copiedByVariant.set(variant.id, await downloadFirstAvailable(readyOf(variant.id), settings))
    }),
  )

  /* --- 4. 补齐所有未就绪记录 --------------------------------------- */

  await Promise.all(
    pending.map(async (record) => {
      const variant = variants.find((v) => v.id === record.variantId)
      if (!variant) return

      // 上传/渲染耗时较长，期间图片可能已被删除 —— 每份副本上传前再确认一次
      if (isCancelled(imageId)) return

      const readyRecords = readyOf(variant.id)
      let payload: Buffer | null = null
      let failure = '未生成对应的渲染结果'

      if (readyRecords.length > 0) {
        payload = copiedByVariant.get(variant.id) ?? null
        if (!payload) failure = '既有的存储副本已无法读取'
      } else {
        const result = renderedByFormat.get(variant.format)
        if (result) {
          payload = result.buffer
        } else if (source === null) {
          failure = '临时原图已丢失，且没有可用的原图归档'
        } else if (variant.format === 'original') {
          // 走到这里说明源是「用派生变体恢复来的」，不是字节级原图 →
          // 宁可让原图归档保持失败，也绝不用 webp/jpeg 派生物去冒充它
          failure = '原图归档已丢失，无法用派生变体重建'
        }
      }

      if (!payload) {
        failRecord(record.id, failure)
        return
      }

      const config = settings.backends.find((b) => b.id === record.backend)
      if (!config || !config.enabled) {
        failRecord(record.id, `存储后端「${record.backend}」不存在或已禁用`)
        return
      }

      try {
        const adapter = getAdapter(config)
        const uploaded = await adapter.upload(payload, record.path, {
          contentType: contentTypeFor(variant.format, image.mimeType),
        })
        db.update(storageRecords)
          .set({ status: 'ready', url: uploaded.url, errorMessage: null })
          .where(eq(storageRecords.id, record.id))
          .run()
      } catch (error) {
        failRecord(record.id, (error as Error).message)
      }
    }),
  )

  recomputeImageState(imageId)

  // 全部成功后再清理临时原图，便于失败时重试
  const stillPending = db
    .select({ status: storageRecords.status })
    .from(storageRecords)
    .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
    .all()

  if (stillPending.every((r) => r.status === 'ready')) {
    db.update(images)
      .set({ errorMessage: null, updatedAt: new Date().toISOString() })
      .where(eq(images.id, imageId))
      .run()
    await cleanupTemp(imageId)
  }
}
