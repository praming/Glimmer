<script setup lang="ts">
import { FORMAT_LABEL, STORAGE_BACKEND_LABEL } from '@glimmer/shared'
import { LayoutGrid, List, RefreshCw, Search, SlidersHorizontal, Users, X } from 'lucide-vue-next'
import type { GalleryFilters } from '~/stores/gallery'

const gallery = useGalleryStore()
const auth = useAuthStore()
const api = useApi()

const showFilters = ref(false)
const searchInput = ref(gallery.filters.q)

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => gallery.filters.q,
  (value) => {
    if (value !== searchInput.value) searchInput.value = value
  },
)

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void gallery.applyFilters({ q: searchInput.value.trim() })
  }, 320)
}

function clearSearch(): void {
  searchInput.value = ''
  void gallery.applyFilters({ q: '' })
}

/* ------------------------------ 筛选项 ------------------------------ */

const formatOptions = [
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'AVIF', value: 'avif' },
  { label: 'GIF', value: 'gif' },
  { label: '原图', value: 'original' },
]

const backendOptions = computed(() => {
  const types = new Set((useOptionsStore().data?.backends ?? []).map((b) => b.type))
  return [...types].map((type) => ({ label: STORAGE_BACKEND_LABEL[type], value: type }))
})

const statusOptions = [
  { label: '已就绪', value: 'ready' },
  { label: '处理中', value: 'pending' },
  { label: '失败', value: 'failed' },
]

const sortOptions = [
  { label: '上传时间 ↓', value: 'createdAt:desc' },
  { label: '上传时间 ↑', value: 'createdAt:asc' },
  { label: '名称 A→Z', value: 'name:asc' },
  { label: '体积 大→小', value: 'size:desc' },
  { label: '体积 小→大', value: 'size:asc' },
]

const uploaders = ref<Array<{ label: string; value: string }>>([])

const sortValue = computed({
  get: () => `${gallery.filters.sort}:${gallery.filters.order}`,
  set: (value: string) => {
    const [sort, order] = value.split(':') as ['createdAt' | 'size' | 'name', 'asc' | 'desc']
    void gallery.applyFilters({ sort, order })
  },
})

onMounted(async () => {
  if (!auth.isAdmin) return
  try {
    const result = await api.get<{ items: Array<{ id: string; username: string }> }>('/users')
    uploaders.value = result.items.map((u) => ({ label: u.username, value: u.id }))
  } catch {
    /* 非管理员或接口不可用时忽略 */
  }
})

const viewOptions = [
  { label: '', value: 'grid', icon: LayoutGrid, title: '网格视图' },
  { label: '', value: 'list', icon: List, title: '列表视图' },
]
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <!-- 搜索 -->
      <div class="relative min-w-0 flex-1 sm:max-w-xs">
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <AppInput
          v-model="searchInput"
          placeholder="搜索文件名或 ID"
          class="[&_input]:pl-9"
          @input="onSearchInput"
        />
        <button
          v-if="searchInput"
          type="button"
          class="gl-focus absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <AppButton
        variant="outline"
        size="md"
        :class="showFilters && 'border-primary/40 bg-primary-soft text-accent-foreground'"
        @click="showFilters = !showFilters"
      >
        <SlidersHorizontal class="h-4 w-4" />
        筛选
        <AppBadge v-if="gallery.activeFilterCount > 0" variant="primary" size="sm">
          {{ gallery.activeFilterCount }}
        </AppBadge>
      </AppButton>

      <!-- 快捷筛选用户（仅管理员）：选择会被记住，除非手动切换 -->
      <div
        v-if="auth.isAdmin && uploaders.length > 0"
        class="flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-card/60 py-1 pl-2 pr-1.5"
      >
        <Users class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div class="flex min-w-0 items-center gap-1 overflow-x-auto">
          <button
            type="button"
            class="gl-focus shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-250"
            :class="
              gallery.filters.userId === ''
                ? 'bg-primary text-primary-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            "
            @click="gallery.applyFilters({ userId: '' })"
          >
            全部
          </button>
          <button
            v-for="uploader in uploaders"
            :key="uploader.value"
            type="button"
            class="gl-focus max-w-[9rem] shrink-0 truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-250"
            :class="
              gallery.filters.userId === uploader.value
                ? 'bg-primary text-primary-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            "
            :title="uploader.label"
            @click="gallery.applyFilters({ userId: uploader.value })"
          >
            {{ uploader.label }}
          </button>
        </div>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <AppSegment v-model="gallery.view" :options="viewOptions" />
        <AppButton variant="outline" size="icon" title="刷新" :disabled="gallery.loading" @click="gallery.fetch()">
          <RefreshCw class="h-4 w-4" :class="gallery.loading && 'animate-spin'" />
        </AppButton>
      </div>
    </div>

    <!-- 展开的筛选面板 -->
    <Transition name="pop">
      <div
        v-if="showFilters"
        class="gl-surface grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <AppSelect
          :model-value="gallery.filters.format"
          :options="formatOptions"
          label="输出格式"
          placeholder="全部格式"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ format: (v ?? '') as never })"
        />

        <AppSelect
          :model-value="gallery.filters.backend"
          :options="backendOptions"
          label="存储后端"
          placeholder="全部后端"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ backend: (v ?? '') as never })"
        />

        <AppSelect
          :model-value="gallery.filters.status"
          :options="statusOptions"
          label="状态"
          placeholder="全部状态"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ status: (v ?? '') as never })"
        />

        <AppSelect
          v-if="auth.isAdmin"
          :model-value="gallery.filters.userId"
          :options="uploaders"
          label="上传者"
          placeholder="全部成员"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ userId: v ?? '' })"
        />

        <AppInput
          :model-value="gallery.filters.from"
          type="date"
          label="起始日期"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ from: String(v ?? '') })"
        />

        <AppInput
          :model-value="gallery.filters.to"
          type="date"
          label="结束日期"
          size="sm"
          @update:model-value="(v) => gallery.applyFilters({ to: String(v ?? '') })"
        />

        <AppSelect v-model="sortValue" :options="sortOptions" label="排序" :placeholder-option="false" size="sm" />

        <div class="flex items-end">
          <AppButton variant="ghost" size="sm" :disabled="gallery.activeFilterCount === 0" @click="gallery.resetFilters()">
            重置全部筛选
          </AppButton>
        </div>
      </div>
    </Transition>
  </div>
</template>
