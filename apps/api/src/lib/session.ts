import { randomUUID } from 'node:crypto'
import type { SessionUserDTO } from '@glimmer/shared'
import { eq, lte } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db, sessions, users } from '../db'
import { env } from '../env'
import { resolveAvatarUrl } from '../services/avatar'
import type { AppEnv, AuthMethod } from './context'
import { randomToken, sha256Hex } from './crypto'
import { forbidden, unauthorized } from './errors'
import { parseBearer, resolveApiToken } from './tokens'

/* ------------------------------------------------------------------ */
/* 会话生命周期                                                         */
/* ------------------------------------------------------------------ */

export interface CreatedSession {
  id: string
  token: string
  expiresAt: string
}

/**
 * 该用户实际生效的会话有效期（天）。
 *
 * 「个人资料 → 会话有效期」优先；未设置（NULL）时回落到环境变量
 * `SESSION_TTL_DAYS`，这样管理员调整全局默认值能影响所有没单独设置过的账号。
 */
export function resolveSessionDays(userId: string): number {
  const row = db
    .select({ sessionDays: users.sessionDays })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  const days = row?.sessionDays
  return typeof days === 'number' && days > 0 ? days : env.SESSION_TTL_DAYS
}

/** 创建会话，返回明文 token（仅此一次可见，数据库只存哈希） */
export function createSession(userId: string): CreatedSession {
  const token = randomToken()
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + resolveSessionDays(userId) * 86_400_000).toISOString()

  db.insert(sessions)
    .values({ id, userId, tokenHash: sha256Hex(token), expiresAt })
    .run()

  return { id, token, expiresAt }
}

export interface ResolvedSession {
  sessionId: string
  expiresAt: string
  user: SessionUserDTO
}

/** 依 token 解析会话；过期 / 用户被禁用时返回 null 并清理记录 */
export function resolveSession(token: string): ResolvedSession | null {
  if (!token) return null

  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      username: users.username,
      role: users.role,
      avatarUrl: users.avatarUrl,
      avatarUpdatedAt: users.avatarUpdatedAt,
      sessionDays: users.sessionDays,
      disabled: users.disabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, sha256Hex(token)))
    .get()

  if (!row) return null

  if (row.expiresAt <= new Date().toISOString()) {
    db.delete(sessions).where(eq(sessions.id, row.sessionId)).run()
    return null
  }

  if (row.disabled) return null

  return {
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      username: row.username,
      role: row.role,
      // 别名是 userId，而 resolveAvatarUrl 收的是 { id }，此处显式对齐
      avatarUrl: resolveAvatarUrl({
        id: row.userId,
        avatarUrl: row.avatarUrl,
        avatarUpdatedAt: row.avatarUpdatedAt,
      }),
      sessionDays: row.sessionDays ?? null,
    },
  }
}

/** 撤销单个会话 */
export function revokeSession(sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run()
}

/** 撤销某用户全部会话（改密 / 禁用 / 删除时调用） */
export function revokeUserSessions(userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run()
}

/** 清理过期会话 */
export function purgeExpiredSessions(): number {
  const result = db.delete(sessions).where(lte(sessions.expiresAt, new Date().toISOString())).run()
  return result.changes ?? 0
}

/* ------------------------------------------------------------------ */
/* Cookie                                                             */
/* ------------------------------------------------------------------ */

export function setSessionCookie(c: Context, token: string, expiresAt: string): void {
  setCookie(c, env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, env.SESSION_COOKIE_NAME, {
    path: '/',
    secure: env.COOKIE_SECURE,
  })
}

/**
 * 会话有效期被改动后，就地重算当前会话的过期时间并重发 Cookie。
 *
 * 不做这一步的话，用户改完「会话有效期」必须退出重登才会按新时长生效，
 * 而页面上的倒计时却还显示旧值 —— 非常反直觉。
 * 仅对 Cookie 会话有效；用 API Token 认证的请求没有可续期的会话。
 */
export function renewCurrentSession(c: Context): string | null {
  const session = readSession(c)
  if (!session) return null

  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  if (!token) return null

  const expiresAt = new Date(
    Date.now() + resolveSessionDays(session.user.id) * 86_400_000,
  ).toISOString()

  db.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.sessionId)).run()
  setSessionCookie(c, token, expiresAt)
  return expiresAt
}

/** 从请求中读取当前会话（不抛异常） */
export function readSession(c: Context): ResolvedSession | null {
  const token = getCookie(c, env.SESSION_COOKIE_NAME)
  if (!token) return null
  return resolveSession(token)
}

/* ------------------------------------------------------------------ */
/* 统一认证：API Token 优先，其次会话 Cookie                             */
/* ------------------------------------------------------------------ */

export interface ResolvedAuth {
  method: AuthMethod
  /** 会话认证时存在；API Token 认证时为 null */
  sessionId: string | null
  user: SessionUserDTO
}

/**
 * 解析当前请求的认证主体（P3-2）。
 *
 * 顺序：`Authorization: Bearer <token>` → 会话 Cookie。
 * API Token 优先，便于脚本在同一请求上显式指定凭据；
 * 浏览器端不带 Authorization 头，行为与以前完全一致。
 */
export function readAuth(c: Context): ResolvedAuth | null {
  const bearer = parseBearer(c.req.header('authorization'))
  if (bearer) {
    const user = resolveApiToken(bearer)
    return user ? { method: 'token', sessionId: null, user } : null
  }

  const session = readSession(c)
  if (!session) return null
  return { method: 'session', sessionId: session.sessionId, user: session.user }
}

/* ------------------------------------------------------------------ */
/* 中间件                                                              */
/* ------------------------------------------------------------------ */

/** 要求登录（会话 Cookie 或 API Token） */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = readAuth(c)
  if (!auth) throw unauthorized()
  c.set('user', auth.user)
  c.set('sessionId', auth.sessionId)
  c.set('authMethod', auth.method)
  await next()
}

/** 要求管理员（会话 Cookie 或 API Token） */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = readAuth(c)
  if (!auth) throw unauthorized()
  if (auth.user.role !== 'admin') throw forbidden('该操作仅管理员可用')
  c.set('user', auth.user)
  c.set('sessionId', auth.sessionId)
  c.set('authMethod', auth.method)
  await next()
}
