<script setup lang="ts">
import { CalendarDays, Fingerprint } from 'lucide-vue-next'

const auth = useAuthStore()
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-5">
    <header class="space-y-1.5">
      <h1 class="text-[22px] font-semibold tracking-tight text-foreground">个人资料</h1>
      <p class="text-[13px] text-muted-foreground">管理你的头像、用户名与登录密码。</p>
    </header>

    <!-- 账号速览 -->
    <div class="gl-surface flex flex-wrap items-center gap-4 px-5 py-4">
      <UserAvatar :src="auth.avatarUrl" :name="auth.user?.username" size="lg" />

      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-foreground">{{ auth.user?.username }}</p>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          {{ auth.isAdmin ? '管理员' : '成员' }} · 账号 ID {{ auth.user?.id?.slice(0, 8) }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span class="inline-flex items-center gap-1.5">
          <Fingerprint class="h-3.5 w-3.5" />
          会话 Cookie + Argon2id
        </span>
        <span class="inline-flex items-center gap-1.5">
          <CalendarDays class="h-3.5 w-3.5" />
          当前设备已登录
        </span>
      </div>
    </div>

    <ProfileCard />
    <PasswordForm />
  </div>
</template>
