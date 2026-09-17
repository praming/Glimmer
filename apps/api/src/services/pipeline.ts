import sharp, { type Sharp } from 'sharp'
import {
  FORMAT_EXT,
  FORMAT_MIME,
  applyNamingTemplate,
  formatDateOnly,
  getExtension,
  MIME_TO_FORMAT,
  sanitizeFilename,
  stripExtension,
  type ImageProcessingSettings,
  type OutputFormat,
  type VariantFormat,
} from '@glimmer/shared'
import { md5Hex } from '../lib/crypto'

/* ------------------------------------------------------------------ */
/* 渲染结果                                                            */
/* ------------------------------------------------------------------ */

export interface RenderedVariant {
  format: VariantFormat
  buffer: Buffer
  width: number
  height: number
  size: number
  md5: string
}

/** 原始文件的扩展名（用于 original variant 的落盘名） */
export function resolveOriginalExtension(originalName: string, mimeType: string | null): string {
  const fromName = getExtension(originalName)
  if (fromName) return fromName
  const format = mimeType ? MIME_TO_FORMAT[mimeType] : undefined
  if (format && format !== 'original') return FORMAT_EXT[format]
  return 'bin'
}

/** 输入 MIME → 原图记录的 format */
export function resolveSourceFormat(mimeType: string | null): VariantFormat {
  if (!mimeType) return 'original'
  return MIME_TO_FORMAT[mimeType] ?? 'original'
}

/* ------------------------------------------------------------------ */
/* 命名规划                                                            */
/* ------------------------------------------------------------------ */

export interface VariantPlan {
  format: VariantFormat
  /** 扩展名（不含点） */
  ext: string
  /** 相对存储路径（含扩展名），不含后端 pathPrefix */
  path: string
  /** 该格式对应的 MIME */
  contentType: string
}

export interface VariantPlanParams {
  namingTemplate: string
  originalName: string
  mimeType: string | null
  sourceFormat: VariantFormat
  /** 输出格式（不含 original） */
  formats: OutputFormat[]
  keepOriginal: boolean
  now?: Date
}

/**
 * 依据命名模板为每个目标格式生成相对路径。
 * 模板变量：`{date}` `{time}` `{random}` `{origin}` `{index}` `{format}`
 * 扩展名由服务端统一追加，模板中无需书写。
 */
export function buildVariantPlans(params: VariantPlanParams): VariantPlan[] {
  const now = params.now ?? new Date()
  const date = formatDateOnly(now)
  const origin =
    sanitizeFilename(stripExtension(params.originalName || 'image'), 'image').replace(/\s+/g, '-') ||
    'image'

  const plans: VariantPlan[] = []
  const targets: Array<{ format: VariantFormat; ext: string; token: string; contentType: string }> = []

  if (params.keepOriginal) {
    const ext = resolveOriginalExtension(params.originalName, params.mimeType)
    targets.push({
      format: 'original',
      ext,
      token: params.sourceFormat === 'original' ? ext : params.sourceFormat,
      contentType: params.mimeType ?? 'application/octet-stream',
    })
  }

  for (const format of params.formats) {
    targets.push({
      format,
      ext: FORMAT_EXT[format],
      token: format,
      contentType: FORMAT_MIME[format],
    })
  }

  targets.forEach((target, index) => {
    const base = applyNamingTemplate(params.namingTemplate, {
      date,
      origin,
      format: target.token,
      ext: target.ext,
      index: index + 1,
    })
    const safeBase = base.length > 0 ? base : `${date}/${origin}`

    // 模板里写了 {ext}（如 `{Ymd}/{uniqid}.{ext}`）时不要重复追加扩展名
    const suffix = `.${target.ext}`
    const withExt = safeBase.toLowerCase().endsWith(suffix.toLowerCase())
      ? safeBase
      : `${safeBase}${suffix}`

    plans.push({
      format: target.format,
      ext: target.ext,
      path: withExt,
      contentType: target.contentType,
    })
  })

  return plans
}

/* ------------------------------------------------------------------ */
/* sharp 渲染                                                          */
/* ------------------------------------------------------------------ */

function encode(pipeline: Sharp, format: OutputFormat, processing: ImageProcessingSettings): Sharp {
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({
        quality: processing.qualityJpeg,
        progressive: true,
        mozjpeg: true,
      })
    case 'webp':
      return pipeline.webp({ quality: processing.qualityWebp, effort: 4 })
    case 'avif':
      return pipeline.avif({ quality: processing.qualityAvif, effort: 6 })
    case 'png':
      return pipeline.png({ compressionLevel: processing.qualityPng, palette: true })
    case 'gif':
      return pipeline.gif({ effort: processing.qualityGif })
    default: {
      const exhaustive: never = format
      throw new Error(`不支持的输出格式：${String(exhaustive)}`)
    }
  }
}

export interface RenderOptions {
  keepOriginal: boolean
  formats: OutputFormat[]
  processing: ImageProcessingSettings
}

/**
 * 对上传的原图执行「自动旋转 → 限制尺寸 → 去 EXIF → 按格式编码」，
 * 返回每个目标格式的字节内容与元数据。
 *
 * 说明：`original` 变体保留上传字节（含 EXIF，用于归档）；
 * 是否产生 `original` 由 keepOriginal 决定，默认关闭，因而默认输出全部无 EXIF。
 */
export async function renderVariants(
  source: Buffer,
  options: RenderOptions,
): Promise<RenderedVariant[]> {
  const probe = await sharp(source).metadata()
  const isSvg = probe.format === 'svg'
  const density = isSvg ? 300 : 72
  const animatedSource = (probe.pages ?? 1) > 1

  // EXIF 方向为 5/6/7/8 时宽高互换
  const orientation = probe.orientation ?? 1
  const swap = orientation >= 5 && orientation <= 8
  const srcWidth = swap ? probe.height : probe.width
  const srcHeight = swap ? probe.width : probe.height

  const results: RenderedVariant[] = []

  if (options.keepOriginal) {
    results.push({
      format: 'original',
      buffer: source,
      width: srcWidth ?? 0,
      height: srcHeight ?? 0,
      size: source.byteLength,
      md5: md5Hex(source),
    })
  }

  for (const format of options.formats) {
    const useAnimated = animatedSource && (format === 'gif' || format === 'webp')
    const pipeline = sharp(source, { density, animated: useAnimated }).rotate()

    const { maxWidth, maxHeight } = options.processing
    if ((srcWidth ?? 0) > maxWidth || (srcHeight ?? 0) > maxHeight) {
      pipeline.resize({
        width: maxWidth,
        height: maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
    }

    // sharp 默认丢弃元数据；仅在显式要求保留时才写回 EXIF
    if (!options.processing.stripExif) {
      pipeline.withMetadata()
    }

    encode(pipeline, format, options.processing)

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })

    results.push({
      format,
      buffer: data,
      width: info.width,
      height: info.height,
      size: data.byteLength,
      md5: md5Hex(data),
    })
  }

  return results
}
