import type {
  CopyFormat,
  ImageDTO,
  OutputFormat,
  UploadAccepted,
  UploadCheckResult,
} from '@glimmer/shared'
import { EXT_TO_MIME, buildCopyText, randomString, sha256Hex } from '@glimmer/shared'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import { useOptionsStore } from './options'

export type TaskStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed'

export interface UploadTask {
  id: string
  file: File
  name: string
  size: number
  status: TaskStatus
  progress: number
  error?: string
  imageId?: string
  /** 本地预览（object URL） */
  localPreview: string
  /** 处理完成后的完整详情 */
  result?: ImageDTO
  /** P3-1：true 表示命中秒传，未上传任何字节 */
  deduplicated?: boolean
}

export interface UploadHistoryItem {
  id: string
  name: string
  image: ImageDTO
  at: number
  /** 该次上传命中秒传（未产生真实传输） */
  deduplicated?: boolean
}

const MAX_CONCURRENCY = 2
const POLL_INTERVAL = 700
const POLL_TIMEOUT = 90_000

export const useUploadStore = defineStore('upload', () => {
  const api = useApi()
  const toast = useToast()
  const auth = useAuthStore()

  const tasks = ref<UploadTask[]>([])
  const history = ref<UploadHistoryItem[]>([])
  const lastSummary = ref<{ total: number; succeeded: number; failed: number } | null>(null)

  /* ------------------------------------------------------------------ */
  /* 本次上传选项（记住上次选择）                                          */
  /* ------------------------------------------------------------------ */

  const formats = useLocalStorage<OutputFormat[]>('glimmer-upload-formats', [])
  const backends = useLocalStorage<string[]>('glimmer-upload-backends', [])
  const keepOriginal = useLocalStorage<boolean>('glimmer-upload-keep-original', false)
  const optionsBound = ref(false)

  /**
   * 加载公开设置并初始化选项。
   * 首次进入时采用全局默认值，之后沿用用户上次的选择。
   */
  async function ensureOptions(): Promise<void> {
    const options = useOptionsStore()
    const data = await options.load()
    if (!data) return

    const validBackends = new Set(data.backends.map((b) => b.id))

    if (!optionsBound.value) {
      if (formats.value.length === 0) formats.value = [...data.processing.outputFormats]
      if (backends.value.length === 0) backends.value = [...data.defaultBackends]
      keepOriginal.value = data.processing.keepOriginal
      optionsBound.value = true
    }

    // 丢弃已禁用 / 已删除的后端
    const filtered = backends.value.filter((id) => validBackends.has(id))
    if (filtered.length !== backends.value.length) {
      backends.value = filtered.length > 0 ? filtered : [...data.defaultBackends]
    }
    if (formats.value.length === 0) formats.value = [...data.processing.outputFormats]
  }

  const activeCount = computed(
    () => tasks.value.filter((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'processing').length,
  )
  const isBusy = computed(() => activeCount.value > 0)

  const completed = computed(() => tasks.value.filter((t) => t.status === 'ready'))
  const failed = computed(() => tasks.value.filter((t) => t.status === 'failed'))

  function isImageFile(file: File): boolean {
    if (file.type.startsWith('image/')) return true
    return /\.(jpe?g|png|webp|avif|gif|tiff?|bmp|svg)$/i.test(file.name)
  }

  /** 归一化出用于白名单判断的 MIME：优先浏览器给的，缺失时按扩展名兜底 */
  function policyMime(file: File): string {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    return (file.type || EXT_TO_MIME[ext] || '').toLowerCase()
  }

  /**
   * 管理员「允许上传的文件类型」白名单。
   * 选项尚未加载或无法判定 MIME 时放行，最终仍由服务端兜底拒绝。
   */
  function isAllowedByPolicy(file: File): boolean {
    const allowed = useOptionsStore().data?.allowedInputMime
    if (!allowed) return true
    const mime = policyMime(file)
    if (!mime) return true
    return allowed.includes(mime)
  }

  function addFiles(files: File[]): number {
    const images = files.filter(isImageFile)
    const accepted = images.filter(isAllowedByPolicy)

    const notImage = files.length - images.length
    const blocked = images.length - accepted.length

    for (const file of accepted) {
      tasks.value.push({
        id: randomString(10),
        file,
        name: file.name,
        size: file.size,
        status: 'queued',
        progress: 0,
        localPreview: URL.createObjectURL(file),
      })
    }

    if (blocked > 0) {
      toast.warning(`已忽略 ${blocked} 个文件`, '当前设置不接受该类格式')
    }
    if (notImage > 0) {
      toast.warning(`已忽略 ${notImage} 个非图片文件`)
    }

    return accepted.length
  }

  function removeTask(id: string): void {
    const task = tasks.value.find((t) => t.id === id)
    if (task && task.status !== 'uploading' && task.status !== 'processing') {
      URL.revokeObjectURL(task.localPreview)
      tasks.value = tasks.value.filter((t) => t.id !== id)
    }
  }

  function clearFinished(): void {
    for (const task of tasks.value) {
      if (task.status === 'ready' || task.status === 'failed') {
        URL.revokeObjectURL(task.localPreview)
      }
    }
    tasks.value = tasks.value.filter((t) => t.status !== 'ready' && t.status !== 'failed')
  }

  function clearHistory(): void {
    history.value = []
  }

  /** 轮询直到异步处理结束 */
  async function waitForReady(imageId: string): Promise<ImageDTO> {
    const startedAt = Date.now()

    for (;;) {
      const detail = await api.get<ImageDTO>(`/images/${imageId}`)
      if (detail.status === 'ready' || detail.status === 'failed') return detail

      if (Date.now() - startedAt > POLL_TIMEOUT) {
        throw new Error('处理超时，请稍后在图库中查看结果')
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }
  }

  function pickPrimaryUrl(image: ImageDTO): string | null {
    const variants = image.variants ?? []
    const preferred = variants.find((v) => v.format === 'webp' && v.primaryUrl)
    return preferred?.primaryUrl ?? variants.find((v) => v.primaryUrl)?.primaryUrl ?? image.previewUrl
  }

  async function autoCopy(image: ImageDTO): Promise<void> {
    if (!auth.preferences.autoCopy) return
    const url = pickPrimaryUrl(image)
    if (!url) return

    const format: CopyFormat = auth.preferences.defaultCopyFormat
    const ok = await copyText(buildCopyText(format, url, image.filename))
    if (ok) toast.success('已复制，浮光已就绪', url)
  }

  async function runTask(task: UploadTask): Promise<void> {
    task.status = 'uploading'
    task.progress = 0

    await ensureOptions()

    // ---- P3-1 秒传预检 ----------------------------------------------------
    // 先算原图 SHA-256，问一次服务端是否已有同内容 + 同处理配置的图片。
    // 命中则完全跳过文件传输；失败（环境无 WebCrypto / 网络异常）静默降级为普通上传，
    // 服务端在上传阶段还会再兜底判一次去重，所以这里失败不会导致漏判。
    const hit = await probeDedup(task)
    if (hit) return

    const form = new FormData()
    form.append('files', task.file, task.name)
    form.append('formats', formats.value.join(','))
    form.append('backends', backends.value.join(','))
    form.append('keepOriginal', String(keepOriginal.value))

    try {
      const accepted = await api.upload<UploadAccepted>('/upload', form, (percent) => {
        task.progress = percent
      })

      if (accepted.rejected.length > 0 && accepted.images.length === 0) {
        throw new Error(accepted.rejected[0]!.reason)
      }

      const record = accepted.images[0]
      if (!record) throw new Error('服务端未返回图片信息')

      task.imageId = record.id
      task.status = 'processing'
      task.progress = 100

      const detail = await waitForReady(record.id)

      if (detail.status === 'failed') {
        throw new Error('图片处理失败，请在图库中查看原因')
      }

      // 服务端兜底命中秒传时同样标记，UI 上可与本地预检命中统一呈现
      await completeTask(task, detail, record.deduplicated === true)
    } catch (error) {
      task.status = 'failed'
      task.error = (error as Error).message
    }
  }

  /** 收尾：写入历史、标记就绪、按偏好自动复制 */
  async function completeTask(task: UploadTask, detail: ImageDTO, deduplicated = false): Promise<void> {
    task.result = detail
    task.imageId = detail.id
    task.status = 'ready'
    task.progress = 100
    task.deduplicated = deduplicated
    history.value = [
      { id: randomString(8), name: task.name, image: detail, at: Date.now(), deduplicated },
      ...history.value,
    ].slice(0, 40)
    await autoCopy(detail)
  }

  /**
   * 秒传预检。
   *
   * @returns true 表示已命中并完成收尾（调用方应直接 return）；false 表示需继续走正常上传。
   * @throws 不抛异常 —— 预检本身失败一律降级为「未命中」。
   */
  async function probeDedup(task: UploadTask): Promise<boolean> {
    try {
      const hash = await sha256Hex(await task.file.arrayBuffer())
      const result = await api.post<UploadCheckResult>('/upload/check', {
        hash,
        size: task.size,
        formats: formats.value,
        backends: backends.value,
        keepOriginal: keepOriginal.value,
      })

      if (!result.hit || !result.image) return false
      // 服务端已排除 failed 记录，但仍可能是同批次里「刚提交、还在处理」的图
      if (result.image.status === 'failed') return false

      const detail =
        result.image.status === 'ready' ? result.image : await waitForReady(result.image.id)
      if (detail.status !== 'ready') return false

      task.imageId = detail.id
      task.progress = 100
      await completeTask(task, detail, true)
      return true
    } catch {
      // 预检只是「省流量」的优化，任何异常都不应阻断上传
      return false
    }
  }

  let schedulerRunning = false

  async function schedule(): Promise<void> {
    if (schedulerRunning) return
    schedulerRunning = true

    try {
      for (;;) {
        const active = tasks.value.filter((t) => t.status === 'uploading' || t.status === 'processing').length
        if (active >= MAX_CONCURRENCY) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          continue
        }

        const next = tasks.value.find((t) => t.status === 'queued')
        if (!next) {
          const stillActive = tasks.value.some((t) => t.status === 'uploading' || t.status === 'processing')
          if (!stillActive) break
          await new Promise((resolve) => setTimeout(resolve, 150))
          continue
        }

        void runTask(next)
      }
    } finally {
      schedulerRunning = false
      const total = tasks.value.length
      const succeeded = completed.value.length
      const failedCount = failed.value.length
      if (total > 0) {
        lastSummary.value = { total, succeeded, failed: failedCount }
        if (failedCount > 0) {
          toast.warning(`上传完成：${succeeded} 成功 / ${failedCount} 失败`)
        }
      }
    }
  }

  /** 添加入队并启动调度 */
  function enqueue(files: File[]): void {
    const count = addFiles(files)
    if (count === 0) return
    void schedule()
  }

  /** 重新上传失败项 */
  function retryFailed(): void {
    for (const task of tasks.value) {
      if (task.status === 'failed') {
        task.status = 'queued'
        task.progress = 0
        task.error = undefined
        task.deduplicated = false
      }
    }
    void schedule()
  }

  return {
    tasks,
    history,
    lastSummary,
    formats,
    backends,
    keepOriginal,
    activeCount,
    isBusy,
    completed,
    failed,
    addFiles,
    removeTask,
    clearFinished,
    clearHistory,
    enqueue,
    retryFailed,
    ensureOptions,
    pickPrimaryUrl,
  }
})
