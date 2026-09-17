import { statsQuerySchema } from '@glimmer/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../lib/context'
import { ok, parseQuery } from '../lib/http'
import { requireAuth } from '../lib/session'
import { collectStats } from '../services/stats'

/**
 * 访问统计（P3-3）
 *
 * `GET /api/stats?days=30&scope=auto`
 * - `scope=auto`（默认）：管理员看全局，普通成员只看自己
 * - `scope=global`：仅管理员可用
 */
export const statsRoutes = new Hono<AppEnv>()

statsRoutes.get('/', requireAuth, (c) => {
  const query = parseQuery(c, statsQuerySchema)
  return ok(c, collectStats(query, c.get('user')))
})
