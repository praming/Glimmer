<script setup lang="ts">
import type { Component } from 'vue'
import { cn } from '~/utils/cn'

export interface SegmentOption {
  label: string
  value: string
  icon?: Component
  title?: string
}

const model = defineModel<string>()

const props = withDefaults(
  defineProps<{
    options: SegmentOption[]
    size?: 'sm' | 'md'
    block?: boolean
  }>(),
  { size: 'md' },
)

function select(value: string): void {
  model.value = value
}
</script>

<template>
  <div
    :class="
      cn(
        'inline-flex items-center gap-1 rounded-lg bg-muted p-1',
        props.block && 'flex w-full',
        props.block && '[&>button]:flex-1',
      )
    "
    role="tablist"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :title="option.title ?? option.label"
      :class="
        cn(
          'gl-focus inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-250 ease-smooth',
          props.size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
          model === option.value
            ? 'bg-card text-foreground shadow-soft'
            : 'text-muted-foreground hover:text-foreground',
        )
      "
      @click="select(option.value)"
    >
      <component :is="option.icon" v-if="option.icon" class="h-3.5 w-3.5" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>
