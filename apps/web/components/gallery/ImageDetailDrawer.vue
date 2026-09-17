<script setup lang="ts">
import { COPY_FORMATS, COPY_FORMAT_LABEL, FORMAT_LABEL } from '@glimmer/shared'
import type { VariantDTO } from '@glimmer/shared'
import { useEventListener } from '@vueuse/core'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const gallery = useGalleryStore()
const options = useOptionsStore()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const image = computed(() => gallery.detail)
const canModify = computed(
  () => Boolean(image.value) && (auth.isAdmin || image.value?.userId === auth.user?.id),
)

/* ------------------------------ 变体切换 ------------------------------ */

const activeVariantId = ref('')

const activeVariant = computed<VariantDTO | null>(() => {
  const variants = image.value?.variants ?? []
  return variants.find((v) => v.id === activeVariantId.value) ?? variants[0] ?? null
})

watch(
  () => image.value?.id,
  () => {
    const variants = image.value?.variants ?? []
    activeVariantId.value = variants.find((v) => v.format === 'webp')?.id ?? variants[0]?.id ?? ''
  },
)

const readyCount = computed(
  () => (image.value?.variants ?? []).flatMap((v) => v.storages).filter((s) => s.status === 'ready').length,
)
const failedStorages = computed(
  () => (image.value?.variants ?? []).flatMap((v) => v.storages).filter((s) => s.status === 'failed'),
)

/**
 * P3-4：把「后台还会不会自动救回来」讲清楚。
 * 自动重试排期是图片级的（取所有失败记录里最早的一次），而不是逐条展示。
 */
const retryHint = computed(() => {
  const retry = image.value?.retry
  if (!retry || failedStorages.value.length === 0) return ''

  if (retry.exhausted) {
    return `自动重试已用尽 ${retry.attemptCount} 次配额，请手动重试或检查后端配置`
  }
  if (retry.nextRetryAt) {
    return retry.attemptCount > 0
      ? `已自动重试 ${retry.attemptCount} 次，将于 ${readableDate(retry.nextRetryAt)} 再次尝试`
      : `将于 ${readableDate(retry.nextRetryAt)} 自动重试`
  }
  return ''
})

/* ------------------------------ 重命名 ------------------------------ */

const renaming = ref(false)
const nameDraft = ref('')
const savingName = ref(false)

function startRename(): void {
  nameDraft.value = image.value?.filename ?? ''
  renaming.value = true
}

async function submitRename(): Promise<void> {
  if (!image.value) return
  const next = nameDraft.value.trim()
  if (!next || next === image.value.filename) {
    renaming.value = false
    return
  }
  savingName.value = true
  const ok = await gallery.rename(image.value.id, next)
  savingName.value = false
  if (ok) renaming.value = false
}

/* ------------------------------ 同步操作 ------------------------------ */

const busy = ref(false)

async function retryAll(): Promise<void> {
  if (!image.value) return
  busy.value = true
  await gallery.retry(image.value.id)
  await options.load(true)
  busy.value = false
}

async function retryOne(backendId: string): Promise<void> {
  if (!image.value) return
  busy.value = true
  await gallery.retry(image.value.id, [backendId])
  await options.load(true)
  busy.value = false
}

const missingBackends = computed(() => {
  const present = new Set((image.value?.variants ?? []).flatMap((v) => v.storages.map((s) => s.backendId)))
  return (options.data?.backends ?? []).filter((b) => !present.has(b.id))
})

async function addBackend(backendId: string): Promise<void> {
  if (!image.value) return
  busy.value = true
  const ok = await gallery.retry(image.value.id, [backendId])
  if (ok) await options.load(true)
  busy.value = false
}

/* ------------------------------ 删除 ------------------------------ */

