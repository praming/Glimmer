import fs from 'node:fs/promises'
import path from 'node:path'
import { joinUrl, normalizeFilesPathPrefix, sanitizeStoragePath } from '@glimmer/shared'
import { env, paths } from '../env'
import { DEFAULT_FILES_ROUTE_PREFIX } from './prefix'
import {
  BaseStorageAdapter,
  describeStorageError,
  type FileInfo,
  type StorageAdapter,
  type StorageResult,
  type UploadOptions,
} from './types'

export interface LocalAdapterOptions {
  id: string
  name: string
  /** 存储根目录，留空使用 env LOCAL_STORAGE_DIR */
  directory?: string
  /**
   * 该后端的对外访问前缀，**原样使用**（不补任何路径）。
   * 想用默认的 `/files` 路由就自己写全：`https://pic.example.com/files`。
   */
  publicBaseUrl?: string
  /**
   * 全局「自定义域名」（后台设置），本后端的 publicBaseUrl 留空时用它。
   *
   * 注意与 publicBaseUrl 的区别：这里传的是**裸域名/根地址**（不含路径前缀），
   * 由适配器自己补当前生效的 `filesPrefix` —— 因为本地文件由 API 的静态路由提供，
   * 那段前缀不该逼用户手写。两者都为空时才回落到 env `PUBLIC_BASE_URL`。
   */
  globalBaseUrl?: string
  /**
   * 直链的路径前缀（不含首尾斜杠），来自 `resolveFilesPrefix()`。
   * 空串表示直接挂在根路径。**仅在 `publicBaseUrl` 留空时参与拼接**。
   */
  filesPrefix?: string
  /** 对象键前缀（存储子目录，会同时体现在磁盘路径与 URL 上） */
  pathPrefix?: string
}

/**
 * 本地磁盘适配器。
 * 文件写入 VPS 本地磁盘，由 API 的 `/files/*` 路由或 Nginx 静态服务对外提供。
 */
export class LocalStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
  readonly id: string
  readonly name: string
  readonly type = 'local' as const

  private readonly root: string
  private readonly baseUrl: string
  private readonly pathPrefix: string

  constructor(options: LocalAdapterOptions) {
    super()
    this.id = options.id
    this.name = options.name
    this.root = options.directory?.trim() ? path.resolve(options.directory.trim()) : paths.uploads
    this.pathPrefix = (options.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')
    // 前缀为空串（挂根路径）时 joinUrl(base, '') 会原样返回 base，无需特判。
    this.baseUrl = options.publicBaseUrl?.trim()
      ? options.publicBaseUrl.trim().replace(/\/+$/, '')
      : joinUrl(
          (options.globalBaseUrl?.trim() || env.PUBLIC_BASE_URL).replace(/\/+$/, ''),
          normalizeFilesPathPrefix(options.filesPrefix ?? DEFAULT_FILES_ROUTE_PREFIX),
        )
  }

  /** 存储根目录（供静态服务路由使用） */
  get rootDir(): string {
    return this.root
  }

  private resolve(relPath: string): string {
    const clean = sanitizeStoragePath(relPath)
    const absolute = path.resolve(this.root, clean)
    // 防目录穿越
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    if (absolute !== this.root && !absolute.startsWith(rootWithSep)) {
      throw new Error(`非法的存储路径：${relPath}`)
    }
    return absolute
  }

  private withPrefix(relPath: string): string {
    const clean = sanitizeStoragePath(relPath)
    return this.pathPrefix ? `${this.pathPrefix}/${clean}` : clean
  }

  async upload(fileBuffer: Buffer, relPath: string, _options?: UploadOptions): Promise<StorageResult> {
    void _options
    const full = this.withPrefix(relPath)
    const absolute = this.resolve(full)
    try {
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, fileBuffer)
    } catch (error) {
      throw new Error(`本地写入失败：${describeStorageError(error)}`)
    }
    return { path: sanitizeStoragePath(relPath), url: this.getUrl(relPath), size: fileBuffer.byteLength }
  }

  async delete(relPath: string): Promise<boolean> {
    const absolute = this.resolve(this.withPrefix(relPath))
    try {
      await fs.unlink(absolute)
      await this.pruneEmptyDirs(path.dirname(absolute))
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return false
      throw new Error(`本地删除失败：${describeStorageError(error)}`)
    }
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.resolve(this.withPrefix(relPath)))
      return stat.isFile()
    } catch {
      return false
    }
  }

  getUrl(relPath: string): string {
    return joinUrl(this.baseUrl, this.withPrefix(relPath))
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const full = this.withPrefix(prefix)
    const base = this.resolve(full.replace(/\/+$/, ''))
    const out: FileInfo[] = []

    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(abs)
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs)
          out.push({
            path: path.relative(this.root, abs).split(path.sep).join('/'),
            size: stat.size,
            lastModified: stat.mtime,
          })
        }
      }
    }

    await walk(base)
    return out
  }

  async download(relPath: string): Promise<Buffer> {
    const absolute = this.resolve(this.withPrefix(relPath))
    try {
      return await fs.readFile(absolute)
    } catch (error) {
      throw new Error(`本地读取失败：${describeStorageError(error)}`)
    }
  }

  async test(): Promise<void> {
    const probe = path.join(this.root, `.glimmer-write-test-${Date.now()}`)
    await fs.mkdir(this.root, { recursive: true })
    await fs.writeFile(probe, 'ok')
    await fs.unlink(probe)
  }

  /** 删除文件后顺带清理空目录 */
  private async pruneEmptyDirs(dir: string): Promise<void> {
    let current = dir
    while (current.startsWith(this.root) && current !== this.root) {
      try {
        const remaining = await fs.readdir(current)
        if (remaining.length > 0) return
        await fs.rmdir(current)
      } catch {
        return
      }
      current = path.dirname(current)
    }
  }
}
