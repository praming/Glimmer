import type { SessionUserDTO } from '@glimmer/shared'

/** 请求的认证方式：会话 Cookie 或 API Token */
export type AuthMethod = 'session' | 'token'

/** Hono 上下文变量 */
export interface AppEnv {
  Variables: {
    /** 当前登录用户（requireAuth 中间件注入） */
    user: SessionUserDTO
    /**
     * 当前会话 id。
     * 走 API Token 认证时没有会话，为 `null`。
     */
    sessionId: string | null
    /** 本次请求的认证方式（P3-2） */
    authMethod: AuthMethod
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUserDTO
    sessionId: string | null
    authMethod: AuthMethod
  }
}
