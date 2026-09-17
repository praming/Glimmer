<script setup lang="ts">
const model = defineModel<boolean>({ default: false })

withDefaults(
  defineProps<{
    label?: string
    description?: string
    disabled?: boolean
  }>(),
  {},
)
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div v-if="label || description" class="min-w-0">
      <p v-if="label" class="text-sm font-medium text-foreground">{{ label }}</p>
      <p v-if="description" class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </div>

    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      class="gl-focus relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-350 ease-smooth disabled:cursor-not-allowed disabled:opacity-50"
      :class="model ? 'bg-primary' : 'bg-muted-foreground/25'"
      @click="model = !model"
    >
      <span
        class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-350 ease-smooth"
        :class="model ? 'translate-x-[22px]' : 'translate-x-0.5'"
      />
    </button>
  </div>
</template>
