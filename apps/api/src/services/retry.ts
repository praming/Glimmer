import {
  RETRY_BACKOFF_FACTOR,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  RETRY_SCAN_INTERVAL_MS,
} from '@glimmer/shared'
import { eq, inArray } from 'drizzle-orm'
import { db, imageVariants, images, sqlite, storageRecords, type StorageRecordRow } from '../db'
import { ensureSourceAvailable } from './processor'

/**
 * 失败任务自动重试（P3-4）
 *
 * 调度模型：
 *
 * - **后端同步失败**以 `storage_records.next_retry_at` 为准（逐后端退避排期）。
 * - **纯处理失败**（sharp 渲染失败、临时原图缺失等没有存储记录的情况）
 *   以 `images.next_retry_at` 为准。
 * - `images.next_retry_at` 始终冗余保存「其失败记录中最早的那个时间」，
 *   扫描器因此只需一次 SQL 就能找出待重试的图片，不必做运行期聚合。
 *
 * 预算：指数退避 30s → 2m → 8m → 32m，共 4 次自动重试（合计 5 次尝试）。
 * 耗尽后 `next_retry_at` 置为 null，转为「需人工介入」，
 * 由详情页的「重试同步」按钮手动重试 —— 手动重试会**重置预算**。
 *
 * 为什么不立刻重试：多后端同时故障（网络抖动、S3 限流、WebDAV 重启）
 * 是最常见的失败原因，立即重试大概率再次失败并白烧一次 sharp 渲染；
 * 退避给外部依赖恢复留出时间。
 *
 * 依赖方向：本模块只依赖 `processor`（取回原图），入队函数由调用方注入，
 * 避免与 `queue` 形成循环依赖。
 */

/** 自动重试次数上限（不含首次尝试） */
export const MAX_RETRY_ATTEMPTS = RETRY_MAX_ATTEMPTS

/** 第 attemptCount 次尝试失败后，距离下次重试的毫秒数 */
export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1)
  const delay = RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** exponent
  return Math.min(delay, RETRY_MAX_DELAY_MS)
}

/** 已尝试 attemptCount 次后的下次重试时间；超出预算返回 null（不再自动重试） */
export function nextRetryAtFor(attemptCount: number, from = Date.now()): string | null {
  if (attemptCount > MAX_RETRY_ATTEMPTS) return null
  return new Date(from + retryDelayMs(attemptCount)).toISOString()
}

/** 图片的全部存储记录 */
function recordsOf(imageId: string): StorageRecordRow[] {
  const variants = db
    .select({ id: imageVariants.id })
    .from(imageVariants)
    .where(eq(imageVariants.imageId, imageId))
    .all()
  if (variants.length === 0) return []

  return db
    .select()
    .from(storageRecords)
    .where(inArray(storageRecords.variantId, variants.map((v) => v.id)))
    .all()
}

/**
 * 一次处理任务结束后同步重试排期。
 * 由队列在任务尾声调用（成功与失败路径都要调）。
 */
export function syncRetrySchedule(imageId: string): void {
  const image = db.select().from(images).where(eq(images.id, imageId)).get()
  if (!image) return

  const now = new Date().toISOString()
  const records = recordsOf(imageId)

  /** 本轮同步后失败记录的下次重试时间集合 */
  const upcoming: string[] = []
  let anyFailed = false

  for (const record of records) {
    if (record.status === 'ready') {
      // 恢复成功：清掉排期
      if (record.nextRetryAt !== null) {
        db.update(storageRecords)
          .set({ nextRetryAt: null })
          .where(eq(storageRecords.id, record.id))
          .run()
      }
      continue
    }

    if (record.status !== 'failed') continue

    anyFailed = true
    const attempts = record.attemptCount + 1
    const next = nextRetryAtFor(attempts)

    db.update(storageRecords)
      .set({ attemptCount: attempts, lastAttemptAt: now, nextRetryAt: next })
      .where(eq(storageRecords.id, record.id))
      .run()

    if (next) upcoming.push(next)
  }

  // 图片级排期 = 失败记录中最早的下次时间
  upcoming.sort()
  let imageAttempts = image.retryAttempts
  let imageNext: string | null = upcoming[0] ?? null

  // 没有任何存储记录的「纯处理失败」走图片级预算
  if (image.status === 'failed' && records.length === 0) {
    imageAttempts += 1
    imageNext = nextRetryAtFor(imageAttempts)
  }

  // 已完全恢复：清空重试状态，让下次失败重新拥有完整预算
  const fullyRecovered =
    image.status === 'ready' && (records.length === 0 || !anyFailed)
  if (fullyRecovered) {
    imageAttempts = 0
    imageNext = null
  }

  if (imageAttempts !== image.retryAttempts || imageNext !== image.nextRetryAt) {
    db.update(images)
      .set({ retryAttempts: imageAttempts, nextRetryAt: imageNext, updatedAt: now })
      .where(eq(images.id, imageId))
      .run()
  }
}

