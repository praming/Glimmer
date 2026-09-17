<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '~/utils/cn'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success' | 'subtle'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    loading?: boolean
    disabled?: boolean
    block?: boolean
    type?: 'button' | 'submit' | 'reset'
    to?: string
    href?: string
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-soft hover:bg-primary/92 hover:shadow-card active:scale-[0.98]',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/75 active:scale-[0.98]',
  outline:
    'border border-border bg-card text-foreground hover:border-primary/30 hover:bg-muted active:scale-[0.98]',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  destructive:
    'bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90 active:scale-[0.98]',
  success:
    'bg-success text-success-foreground shadow-soft hover:bg-success/90 active:scale-[0.98]',
  subtle: 'bg-primary-soft text-accent-foreground hover:bg-primary-soft/70 active:scale-[0.98]',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-6 text-[15px]',
  icon: 'h-10 w-10',
  'icon-sm': 'h-8 w-8',
}

const classes = computed(() =>
  cn(
    'gl-focus inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium',
    'transition-all duration-250 ease-smooth disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[props.variant],
    SIZES[props.size],
    props.block && 'w-full',
  ),
)
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <slot />
  </NuxtLink>

  <a v-else-if="href" :href="href" target="_blank" rel="noreferrer" :class="classes">
    <slot />
  </a>

  <button v-else :type="type" :disabled="disabled || loading" :class="classes">
    <AppSpinner v-if="loading" :size="size === 'lg' ? 16 : 14" />
    <slot />
  </button>
</template>
