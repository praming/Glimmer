import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { joinUrl, sanitizeStoragePath } from '@glimmer/shared'
import {
  BaseStorageAdapter,
  describeStorageError,
  type FileInfo,
  type StorageAdapter,
  type StorageResult,
  type UploadOptions,
} from './types'

export interface S3AdapterOptions {
  id: string
  name: string
  endpoint?: string
  region?: string
  bucket: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
  publicBaseUrl?: string
  pathPrefix?: string
}

/**
 * Endpoint 主机名首段的「服务标签」白名单。
 * 只有首段像服务域名（s3 / oss / cos …）时才敢把主机名首段当作多余的空间名剥掉，
 * 否则可能误伤自定义 CNAME（如 `https://img.example.com` 恰好与空间同名）。
 */
const SERVICE_HOST_LABEL = /^(s3|oss|cos|obs|r2|storage|s3express)([.-]|$)/i

export interface NormalizedEndpoint {
  endpoint: string
  /** 归一化过程中给用户看的说明（没有异常则为空） */
  notice?: string
}

/**
 * 归一化 S3 Endpoint，顺便识别「把空间域名当成 Endpoint」这个高频误填。
 *
 * 各家的控制台都会给出**两个**容易混淆的地址：
 * - 服务域名 / Endpoint：`https://s3.cn-east-1.qiniucs.com`   ← 该填这个
 * - 空间域名（虚拟主机风格）：`https://<空间名>.s3.cn-east-1.qiniucs.com`
 *
 * 误填后者时，主机名已经被路由到该空间，若再开启 Path-Style，
 * 对象键就会变成 `<空间名>/<命名规则>` —— 表现为「空间根目录里多了一个同名文件夹」。
 * 这里把多余的首段剥掉，让两种填法都能得到正确结果。
 */
export function normalizeS3Endpoint(endpoint: string, bucket: string): NormalizedEndpoint {
  const raw = (endpoint ?? '').trim().replace(/\/+$/, '')
  const name = (bucket ?? '').trim()
  if (!raw || !name) return { endpoint: raw }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { endpoint: raw }
  }

  const labels = url.hostname.split('.')
  // 至少要有 <空间名>.<服务>.<区域>.<顶级域> 四段才可能是空间域名
  if (labels.length < 4 || labels[0].toLowerCase() !== name.toLowerCase()) {
    return { endpoint: raw }
  }

  const rest = labels.slice(1)
  if (!SERVICE_HOST_LABEL.test(rest[0])) {
    return {
      endpoint: raw,
      notice: `Endpoint 主机名的首段与空间名「${name}」相同，若上传后对象被多套了一层同名目录，请把 Endpoint 改成去掉空间名的服务域名（如 https://s3.cn-east-1.qiniucs.com）`,
    }
  }

  url.hostname = rest.join('.')
  const fixed = url.toString().replace(/\/+$/, '')
  return {
    endpoint: fixed,
    notice: `Endpoint 里的空间名「${name}」已自动忽略 —— Endpoint 应填服务域名（${fixed}），填空间域名会让对象多套一层同名目录`,
  }
}

/**
 * S3 兼容适配器。
 * 适用于 AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS / 七牛云 Kodo 等。
 */
export class S3StorageAdapter extends BaseStorageAdapter implements StorageAdapter {
  readonly id: string
  readonly name: string
  readonly type = 's3' as const
  readonly notices: string[] = []

  private readonly client: S3Client
  private readonly bucket: string
  private readonly endpoint: string
  private readonly region: string
  private readonly forcePathStyle: boolean
  private readonly publicBaseUrl: string
  private readonly pathPrefix: string

