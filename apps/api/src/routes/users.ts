import { createUserSchema, updateUserSchema, type UserDTO } from '@glimmer/shared'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, images, users, type UserRow } from '../db'
import type { AppEnv } from '../lib/context'
import { hashPassword } from '../lib/crypto'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { ok, parseJson } from '../lib/http'
import { purgeExpiredSessions, requireAdmin, revokeUserSessions } from '../lib/session'
import { revokeUserTokens } from '../lib/tokens'
import { deleteImageFiles, purgeImage } from '../services/images'
import { deleteUserPreferences } from '../services/settings'

export const userRoutes = new Hono<AppEnv>()

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function toUserDTO(row: UserRow, imageCount?: number): UserDTO {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageCount,
  }
}

/** 用户名唯一性校验：排除自己后若仍存在同名账号则冲突 */
function assertUsernameAvailable(username: string, excludeId?: string): void {
  const conditions = [eq(users.username, username)]
  if (excludeId) conditions.push(ne(users.id, excludeId))
  const exists = db
    .select({ id: users.id })
    .from(users)
    .where(and(...conditions))
    .get()
  if (exists) throw conflict('该用户名已被占用')
}

function countEnabledAdmins(excludeId?: string): number {
  const conditions = [eq(users.role, 'admin'), eq(users.disabled, false)]
  if (excludeId) conditions.push(ne(users.id, excludeId))
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(...conditions))
    .get()
  return row?.count ?? 0
}

function mustGetUser(id: string): UserRow {
  const row = db.select().from(users).where(eq(users.id, id)).get()
  if (!row) throw notFound('用户不存在')
  return row
}

/* ------------------------------------------------------------------ */
/* GET /api/users                                                      */
/* ------------------------------------------------------------------ */

userRoutes.get('/', requireAdmin, (c) => {
  const rows = db.select().from(users).all()
  const counts = db
    .select({ userId: images.userId, count: sql<number>`count(*)` })
    .from(images)
    .groupBy(images.userId)
    .all()
  const countMap = new Map(counts.map((r) => [r.userId, r.count]))

  const items = rows
    .map((row) => toUserDTO(row, countMap.get(row.id) ?? 0))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return ok(c, { items })
})

/* ------------------------------------------------------------------ */
/* POST /api/users                                                     */
/* ------------------------------------------------------------------ */

userRoutes.post('/', requireAdmin, async (c) => {
  const payload = await parseJson(c, createUserSchema)

  assertUsernameAvailable(payload.username)

  const passwordHash = await hashPassword(payload.password)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  db.insert(users)
    .values({
      id,
      username: payload.username,
      passwordHash,
      role: payload.role,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return ok(c, { user: toUserDTO(mustGetUser(id), 0) }, 201)
})

/* ------------------------------------------------------------------ */
/* PATCH /api/users/:id                                                */
/* ------------------------------------------------------------------ */

userRoutes.patch('/:id', requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const me = c.get('user')
  const payload = await parseJson(c, updateUserSchema)
  const target = mustGetUser(targetId)

  if (payload.role !== undefined && targetId === me.id && payload.role !== 'admin') {
    throw badRequest('不能降级自己的管理员权限')
  }

  if (payload.disabled === true && targetId === me.id) {
    throw badRequest('不能禁用自己的账号')
  }

  const removingAdmin =
    (payload.role !== undefined && payload.role !== 'admin' && target.role === 'admin') ||
    (payload.disabled === true && target.role === 'admin')

  if (removingAdmin && countEnabledAdmins(targetId) === 0) {
    throw forbidden('系统至少需要保留一名启用状态的管理员')
  }

  // 用户名可改（包含管理员自己），但需保持全局唯一
  // 注意：改名不撤销会话 —— 会话与令牌都按 id 绑定，不依赖用户名
  if (payload.username !== undefined && payload.username !== target.username) {
    assertUsernameAvailable(payload.username, targetId)
  }

  const patch: Partial<UserRow> = { updatedAt: new Date().toISOString() }
  if (payload.username !== undefined) patch.username = payload.username
  if (payload.role !== undefined) patch.role = payload.role
  if (payload.disabled !== undefined) patch.disabled = payload.disabled
  if (payload.password !== undefined) patch.passwordHash = await hashPassword(payload.password)

  db.update(users).set(patch).where(eq(users.id, targetId)).run()

  // 改密或禁用后立即失效该用户的会话与 API Token
  if (payload.password !== undefined || payload.disabled === true) {
    revokeUserSessions(targetId)
    revokeUserTokens(targetId)
  }

  return ok(c, { user: toUserDTO(mustGetUser(targetId)) })
})

/* ------------------------------------------------------------------ */
/* DELETE /api/users/:id                                               */
/* ------------------------------------------------------------------ */

userRoutes.delete('/:id', requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const me = c.get('user')

  if (targetId === me.id) throw badRequest('不能删除自己的账号')

  const target = mustGetUser(targetId)

  if (target.role === 'admin' && countEnabledAdmins(targetId) === 0) {
    throw forbidden('系统至少需要保留一名启用状态的管理员')
  }

  // 先清理该用户的图片文件（含所有存储后端），再删除用户
  const owned = db.select({ id: images.id }).from(images).where(eq(images.userId, targetId)).all()
  const failures: string[] = []
  for (const row of owned) {
    const outcome = await deleteImageFiles(row.id)
    for (const failure of outcome.failures) {
      failures.push(`${failure.backendName}:${failure.path}`)
    }
    purgeImage(row.id)
  }

  revokeUserSessions(targetId)
  deleteUserPreferences(targetId)
  db.delete(users).where(eq(users.id, targetId)).run()
  purgeExpiredSessions()

  return ok(c, {
    success: true,
    removedImages: owned.length,
    warnings: failures.length > 0 ? failures : undefined,
  })
})
