<script setup lang="ts">
import { UserCog } from 'lucide-vue-next'

const auth = useAuthStore()
const store = useSettingsStore()

const activeTab = ref<string>('personal')

const tabs = computed(() => {
  const list = [
    { label: '个人偏好', value: 'personal' },
    { label: '访问统计', value: 'stats' },
  ]
  if (!auth.isAdmin) return list
  return [
    ...list,
    { label: '存储后端', value: 'storage' },
    { label: '图片处理', value: 'processing' },
    { label: '命名与域名', value: 'general' },
  ]
})

onMounted(async () => {
  if (auth.isAdmin) await store.load()
})

watch(
  () => auth.isAdmin,
  async (isAdmin) => {
    if (isAdmin && !store.settings) await store.load()
  },
  { immediate: true },
)
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-5">
    <header class="space-y-1.5">
      <h1 class="text-[22px] font-semibold tracking-tight text-foreground">浮光设置</h1>
      <p class="text-[13px] text-muted-foreground">
        {{ auth.isAdmin ? '全局配置对所有人都生效，请谨慎修改。' : '管理你的个人偏好与访问统计。' }}
      </p>
    </header>

    <AppSegment v-model="activeTab" :options="tabs" block />

    <!-- 个人偏好 -->
    <template v-if="activeTab === 'personal'">
      <PersonalSettings />
    </template>

    <!-- 访问统计 -->
    <template v-else-if="activeTab === 'stats'">
      <AccessStats />
    </template>

    <!-- 管理员：存储后端 + 上传规则 + 访问令牌 -->
    <template v-else-if="activeTab === 'storage' && auth.isAdmin">
      <BackendManager />
      <UploadPolicy />
      <ApiTokenManager />
      <RuntimeInfo />
    </template>

    <!-- 管理员：图片处理 -->
    <template v-else-if="activeTab === 'processing' && auth.isAdmin">
      <ProcessingForm />
    </template>

    <!-- 管理员：命名与域名 -->
    <template v-else-if="activeTab === 'general' && auth.isAdmin">
      <GeneralForm />
      <AppCard title="用户管理" description="创建、禁用或删除成员账号。">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
              <UserCog class="h-4 w-4" />
            </span>
            <p class="text-[13px] text-muted-foreground">
              系统不开放注册，成员账号需由管理员创建。
            </p>
          </div>
          <AppButton to="/users" variant="outline" size="sm">前往用户管理</AppButton>
        </div>
      </AppCard>
    </template>
  </div>
</template>
