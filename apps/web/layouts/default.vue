<script setup lang="ts">
import {
  Images,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  UploadCloud,
  Users,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed } from 'vue'

interface NavItem {
  to: string
  label: string
  icon: Component
}

const auth = useAuthStore()
const route = useRoute()
const { mode, setMode } = useTheme()
const confirm = useConfirm()

const navItems = computed<NavItem[]>(() => [
  { to: '/', label: '上传', icon: UploadCloud },
  { to: '/gallery', label: '图库', icon: Images },
  { to: '/settings', label: '设置', icon: Settings },
  ...(auth.isAdmin ? [{ to: '/users', label: '用户', icon: Users }] : []),
])

const currentTitle = computed(
  () => navItems.value.find((item) => isActive(item.to))?.label ?? '浮光',
)

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

const THEME_ICON = computed(() =>
  mode.value === 'dark' ? Moon : mode.value === 'light' ? Sun : Monitor,
)

async function handleLogout(): Promise<void> {
  const ok = await confirm.confirm({
    title: '退出登录？',
    description: '需要重新输入用户名与密码才能回到浮光。',
    confirmText: '退出登录',
    destructive: true,
  })
  if (!ok) return
  await auth.logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-screen bg-background">
    <!-- ============================ PC 侧边栏 ============================ -->
    <aside
      class="fixed inset-y-0 left-0 z-40 hidden w-[15rem] flex-col border-r border-sidebar-border bg-sidebar md:flex"
    >
      <div class="px-5 py-5">
        <BrandMark />
      </div>

      <nav class="flex-1 space-y-1 px-3">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="gl-focus group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-250 ease-smooth"
          :class="
            isActive(item.to)
              ? 'bg-sidebar-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
          "
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.label }}</span>
          <span
            v-if="isActive(item.to)"
            class="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
            aria-hidden="true"
          />
        </NuxtLink>
      </nav>

      <div class="border-t border-sidebar-border p-3">
        <div class="flex items-center gap-1.5">
          <!-- 点击用户信息 → 个人资料 -->
          <NuxtLink
            to="/profile"
            class="gl-focus group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-250 hover:bg-sidebar-accent/70"
            :class="route.path.startsWith('/profile') && 'bg-sidebar-accent text-accent-foreground'"
            title="个人资料"
          >
            <UserAvatar :src="auth.avatarUrl" :name="auth.user?.username" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-foreground">
                {{ auth.user?.username }}
              </span>
              <span class="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {{ auth.isAdmin ? '管理员' : '成员' }}
              </span>
            </span>
          </NuxtLink>

          <AppButton
            variant="ghost"
            size="icon-sm"
            title="切换主题"
            @click="setMode(mode === 'dark' ? 'light' : 'dark')"
          >
            <component :is="THEME_ICON" class="h-4 w-4" />
          </AppButton>

          <AppButton variant="ghost" size="icon-sm" title="退出登录" @click="handleLogout">
            <LogOut class="h-4 w-4" />
          </AppButton>
        </div>
      </div>
    </aside>

    <!-- ============================ 主内容 ============================ -->
    <div class="flex min-w-0 flex-1 flex-col md:pl-[15rem]">
      <!-- 移动端顶栏 -->
      <header
        class="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl md:hidden"
      >
        <BrandMark :size="30" />
        <p class="text-sm font-medium text-muted-foreground">{{ currentTitle }}</p>
        <div class="flex items-center gap-1">
          <AppButton variant="ghost" size="icon-sm" title="切换主题" @click="setMode(mode === 'dark' ? 'light' : 'dark')">
            <component :is="THEME_ICON" class="h-4 w-4" />
          </AppButton>
          <NuxtLink to="/profile" class="gl-focus rounded-full" title="个人资料">
            <UserAvatar :src="auth.avatarUrl" :name="auth.user?.username" size="sm" />
          </NuxtLink>
        </div>
      </header>

      <main class="gl-scroll-area min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-12 md:pt-8">
        <slot />
      </main>
    </div>

    <!-- ============================ 移动端底部 Tab ============================ -->
    <nav
      class="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <div class="flex items-stretch">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors duration-250"
          :class="isActive(item.to) ? 'text-primary' : 'text-muted-foreground'"
        >
          <component :is="item.icon" class="h-5 w-5" />
          <span class="text-[10px] font-medium">{{ item.label }}</span>
        </NuxtLink>
      </div>
    </nav>
  </div>
</template>
