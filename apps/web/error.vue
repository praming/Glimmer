<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const isNotFound = computed(() => props.error?.statusCode === 404)
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background px-6">
    <div class="w-full max-w-md text-center">
      <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft">
        <span class="text-2xl">✨</span>
      </div>

      <h1 class="text-5xl font-semibold tracking-tight text-foreground">
        {{ error?.statusCode || 500 }}
      </h1>

      <p class="mt-3 text-base text-muted-foreground">
        {{ isNotFound ? '这一束浮光影不见了。' : '浮光在某个角落打了个结，请稍后重试。' }}
      </p>

      <p v-if="error?.message" class="mt-2 break-all font-mono text-xs text-muted-foreground/70">
        {{ error.message }}
      </p>

      <div class="mt-8 flex items-center justify-center gap-3">
        <button
          class="gl-focus inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors duration-250 hover:bg-primary/90"
          @click="clearError({ redirect: '/' })"
        >
          回到浮光
        </button>
        <button
          class="gl-focus inline-flex h-10 items-center rounded-lg border border-border px-5 text-sm font-medium transition-colors duration-250 hover:bg-muted"
          @click="reloadNuxtApp()"
        >
          重新加载
        </button>
      </div>
    </div>
  </div>
</template>
