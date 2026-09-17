/**
 * 登录限流验证（独立实例，不污染正在运行的生产实例）。
 *
 * 为什么要另起一个实例：限流阈值与窗口必须能在测试里调小（否则要等 15 分钟），
 * 而阈值是启动时读环境变量的。这里用独立端口 + 独立临时库拉起一个 API，
 * 跑完立即杀掉并清理，**不会碰到 data/glimmer.db**。
 *
 * 覆盖点：
 *   1. 账号维度：连续失败达到上限 → 429 + Retry-After + error.code=rate_limited
 *   2. 已封锁时即使密码正确也拒绝（证明限流发生在 Argon2 校验之前）
 *   3. IP 维度：换用户名也照样被拦（防止喷洒/枚举）
 *   4. 窗口到期后自动放行（不需要重启）
 *   5. 登录成功会清空该账号的失败计数，但不清 IP 计数
 *
 * 用法：node scripts/verify-ratelimit.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(API_DIR, 'dist', 'index.js')
const PORT = Number(process.env.RL_TEST_PORT ?? 3211)
const BASE = `http://127.0.0.1:${PORT}`

const ADMIN_USER = 'admin'
const ADMIN_PASS = 'rl-test-password-2026'

/** 故意调成小值，让测试能在几秒内跑完 */
const MAX_PER_ACCOUNT = 3
const MAX_PER_IP = 4
const WINDOW_SECONDS = 4

const WORK_DIR = path.join(API_DIR, 'data', 'ratelimit-test')

let passed = 0
let failed = 0

