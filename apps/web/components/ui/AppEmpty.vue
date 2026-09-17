<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    compact?: boolean
  }>(),
  {},
)
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="compact ? 'gap-3 py-10' : 'gap-4 py-20'"
  >
    <div
      class="flex items-center justify-center rounded-2xl bg-primary-soft text-2xl"
      :class="compact ? 'h-12 w-12 text-xl' : 'h-16 w-16'"
      aria-hidden="true"
    >
      <slot name="icon">
        <span>{{ icon ?? '✨' }}</span>
      </slot>
    </div>

    <div class="max-w-sm space-y-1.5">
      <p class="text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="description" class="text-xs leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </div>

    <div v-if="$slots.action" class="mt-1">
      <slot name="action" />
    </div>
  </div>
</template>
