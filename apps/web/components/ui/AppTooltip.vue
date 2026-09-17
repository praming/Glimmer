<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    text?: string
    example?: string
    /** 浮层宽度（px） */
    width?: number
    disabled?: boolean
  }>(),
  { width: 264 },
)

const GAP = 8

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pos = ref<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: null, bottom: null })

const panelStyle = computed(() => ({
  left: `${pos.value.left}px`,
  width: `${props.width}px`,
  ...(pos.value.top != null ? { top: `${pos.value.top}px` } : {}),
  ...(pos.value.bottom != null ? { bottom: `${pos.value.bottom}px` } : {}),
}))

function sync(): void {
  const el = anchor.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  const height = panel.value?.offsetHeight ?? 84
  // 上方塞不下就翻到下方
  const flipDown = rect.top - GAP - height < 8
  const rawLeft = rect.left + rect.width / 2 - props.width / 2
  const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - props.width - 8))

  pos.value = flipDown
    ? { left, top: rect.bottom + GAP, bottom: null }
    : { left, top: null, bottom: window.innerHeight - rect.top + GAP }
}

async function show(): Promise<void> {
  if (props.disabled) return
  open.value = true
  await nextTick()
  sync()
}

function hide(): void {
  open.value = false
}

/** 滚动时锚点会移走，直接收起比重新定位更符合预期 */
function onScroll(): void {
  if (open.value) hide()
}

if (import.meta.client) {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
}

onBeforeUnmount(() => {
  if (!import.meta.client) return
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <span
    ref="anchor"
    class="inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
  >
    <slot />
  </span>

  <Teleport to="body">
    <Transition name="pop">
      <div
        v-if="open"
        ref="panel"
        role="tooltip"
        class="pointer-events-none fixed z-[80] rounded-xl border border-border bg-popover px-3 py-2.5 shadow-lift"
        :style="panelStyle"
      >
        <p v-if="title" class="text-[11px] font-semibold text-foreground">{{ title }}</p>
        <p v-if="text" class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{{ text }}</p>
        <p v-if="example" class="mt-1.5 text-[11px] text-muted-foreground">
          示例：
          <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{{ example }}</code>
        </p>
      </div>
    </Transition>
  </Teleport>
</template>