/* ------------------------------------------------------------------ */
/* 扫描与重派                                                          */
/* ------------------------------------------------------------------ */

/** 入队函数由调用方注入（通常就是 queue 的 enqueueImageProcessing） */
export type RequeueFn = (imageId: string, priority?: number) => void

/**
 * 找出到期待重试的图片 id。
 * 两种来源合并：失败的后端记录到期，或图片自身的（纯处理失败）排期到期。
 */
export function findDueImageIds(now = new Date().toISOString(), limit = 50): string[] {
  const rows = sqlite
    .prepare(
      `SELECT id FROM (
         SELECT i.id AS id, MIN(s.next_retry_at) AS due
           FROM storage_records s
           JOIN image_variants v ON v.id = s.variant_id
           JOIN images i ON i.id = v.image_id
          WHERE s.status = 'failed' AND s.next_retry_at IS NOT NULL AND s.next_retry_at <= ?
          GROUP BY i.id
         UNION
         SELECT i.id AS id, i.next_retry_at AS due
           FROM images i
          WHERE i.status = 'failed' AND i.next_retry_at IS NOT NULL AND i.next_retry_at <= ?
       )
       ORDER BY due ASC
       LIMIT ?`,
    )
    .all(now, now, limit) as Array<{ id: string }>

  return rows.map((row) => row.id)
}

export interface RetryScanResult {
  scanned: number
  requeued: number
  skipped: number
}

/**
 * 扫描一次：把到期的失败记录重置为 pending，恢复原图后重新入队。
 *
 * 刻意**不重置** `attempt_count` —— 预算必须继续消耗，否则会变成无限重试。
 * 只有手动重试（POST /api/images/:id/retry）才清零预算。
 */
export async function runRetryScan(
  requeue: RequeueFn,
  now = new Date().toISOString(),
): Promise<RetryScanResult> {
  const ids = findDueImageIds(now)
  if (ids.length === 0) return { scanned: 0, requeued: 0, skipped: 0 }

  let requeued = 0
  let skipped = 0

  for (const imageId of ids) {
    const due = recordsOf(imageId).filter(
      (r) => r.status === 'failed' && r.nextRetryAt !== null && r.nextRetryAt <= now,
    )

    for (const record of due) {
      db.update(storageRecords)
        .set({ status: 'pending', errorMessage: null, nextRetryAt: null })
        .where(eq(storageRecords.id, record.id))
        .run()
    }

    // 先清空图片自身的排期，避免下一轮扫描重复拾取同一张图
    db.update(images)
      .set({ nextRetryAt: null, updatedAt: now })
      .where(eq(images.id, imageId))
      .run()

    // 临时原图常常已在首次成功后清理，先从任一就绪后端取回
    const available = await ensureSourceAvailable(imageId)
    if (!available) {
      skipped += 1
      continue
    }

    requeue(imageId, 0)
    requeued += 1
  }

  return { scanned: ids.length, requeued, skipped }
}

let scanTimer: NodeJS.Timeout | null = null

/** 启动定时扫描（默认 15s 一次，不阻止进程退出） */
export function startRetryScheduler(requeue: RequeueFn): void {
  if (scanTimer) return
  scanTimer = setInterval(() => {
    void runRetryScan(requeue).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[glimmer] 自动重试扫描失败', error)
    })
  }, RETRY_SCAN_INTERVAL_MS)
  scanTimer.unref()
}

export function stopRetryScheduler(): void {
  if (!scanTimer) return
  clearInterval(scanTimer)
  scanTimer = null
}

/* ------------------------------------------------------------------ */
/* 手动重试：重置预算                                                    */
/* ------------------------------------------------------------------ */

/** 清零某图片下所有未成功记录的重试计数与排期（手动重试时调用） */
export function resetRecordBudget(imageId: string): number {
  const failed = recordsOf(imageId).filter((r) => r.status !== 'ready')
  if (failed.length === 0) return 0

  const result = db
    .update(storageRecords)
    .set({ attemptCount: 0, lastAttemptAt: null, nextRetryAt: null })
    .where(
      inArray(
        storageRecords.id,
        failed.map((r) => r.id),
      ),
    )
    .run()

  return result.changes ?? 0
}

/** 重置图片级重试预算（手动重试时调用，让自动重试重新获得完整配额） */
export function resetImageBudget(imageId: string): void {
  db.update(images)
    .set({ retryAttempts: 0, nextRetryAt: null })
    .where(eq(images.id, imageId))
    .run()
}
