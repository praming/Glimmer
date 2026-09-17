/**
 * CLI 入口：仅执行建表与管理员初始化，然后退出。
 * 用法：pnpm --filter @glimmer/api db:migrate
 */
import { bootstrap } from './bootstrap'
import { paths } from '../env'

async function main(): Promise<void> {
  const result = await bootstrap()
  if (result.createdAdmin) {
    // eslint-disable-next-line no-console
    console.log(
      `[glimmer] 数据库初始化完成：${paths.database}\n[glimmer] 已创建管理员账号：${result.adminUsername}`,
    )
  } else {
    // eslint-disable-next-line no-console
    console.log(`[glimmer] 数据库已就绪（无需变更）：${paths.database}`)
  }
  process.exit(0)
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[glimmer] 迁移失败：', error)
  process.exit(1)
})
