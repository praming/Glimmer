import type { Context } from 'hono'
import { badRequest } from './errors'

/**
 * `multipart/form-data` 的公共小工具。
 *
 * ⚠️ `UploadFile` 必须从 `FormData` **派生**，而不是直接用全局 `File`。
 * 本仓库 `lib: ["ES2023"]`、`types: ["node"]`，此时同时存在两套 `File`：
 * - `FormData` 的取值来自 undici（`undici-types/file.d.ts` 的 class File）
 * - 全局 `File` 是 `interface File extends import('buffer').File`
 * 二者结构相近但**标称不同**，会让 `filter(isFile)` 的类型谓词不满足
 * `S extends FormDataEntryValue` 约束，从而退回非谓词重载、失去窄化
 * （表现为后续 `file.name` / `file.size` 全部报 TS2339）。
 * 直接派生即可保证与 `getAll()` 的返回元素严格同一。
 */
export type UploadFile = Exclude<ReturnType<FormData['getAll']>[number], string>

export const isFile = (value: unknown): value is UploadFile =>
  typeof value !== 'string' && typeof File !== 'undefined' && value instanceof File

/**
 * 按字段名依次查找第一个文件项。
 *
 * 传多个候选字段名是为了兼容不同前端/工具的习惯写法（如 `file` 与 `files`）；
 * 只取一个是因为调用方（头像）本就只接受单文件。
 */
export function pickFile(form: FormData, ...fields: string[]): UploadFile | null {
  for (const field of fields) {
    const found = form.getAll(field).find(isFile)
    if (found) return found
  }
  return null
}

/** 解析 `multipart/form-data` 请求体；解析失败时抛出可读的 400 而非 500 */
export async function readFormData(c: Context): Promise<FormData> {
  try {
    return await c.req.formData()
  } catch {
    throw badRequest('无法解析上传数据，请确认使用 multipart/form-data 提交')
  }
}
