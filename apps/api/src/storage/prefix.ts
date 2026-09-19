import { DEFAULT_GLOBAL_SETTINGS, normalizeFilesPathPrefix } from '@glimmer/shared'
import { env } from '../env'

/**
 * 直链路径前缀的默认值。
 *
 * 直接引用全局设置的默认值，避免此处与 shared 各写一份 `'files'` 而悄悄漂移。
 */
export const DEFAULT_FILES_ROUTE_PREFIX = DEFAULT_GLOBAL_SETTINGS.filesPathPrefix

/**
 * 解析出**当前生效**的直链路径前缀（不含首尾斜杠）。
 *
 * ⚠️ 结果为空串表示「直接挂在根路径」，这是合法值而非缺省，调用方必须原样使用，
 * 绝不能用 `|| fallback` 兜底 —— 否则「去掉 /files」会被悄悄还原成默认值。
 *
 * 优先级：**env `FILES_ROUTE_PREFIX` > 后台设置 `filesPathPrefix` > 默认 `files`**
 *
 * env 之所以压过后台设置：前缀同时是 API 静态文件路由的挂载点，api 与 web 两个
 * 容器必须对它有完全一致的认知，交给环境变量可以让部署方一言定死、不依赖数据库
 * 状态（v1.0.2 的「写死默认值」坑就是这么来的）。后台设置则服务于不想动 `.env` 的场景。
 */
export function resolveFilesPrefix(setting?: string | null): string {
  const rawEnv = (env.FILES_ROUTE_PREFIX ?? '').trim()

  // 单个 `/` 是「显式要求根路径」的写法。必须先于归一化判断 ——
  // 归一化会把 `/` 也抹成空串，届时它与「未指定」就再也分不开了。
  if (rawEnv === '/') return ''

  const fromEnv = normalizeFilesPathPrefix(rawEnv)
  if (fromEnv) return fromEnv

  if (setting === undefined || setting === null) return DEFAULT_FILES_ROUTE_PREFIX
  return normalizeFilesPathPrefix(setting)
}

/**
 * 判断一个请求路径是否该交给静态文件路由，是则返回其后的相对路径。
 *
 * 返回 `null` 表示**不由静态文件路由认领**，调用方应继续走其它路由 / 404。
 * 返回空串（空前缀下访问根路径）同样视为不认领。
 *
 * 返回的相对路径**保留后端级 `pathPrefix`**（磁盘布局是 `root/{pathPrefix}/{rel}`），
 * 因此可直接丢给 `path.resolve(root, rel)` 使用。
 */
export function matchFilesPrefix(pathname: string, prefix: string): string | null {
  // /api 全系列永远归 API 自己管（正常流程里它们已被更早注册的路由吃掉，
  // 这里只是防御性兜底：空前缀时中间件会看到所有未匹配路径）。
  if (pathname === '/api' || pathname.startsWith('/api/')) return null

  if (!prefix) {
    // 空前缀 = 挂在根路径。此时只认领「看得出是文件」的路径，
    // 免得把 `/`、`/health` 这类裸路径也当文件去磁盘里找一遍。
    if (pathname === '/') return null
    const rel = pathname.replace(/^\/+/, '')
    return /\.[A-Za-z0-9]{1,8}$/.test(rel) ? rel : null
  }

  if (pathname === `/${prefix}`) return null
  if (!pathname.startsWith(`/${prefix}/`)) return null

  const rel = pathname.slice(prefix.length + 2)
  return rel ? rel : null
}
