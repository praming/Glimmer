import { changePasswordSchema, loginSchema, updateProfileSchema } from '@glimmer/shared'
import { and, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, users } from '../db'
import type { AppEnv } from '../lib/context'
import { hashPassword, verifyPassword } from '../lib/crypto'
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors'
import { ok, parseJson } from '../lib/http'
import {
  assertNotLimited,
  clearLimits,
  clearLoginAccountLimit,
  loginLimitSubjects,
  passwordLimitSubjects,
  recordFailureOn,
} from '../lib/rate-limit'
import {
  clearSessionCookie,
  createSession,
  readAuth,
  readSession,
  renewCurrentSession,
  requireAuth,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from '../lib/session'
import { revokeUserTokens } from '../lib/tokens'
import { removeAvatarFile, resolveAvatarUrl } from '../services/avatar'
import { getUserPreferences } from '../services/settings'

export const authRoutes = new Hono<AppEnv>()

/* ------------------------------------------------------------------ */
/* POST /api/auth/login                                                */
/* ------------------------------------------------------------------ */

authRoutes.post('/login', async (c) => {
  const { username, password } = await parseJson(c, loginSchema)

  // 限流必须在密码校验之前：否则攻击者仍能靠 Argon2id 把 CPU 打满
  const limits = loginLimitSubjects(c, username)
  assertNotLimited(c, limits)

  const user = db.select().from(users).where(eq(users.username, username)).get()
  // 统一的错误文案，避免暴露「用户名是否存在」
  // （用户名不存在也算一次失败，否则可以零成本枚举用户名）
  if (!user) {
    recordFailureOn(limits)
    throw unauthorized('用户名或密码不正确')
  }
  if (user.disabled) throw unauthorized('账号已被禁用，请联系管理员')

  const valid = await verifyPassword(user.passwordHash, password)
  if (!valid) {
    recordFailureOn(limits)
    throw unauthorized('用户名或密码不正确')
  }

  // 登录成功：清掉该账号的失败计数，但保留 IP 维度的累计
  clearLoginAccountLimit(username)

  const session = createSession(user.id)
  setSessionCookie(c, session.token, session.expiresAt)

  return ok(c, {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      avatarUrl: resolveAvatarUrl(user),
      sessionDays: user.sessionDays ?? null,
    },
    preferences: getUserPreferences(user.id),
    expiresAt: session.expiresAt,
  })
})

/* ------------------------------------------------------------------ */
/* POST /api/auth/logout                                               */
/* ------------------------------------------------------------------ */

authRoutes.post('/logout', async (c) => {
  const session = readSession(c)
  if (session) revokeSession(session.sessionId)
  clearSessionCookie(c)
  return ok(c, { success: true })
})

/* ------------------------------------------------------------------ */
/* GET /api/auth/me                                                    */
/* ------------------------------------------------------------------ */

authRoutes.get('/me', async (c) => {
  // 用 readAuth 而非 readSession：让脚本带 Bearer token 也能识别自己
  const auth = readAuth(c)
  if (!auth) {
    return ok(c, { user: null, preferences: null })
  }
  return ok(c, {
    user: auth.user,
    preferences: getUserPreferences(auth.user.id),
  })
})

/* ------------------------------------------------------------------ */
/* PATCH /api/auth/me —— 修改自己的用户名 / 头像 / 会话有效期            */
/* ------------------------------------------------------------------ */

authRoutes.patch('/me', requireAuth, async (c) => {
  const me = c.get('user')
  const payload = await parseJson(c, updateProfileSchema)

  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() }

  if (payload.username !== undefined && payload.username !== me.username) {
    // 用户名全局唯一：改名时排除自己
    const taken = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, payload.username), ne(users.id, me.id)))
      .get()
    if (taken) throw conflict('该用户名已被占用')
    patch.username = payload.username
  }

  if (payload.avatarUrl !== undefined) {
    const next = payload.avatarUrl.trim()
    if (next === '') {
      // 空串 = 清除头像：外链与本地文件一起清，真正回到用户名首字母占位
      patch.avatarUrl = null
      patch.avatarUpdatedAt = null
    } else {
      // 外链与本地头像互斥：显式指定外链即放弃本地上传的那张
      // （两个来源同时存在会让「到底显示哪个」变得不可预测，见 services/avatar.ts）
      patch.avatarUrl = next
      patch.avatarUpdatedAt = null
      await removeAvatarFile(me.id)
    }
  }

  if (payload.sessionDays !== undefined) {
    patch.sessionDays = payload.sessionDays
  }

  db.update(users).set(patch).where(eq(users.id, me.id)).run()

  const row = db.select().from(users).where(eq(users.id, me.id)).get()
  if (!row) throw notFound('用户不存在')

  // 会话有效期一改，立刻给当前会话续期并重发 Cookie：
  // 否则用户必须退出重登才会按新时长生效，而界面上还显示着旧值。
  const sessionExpiresAt = payload.sessionDays !== undefined ? renewCurrentSession(c) : null

  // 改名不撤销会话：会话与令牌都按用户 id 绑定
  return ok(c, {
    user: {
      id: row.id,
      username: row.username,
      role: row.role,
      avatarUrl: resolveAvatarUrl(row),
      sessionDays: row.sessionDays ?? null,
    },
    sessionExpiresAt,
  })
})

/* ------------------------------------------------------------------ */
/* POST /api/auth/password —— 修改自己的密码                            */
/* ------------------------------------------------------------------ */

authRoutes.post('/password', requireAuth, async (c) => {
  const me = c.get('user')
  const { currentPassword, newPassword } = await parseJson(c, changePasswordSchema)

  // 已登录会话同样要限流：否则拿到一个未锁屏的浏览器就能无限暴破当前密码
  const limits = passwordLimitSubjects(c, me.id)
  assertNotLimited(c, limits)

  const row = db.select().from(users).where(eq(users.id, me.id)).get()
  if (!row) throw notFound('用户不存在')

  const valid = await verifyPassword(row.passwordHash, currentPassword)
  if (!valid) {
    recordFailureOn(limits)
    throw badRequest('当前密码不正确')
  }

  if (currentPassword === newPassword) throw badRequest('新密码不能与当前密码相同')

  clearLimits(limits)

  const passwordHash = await hashPassword(newPassword)
  db.update(users)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, me.id))
    .run()

  // 修改密码后让所有旧会话失效，并为当前设备补发一个新会话。
  // 同时撤销全部 API Token —— 改密码往往正是为了切断已泄露的凭据，
  // 若保留 token 会让攻击者继续持有访问权。
  revokeUserSessions(me.id)
  const revokedTokens = revokeUserTokens(me.id)
  const session = createSession(me.id)
  setSessionCookie(c, session.token, session.expiresAt)

  return ok(c, {
    success: true,
    revokedTokens,
    message:
      revokedTokens > 0
        ? `密码已更新，其他设备需重新登录，${revokedTokens} 个访问令牌已一并撤销`
        : '密码已更新，其他设备需重新登录',
  })
})
