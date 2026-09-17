<script setup lang="ts">
import { DEFAULT_SESSION_DAYS, SESSION_DAY_OPTIONS } from '@glimmer/shared'
import type { SessionDays } from '@glimmer/shared'
import { Camera, Clock, ShieldCheck, Trash2 } from 'lucide-vue-next'

const auth = useAuthStore()
const toast = useToast()

const form = reactive({ username: '', avatarUrl: '' })
const saving = ref(false)
const error = ref('')
const pickerOpen = ref(false)

/* ------------------------- 会话有效期 ------------------------- */

const SESSION_OPTIONS = SESSION_DAY_OPTIONS.map((days) => ({
  label: `${days} 天`,
  value: String(days),
}))

const currentSessionDays = computed(() => auth.user?.sessionDays ?? DEFAULT_SESSION_DAYS)
const sessionValue = computed(() => String(currentSessionDays.value))
const savingSession = ref(false)

/** 选择后立即保存：这是安全设置，不该混进「保存资料」的批量提交里 */
async function updateSessionDays(value: string): Promise<void> {
  const days = Number(value)
  if (savingSession.value) return
  if (!(SESSION_DAY_OPTIONS as readonly number[]).includes(days)) return
  if (days === currentSessionDays.value) return

  savingSession.value = true
  try {
    await auth.updateProfile({ sessionDays: days as SessionDays })
    toast.success(`会话有效期已设为 ${days} 天`, '当前登录状态已按新时长续期')
  } catch (err) {
    toast.error('保存失败', (err as Error).message)
  } finally {
    savingSession.value = false
  }
}

/* --------------------------- 资料 --------------------------- */

watch(
  () => auth.user,
  (user) => {
    if (!user) return
    form.username = user.username
    form.avatarUrl = user.avatarUrl ?? ''
  },
  { immediate: true },
)

const dirty = computed(
  () =>
    form.username.trim() !== (auth.user?.username ?? '') ||
    form.avatarUrl.trim() !== (auth.user?.avatarUrl ?? ''),
)

const usernameError = computed(() => {
  const value = form.username.trim()
  if (!value) return '用户名不能为空'
  if (value.length < 3) return '用户名至少 3 个字符'
  if (value.length > 32) return '用户名最多 32 个字符'
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) return '只能包含字母、数字、下划线、点和连字符'
  return ''
})

function reset(): void {
  form.username = auth.user?.username ?? ''
  form.avatarUrl = auth.user?.avatarUrl ?? ''
  error.value = ''
}

async function submit(): Promise<void> {
  error.value = ''
  if (usernameError.value) {
    error.value = usernameError.value
    return
  }

  saving.value = true
  try {
    const renamed = form.username.trim() !== (auth.user?.username ?? '')
    await auth.updateProfile({
      username: form.username.trim(),
      avatarUrl: form.avatarUrl.trim(),
    })
    toast.success(renamed ? '用户名与头像已更新' : '头像已更新')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppCard title="个人资料" description="用户名与头像对所有成员可见；会话有效期只影响你自己的登录状态。">
    <div class="space-y-5">
      <!-- 头像 -->
      <div class="flex flex-wrap items-center gap-4">
        <button
          type="button"
          class="gl-focus group relative rounded-full transition-transform duration-250 ease-smooth hover:scale-[1.03]"
          title="更换头像"
          @click="pickerOpen = true"
        >
          <UserAvatar :src="form.avatarUrl || null" :name="form.username" size="xl" />
          <span
            class="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/45 opacity-0 transition-opacity duration-250 group-hover:opacity-100"
          >
            <Camera class="h-5 w-5 text-white" />
          </span>
        </button>

        <div class="min-w-0 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <AppButton variant="outline" size="sm" @click="pickerOpen = true">
              <Camera class="h-3.5 w-3.5" />
              更换头像
            </AppButton>
            <AppButton v-if="form.avatarUrl" variant="ghost" size="sm" @click="form.avatarUrl = ''">
              <Trash2 class="h-3.5 w-3.5" />
              移除
            </AppButton>
          </div>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            支持填入图片链接，或从你的图库中挑一张。始终按 1:1 居中裁切显示。
          </p>
        </div>
      </div>

      <!-- 用户名 -->
      <div class="border-t border-border/70 pt-4">
        <AppInput
          v-model="form.username"
          label="用户名"
          placeholder="3-32 位字母、数字、下划线"
          :error="form.username && usernameError ? usernameError : ''"
          hint="用户名用于登录，也是图片列表中显示的上传者名字。"
        />

        <div class="mt-2.5 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <ShieldCheck class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p class="text-[11px] text-muted-foreground">
            当前角色：
            <span class="font-medium text-foreground">{{ auth.isAdmin ? '管理员' : '成员' }}</span>
            · 角色只能由管理员在「用户管理」中调整
          </p>
        </div>
      </div>

      <!-- 会话有效期 -->
      <div class="space-y-2.5 border-t border-border/70 pt-4">
        <div class="flex items-start gap-2">
          <span
            class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-soft text-accent-foreground"
          >
            <Clock class="h-3.5 w-3.5" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium text-muted-foreground">会话有效期</p>
            <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
              登录状态保持多久，<span class="text-foreground/80">仅对你自己生效</span>。
              修改后当前登录会立即按新时长续期，无需重新登录。
            </p>
          </div>
        </div>

        <AppSegment
          :model-value="sessionValue"
          :options="SESSION_OPTIONS"
          @update:model-value="(v) => v && updateSessionDays(v)"
        />
      </div>

      <Transition name="pop">
        <p v-if="error" class="rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
          {{ error }}
        </p>
      </Transition>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <AppButton v-if="dirty" variant="ghost" size="sm" :disabled="saving" @click="reset">撤销改动</AppButton>
        <AppButton size="sm" :loading="saving" :disabled="!dirty || Boolean(usernameError)" @click="submit">
          保存资料
        </AppButton>
      </div>
    </template>

    <AvatarPicker v-model:open="pickerOpen" v-model="form.avatarUrl" :username="form.username" />
  </AppCard>
</template>
