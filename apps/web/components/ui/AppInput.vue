<script setup lang="ts">
import { computed, useId } from 'vue'
import { cn } from '~/utils/cn'

const model = defineModel<string | number | undefined>()

const props = withDefaults(
  defineProps<{
    label?: string
    hint?: string
    error?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    required?: boolean
    size?: 'sm' | 'md' | 'lg'
    autocomplete?: string
    min?: string | number
    max?: string | number
    mono?: boolean
  }>(),
  { type: 'text', size: 'md' },
)

const id = useId()

const SIZES = {
  sm: 'h-8 text-xs',
  md: 'h-10 text-sm',
  lg: 'h-11 text-[15px]',
} as const

const inputClass = computed(() =>
  cn(
    'gl-focus w-full rounded-lg border bg-card px-3 text-foreground placeholder:text-muted-foreground/60',
    'transition-all duration-250 ease-smooth disabled:cursor-not-allowed disabled:opacity-60',
    'read-only:bg-muted/40 read-only:text-muted-foreground',
    SIZES[props.size],
    props.error
      ? 'border-destructive/60 focus-visible:ring-destructive/40'
      : 'border-input hover:border-border',
    props.mono && 'font-mono text-[13px]',
  ),
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-xs font-medium text-muted-foreground">
      {{ label }}
      <span v-if="required" class="text-destructive">*</span>
    </label>

    <div class="relative flex items-center">
      <span v-if="$slots.prefix" class="pointer-events-none absolute left-3 text-muted-foreground">
        <slot name="prefix" />
      </span>

      <input
        :id="id"
        v-model="model"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :required="required"
        :autocomplete="autocomplete"
        :min="min"
        :max="max"
        :class="[inputClass, $slots.prefix && 'pl-9', $slots.suffix && 'pr-10']"
      />

      <span v-if="$slots.suffix" class="absolute right-2 flex items-center">
        <slot name="suffix" />
      </span>
    </div>

    <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-muted-foreground/80">{{ hint }}</p>
  </div>
</template>
