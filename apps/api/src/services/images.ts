import path from 'node:path/posix'
import type {
  GalleryVisibility,
  ImageDTO,
  ImageListQuery,
  Paginated,
  SessionUserDTO,
  StorageBackend,
  StorageRecordDTO,
  SyncStatus,
  UrlSet,
  VariantDTO,
  VariantFormat,
} from '@glimmer/shared'
import { buildUrlSet, randomString, sanitizeFilename, stripExtension } from '@glimmer/shared'
import { and, asc, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm'
import {
  db,
  imageStats,
  imageVariants,
  images,
  storageRecords,
  users,
  type ImageRow,
  type ImageVariantRow,
  type StorageRecordRow,
} from '../db'
import { forbidden, notFound } from '../lib/errors'
import { getAdapter } from '../storage'
import { invalidateAccessPathCache } from './access'
import { cancelImageProcessing, discardTempSource, recomputeImageState } from './processor'
import { getGlobalSettings, type GlobalSettings } from './settings'

/* ------------------------------------------------------------------ */
/* 权限                                                                */
/* ------------------------------------------------------------------ */

export function canModify(user: SessionUserDTO, image: Pick<ImageRow, 'userId'>): boolean {
  return user.role === 'admin' || image.userId === user.id
}

export function assertCanModify(user: SessionUserDTO, image: Pick<ImageRow, 'userId'>): void {
  if (!canModify(user, image)) throw forbidden('只能编辑或删除自己上传的图片')
}

/** 图库可见性过滤：私有模式下普通用户仅见自己的图片 */
function visibilityFilter(viewer: SessionUserDTO, visibility: GalleryVisibility): SQL | undefined {
  if (viewer.role === 'admin') return undefined
  if (visibility === 'private') return eq(images.userId, viewer.id)
  return undefined
}

/* ------------------------------------------------------------------ */
/* DTO 构建                                                            */
/* ------------------------------------------------------------------ */

function backendMeta(
  settings: GlobalSettings,
  backendId: string,
): { name: string; type: StorageBackend } {
  const config = settings.backends.find((b) => b.id === backendId)
  return { name: config?.name ?? backendId, type: config?.type ?? 'local' }
}

function toStorageRecordDTO(record: StorageRecordRow, settings: GlobalSettings): StorageRecordDTO {
  const meta = backendMeta(settings, record.backend)
  return {
    id: record.id,
    backend: meta.type,
    backendId: record.backend,
    backendName: meta.name,
    path: record.path,
    url: record.url,
    status: record.status,
    errorMessage: record.errorMessage,
    attemptCount: record.attemptCount,
    nextRetryAt: record.nextRetryAt,
    createdAt: record.createdAt,
  }
}

/** 优先挑选用于预览的格式 */
const PREVIEW_PRIORITY: VariantFormat[] = ['webp', 'jpeg', 'png', 'avif', 'gif', 'original']

function toVariantDTO(
  variant: ImageVariantRow,
  allRecords: StorageRecordRow[],
  settings: GlobalSettings,
  alt: string,
): VariantDTO {
  const mine = allRecords.filter((r) => r.variantId === variant.id)
  const storages = mine.map((r) => toStorageRecordDTO(r, settings))
  const urls = storages
    .filter((s) => s.status === 'ready' && s.url)
    .map((s) => s.url!)
  const primaryUrl = urls[0] ?? null
  const copy: UrlSet | null = primaryUrl ? buildUrlSet(primaryUrl, alt) : null

  return {
    id: variant.id,
    format: variant.format,
    storagePath: variant.storagePath,
    size: variant.size,
    width: variant.width,
    height: variant.height,
    md5: variant.md5,
    status: variant.status,
    storages,
    urls,
    primaryUrl,
    copy,
  }
}

/** 访问统计（P3-3）的轻量投影 */
export interface ImageStatLite {
  views: number
  bytesServed: number
  lastAccessAt: string | null
}

export interface ImageWithRelations {
  image: ImageRow
  username: string
  variants: ImageVariantRow[]
  records: StorageRecordRow[]
  /** 无访问记录时缺省为全 0 */
  stats?: ImageStatLite
}

export function toImageDTO(
  input: ImageWithRelations,
  settings: GlobalSettings,
  options: { withVariants?: boolean } = {},
): ImageDTO {
  const { image, username, variants, records } = input
  const alt = sanitizeFilename(stripExtension(image.originalName ?? image.filename), 'image')

  const variantDTOs = variants.map((v) => toVariantDTO(v, records, settings, alt))

  const previewVariant =
    PREVIEW_PRIORITY.map((format) => variantDTOs.find((v) => v.format === format)).find(
      (v) => v?.primaryUrl,
    ) ?? null

  const totalSize = variants.reduce((sum, v) => sum + (v.size ?? 0), 0)

  // 重试次数取「图片级预算」与「各后端记录」的较大值：
  // 后端同步失败时预算记在 storage_records 上，纯处理失败才记在 images 上。
  const attemptCount = records.reduce(
    (max, record) => Math.max(max, record.attemptCount),
    image.retryAttempts,
  )

  return {
    id: image.id,
    userId: image.userId,
    username,
    originalName: image.originalName,
    filename: image.filename,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    status: image.status,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
    variants: options.withVariants ? variantDTOs : undefined,
    previewUrl: previewVariant?.primaryUrl ?? null,
    primaryFormat: previewVariant?.format ?? variants[0]?.format ?? null,
    totalSize,
    views: input.stats?.views ?? 0,
    lastAccessAt: input.stats?.lastAccessAt ?? null,
    retry: {
      attemptCount,
      nextRetryAt: image.nextRetryAt,
      // 只有「失败且没有下一次排期」才算配额耗尽
      exhausted: image.status === 'failed' && image.nextRetryAt === null,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 关系批量载入                                                        */
/* ------------------------------------------------------------------ */

function loadUsernames(userIds: string[]): Map<string, string> {
  if (userIds.length === 0) return new Map()
  const rows = db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]))
    .all()
  return new Map(rows.map((r) => [r.id, r.username]))
}

function loadVariants(imageIds: string[]): {
  variantsByImage: Map<string, ImageVariantRow[]>
  recordsByVariant: Map<string, StorageRecordRow[]>
} {
  const variantsByImage = new Map<string, ImageVariantRow[]>()
  const recordsByVariant = new Map<string, StorageRecordRow[]>()
  if (imageIds.length === 0) return { variantsByImage, recordsByVariant }

  const variants = db
    .select()
    .from(imageVariants)
    .where(inArray(imageVariants.imageId, imageIds))
    .all()

  for (const variant of variants) {
    const list = variantsByImage.get(variant.imageId)
    if (list) list.push(variant)
    else variantsByImage.set(variant.imageId, [variant])
  }

  if (variants.length > 0) {
    const records = db
      .select()
      .from(storageRecords)
      .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
      .all()
    for (const record of records) {
      const list = recordsByVariant.get(record.variantId)
      if (list) list.push(record)
      else recordsByVariant.set(record.variantId, [record])
    }
  }

  return { variantsByImage, recordsByVariant }
}

/** 批量载入访问统计（P3-3），避免逐图查询 */
function loadStats(imageIds: string[]): Map<string, ImageStatLite> {
  const map = new Map<string, ImageStatLite>()
  if (imageIds.length === 0) return map

  const rows = db
    .select()
    .from(imageStats)
    .where(inArray(imageStats.imageId, imageIds))
    .all()

  for (const row of rows) {
    map.set(row.imageId, {
      views: row.views,
      bytesServed: row.bytesServed,
      lastAccessAt: row.lastAccessAt,
    })
  }
  return map
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

const totalSizeExpr = sql<number>`(
  select coalesce(sum(size), 0) from image_variants where image_variants.image_id = ${images.id}
)`

export function listImages(query: ImageListQuery, viewer: SessionUserDTO): Paginated<ImageDTO> {
  const settings = getGlobalSettings()
  const conditions: SQL[] = []

  const visibility = visibilityFilter(viewer, settings.galleryVisibility)
  if (visibility) conditions.push(visibility)

  if (query.q) {
    const escaped = query.q.replace(/[\\%_]/g, (m) => `\\${m}`)
    const pattern = `%${escaped}%`
    const clause = or(
      like(images.originalName, pattern),
      like(images.filename, pattern),
      like(images.id, pattern),
    )
    if (clause) conditions.push(clause)
  }

  if (query.userId) conditions.push(eq(images.userId, query.userId))
  if (query.status) conditions.push(eq(images.status, query.status))
  if (query.from) conditions.push(gte(images.createdAt, query.from))
  if (query.to) conditions.push(lte(images.createdAt, query.to))

  if (query.format) {
    conditions.push(
      sql`exists (select 1 from image_variants v where v.image_id = ${images.id} and v.format = ${query.format})`,
    )
  }

  if (query.backend) {
    const backendIds = settings.backends.filter((b) => b.type === query.backend).map((b) => b.id)
    if (backendIds.length === 0) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 0 }
    }
    conditions.push(
      sql`exists (
        select 1 from storage_records s
        where s.variant_id in (select id from image_variants where image_id = ${images.id})
          and s.backend in (${sql.join(
            backendIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      )`,
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(images)
    .where(where)
    .get()
  const total = totalRow?.count ?? 0
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize)

  const sortExpr =
    query.sort === 'name' ? images.filename : query.sort === 'size' ? totalSizeExpr : images.createdAt
  const orderFn = query.order === 'asc' ? asc : desc

  const rows = db
    .select()
    .from(images)
    .where(where)
    .orderBy(orderFn(sortExpr), desc(images.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()

  if (rows.length === 0) {
    return { items: [], total, page: query.page, pageSize: query.pageSize, totalPages }
  }

  const usernames = loadUsernames(rows.map((r) => r.userId))
  const { variantsByImage, recordsByVariant } = loadVariants(rows.map((r) => r.id))
  const statsByImage = loadStats(rows.map((r) => r.id))

  const items = rows.map((image) => {
    const variants = variantsByImage.get(image.id) ?? []
    const records = variants.flatMap((v) => recordsByVariant.get(v.id) ?? [])
    return toImageDTO(
      {
        image,
        username: usernames.get(image.userId) ?? '未知用户',
        variants,
        records,
        stats: statsByImage.get(image.id),
      },
      settings,
    )
  })

  return { items, total, page: query.page, pageSize: query.pageSize, totalPages }
}

export function mustGetImage(imageId: string): ImageRow {
  const row = db.select().from(images).where(eq(images.id, imageId)).get()
  if (!row) throw notFound('图片不存在或已被删除')
  return row
}

export function getImageDetail(imageId: string, viewer: SessionUserDTO): ImageDTO {
  const settings = getGlobalSettings()
  const image = mustGetImage(imageId)

  const visibility = visibilityFilter(viewer, settings.galleryVisibility)
  if (visibility && image.userId !== viewer.id) throw notFound('图片不存在或已被删除')

  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  const records =
    variants.length > 0
      ? db
          .select()
          .from(storageRecords)
          .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
          .all()
      : []

  const username =
    db.select({ username: users.username }).from(users).where(eq(users.id, image.userId)).get()
      ?.username ?? '未知用户'

  return toImageDTO(
    { image, username, variants, records, stats: loadStats([imageId]).get(imageId) },
    settings,
    { withVariants: true },
  )
}

/** 仅返回各格式 URL，便于第三方脚本调用 */
export function getImageUrls(
  imageId: string,
  viewer: SessionUserDTO,
): { image: ImageDTO; byFormat: Record<string, UrlSet | null> } {
  const detail = getImageDetail(imageId, viewer)
  const byFormat: Record<string, UrlSet | null> = {}
  for (const variant of detail.variants ?? []) {
    byFormat[variant.format] = variant.copy
  }
  return { image: detail, byFormat }
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

export interface DeleteOutcome {
  deletedFromStorage: number
  failures: Array<{ backendId: string; backendName: string; path: string; error: string }>
}

/**
 * 同步删除所有存储后端中的文件。
 * 单个后端失败不会阻塞其他后端；随后无论成败都会清理数据库记录，
 * 失败明细回传给前端提示用户手工处理残留文件。
 */
export async function deleteImageFiles(imageId: string): Promise<DeleteOutcome> {
  // 第一步就取消：下面的删除是 await 的，若不先停掉排队中的处理任务，
  // 它很可能在这段等待里渲染完并写入后端，留下「库里没记录、盘上有文件」的孤儿。
  cancelImageProcessing(imageId)

  const settings = getGlobalSettings()
  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  if (variants.length === 0) return { deletedFromStorage: 0, failures: [] }

  const records = db
    .select()
    .from(storageRecords)
    .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
    .all()

  const failures: DeleteOutcome['failures'] = []
  let deletedFromStorage = 0

  await Promise.all(
    records.map(async (record) => {
      const config = settings.backends.find((b) => b.id === record.backend)
      if (!config) {
        failures.push({
          backendId: record.backend,
          backendName: record.backend,
          path: record.path,
          error: '后端配置已不存在',
        })
        return
      }
      try {
        const adapter = getAdapter(config)
        await adapter.delete(record.path)
        deletedFromStorage += 1
      } catch (error) {
        failures.push({
          backendId: record.backend,
          backendName: config.name,
          path: record.path,
          error: (error as Error).message,
        })
      }
    }),
  )

  return { deletedFromStorage, failures }
}

/** 彻底移除图片（数据库级联删除 variants 与 storage_records） */
export function purgeImage(imageId: string): void {
  // 先取消，再删库：避免排队中的处理任务在删除后继续往后端写孤儿文件
  cancelImageProcessing(imageId)
  db.delete(images).where(eq(images.id, imageId)).run()
  // 临时原图不属于任何存储后端，必须单独清掉，否则 data/tmp 会持续泄漏
  discardTempSource(imageId)
  // 路径可能被后续上传复用，清掉统计用的路径映射缓存
  invalidateAccessPathCache()
}

/* ------------------------------------------------------------------ */
/* 重命名（跨所有后端同步生效）                                          */
/* ------------------------------------------------------------------ */

function uniqueStoragePath(candidate: string, excludeImageId: string): string {
  const exists = db
    .select({ id: imageVariants.id })
    .from(imageVariants)
    .where(and(eq(imageVariants.storagePath, candidate), sql`${imageVariants.imageId} <> ${excludeImageId}`))
    .get()
  if (!exists) return candidate

  const dir = path.dirname(candidate)
  const ext = candidate.includes('.') ? candidate.slice(candidate.lastIndexOf('.')) : ''
  const base = path.basename(candidate, ext)
  const suffixed = `${base}-${randomString(4)}${ext}`
  return dir && dir !== '.' ? `${dir}/${suffixed}` : suffixed
}

export interface RenameOutcome {
  detail: ImageDTO
  failures: Array<{ variantId: string; backendId: string; error: string }>
}

/**
 * 重命名图片。
 * 每个变体按新名称生成新路径，然后逐后端「读回 → 写新路径 → 删除旧对象」，
 * 保证所有已存储的后端同步改名。
 */
export async function renameImage(
  imageId: string,
  newName: string,
  viewer: SessionUserDTO,
): Promise<RenameOutcome> {
  const settings = getGlobalSettings()
  const image = mustGetImage(imageId)
  assertCanModify(viewer, image)

  const safeName = sanitizeFilename(newName, 'image')
  const originalExt = image.originalName?.includes('.')
    ? image.originalName.slice(image.originalName.lastIndexOf('.') + 1)
    : null

  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  const failures: RenameOutcome['failures'] = []

  for (const variant of variants) {
    const ext = variant.storagePath.includes('.')
      ? variant.storagePath.slice(variant.storagePath.lastIndexOf('.') + 1)
      : 'bin'
    const dir = path.dirname(variant.storagePath)
    const candidate = dir && dir !== '.' ? `${dir}/${safeName}.${ext}` : `${safeName}.${ext}`
    const newPath = uniqueStoragePath(candidate, imageId)

    const records = db
      .select()
      .from(storageRecords)
      .where(eq(storageRecords.variantId, variant.id))
      .all()

    if (records.length === 0) {
      db.update(imageVariants)
        .set({ storagePath: newPath })
        .where(eq(imageVariants.id, variant.id))
        .run()
      continue
    }

    // 取一份可读源：优先 ready，其次任意
    const sourceRecord = records.find((r) => r.status === 'ready') ?? records[0]!
    const sourceConfig = settings.backends.find((b) => b.id === sourceRecord.backend)

    let buffer: Buffer | null = null
    if (sourceConfig) {
      try {
        buffer = await getAdapter(sourceConfig).download(sourceRecord.path)
      } catch (error) {
        failures.push({
          variantId: variant.id,
          backendId: sourceRecord.backend,
          error: `读取源文件失败：${(error as Error).message}`,
        })
      }
    }

    if (!buffer) continue

    await Promise.all(
      records.map(async (record) => {
        const config = settings.backends.find((b) => b.id === record.backend)
        if (!config) {
          failures.push({
            variantId: variant.id,
            backendId: record.backend,
            error: '后端配置已不存在',
          })
          return
        }
        try {
          const adapter = getAdapter(config)
          const uploaded = await adapter.upload(buffer!, newPath)
          if (record.path !== newPath) {
            await adapter.delete(record.path).catch(() => false)
          }
          db.update(storageRecords)
            .set({ path: newPath, url: uploaded.url, status: 'ready', errorMessage: null })
            .where(eq(storageRecords.id, record.id))
            .run()
        } catch (error) {
          failures.push({
            variantId: variant.id,
            backendId: record.backend,
            error: (error as Error).message,
          })
          db.update(storageRecords)
            .set({ status: 'failed', errorMessage: (error as Error).message.slice(0, 500) })
            .where(eq(storageRecords.id, record.id))
            .run()
        }
      }),
    )

    db.update(imageVariants).set({ storagePath: newPath }).where(eq(imageVariants.id, variant.id)).run()
  }

  db.update(images)
    .set({
      filename: safeName,
      originalName: originalExt ? `${safeName}.${originalExt}` : safeName,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(images.id, imageId))
    .run()

  recomputeImageState(imageId)
  invalidateAccessPathCache()

  return { detail: getImageDetail(imageId, viewer), failures }
}

/* ------------------------------------------------------------------ */
/* 重试同步                                                            */
/* ------------------------------------------------------------------ */

/**
 * 重试失败的同步任务。
 * 传入 backendIds 时表示「为这些后端补充同步」（缺失的记录会被新建）。
 */
export function resetForRetry(imageId: string, backendIds?: string[]): number {
  const variants = db.select().from(imageVariants).where(eq(imageVariants.imageId, imageId)).all()
  if (variants.length === 0) return 0

  let touched = 0

  if (!backendIds || backendIds.length === 0) {
    const result = db
      .update(storageRecords)
      .set({ status: 'pending', errorMessage: null })
      .where(
        and(
          inArray(storageRecords.variantId, variants.map((v) => v.id)),
          sql`${storageRecords.status} <> 'ready'`,
        ),
      )
      .run()
    return result.changes ?? 0
  }

  for (const variant of variants) {
    const existing = db
      .select()
      .from(storageRecords)
      .where(eq(storageRecords.variantId, variant.id))
      .all()

    for (const backendId of backendIds) {
      const record = existing.find((r) => r.backend === backendId)
      if (record) {
        if (record.status !== 'ready') {
          db.update(storageRecords)
            .set({ status: 'pending', errorMessage: null })
            .where(eq(storageRecords.id, record.id))
            .run()
          touched += 1
        }
      } else {
        db.insert(storageRecords)
          .values({
            id: crypto.randomUUID(),
            variantId: variant.id,
            backend: backendId,
            path: variant.storagePath,
            status: 'pending',
          })
          .run()
        touched += 1
      }
    }
  }

  recomputeImageState(imageId)
  return touched
}

/** 同步状态统计（设置页概览） */
export function imageStatusSummary(): { pending: number; ready: number; failed: number } {
  const rows = db
    .select({ status: images.status, count: sql<number>`count(*)` })
    .from(images)
    .groupBy(images.status)
    .all()

  const summary: Record<'pending' | 'ready' | 'failed', number> = {
    pending: 0,
    ready: 0,
    failed: 0,
  }
  for (const row of rows) {
    if (row.status === 'pending' || row.status === 'ready' || row.status === 'failed') {
      summary[row.status] = row.count
    }
  }
  return summary
}
