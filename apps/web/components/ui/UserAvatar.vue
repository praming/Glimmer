<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    src?: string | null
    /** 用于生成首字母占位 */
    name?: string | null
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    /** 方角（图库风格的缩略图）还是圆形（用户头像） */
    shape?: 'circle' | 'square'
    class?: string
  }>(),
  { size: 'md', shape: 'circle' },
)

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-[13px]',
  lg: 'h-12 w-12 text-base',
  xl: 'h-24 w-24 text-2xl',
} as const

/** 外链可能 403 / 404 / 被 CORS 拦，失败时回落到首字母占位而不是破图 */
const broken = ref(false)
watch(
  () => props.src,
  () => {
    broken.value = false
  },
)

const showImage = computed(() => Boolean(props.src) && !broken.value)
const initial = computed(() => (props.name?.trim()?.slice(0, 1) ?? '?').toUpperCase())
</script>

<template>
  <span
    :class="
      cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-primary-soft',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        SIZES[size],
        props.class,
      )
    "
  >
    <!-- 1:1 裁切：容器为正方形 + object-cover 居中裁掉多余部分 -->
    <img
      v-if="showImage"
      :src="src!"
      :alt="name ?? '头像'"
      class="h-full w-full object-cover"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
    <span v-else class="font-semibold uppercase text-accent-foreground">{{ initial }}</span>
  </span>
</template>
