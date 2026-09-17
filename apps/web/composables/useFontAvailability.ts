import { isGenericFontKeyword, normalizeFontStack } from '@glimmer/shared'

/**
 * 本机字体可用性检测。
 *
 * 背景：浏览器不提供「枚举本机字体」的接口，用户在设置页手输字体名时，
 * 如果该字体本机没有安装，页面会**毫无变化地回落到已有字体**——
 * 用户就会以为「字体设置不起作用」。这里用宽度对比法把真相测出来。
 *
 * 检测原理（经典做法）：同一段文本分别用 monospace / sans-serif / serif
 * 三个基准字体渲染并记录宽度，再把候选字体插到最前面。
 * 只要有一个基准备景下的宽度发生变化，就说明候选字体真的被用上了。
 */

/** 英文/数字方向的回落栈（与 tailwind.config.ts 的 fontFamily.sans 保持一致） */
const LATIN_FALLBACK = [
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Arial',
  'sans-serif',
]

/** 中文方向的回落栈：排除纯拉丁字体，避免「中文实际使用 Segoe UI」这种误导 */
const CJK_FALLBACK = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Noto Sans SC',
  'sans-serif',
]

/** 平台专有关键字：不是真实字体名，按运行平台判定 */
const PLATFORM_KEYWORDS = new Set(['-apple-system', 'blinkmacsystemfont'])

const installedCache = new Map<string, boolean>()

function isApplePlatform(): boolean {
  if (!import.meta.client) return false
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent)
}

/** 本机是否安装了该字体（结果带缓存，字体列表在一次会话内不会变） */
export function isFontInstalled(name: string): boolean {
  if (!import.meta.client) return false
  const bare = name.trim().replace(/^["']|["']$/g, '')
  if (!bare) return false
  if (isGenericFontKeyword(bare)) return true
  if (PLATFORM_KEYWORDS.has(bare.toLowerCase())) return isApplePlatform()

  const key = bare.toLowerCase()
  const cached = installedCache.get(key)
  if (cached !== undefined) return cached

  const el = document.createElement('span')
  el.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:nowrap;font-size:72px'
  el.textContent = 'mmmmmmmmmmlli'
  document.body.appendChild(el)

  const bases = ['monospace', 'sans-serif', 'serif']
  const baseWidths = bases.map((b) => {
    el.style.fontFamily = b
    return el.getBoundingClientRect().width
  })

  let installed = false
  for (let i = 0; i < bases.length; i++) {
    el.style.fontFamily = `"${bare}", ${bases[i]}`
    if (el.getBoundingClientRect().width !== baseWidths[i]) {
      installed = true
      break
    }
  }
  el.remove()

  installedCache.set(key, installed)
  return installed
}

export interface FontStackEntry {
  name: string
  installed: boolean
}

export interface FontStackReport {
  /** 用户填写的字体，按顺序逐个标注本机是否可用 */
  entries: FontStackEntry[]
  /** 最终真正会用来渲染的字体（用户填的都不行时落到内置回落栈） */
  effective: string
  /** 是否落到了内置回落栈（用户填了字体但一个都用不上） */
  fellBack: boolean
}

export type FontDirection = 'latin' | 'cjk'

export function useFontAvailability() {
  /** 把 "PingFang SC, Microsoft YaHei" 拆成 ['PingFang SC', 'Microsoft YaHei'] */
  function splitStack(value: string): string[] {
    return normalizeFontStack(value)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  function inspect(value: string, direction: FontDirection = 'latin'): FontStackReport {
    const own = splitStack(value)
    const entries: FontStackEntry[] = own.map((name) => ({
      name,
      installed: isFontInstalled(name),
    }))

    const fallback = direction === 'cjk' ? CJK_FALLBACK : LATIN_FALLBACK
    let effective = ''
    let fellBack = false

    for (const name of own) {
      if (isFontInstalled(name)) {
        effective = name
        break
      }
    }
    if (!effective) {
      fellBack = own.length > 0
      for (const name of fallback) {
        if (isFontInstalled(name)) {
          effective = name
          break
        }
      }
    }
    if (!effective) effective = direction === 'cjk' ? 'sans-serif' : 'sans-serif'

    return { entries, effective, fellBack }
  }

  return { inspect, isFontInstalled, splitStack }
}
