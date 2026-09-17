import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { env } from '../env'
import { tooManyRequests } from './errors'

/**
 * 轻量内存限流器 —— 给登录 / 改密这类可被爆破的接口兜底。
 *
 * 设计取舍（都踩过坑）：
 *
 * 1. **只统计失败次数**，不统计请求次数。正常用户连续成功登录永远不会被误伤，
 *    因此不需要为「正常但频繁」的场景预留额度，也不会在局域网里互相误伤。
 * 2. **双维度计数**：既按来源 IP 计（防单机喷洒大量账号），
 *    也按「IP + 账号」计（防用 IP 池慢速磨同一个账号）。任一维度超限即拒绝。
 * 3. **登录只清账号维度**：成功登录后清掉 `IP|账号` 的失败数，但**保留 IP 维度**。
 *    否则攻击者只要掌握任意一个有效账号，就能靠它不断重置自己的 IP 配额。
 *    代价是「同一 IP 打错 N 次」在窗口内不会被成功登录赦免 —— 这是刻意选的更严一侧。
 * 4. **额度按进程内存保存**：本项目是 2~3 人私用 + 单实例部署，重启即清零，
 *    这正是我们想要的行为（运维不会因为忘了密码把自己永久锁在门外）。
 *    ⚠️ 若将来横向扩成多实例，额度会被实例数放大，届时应换成 Redis 之类共享存储。
 * 5. **拒绝发生在密码校验之前**，否则攻击者仍可借 Argon2id 把 CPU 打满。
 */

interface Bucket {
  /** 窗口内累计失败次数 */
  failures: number
  /** 窗口结束时间戳（ms）；到点后整桶作废 */
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** 超过此规模就顺手清一遍过期条目，避免长跑进程内存无界增长 */
const SWEEP_THRESHOLD = 512

export interface RateLimitRule {
  /** 窗口内允许的最大失败次数 */
  max: number
  /** 窗口长度（毫秒） */
  windowMs: number
}

export interface RateLimitState {
  /** 是否已达上限（应当拒绝本次请求） */
  blocked: boolean
  /** 还需要等待多少秒；未阻断时为 0 */
  retryAfterSeconds: number
}

/** 某个计数键 + 其适用规则 */
export interface LimitSubject {
  key: string
  rule: RateLimitRule
}

/** 登录 / 改密共用的规则（数值来自环境变量，见 env.ts） */
export const authRateLimits = {
  perIp: {
    max: env.AUTH_RATE_LIMIT_MAX_PER_IP,
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
  },
  perAccount: {
    max: env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT,
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
  },
} as const satisfies Record<string, RateLimitRule>

function sweep(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

function liveBucket(key: string, rule: RateLimitRule, now: number): Bucket | null {
  const bucket = buckets.get(key)
  if (!bucket) return null
  if (bucket.resetAt <= now) {
    // 窗口已过：清掉，让计数重新开始
    buckets.delete(key)
    return null
  }
  return bucket
}

/** 读取状态，无副作用（过期的桶视为空） */
export function inspectLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitState {
  const bucket = liveBucket(key, rule, now)
  if (!bucket || bucket.failures < rule.max) return { blocked: false, retryAfterSeconds: 0 }
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  }
}

/**
 * 记一次失败。窗口内的第一次失败会开一个新桶；
 * 注意计数一旦达到 max，**桶的到期时间不再顺延** —— 否则攻击者只要持续尝试
 * 就能把窗口无限推后，形成永久封锁（对真实用户是灾难）。
 */
export function recordFailure(key: string, rule: RateLimitRule, now = Date.now()): RateLimitState {
  sweep(now)

  const bucket = liveBucket(key, rule, now)
  if (bucket) {
    bucket.failures += 1
  } else {
    buckets.set(key, { failures: 1, resetAt: now + rule.windowMs })
  }

  return inspectLimit(key, rule, now)
}

/** 清空某个键（登录成功后调用） */
export function clearLimit(key: string): void {
  buckets.delete(key)
}

/** 取出第一个已超限的维度；都没超限返回 null */
export function firstBlocked(subjects: readonly LimitSubject[]): RateLimitState | null {
  for (const { key, rule } of subjects) {
    const state = inspectLimit(key, rule)
    if (state.blocked) return state
  }
  return null
}

/** 记下所有维度的失败 */
export function recordFailureOn(subjects: readonly LimitSubject[]): void {
  for (const { key, rule } of subjects) recordFailure(key, rule)
}

/** 清空所有维度（校验通过后调用） */
export function clearLimits(subjects: readonly LimitSubject[]): void {
  for (const { key } of subjects) clearLimit(key)
}

/**
 * 已超限就直接抛 429，并附上 `Retry-After`（秒）。
 * 放在 handler 最前面，确保没有做任何昂贵工作（如 Argon2 校验）。
 */
export function assertNotLimited(c: Context, subjects: readonly LimitSubject[]): void {
  const blocked = firstBlocked(subjects)
  if (!blocked) return
  c.header('Retry-After', String(blocked.retryAfterSeconds))
  throw tooManyRequests(
    `尝试过于频繁，请在 ${blocked.retryAfterSeconds} 秒后重试`,
    { retryAfterSeconds: blocked.retryAfterSeconds },
  )
}

/* ------------------------------------------------------------------ */
/* 来源 IP                                                             */
/* ------------------------------------------------------------------ */

interface NodeIncoming {
  incoming?: { socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string } }
}

/**
 * 取请求来源 IP 作为限流键。
 *
 * - 默认用 TCP 层真实地址（`getConnInfo`），**不信任** `X-Forwarded-For`；
 *   否则直接暴露 API 端口时，攻击者只要伪造该头就能一句话换一个「IP」绕过限流。
 * - 反向代理（Nginx）场景把 `TRUST_PROXY=true` 打开：此时 API 只在容器内网可达，
 *   外部请求的 `X-Forwarded-For` 由 Nginx 覆写，无法伪造。
 */
export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const realIp = c.req.header('x-real-ip')?.trim()
    if (realIp) return realIp
  }

  try {
    const address = getConnInfo(c).remote.address
    if (address) return address
  } catch {
    /* 非 Node 适配器（如测试环境）下 getConnInfo 会抛错，回落到下面的兜底 */
  }

  const binding = (c.env as NodeIncoming | undefined)?.incoming
  return binding?.socket?.remoteAddress ?? binding?.connection?.remoteAddress ?? 'unknown'
}

/** 归一化成限流键，避免超长或含分隔符的输入污染键空间 */
function normalize(value: string): string {
  return value.trim().toLowerCase().slice(0, 64)
}

/** 登录接口的两个限流维度（account 键刻意不含 IP，见文件头第 2 点） */
export function loginLimitSubjects(c: Context, username: string): LimitSubject[] {
  return [
    { key: `login:ip:${normalize(clientIp(c))}`, rule: authRateLimits.perIp },
    { key: `login:acct:${normalize(username)}`, rule: authRateLimits.perAccount },
  ]
}

/** 登录成功：只清账号维度（见文件头第 3 点） */
export function clearLoginAccountLimit(username: string): void {
  clearLimit(`login:acct:${normalize(username)}`)
}

/** 改密接口按「用户 + IP」限流，防止用已登录会话暴破当前密码 */
export function passwordLimitSubjects(c: Context, userId: string): LimitSubject[] {
  return [
    { key: `password:user:${normalize(userId)}`, rule: authRateLimits.perAccount },
    { key: `password:ip:${normalize(clientIp(c))}`, rule: authRateLimits.perIp },
  ]
}
