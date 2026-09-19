import type {
  BackendConfig,
  GlobalSettings,
  LocalBackendConfig,
  StorageBackend,
} from '@glimmer/shared'
import { existsCache, listCache } from './cache'
import { env } from '../env'
import { LocalStorageAdapter } from './local'
import { resolveFilesPrefix } from './prefix'
import { S3StorageAdapter } from './s3'
import type { FileInfo, StorageAdapter, StorageResult, UploadOptions } from './types'
import { WebdavStorageAdapter } from './webdav'

/* ------------------------------------------------------------------ */
/* 带缓存的适配器包装                                                   */
/* ------------------------------------------------------------------ */

/**
 * 为 exists / list 增加 TTL 缓存，减少 S3 的 Class A 操作费用。
 * upload / delete 会同步失效相关缓存项。
 */
class CachedStorageAdapter implements StorageAdapter {
  constructor(private readonly inner: StorageAdapter) {}

  get id(): string {
    return this.inner.id
  }

  get type(): StorageBackend {
    return this.inner.type
  }

  get name(): string {
    return this.inner.name
  }

  private existsKey(path: string): string {
    return `exists:${this.inner.id}:${path}`
  }

  private listPrefix(): string {
    return `list:${this.inner.id}:`
  }

  async upload(fileBuffer: Buffer, path: string, options?: UploadOptions): Promise<StorageResult> {
    const result = await this.inner.upload(fileBuffer, path, options)
    existsCache.set(this.existsKey(result.path), true)
    listCache.invalidatePrefix(this.listPrefix())
    return result
  }

  async delete(path: string): Promise<boolean> {
    const deleted = await this.inner.delete(path)
    existsCache.set(this.existsKey(path), false)
    listCache.invalidatePrefix(this.listPrefix())
    return deleted
  }

  async exists(path: string): Promise<boolean> {
    const key = this.existsKey(path)
    const hit = existsCache.get<boolean>(key)
    if (hit !== undefined) return hit
    const value = await this.inner.exists(path)
    existsCache.set(key, value)
    return value
  }

  getUrl(path: string): string {
    return this.inner.getUrl(path)
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const key = `${this.listPrefix()}${prefix}`
    const hit = listCache.get<FileInfo[]>(key)
    if (hit !== undefined) return hit
    const value = await this.inner.list(prefix)
    listCache.set(key, value)
    return value
  }

  async download(path: string): Promise<Buffer> {
    return this.inner.download(path)
  }

  async test(): Promise<void> {
    return this.inner.test()
  }
}

/* ------------------------------------------------------------------ */
/* 注册表（按后端配置签名缓存实例）                                      */
/* ------------------------------------------------------------------ */

interface RegistryEntry {
  signature: string
  adapter: StorageAdapter
}

const registry = new Map<string, RegistryEntry>()

function signatureOf(config: BackendConfig, globalBaseUrl: string, filesPrefix: string): string {
  // 配置未变则复用同一个 SDK 客户端。
  // globalBaseUrl 与 filesPrefix 都必须进签名：本地后端的直链基地址由这两者共同决定
  // （见 resolveBaseUrl 与 LocalStorageAdapter 构造函数），不带上就会出现
  // 「后台改了域名 / 改了路径前缀、适配器却被当成同一个复用」的静默失效。
  return `${globalBaseUrl}\u0000${filesPrefix}\u0000${JSON.stringify(config)}`
}

/**
 * 直链基地址的解析顺序：**后端级「访问域名」 > 全局「自定义域名」 > env `PUBLIC_BASE_URL`**。
 *
 * 全局值来自 `getGlobalSettings()`（后台改过就是库里的值，否则已被 env 填过），
 * 所以这里只需处理「后端级为空」的情况。
 */
function resolveBaseUrl(config: BackendConfig, globalBaseUrl: string): string {
  return config.publicBaseUrl?.trim() || globalBaseUrl.trim() || env.PUBLIC_BASE_URL
}