  constructor(options: S3AdapterOptions) {
    super()
    this.id = options.id
    this.name = options.name
    this.bucket = options.bucket

    // Endpoint 若混入了空间名（把「空间域名」当成 Endpoint 填了），这里自动纠正并留一条提示
    const normalized = normalizeS3Endpoint(options.endpoint ?? '', options.bucket)
    this.endpoint = normalized.endpoint
    if (normalized.notice) this.notices.push(normalized.notice)

    this.region = options.region?.trim() || 'us-east-1'
    this.forcePathStyle = options.forcePathStyle ?? false
    this.publicBaseUrl = (options.publicBaseUrl ?? '').replace(/\/+$/, '')
    this.pathPrefix = (options.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')

    // 路径前缀与空间名同值时，等于在空间里再套一层同名目录 —— 几乎肯定是误填，必须提示
    if (this.pathPrefix && this.pathPrefix.toLowerCase() === this.bucket.trim().toLowerCase()) {
      this.notices.push(
        `路径前缀与空间名同为「${this.bucket}」，对象会存在于空间内的同名目录下；不需要这层目录就把它留空`,
      )
    }

    const config: S3ClientConfig = { region: this.region }
    if (this.endpoint) config.endpoint = this.endpoint
    if (options.accessKeyId && options.secretAccessKey) {
      config.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      }
    }
    if (this.forcePathStyle) config.forcePathStyle = true

    // 新版 AWS SDK 默认启用 flexible checksum，部分 S3 兼容服务（R2 / MinIO 旧版）会拒绝；
    // 这里改为「仅在必需时计算」，最大化兼容性。
    Object.assign(config, {
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })

    this.client = new S3Client(config)
  }

  private key(relPath: string): string {
    const clean = sanitizeStoragePath(relPath)
    return this.pathPrefix ? `${this.pathPrefix}/${clean}` : clean
  }

  async upload(fileBuffer: Buffer, relPath: string, options?: UploadOptions): Promise<StorageResult> {
    const key = this.key(relPath)
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: options?.contentType,
          CacheControl: options?.cacheControl ?? 'public, max-age=31536000, immutable',
        }),
      )
    } catch (error) {
      throw new Error(`S3 上传失败：${describeStorageError(error)}`)
    }
    return { path: sanitizeStoragePath(relPath), url: this.getUrl(relPath), size: fileBuffer.byteLength }
  }

  async delete(relPath: string): Promise<boolean> {
    const key = this.key(relPath)
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    } catch (error) {
      throw new Error(`S3 删除失败：${describeStorageError(error)}`)
    }
    // DeleteObject 对不存在的 Key 同样返回成功，此处按幂等语义返回 true
    return true
  }

  async exists(relPath: string): Promise<boolean> {
    const key = this.key(relPath)
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      const name = (error as { name?: string }).name
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false
      throw new Error(`S3 探测失败：${describeStorageError(error)}`)
    }
  }

  getUrl(relPath: string): string {
    // 必须走 this.key()：对象真实存放在 `<pathPrefix>/<relPath>`，
    // URL 少一段前缀就会 404（本地 / WebDAV 适配器都是这个语义）。
    const key = this.key(relPath)
    if (this.publicBaseUrl) return joinUrl(this.publicBaseUrl, key)

    const base = this.endpoint || `https://s3.${this.region}.amazonaws.com`
    try {
      const url = new URL(base)
      if (this.forcePathStyle || this.endpoint) {
        return joinUrl(base, `${this.bucket}/${key}`)
      }
      return `${url.protocol}//${this.bucket}.${url.host}/${key}`
    } catch {
      return joinUrl(base, `${this.bucket}/${key}`)
    }
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const full = this.key(prefix)
    const out: FileInfo[] = []
    let token: string | undefined

    try {
      do {
        const page = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: full,
            ContinuationToken: token,
            MaxKeys: 1000,
          }),
        )
        for (const item of page.Contents ?? []) {
          if (!item.Key) continue
          out.push({
            path: item.Key,
            size: item.Size ?? 0,
            lastModified: item.LastModified,
          })
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token && out.length < 5000)
    } catch (error) {
      throw new Error(`S3 列表失败：${describeStorageError(error)}`)
    }

    return out
  }

  async download(relPath: string): Promise<Buffer> {
    const key = this.key(relPath)
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )
      const bytes = await response.Body?.transformToByteArray()
      if (!bytes) throw new Error('对象内容为空')
      return Buffer.from(bytes)
    } catch (error) {
      throw new Error(`S3 读取失败：${describeStorageError(error)}`)
    }
  }

  async test(): Promise<void> {
    try {
      await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1, Prefix: this.pathPrefix || undefined }),
      )
    } catch (error) {
      throw new Error(`S3 连接测试失败：${describeStorageError(error)}`)
    }
  }
}
