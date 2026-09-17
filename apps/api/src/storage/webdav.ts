import path from 'node:path/posix'
import { createClient, type WebDAVClient } from 'webdav'
import { joinUrl, sanitizeStoragePath } from '@glimmer/shared'
import {
  BaseStorageAdapter,
  describeStorageError,
  type FileInfo,
  type StorageAdapter,
  type StorageResult,
  type UploadOptions,
} from './types'

export interface WebdavAdapterOptions {
  id: string
  name: string
  url: string
  username?: string
  password?: string
  /** 远端子目录 */
  directory?: string
  publicBaseUrl?: string
  pathPrefix?: string
}

/**
 * WebDAV 适配器。
 * 适用于 Nextcloud / 坚果云 / Synology 等标准 WebDAV 服务。
 */
export class WebdavStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
  readonly id: string
  readonly name: string
  readonly type = 'webdav' as const

  private readonly client: WebDAVClient
  private readonly rootUrl: string
  private readonly directory: string
  private readonly publicBaseUrl: string
  private readonly pathPrefix: string

  constructor(options: WebdavAdapterOptions) {
    super()
    this.id = options.id
    this.name = options.name
    this.rootUrl = options.url.replace(/\/+$/, '')
    this.directory = (options.directory ?? '').replace(/^\/+|\/+$/g, '')
    this.publicBaseUrl = (options.publicBaseUrl ?? '').replace(/\/+$/, '')
    this.pathPrefix = (options.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')

    this.client = createClient(this.rootUrl, {
      username: options.username || undefined,
      password: options.password || undefined,
    })
  }

  /** 远端绝对路径（含 directory 与 pathPrefix） */
  private remotePath(relPath: string): string {
    const clean = sanitizeStoragePath(relPath)
    const prefixed = this.pathPrefix ? `${this.pathPrefix}/${clean}` : clean
    const joined = this.directory ? `${this.directory}/${prefixed}` : prefixed
    return `/${joined.replace(/^\/+/, '')}`
  }

  async upload(fileBuffer: Buffer, relPath: string, options?: UploadOptions): Promise<StorageResult> {
    const target = this.remotePath(relPath)
    try {
      const parent = path.dirname(target)
      if (parent && parent !== '/') {
        await this.client.createDirectory(parent, { recursive: true })
      }
      await this.client.putFileContents(target, fileBuffer, { overwrite: true })
    } catch (error) {
      throw new Error(`WebDAV 上传失败：${describeStorageError(error)}`)
    }
    return { path: target.replace(/^\/+/, ''), url: this.getUrl(target.replace(/^\/+/, '')), size: fileBuffer.byteLength }
  }

  async delete(relPath: string): Promise<boolean> {
    const target = this.remotePath(relPath)
    try {
      const found = await this.client.exists(target)
      if (!found) return false
      await this.client.deleteFile(target)
      return true
    } catch (error) {
      throw new Error(`WebDAV 删除失败：${describeStorageError(error)}`)
    }
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      return await this.client.exists(this.remotePath(relPath))
    } catch (error) {
      throw new Error(`WebDAV 探测失败：${describeStorageError(error)}`)
    }
  }

  getUrl(relPath: string): string {
    const remote = this.remotePath(relPath).replace(/^\/+/, '')
    return joinUrl(this.publicBaseUrl || this.rootUrl, remote)
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const target = this.remotePath(prefix)
    const out: FileInfo[] = []
    try {
      const entries = (await this.client.getDirectoryContents(target, { deep: true })) as
        | Array<{ type: string; filename: string; size: number; lastmod?: string }>
        | { data: Array<{ type: string; filename: string; size: number; lastmod?: string }> }

      const items = Array.isArray(entries) ? entries : entries.data

      for (const item of items) {
        if (item.type !== 'file') continue
        out.push({
          path: item.filename.replace(/^\/+/, ''),
          size: item.size ?? 0,
          lastModified: item.lastmod ? new Date(item.lastmod) : undefined,
        })
      }
    } catch (error) {
      throw new Error(`WebDAV 列表失败：${describeStorageError(error)}`)
    }
    return out
  }

  async download(relPath: string): Promise<Buffer> {
    const target = this.remotePath(relPath)
    try {
      const contents = await this.client.getFileContents(target, { format: 'binary' })
      if (Buffer.isBuffer(contents)) return contents
      if (contents instanceof ArrayBuffer) return Buffer.from(contents)
      if (typeof contents === 'string') return Buffer.from(contents, 'binary')
      throw new Error('远端返回了不支持的数据类型')
    } catch (error) {
      throw new Error(`WebDAV 读取失败：${describeStorageError(error)}`)
    }
  }

  async test(): Promise<void> {
    try {
      const target = this.remotePath('.glimmer-probe')
      await this.client.putFileContents(target, Buffer.from('ok'), { overwrite: true })
      await this.client.deleteFile(target)
    } catch (error) {
      throw new Error(`WebDAV 连接测试失败：${describeStorageError(error)}`)
    }
  }
}
