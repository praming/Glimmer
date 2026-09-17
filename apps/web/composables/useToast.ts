export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  title: string
  description?: string
  duration: number
}

const DEFAULT_DURATION = 2600

export function useToast() {
  const items = useState<ToastItem[]>('glimmer-toasts', () => [])

  function dismiss(id: string): void {
    items.value = items.value.filter((item) => item.id !== id)
  }

  function push(type: ToastType, title: string, description?: string, duration = DEFAULT_DURATION): string {
    const id = Math.random().toString(36).slice(2, 10)
    items.value = [...items.value, { id, type, title, description, duration }]

    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  return {
    items,
    push,
    dismiss,
    success: (title: string, description?: string) => push('success', title, description),
    error: (title: string, description?: string) => push('error', title, description, 4200),
    warning: (title: string, description?: string) => push('warning', title, description, 3600),
    info: (title: string, description?: string) => push('info', title, description),
  }
}
