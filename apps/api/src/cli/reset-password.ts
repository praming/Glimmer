/**
 * 维护命令行：列出账号 / 重置登录密码。
 *
 * ── 为什么需要这个命令 ──────────────────────────────────────────────
 * `ADMIN_USERNAME` / `ADMIN_PASSWORD` 只在**数据库为空的那一次启动**里用于创建
 * 管理员（见 `db/bootstrap.ts` 的 `if (userCount.n === 0)`）。账号一旦建好，
 * 密码哈希就已经落库，之后无论怎么改这两个环境变量都不会生效——这正是
 * 「我在 .env 里写了新密码，怎么还提示用户名或密码不正确」的根因。
 *
 * 在此之前项目**没有任何找回密码的通道**，只能删库重来。本命令补上这个缺口。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 * 容器内（推荐，无需停服——SQLite 是 WAL 模式，可与运行中的 API 并存写入）：
 *   docker exec glimmer-api node apps/api/dist/cli/reset-password.js --list
 *   docker exec glimmer-api node apps/api/dist/cli/reset-password.js admin '新密码'
 *   # 账号被禁用时顺带启用：
 *   docker exec glimmer-api node apps/api/dist/cli/reset-password.js admin '新密码' --enable
 *
 * 本地开发：
 *   pnpm --filter @glimmer/api cli:reset-password admin '新密码'
 */
import { passwordSchema } from '@glimmer/shared'
import { sqlite } from '../db'
import { paths } from '../env'
import { hashPassword } from '../lib/crypto'
import { revokeUserSessions } from '../lib/session'
import { revokeUserTokens } from '../lib/tokens'

interface UserRow {
  id: string
  username: string
  role: string
  disabled: number
  created_at: string
}

function print(line = ''): void {
  // eslint-disable-next-line no-console
  console.log(line)
}

function hasUsersTable(): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get()
  return Boolean(row)
}

function listUsers(): UserRow[] {
  return sqlite
    .prepare(`SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at`)
    .all() as UserRow[]
}

function printUsers(): void {
  const users = listUsers()
  if (users.length === 0) {
    print('当前数据库还没有任何账号——启动一次 API 即会用 ADMIN_USERNAME / ADMIN_PASSWORD 创建管理员。')
    return
  }
  print('数据库中的账号：')
  for (const u of users) {
    print(`  - ${u.username.padEnd(20)} ${u.role.padEnd(8)} ${u.disabled ? '已禁用' : '正常'}  创建于 ${u.created_at}`)
  }
}

function printUsage(): void {
  print(`
用法：
  node apps/api/dist/cli/reset-password.js --list
      列出数据库里的全部账号（不修改任何数据）

  node apps/api/dist/cli/reset-password.js <用户名> <新密码> [--enable]
      重置指定账号的密码，并撤销该账号的全部登录会话与 API 令牌
      --enable  顺带解除「已禁用」状态

说明：
  · 数据库取自环境变量 DATABASE_URL，当前为：${paths.database}
  · 密码规则与界面一致：8 ~ 128 个字符
  · 重置后立即生效，不需要重启容器
`)
}

async function resetPassword(username: string, newPassword: string, enable: boolean): Promise<void> {
  const parsed = passwordSchema.safeParse(newPassword)
  if (!parsed.success) {
    print(`❌ ${parsed.error.issues[0]?.message ?? '密码不符合要求'}`)
    process.exitCode = 1
    return
  }

  const target = sqlite
    .prepare(`SELECT id, username, disabled FROM users WHERE username = ?`)
    .get(username) as { id: string; username: string; disabled: number } | undefined

  if (!target) {
    print(`❌ 找不到用户「${username}」。`)
    print('')
    printUsers()
    process.exitCode = 1
    return
  }

  const passwordHash = await hashPassword(parsed.data)
  sqlite
    .prepare(`UPDATE users SET password_hash = ?, disabled = ?, updated_at = ? WHERE id = ?`)
    .run(passwordHash, enable ? 0 : target.disabled, new Date().toISOString(), target.id)

  // 与「界面改密」保持同一套语义：旧密码一旦作废，对方手里可能还攥着的旧会话与
  // 令牌必须一并撤销，否则重置密码挡不住已经拿到凭据的人。
  revokeUserSessions(target.id)
  const revokedTokens = revokeUserTokens(target.id)

  print(`✅ 已重置「${target.username}」的密码。`)
  print(
    `   已撤销该账号的全部登录会话${revokedTokens > 0 ? `，并撤销 ${revokedTokens} 个 API 令牌` : ''}。`,
  )
  if (enable && target.disabled) print('   该账号的「已禁用」状态已解除。')
  if (!enable && target.disabled) {
    print('   ⚠️ 该账号当前是「已禁用」状态，重置密码后依然登不上：加 --enable 参数重跑本命令即可。')
  }
  print('   新密码立即生效，无需重启容器。')
}

async function main(): Promise<void> {
  const [first, second, ...rest] = process.argv.slice(2)

  if (!hasUsersTable()) {
    print(`❌ 数据库里还没有 users 表：${paths.database}`)
    print('   这通常说明 API 还没有成功启动过一次，请先启动 API 再执行本命令。')
    process.exitCode = 1
    return
  }

  if (!first || ['--list', '-l', '--help', '-h'].includes(first)) {
    printUsage()
    printUsers()
    return
  }

  if (!second) {
    print('❌ 缺少新密码参数。')
    printUsage()
    process.exitCode = 1
    return
  }

  await resetPassword(first, second, rest.includes('--enable'))
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[glimmer] 重置失败：', error)
    process.exitCode = 1
  })
  .finally(() => {
    // WAL 模式下显式关库，让 -wal / -shm 正常回收
    sqlite.close()
  })
