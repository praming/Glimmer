import { formatUtcDateOnly, type LocalBackendConfig } from '@glimmer/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { accessDaily, db, imageStats, imageVariants, images, storageRecords } from '../db'
import { getGlobalSettings } from './settings'

/**
 * 访问统计（P3-3）
 *
 * 计费口径：`/files/*` 静态路由**成功返回文件**时记一次访问。
 *
 * 写入策略：内存聚合 + 定时落盘，而不是每个请求写一次库。
 * 静态文件请求可能非常密集，逐请求写 SQLite 会造成明显的写放大与锁竞争；
 * 这里把 (imageId, UTC 天) 维度的事件先在内存里累加，达到阈值或定时器到期
 * 再合并成一条 UPSERT 写入 `image_stats` 与 `access_daily`。
 *
 * 已知局限（README 有说明）：生产环境若由 Nginx 直接返回 `/files/*`，
 * 请求根本不会到达应用层，此处统计不到；那种部署方式需在 Nginx 侧记录
 * access log 再离线导入。
 */

/* ------------------------------------------------------------------ */
/* 路径 → 图片来源 的解析                                                */
/* ------------------------------------------------------------------ */

export interface AccessTarget {
  imageId: string
  variantId: string
  /** 该变体的产物字节数，用于统计出口流量 */
  size: number
}

/**
 * 缓存已解析的 URL 路径。
 * 磁盘布局：`root/{pathPrefix}/{storage_records.path}`，而 `/files/*`
 * 收到的就是 `{pathPrefix}/{path}`，因此需要按后端的 pathPrefix 逐段剥掉。
 */
const pathCache = new Map<string, AccessTarget | null>()

/** 设置变更 / 重命名 / 删除后清空，避免用旧映射记账 */
export function invalidateAccessPathCache(): void {
  pathCache.clear()
}

const PATH_CACHE_LIMIT = 5000

function stripPrefix(relPath: string, prefix: string): string | null {
  if (!prefix) return relPath
  if (relPath === prefix) return null
  if (!relPath.startsWith(`${prefix}/`)) return null
  return relPath.slice(prefix.length + 1)
}

function resolveTarget(relPath: string): AccessTarget | null {
  const settings = getGlobalSettings()
  const locals = settings.backends.filter(
    (b): b is LocalBackendConfig => b.type === 'local' && b.enabled,
  )
  if (locals.length === 0) return null

  for (const backend of locals) {
    const prefix = (backend.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')
    const candidate = stripPrefix(relPath, prefix)
    if (!candidate) continue

    const row = db
      .select({
        imageId: imageVariants.imageId,
        variantId: imageVariants.id,
        size: imageVariants.size,
      })
      .from(storageRecords)
      .innerJoin(imageVariants, eq(storageRecords.variantId, imageVariants.id))
      .where(and(eq(storageRecords.backend, backend.id), eq(storageRecords.path, candidate)))
      .get()

    if (row) {
      return { imageId: row.imageId, variantId: row.variantId, size: row.size ?? 0 }
    }
  }

  return null
}

/** 解析某次静态请求对应的图片；不存在的路径会被记住以避免重复查询 */
export function lookupAccessTarget(relPath: string): AccessTarget | null {
  const cached = pathCache.get(relPath)
  if (cached !== undefined) return cached

  const resolved = resolveTarget(relPath)
  if (pathCache.size >= PATH_CACHE_LIMIT) pathCache.clear()
  pathCache.set(relPath, resolved)
  return resolved
}

/* ------------------------------------------------------------------ */
/* 内存聚合 + 定时落盘                                                   */
/* ------------------------------------------------------------------ */

/** 落盘间隔 */
const FLUSH_INTERVAL_MS = 5_000
/** 聚合键数量达到该值时立即落盘（高并发场景防止内存堆积） */
const FLUSH_MAX_KEYS = 200

interface PendingBucket {
  imageId: string
  day: string
  views: number
  bytes: number
}

const pending = new Map<string, PendingBucket>()
let flushTimer: NodeJS.Timeout | null = null

function ensureFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    flushAccessStats()
  }, FLUSH_INTERVAL_MS)
  // 定时器不应阻止进程退出
  flushTimer.unref()
}

/** 记一次访问（由 /files/* 路由在成功返回后调用，同步、极轻） */
export function recordAccess(target: AccessTarget, bytes: number): void {
  const day = formatUtcDateOnly()
  const key = `${target.imageId}|${day}`
  const bucket = pending.get(key)

  if (bucket) {
    bucket.views += 1
    bucket.bytes += bytes
  } else {
    pending.set(key, { imageId: target.imageId, day, views: 1, bytes })
  }

  ensureFlushTimer()

  if (pending.size >= FLUSH_MAX_KEYS) {
    flushAccessStats()
  }
}

/**
 * 把内存中的聚合结果合并写库。
 * 返回写入的聚合键数量（便于日志 / 测试断言）。
 */
export function flushAccessStats(): number {
  if (pending.size === 0) return 0

  const buckets = [...pending.values()]
  pending.clear()

  // 图片可能在落盘前被删除；跳过不存在的 id，避免外键约束失败
  const ids = [...new Set(buckets.map((b) => b.imageId))]
  const alive = new Set(
    db
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, ids))
      .all()
      .map((row) => row.id),
  )

  const valid = buckets.filter((b) => alive.has(b.imageId))
  if (valid.length === 0) return 0

  const now = new Date().toISOString()

  // drizzle 的 better-sqlite3 事务是同步执行 + 立即提交，
  // 回调里必须用 tx 实例，而不是外层的 db。
  db.transaction((tx) => {
    for (const row of valid) {
      tx.insert(imageStats)
        .values({
          imageId: row.imageId,
          views: row.views,
          bytesServed: row.bytes,
          lastAccessAt: now,
        })
        .onConflictDoUpdate({
          target: imageStats.imageId,
          set: {
            views: sql`${imageStats.views} + ${row.views}`,
            bytesServed: sql`${imageStats.bytesServed} + ${row.bytes}`,
            lastAccessAt: now,
          },
        })
        .run()

      tx.insert(accessDaily)
        .values({ imageId: row.imageId, day: row.day, views: row.views, bytes: row.bytes })
        .onConflictDoUpdate({
          target: [accessDaily.imageId, accessDaily.day],
          set: {
            views: sql`${accessDaily.views} + ${row.views}`,
            bytes: sql`${accessDaily.bytes} + ${row.bytes}`,
          },
        })
        .run()
    }
  })

  return valid.length
}

/** 进程退出前调用，保证最后一次统计不丢 */
export function stopAccessRecorder(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  flushAccessStats()
}
