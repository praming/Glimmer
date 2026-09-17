<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
    <!-- 背景光晕 -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        class="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl animate-float"
      />
      <div
        class="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-primary/10 blur-3xl"
        style="animation-delay: 1.2s"
      />
      <div
        class="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full bg-accent/60 blur-3xl"
      />
    </div>

    <div class="relative z-10 w-full max-w-sm animate-fade-up">
      <slot />
    </div>
  </div>
</template>
