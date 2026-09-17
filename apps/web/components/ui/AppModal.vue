<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const model = defineModel<boolean>({ default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    closable?: boolean
  }>(),
  { size: 'md', closable: true },
)

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const

const panelClass = computed(() => cn('w-full', SIZES[props.size]))

function close(): void {
  model.value = false
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && model.value) close()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay">
      <div
        v-if="model"
        class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
        @click.self="close"
      >
        <Transition name="scale-in" appear>
          <div
            :class="[
              panelClass,
              'gl-surface max-h-[92vh] overflow-hidden rounded-b-none shadow-lift sm:rounded-xl',
            ]"
            role="dialog"
            aria-modal="true"
          >
            <header
              v-if="title || $slots.header"
              class="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4"
            >
              <div class="min-w-0">
                <slot name="header">
                  <h2 class="text-base font-semibold tracking-tight text-foreground">{{ title }}</h2>
                  <p v-if="description" class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {{ description }}
                  </p>
                </slot>
              </div>

              <button
                v-if="closable"
                type="button"
                class="gl-focus -mr-1 rounded-lg p-1.5 text-muted-foreground transition-colors duration-250 hover:bg-muted hover:text-foreground"
                aria-label="关闭"
                @click="close"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
              <slot />
            </div>

            <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3.5">
              <slot name="footer" />
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
