<script setup lang="ts">
import { computed } from 'vue'

const { state, settle } = useConfirm()

const open = computed({
  get: () => state.value.open,
  set: (value: boolean) => {
    if (!value) settle(false)
  },
})

const options = computed(() => state.value.options)
</script>

<template>
  <AppModal v-model="open" :title="options.title" :size="'sm'">
    <p v-if="options.description" class="text-sm leading-relaxed text-muted-foreground">
      {{ options.description }}
    </p>
    <slot v-else />

    <template #footer>
      <AppButton variant="outline" size="sm" @click="settle(false)">
        {{ options.cancelText ?? '取消' }}
      </AppButton>
      <AppButton
        :variant="options.destructive ? 'destructive' : 'primary'"
        size="sm"
        @click="settle(true)"
      >
        {{ options.confirmText ?? '确认' }}
      </AppButton>
    </template>
  </AppModal>
</template>
