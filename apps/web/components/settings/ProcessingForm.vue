<script setup lang="ts">
import { FORMAT_LABEL } from '@glimmer/shared'
import type { ImageProcessingSettings, OutputFormat } from '@glimmer/shared'

const store = useSettingsStore()
const toast = useToast()

const FORMATS: OutputFormat[] = ['webp', 'jpeg', 'avif', 'png', 'gif']

const form = ref<ImageProcessingSettings | null>(null)

watch(
  () => store.settings?.processing,
  (value) => {
    form.value = value ? { ...value, outputFormats: [...value.outputFormats] } : null
  },
  { immediate: true },
)

function toggleFormat(format: OutputFormat): void {
  if (!form.value) return
  const list = [...form.value.outputFormats]
  const index = list.indexOf(format)
  if (index >= 0) {
    if (list.length === 1) {
      toast.warning('至少保留一种输出格式')
      return
    }
    list.splice(index, 1)
  } else {
    list.push(format)
  }
  form.value.outputFormats = list
}

async function submit(): Promise<void> {
  if (!form.value) return
  await store.save({ processing: { ...form.value } })
}
</script>

<template>
  <AppCard title="图片处理" description="异步流水线的压缩参数，仅影响新上传的图片。">
    <div v-if="!form" class="space-y-3">
      <AppSkeleton class="h-9 w-full" />
      <AppSkeleton class="h-9 w-full" />
      <AppSkeleton class="h-9 w-2/3" />
    </div>

    <div v-else class="space-y-6">
      <!-- 输出格式 -->
      <div class="space-y-2.5">
        <p class="text-xs font-medium text-muted-foreground">默认输出格式</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="format in FORMATS"
            :key="format"
            type="button"
            class="gl-focus rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-250 ease-smooth"
            :class="
              form.outputFormats.includes(format)
                ? 'border-primary/40 bg-primary-soft text-accent-foreground shadow-soft'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            "
            @click="toggleFormat(format)"
          >
            {{ FORMAT_LABEL[format] }}
          </button>
        </div>
      </div>

      <!-- 尺寸 -->
      <div class="grid gap-3.5 border-t border-border/70 pt-5 sm:grid-cols-2">
        <AppInput v-model.number="form.maxWidth" type="number" label="最大宽度 (px)" hint="超出时等比缩放，不放大" />
        <AppInput v-model.number="form.maxHeight" type="number" label="最大高度 (px)" hint="超出时等比缩放，不放大" />
      </div>

      <!-- 质量 -->
      <div class="space-y-3.5 border-t border-border/70 pt-5">
        <p class="text-xs font-medium text-muted-foreground">编码质量</p>

        <div class="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <label class="space-y-2">
            <span class="flex items-center justify-between text-xs text-muted-foreground">
              <span>JPEG 质量</span>
              <span class="font-mono text-foreground">{{ form.qualityJpeg }}</span>
            </span>
            <input
              v-model.number="form.qualityJpeg"
              type="range"
              min="1"
              max="100"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>

          <label class="space-y-2">
            <span class="flex items-center justify-between text-xs text-muted-foreground">
              <span>WebP 质量</span>
              <span class="font-mono text-foreground">{{ form.qualityWebp }}</span>
            </span>
            <input
              v-model.number="form.qualityWebp"
              type="range"
              min="1"
              max="100"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>

          <label class="space-y-2">
            <span class="flex items-center justify-between text-xs text-muted-foreground">
              <span>AVIF 质量</span>
              <span class="font-mono text-foreground">{{ form.qualityAvif }}</span>
            </span>
            <input
              v-model.number="form.qualityAvif"
              type="range"
              min="1"
              max="100"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>

          <label class="space-y-2">
            <span class="flex items-center justify-between text-xs text-muted-foreground">
              <span>PNG 压缩等级</span>
              <span class="font-mono text-foreground">{{ form.qualityPng }}</span>
            </span>
            <input
              v-model.number="form.qualityPng"
              type="range"
              min="0"
              max="9"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>

          <label class="space-y-2">
            <span class="flex items-center justify-between text-xs text-muted-foreground">
              <span>GIF effort</span>
              <span class="font-mono text-foreground">{{ form.qualityGif }}</span>
            </span>
            <input
              v-model.number="form.qualityGif"
              type="range"
              min="1"
              max="10"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>
        </div>
      </div>

      <!-- 开关 -->
      <div class="space-y-4 border-t border-border/70 pt-5">
        <AppSwitch
          v-model="form.keepOriginal"
          label="默认保留原图"
          description="以字节级原样保存上传文件（含 EXIF），生成 original 变体。默认关闭以获得最大压缩收益。"
        />
        <AppSwitch
          v-model="form.stripExif"
          label="移除 EXIF 元数据"
          description="关闭后保留拍摄参数与地理位置等信息，会略微增大体积。"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <AppButton size="sm" :loading="store.saving" :disabled="!form" @click="submit">
          保存处理配置
        </AppButton>
      </div>
    </template>
  </AppCard>
</template>
