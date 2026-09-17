export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
}

const INITIAL: ConfirmState = {
  open: false,
  options: { title: '' },
  resolve: null,
}

export function useConfirm() {
  const state = useState<ConfirmState>('glimmer-confirm', () => ({ ...INITIAL }))

  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      state.value = { open: true, options, resolve }
    })
  }

  function settle(value: boolean): void {
    const resolver = state.value.resolve
    state.value = { ...INITIAL }
    resolver?.(value)
  }

  return { state, confirm, settle }
}
