import type { SessionDays, SessionUserDTO, UserPreferences } from '@glimmer/shared'
import { DEFAULT_PREFERENCES } from '@glimmer/shared'
import { defineStore } from 'pinia'

interface MeResponse {
  user: SessionUserDTO | null
  preferences: UserPreferences | null
}

interface LoginResponse {
  user: SessionUserDTO
  preferences: UserPreferences
  expiresAt: string
}

export const useAuthStore = defineStore('auth', () => {
  const api = useApi()

  const user = ref<SessionUserDTO | null>(null)
  const preferences = ref<UserPreferences>({ ...DEFAULT_PREFERENCES })
  const ready = ref(false)
  const loading = ref(false)

  const isAdmin = computed(() => user.value?.role === 'admin')
  const isLoggedIn = computed(() => Boolean(user.value))

  async function fetchMe(): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      const response = await api.get<MeResponse>('/auth/me')
      user.value = response?.user ?? null
      if (response?.preferences) {
        preferences.value = { ...DEFAULT_PREFERENCES, ...response.preferences }
      }
    } catch {
      user.value = null
    } finally {
      loading.value = false
      ready.value = true
    }
  }

  async function login(username: string, password: string): Promise<SessionUserDTO> {
    const response = await api.post<LoginResponse>('/auth/login', { username, password })
    user.value = response.user
    preferences.value = { ...DEFAULT_PREFERENCES, ...response.preferences }
    ready.value = true
    return response.user
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } catch {
      /* 即便服务端失败也要清理本地状态 */
    }
    user.value = null
    preferences.value = { ...DEFAULT_PREFERENCES }
  }

  /**
   * 保存个人偏好。
   *
   * **乐观更新**：先把改动落到本地，界面立刻响应；请求失败再回滚成原值并抛出。
   * 这里全是开关类设置（主题、字体、上传选项），等一次服务端往返再变颜色会有明显的
   * 迟滞感；回滚则保证「界面显示的」与「服务端存着的」最终一致。
   */
  async function updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const previous = { ...preferences.value }
    preferences.value = { ...previous, ...patch }
    try {
      const saved = await api.patch<UserPreferences>('/me/preferences', patch)
      preferences.value = { ...preferences.value, ...saved }
    } catch (error) {
      preferences.value = previous
      throw error
    }
    return preferences.value
  }

  /** 修改自己的用户名 / 头像 / 会话有效期 */
  async function updateProfile(patch: {
    username?: string
    avatarUrl?: string
    sessionDays?: SessionDays
  }): Promise<SessionUserDTO> {
    const result = await api.patch<{ user: SessionUserDTO; sessionExpiresAt: string | null }>(
      '/auth/me',
      patch,
    )
    user.value = result.user
    return result.user
  }

  /**
   * 上传本地头像。
   *
   * 头像走**独立通道**：不经过图库、不写图片直链快照，服务端裁成 1:1 小图后
   * 按「用户 id + 版本号」现算地址 —— 因此改对外域名 / 路径前缀都不会让它失效。
   * 详见 `apps/api/src/services/avatar.ts`。
   */
  async function uploadAvatar(file: File): Promise<SessionUserDTO> {
    if (!user.value) throw new Error('登录状态已失效，请重新登录')
    const form = new FormData()
    form.append('file', file)
    const result = await api.upload<{ user: SessionUserDTO }>(
      `/users/${user.value.id}/avatar`,
      form,
    )
    user.value = result.user
    return result.user
  }

  /** 清除头像（本地文件与外链一起清），回到用户名首字母占位 */
  async function removeAvatar(): Promise<SessionUserDTO> {
    if (!user.value) throw new Error('登录状态已失效，请重新登录')
    const result = await api.del<{ user: SessionUserDTO }>(`/users/${user.value.id}/avatar`)
    user.value = result.user
    return result.user
  }

  /** 当前用户头像（无则 null，调用方回落到首字母占位） */
  const avatarUrl = computed(() => user.value?.avatarUrl ?? null)

  async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
    const result = await api.post<{ message?: string }>('/auth/password', {
      currentPassword,
      newPassword,
    })
    return result?.message ?? '密码已更新'
  }

  return {
    user,
    preferences,
    avatarUrl,
    ready,
    loading,
    isAdmin,
    isLoggedIn,
    fetchMe,
    login,
    logout,
    updatePreferences,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    changePassword,
  }
})
