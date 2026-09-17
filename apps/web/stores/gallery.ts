import type { ImageDTO, OutputFormat, Paginated, StorageBackend, VariantFormat } from '@glimmer/shared'
import { defineStore } from 'pinia'

export interface GalleryFilters {
  q: string
  format: OutputFormat | VariantFormat | ''
  backend: StorageBackend | ''
  userId: string
  status: '' | 'pending' | 'ready' | 'failed'
  from: string
  to: string
  sort: 'createdAt' | 'size' | 'name'
  order: 'asc' | 'desc'
}

function defaultFilters(): GalleryFilters {
  return {
    q: '',
    format: '',
    backend: '',
    userId: '',
    status: '',
    from: '',
    to: '',
    sort: 'createdAt',
    order: 'desc',
  }
}

/**
 * 「快捷筛选用户」的记忆键。
 * 需求：管理员选中某个用户后要一直记住，除非手动切换 —— 因此落到 localStorage，
 * 刷新页面 / 重新登录都保持。成员无此筛选，进入图库时会主动清掉。
 */
const QUICK_USER_KEY = 'glimmer-gallery-quick-user'

export const useGalleryStore = defineStore('gallery', () => {
  const api = useApi()
  const toast = useToast()

  const items = ref<ImageDTO[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(24)
  const totalPages = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const view = ref<'grid' | 'list'>('grid')
  const filters = ref<GalleryFilters>(defaultFilters())
  const selectedIds = ref<string[]>([])
  const detail = ref<ImageDTO | null>(null)
  const detailLoading = ref(false)

  const hasSelection = computed(() => selectedIds.value.length > 0)
  const selectionCount = computed(() => selectedIds.value.length)
  const allSelected = computed(
    () => items.value.length > 0 && items.value.every((item) => selectedIds.value.includes(item.id)),
  )
  const activeFilterCount = computed(() => {
    const f = filters.value
    return [f.q, f.format, f.backend, f.userId, f.status, f.from, f.to].filter(Boolean).length
  })

  function buildQuery(): Record<string, unknown> {
    const f = filters.value
    return {
      page: page.value,
      pageSize: pageSize.value,
      q: f.q || undefined,
      format: f.format || undefined,
      backend: f.backend || undefined,
      userId: f.userId || undefined,
      status: f.status || undefined,
      from: f.from || undefined,
      to: f.to || undefined,
      sort: f.sort,
      order: f.order,
    }
  }

  async function fetch(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await api.get<Paginated<ImageDTO>>('/images', buildQuery())
      items.value = result.items
      total.value = result.total
      page.value = result.page
      totalPages.value = result.totalPages

      // 清理已不在当前页的选中项
      const visible = new Set(result.items.map((i) => i.id))
      selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
    } catch (err) {
      error.value = (err as Error).message
      items.value = []
      total.value = 0
      totalPages.value = 0
    } finally {
      loading.value = false
    }
  }

  async function setPage(next: number): Promise<void> {
    if (next < 1 || (totalPages.value > 0 && next > totalPages.value)) return
    page.value = next
    await fetch()
  }

  async function applyFilters(patch: Partial<GalleryFilters>): Promise<void> {
    filters.value = { ...filters.value, ...patch }
    if (patch.userId !== undefined) persistQuickUser(filters.value.userId)
    page.value = 1
    await fetch()
  }

  async function resetFilters(): Promise<void> {
    filters.value = defaultFilters()
    persistQuickUser('')
    page.value = 1
    await fetch()
  }

  /* ------------------------------------------------------------------ */
  /* 快捷筛选用户                                                         */
  /* ------------------------------------------------------------------ */

  function persistQuickUser(userId: string): void {
    if (!import.meta.client) return
    if (userId) localStorage.setItem(QUICK_USER_KEY, userId)
    else localStorage.removeItem(QUICK_USER_KEY)
  }

  /**
   * 恢复快捷筛选。
   * 仅管理员生效；其他角色一律清空，避免继承上一个账号留下的筛选条件。
   */
  function restoreQuickUser(isAdmin: boolean): void {
    if (!import.meta.client) return

    if (!isAdmin) {
      localStorage.removeItem(QUICK_USER_KEY)
      if (filters.value.userId) filters.value = { ...filters.value, userId: '' }
      return
    }

    const stored = localStorage.getItem(QUICK_USER_KEY) ?? ''
    if (stored) filters.value = { ...filters.value, userId: stored }
  }

  function toggleSelect(id: string): void {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((item) => item !== id)
      : [...selectedIds.value, id]
  }

  function toggleSelectAll(): void {
    selectedIds.value = allSelected.value ? [] : items.value.map((i) => i.id)
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  async function openDetail(id: string): Promise<void> {
    detailLoading.value = true
    detail.value = null
    try {
      detail.value = await api.get<ImageDTO>(`/images/${id}`)
    } catch (err) {
      toast.error('无法打开图片详情', (err as Error).message)
    } finally {
      detailLoading.value = false
    }
  }

  async function refreshDetail(): Promise<void> {
    if (!detail.value) return
    const id = detail.value.id
    try {
      detail.value = await api.get<ImageDTO>(`/images/${id}`)
    } catch {
      /* 保持原详情 */
    }
  }

  function closeDetail(): void {
    detail.value = null
  }

  async function remove(id: string): Promise<boolean> {
    try {
      const result = await api.del<{ warnings?: Array<{ backendName: string; path: string; error: string }> }>(
        `/images/${id}`,
      )
      if (result?.warnings?.length) {
        toast.warning(
          `已删除记录，但有 ${result.warnings.length} 个后端未成功清理`,
          result.warnings.map((w) => `${w.backendName}: ${w.error}`).join('；'),
        )
      } else {
        toast.success('已删除，浮光已清理干净')
      }
      return true
    } catch (err) {
      toast.error('删除失败', (err as Error).message)
      return false
    }
  }

  async function removeMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    try {
      const result = await api.post<{
        deleted: string[]
        skipped: Array<{ id: string; reason: string }>
        warnings: unknown[]
      }>('/images/batch/delete', { ids })

      if (result.warnings.length > 0) {
        toast.warning(`已删除 ${result.deleted.length} 张，${result.warnings.length} 处后端残留待处理`)
      } else {
        toast.success(`已删除 ${result.deleted.length} 张图片`)
      }
      return result.deleted.length
    } catch (err) {
      toast.error('批量删除失败', (err as Error).message)
      return 0
    }
  }

  async function rename(id: string, filename: string): Promise<boolean> {
    try {
      const result = await api.patch<{ detail: ImageDTO; failures: unknown[] }>(`/images/${id}`, { filename })
      detail.value = result.detail

      const index = items.value.findIndex((i) => i.id === id)
      if (index >= 0) items.value[index] = { ...items.value[index]!, ...result.detail }

      if (result.failures.length > 0) {
        toast.warning('重命名完成，但部分后端同步失败，请在详情中重试')
      } else {
        toast.success('已重命名，各后端已同步')
      }
      return true
    } catch (err) {
      toast.error('重命名失败', (err as Error).message)
      return false
    }
  }

  async function retry(id: string, backends?: string[]): Promise<boolean> {
    try {
      const result = await api.post<{ touched: number; detail: ImageDTO }>(`/images/${id}/retry`, { backends })
      detail.value = result.detail

      const index = items.value.findIndex((i) => i.id === id)
      if (index >= 0) items.value[index] = { ...items.value[index]!, ...result.detail }

      toast.success(result.touched > 0 ? `已重新排队 ${result.touched} 项同步任务` : '没有需要重试的任务')
      return true
    } catch (err) {
      toast.error('重试失败', (err as Error).message)
      return false
    }
  }

  function reset(): void {
    items.value = []
    total.value = 0
    page.value = 1
    totalPages.value = 0
    selectedIds.value = []
    detail.value = null
    filters.value = defaultFilters()
    persistQuickUser('')
  }

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    loading,
    error,
    view,
    filters,
    selectedIds,
    detail,
    detailLoading,
    hasSelection,
    selectionCount,
    allSelected,
    activeFilterCount,
    fetch,
    setPage,
    applyFilters,
    resetFilters,
    restoreQuickUser,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    openDetail,
    refreshDetail,
    closeDetail,
    remove,
    removeMany,
    rename,
    retry,
    reset,
  }
})
