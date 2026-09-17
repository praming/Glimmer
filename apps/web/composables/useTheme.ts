import type { ThemePreference } from '@glimmer/shared'

const STORAGE_KEY = 'glimmer-theme'

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

  function setMode(next: ThemePreference): void {
    mode.value = next
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, next)
    apply()
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

  return { mode, resolved, setMode, toggle, apply, init }
}
