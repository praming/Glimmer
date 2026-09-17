<script setup lang="ts">
import { AlertCircle, CheckCircle2, RotateCcw, X } from 'lucide-vue-next'
import type { UploadTask } from '~/stores/upload'

const upload = useUploadStore()

const STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  uploading: '校验与上传中',
  processing: '压缩与同步中',
  ready: '已完成',
  failed: '失败',
}

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'muted' | 'primary' {
  if (status === 'ready') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'queued') return 'muted'
  return 'warning'
}

/** 就已绪任务而言：命中秒传时用不同的标签与配色，让「没传字节」这件事可见 */
function labelFor(task: UploadTask): string {
  if (task.status === 'ready' && task.deduplicated) return '秒传命中'
  return STATUS_TEXT[task.status] ?? task.status
}

function variantFor(task: UploadTask): 'success' | 'warning' | 'destructive' | 'muted' | 'primary' {
  if (task.status === 'ready' && task.deduplicated) return 'primary'
  return statusVariant(task.status)
}
</script>

<template>
  <div v-if="upload.tasks.length > 0" class="gl-surface overflow-hidden">
    <header class="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-foreground">上传队列</h2>
        <AppBadge variant="muted" size="sm">{{ upload.tasks.length }}</AppBadge>
        <AppSpinner v-if="upload.isBusy" :size="13" class="text-primary" />
      </div>

      <div class="flex items-center gap-1.5">
        <AppButton
          v-if="upload.failed.length > 0"
          variant="ghost"
          size="sm"
          @click="upload.retryFailed()"
        >
          <RotateCcw class="h-3.5 w-3.5" />
          重试失败项
        </AppButton>
        <AppButton
          v-if="!upload.isBusy"
          variant="ghost"
          size="sm"
          @click="upload.clearFinished()"
        >
          清空已完成
        </AppButton>
      </div>
    </header>

    <ul class="divide-y divide-border/60">
      <li
        v-for="task in upload.tasks"
        :key="task.id"
        class="flex items-center gap-3.5 px-5 py-3 transition-colors duration-250 hover:bg-muted/40"
      >
        <div class="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted">
          <PreviewImage :src="task.result?.previewUrl ?? task.localPreview" :alt="task.name" eager />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-[13px] font-medium text-foreground">{{ task.name }}</p>
            <AppBadge :variant="variantFor(task)" size="sm" dot>
              {{ labelFor(task) }}
            </AppBadge>
          </div>

          <div class="mt-1.5 flex items-center gap-3">
            <div class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-primary transition-all duration-450 ease-smooth"
                :class="task.status === 'failed' && 'bg-destructive'"
                :style="{ width: `${task.status === 'processing' ? 100 : task.progress}%` }"
              />
            </div>
            <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {{ task.status === 'processing' ? '处理中' : `${task.progress}%` }}
            </span>
            <span class="shrink-0 text-[11px] text-muted-foreground">{{ readableSize(task.size) }}</span>
          </div>

          <p v-if="task.error" class="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
            <AlertCircle class="h-3 w-3 shrink-0" />
            <span class="truncate">{{ task.error }}</span>
          </p>
        </div>

        <CheckCircle2 v-if="task.status === 'ready'" class="h-4 w-4 shrink-0 text-success" />

        <button
          v-if="task.status !== 'uploading' && task.status !== 'processing'"
          type="button"
          class="gl-focus shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
          aria-label="移除"
          @click="upload.removeTask(task.id)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </li>
    </ul>
  </div>
</template>
