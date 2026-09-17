import type { GalleryVisibility, ImageProcessingSettings, OutputFormat, StorageBackend } from '@glimmer/shared'
import { defineStore } from 'pinia'

export interface PublicBackendOption {
  id: string
  name: string
  type: StorageBackend
  publicBaseUrl: string
}

/** GET /api/settings/options 的返回结构 */
export interface SettingsOptions {
  namingTemplate: string
  galleryVisibility: GalleryVisibility
  publicBaseUrl: string
  maxUploadSizeMb: number
  /** 管理员允许上传的输入 MIME 白名单 */
  allowedInputMime: string[]
  processing: ImageProcessingSettings
  defaultBackends: string[]
  backends: PublicBackendOption[]
}

/**
 * 上传页与筛选器所需的「公开设置」。
 * 不含任何密钥，所有登录用户均可读取。
 */
export const useOptionsStore = defineStore('options', () => {
  const api = useApi()

  const data = ref<SettingsOptions | null>(null)
  const loading = ref(false)

  const formats = computed<OutputFormat[]>(() => data.value?.processing.outputFormats ?? [])
  const backends = computed<PublicBackendOption[]>(() => data.value?.backends ?? [])

  async function load(force = false): Promise<SettingsOptions | null> {
    if (data.value && !force) return data.value
    loading.value = true
    try {
      data.value = await api.get<SettingsOptions>('/settings/options')
      return data.value
    } finally {
      loading.value = false
    }
  }

  function reset(): void {
    data.value = null
  }

  return { data, loading, formats, backends, load, reset }
})
