<script setup lang="ts">
import type { Role, UserDTO } from '@glimmer/shared'
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, User as UserIcon } from 'lucide-vue-next'

definePageMeta({ admin: true })

const api = useApi()
const auth = useAuthStore()
const toast = useToast()
const confirm = useConfirm()

const users = ref<UserDTO[]>([])
const loading = ref(false)

async function fetchUsers(): Promise<void> {
  loading.value = true
  try {
    const result = await api.get<{ items: UserDTO[] }>('/users')
    users.value = result.items
  } catch (error) {
    toast.error('无法加载用户列表', (error as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchUsers)

/* ------------------------------------------------------------------ */
/* 新建 / 编辑                                                          */
/* ------------------------------------------------------------------ */

const editorOpen = ref(false)
const editing = ref<UserDTO | null>(null)
const submitting = ref(false)
const form = reactive({ username: '', password: '', role: 'member' as Role, disabled: false })

function openCreate(): void {
  editing.value = null
  form.username = ''
  form.password = ''
  form.role = 'member'
  form.disabled = false
  editorOpen.value = true
}

function openEdit(user: UserDTO): void {
  editing.value = user
  form.username = user.username
  form.password = ''
  form.role = user.role
  form.disabled = user.disabled
  editorOpen.value = true
}

async function submit(): Promise<void> {
  const username = form.username.trim()
  if (!username) {
    toast.warning('请填写用户名')
    return
  }
  if (username.length < 3 || username.length > 32) {
    toast.warning('用户名需为 3-32 个字符')
    return
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    toast.warning('用户名只能包含字母、数字、下划线、点和连字符')
    return
  }
  if (!editing.value && form.password.length < 8) {
    toast.warning('请设置至少 8 位的初始密码')
    return
  }

  submitting.value = true
  try {
    if (editing.value) {
      const payload: Record<string, unknown> = { role: form.role, disabled: form.disabled }
      if (username !== editing.value.username) payload.username = username
      if (form.password) payload.password = form.password
      await api.patch(`/users/${editing.value.id}`, payload)
      toast.success('用户已更新')

      // 改的是自己 → 同步刷新会话中的用户名 / 头像
      if (editing.value.id === auth.user?.id) await auth.fetchMe()
    } else {
      await api.post('/users', {
        username,
        password: form.password,
        role: form.role,
      })
      toast.success('用户已创建')
    }
    editorOpen.value = false
    await fetchUsers()
  } catch (error) {
    toast.error('保存失败', (error as Error).message)
  } finally {
    submitting.value = false
  }
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

async function removeUser(user: UserDTO): Promise<void> {
  const ok = await confirm.confirm({
    title: `删除用户「${user.username}」？`,
    description: `该用户上传的 ${user.imageCount ?? 0} 张图片也会一并从所有存储后端删除，操作无法撤销。`,
    confirmText: '删除用户',
    destructive: true,
  })
  if (!ok) return

  try {
    const result = await api.del<{ removedImages: number; warnings?: string[] }>(`/users/${user.id}`)
    toast.success(`已删除该用户，并清理 ${result.removedImages} 张图片`)
    if (result.warnings?.length) {
      toast.warning(`${result.warnings.length} 处后端残留未清理`)
    }
    await fetchUsers()
  } catch (error) {
    toast.error('删除失败', (error as Error).message)
  }
}

async function toggleDisabled(user: UserDTO): Promise<void> {
  try {
    await api.patch(`/users/${user.id}`, { disabled: !user.disabled })
    toast.success(user.disabled ? '已启用该账号' : '已禁用该账号')
    await fetchUsers()
  } catch (error) {
    toast.error('操作失败', (error as Error).message)
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1.5">
        <h1 class="text-[22px] font-semibold tracking-tight text-foreground">用户管理</h1>
        <p class="text-[13px] text-muted-foreground">
          共 {{ users.length }} 个账号 · 系统不开放公开注册
        </p>
      </div>

      <AppButton size="sm" @click="openCreate">
        <Plus class="h-3.5 w-3.5" />
        新建用户
      </AppButton>
    </header>

    <div class="gl-surface divide-y divide-border/60 overflow-hidden">
      <div v-if="loading && users.length === 0" class="space-y-3 p-5">
        <AppSkeleton class="h-10 w-full" />
        <AppSkeleton class="h-10 w-full" />
      </div>

      <div v-else-if="users.length === 0" class="py-10 text-center text-xs text-muted-foreground">
        还没有其他账号。
      </div>

      <div
        v-for="user in users"
        v-else
        :key="user.id"
        class="flex items-center gap-3.5 px-5 py-3.5 transition-colors duration-250 hover:bg-muted/30"
      >
        <UserAvatar :src="user.avatarUrl" :name="user.username" size="md" class="shrink-0" />

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="truncate text-[13px] font-medium text-foreground">{{ user.username }}</p>
            <AppBadge v-if="user.role === 'admin'" variant="primary" size="sm">
              <ShieldCheck class="h-3 w-3" />
              管理员
            </AppBadge>
            <AppBadge v-if="user.disabled" variant="destructive" size="sm" dot>已禁用</AppBadge>
            <AppBadge v-if="user.id === auth.user?.id" variant="muted" size="sm">当前账号</AppBadge>
          </div>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            {{ user.imageCount ?? 0 }} 张图片 · 创建于 {{ readableDate(user.createdAt) }}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <AppButton variant="ghost" size="sm" :disabled="user.id === auth.user?.id" @click="toggleDisabled(user)">
            {{ user.disabled ? '启用' : '禁用' }}
          </AppButton>
          <AppButton variant="ghost" size="icon-sm" title="编辑" @click="openEdit(user)">
            <Pencil class="h-3.5 w-3.5" />
          </AppButton>
          <AppButton
            variant="ghost"
            size="icon-sm"
            title="删除"
            :disabled="user.id === auth.user?.id"
            @click="removeUser(user)"
          >
            <Trash2 class="h-3.5 w-3.5 text-destructive" />
          </AppButton>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <AppModal v-model="editorOpen" :title="editing ? '编辑用户' : '新建用户'" :size="'sm'">
      <div class="space-y-4">
        <AppInput
          v-model="form.username"
          label="用户名"
          placeholder="3-32 位字母、数字、下划线"
          :hint="editing ? '修改后该用户的历史图片归属不变，会话也不会失效。' : '用户名为登录凭据，创建后仍可修改。'"
          required
        />

        <AppInput
          v-model="form.password"
          type="password"
          :label="editing ? '重置密码（留空则不修改）' : '初始密码'"
          autocomplete="new-password"
          hint="至少 8 个字符"
        />

        <div class="space-y-2">
          <p class="text-xs font-medium text-muted-foreground">角色</p>
          <AppSegment
            :model-value="form.role"
            :options="[
              { label: '成员', value: 'member', icon: UserIcon },
              { label: '管理员', value: 'admin', icon: ShieldCheck },
            ]"
            block
            @update:model-value="(v) => v && (form.role = v as Role)"
          />
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            管理员可管理所有图片、配置存储与用户；成员仅能管理自己的图片。
          </p>
        </div>

        <AppSwitch
          v-if="editing"
          v-model="form.disabled"
          label="禁用该账号"
          description="禁用后该用户所有会话立即失效，无法登录。"
        />
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" @click="editorOpen = false">取消</AppButton>
        <AppButton size="sm" :loading="submitting" @click="submit">
          <KeyRound class="h-3.5 w-3.5" />
          {{ editing ? '保存修改' : '创建用户' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
