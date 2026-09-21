<script setup lang="ts">
import { COPY_FORMATS, COPY_FORMAT_LABEL, FONT_PRESETS_EN, FONT_PRESETS_ZH } from '@glimmer/shared'
import type { CopyFormat, ThemePreference } from '@glimmer/shared'
import { AlertTriangle, Check, Languages, Monitor, Moon, RotateCcw, Sun, Type } from 'lucide-vue-next'

const auth = useAuthStore()
const toast = useToast()
const { mode, setMode } = useTheme()
const typography = useTypography()
const { inspect, isFontInstalled } = useFontAvailability()

const copyOptions = COPY_FORMATS.map((value) => ({ label: COPY_FORMAT_LABEL[value], value }))

const themeOptions = [
  { label: '浅色', value: 'light', icon: Sun },
  { label: '深色', value: 'dark', icon: Moon },
  { label: '系统', value: 'system', icon: Monitor },
]

const saving = ref(false)

/* ----------------------------- 字体 ----------------------------- */

const fontForm = reactive({ zh: '', en: '' })

watch(
  () => [auth.preferences.fontSansZh, auth.preferences.fontSansEn] as const,
  ([zh, en]) => {
    fontForm.zh = zh
    fontForm.en = en
  },
  { immediate: true },
)

/**
 * 不依赖 AppInput 的 `@input`：它靠 attrs 透传到组件外层 div、再靠原生事件冒泡触发，
 * 一旦组件结构调整（改成多根、display:contents 等）就会**静默失效**。
 * 直接观察表单值最稳。
 */
watch(fontForm, () => onFontInput())

let fontTimer: ReturnType<typeof setTimeout> | null = null

/** 输入时立即应用到界面，落库做防抖，避免每敲一个字就发一次请求 */
function onFontInput(): void {
  typography.apply({ fontSansZh: fontForm.zh, fontSansEn: fontForm.en })
  if (fontTimer) clearTimeout(fontTimer)
  fontTimer = setTimeout(() => void persistFonts(), 700)
}

/**
 * 本机可用性实测。
 * 浏览器不会告诉我们「你填的字体没装」，只会安静地回落到别的字体，
 * 于是看上去像「设置不起作用」。这里主动测出来并说清楚。
 */
const zhReport = computed(() => inspect(fontForm.zh, 'cjk'))
const enReport = computed(() => inspect(fontForm.en, 'latin'))

async function persistFonts(): Promise<void> {
  try {
    await auth.updatePreferences({ fontSansZh: fontForm.zh.trim(), fontSansEn: fontForm.en.trim() })
  } catch (error) {
    toast.error('字体设置保存失败', (error as Error).message)
  }
}

async function resetFonts(): Promise<void> {
  if (fontTimer) clearTimeout(fontTimer)
  fontForm.zh = ''
  fontForm.en = ''
  typography.reset()
  await persistFonts()
  toast.success('已恢复默认字体')
}

async function pickFont(target: 'zh' | 'en', value: string): Promise<void> {
  if (fontTimer) clearTimeout(fontTimer)
  fontForm[target] = value
  typography.apply({ fontSansZh: fontForm.zh, fontSansEn: fontForm.en })
  await persistFonts()
}

const fontsCustomized = computed(() => Boolean(auth.preferences.fontSansZh || auth.preferences.fontSansEn))

/* ----------------------------- 其他偏好 ----------------------------- */

async function updateAutoCopy(value: boolean): Promise<void> {
  saving.value = true
  try {
    await auth.updatePreferences({ autoCopy: value })
    toast.success(value ? '上传成功后会自动复制链接' : '已关闭自动复制')
  } catch (error) {
    toast.error('保存失败', (error as Error).message)
  } finally {
    saving.value = false
  }
}

async function updateCopyFormat(value: string): Promise<void> {
  saving.value = true
  try {
    await auth.updatePreferences({ defaultCopyFormat: value as CopyFormat })
    toast.success(`默认复制格式：${COPY_FORMAT_LABEL[value as CopyFormat]}`)
  } catch (error) {
    toast.error('保存失败', (error as Error).message)
  } finally {
    saving.value = false
  }
}

/**
 * 主题：`setMode` 内部已经负责把值写进账户偏好（失败静默），这里不用再发一次请求。
 * 立即生效 —— 同步失败也不该阻塞本机切换。
 */
function updateTheme(value: string): void {
  setMode(value as ThemePreference)
}

const copyPreview = computed(() => {
  const url = 'https://img.example.com/2026-09-16/a3f8c1-photo.webp'
  switch (auth.preferences.defaultCopyFormat) {
    case 'markdown':
      return `![photo](${url})`
    case 'html':
      return `<img src="${url}" alt="photo" />`
    case 'bbcode':
      return `[img]${url}[/img]`
    default:
      return url
  }
})
</script>

