<script setup lang="ts">
import { cn } from '~/utils/cn'

withDefaults(
  defineProps<{
    variant?: 'default' | 'destructive'
    disabled?: boolean
  }>(),
  { variant: 'default' },
)
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :class="
      cn(
        'gl-focus flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-200',
        variant === 'destructive'
          ? 'text-destructive hover:bg-destructive-soft'
          : 'text-foreground hover:bg-muted',
        disabled && 'pointer-events-none opacity-50',
      )
    "
  >
    <slot />
  </button>
</template>
