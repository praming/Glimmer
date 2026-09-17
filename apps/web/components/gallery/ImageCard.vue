<script setup lang="ts">
import { FORMAT_LABEL } from '@glimmer/shared'
import type { ImageDTO } from '@glimmer/shared'
import { Check, Copy, Maximize2, Trash2 } from 'lucide-vue-next'

const props = defineProps<{ image: ImageDTO; selected?: boolean }>()

const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
}>()

const { pendingId, copyImage, formatLabel } = useImageCopy()
const copiedId = ref<string | null>(null)

/** 复制成功后在按钮上短暂打勾 */
async function onCopy(): Promise<void> {
  const ok = await copyImage(props.image)
  if (!ok) return
  copiedId.value = props.image.id
  setTimeout(() => {
    if (copiedId.value === props.image.id) copiedId.value = null
  }, 1600)
}

const statusMap = {
  ready: { label: '已就绪', variant: 'success' as const },
  pending: { label: '处理中', variant: 'warning' as const },
  failed: { label: '失败', variant: 'destructive' as const },
}

const status = computed(() => statusMap[props.image.status] ?? statusMap.pending)
</script>

<template>
  <article
    class="group relative overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-all duration-350 ease-smooth hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lift"
  >
    <!-- 缩略图 -->
    <button
      type="button"
      class="gl-focus relative block aspect-[4/3] w-full overflow-hidden bg-muted"
      @click="emit('open', image.id)"
    >
      <PreviewImage :src="image.previewUrl" :alt="image.filename" />

      <!-- hover 遮罩 -->
      <span
        class="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/35 opacity-0 transition-opacity duration-350 ease-smooth group-hover:opacity-100"
      >
        <span
          class="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lift"
        >
          <Maximize2 class="h-4 w-4" />
        </span>
      </span>

      <!-- 左上角状态 -->
      <span class="absolute left-2 top-2 flex flex-col items-start gap-1.5">
        <AppBadge :variant="status.variant" size="sm" dot>{{ status.label }}</AppBadge>
      </span>

      <!-- 右上角格式 -->
      <span
        v-if="image.primaryFormat"
        class="absolute right-2 top-2 rounded-md bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm"
      >
        {{ FORMAT_LABEL[image.primaryFormat] }}
      </span>
    </button>

    <!-- 选择框 -->
    <button
      type="button"
      class="gl-focus absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border transition-all duration-250 ease-smooth"
      :class="
        selected
          ? 'border-primary bg-primary text-primary-foreground opacity-100'
          : 'border-white/70 bg-slate-950/30 opacity-0 backdrop-blur-sm group-hover:opacity-100'
      "
      :aria-label="selected ? '取消选择' : '选择'"
      @click.stop="emit('toggle', image.id)"
    >
      <Check v-if="selected" class="h-3 w-3" />
    </button>

    <!-- 信息 -->
    <div class="space-y-1.5 px-3 py-2.5">
      <!-- 第一行：文件名（左） · 上传者与时间（右） -->
      <div class="flex items-center justify-between gap-2">
        <p
          class="min-w-0 truncate text-[13px] font-medium text-foreground"
          :title="image.originalName ?? image.filename"
        >
          {{ image.filename }}
        </p>
        <span class="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/80">
          {{ image.username }} · {{ relativeTime(image.createdAt) }}
        </span>
      </div>

      <!-- 第二行：尺寸与体积（左） · 复制与删除（右） -->
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[11px] text-muted-foreground">
          {{ image.width ?? '—' }} × {{ image.height ?? '—' }} · {{ readableSize(image.totalSize) }}
        </span>

        <span class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-250 group-hover:opacity-100">
          <button
            type="button"
            class="gl-focus rounded-md p-1 text-muted-foreground transition-colors duration-250 hover:bg-primary-soft hover:text-accent-foreground disabled:opacity-60"
            :title="`复制${formatLabel}链接`"
            :aria-label="`复制${formatLabel}链接`"
            :disabled="pendingId === image.id"
            @click.stop="onCopy"
          >
            <Check v-if="copiedId === image.id" class="h-3.5 w-3.5 text-success" />
            <Copy v-else class="h-3.5 w-3.5" :class="pendingId === image.id && 'animate-pulse'" />
          </button>

          <button
            type="button"
            class="gl-focus rounded-md p-1 text-muted-foreground transition-colors duration-250 hover:bg-destructive-soft hover:text-destructive"
            aria-label="删除"
            @click.stop="emit('remove', image.id)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  </article>
</template>
