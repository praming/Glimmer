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
 * S3 兼容适配器。
 * 适用于 AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS 等。
 */
export class S3StorageAdapter extends BaseStorageAdapter implements StorageAdapter {
  readonly id: string
  readonly name: string
  readonly type = 's3' as const

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
    this.endpoint = (options.endpoint ?? '').replace(/\/+$/, '')
    this.region = options.region?.trim() || 'us-east-1'
    this.forcePathStyle = options.forcePathStyle ?? false
    this.publicBaseUrl = (options.publicBaseUrl ?? '').replace(/\/+$/, '')
    this.pathPrefix = (options.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')

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
    const key = sanitizeStoragePath(relPath)
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
