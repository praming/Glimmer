import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_PREFERENCES,
  mergeGlobalSettings,
  mergePreferences,
  normalizeGlobalSettings,
  type GlobalSettings,
  type UserPreferences,
} from '@glimmer/shared'
import { eq } from 'drizzle-orm'
import { db, settings as settingsTable } from '../db'
import { env } from '../env'
import { decryptSecret, encryptSecret } from '../lib/crypto'

/* ------------------------------------------------------------------ */
/* 泛型读写（settings 表为 key/value）                                  */
/* ------------------------------------------------------------------ */

const GLOBAL_KEY = 'global'
const preferenceKey = (userId: string) => `pref:${userId}`

function readRaw(key: string): string | null {
  const row = db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
  return row?.value ?? null
}

function writeRaw(key: string, value: string): void {
  const updatedAt = new Date().toISOString()
  db.insert(settingsTable)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt } })
    .run()
}

function deleteRaw(key: string): void {
  db.delete(settingsTable).where(eq(settingsTable.key, key)).run()
}

/* ------------------------------------------------------------------ */
/* 密钥加解密：数据库存密文，内存与业务层用明文                          */
/* ------------------------------------------------------------------ */

function decryptSettings(input: GlobalSettings): GlobalSettings {
  return {
    ...input,
    backends: input.backends.map((backend) => {
      if (backend.type === 's3') {
        return { ...backend, secretAccessKey: decryptSecret(backend.secretAccessKey) }
      }
      if (backend.type === 'webdav') {
        return { ...backend, password: decryptSecret(backend.password) }
      }
      return { ...backend }
    }),
  }
}

function encryptSettings(input: GlobalSettings): GlobalSettings {
  return {
    ...input,
    backends: input.backends.map((backend) => {
      if (backend.type === 's3') {
        return { ...backend, secretAccessKey: encryptSecret(backend.secretAccessKey) }
      }
      if (backend.type === 'webdav') {
        return { ...backend, password: encryptSecret(backend.password) }
      }
      return { ...backend }
    }),
  }
}

/* ------------------------------------------------------------------ */
/* 全局设置                                                            */
/* ------------------------------------------------------------------ */

let globalCache: GlobalSettings | null = null

/** 读取全局设置（含明文密钥），带进程内缓存 */
export function getGlobalSettings(): GlobalSettings {
  if (globalCache) return globalCache

  const raw = readRaw(GLOBAL_KEY)
  let parsed: Partial<GlobalSettings> | null = null
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<GlobalSettings>
    } catch {
      parsed = null
    }
  }

  const base = normalizeGlobalSettings({
    ...parsed,
    publicBaseUrl: parsed?.publicBaseUrl || env.PUBLIC_BASE_URL,
    maxUploadSizeMb: parsed?.maxUploadSizeMb || env.MAX_UPLOAD_SIZE_MB,
  })

  globalCache = decryptSettings(base)
  return globalCache
}

/** 保存全局设置（深合并 + 密钥加密落库），返回新的明文设置 */
export function saveGlobalSettings(patch: Partial<GlobalSettings>): GlobalSettings {
  const merged = mergeGlobalSettings(getGlobalSettings(), patch)
  writeRaw(GLOBAL_KEY, JSON.stringify(encryptSettings(merged)))

  globalCache = merged
  return merged
}

/** 强制失效缓存（外部直接改库 / 恢复备份时使用） */
export function invalidateSettingsCache(): void {
  globalCache = null
}

/* ------------------------------------------------------------------ */
/* 个人偏好                                                            */
/* ------------------------------------------------------------------ */

export function getUserPreferences(userId: string): UserPreferences {
  const raw = readRaw(preferenceKey(userId))
  if (!raw) return { ...DEFAULT_PREFERENCES }
  try {
    return mergePreferences(DEFAULT_PREFERENCES, JSON.parse(raw) as Partial<UserPreferences>)
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function saveUserPreferences(
  userId: string,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const merged = mergePreferences(getUserPreferences(userId), patch)
  writeRaw(preferenceKey(userId), JSON.stringify(merged))
  return merged
}

export function deleteUserPreferences(userId: string): void {
  deleteRaw(preferenceKey(userId))
}

export { DEFAULT_GLOBAL_SETTINGS, DEFAULT_PREFERENCES }
export type { GlobalSettings, UserPreferences }
