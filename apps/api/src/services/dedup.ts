import type { ImageDTO, OutputFormat, SessionUserDTO } from '@glimmer/shared'
import { buildDedupFingerprint } from '@glimmer/shared'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db, images, type ImageRow } from '../db'
import { sha256Hex } from '../lib/crypto'
import { getImageDetail } from './images'
import type { GlobalSettings } from './settings'

/**
 * 秒传去重（P3-1）
 *
 * 设计要点：
 *
 * 1. **去重键包含配置指纹**，而不是只按内容哈希。
 *    只按内容去重会出现「先用 webp 上传过一次，第二次勾选 webp+jpeg
 *    却直接拿回只含 webp 的旧图」这类错配；后端集合、命名模板、质量与
 *    尺寸参数都会改变产物，因此必须一起进指纹。
 *
 * 2. **作用域限定为同一用户**。
 *    全局去重会让 A 的文件被 B 命中，在私有图库下把 A 的图片 URL 暴露给 B，
 *    而验收标准要求「普通用户只能编辑/删除自己的图片」，同用户去重不改变权限语义。
 *
 * 3. **不命中 `failed` 的旧记录**。
 *    上次处理失败的图片即便内容相同也应重新走一遍流水线，否则会永远拿到一条坏记录。
 */

export interface DedupContext {
  userId: string
  /** 原图字节的 SHA-256 */
  contentHash: string
  formats: OutputFormat[]
  keepOriginal: boolean
  /** 本次实际生效的目标后端配置 id */
  backendIds: string[]
  settings: GlobalSettings
}

/** 生成落库用的 dedup_key（对规范指纹再做一次 SHA-256） */
export function computeDedupKey(ctx: DedupContext): string {
  return sha256Hex(
    buildDedupFingerprint({
      contentHash: ctx.contentHash,
      formats: ctx.formats,
      keepOriginal: ctx.keepOriginal,
      backends: ctx.backendIds,
      processing: ctx.settings.processing,
      namingTemplate: ctx.settings.namingTemplate,
    }),
  )
}

/** 查找可复用的既有图片；同一用户 + 同指纹 + 非 failed */
export function findDedupHit(userId: string, dedupKey: string): ImageRow | null {
  const row = db
    .select()
    .from(images)
    .where(and(eq(images.userId, userId), eq(images.dedupKey, dedupKey), ne(images.status, 'failed')))
    .orderBy(desc(images.createdAt))
    .get()

  return row ?? null
}

export interface DedupLookupInput extends Omit<DedupContext, 'settings'> {
  settings: GlobalSettings
}

/**
 * 一站式查询：给内容哈希与本次上传选项，返回可复用的图片详情。
 * 预检接口与上传接口共用，保证两条路径的判断口径完全一致。
 */
export function lookupDedup(
  input: DedupLookupInput,
  viewer: SessionUserDTO,
): { dedupKey: string; image: ImageDTO | null } {
  const dedupKey = computeDedupKey(input)
  const hit = findDedupHit(input.userId, dedupKey)
  return {
    dedupKey,
    image: hit ? getImageDetail(hit.id, viewer) : null,
  }
}
