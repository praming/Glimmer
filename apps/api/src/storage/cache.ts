/**
 * 轻量 TTL 缓存。
 * 用于 S3 / WebDAV 的 exists / list，显著减少 Class A 类请求开销。
 */

interface CacheEntry {
  value: unknown
  expiresAt: number
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set(key: string, value: unknown): void {
    if (this.store.size >= this.maxEntries) {
      // 简单淘汰：删除最早插入的一批
      const overflow = this.store.size - this.maxEntries + 1
      let removed = 0
      for (const k of this.store.keys()) {
        this.store.delete(k)
        if (++removed >= overflow) break
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  /** 按前缀失效 */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }
}

/** exists 结果缓存：60 秒 */
export const existsCache = new TtlCache(60_000)
/** list 结果缓存：30 秒 */
export const listCache = new TtlCache(30_000, 2000)
