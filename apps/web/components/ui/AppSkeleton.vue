<script setup lang="ts">
withDefaults(defineProps<{ rounded?: string }>(), { rounded: 'rounded-lg' })
</script>

<template>
  <div class="gl-skeleton" :class="rounded" />
</template>
