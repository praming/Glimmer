import type { ImageDTO, UrlSet } from '@glimmer/shared'
import { COPY_FORMAT_LABEL } from '@glimmer/shared'

/**
 * 图库里的「一键复制」。
 *
 * 列表接口不返回 URL（避免每页多算几十次），因此点击时才按需拉一次
 * `/images/:id/urls`，取「主格式 + 个人默认复制格式」对应的文本。
 * 同一个实例内自带互斥，避免连点造成重复请求。
 */
export function useImageCopy() {
  const api = useApi()
  const auth = useAuthStore()
  const toast = useToast()

  const pendingId = ref<string | null>(null)

  async function resolveCopyText(image: ImageDTO): Promise<string> {
    const result = await api.get<{ byFormat: Record<string, UrlSet | null> }>(`/images/${image.id}/urls`)
    const primary = result.byFormat[image.primaryFormat ?? 'original']
    const fallback = Object.values(result.byFormat).find((item): item is UrlSet => Boolean(item)) ?? null
    const set = primary ?? fallback
    return set?.[auth.preferences.defaultCopyFormat] ?? image.previewUrl ?? ''
  }

  async function copyImage(image: ImageDTO): Promise<boolean> {
    if (pendingId.value) return false

    pendingId.value = image.id
    try {
      const text = await resolveCopyText(image)
      if (!text) throw new Error('这张图还没有可用的链接')

      const ok = await copyText(text)
      if (!ok) throw new Error('剪贴板不可用，请手动复制')

      toast.success('已复制到剪贴板', COPY_FORMAT_LABEL[auth.preferences.defaultCopyFormat])
      return true
    } catch (error) {
      toast.error('复制失败', (error as Error).message)
      return false
    } finally {
      pendingId.value = null
    }
  }

  /** 当前默认复制格式的短名，用于按钮 title */
  const formatLabel = computed(() => COPY_FORMAT_LABEL[auth.preferences.defaultCopyFormat])

  return { pendingId, copyImage, formatLabel }
}
