<script setup lang="ts">
import { UploadCloud } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ (e: 'files', files: File[]): void }>()

const options = useOptionsStore()

/** 文件选择框的 accept 跟随管理员的白名单，避免选到注定被拒的文件 */
const accept = computed(() => {
  const allowed = options.data?.allowedInputMime
  return allowed && allowed.length > 0 ? allowed.join(',') : 'image/*'
})

const active = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

let depth = 0

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return Boolean(types && Array.from(types).includes('Files'))
}

function onDragEnter(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  depth += 1
  active.value = true
}

function onDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent): void {
  if (!hasFiles(event)) return
  depth = Math.max(0, depth - 1)
  if (depth === 0) active.value = false
}

function onDrop(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  depth = 0
  active.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) emit('files', files)
}

function pick(): void {
  inputRef.value?.click()
}

function onPicked(event: Event): void {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length > 0) emit('files', files)
  target.value = ''
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div>
    <button
      type="button"
      class="gl-focus group relative flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card/60 px-6 py-14 text-center transition-all duration-350 ease-smooth hover:border-primary/45 hover:bg-primary-soft/40 sm:py-16"
      @click="pick"
    >
      <span
        class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-transform duration-450 ease-silk group-hover:-translate-y-1 group-hover:shadow-glow"
      >
        <UploadCloud class="h-7 w-7" />
      </span>

      <span class="space-y-1.5">
        <span class="block text-[15px] font-medium text-foreground">把图片交给浮光</span>
        <span class="block text-xs leading-relaxed text-muted-foreground">
          点击选择、拖拽到任意位置，或直接 <kbd
            class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
          >Ctrl / ⌘ + V</kbd> 粘贴
        </span>
      </span>
    </button>

    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      multiple
      class="hidden"
      @change="onPicked"
    />

    <!-- 全屏投放提示 -->
    <Teleport to="body">
      <Transition name="overlay">
        <div
          v-if="active"
          class="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <div
            class="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-card/95 px-14 py-12 shadow-glow"
          >
            <span
              class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground animate-float"
            >
              <UploadCloud class="h-7 w-7" />
            </span>
            <p class="text-base font-medium text-foreground">松手即可上传</p>
            <p class="text-xs text-muted-foreground">支持一次投放多张图片</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
