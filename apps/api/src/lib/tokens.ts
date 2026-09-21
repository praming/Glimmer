import { randomUUID } from 'node:crypto'
import {
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_DISPLAY,
  API_TOKEN_TOUCH_INTERVAL_MS,
  MAX_API_TOKENS,
  type ApiTokenDTO,
  type CreateApiTokenInput,
  type SessionUserDTO,
} from '@glimmer/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { apiTokens, db, users, type ApiTokenRow } from '../db'
import { resolveAvatarUrl } from '../services/avatar'
import { randomToken, sha256Hex } from './crypto'
import { badRequest } from './errors'

/**
 * API Token（P3-2）
 *
 * 供脚本 / 第三方工具调用 REST API 使用，认证走
 * `Authorization: Bearer <token>`，与 Session Cookie 并存。
 *
 * 安全约定：
 * - 明文格式 `glm_<32 字节 base64url>`，**只在创建时返回一次**；
 *   库中仅存 SHA-256 哈希，泄露数据库也无法反推 token。
 * - 支持软撤销（`revoked_at`）与可选过期时间，保留记录便于审计。
 * - `last_used_at` 有 60s 写入节流，避免脚本高频调用造成写放大。
 */

export function toApiTokenDTO(row: ApiTokenRow): ApiTokenDTO {
  const now = new Date().toISOString()
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    active: row.revokedAt === null && (row.expiresAt === null || row.expiresAt > now),
  }
}

export function countActiveTokens(userId: string): number {
  return db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .all().length
}

export function listApiTokens(userId: string): ApiTokenDTO[] {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map(toApiTokenDTO)
}

export function createApiToken(userId: string, input: CreateApiTokenInput): ApiTokenDTO & {
  /** 明文，仅此一次 */
  token: string
} {
  if (countActiveTokens(userId) >= MAX_API_TOKENS) {
    throw badRequest(`最多只能同时拥有 ${MAX_API_TOKENS} 个有效访问令牌，请先撤销不再使用的`)
  }

  const token = `${API_TOKEN_PREFIX}${randomToken()}`
  const id = randomUUID()
  const days = input.expiresInDays ?? 0
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null

  db.insert(apiTokens)
    .values({
      id,
      userId,
      name: input.name,
      tokenHash: sha256Hex(token),
      prefix: token.slice(0, API_TOKEN_PREFIX_DISPLAY),
      expiresAt,
    })
    .run()

  const row = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get()
  if (!row) throw badRequest('访问令牌创建失败')

  return { ...toApiTokenDTO(row), token }
}

/** 软撤销；返回是否确实发生了状态变更 */
export function revokeApiToken(userId: string, tokenId: string): boolean {
  const result = db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
    )
    .run()
  return (result.changes ?? 0) > 0
}

/**
 * 彻底删除令牌记录（区别于软撤销）。
 *
 * 软撤销会把记录一直留在列表里供审计，但已撤销 / 已过期的令牌越积越多时
 * 用户需要能把它们清掉。删除是不可恢复的，前端必须二次确认。
 */
export function deleteApiToken(userId: string, tokenId: string): boolean {
  const result = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .run()
  return (result.changes ?? 0) > 0
}

/** 用户改密 / 被禁用 / 被删除时，连同会话一起让 token 失效 */
export function revokeUserTokens(userId: string): number {
  const result = db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .run()
  return result.changes ?? 0
}

/**
 * 用 Bearer token 解析用户。
 * 未命中 / 已撤销 / 已过期 / 用户被禁用均返回 null。
 */
export function resolveApiToken(token: string): SessionUserDTO | null {
  if (!token) return null

  const row = db
    .select({
      tokenId: apiTokens.id,
      revokedAt: apiTokens.revokedAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      userId: users.id,
      username: users.username,
      role: users.role,
      avatarUrl: users.avatarUrl,
      avatarUpdatedAt: users.avatarUpdatedAt,
      sessionDays: users.sessionDays,
      disabled: users.disabled,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.tokenHash, sha256Hex(token)))
    .get()

  if (!row) return null
  if (row.revokedAt) return null
  if (row.disabled) return null

  const now = Date.now()
  if (row.expiresAt && Date.parse(row.expiresAt) <= now) return null

  // 写入节流：距上次记录超过窗口才更新，避免高频调用把 SQLite 打满
  const lastUsed = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0
  if (!Number.isFinite(lastUsed) || now - lastUsed > API_TOKEN_TOUCH_INTERVAL_MS) {
    db.update(apiTokens)
      .set({ lastUsedAt: new Date(now).toISOString() })
      .where(eq(apiTokens.id, row.tokenId))
      .run()
  }

  return {
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
  }
}

/** 从 Authorization 头解析出 Bearer 值 */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const value = match?.[1]?.trim()
  return value ? value : null
}
