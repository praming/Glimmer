<script setup lang="ts">
import { NAMING_TEMPLATE_PRESETS, NAMING_TEMPLATE_VARS, applyNamingTemplate } from '@glimmer/shared'
import { Info } from 'lucide-vue-next'

const store = useSettingsStore()
const toast = useToast()

const form = ref({
  namingTemplate: '',
  publicBaseUrl: '',
  galleryVisibility: 'shared' as 'shared' | 'private',
  maxUploadSizeMb: 20,
})

watch(
  () => store.settings,
  (value) => {
    if (!value) return
    form.value = {
      namingTemplate: value.namingTemplate,
      publicBaseUrl: value.publicBaseUrl,
      galleryVisibility: value.galleryVisibility,
      maxUploadSizeMb: value.maxUploadSizeMb,
    }
  },
  { immediate: true },
)

/**
 * 实时预览。
 * 传入 `randomSeed` 让随机变量确定性派生 —— 否则每次重算预览都会跳动。
 */
const preview = computed(() => {
  const template = form.value.namingTemplate || '{date}/{random}-{origin}'
  try {
    const base = applyNamingTemplate(template, {
      origin: 'photo',
      format: 'webp',
      ext: 'webp',
      index: 1,
      randomSeed: template,
    })
    const withExt = /\.(webp|jpe?g|png|avif|gif)$/i.test(base) ? base : `${base}.webp`
    return withExt
  } catch {
    return '模板无效'
  }
})

/** 点击变量徽标 → 追加到模板末尾 */
function insertVar(token: string): void {
  const current = form.value.namingTemplate
  const joiner = current.length > 0 && !current.endsWith('/') && !current.endsWith('-') ? '/' : ''
  form.value.namingTemplate = `${current}${joiner}${token}`
  toast.info(`已插入 ${token}`, '可在输入框中继续调整位置')
}

async function submit(): Promise<void> {
  await store.save({
    namingTemplate: form.value.namingTemplate,
    publicBaseUrl: form.value.publicBaseUrl,
    galleryVisibility: form.value.galleryVisibility,
    maxUploadSizeMb: form.value.maxUploadSizeMb,
  })
}
</script>

<template>
  <div class="space-y-4">
    <AppCard title="命名规则" description="控制生成的文件路径，扩展名由服务端统一追加。">
      <div class="space-y-3.5">
        <AppInput
          v-model="form.namingTemplate"
          label="命名模板"
          mono
          placeholder="{date}/{random}-{origin}"
        />

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="preset in NAMING_TEMPLATE_PRESETS"
            :key="preset.value"
            type="button"
            class="gl-focus rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors duration-200 hover:border-primary/30 hover:bg-primary-soft hover:text-accent-foreground"
            @click="form.namingTemplate = preset.value"
          >
            {{ preset.label }}
          </button>
        </div>

        <div class="rounded-lg bg-muted/50 px-3.5 py-3">
          <div class="flex items-center gap-1.5">
            <p class="text-[11px] text-muted-foreground">可用变量</p>
            <Info class="h-3 w-3 text-muted-foreground/70" />
            <p class="text-[11px] text-muted-foreground/70">悬浮查看说明与示例，点击插入模板</p>
          </div>

          <div class="mt-2.5 flex flex-wrap gap-1.5">
            <AppTooltip
              v-for="variable in NAMING_TEMPLATE_VARS"
              :key="variable.token"
              :title="`${variable.token} · ${variable.label}`"
              :text="variable.description"
              :example="variable.example"
            >
              <button
                type="button"
                class="gl-focus cursor-help rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-colors duration-200 hover:bg-primary-soft hover:text-accent-foreground"
                @click="insertVar(variable.token)"
              >
                {{ variable.token }}
              </button>
            </AppTooltip>
          </div>

          <p class="mt-3 text-[11px] text-muted-foreground">
            预览：
            <code class="ml-1 break-all font-mono text-foreground">{{ preview }}</code>
          </p>
        </div>
      </div>
    </AppCard>

    <AppCard title="域名与可见性" description="对外链接域名，以及成员之间能否互相查看图片。">
      <div class="space-y-4">
        <AppInput
          v-model="form.publicBaseUrl"
          label="自定义域名"
          mono
          placeholder="https://img.example.com"
          hint="留空则使用环境变量 PUBLIC_BASE_URL"
        />

        <AppInput
          v-model.number="form.maxUploadSizeMb"
          type="number"
          label="单文件上传上限 (MB)"
          hint="仅影响新上传，队列处理不受影响"
        />

        <AppSwitch
          :model-value="form.galleryVisibility === 'private'"
          label="私有图库模式"
          description="开启后，成员只能看到自己上传的图片；管理员仍然可见全部。关闭即为共享图库。"
          @update:model-value="(v) => (form.galleryVisibility = v ? 'private' : 'shared')"
        />
      </div>

      <template #footer>
        <div class="flex justify-end">
          <AppButton size="sm" :loading="store.saving" @click="submit">保存通用设置</AppButton>
        </div>
      </template>
    </AppCard>
  </div>
</template>
