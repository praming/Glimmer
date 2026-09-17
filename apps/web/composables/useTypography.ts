import type { UserPreferences } from '@glimmer/shared'
import { normalizeFontStack } from '@glimmer/shared'

/** 写入 <html> 的 CSS 变量名，与 tailwind.config.ts 的 fontFamily.sans 对应 */
const VAR_ZH = '--font-sans-zh'
const VAR_EN = '--font-sans-en'

/**
 * 字体偏好 → CSS 变量。
 *
 * 两个关键点：
 * 1. **空值必须 `removeProperty` 而不是设置为空串**。
 *    `tailwind.config.ts` 里写的是 `var(--font-sans-en, Inter)`，
 *    一旦变量存在但值为空串，整条 font-family 声明会因语法非法而失效。
 * 2. **值必须经过 `normalizeFontStack()` 规范化**。
 *    含空格的字体名（`Microsoft YaHei`）在 `font-family` 里不加引号会被
 *    拆成三个独立字体名而静默失效 —— 这是「字体设了没反应」的头号原因。
 */
export function useTypography() {
  const auth = useAuthStore()

  function apply(preferences?: Pick<UserPreferences, 'fontSansZh' | 'fontSansEn'> | null): void {
    if (!import.meta.client) return

    const prefs = preferences ?? auth.preferences
    const root = document.documentElement.style

    const zh = normalizeFontStack(prefs?.fontSansZh)
    const en = normalizeFontStack(prefs?.fontSansEn)

    if (zh) root.setProperty(VAR_ZH, zh)
    else root.removeProperty(VAR_ZH)

    if (en) root.setProperty(VAR_EN, en)
    else root.removeProperty(VAR_EN)
  }

  function reset(): void {
    if (!import.meta.client) return
    document.documentElement.style.removeProperty(VAR_ZH)
    document.documentElement.style.removeProperty(VAR_EN)
  }

  return { apply, reset }
}
