import { serve } from '@hono/node-server'
import { createApp } from './app'
import { bootstrap } from './db/bootstrap'
import { env, paths, warnWeakSecrets } from './env'
import { purgeExpiredSessions } from './lib/session'
import { stopAccessRecorder } from './services/access'
import { getQueueStats, enqueueImageProcessing, recoverPendingImages } from './services/queue'
import { startRetryScheduler, stopRetryScheduler } from './services/retry'
import { getGlobalSettings, invalidateSettingsCache } from './services/settings'
import { invalidateAdapterCache } from './storage'

/**
 * 过期会话清扫周期。
 *
 * 启动时 `bootstrap()` 已经清过一遍（见 db/bootstrap.ts 的一次性 DELETE），
 * 以及「有人拿着过期 token 来请求」时 `resolveSession` 会顺手删掉那一行。
 * 缺的是**长跑进程**的窗口：一个连续运行数周的实例，过期行只能靠别人再拿旧
 * token 来请求才会消失。这里按 6 小时补一次定期清扫。
 */
const SESSION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

async function main(): Promise<void> {
  warnWeakSecrets()

  const result = await bootstrap()
  invalidateSettingsCache()
  invalidateAdapterCache()

  const sessionSweeper = setInterval(purgeExpiredSessions, SESSION_SWEEP_INTERVAL_MS)
  // 不因这个定时器阻止进程退出
  sessionSweeper.unref()

  // 预热设置与适配器（同时暴露配置错误）
  const settings = getGlobalSettings()

  const app = createApp()

  // 恢复上次未完成的任务（进程重启场景）
  const restored = recoverPendingImages()

  // P3-4：启动失败任务自动重试调度器（指数退避，见 services/retry.ts）
  startRetryScheduler((imageId, priority) => {
    enqueueImageProcessing(imageId, priority ?? 0)
  })

  const server = serve(
    { fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' },
    (info) => {
      const lines = [
        `浮光 Glimmer API 已启动 http://0.0.0.0:${info.port}`,
        `  运行环境   ${env.NODE_ENV}`,
        `  数据库     ${paths.database}`,
        `  本地存储   ${paths.uploads}`,
        `  临时目录   ${paths.temp}`,
        `  对外地址   ${env.PUBLIC_BASE_URL}`,
        `  存储后端   ${settings.backends.map((b) => `${b.name}(${b.type}${b.enabled ? '' : ',已禁用'})`).join('、') || '无'}`,
        `  默认格式   ${settings.processing.outputFormats.join(' / ')}${settings.processing.keepOriginal ? ' + 原图' : ''}`,
        `  队列并发   ${env.QUEUE_CONCURRENCY}`,
      ]
      if (result.createdAdmin) {
        lines.push(`  已创建管理员账号：${result.adminUsername}（请尽快修改密码）`)
      }
      if (result.ignoredAdminPassword) {
        // 这条提示专治「改了 .env 里的密码却怎么都登不上」：ADMIN_PASSWORD 只在空库
        // 首次启动时生效，账号已存在时它被静默忽略。把届时的处置方式直接写进日志，
        // 用户 `docker compose logs` 就能看到，不必去翻文档。
        lines.push(
          `  ⚠️ 已忽略 ADMIN_PASSWORD：管理员账号已存在，该变量只在数据库为空时生效`,
          `     忘记密码请执行：docker exec glimmer-api node apps/api/dist/cli/reset-password.js --list`,
        )
      }
      if (restored > 0) {
        lines.push(`  已恢复 ${restored} 个未完成的处理任务`)
      }
      // eslint-disable-next-line no-console
      console.log(`\n${lines.join('\n')}\n`)
      // eslint-disable-next-line no-console
      console.log(`[glimmer] 队列状态 ${JSON.stringify(getQueueStats())}`)
    },
  )

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`\n[glimmer] 收到 ${signal}，正在关闭…`)
    // 停掉调度器，并把内存中未落盘的访问统计刷进库
    stopRetryScheduler()
    stopAccessRecorder()
    server.close(() => process.exit(0))
    // 兜底：5 秒内未退出则强制结束
    setTimeout(() => process.exit(0), 5000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[glimmer] 启动失败：', error)
  process.exit(1)
})
