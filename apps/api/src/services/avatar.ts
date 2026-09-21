/**
 * 本地头像：处理、落盘、读取与地址解析。
 *
 * ── 为什么头像不走存储后端、也不存图片直链 ────────────────────────────
 * 头像是**个人资料**，不是图库内容。此前「从图库选一张」的做法有两个固有缺陷：
 *
 *  1. 它把「上传那一刻的直链」**当作快照**写进 `users.avatar_url`。之后只要改过
 *     对外域名或路径前缀，这个地址就整体失效；而 `cli/rebuild-urls.ts` 只重建
 *     `storage_records`、从不碰 users 表 —— 于是头像会在**所有设备上同时坏掉**
 *     （文件其实还在，只是地址过时了），极难自查。
 *  2. 头像因此依赖一张随时可能被从图库删除的图片，还得为它保留一份没有任何
 *     显示价值的原图。
 *
 * 现在的做法：上传时用 sharp 裁成 1:1 小图，存进 `paths.avatars`（数据库同级目录）；
 * 对外地址恒为 `GET /api/users/:id/avatar?v=<版本号>`。该地址的输入只有
 * **用户 id + 版本号**，与域名、路径前缀、存储后端**全部无关** —— 因此永远不会
 * 因为改配置而失效，也不需要任何重建命令。
 *
 * ⚠️ 与外部链接**互斥**：`users.avatar_url` 现在只表示「用户手填的外链」。
 * 设置外链时会删掉本地头像文件，上传本地头像时会清空 `avatar_url`，
 * 保证「最后一次操作生效」是可预期的。
 */
import fs from 'node:fs'
import path from 'node:path'
import { AVATAR_MAX_BYTES, AVATAR_SIZE } from '@glimmer/shared'
import sharp from 'sharp'
import type { UserRow } from '../db'
import { paths } from '../env'
import { badRequest } from '../lib/errors'

/** 统一编码为 webp；尺寸与体积上限见 shared 的 AVATAR_SIZE / AVATAR_MAX_BYTES */
const AVATAR_EXT = 'webp'
const AVATAR_CONTENT_TYPE = 'image/webp'

/**
 * 头像的固定磁盘路径（每个用户一个文件，重新上传就地覆盖）。
 *
 * 用户 id 会直接成为文件名，因此必须校验字符集：`/api/users/:id/avatar` 的 `:id`
 * 来自 URL，若放任 `../` 之类进来就是一次目录穿越。
 * id 由服务端 `crypto.randomUUID()` 生成，正常值一定通过这个校验。
 */
export function avatarFilePath(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw badRequest('用户 id 非法')
  return path.join(paths.avatars, `${userId}.${AVATAR_EXT}`)
}

/** 头像的对外地址：输入只有「用户 id + 版本号」 */
export function buildAvatarUrl(userId: string, version: string): string {
  return `/api/users/${userId}/avatar?v=${encodeURIComponent(version)}`
}

/**
 * 从用户行解析出**可以直接放进 `<img src>`** 的头像地址。
 *
 * ⭐ 全仓唯一实现。改「服务端计算」之前，这段 `avatarUrl: row.avatarUrl ?? null`
 * 散落在 5 处（`lib/session.ts`、`lib/tokens.ts`、`routes/auth.ts` ×2、`routes/users.ts`）——
 * 只要有一处忘了改，就会出现「某些接口给了地址、另一些返回 null」的偏差，
 * 而这类偏差在界面上表现为「头像时有时无」，几乎无法定位。
 */
export function resolveAvatarUrl(
  row: Pick<UserRow, 'id' | 'avatarUrl' | 'avatarUpdatedAt'>,
): string | null {
  const external = row.avatarUrl?.trim()
  if (external) return external
  if (row.avatarUpdatedAt) return buildAvatarUrl(row.id, row.avatarUpdatedAt)
  return null
}

export interface SavedAvatar {
  /** 写入数据库的版本号（同时用作 ?v= 缓存失效参数） */
  updatedAt: string
  bytes: number
  width: number
  height: number
}

/**
 * 处理并保存头像，返回新的版本号。
 *
 * 处理规则：按 EXIF 摆正 → 1:1 居中裁切 → 缩放到 {@link AVATAR_SIZE} → webp。
 * 裁切用 `fit: 'cover'` 且**不设** `withoutEnlargement`：输出恒为 256×256，
 * 尺寸可预期（小图放大到 256 只是多几百字节，换来的是各处显示完全一致）。
 */
export async function saveAvatar(userId: string, input: Buffer): Promise<SavedAvatar> {
  if (input.byteLength === 0) throw badRequest('头像文件为空')
  if (input.byteLength > AVATAR_MAX_BYTES) {
    throw badRequest(`头像不能超过 ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB`)
  }

  const target = avatarFilePath(userId)

  let data: Buffer
  let width: number
  let height: number
  try {
    const result = await sharp(input)
      // rotate() 必须在 resize 之前：手机竖拍的照片靠 EXIF 的 Orientation 才有正确方向，
      // 而 sharp 默认会丢弃元数据 —— 不先摆正，竖图存下来就是躺着的。
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true })
    data = result.data
    width = result.info.width
    height = result.info.height
  } catch {
    // sharp 打不开的文件：不是图片，或图片已损坏。到这一步一个字节都没落盘。
    throw badRequest('无法解析该图片，请换一张 jpg / png / webp 图片')
  }

  // 先写临时文件再 rename：rename 在同一文件系统内是原子的，
  // 这样进程中途退出也不会让头像文件变成半截而渲染失败。
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tmp, data)
    await fs.promises.rename(tmp, target)
  } catch (error) {
    await fs.promises.unlink(tmp).catch(() => undefined)
    throw error
  }

  return { updatedAt: new Date().toISOString(), bytes: data.byteLength, width, height }
}

/** 删除本地头像文件。文件不存在时静默返回（幂等，可安全重复调用）。 */
export async function removeAvatarFile(userId: string): Promise<void> {
  try {
    await fs.promises.unlink(avatarFilePath(userId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** 读取本地头像文件；不存在返回 null（调用方据此回 404，前端回落到首字母） */
export async function readAvatarFile(
  userId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const bytes = await fs.promises.readFile(avatarFilePath(userId))
    return { bytes, contentType: AVATAR_CONTENT_TYPE }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
