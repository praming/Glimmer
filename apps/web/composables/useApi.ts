export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
  headers?: Record<string, string>
}

/**
 * 统一的 API 客户端。
 * - 自动携带 Cookie（credentials: include）
 * - 自动解包 `{ data }` 信封
 * - 失败统一抛出 ApiError，携带后端错误码与字段明细
 */
export function useApi() {
  const config = useRuntimeConfig()
  const base = String(config.public.apiBase || '/api').replace(/\/+$/, '')

  function buildUrl(path: string, query?: Record<string, unknown>): string {
    const normalized = path.startsWith('/') ? path : `/${path}`
    const target = `${base}${normalized}`
    if (!query) return target

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      params.set(key, String(value))
    }
    const qs = params.toString()
    return qs ? `${target}?${qs}` : target
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const hasBody = options.body !== undefined
    let response: Response

    try {
      response = await fetch(buildUrl(path, options.query), {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
      })
    } catch {
      throw new ApiError(0, 'network_error', '网络请求失败，请检查与服务器的连接')
    }

    if (response.status === 204) return undefined as T

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    const envelope = payload as { data?: unknown; error?: { code: string; message: string; details?: unknown } } | null

    if (!response.ok) {
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? 'http_error',
        envelope?.error?.message ?? `请求失败（HTTP ${response.status}）`,
        envelope?.error?.details,
      )
    }

    return (envelope && 'data' in envelope ? envelope.data : payload) as T
  }

  /**
   * 带进度的文件上传。
   * 使用 XMLHttpRequest 以获取 upload.onprogress 能力。
   */
  function upload<T>(
    path: string,
    form: FormData,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', buildUrl(path), true)
      xhr.withCredentials = true
      xhr.timeout = 0

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
        }
      }

      xhr.onload = () => {
        let payload: { data?: unknown; error?: { code: string; message: string; details?: unknown } } | null = null
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null
        } catch {
          payload = null
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(((payload && 'data' in payload ? payload.data : payload) ?? null) as T)
          return
        }

        reject(
          new ApiError(
            xhr.status,
            payload?.error?.code ?? 'http_error',
            payload?.error?.message ?? `上传失败（HTTP ${xhr.status}）`,
            payload?.error?.details,
          ),
        )
      }

      xhr.onerror = () => reject(new ApiError(0, 'network_error', '网络中断，上传失败'))
      xhr.ontimeout = () => reject(new ApiError(0, 'timeout', '上传超时，请稍后重试'))
      xhr.onabort = () => reject(new ApiError(0, 'aborted', '已取消上传'))

      if (signal) {
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }

      xhr.send(form)
    })
  }

  return {
    base,
    buildUrl,
    get: <T>(path: string, query?: Record<string, unknown>) => request<T>(path, { method: 'GET', query }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    upload,
  }
}
