import { formatBytes, formatDateTime, formatRelativeTime } from '@glimmer/shared'

/** 统一的字节数展示 */
export function readableSize(bytes: number | null | undefined): string {
  return formatBytes(bytes)
}

/** `2026-09-16 12:35` */
export function readableDate(iso: string | null | undefined): string {
  return formatDateTime(iso)
}

/** `3 分钟前` */
export function relativeTime(iso: string | null | undefined): string {
  return formatRelativeTime(iso)
}

/** 状态 → Badge 变体 */
export function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'muted' {
  if (status === 'ready') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'destructive'
  return 'muted'
}

/** 复制文本到剪贴板，附带降级方案 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续尝试降级方案 */
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/** 触发浏览器下载 */
export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
