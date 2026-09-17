<script setup lang="ts">
import { Info } from 'lucide-vue-next'

const upload = useUploadStore()
const toast = useToast()
const options = useOptionsStore()

function onFiles(files: File[]): void {
  upload.enqueue(files)
}

/** 粘贴上传（Ctrl / ⌘ + V） */
function onPaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }

  if (files.length === 0) return
  event.preventDefault()
  upload.enqueue(files)
  toast.info(`已从剪贴板加入 ${files.length} 张图片`)
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  void options.load()
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-5">
    <!-- 标题 -->
    <header class="space-y-1.5">
      <h1 class="text-[22px] font-semibold tracking-tight text-foreground">把图片交给浮光</h1>
      <p class="text-[13px] leading-relaxed text-muted-foreground">
        上传后会自动压缩、去除 EXIF，并并行写入你选择的所有存储后端。
      </p>
    </header>

    <!-- 上传选项 -->
    <UploadOptionsBar />

    <!-- 投放区 -->
    <UploadDropzone @files="onFiles" />

    <!-- 上限提示 -->
    <p class="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground/80">
      <Info class="h-3 w-3 shrink-0" />
      单文件上限 {{ options.data?.maxUploadSizeMb ?? 20 }} MB，一次最多 20 张。
      命名规则
      <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
        {{ options.data?.namingTemplate ?? '{date}/{random}-{origin}' }}
      </code>
    </p>

    <!-- 队列 -->
    <UploadTaskList />

    <!-- 结果 -->
    <UploadResultList />

    <!-- 空态引导 -->
    <div
      v-if="upload.tasks.length === 0 && upload.history.length === 0"
      class="gl-surface px-5 py-5"
    >
      <h2 class="text-[13px] font-semibold text-foreground">小提示</h2>
      <ul class="mt-2.5 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
        <li>· 拖拽时整个页面都会变成放置区域，松手即上传。</li>
        <li>· 复制过的图片可以直接 <kbd class="rounded border border-border bg-muted px-1 font-mono text-[10px]">Ctrl / ⌘ + V</kbd> 粘贴进来。</li>
        <li>· 四种复制格式（直链 / Markdown / HTML / BBCode）可在「设置 → 个人偏好」中设定默认值。</li>
      </ul>
    </div>
  </div>
</template>