function check(condition, label, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${extra ? `  → ${extra}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    code: body?.error?.code ?? null,
    message: body?.error?.message ?? null,
  }
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  return false
}

async function main() {
  if (!fs.existsSync(ENTRY)) {
    console.error(`找不到 ${ENTRY}，请先执行 pnpm --filter @glimmer/api build`)
    process.exit(1)
  }

  fs.rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 5 })
  fs.mkdirSync(path.join(WORK_DIR, 'uploads'), { recursive: true })
  fs.mkdirSync(path.join(WORK_DIR, 'tmp'), { recursive: true })

  console.log(`启动独立 API 实例 :${PORT}（账号上限 ${MAX_PER_ACCOUNT} / IP 上限 ${MAX_PER_IP} / 窗口 ${WINDOW_SECONDS}s）\n`)

  const child = spawn(process.execPath, [ENTRY], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: path.join(WORK_DIR, 'glimmer.db'),
      LOCAL_STORAGE_DIR: path.join(WORK_DIR, 'uploads'),
      TEMP_DIR: path.join(WORK_DIR, 'tmp'),
      ADMIN_USERNAME: ADMIN_USER,
      ADMIN_PASSWORD: ADMIN_PASS,
      SESSION_SECRET: 'ratelimit-test-secret-0123456789abcdef',
      ENCRYPTION_KEY: 'ratelimit-test-encryption-0123456789',
      TRUST_PROXY: 'false',
      AUTH_RATE_LIMIT_MAX_PER_ACCOUNT: String(MAX_PER_ACCOUNT),
      AUTH_RATE_LIMIT_MAX_PER_IP: String(MAX_PER_IP),
      AUTH_RATE_LIMIT_WINDOW_SECONDS: String(WINDOW_SECONDS),
      CORS_ORIGIN: 'http://localhost:3001',
      PUBLIC_BASE_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let childLog = ''
  child.stdout.on('data', (chunk) => {
    childLog += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    childLog += chunk.toString()
  })

  const stop = () => {
    if (!child.killed) child.kill('SIGTERM')
  }

  try {
    const ready = await waitForServer()
    if (!ready) throw new Error(`实例未在超时内就绪，输出：\n${childLog}`)

    /* ---------- 1) 账号维度 ---------- */
    console.log('1) 账号维度：连续失败到上限')
    for (let i = 1; i <= MAX_PER_ACCOUNT; i += 1) {
      const res = await login(ADMIN_USER, 'definitely-wrong')
      check(res.status === 401, `第 ${i} 次失败返回 401（未触发限流）`, `实际 ${res.status}`)
    }

    const blocked = await login(ADMIN_USER, 'definitely-wrong')
    check(blocked.status === 429, '达到上限后返回 429', `实际 ${blocked.status}`)
    check(blocked.code === 'rate_limited', '错误码为 rate_limited', String(blocked.code))
    check(
      Number(blocked.retryAfter) > 0 && Number(blocked.retryAfter) <= WINDOW_SECONDS,
      '带 Retry-After 且在窗口内',
      String(blocked.retryAfter),
    )

    /* ---------- 2) 已封锁时正确密码也被拒 ---------- */
    console.log('\n2) 已封锁时即使密码正确也拒绝（限流在校验之前）')
    const correctWhileBlocked = await login(ADMIN_USER, ADMIN_PASS)
    check(correctWhileBlocked.status === 429, '正确密码同样返回 429', `实际 ${correctWhileBlocked.status}`)

    /* ---------- 3) 窗口到期自动放行 ---------- */
    console.log(`\n3) 等待窗口到期（${WINDOW_SECONDS}s + 余量）`)
    await sleep(WINDOW_SECONDS * 1000 + 1200)
    const afterWindow = await login(ADMIN_USER, ADMIN_PASS)
    check(afterWindow.status === 200, '窗口到期后正确密码可登录', `实际 ${afterWindow.status}`)

    /* ---------- 4) 成功登录清空账号维度 ---------- */
    console.log('\n4) 成功登录后账号计数清零（但 IP 计数保留）')
    const afterSuccessWrong = await login(ADMIN_USER, 'wrong-again')
    check(afterSuccessWrong.status === 401, '再次失败只返回 401（说明账号计数已清零）', `实际 ${afterSuccessWrong.status}`)

    /* ---------- 5) IP 维度：换用户名也拦得住 ---------- */
    console.log('\n5) IP 维度：用不同（不存在的）用户名继续试探')
    // 此时 IP 计数已累计：3 次（第 1 步）+ 1 次（已封锁但仍计? 不算）+ 1 次（第 4 步）
    // 不依赖精确值，只验证「继续打会把 IP 维度打满」
    let sawIpBlock = false
    for (let i = 0; i < MAX_PER_IP + 3; i += 1) {
      const res = await login(`ghost-user-${i}`, 'whatever')
      if (res.status === 429) {
        sawIpBlock = true
        check(res.code === 'rate_limited', `第 ${i + 1} 次幽灵用户尝试被限流且码正确`, String(res.code))
        break
      }
    }
    check(sawIpBlock, '不同用户名共享同一 IP 配额（防喷洒/枚举）', '连打后仍未触发 IP 限流')

    const ipBlockedAdmin = await login(ADMIN_USER, ADMIN_PASS)
    check(ipBlockedAdmin.status === 429, 'IP 维度生效时，正确密码也一并被拦', `实际 ${ipBlockedAdmin.status}`)

    /* ---------- 6) 窗口再次到期后恢复 ---------- */
    console.log('\n6) 再等一个窗口，确认能自动恢复（不需要重启进程）')
    await sleep(WINDOW_SECONDS * 1000 + 1200)
    const recovered = await login(ADMIN_USER, ADMIN_PASS)
    check(recovered.status === 200, '窗口过后可正常登录', `实际 ${recovered.status}`)
  } finally {
    stop()
    await sleep(600)
    if (child.exitCode === null) child.kill('SIGKILL')
    try {
      fs.rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 8 })
    } catch (error) {
      console.log(`  （临时目录清理失败：${error.message}）`)
    }
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} 登录限流验证：${passed} 通过 / ${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\n验证脚本异常：${error.message}`)
  process.exit(1)
})