<template>
  <div class="space-y-5">
    <AppCard title="个人偏好" description="仅作用于你自己的上传与复制行为。">
      <div class="space-y-5">
        <AppSelect
          :model-value="auth.preferences.defaultCopyFormat"
          :options="copyOptions"
          label="默认复制格式"
          :placeholder-option="false"
          @update:model-value="(v) => v && updateCopyFormat(v)"
        />

        <div class="rounded-lg bg-muted/50 px-3.5 py-2.5">
          <p class="text-[11px] text-muted-foreground">复制效果预览</p>
          <code class="mt-1 block break-all font-mono text-[11px] text-foreground">{{ copyPreview }}</code>
        </div>

        <div class="border-t border-border/70 pt-4">
          <AppSwitch
            :model-value="auth.preferences.autoCopy"
            label="上传成功后自动复制"
            description="处理完成后自动把默认格式的链接写入剪贴板。"
            :disabled="saving"
            @update:model-value="updateAutoCopy"
          />
        </div>

        <div class="space-y-2.5 border-t border-border/70 pt-4">
          <p class="text-xs font-medium text-muted-foreground">界面主题</p>
          <AppSegment
            :model-value="mode"
            :options="themeOptions"
            block
            @update:model-value="(v) => v && updateTheme(v)"
          />
        </div>
      </div>
    </AppCard>

    <!-- 字体 -->
    <AppCard
      title="字体"
      description="留空则使用内置默认字体栈；填写后立即应用到整个界面并自动保存。"
    >
      <template #actions>
        <AppButton v-if="fontsCustomized" variant="ghost" size="sm" @click="resetFonts">
          <RotateCcw class="h-3.5 w-3.5" />
          恢复默认
        </AppButton>
      </template>

      <div class="space-y-5">
        <!-- 中文字体 -->
        <div class="space-y-2.5">
          <AppInput
            v-model="fontForm.zh"
            label="中文字体"
            placeholder="PingFang SC"
            hint="可写多个用英文逗号分隔，例如：PingFang SC, Microsoft YaHei"
          >
            <template #prefix>
              <Type class="h-3.5 w-3.5" />
            </template>
          </AppInput>

          <FontStackStatus :report="zhReport" />

          <div class="space-y-1.5">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="preset in FONT_PRESETS_ZH"
                :key="preset"
                type="button"
                class="gl-focus rounded-lg border px-2 py-0.5 text-[11px] transition-colors duration-200"
                :class="
                  isFontInstalled(preset)
                    ? 'border-border text-muted-foreground hover:border-primary/30 hover:bg-primary-soft hover:text-accent-foreground'
                    : 'border-dashed border-border/60 text-muted-foreground/45 hover:border-primary/20'
                "
                :title="
                  isFontInstalled(preset)
                    ? `使用 ${preset}`
                    : `${preset} 未安装在本机，选取后本机不会有视觉变化`
                "
                @click="pickFont('zh', preset)"
              >
                {{ preset }}
              </button>
            </div>
            <p class="text-[10px] leading-relaxed text-muted-foreground/60">
              虚线框表示该字体未安装在本机：选取后本机看不到变化，但在装有该字体的设备上会生效。
            </p>
          </div>
        </div>

        <!-- 英文与数字 -->
        <div class="space-y-2.5 border-t border-border/70 pt-4">
          <AppInput
            v-model="fontForm.en"
            label="英文与数字字体"
            placeholder="Inter"
            hint="英文与数字优先使用它，中文字符再回落到上面的中文字体。"
          >
            <template #prefix>
              <Languages class="h-3.5 w-3.5" />
            </template>
          </AppInput>

          <FontStackStatus :report="enReport" />

          <div class="space-y-1.5">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="preset in FONT_PRESETS_EN"
                :key="preset"
                type="button"
                class="gl-focus rounded-lg border px-2 py-0.5 font-mono text-[11px] transition-colors duration-200"
                :class="
                  isFontInstalled(preset)
                    ? 'border-border text-muted-foreground hover:border-primary/30 hover:bg-primary-soft hover:text-accent-foreground'
                    : 'border-dashed border-border/60 text-muted-foreground/45 hover:border-primary/20'
                "
                :title="
                  isFontInstalled(preset)
                    ? `使用 ${preset}`
                    : `${preset} 未安装在本机，选取后本机不会有视觉变化`
                "
                @click="pickFont('en', preset)"
              >
                {{ preset }}
              </button>
            </div>
          </div>
        </div>

        <!-- 预览 -->
        <div class="rounded-lg bg-muted/50 px-3.5 py-3">
          <p class="text-[11px] text-muted-foreground">预览（下面的文字已应用你设置的字体）</p>
          <p class="mt-1.5 text-[15px] font-medium text-foreground">
            浮光掠影，一触即达 Glimmer 2026
          </p>
          <p class="mt-1 text-[13px] text-muted-foreground">
            ABCDEFG abcdefg 0123456789 — !@#$%
          </p>
        </div>
      </div>
    </AppCard>
  </div>
</template>
