import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * 统一的业务异常。抛出后由 app.ts 的 onError 转换为 JSON 响应。
 */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly details?: unknown

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message = '请求参数有误', details?: unknown) =>
  new HttpError(400, 'bad_request', message, details)

export const unauthorized = (message = '请先登录') =>
  new HttpError(401, 'unauthorized', message)

export const forbidden = (message = '没有权限执行该操作') =>
  new HttpError(403, 'forbidden', message)

export const notFound = (message = '资源不存在') => new HttpError(404, 'not_found', message)

export const conflict = (message = '资源已存在') => new HttpError(409, 'conflict', message)

export const tooManyRequests = (message = '操作过于频繁，请稍后再试', details?: unknown) =>
  new HttpError(429, 'rate_limited', message, details)
