import fs from 'node:fs/promises'
import path from 'node:path'
import { EXT_TO_MIME } from '@glimmer/shared'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/context'
import { lookupAccessTarget, recordAccess } from '../services/access'
import { getGlobalSettings } from '../services/settings'
import { localRoots } from '../storage'
import { matchFilesPrefix, resolveFilesPrefix } from '../storage/prefix'

/**
 * 本地存储后端的静态文件服务（图片直链）。
 *
 * 路径前缀**不再写死**（见 `storage/prefix.ts`），而是每次请求按当前生效值认领：
 *   · `/files/2026/xxx.webp` —— 默认
 *   · `/img/2026/xxx.webp`   —— 后台把前缀改成 `img`
 *   · `/2026/xxx.webp`       —— 前缀留空，直接挂在根路径
 *
 * 因此这里不用 `app.route(前缀, …)` 静态挂载（那样改了必须重启进程），
 * 而是导出 `staticFilesMiddleware` 交给 `app.use('*', …)`，后台一改立即生效。
 *
 * 生产环境推荐由 Nginx 直接返回（见 nginx.conf 的 `location /files/`），
 * 该路由作为「无 Nginx / 开发环境」下的兜底，保证本地后端开箱可用。
 *
 * 顺带承担 P3-3 的访问统计：**成功返回文件**时记一次访问
 * （304 不计数，因为没有出口字节）。若改用 Nginx 直接服务静态文件，
 * 这里的统计就收不到请求，需改由 Nginx access log 侧统计。
 */

const CONTENT_TYPES: Record<string, string> = {
  ...EXT_TO_MIME,
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** 按当前生效前缀认领请求；认领了就返回文件，否则交给后续路由 / 404 */
export const staticFilesMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const prefix = resolveFilesPrefix(getGlobalSettings().filesPathPrefix)
  const relPath = matchFilesPrefix(c.req.path, prefix)
  if (relPath === null) return next()
  return serveLocalFile(c, relPath)
}

/** 在全部本地后端根目录下查找并返回 `relInput` 指向的文件 */
export async function serveLocalFile(c: Context<AppEnv>, relInput: string): Promise<Response> {
  let relPath: string
  try {
    relPath = decodeURIComponent(relInput)
  } catch {
    return c.notFound()
  }

  relPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  // 拒绝任何形式的目录穿越
  if (relPath.split('/').some((seg) => seg === '..' || seg === '.')) return c.notFound()

  const settings = getGlobalSettings()

  for (const root of localRoots(settings)) {
    const candidate = path.resolve(root, relPath)
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
    if (!candidate.startsWith(rootWithSep)) continue

    try {
      const stat = await fs.stat(candidate)
      if (!stat.isFile()) continue

      const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
      if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, { ETag: etag })
      }

      const data = await fs.readFile(candidate)
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer

      const ext = candidate.slice(candidate.lastIndexOf('.') + 1).toLowerCase()

      // 访问统计：命中数据库记录才计数（无法归属的磁盘文件直接忽略）
      const target = lookupAccessTarget(relPath)
      if (target) recordAccess(target, stat.size)

      return c.body(arrayBuffer, 200, {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
        'Last-Modified': stat.mtime.toUTCString(),
      })
    } catch {
      /* 当前 root 未命中，继续尝试下一个 */
    }
  }

  return c.notFound()
}
