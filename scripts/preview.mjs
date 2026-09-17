#!/usr/bin/env node
/**
 * 本地「生产构建」预览器 —— 无需 Docker / Nginx。
 *
 * 背景：Nuxt 的 `nitro.devProxy` 只在 `nuxt dev` 时生效，生产环境由 Nginx 同源代理
 * `/api` 与 `/files`。因此直接用 `node apps/web/.output/server/index.mjs` 跑构建产物时，
 * 前端能加载但任何接口调用都会 404。本脚本补上这一层：
 *
 *   :4000  预览入口（同源）──────┬─► /api/*   、/files/*  ──► Hono API :3000
 *                              └─► 其余全部             ──► Nuxt nitro :3100（build 产物）
 *
 * 用法（须先构建 shared / api / web，并已执行 db:migrate）：
 *   node scripts/preview.mjs
 * 或：
 *   pnpm preview
 *
 * 环境变量：PREVIEW_PORT(4000) / NITRO_PORT(3100) / API_PORT(3000) / PREVIEW_HOST(127.0.0.1)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nitroEntry = path.join(root, 'apps', 'web', '.output', 'server', 'index.mjs')

const HOST = process.env.PREVIEW_HOST || '127.0.0.1'
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 4000)
const NITRO_PORT = Number(process.env.NITRO_PORT || 3100)
const API_PORT = Number(process.env.API_PORT || 3000)

if (!fs.existsSync(nitroEntry)) {
  console.error(`[preview] 未找到 Web 构建产物：${nitroEntry}`)
  console.error('[preview] 请先执行：pnpm --filter @glimmer/web build')
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* 1) 拉起 Nuxt nitro（构建产物自带的 node-server）                      */
/* ------------------------------------------------------------------ */

const nitro = spawn(process.execPath, [nitroEntry], {
  cwd: path.join(root, 'apps', 'web'),
  env: { ...process.env, PORT: String(NITRO_PORT), HOST },
  stdio: ['ignore', 'pipe', 'pipe'],
})
nitro.stdout.on('data', (b) => process.stdout.write(`[nitro] ${b}`))
nitro.stderr.on('data', (b) => process.stderr.write(`[nitro] ${b}`))
nitro.on('exit', (code) => {
  console.error(`[preview] nitro 退出，code=${code}`)
  process.exit(code ?? 1)
})

/** 轮询等待上游就绪，避免首个请求打到未监听的端口 */
function waitFor(port, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', onErr)
      req.on('timeout', () => req.destroy(new Error('timeout')))
      function onErr() {
        if (Date.now() > deadline) return reject(new Error(`${label} 在 ${timeoutMs}ms 内未就绪`))
        setTimeout(tick, 250)
      }
    }
    tick()
  })
}

/* ------------------------------------------------------------------ */
/* 2) 极简反向代理（支持请求体流式透传，故 multipart 上传可用）            */
/* ------------------------------------------------------------------ */

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'])

function proxy(req, res, port, label) {
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
  }
  // 让上游看到正确的 Host，避免基于 Host 的同源/Cookie 判断出错
  headers.host = `127.0.0.1:${port}`

  const up = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers },
    (upRes) => {
      const outHeaders = {}
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v
      }
      res.writeHead(upRes.statusCode || 502, outHeaders)
      upRes.pipe(res)
    },
  )
  up.on('error', (err) => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: true, message: `${label} 不可达: ${err.message}` }))
  })
  req.pipe(up)
}

/* ------------------------------------------------------------------ */
/* 3) 入口                                                             */
/* ------------------------------------------------------------------ */

try {
  await waitFor(API_PORT, 'API', 3000)
} catch {
  console.warn(`[preview] 警告：API :${API_PORT} 未就绪，接口请求会返回 502。`)
  console.warn('[preview]        请另开终端执行：pnpm db:migrate && pnpm start:api')
}

await waitFor(NITRO_PORT, 'nitro')

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api') || url.startsWith('/files')) {
    return proxy(req, res, API_PORT, 'API')
  }
  return proxy(req, res, NITRO_PORT, 'nitro')
})

server.listen(PREVIEW_PORT, HOST, () => {
  console.log('')
  console.log(`  ➜  本地预览:  http://${HOST}:${PREVIEW_PORT}/`)
  console.log(`      入口 :${PREVIEW_PORT}   API :${API_PORT}   nitro :${NITRO_PORT}`)
  console.log('      默认管理员：admin / 取自 .env 的 ADMIN_PASSWORD')
  console.log('')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close()
    nitro.kill()
    process.exit(0)
  })
}
