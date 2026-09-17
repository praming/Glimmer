import type { StorageBackend } from '@glimmer/shared'

/* ------------------------------------------------------------------ */
/* 统一适配器接口                                                       */
/* ------------------------------------------------------------------ */

export interface UploadOptions {
  /** 对象 Content-Type */
  contentType?: string
  /** 缓存控制头 */
  cacheControl?: string
}

export interface StorageResult {
  /** 传入的 path（回显） */
  path: string
  /** 对外可访问 URL */
  url: string
  /** 字节数 */
  size: number
}

export interface FileInfo {
  path: string
  size: number
  lastModified?: Date
}

/**
 * 所有存储后端实现同一组契约。
 * path 语义：相对于「后端根目录 / 对象键前缀」的相对路径（已包含 pathPrefix）。
 */
export interface StorageAdapter {
  /** 后端配置 id（唯一） */
  readonly id: string
  /** 后端类型 */
  readonly type: StorageBackend
  /** 展示名 */
  readonly name: string

  /** 写入文件 */
  upload(fileBuffer: Buffer, path: string, options?: UploadOptions): Promise<StorageResult>
  /** 删除文件，返回是否确实删除了对象 */
  delete(path: string): Promise<boolean>
  /** 判断文件是否存在 */
  exists(path: string): Promise<boolean>
  /** 计算对外 URL（不发起网络请求） */
  getUrl(path: string): string
  /** 列出前缀下的文件 */
  list(prefix: string): Promise<FileInfo[]>
  /**
   * 读取文件内容。
   * 设计文档未列出该方法，属于本实现的加法扩展：
   * 「重命名需同步所有后端」必须先把对象读回本地再写往新路径。
   */
  download(path: string): Promise<Buffer>
  /** 连通性自检（设置页「测试连接」按钮使用） */
  test(): Promise<void>
}

export abstract class BaseStorageAdapter implements StorageAdapter {
  abstract readonly id: string
  abstract readonly type: StorageBackend
  abstract readonly name: string

  abstract upload(fileBuffer: Buffer, path: string, options?: UploadOptions): Promise<StorageResult>
  abstract delete(path: string): Promise<boolean>
  abstract exists(path: string): Promise<boolean>
  abstract getUrl(path: string): string
  abstract list(prefix: string): Promise<FileInfo[]>
  abstract download(path: string): Promise<Buffer>
  abstract test(): Promise<void>
}

/** 把上游 SDK 错误整理成可读文案 */
export function describeStorageError(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as Error & { Code?: string; code?: string; $metadata?: { httpStatusCode?: number } }
    const code = anyError.Code ?? anyError.code
    const status = anyError.$metadata?.httpStatusCode
    const parts = [code, status ? `HTTP ${status}` : null, error.message].filter(Boolean)
    return parts.join(' · ').slice(0, 400)
  }
  return String(error).slice(0, 400)
}
