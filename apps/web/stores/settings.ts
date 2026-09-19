import type {
  BackendConfig,
  BackendTestResult,
  GlobalSettings,
  QueueStats,
} from '@glimmer/shared'
import { defineStore } from 'pinia'
import { useOptionsStore } from './options'

interface SettingsPayload {
  settings: GlobalSettings
  stats: {
    images: { pending: number; ready: number; failed: number }
    queue: QueueStats
  }
  runtime: {
    nodeEnv: string
    publicBaseUrl: string
    /** env 里显式设置的直链前缀（空串 = 未设置，以库里的设置为准） */
    filesRoutePrefixEnv: string
    /** 当前真正生效的直链前缀（空串 = 直接挂在根路径） */
    filesRoutePrefixEffective: string
    maxUploadSizeMb: number
    storageRoot: string
    database: string
    sessionTtlDays: number
    queueConcurrency: number
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const api = useApi()
  const toast = useToast()
  const options = useOptionsStore()

  const settings = ref<GlobalSettings | null>(null)
  const stats = ref<SettingsPayload['stats'] | null>(null)
  const runtime = ref<SettingsPayload['runtime'] | null>(null)
  const loading = ref(false)
  const saving = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const payload = await api.get<SettingsPayload>('/settings')
      settings.value = payload.settings
      stats.value = payload.stats
      runtime.value = payload.runtime
    } catch (error) {
      toast.error('无法读取全局设置', (error as Error).message)
    } finally {
      loading.value = false
    }
  }

  async function save(patch: Partial<GlobalSettings>): Promise<boolean> {
    saving.value = true
    try {
      const payload = await api.patch<{ settings: GlobalSettings }>('/settings', patch)
      settings.value = payload.settings
      options.reset()
      await options.load(true)
      toast.success('设置已保存')
      return true
    } catch (error) {
      toast.error('保存失败', (error as Error).message)
      return false
    } finally {
      saving.value = false
    }
  }

  async function testBackend(backend: BackendConfig): Promise<BackendTestResult> {
    try {
      const result = await api.post<BackendTestResult>('/settings/backends/test', { backend })
      return result
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  async function refreshStats(): Promise<void> {
    try {
      const payload = await api.get<SettingsPayload>('/settings')
      stats.value = payload.stats
    } catch {
      /* 忽略 */
    }
  }

  return { settings, stats, runtime, loading, saving, load, save, testBackend, refreshStats }
})
