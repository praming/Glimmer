import {
  AVATAR_MAX_BYTES,
  createUserSchema,
  updateUserSchema,
  type SessionUserDTO,
  type UserDTO,
} from '@glimmer/shared'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, images, users, type UserRow } from '../db'
import type { AppEnv } from '../lib/context'
import { hashPassword } from '../lib/crypto'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors'
import { pickFile, readFormData } from '../lib/form'
import { ok, parseJson } from '../lib/http'
import {
  purgeExpiredSessions,
  requireAdmin,
  requireAuth,
  revokeUserSessions,
} from '../lib/session'
import { revokeUserTokens } from '../lib/tokens'
import {
  readAvatarFile,
  removeAvatarFile,
  resolveAvatarUrl,
  saveAvatar,
} from '../services/avatar'
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
    avatarUrl: resolveAvatarUrl(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageCount,
  }
}

/**
 * 自助接口（本人操作）返回的用户结构。
 *
 * 与 `routes/auth.ts` 的登录 / `PATCH /api/auth/me` 回包保持**完全一致** ——
 * 前端会把这些回包直接塞回 `auth.user`，字段一旦错位就会表现为
 * 「改完头像后用户名少了」「会话有效期重置了」这类难查的现象。
 * 其中最容易写错的是 `avatarUrl`（本地头像需要现算地址），已收口到 `resolveAvatarUrl`。
 */
function toSelfDTO(row: UserRow): SessionUserDTO {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    avatarUrl: resolveAvatarUrl(row),
    sessionDays: row.sessionDays ?? null,
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
  // 本地头像文件独立于图库（见 services/avatar.ts），删用户时要一并清掉，
  // 否则会留下永远无人引用的孤儿文件（用户 id 是 UUID，删号后不会再有请求指向它）
  await removeAvatarFile(targetId)
  db.delete(users).where(eq(users.id, targetId)).run()
  purgeExpiredSessions()

  return ok(c, {
    success: true,
    removedImages: owned.length,
    warnings: failures.length > 0 ? failures : undefined,
  })
})

/* ------------------------------------------------------------------ */
/* 头像：GET / POST / DELETE /api/users/:id/avatar                      */
/* ------------------------------------------------------------------ */

/*
 * ── 为什么不复用图库 ────────────────────────────────────────────────────
 * 旧实现是「从图库挑一张」，把上传时那一刻的**图片直链快照**写进 `users.avatar_url`。
 * 改过对外域名或路径前缀之后这个地址就整体失效，而 `cli/rebuild-urls.ts` 只重建
 * `storage_records`、从不碰 users 表 —— 于是头像会在**所有设备上同时坏掉**
 * （文件其实还在图库里，只是地址过时了），极难自查。
 *
 * 现在头像走独立通道：上传 → sharp 裁成 1:1 → 落到 `paths.avatars`（数据库同级目录），
 * 对外地址由服务端按「用户 id + 版本号」现算，见 `services/avatar.ts#resolveAvatarUrl`。
 * 该地址与域名、路径前缀、存储后端**全部无关**，因此不存在过期问题。
 *
 * 权限：读要登录（头像只出现在已登录界面里）；写**仅限本人** ——
 * 管理员改不了别人的头像，避免「管理后台能冒充任意成员」的隐忧。
 */

/** GET —— 返回本地头像文件（未上传过 / 已改用外链时回 404，前端回落首字母占位） */
userRoutes.get('/:id/avatar', requireAuth, async (c) => {
  const targetId = c.req.param('id')

  const row = db
    .select({
      avatarUrl: users.avatarUrl,
      avatarUpdatedAt: users.avatarUpdatedAt,
    })
    .from(users)
    .where(eq(users.id, targetId))
    .get()
  if (!row) throw notFound('用户不存在')

  // 外链优先：用户显式填了外链就不该再返回旧的本地图（正常路径上传时会互相清理，
  // 但外链可能是之后通过 PATCH /api/auth/me 设置的，这里以数据库为准更可靠）
  if (row.avatarUrl?.trim()) throw notFound('该用户未使用本站头像')

  const file = await readAvatarFile(targetId)
  if (!file) throw notFound('该用户尚未上传头像')

  // 版本号（上传时间戳）本身就是天然的 ETag：重新上传必然改变它，
  // 而地址里的 ?v= 也随之改变，因此可以放心用一年强缓存。
  const etag = `"${row.avatarUpdatedAt ?? 'local'}"`
  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304, { ETag: etag })
  }

  // Hono 的 c.body 只接受 string | ArrayBuffer | ReadableStream，
  // 而 Node 的 Buffer 视图可能落在共享内存池的中间段，必须按 byteOffset 切出真正的窗口
  const bytes = file.bytes
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  return c.body(arrayBuffer, 200, {
    'Content-Type': file.contentType,
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  })
})

/** POST —— 上传本地头像（仅本人）。成功后清空外链，保证「最后一次操作生效」 */
userRoutes.post('/:id/avatar', requireAuth, async (c) => {
  const targetId = c.req.param('id')
  const me = c.get('user')
  if (targetId !== me.id) throw forbidden('只能修改自己的头像')

  const form = await readFormData(c)
  const file = pickFile(form, 'file', 'avatar', 'files')
  if (!file) throw badRequest('请选择一张图片作为头像')

  // 先按声明的 size 拦一道：file.size 来自 multipart 头，比读进内存再判断便宜得多
  if (file.size === 0) throw badRequest('头像文件为空')
  if (file.size > AVATAR_MAX_BYTES) {
    throw badRequest(`头像不能超过 ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB`)
  }

  const saved = await saveAvatar(targetId, Buffer.from(await file.arrayBuffer()))

  db.update(users)
    .set({
      // 本地头像与外部链接互斥：上传即视为放弃外链（见 services/avatar.ts 顶部说明）
      avatarUrl: null,
      avatarUpdatedAt: saved.updatedAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetId))
    .run()

  return ok(c, { user: toSelfDTO(mustGetUser(targetId)) })
})

/** DELETE —— 清除头像（本地文件 + 外链一起清），回到用户名首字母占位 */
userRoutes.delete('/:id/avatar', requireAuth, async (c) => {
  const targetId = c.req.param('id')
  const me = c.get('user')
  if (targetId !== me.id) throw forbidden('只能修改自己的头像')

  // 两者互斥，所以「清除」一定是全清 —— 只清本地文件的话，用着外链的人
  // 点「移除头像」会毫无反应，很反直觉
  await removeAvatarFile(targetId)

  db.update(users)
    .set({
      avatarUrl: null,
      avatarUpdatedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, targetId))
    .run()

  return ok(c, { user: toSelfDTO(mustGetUser(targetId)) })
})
