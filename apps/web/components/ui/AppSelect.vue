<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { cn } from '~/utils/cn'

export interface SelectOption {
  label: string
  value: string
  disabled?: boolean
}

const model = defineModel<string | undefined>()

const props = withDefaults(
  defineProps<{
    label?: string
    hint?: string
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    placeholderOption?: boolean
  }>(),
  { size: 'md' },
)

const id = useId()

const SIZES = {
  sm: 'h-8 text-xs',
  md: 'h-10 text-sm',
  lg: 'h-11 text-[15px]',
} as const

const root = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const open = ref(false)
const activeIndex = ref(-1)

/** 下拉项：`placeholderOption !== false` 时在最前插入一个空值项 */
const items = computed<SelectOption[]>(() => {
  const list = [...props.options]
  if (props.placeholderOption !== false) {
    list.unshift({ label: props.placeholder ?? '请选择', value: '' })
  }
  return list
})

const selected = computed(() => items.value.find((item) => item.value === (model.value ?? '')))
const isPlaceholder = computed(() => !selected.value || selected.value.value === '')

/* ------------------------------------------------------------------ */
/* 浮层定位：固定定位 + 空间不足时向上翻转                              */
/* ------------------------------------------------------------------ */

const PANEL_GAP = 6
const PANEL_MAX = 288
const ITEM_HEIGHT = 38

const pos = ref<{ left: number; width: number; maxHeight: number; top: number | null; bottom: number | null }>({
  left: 0,
  width: 0,
  maxHeight: PANEL_MAX,
  top: null,
  bottom: null,
})

const panelStyle = computed(() => ({
  left: `${pos.value.left}px`,
  width: `${pos.value.width}px`,
  maxHeight: `${pos.value.maxHeight}px`,
  ...(pos.value.top != null ? { top: `${pos.value.top}px` } : {}),
  ...(pos.value.bottom != null ? { bottom: `${pos.value.bottom}px` } : {}),
}))

function syncPosition(): void {
  const trigger = triggerRef.value
  if (!trigger) return

  const rect = trigger.getBoundingClientRect()
  const wanted = Math.min(items.value.length * ITEM_HEIGHT + 12, PANEL_MAX)
  const spaceBelow = window.innerHeight - rect.bottom - PANEL_GAP
  const spaceAbove = rect.top - PANEL_GAP
  const flipUp = spaceBelow < Math.min(wanted, 180) && spaceAbove > spaceBelow

  pos.value = {
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(96, Math.min(wanted, flipUp ? spaceAbove : spaceBelow)),
    top: flipUp ? null : rect.bottom + PANEL_GAP,
    bottom: flipUp ? window.innerHeight - rect.top + PANEL_GAP : null,
  }
}

function close(): void {
  open.value = false
  activeIndex.value = -1
}

async function openPanel(): Promise<void> {
  if (props.disabled) return
  open.value = true
  const current = items.value.findIndex((item) => item.value === (model.value ?? ''))
  activeIndex.value = current >= 0 ? current : 0
  await nextTick()
  syncPosition()
}

/* ------------------------------------------------------------------ */
/* 交互                                                                */
/* ------------------------------------------------------------------ */

function commit(index: number): void {
  const item = items.value[index]
  if (!item || item.disabled) return
  model.value = item.value
  close()
  triggerRef.value?.focus()
}

function move(delta: number): void {
  const total = items.value.length
  if (total === 0) return
  let next = activeIndex.value
  for (let step = 0; step < total; step += 1) {
    next = (next + delta + total) % total
    if (!items.value[next]?.disabled) break
  }
  activeIndex.value = next
  void nextTick(() => {
    panelRef.value?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (props.disabled) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      open.value ? move(1) : void openPanel()
      break
    case 'ArrowUp':
      event.preventDefault()
      open.value ? move(-1) : void openPanel()
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      open.value ? commit(activeIndex.value) : void openPanel()
      break
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        close()
      }
      break
    case 'Tab':
      close()
      break
  }
}

function onWindowPointerDown(event: PointerEvent): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (!target) return
  if (root.value?.contains(target) || panelRef.value?.contains(target)) return
  close()
}

function onWindowScroll(event: Event): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (target && panelRef.value?.contains(target)) return
  syncPosition()
}

if (import.meta.client) {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('scroll', onWindowScroll, true)
  window.addEventListener('resize', syncPosition)
}

onBeforeUnmount(() => {
  if (!import.meta.client) return
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('resize', syncPosition)
})

defineExpose({ open: openPanel, close })
</script>

<template>
  <div ref="root" class="flex flex-col gap-1.5">
    <label v-if="label" :id="`${id}-label`" class="text-xs font-medium text-muted-foreground">
      {{ label }}
    </label>

    <button
      :id="id"
      ref="triggerRef"
      type="button"
      role="combobox"
      :aria-expanded="open"
      :aria-controls="`${id}-panel`"
      :aria-labelledby="label ? `${id}-label` : undefined"
      :disabled="disabled"
      :class="
        cn(
          'gl-focus flex w-full cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-left',
          'transition-all duration-250 ease-smooth hover:border-border disabled:cursor-not-allowed disabled:opacity-60',
          SIZES[size],
          open && 'border-primary/40 ring-2 ring-ring/25',
        )
      "
      @click="open ? close() : void openPanel()"
      @keydown="onTriggerKeydown"
    >
      <span class="min-w-0 flex-1 truncate" :class="isPlaceholder ? 'text-muted-foreground/70' : 'text-foreground'">
        {{ selected?.label ?? placeholder ?? '请选择' }}
      </span>

      <ChevronDown
        class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-250 ease-smooth"
        :class="open && 'rotate-180'"
      />
    </button>

    <Teleport to="body">
      <Transition name="pop">
        <div
          v-if="open"
          :id="`${id}-panel`"
          ref="panelRef"
          role="listbox"
          :aria-labelledby="label ? `${id}-label` : undefined"
          class="fixed z-[70] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lift"
          :style="panelStyle"
        >
          <button
            v-for="(item, index) in items"
            :key="`${item.value}-${index}`"
            type="button"
            role="option"
            :data-index="index"
            :aria-selected="item.value === (model ?? '')"
            :disabled="item.disabled"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-200',
                item.disabled && 'pointer-events-none opacity-40',
                item.value === (model ?? '')
                  ? 'bg-primary-soft font-medium text-accent-foreground'
                  : 'text-foreground hover:bg-muted',
                index === activeIndex && item.value !== (model ?? '') && 'bg-muted',
              )
            "
            @mouseenter="activeIndex = index"
            @click="commit(index)"
          >
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <Check v-if="item.value === (model ?? '')" class="h-3.5 w-3.5 shrink-0" />
          </button>
        </div>
      </Transition>
    </Teleport>

    <p v-if="hint" class="text-xs text-muted-foreground/80">{{ hint }}</p>
  </div>
</template>
