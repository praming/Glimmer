<script setup lang="ts">
import { COPY_FORMATS, COPY_FORMAT_LABEL, FORMAT_LABEL, buildCopyText } from '@glimmer/shared'
import type { CopyFormat, ImageDTO, VariantDTO } from '@glimmer/shared'
import { ChevronDown, Layers } from 'lucide-vue-next'

const upload = useUploadStore()
const toast = useToast()

const results = computed(() => upload.history)
const expanded = ref<string[]>([])
const bulkFormat = ref<CopyFormat>('direct')

const dedupCount = computed(() => results.value.filter((item) => item.deduplicated).length)

const bulkOptions = COPY_FORMATS.map((value) => ({ label: COPY_FORMAT_LABEL[value], value }))

function primaryVariant(image: ImageDTO): VariantDTO | null {
  const variants = image.variants ?? []
  return (
    variants.find((v) => v.format === 'webp' && v.primaryUrl) ??
    variants.find((v) => v.primaryUrl) ??
    null
  )
}

function primaryUrl(image: ImageDTO): string {
  return primaryVariant(image)?.primaryUrl ?? image.previewUrl ?? ''
}

function copyValue(image: ImageDTO, format: CopyFormat): string {
  const variant = primaryVariant(image)
  const url = variant?.primaryUrl ?? image.previewUrl
  if (!url) return ''
  return buildCopyText(format, url, image.filename)
}

function toggle(id: string): void {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter((item) => item !== id)
    : [...expanded.value, id]
}

async function copyAll(): Promise<void> {
  const lines = results.value
    .map((item) => copyValue(item.image, bulkFormat.value))
    .filter(Boolean)

  if (lines.length === 0) {
    toast.warning('暂无可复制的链接')
    return
  }

  const text = lines.join('\n')
  const ok = await copyText(text)
  if (ok) {
    toast.success(`已复制 ${lines.length} 条${COPY_FORMAT_LABEL[bulkFormat.value]}`, '浮光已就绪')
  } else {
    toast.error('复制失败', '请手动选择文本复制')
  }
}

function downloadBatch(): void {
  const lines = results.value.map((item) => copyValue(item.image, bulkFormat.value)).filter(Boolean)
  if (lines.length === 0) return
  downloadText(`glimmer-urls-${Date.now()}.txt`, lines.join('\n'))
  toast.success('已导出为文本文件')
}
</script>

<template>
  <div v-if="results.length > 0" class="space-y-3">
    <!-- 顶部汇总 -->
    <div class="gl-surface flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div class="flex items-center gap-2.5">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-success-soft text-success">
          <Layers class="h-4 w-4" />
        </span>
        <div>
          <p class="text-[13px] font-medium text-foreground">
            本次已上传 {{ results.length }} 张
          </p>
          <p class="text-[11px] text-muted-foreground">
            <template v-if="dedupCount > 0">
              其中 {{ dedupCount }} 张命中秒传（未重复占用存储）
            </template>
            <template v-else>展开单张可查看全部变体与存储状态</template>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <AppSelect
          v-model="bulkFormat"
          :options="bulkOptions"
          :placeholder-option="false"
          size="sm"
          class="w-32"
        />
        <AppButton variant="outline" size="sm" @click="copyAll">复制全部</AppButton>
        <AppButton variant="ghost" size="sm" @click="downloadBatch">导出</AppButton>
      </div>
    </div>

    <!-- 结果卡片 -->
    <TransitionGroup name="fade-up" tag="div" class="space-y-3">
      <article
        v-for="item in results"
        :key="item.id"
        class="gl-surface overflow-hidden transition-shadow duration-350 hover:shadow-card"
      >
        <div class="flex gap-4 p-4">
          <div class="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg border border-border/70">
            <PreviewImage :src="item.image.previewUrl" :alt="item.image.filename" eager />
          </div>

          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex items-center gap-2">
              <p class="truncate text-[13px] font-medium text-foreground">{{ item.image.filename }}</p>
              <AppBadge :variant="item.deduplicated ? 'primary' : 'success'" size="sm">
                {{ item.deduplicated ? '秒传命中' : '已就绪' }}
              </AppBadge>
            </div>

            <p class="text-[11px] text-muted-foreground">
              {{ item.image.width ?? '—' }} × {{ item.image.height ?? '—' }} ·
              {{ readableSize(item.image.totalSize) }} ·
              {{ item.image.variants?.length ?? 0 }} 个变体
            </p>

            <div class="flex items-center gap-2">
              <code
                class="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {{ primaryUrl(item.image) || '暂无可用链接' }}
              </code>
              <CopyButton :value="primaryUrl(item.image)" label="直链" variant="outline" />
            </div>
          </div>
        </div>

        <!-- 四种格式 -->
        <div class="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/25 px-4 py-2.5">
          <CopyButton
            v-for="format in COPY_FORMATS"
            :key="format"
            :value="copyValue(item.image, format)"
            :label="COPY_FORMAT_LABEL[format]"
            :show-label="true"
            variant="outline"
          />

          <button
            v-if="(item.image.variants?.length ?? 0) > 1"
            type="button"
            class="gl-focus ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
            @click="toggle(item.id)"
          >
            <ChevronDown
              class="h-3.5 w-3.5 transition-transform duration-300"
              :class="expanded.includes(item.id) && 'rotate-180'"
            />
            全部变体
          </button>
        </div>

        <!-- 变体明细 -->
        <div v-if="expanded.includes(item.id)" class="border-t border-border/60 px-4 py-3">
          <ul class="space-y-2">
            <li
              v-for="variant in item.image.variants"
              :key="variant.id"
              class="rounded-lg border border-border/60 px-3 py-2.5"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <AppBadge variant="primary" size="sm">{{ FORMAT_LABEL[variant.format] }}</AppBadge>
                  <span class="text-[11px] text-muted-foreground">
                    {{ variant.width ?? '—' }} × {{ variant.height ?? '—' }} ·
                    {{ readableSize(variant.size) }}
                  </span>
                </div>
                <CopyButton :value="variant.primaryUrl ?? ''" label="直链" variant="ghost" />
              </div>

              <div class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="storage in variant.storages"
                  :key="storage.id"
                  class="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <span
                    class="h-1.5 w-1.5 rounded-full"
                    :class="{
                      'bg-success': storage.status === 'ready',
                      'bg-warning': storage.status === 'pending',
                      'bg-destructive': storage.status === 'failed',
                    }"
                  />
                  {{ storage.backendName }}
                </span>
              </div>
            </li>
          </ul>
        </div>
      </article>
    </TransitionGroup>
  </div>
</template>
