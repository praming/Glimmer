<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next'

const auth = useAuthStore()
const toast = useToast()

const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const submitting = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''

  if (!form.currentPassword || !form.newPassword) {
    error.value = '请填写完整的密码信息'
    return
  }
  if (form.newPassword.length < 8) {
    error.value = '新密码至少 8 个字符'
    return
  }
  if (form.newPassword !== form.confirmPassword) {
    error.value = '两次输入的新密码不一致'
    return
  }

  submitting.value = true
  try {
    const message = await auth.changePassword(form.currentPassword, form.newPassword)
    toast.success(message)
    form.currentPassword = ''
    form.newPassword = ''
    form.confirmPassword = ''
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppCard title="修改密码" description="修改后其他设备上的登录会立即失效。">
    <form class="space-y-4" @submit.prevent="submit">
      <AppInput
        v-model="form.currentPassword"
        type="password"
        label="当前密码"
        autocomplete="current-password"
      />
      <AppInput
        v-model="form.newPassword"
        type="password"
        label="新密码"
        autocomplete="new-password"
        hint="至少 8 个字符"
      />
      <AppInput
        v-model="form.confirmPassword"
        type="password"
        label="确认新密码"
        autocomplete="new-password"
      />

      <Transition name="pop">
        <p v-if="error" class="rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
          {{ error }}
        </p>
      </Transition>

      <div class="flex justify-end">
        <AppButton type="submit" size="sm" :loading="submitting">
          <KeyRound class="h-3.5 w-3.5" />
          更新密码
        </AppButton>
      </div>
    </form>
  </AppCard>
</template>
