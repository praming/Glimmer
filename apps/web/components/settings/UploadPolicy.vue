<script setup lang="ts">
import { ALLOWED_INPUT_MIME, INPUT_MIME_OPTIONS } from '@glimmer/shared'
import { ShieldAlert, Upload } from 'lucide-vue-next'

const store = useSettingsStore()
const toast = useToast()

const allowed = ref<string[]>([...ALLOWED_INPUT_MIME])

watch(
  () => store.settings?.allowedInputMime,
  (value) => {
    // 旧库缺字段时后端会回落成「全部允许」，这里保持同一口径
    allowed.value = Array.isArray(value) ? [...value] : [...ALLOWED_INPUT_MIME]
  },
  { immediate: true },
)

function toggle(mime: string): void {
  allowed.value = allowed.value.includes(mime)
    ? allowed.value.filter((item) => item !== mime)
    : [...allowed.value, mime]
}

const dirty = computed(() => {
  const current = store.settings?.allowedInputMime ?? [...ALLOWED_INPUT_MIME]
  if (current.length !== allowed.value.length) return true
  return allowed.value.some((mime) => !current.includes(mime))
})

const allOn = computed(() => allowed.value.length === ALLOWED_INPUT_MIME.length)
const noneOn = computed(() => allowed.value.length === 0)

async function saveAll(): Promise<void> {
  if (noneOn.value) {
    toast.warning('至少保留一种允许上传的格式')
    return
  }
  await store.save({ allowedInputMime: allowed.value })
}

async function selectAll(): Promise<void> {
  allowed.value = [...ALLOWED_INPUT_MIME]
}
</script>

<template>
  <AppCard
    title="允许上传的文件类型"
    description="未勾选的格式会在上传时被直接拒绝，前端也会提前拦截。"
  >
    <template #actions>
      <AppButton v-if="!allOn" variant="ghost" size="sm" @click="selectAll">
        <Upload class="h-3.5 w-3.5" />
        全选
      </AppButton>
    </template>

    <div class="space-y-4">
      <div class="flex items-center gap-2 rounded-lg bg-muted/50 px-3.5 py-2.5">
        <Upload class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p class="text-[11px] text-muted-foreground">
          已允许
          <span class="font-medium text-foreground">{{ allowed.length }}</span>
          / {{ ALLOWED_INPUT_MIME.length }} 种格式 · 白名单为空将禁止一切上传
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <AppSwitch
          v-for="option in INPUT_MIME_OPTIONS"
          :key="option.mime"
          :model-value="allowed.includes(option.mime)"
          :label="option.label"
          :description="option.ext"
          @update:model-value="toggle(option.mime)"
        />
      </div>

      <Transition name="pop">
        <p
          v-if="noneOn"
          class="flex items-center gap-2 rounded-lg bg-destructive-soft px-3.5 py-2.5 text-xs text-destructive"
        >
          <ShieldAlert class="h-3.5 w-3.5 shrink-0" />
          所有格式都已关闭，将没有任何文件能上传成功。
        </p>
      </Transition>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] text-muted-foreground">
          {{ dirty ? '有未保存的改动' : '配置已同步' }}
        </p>
        <AppButton size="sm" :loading="store.saving" :disabled="!dirty || noneOn" @click="saveAll">
          保存上传规则
        </AppButton>
      </div>
    </template>
  </AppCard>
</template>
