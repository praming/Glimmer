<script setup lang="ts">
import { Trash2, UploadCloud, X } from 'lucide-vue-next'

const gallery = useGalleryStore()
const options = useOptionsStore()
const confirm = useConfirm()
const auth = useAuthStore()

const drawerOpen = ref(false)

onMounted(async () => {
  // 管理员的「快捷筛选用户」跨会话记忆，成员一律清空
  gallery.restoreQuickUser(auth.isAdmin)
  await Promise.all([gallery.fetch(), options.load()])
  startPolling()
})

onBeforeUnmount(stopPolling)

/* ------------------------------------------------------------------ */
/* 轮询：有处理中的图片时自动刷新                                        */
/* ------------------------------------------------------------------ */

let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling(): void {
  stopPolling()
  pollTimer = setInterval(() => {
    const hasPending = gallery.items.some((item) => item.status === 'pending')
    if (hasPending && !gallery.loading && !drawerOpen.value) {
      void gallery.fetch()
    }
  }, 4000)
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

async function openImage(id: string): Promise<void> {
  drawerOpen.value = true
  await gallery.openDetail(id)
}

function closeDrawer(): void {
  drawerOpen.value = false
  gallery.closeDetail()
}

async function removeOne(id: string): Promise<void> {
  const item = gallery.items.find((i) => i.id === id)
  const ok = await confirm.confirm({
    title: '删除这张图片？',
    description: `「${item?.filename ?? id}」将从所有存储后端中同步删除，操作无法撤销。`,
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return

  const success = await gallery.remove(id)
  if (success) await gallery.fetch()
}

async function removeSelected(): Promise<void> {
  const count = gallery.selectionCount
  const ok = await confirm.confirm({
    title: `删除已选的 ${count} 张图片？`,
    description: '所有存储后端中的对应文件都会被同步删除，操作无法撤销。',
    confirmText: `删除 ${count} 张`,
    destructive: true,
  })
  if (!ok) return

  const removed = await gallery.removeMany([...gallery.selectedIds])
  if (removed > 0) {
    gallery.clearSelection()
    await gallery.fetch()
  }
}

const pageNumbers = computed(() => {
  const total = gallery.totalPages
  const current = gallery.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = new Set<number>([1, total, current])
  for (let offset = 1; offset <= 1; offset += 1) {
    if (current - offset > 1) pages.add(current - offset)
    if (current + offset < total) pages.add(current + offset)
  }
  return [...pages].sort((a, b) => a - b)
})
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-5">
    <!-- 标题 -->
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1.5">
        <h1 class="text-[22px] font-semibold tracking-tight text-foreground">浮光掠影</h1>
        <p class="text-[13px] text-muted-foreground">
          共 {{ gallery.total }} 张图片
          <span v-if="gallery.activeFilterCount > 0">· 已应用 {{ gallery.activeFilterCount }} 项筛选</span>
        </p>
      </div>

      <AppButton to="/" size="sm">
        <UploadCloud class="h-3.5 w-3.5" />
        去上传
      </AppButton>
    </header>

    <!-- 工具栏 -->
    <GalleryToolbar />

    <!-- 批量操作条 -->
    <Transition name="pop">
      <div
        v-if="gallery.hasSelection"
        class="gl-surface flex flex-wrap items-center justify-between gap-3 border-primary/25 bg-primary-soft/60 px-4 py-3"
      >
        <p class="text-[13px] font-medium text-accent-foreground">
          已选中 {{ gallery.selectionCount }} 张
        </p>
        <div class="flex items-center gap-2">
          <AppButton variant="ghost" size="sm" @click="gallery.clearSelection()">
            <X class="h-3.5 w-3.5" />
            取消选择
          </AppButton>
          <AppButton variant="destructive" size="sm" @click="removeSelected">
            <Trash2 class="h-3.5 w-3.5" />
            删除所选
          </AppButton>
        </div>
      </div>
    </Transition>

    <!-- 全选 -->
    <div v-if="gallery.items.length > 0" class="flex items-center gap-3 px-1">
      <button
        type="button"
        class="gl-focus text-[11px] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
        @click="gallery.toggleSelectAll()"
      >
        {{ gallery.allSelected ? '取消全选' : '全选本页' }}
      </button>
      <span class="text-[11px] text-muted-foreground/60">
        第 {{ gallery.page }} / {{ Math.max(gallery.totalPages, 1) }} 页
      </span>
    </div>

    <!-- 加载骨架 -->
    <div
      v-if="gallery.loading && gallery.items.length === 0"
      :class="gallery.view === 'grid' ? 'grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'space-y-2'"
    >
      <AppSkeleton
        v-for="n in 10"
        :key="n"
        :class="gallery.view === 'grid' ? 'aspect-[4/5]' : 'h-14'"
        rounded="rounded-xl"
      />
    </div>

    <!-- 空态 -->
    <AppEmpty
      v-else-if="!gallery.loading && gallery.items.length === 0"
      icon="🌌"
      :title="gallery.activeFilterCount > 0 ? '没有符合条件的图片' : '还没有图片，上传第一张浮光吧。'"
      :description="gallery.error ?? (gallery.activeFilterCount > 0 ? '试试放宽筛选条件。' : '上传后即可在这里统一管理、复制链接。')"
    >
      <template #action>
        <AppButton v-if="gallery.activeFilterCount > 0" variant="outline" size="sm" @click="gallery.resetFilters()">
          重置筛选
        </AppButton>
        <AppButton v-else to="/" size="sm">去上传</AppButton>
      </template>
    </AppEmpty>

    <!-- 网格视图 -->
    <div
      v-else-if="gallery.view === 'grid'"
      class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <ImageCard
        v-for="image in gallery.items"
        :key="image.id"
        :image="image"
        :selected="gallery.selectedIds.includes(image.id)"
        @open="openImage"
        @toggle="gallery.toggleSelect"
        @remove="removeOne"
      />
    </div>

    <!-- 列表视图 -->
    <div v-else class="gl-surface divide-y divide-border/60 overflow-hidden">
      <div
        class="hidden items-center gap-3 bg-muted/30 px-3 py-2 text-center text-[11px] font-medium text-muted-foreground lg:flex"
      >
        <span class="w-5 shrink-0" />
        <span class="w-10 shrink-0" />
        <span class="min-w-0 flex-1">名称</span>
        <span class="w-24 shrink-0">格式</span>
        <span class="w-28 shrink-0">尺寸</span>
        <span class="w-20 shrink-0">体积</span>
        <span class="w-24 shrink-0">上传者</span>
        <span class="w-20 shrink-0">时间</span>
        <span class="w-16 shrink-0">状态</span>
        <span class="w-7 shrink-0" />
        <span class="w-7 shrink-0" />
      </div>

      <ImageListRow
        v-for="image in gallery.items"
        :key="image.id"
        :image="image"
        :selected="gallery.selectedIds.includes(image.id)"
        @open="openImage"
        @toggle="gallery.toggleSelect"
        @remove="removeOne"
      />
    </div>

    <!-- 分页 -->
    <nav
      v-if="gallery.totalPages > 1"
      class="flex items-center justify-center gap-1.5 pt-2"
      aria-label="分页"
    >
      <AppButton
        variant="outline"
        size="sm"
        :disabled="gallery.page <= 1"
        @click="gallery.setPage(gallery.page - 1)"
      >
        上一页
      </AppButton>

      <template v-for="(pageNumber, index) in pageNumbers" :key="pageNumber">
        <span
          v-if="index > 0 && pageNumber - (pageNumbers[index - 1] ?? 0) > 1"
          class="px-1 text-xs text-muted-foreground"
        >
          …
        </span>
        <button
          type="button"
          class="gl-focus h-8 min-w-8 rounded-lg px-2.5 text-xs font-medium transition-colors duration-250"
          :class="
            pageNumber === gallery.page
              ? 'bg-primary text-primary-foreground shadow-soft'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="gallery.setPage(pageNumber)"
        >
          {{ pageNumber }}
        </button>
      </template>

      <AppButton
        variant="outline"
        size="sm"
        :disabled="gallery.page >= gallery.totalPages"
        @click="gallery.setPage(gallery.page + 1)"
      >
        下一页
      </AppButton>
    </nav>

    <ImageDetailDrawer :open="drawerOpen" @close="closeDrawer" />
  </div>
</template>
