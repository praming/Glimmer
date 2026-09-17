<script setup lang="ts">
withDefaults(defineProps<{ size?: number; withText?: boolean; subtitle?: string }>(), {
  size: 34,
  withText: true,
})
</script>

<template>
  <div class="flex items-center gap-2.5">
    <div
      class="relative flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary/70 shadow-soft"
      :style="{ width: `${size}px`, height: `${size}px` }"
    >
      <svg :width="size * 0.56" :height="size * 0.56" viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="glimmer-ray" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55" />
            <stop offset="100%" stop-color="#ffffff" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.5 14.2 9.3 21 11.5l-6.8 2.2L12 20.5 9.8 13.7 3 11.5l6.8-2.2Z"
          fill="url(#glimmer-ray)"
        />
        <circle cx="17.6" cy="5.4" r="1.5" fill="#ffffff" fill-opacity="0.9" />
        <circle cx="6.2" cy="17.4" r="1" fill="#ffffff" fill-opacity="0.7" />
      </svg>
    </div>

    <div v-if="withText" class="min-w-0 leading-tight">
      <p class="truncate text-[15px] font-semibold tracking-tight text-foreground">浮光</p>
      <p class="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {{ subtitle ?? 'Glimmer' }}
      </p>
    </div>
  </div>
</template>
