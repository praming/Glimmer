/**
 * 极简 .env 加载器（仅供 `apps/api/scripts/` 下的验证脚本使用）。
 *
 * 为什么要它：这些脚本需要管理员账号，但**不能把口令硬编码进源码** ——
 * 否则仓库一旦公开，默认口令就跟着一起公开了（这正是本项目修过的一个真实问题）。
 *
 * 行为：
 *   - 读取 `<仓库根>/.env`，把键值写入 `process.env`；
 *   - **已存在的环境变量优先**（不覆盖），因此在 CI / 容器里用 env 传参依然生效；
 *   - 路径基于 `import.meta.url` 解析，**与执行时的 cwd 无关**。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录（本文件位于 `<root>/apps/api/scripts/`） */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** `apps/api` 包目录 —— 脚本里的 `data/...` 都是相对它而言的 */
export const API_DIR = path.join(REPO_ROOT, 'apps/api')

/**
 * 把仓库根目录的 `.env` 载入 `process.env`（不覆盖已有变量）。
 * @returns {boolean} 是否成功读到 `.env`
 */
export function loadDotEnv() {
  const file = path.join(REPO_ROOT, '.env')
  if (!fs.existsSync(file)) return false

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)

    if (!(key in process.env)) process.env[key] = value
  }
  return true
}

/** 解析管理员凭据：脚本专用变量 → `.env` 的 ADMIN_* → 兜底默认值 */
export function adminCredentials({ userVar, passVar } = {}) {
  return {
    username: process.env[userVar] ?? process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env[passVar] ?? process.env.ADMIN_PASSWORD ?? 'change-me',
  }
}
