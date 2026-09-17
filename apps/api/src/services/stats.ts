import {
  formatUtcDateOnly,
  type AccessDailyPoint,
  type AccessStatsDTO,
  type BackendStat,
  type SessionUserDTO,
  type StatsQuery,
  type TopImageStat,
} from '@glimmer/shared'
import { sqlite } from '../db'
import { forbidden } from '../lib/errors'
import { getGlobalSettings } from './settings'

/**
 * 访问统计汇总（P3-3）
 *
 * 用少量自包含的聚合 SQL 直接查库：每个查询只出现一次用户过滤条件，
 * 便于阅读与参数化，不必为报表做 Drizzle 的嵌套子查询拼装。
 *
 * 权限：`global` 仅管理员可用；`self` 只看自己；`auto` 按角色自动选择。
 */

interface CountRow {
  n: number
}

function scalar(sql: string, params: unknown[] = []): number {
  const row = sqlite.prepare(sql).get(...params) as CountRow | undefined
  return Number(row?.n ?? 0)
}

function utcDayOffset(offsetDays: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return formatUtcDateOnly(date)
}

export function collectStats(query: StatsQuery, viewer: SessionUserDTO): AccessStatsDTO {
  const scope: 'global' | 'self' =
    query.scope === 'auto' ? (viewer.role === 'admin' ? 'global' : 'self') : query.scope

  if (scope === 'global' && viewer.role !== 'admin') {
    throw forbidden('只有管理员可以查看全局统计')
  }

  /**
   * 用户过滤条件。
   * `1=1` 让所有语句都能统一写成 `WHERE ${userCond}`，无需分支拼接。
   */
  const userCond = scope === 'self' ? 'i.user_id = ?' : '1=1'
  const userParams: string[] = scope === 'self' ? [viewer.id] : []

  /* ------------------------------ 总量 ------------------------------ */

  const imageCount = scalar(`SELECT COUNT(*) AS n FROM images i WHERE ${userCond}`, userParams)

  const variantCount = scalar(
    `SELECT COUNT(*) AS n
       FROM image_variants v JOIN images i ON i.id = v.image_id
      WHERE ${userCond}`,
    userParams,
  )

  const totalBytes = scalar(
    `SELECT COALESCE(SUM(v.size), 0) AS n
       FROM image_variants v JOIN images i ON i.id = v.image_id
      WHERE ${userCond}`,
    userParams,
  )

  const accessedImages = scalar(
    `SELECT COUNT(*) AS n
       FROM image_stats s JOIN images i ON i.id = s.image_id
      WHERE ${userCond}`,
    userParams,
  )

  const totalViews = scalar(
    `SELECT COALESCE(SUM(s.views), 0) AS n
       FROM image_stats s JOIN images i ON i.id = s.image_id
      WHERE ${userCond}`,
    userParams,
  )

  const totalBytesServed = scalar(
    `SELECT COALESCE(SUM(s.bytes_served), 0) AS n
       FROM image_stats s JOIN images i ON i.id = s.image_id
      WHERE ${userCond}`,
    userParams,
  )

  /* --------------------------- 处理状态分布 --------------------------- */

  const statusRows = sqlite
    .prepare(`SELECT i.status AS status, COUNT(*) AS n FROM images i WHERE ${userCond} GROUP BY i.status`)
    .all(...userParams) as Array<{ status: string; n: number }>

  const status: AccessStatsDTO['status'] = { pending: 0, ready: 0, failed: 0 }
  for (const row of statusRows) {
    if (row.status === 'pending' || row.status === 'ready' || row.status === 'failed') {
      status[row.status] = Number(row.n)
    }
  }

  /* --------------------------- 自动重试概况 --------------------------- */

  const retryRow = sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN s.status = 'failed' AND s.next_retry_at IS NOT NULL THEN 1 ELSE 0 END) AS scheduled,
         SUM(CASE WHEN s.status = 'failed' AND s.next_retry_at IS NULL     THEN 1 ELSE 0 END) AS exhausted,
         SUM(CASE WHEN s.status = 'failed'                                  THEN 1 ELSE 0 END) AS failed_records
       FROM storage_records s
       JOIN image_variants v ON v.id = s.variant_id
       JOIN images i ON i.id = v.image_id
      WHERE ${userCond}`,
    )
    .get(...userParams) as
    | { scheduled: number | null; exhausted: number | null; failed_records: number | null }
    | undefined

  /* ----------------------------- 各后端 ----------------------------- */

  const backendRows = sqlite
    .prepare(
      `SELECT
         s.backend AS backend,
         COUNT(*) AS records,
         SUM(CASE WHEN s.status = 'ready'  THEN 1 ELSE 0 END) AS ready,
         SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         COALESCE(SUM(CASE WHEN s.status = 'ready' THEN v.size ELSE 0 END), 0) AS bytes
       FROM storage_records s
       JOIN image_variants v ON v.id = s.variant_id
       JOIN images i ON i.id = v.image_id
      WHERE ${userCond}
      GROUP BY s.backend
      ORDER BY records DESC`,
    )
    .all(...userParams) as Array<{
    backend: string
    records: number
    ready: number
    failed: number
    bytes: number
  }>

  const settings = getGlobalSettings()
  const backends: BackendStat[] = backendRows.map((row) => {
    const config = settings.backends.find((b) => b.id === row.backend)
    return {
      backendId: row.backend,
      name: config?.name ?? row.backend,
      type: config?.type ?? 'local',
      records: Number(row.records),
      ready: Number(row.ready),
      failed: Number(row.failed),
      bytes: Number(row.bytes),
    }
  })

  /* ----------------------------- Top 图片 ----------------------------- */

  const topRows = sqlite
    .prepare(
      `SELECT i.id AS id, i.filename AS filename, i.user_id AS user_id,
              u.username AS username, s.views AS views,
              s.bytes_served AS bytes_served, s.last_access_at AS last_access_at
         FROM image_stats s
         JOIN images i ON i.id = s.image_id
         JOIN users u ON u.id = i.user_id
        WHERE ${userCond} AND s.views > 0
        ORDER BY s.views DESC, s.bytes_served DESC
        LIMIT 10`,
    )
    .all(...userParams) as Array<{
    id: string
    filename: string
    user_id: string
    username: string
    views: number
    bytes_served: number
    last_access_at: string | null
  }>

  const topImages: TopImageStat[] = topRows.map((row) => ({
    id: row.id,
    filename: row.filename,
    userId: row.user_id,
    username: row.username,
    views: Number(row.views),
    bytesServed: Number(row.bytes_served),
    lastAccessAt: row.last_access_at,
  }))

  /* ------------------------------ 趋势 ------------------------------ */

  const days = query.days
  const fromDay = utcDayOffset(-(days - 1))

  const dailyRows = sqlite
    .prepare(
      `SELECT d.day AS day, SUM(d.views) AS views, SUM(d.bytes) AS bytes
         FROM access_daily d
         JOIN images i ON i.id = d.image_id
        WHERE ${userCond} AND d.day >= ?
        GROUP BY d.day
        ORDER BY d.day ASC`,
    )
    .all(...userParams, fromDay) as Array<{ day: string; views: number; bytes: number }>

  const byDay = new Map(dailyRows.map((row) => [row.day, row]))
  const daily: AccessDailyPoint[] = []
  for (let i = 0; i < days; i += 1) {
    const day = utcDayOffset(-(days - 1 - i))
    const row = byDay.get(day)
    daily.push({ day, views: Number(row?.views ?? 0), bytes: Number(row?.bytes ?? 0) })
  }

  return {
    scope,
    days,
    totals: {
      images: imageCount,
      variants: variantCount,
      bytes: totalBytes,
      accessedImages,
      views: totalViews,
      bytesServed: totalBytesServed,
    },
    status,
    retry: {
      scheduled: Number(retryRow?.scheduled ?? 0),
      exhausted: Number(retryRow?.exhausted ?? 0),
      failedRecords: Number(retryRow?.failed_records ?? 0),
    },
    backends,
    topImages,
    daily,
  }
}
