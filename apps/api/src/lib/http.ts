import type { ZodType } from 'zod'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { badRequest } from './errors'

/** 解析并校验 JSON 请求体 */
export async function parseJson<T>(c: Context, schema: ZodType<T, any, any>): Promise<T> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw badRequest('请求体不是合法的 JSON')
  }
  return parseWith(schema, raw)
}

/** 解析并校验查询参数 */
export function parseQuery<T>(c: Context, schema: ZodType<T, any, any>): T {
  const raw = c.req.query()
  return parseWith(schema, raw)
}

/** 统一把 Zod 错误转成 400 并附带字段级明细 */
export function parseWith<T>(schema: ZodType<T, any, any>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }))
    throw badRequest(details[0]?.message ?? '参数校验失败', details)
  }
  return result.data
}

/** 标准成功回包：{ data: ... } */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ data }, status)
}