function buildAdapter(
  config: BackendConfig,
  globalBaseUrl: string,
  filesPrefix: string,
): StorageAdapter {
  switch (config.type) {
    case 'local':
      return new LocalStorageAdapter({
        id: config.id,
        name: config.name,
        directory: config.directory,
        publicBaseUrl: config.publicBaseUrl,
        globalBaseUrl: resolveBaseUrl(config, globalBaseUrl),
        filesPrefix,
        pathPrefix: config.pathPrefix,
      })
    case 's3': {
      if (!config.bucket) {
        throw new Error(`S3 后端「${config.name || config.id}」缺少 Bucket 配置`)
      }
      return new S3StorageAdapter({
        id: config.id,
        name: config.name,
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        forcePathStyle: config.forcePathStyle,
        publicBaseUrl: config.publicBaseUrl,
        pathPrefix: config.pathPrefix,
      })
    }
    case 'webdav': {
      if (!config.url) {
        throw new Error(`WebDAV 后端「${config.name || config.id}」缺少服务地址`)
      }
      return new WebdavStorageAdapter({
        id: config.id,
        name: config.name,
        url: config.url,
        username: config.username,
        password: config.password,
        directory: config.directory,
        publicBaseUrl: config.publicBaseUrl,
        pathPrefix: config.pathPrefix,
      })
    }
    default: {
      const exhaustive: never = config
      throw new Error(`未知的存储后端类型：${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 获取（并缓存）指定后端的适配器 */
/**
 * 影响直链基地址的那部分全局设置。
 * 传完整的 `GlobalSettings` 也兼容（结构子集），调用点直接丢 `getGlobalSettings()` 即可。
 */
export type UrlSettings = Pick<GlobalSettings, 'publicBaseUrl' | 'filesPathPrefix'>

/**
 * 取一个带缓存的适配器。
 *
 * 直接传**全局设置对象**（`getGlobalSettings()` 的返回值），由本函数自行解析出
 * 「自定义域名」与「路径前缀」。这样以后再加影响直链的配置项时，所有调用点都不用
 * 再动一遍 —— v1.0.2 就是在 6 个调用点逐个补参数。省略 / 传 null 则完全走 env 兜底。
 *
 * ⚠️ **新增调用点务必传 settings**，否则「后台改域名 / 改前缀」对该处不生效 ——
 * 这正是 v1.0.1 之前直链全指向 localhost 的原因。
 */
export function getAdapter(config: BackendConfig, settings?: UrlSettings | null): StorageAdapter {
  const globalBaseUrl = settings?.publicBaseUrl ?? ''
  const filesPrefix = resolveFilesPrefix(settings?.filesPathPrefix)
  const signature = signatureOf(config, globalBaseUrl, filesPrefix)
  const existing = registry.get(config.id)
  if (existing && existing.signature === signature) return existing.adapter

  const adapter = new CachedStorageAdapter(buildAdapter(config, globalBaseUrl, filesPrefix))
  registry.set(config.id, { signature, adapter })
  return adapter
}

/** 构建一个不进入缓存、不包缓存的适配器实例（设置页「测试连接」使用） */
export function createAdapter(
  config: BackendConfig,
  settings?: UrlSettings | null,
): StorageAdapter {
  return buildAdapter(
    config,
    settings?.publicBaseUrl ?? '',
    resolveFilesPrefix(settings?.filesPathPrefix),
  )
}

export interface ResolvedAdapter {
  config: BackendConfig
  adapter: StorageAdapter
}

/**
 * 解析出一组可用适配器。
 * ids 为空时使用全局默认后端；过滤掉不存在或已禁用的后端。
 */
export function resolveAdapters(
  settings: GlobalSettings,
  ids?: string[] | null,
  options: { includeDisabled?: boolean } = {},
): ResolvedAdapter[] {
  const requested = ids && ids.length > 0 ? ids : settings.defaultBackends
  const out: ResolvedAdapter[] = []
  const seen = new Set<string>()

  for (const id of requested) {
    if (seen.has(id)) continue
    const config = settings.backends.find((b) => b.id === id)
    if (!config) continue
    if (!config.enabled && !options.includeDisabled) continue
    seen.add(id)
    out.push({ config, adapter: getAdapter(config, settings) })
  }

  return out
}

/** 清空适配器缓存（设置变更后调用） */
export function invalidateAdapterCache(): void {
  registry.clear()
  existsCache.clear()
  listCache.clear()
}

/** 全部本地后端的原始适配器（静态服务路由使用） */
export function localAdapters(settings: GlobalSettings): LocalStorageAdapter[] {
  const filesPrefix = resolveFilesPrefix(settings.filesPathPrefix)
  return settings.backends
    // 用类型谓词而非布尔表达式，否则 map 回调里的 config 仍是联合类型，
    // 访问 config.directory 会报 TS2339（该字段只存在于 local / webdav 分支）。
    .filter((b): b is LocalBackendConfig => b.type === 'local' && b.enabled)
    .map(
      (config) =>
        new LocalStorageAdapter({
          id: config.id,
          name: config.name,
          directory: config.directory,
          publicBaseUrl: config.publicBaseUrl,
          globalBaseUrl: resolveBaseUrl(config, settings.publicBaseUrl),
          filesPrefix,
          pathPrefix: config.pathPrefix,
        }),
    )
}

/**
 * 所有本地后端的存储根目录。
 * 对外 URL 形如 `{base}/{filesPrefix}/{pathPrefix}/{rel}`（`filesPrefix` 可为空 = 根路径），
 * 因此把 `{pathPrefix}/{rel}` 交给 `path.resolve(root, …)` 即为磁盘上的真实路径。
 */
export function localRoots(settings: GlobalSettings): string[] {
  const roots = new Set<string>()
  for (const adapter of localAdapters(settings)) roots.add(adapter.rootDir)
  return [...roots]
}

export * from './types'
export { LocalStorageAdapter, S3StorageAdapter, WebdavStorageAdapter }
