import type { QueueStats } from '@glimmer/shared'
import { eq, ne } from 'drizzle-orm'
import PQueue from 'p-queue'
import { db, imageVariants, images } from '../db'
import { env } from '../env'
import { processImage } from './processor'
import { syncRetrySchedule } from './retry'

/**
 * 基于内存的异步队列（无需 Redis）。
 * 单进程部署下足够；失败任务会保留 storage_records 的错误信息，
 * 并由 P3-4 的自动重试调度器按指数退避重新入队。
 *
 * 显式标注 `PQueue`：其默认泛型参数指向内部模块 `./priority-queue`，
 * 若交给推导，tsc 会在声明可命名性检查时报 TS2742。
 */
export const imageQueue: PQueue = new PQueue({ concurrency: env.QUEUE_CONCURRENCY })

let completed = 0
let failed = 0

async function runJob(imageId: string): Promise<void> {
  try {
    await processImage(imageId)
    completed += 1
  } catch (error) {
    failed += 1
    // eslint-disable-next-line no-console
    console.error(`[glimmer] 图片处理任务失败 image=${imageId}`, error)
    try {
      db.update(images)
        .set({
          status: 'failed',
          errorMessage: `处理异常：${(error as Error).message}`.slice(0, 500),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(images.id, imageId))
        .run()
    } catch {
      /* 忽略二次失败 */
    }
  } finally {
    // 无论成败都要重排重试计划：失败会排出下一次时间，
    // 成功则清空预算，让将来的失败重新拥有完整配额。
    try {
      syncRetrySchedule(imageId)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[glimmer] 同步重试排期失败 image=${imageId}`, error)
    }
  }
}

/** 入队一张图片的处理任务 */
export function enqueueImageProcessing(imageId: string, priority = 0): void {
  void imageQueue.add(() => runJob(imageId), { priority })
}

/** 队列运行状态（设置页 / 健康检查展示） */
export function getQueueStats(): QueueStats {
  return {
    waiting: imageQueue.size,
    active: imageQueue.pending,
    completed,
    failed,
  }
}

/**
 * 启动时恢复未完成的任务：
 * 覆盖「进程重启导致 in-memory 队列丢失」的场景。
 */
export function recoverPendingImages(): number {
  const pendingImages = db
    .select({ id: images.id })
    .from(images)
    .where(eq(images.status, 'pending'))
    .all()

  const pendingVariants = db
    .selectDistinct({ imageId: imageVariants.imageId })
    .from(imageVariants)
    .where(ne(imageVariants.status, 'ready'))
    .all()

  const ids = new Set<string>()
  for (const row of pendingImages) ids.add(row.id)
  for (const row of pendingVariants) ids.add(row.imageId)

  for (const id of ids) enqueueImageProcessing(id)
  return ids.size
}
