import { DEFAULT_PREFERENCES, type ThemePreference } from '@glimmer/shared'

const STORAGE_KEY = 'glimmer-theme'
/** 「本机主题已与账户对齐过」的标记，只服务于一次性迁移，见 applyPreference */
const SYNCED_KEY = 'glimmer-theme-synced'

/** 主题：浅色 / 深色 / 跟随系统 */
export function useTheme() {
  const mode = useState<ThemePreference>('glimmer-theme-mode', () => 'system')
  const resolved = useState<'light' | 'dark'>('glimmer-theme-resolved', () => 'light')

  function apply(): void {
    if (!import.meta.client) return

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const value: 'light' | 'dark' = mode.value === 'system' ? (prefersDark ? 'dark' : 'light') : mode.value

    resolved.value = value
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.style.colorScheme = value

    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', value === 'dark' ? '#141420' : '#ffffff')
  }

  /**
   * 把主题写入账户偏好（未登录 / 值没变时不发请求）。
   * 失败静默：主题是显示层的事，为它弹个错误提示反而吵。
   */
  function syncToServer(next: ThemePreference): void {
    const auth = useAuthStore()
    if (!auth.isLoggedIn || auth.preferences.theme === next) return
    void auth.updatePreferences({ theme: next }).catch(() => undefined)
  }

  /** 切换主题。`persist: false` 用于「以账户值覆盖本机」，避免把刚读到的值又写回去 */
  function setMode(next: ThemePreference, persist = true): void {
    mode.value = next
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, next)
    apply()
    if (persist) syncToServer(next)
  }

  /**
   * 登录后以**账户偏好**为准覆盖本机主题。
   *
   * 本机的 `localStorage` 只负责「登录前的首屏」—— 否则每次刷新都会先闪一下错的主题。
   * 之所以必须覆盖：顶栏那个切换按钮在本次改动前只写 `localStorage`、从不写账户，
   * 于是会出现「设置页显示深色、界面却是浅色」这种自相矛盾的状态，换设备更是直接丢失。
   *
   * 唯一例外是**一次性迁移**：改动前用顶栏切过主题的用户，本机是深色而账户里还是默认的
   * 「跟随系统」。此时若直接覆盖，用户会看到界面在自己眼前变回浅色，很莫名其妙 ——
   * 所以反过来把本机值补写进账户，之后所有设备就一致了。
   * 迁移只做一次（靠 {@link SYNCED_KEY} 标记）：否则「A 设备设深色、B 设备改回跟随系统」
   * 会因为 A 的本机值又把系统主题顶回去，来回打架。
   */
  function applyPreference(next: ThemePreference | null | undefined): void {
    if (!import.meta.client || !next || next === mode.value) return

    const stored = localStorage.getItem(STORAGE_KEY)
    const alreadySynced = localStorage.getItem(SYNCED_KEY) === '1'
    const legacyLocalOnly =
      !alreadySynced && next === DEFAULT_PREFERENCES.theme && (stored === 'light' || stored === 'dark')

    localStorage.setItem(SYNCED_KEY, '1')

    if (legacyLocalOnly && stored) {
      // 以本机为准，并补写账户（persist 默认 true）
      setMode(stored)
      return
    }

    setMode(next, false)
  }

  function toggle(): void {
    setMode(resolved.value === 'dark' ? 'light' : 'dark')
  }

  function init(): void {
    if (!import.meta.client) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      mode.value = stored
    }

    apply()

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', () => {
      if (mode.value === 'system') apply()
    })
  }

  return { mode, resolved, setMode, toggle, apply, init, applyPreference }
}
