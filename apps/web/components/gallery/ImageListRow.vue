<script setup lang="ts">
import { FORMAT_LABEL } from '@glimmer/shared'
import type { ImageDTO } from '@glimmer/shared'
import { Check, Copy, Trash2 } from 'lucide-vue-next'

const props = defineProps<{ image: ImageDTO; selected?: boolean }>()

const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'toggle', id: string): void
  (e: 'remove', id: string): void
}>()

const { pendingId, copyImage, formatLabel } = useImageCopy()
const copiedId = ref<string | null>(null)

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
  <div
    class="group flex items-center gap-3 px-3 py-2.5 transition-colors duration-250 hover:bg-muted/40"
    :class="selected && 'bg-primary-soft/50'"
  >
    <!-- 选择 -->
    <span class="flex w-5 shrink-0 justify-center">
      <button
        type="button"
        class="gl-focus flex h-5 w-5 items-center justify-center rounded-md border transition-all duration-250 ease-smooth"
        :class="
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50'
        "
        :aria-label="selected ? '取消选择' : '选择'"
        @click="emit('toggle', image.id)"
      >
        <Check v-if="selected" class="h-3 w-3" />
      </button>
    </span>

    <!-- 缩略图 -->
    <span class="flex w-10 shrink-0 justify-center">
      <button
        type="button"
        class="gl-focus h-10 w-10 overflow-hidden rounded-lg border border-border/70"
        @click="emit('open', image.id)"
      >
        <PreviewImage :src="image.previewUrl" :alt="image.filename" />
      </button>
    </span>

    <!-- 名称 -->
    <button
      type="button"
      class="gl-focus min-w-0 flex-1 text-center"
      @click="emit('open', image.id)"
    >
      <p class="truncate text-[13px] font-medium text-foreground">{{ image.filename }}</p>
      <p class="truncate text-[11px] text-muted-foreground">
        {{ image.originalName ?? '—' }}
      </p>
    </button>

    <span class="hidden w-24 shrink-0 text-center text-[11px] text-muted-foreground sm:block">
      {{ FORMAT_LABEL[image.primaryFormat ?? 'original'] }}
    </span>

    <span class="hidden w-28 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground md:block">
      {{ image.width ?? '—' }} × {{ image.height ?? '—' }}
    </span>

    <span class="hidden w-20 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground sm:block">
      {{ readableSize(image.totalSize) }}
    </span>

    <span class="hidden w-24 shrink-0 truncate text-center text-[11px] text-muted-foreground lg:block">
      {{ image.username }}
    </span>

    <span class="hidden w-20 shrink-0 text-center text-[11px] text-muted-foreground lg:block">
      {{ relativeTime(image.createdAt) }}
    </span>

    <span class="flex w-16 shrink-0 justify-center">
      <AppBadge :variant="status.variant" size="sm" dot>{{ status.label }}</AppBadge>
    </span>

    <!-- 复制（列宽与下方的删除列一致） -->
    <span class="flex w-7 shrink-0 justify-center">
      <button
        type="button"
        class="gl-focus rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-primary-soft hover:text-accent-foreground disabled:opacity-60"
        :title="`复制${formatLabel}链接`"
        :aria-label="`复制${formatLabel}链接`"
        :disabled="pendingId === image.id"
        @click.stop="onCopy"
      >
        <Check v-if="copiedId === image.id" class="h-3.5 w-3.5 text-success" />
        <Copy v-else class="h-3.5 w-3.5" :class="pendingId === image.id && 'animate-pulse'" />
      </button>
    </span>

    <!-- 删除 -->
    <span class="flex w-7 shrink-0 justify-center">
      <button
        type="button"
        class="gl-focus rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-destructive-soft hover:text-destructive"
        aria-label="删除"
        @click.stop="emit('remove', image.id)"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </span>
  </div>
</template>
