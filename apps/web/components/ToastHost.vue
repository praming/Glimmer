<script setup lang="ts">
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { ToastType } from '~/composables/useToast'

const { items, dismiss } = useToast()

const ICONS: Record<ToastType, Component> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const TONES: Record<ToastType, string> = {
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-primary',
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-4 sm:items-end sm:px-6 sm:pt-6"
    >
      <TransitionGroup name="pop">
        <div
          v-for="item in items"
          :key="item.id"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-popover/95 px-4 py-3 shadow-lift backdrop-blur-md"
        >
          <component :is="ICONS[item.type]" class="mt-0.5 h-4 w-4 shrink-0" :class="TONES[item.type]" />

          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-medium leading-snug text-foreground">{{ item.title }}</p>
            <p
              v-if="item.description"
              class="mt-0.5 break-all text-xs leading-relaxed text-muted-foreground"
            >
              {{ item.description }}
            </p>
          </div>

          <button
            type="button"
            class="gl-focus -mr-1 -mt-0.5 rounded-md p-1 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
            aria-label="关闭提示"
            @click="dismiss(item.id)"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
