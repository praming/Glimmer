<script setup lang="ts">
definePageMeta({ layout: 'auth', public: true })

const auth = useAuthStore()
const toast = useToast()
const route = useRoute()

const form = reactive({ username: '', password: '' })
const submitting = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  if (!form.username.trim() || !form.password) {
    error.value = '请输入用户名和密码'
    return
  }

  submitting.value = true
  error.value = ''

  try {
    const user = await auth.login(form.username.trim(), form.password)
    toast.success(`欢迎回到浮光，${user.username}`)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await navigateTo(redirect)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="gl-surface animate-fade-up overflow-hidden">
    <div class="space-y-1.5 px-7 pb-5 pt-7 text-center">
      <div class="mb-4 flex justify-center">
        <BrandMark :size="44" :with-text="false" />
      </div>
      <h1 class="text-xl font-semibold tracking-tight text-foreground">欢迎回到浮光</h1>
      <p class="text-xs text-muted-foreground">浮光掠影，一触即达。</p>
    </div>

    <form class="space-y-4 px-7 pb-7" @submit.prevent="submit">
      <AppInput
        v-model="form.username"
        label="用户名"
        placeholder="请输入用户名"
        autocomplete="username"
        size="lg"
      />

      <AppInput
        v-model="form.password"
        label="密码"
        type="password"
        placeholder="请输入密码"
        autocomplete="current-password"
        size="lg"
      />

      <Transition name="pop">
        <p
          v-if="error"
          class="rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive"
        >
          {{ error }}
        </p>
      </Transition>

      <AppButton type="submit" size="lg" block :loading="submitting">
        {{ submitting ? '正在进入…' : '进入浮光' }}
      </AppButton>

      <p class="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground/70">
        本系统不开放注册，账号由管理员创建。
      </p>
    </form>
  </div>
</template>
