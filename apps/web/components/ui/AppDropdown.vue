<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ref } from 'vue'

withDefaults(
  defineProps<{
    align?: 'start' | 'end'
    width?: string
  }>(),
  { align: 'end', width: 'w-52' },
)

const open = ref(false)
const root = ref<HTMLElement | null>(null)

onClickOutside(root, () => {
  open.value = false
})

function close(): void {
  open.value = false
}
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <div @click="open = !open">
      <slot name="trigger" :open="open" />
    </div>

    <Transition name="pop">
      <div
        v-if="open"
        class="absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lift"
        :class="[align === 'end' ? 'right-0' : 'left-0', width]"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>