async function removeImage(): Promise<void> {
  if (!image.value) return

  const ok = await confirm.confirm({
    title: '删除这张图片？',
    description: '所有存储后端中的文件都会被同步删除，操作无法撤销。',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return

  const success = await gallery.remove(image.value.id)
  if (success) {
    gallery.closeDetail()
    emit('close')
    await gallery.fetch()
  }
}

/* ------------------------------ 其他 ------------------------------ */

function close(): void {
  emit('close')
}

function openRaw(): void {
  const url = activeVariant.value?.primaryUrl
  if (url) window.open(url, '_blank', 'noreferrer')
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) close()
})
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <Transition name="overlay">
      <div
        v-if="open"
        class="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]"
        @click="close"
      />
    </Transition>

    <!-- 抽屉 -->
    <Transition name="drawer">
      <aside
        v-if="open"
        class="fixed inset-y-0 right-0 z-[71] flex w-full max-w-[30rem] flex-col border-l border-border bg-card shadow-lift"
      >
        <!-- 头部 -->
        <header class="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div class="min-w-0 flex-1">
            <div v-if="renaming" class="flex items-center gap-2">
              <AppInput v-model="nameDraft" size="sm" autofocus @keydown.enter="submitRename" />
              <AppButton size="icon-sm" :loading="savingName" @click="submitRename">
                <Check class="h-3.5 w-3.5" />
              </AppButton>
              <AppButton variant="ghost" size="icon-sm" @click="renaming = false">
                <X class="h-3.5 w-3.5" />
              </AppButton>
            </div>

            <div v-else class="flex items-center gap-2">
              <h2 class="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {{ image?.filename ?? '加载中…' }}
              </h2>
              <button
                v-if="canModify"
                type="button"
                class="gl-focus shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
                title="重命名"
                @click="startRename"
              >
                <Pencil class="h-3.5 w-3.5" />
              </button>
            </div>

            <p class="mt-1 truncate text-[11px] text-muted-foreground">
              {{ image?.originalName ?? '—' }}
            </p>
          </div>

          <button
            type="button"
            class="gl-focus -mr-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
            aria-label="关闭"
            @click="close"
          >
            <X class="h-4 w-4" />
          </button>
        </header>

        <!-- 主体 -->
        <div class="gl-scroll-area flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div v-if="gallery.detailLoading" class="space-y-3">
            <AppSkeleton class="h-52 w-full" rounded="rounded-xl" />
            <AppSkeleton class="h-4 w-1/2" />
            <AppSkeleton class="h-4 w-2/3" />
          </div>

          <template v-else-if="image">
            <!-- 预览 -->
            <div
              class="gl-clip-rounded relative overflow-hidden rounded-xl border border-border bg-muted"
            >
              <div class="flex max-h-[22rem] min-h-[12rem] items-center justify-center">
                <PreviewImage
                  :src="activeVariant?.primaryUrl ?? image.previewUrl"
                  :alt="image.filename"
                  eager
                />
              </div>
              <button
                type="button"
                class="gl-focus absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-950/65 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors duration-200 hover:bg-slate-950/80"
                @click="openRaw"
              >
                <ExternalLink class="h-3 w-3" />
                打开原图
              </button>
            </div>

            <!-- 基本信息 -->
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
              <div>
                <dt class="text-muted-foreground">上传者</dt>
                <dd class="mt-0.5 font-medium text-foreground">{{ image.username }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">上传时间</dt>
                <dd class="mt-0.5 font-medium text-foreground">{{ readableDate(image.createdAt) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">尺寸</dt>
                <dd class="mt-0.5 font-medium tabular-nums text-foreground">
                  {{ image.width ?? '—' }} × {{ image.height ?? '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">总体积</dt>
                <dd class="mt-0.5 font-medium tabular-nums text-foreground">
                  {{ readableSize(image.totalSize) }}
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="text-muted-foreground">后端同步</dt>
                <dd class="mt-1 flex flex-wrap items-center gap-1.5">
                  <AppBadge :variant="image.status === 'ready' ? 'success' : image.status === 'failed' ? 'destructive' : 'warning'" size="sm" dot>
                    {{ image.status === 'ready' ? '已就绪' : image.status === 'failed' ? '全部失败' : '处理中' }}
                  </AppBadge>
                  <span class="text-[11px] text-muted-foreground">{{ readyCount }} 个后端副本</span>
                </dd>
              </div>
            </dl>

            <!-- 变体 -->
            <section class="space-y-2.5">
              <h3 class="text-xs font-semibold text-foreground">格式变体</h3>

              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="variant in image.variants"
                  :key="variant.id"
                  type="button"
                  class="gl-focus inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-250 ease-smooth"
                  :class="
                    activeVariant?.id === variant.id
                      ? 'border-primary/40 bg-primary-soft text-accent-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  "
                  @click="activeVariantId = variant.id"
                >
                  {{ FORMAT_LABEL[variant.format] }}
                  <span
                    class="h-1.5 w-1.5 rounded-full"
                    :class="{
                      'bg-success': variant.status === 'ready',
                      'bg-warning': variant.status === 'pending',
                      'bg-destructive': variant.status === 'failed',
                    }"
                  />
                </button>
              </div>

              <div v-if="activeVariant" class="gl-surface space-y-3 px-3.5 py-3">
                <div class="grid grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <p class="text-muted-foreground">尺寸</p>
                    <p class="mt-0.5 font-medium tabular-nums text-foreground">
                      {{ activeVariant.width ?? '—' }} × {{ activeVariant.height ?? '—' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-muted-foreground">体积</p>
                    <p class="mt-0.5 font-medium tabular-nums text-foreground">
                      {{ readableSize(activeVariant.size) }}
                    </p>
                  </div>
                  <div>
                    <p class="text-muted-foreground">MD5</p>
                    <p class="mt-0.5 truncate font-mono text-foreground" :title="activeVariant.md5 ?? ''">
                      {{ activeVariant.md5?.slice(0, 8) ?? '—' }}
                    </p>
                  </div>
                </div>

                <div class="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                  <CopyButton
                    v-for="format in COPY_FORMATS"
                    :key="format"
                    :value="activeVariant.copy?.[format] ?? ''"
                    :label="COPY_FORMAT_LABEL[format]"
                    :show-label="true"
                    variant="outline"
                  />
                </div>

                <code class="block truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {{ activeVariant.primaryUrl ?? '暂无可用链接' }}
                </code>

                <!-- 各后端状态 -->
                <ul class="space-y-1.5 border-t border-border/60 pt-3">
                  <li
                    v-for="storage in activeVariant.storages"
                    :key="storage.id"
                    class="flex items-center gap-2 text-[11px]"
                  >
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="{
                        'bg-success': storage.status === 'ready',
                        'bg-warning': storage.status === 'pending',
                        'bg-destructive': storage.status === 'failed',
                      }"
                    />
                    <span class="shrink-0 font-medium text-foreground">{{ storage.backendName }}</span>
                    <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="storage.path">
                      {{ storage.errorMessage ?? storage.path }}
                    </span>
                    <span
                      v-if="storage.status === 'failed' && storage.attemptCount > 0"
                      class="shrink-0 tabular-nums text-destructive/80"
                      :title="`已自动重试 ${storage.attemptCount} 次`"
                    >
                      ×{{ storage.attemptCount }}
                    </span>
                    <CopyButton v-if="storage.url" :value="storage.url" variant="ghost" />

                    <button
                      v-if="storage.status === 'failed' && canModify"
                      type="button"
                      class="gl-focus shrink-0 rounded-md p-1 text-destructive transition-colors duration-200 hover:bg-destructive-soft"
                      title="重试该后端"
                      :disabled="busy"
                      @click="retryOne(storage.backendId)"
                    >
                      <RefreshCw class="h-3 w-3" :class="busy && 'animate-spin'" />
                    </button>
                  </li>
                </ul>
              </div>
            </section>

            <!-- 补充同步 -->
            <section v-if="canModify && missingBackends.length > 0" class="space-y-2">
              <h3 class="text-xs font-semibold text-foreground">补充同步到其他后端</h3>
              <div class="flex flex-wrap gap-1.5">
                <AppButton
                  v-for="backend in missingBackends"
                  :key="backend.id"
                  variant="outline"
                  size="sm"
                  :disabled="busy"
                  @click="addBackend(backend.id)"
                >
                  <Plus class="h-3.5 w-3.5" />
                  {{ backend.name }}
                </AppButton>
              </div>
            </section>

            <!-- 失败提示 -->
            <div
              v-if="failedStorages.length > 0"
              class="flex items-start gap-2.5 rounded-lg bg-destructive-soft px-3.5 py-3 text-[11px] text-destructive"
            >
              <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div class="min-w-0">
                <p class="font-medium">有 {{ failedStorages.length }} 个后端同步失败</p>
                <p class="mt-0.5 break-all opacity-80">
                  {{ failedStorages[0]?.errorMessage }}
                </p>
                <p v-if="retryHint" class="mt-1.5 tabular-nums opacity-80">{{ retryHint }}</p>
              </div>
            </div>
          </template>
        </div>

        <!-- 底部操作 -->
        <footer
          v-if="image && canModify"
          class="flex items-center justify-between gap-2 border-t border-border/70 px-5 py-3.5"
        >
          <AppButton
            variant="outline"
            size="sm"
            :loading="busy"
            :disabled="failedStorages.length === 0"
            @click="retryAll"
          >
            <RefreshCw class="h-3.5 w-3.5" />
            重试失败同步
          </AppButton>

          <AppButton variant="destructive" size="sm" @click="removeImage">
            <Trash2 class="h-3.5 w-3.5" />
            删除
          </AppButton>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>
