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

  async function updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const saved = await api.patch<UserPreferences>('/me/preferences', patch)
    preferences.value = { ...preferences.value, ...saved }
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
    changePassword,
  }
})
