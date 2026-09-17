<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '~/utils/cn'

type Variant = 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'muted' | 'outline'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    dot?: boolean
    size?: 'sm' | 'md'
  }>(),
  { variant: 'default', size: 'md' },
)

const VARIANTS: Record<Variant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  primary: 'bg-primary-soft text-accent-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  muted: 'bg-muted text-muted-foreground',
  outline: 'border border-border text-muted-foreground',
}

const classes = computed(() =>
  cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium',
    props.size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
    VARIANTS[props.variant],
  ),
)

const DOT_COLORS: Record<Variant, string> = {
  default: 'bg-foreground/50',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
  outline: 'bg-muted-foreground',
}
</script>

<template>
  <span :class="classes">
    <span v-if="dot" class="h-1.5 w-1.5 rounded-full" :class="DOT_COLORS[variant]" />
    <slot />
  </span>
</template>
