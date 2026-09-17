<script setup lang="ts">
import type { ImageDTO } from '@glimmer/shared'
import { ImageOff, Images, Link2, RotateCcw } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { default: false })
const url = defineModel<string>({ default: '' })

const props = defineProps<{ username: string }>()

const api = useApi()
const toast = useToast()

const draft = ref('')
const images = ref<ImageDTO[]>([])
const loading = ref(false)

watch(open, (value) => {
  if (value) {
    draft.value = url.value
    void loadImages()
  }
})

async function loadImages(): Promise<void> {
  if (images.value.length > 0) return
  loading.value = true
  try {
    const result = await api.get<{ items: ImageDTO[] }>('/images', {
      page: 1,
      pageSize: 48,
      sort: 'createdAt',
      order: 'desc',
      status: 'ready',
    })
    images.value = result.items.filter((item) => Boolean(item.previewUrl))
  } catch (error) {
    toast.error('无法加载图库', (error as Error).message)
  } finally {
    loading.value = false
  }
}

function apply(): void {
  url.value = draft.value.trim()
  open.value = false
}
</script>

<template>
  <AppModal v-model="open" title="设置头像" size="md" description="填入图片链接，或直接从你的图库中选一张。头像会以 1:1 居中裁切显示。">
    <div class="space-y-5">
      <!-- 实时预览 -->
      <div class="flex items-center gap-4 rounded-xl bg-muted/50 px-4 py-3.5">
        <UserAvatar :src="draft || null" :name="props.username" size="xl" />
        <div class="min-w-0 space-y-1">
          <p class="text-[13px] font-medium text-foreground">预览效果</p>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            非正方形的图片会以中心为基准裁成 1:1，多余的边缘部分不会显示。
          </p>
        </div>
      </div>

      <!-- URL 输入 -->
      <div class="space-y-2">
        <AppInput
          v-model="draft"
          label="图片链接"
          placeholder="https://cdn.example.com/avatar.png"
          hint="支持任意 http(s) 外链，留空则恢复为用户名首字母。"
        >
          <template #prefix>
            <Link2 class="h-3.5 w-3.5" />
          </template>
        </AppInput>

        <button
          v-if="draft"
          type="button"
          class="gl-focus inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
          @click="draft = ''"
        >
          <RotateCcw class="h-3 w-3" />
          清空，恢复默认
        </button>
      </div>

      <!-- 图库选择 -->
      <div class="space-y-2.5 border-t border-border/70 pt-4">
        <div class="flex items-center gap-2">
          <Images class="h-3.5 w-3.5 text-muted-foreground" />
          <p class="text-xs font-medium text-muted-foreground">从我的图库选择</p>
        </div>

        <div v-if="loading" class="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <AppSkeleton v-for="n in 12" :key="n" class="aspect-square" rounded="rounded-lg" />
        </div>

        <div
          v-else-if="images.length === 0"
          class="flex flex-col items-center gap-2 rounded-xl bg-muted/40 py-8 text-muted-foreground"
        >
          <ImageOff class="h-5 w-5" />
          <p class="text-[11px]">图库里还没有可用的图片</p>
        </div>

        <div v-else class="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
          <button
            v-for="image in images"
            :key="image.id"
            type="button"
            class="gl-focus group relative aspect-square overflow-hidden rounded-lg border-2 transition-all duration-250 ease-smooth"
            :class="draft === image.previewUrl ? 'border-primary shadow-glow' : 'border-transparent hover:border-primary/40'"
            :title="image.filename"
            @click="draft = image.previewUrl ?? ''"
          >
            <PreviewImage :src="image.previewUrl" :alt="image.filename" />
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <AppButton variant="outline" size="sm" @click="open = false">取消</AppButton>
      <AppButton size="sm" @click="apply">使用该头像</AppButton>
    </template>
  </AppModal>
</template>
