<script setup lang="ts">
import { FORMAT_LABEL, STORAGE_BACKEND_LABEL } from '@glimmer/shared'
import type { OutputFormat } from '@glimmer/shared'
import { Cloud, HardDrive, Server } from 'lucide-vue-next'
import type { Component } from 'vue'

const upload = useUploadStore()
const options = useOptionsStore()

const BACKEND_ICON: Record<string, Component> = {
  local: HardDrive,
  s3: Cloud,
  webdav: Server,
}

onMounted(() => {
  void upload.ensureOptions()
})

function toggleFormat(format: OutputFormat): void {
  const current = [...upload.formats]
  const index = current.indexOf(format)
  if (index >= 0) {
    if (current.length === 1) return
    current.splice(index, 1)
  } else {
    current.push(format)
  }
  upload.formats = current
}

function toggleBackend(id: string): void {
  const current = [...upload.backends]
  const index = current.indexOf(id)
  if (index >= 0) {
    if (current.length === 1) return
    current.splice(index, 1)
  } else {
    current.push(id)
  }
  upload.backends = current
}

const availableFormats = computed<OutputFormat[]>(() => ['webp', 'jpeg', 'avif', 'png', 'gif'])
</script>

<template>
  <div class="gl-surface space-y-5 px-5 py-4">
    <!-- 输出格式 -->
    <div class="space-y-2.5">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium text-muted-foreground">输出格式</p>
        <p class="text-[11px] text-muted-foreground/70">至少保留一种</p>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="format in availableFormats"
          :key="format"
          type="button"
          class="gl-focus rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-250 ease-smooth"
          :class="
            upload.formats.includes(format)
              ? 'border-primary/40 bg-primary-soft text-accent-foreground shadow-soft'
              : 'border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-foreground'
          "
          @click="toggleFormat(format)"
        >
          {{ FORMAT_LABEL[format] }}
        </button>
      </div>

      <AppSwitch
        v-model="upload.keepOriginal"
        label="同时保留原图"
        description="字节级保留上传文件（含 EXIF），用于归档；默认关闭以获得最大压缩收益。"
      />
    </div>

    <!-- 存储后端 -->
    <div class="space-y-2.5 border-t border-border/70 pt-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium text-muted-foreground">写入后端</p>
        <p class="text-[11px] text-muted-foreground/70">可多选，并行写入</p>
      </div>

      <div v-if="options.loading && !options.data" class="flex gap-2">
        <AppSkeleton class="h-8 w-28" />
        <AppSkeleton class="h-8 w-28" />
      </div>

      <div v-else-if="options.backends.length === 0" class="text-xs text-warning">
        当前没有启用的存储后端，请联系管理员在设置中开启。
      </div>

      <div v-else class="flex flex-wrap gap-2">
        <button
          v-for="backend in options.backends"
          :key="backend.id"
          type="button"
          class="gl-focus inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-250 ease-smooth"
          :class="
            upload.backends.includes(backend.id)
              ? 'border-primary/40 bg-primary-soft text-accent-foreground shadow-soft'
              : 'border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-foreground'
          "
          @click="toggleBackend(backend.id)"
        >
          <component :is="BACKEND_ICON[backend.type] ?? HardDrive" class="h-3.5 w-3.5" />
          <span>{{ backend.name }}</span>
          <span class="text-[10px] text-muted-foreground/70">
            {{ STORAGE_BACKEND_LABEL[backend.type] }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
