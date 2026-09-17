<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { ref } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    value: string
    label?: string
    size?: 'sm' | 'md'
    variant?: 'ghost' | 'outline' | 'subtle'
    showLabel?: boolean
    successText?: string
  }>(),
  { size: 'sm', variant: 'ghost', showLabel: false },
)

const toast = useToast()
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  if (!props.value) return

  const ok = await copyText(props.value)

  if (!ok) {
    toast.error('复制失败', '请手动选择文本复制')
    return
  }

  copied.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 1600)
}
</script>

<template>
  <button
    type="button"
    :title="copied ? '已复制' : `复制${label ?? ''}`"
    :class="
      cn(
        'gl-focus inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-250 ease-smooth',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm',
        variant === 'ghost' && 'text-muted-foreground hover:bg-muted hover:text-foreground',
        variant === 'outline' && 'border border-border bg-card hover:border-primary/30 hover:bg-muted',
        variant === 'subtle' && 'bg-primary-soft text-accent-foreground hover:bg-primary-soft/70',
        copied && 'text-success',
      )
    "
    @click.stop="copy"
  >
    <Transition name="pop" mode="out-in">
      <Check v-if="copied" :key="'check'" class="h-3.5 w-3.5" />
      <Copy v-else :key="'copy'" class="h-3.5 w-3.5" />
    </Transition>
    <span v-if="showLabel" class="truncate">{{ copied ? (successText ?? '已复制') : (label ?? '复制') }}</span>
  </button>
</template>
