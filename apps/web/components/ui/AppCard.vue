<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    padded?: boolean
    divided?: boolean
  }>(),
  { padded: true, divided: true },
)
</script>

<template>
  <section class="gl-surface overflow-hidden">
    <header
      v-if="title || description || $slots.header || $slots.actions"
      class="flex items-start justify-between gap-4 px-5 py-4"
      :class="divided && 'border-b border-border/70'"
    >
      <div class="min-w-0">
        <slot name="header">
          <h2 class="text-sm font-semibold tracking-tight text-foreground">{{ title }}</h2>
          <p v-if="description" class="mt-1 text-xs leading-relaxed text-muted-foreground">
            {{ description }}
          </p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </header>

    <div :class="padded && 'px-5 py-4'">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-t border-border/70 px-5 py-3.5">
      <slot name="footer" />
    </footer>
  </section>
</template>
