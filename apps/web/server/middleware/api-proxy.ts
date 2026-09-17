/**
 * 生产环境同源反向代理（Nitro server middleware）
 * ============================================================================
 * 为什么需要它：
 *   前端是 SPA，`NUXT_PUBLIC_API_BASE=/api` 是**同源相对路径**，浏览器会把
 *   `/api/**` 与 `/files/**` 打到当前站点的同一端口上。而 Nitro 只提供前端资源，
 *   本身不含后端路由 —— 所以这两类请求必须由某一层转发给 API（容器内 :3000）。
 *
 *   有了这个中间件，`glimmer-web` 自己就能承担转发职责，于是：
 *     · 默认部署只需要 **两个容器**，对外只暴露 **一个端口**，无需额外的 Nginx；
 *     · 面板（1Panel / 宝塔）反代时也只需一条 `/` 规则，不必再分裂 location。
 *
 *   若前面还有一层 Nginx（`docker compose --profile nginx`）并已自行把 `/api`
 *   直连 API，则请求根本到不了这里，中间件自然不参与，不会发生双重代理。
 *
 * 开发环境不启用：`nuxt dev` 由 nuxt.config.ts 的 `nitro.devProxy` 转发，
 *   两处同时生效会变成双重代理。
 * ============================================================================
 */

/** 上游 API 地址。编排里固定为服务名 `glimmer-api`，可用 API_PROXY_TARGET 覆盖。 */
const TARGET = (process.env.API_PROXY_TARGET || 'http://glimmer-api:3000').replace(/\/+$/, '')

/** 仅生产构建启用（见文件头说明） */
const ENABLED = process.env.NODE_ENV === 'production'

/** 需要转发的路径前缀 */
const PREFIXES = ['/api', '/files']

function shouldProxy(pathname: string): boolean {
  return PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default defineEventHandler((event) => {
  if (!ENABLED) return

  // 用原始 req.url 取路径，避免任何 URL 归一化带来的歧义
  const rawUrl = event.node.req.url || '/'
  const queryIndex = rawUrl.indexOf('?')
  const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex)

  if (!shouldProxy(pathname)) return

  const reqHeaders = event.node.req.headers

  // 真实客户端 IP：沿用上游代理已写入的 XFF 链，再追加本层看到的 TCP 地址。
  // API 侧 TRUST_PROXY=true 时取 XFF 首项，所以链首必须是最初的客户端 —— 这直接
  // 决定登录限流的 IP 维度是否准确（若丢失，所有请求都会算作同一个 IP）。
  //
  // `encrypted` 只有 TLS 连接（TLSSocket）才有，Node 的 Socket 类型上不存在，
  // 因此这里做一次窄化断言。
  const socket = event.node.req.socket as
    | (typeof event.node.req.socket & { encrypted?: boolean })
    | undefined

  const socketIp = socket?.remoteAddress || '127.0.0.1'
  const incomingXff = firstValue(reqHeaders['x-forwarded-for'])
  const xff = incomingXff ? `${incomingXff}, ${socketIp}` : socketIp

  const proto = firstValue(reqHeaders['x-forwarded-proto']) || (socket?.encrypted ? 'https' : 'http')

  return proxyRequest(event, TARGET + rawUrl, {
    headers: {
      'x-forwarded-for': xff,
      'x-forwarded-proto': proto,
      'x-forwarded-host': firstValue(reqHeaders['host']) || '',
    },
  }).catch(() => {
    // 上游不可达时给出可读的提示，而不是让用户面对一个无解的裸 502
    const res = event.node.res
    if (!res.headersSent && !res.writableEnded) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
    }
    return {
      error: {
        code: 'upstream_unreachable',
        message: `后端 API 不可达（${TARGET}）。请确认 glimmer-api 容器已启动并与本容器处于同一网络。`,
      },
    }
  })
})
