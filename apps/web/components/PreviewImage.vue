<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'
import { ref } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    src: string | null | undefined
    alt?: string
    /** 惰性：进入视口前不加载 */
    eager?: boolean
  }>(),
  {},
)

const loaded = ref(false)
const failed = ref(false)

function onError(): void {
  failed.value = true
  loaded.value = true
}

defineExpose({ loaded, failed })
</script>

<template>
  <div :class="cn('relative h-full w-full overflow-hidden bg-muted')">
    <!-- 模糊占位 -->
    <div v-if="!loaded && props.src" class="gl-skeleton absolute inset-0" />

    <img
      v-if="props.src && !failed"
      :src="props.src"
      :alt="alt ?? ''"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      class="h-full w-full object-cover transition-all duration-600 ease-silk"
      :class="loaded ? 'scale-100 opacity-100 blur-0' : 'scale-[1.04] opacity-0 blur-lg'"
      @load="loaded = true"
      @error="onError"
    />

    <div
      v-else
      class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60"
    >
      <ImageOff class="h-5 w-5" />
      <span class="text-[10px]">{{ props.src ? '加载失败' : '暂无预览' }}</span>
    </div>
  </div>
</template>
