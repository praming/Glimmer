<script setup lang="ts">
const auth = useAuthStore()
const { init: initTheme, applyPreference: applyThemePreference } = useTheme()
const { apply: applyTypography } = useTypography()

onMounted(() => {
  initTheme()
  void auth.fetchMe()
})

// 偏好里的字体随登录 / 保存实时落到 CSS 变量上
watch(
  () => [auth.preferences.fontSansZh, auth.preferences.fontSansEn],
  () => applyTypography(),
  { immediate: true },
)

// 主题同理，以**账户偏好**为准：本机 localStorage 只负责登录前的首屏。
// 必须等 fetchMe 落定（ready）再套用，否则会先按默认值闪一下、再切回真实值。
watch(
  () => [auth.user?.id ?? null, auth.preferences.theme, auth.ready] as const,
  ([id, theme, ready]) => {
    if (id && ready) applyThemePreference(theme)
  },
  { immediate: true },
)
</script>

<template>
  <div class="min-h-screen bg-background">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <ToastHost />
    <ConfirmHost />
  </div>
</template>
