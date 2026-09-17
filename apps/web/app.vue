<script setup lang="ts">
const auth = useAuthStore()
const { init: initTheme } = useTheme()
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
