<script setup lang="ts">
import { AVATAR_MAX_BYTES } from '@glimmer/shared'
import { ImageUp, Loader2, Trash2 } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ username: string }>()

const auth = useAuthStore()
const toast = useToast()

const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const removing = ref(false)
const dragging = ref(false)
/** 刚选中的本地图片预览（object URL）；上传成功或关闭弹窗时释放 */
const preview = ref<string | null>(null)

/** 预览优先显示刚选的图，其次是账户上已有的头像 */
const displayUrl = computed(() => preview.value ?? auth.avatarUrl)
const maxMb = Math.round(AVATAR_MAX_BYTES / 1024 / 1024)

function releasePreview(): void {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = null
}

// 关闭即丢弃未提交的预览，避免 object URL 泄漏
watch(open, (value) => {
  if (!value) releasePreview()
})

function pick(): void {
  if (uploading.value || removing.value) return
  input.value?.click()
}

function onPicked(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  // 先清空 value：否则「选同一个文件两次」不会再触发 change
  target.value = ''
  if (file) void submit(file)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  if (uploading.value || removing.value) return
  const file = event.dataTransfer?.files?.[0]
  if (file) void submit(file)
}

/**
 * 选中文件后**立即上传**，没有「确定」这一步。
 *
 * 这样头像就不必混进「个人资料 → 保存」的批量提交里：改名和换头像互不牵连，
 * 也不会出现「改了头像但忘了点保存」。
 */
async function submit(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    toast.error('无法使用该文件', '请选择 jpg / png / webp 等图片文件')
    return
  }
  if (file.size > AVATAR_MAX_BYTES) {
    toast.error('图片过大', `头像不能超过 ${maxMb} MB`)
    return
  }

  releasePreview()
  preview.value = URL.createObjectURL(file)
  uploading.value = true
  try {
    await auth.uploadAvatar(file)
    toast.success('头像已更新', '已保存到你的账户，换设备登录也会同步')
    releasePreview()
    open.value = false
  } catch (error) {
    // 失败时保留预览，让用户看清自己选的到底是哪张图
    toast.error('头像上传失败', (error as Error).message)
  } finally {
    uploading.value = false
  }
}

/** 清除头像（本地文件与外链一起清），回到用户名首字母 */
async function clear(): Promise<void> {
  if (removing.value || uploading.value) return
  if (!auth.avatarUrl) {
    open.value = false
    return
  }

  removing.value = true
  try {
    await auth.removeAvatar()
    toast.success('头像已移除', '已恢复为用户名首字母')
    releasePreview()
    open.value = false
  } catch (error) {
    toast.error('移除失败', (error as Error).message)
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <AppModal
    v-model="open"
    title="更换头像"
    size="md"
    description="直接上传一张图片即可，会随账户同步到所有设备。"
  >
    <div class="space-y-5">
      <!-- 实时预览 -->
      <div class="flex items-center gap-4 rounded-xl bg-muted/50 px-4 py-3.5">
        <UserAvatar :src="displayUrl" :name="props.username" size="xl" />
        <div class="min-w-0 space-y-1">
          <p class="text-[13px] font-medium text-foreground">预览效果</p>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            非正方形的图片会以中心为基准裁成 1:1，多余的边缘部分不会显示。
          </p>
        </div>
      </div>

      <!-- 上传区 -->
      <div
        class="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-7 text-center transition-colors duration-250 ease-smooth"
        :class="dragging ? 'border-primary bg-primary-soft/60' : 'border-border bg-muted/30'"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span
          class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-accent-foreground"
        >
          <Loader2 v-if="uploading" class="h-4 w-4 animate-spin" />
          <ImageUp v-else class="h-4 w-4" />
        </span>

        <div class="space-y-1">
          <p class="text-[13px] font-medium text-foreground">
            {{ uploading ? '正在上传…' : '把图片拖到这里' }}
          </p>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            或从这台设备选择 · 支持 jpg / png / webp，单张不超过 {{ maxMb }} MB
          </p>
        </div>

        <AppButton
          size="sm"
          variant="outline"
          :loading="uploading"
          :disabled="removing"
          @click="pick"
        >
          <ImageUp class="h-3.5 w-3.5" />
          {{ uploading ? '上传中…' : '选择图片' }}
        </AppButton>
      </div>

      <input ref="input" type="file" accept="image/*" class="hidden" @change="onPicked" />
    </div>

    <template #footer>
      <AppButton
        v-if="auth.avatarUrl"
        class="mr-auto"
        variant="ghost"
        size="sm"
        :disabled="uploading || removing"
        :loading="removing"
        @click="clear"
      >
        <Trash2 v-if="!removing" class="h-3.5 w-3.5" />
        移除头像
      </AppButton>
      <AppButton variant="outline" size="sm" :disabled="uploading || removing" @click="open = false">
        完成
      </AppButton>
    </template>
  </AppModal>
</template>
