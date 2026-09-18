/**
 * 维护命令行：按**当前**配置重建图片直链。
 *
 * ── 为什么需要这个命令 ──────────────────────────────────────────────
 * 直链（`storage_records.url`）是**上传那一刻按当时配置写死的快照**，读取时直接取库值
 * （`services/images.ts`），全项目没有任何重建逻辑。于是只要后来改过对外域名
 * （换域名 / 换 IP / 从无到有补配 `PUBLIC_BASE_URL`），**已经上传的图片全部还是旧地址**，
 * 表现为「复制出去的链接打不开、后台图库也预览不出来」（两者用的是同一份快照）。
 *
 * 本命令按当前配置重算每条记录的直链并写回，**不动磁盘上的文件**，也不重新处理图片。
 * 文件不会因为改地址而移动，所以任何时候改回来都能复原。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 * 容器内（推荐，无需停服 —— SQLite 是 WAL 模式，可与运行中的 API 并存写入）：
 *   # 先预演，看清会发生什么（默认就是预演，不写库）
 *   docker exec glimmer-api node apps/api/dist/cli/rebuild-urls.js
 *   # 确认无误后真正写入
 *   docker exec glimmer-api node apps/api/dist/cli/rebuild-urls.js --apply
 *
 * 本地开发：
 *   pnpm --filter @glimmer/api cli:rebuild-urls --apply
 *
 * ⚠️ 默认只预演。这个开关设计是刻意的：这是一条会批量改数据的命令，宁可多敲一次
 *    `--apply`，也不要让「手滑回车」把几百条记录改掉。
 */
import { sqlite } from '../db'
import { DEFAULT_PUBLIC_BASE_URL, env, paths } from '../env'
import { getGlobalSettings } from '../services/settings'
import { createAdapter } from '../storage'

interface RecordRow {
  id: string
  backend: string
  path: string
  url: string
}

interface PendingChange {
  id: string
  backend: string
  before: string
  after: string
}

function print(line = ''): void {
  // eslint-disable-next-line no-console
  console.log(line)
}

function hasSettingsTable(): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'`)
    .get()
  return Boolean(row)
}

function readArgValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function printUsage(): void {
  print(`
用法：
  node apps/api/dist/cli/rebuild-urls.js [--apply] [--backend <id>] [--limit <条数>]

    （默认）        只预演：列出会被改写的记录与前后对照，不写数据库
    --apply         真正写回数据库（幂等，重复执行不会再有变化）
    --backend <id>  只处理指定后端（默认全部）
    --limit <n>     最多打印多少条对照示例（默认 10；若超过则只显示前 n 条）

说明：
  · 数据库取自环境变量 DATABASE_URL，当前为：${paths.database}
  · 直链按当前配置重算：后端「访问域名」> 后台「自定义域名」> env PUBLIC_BASE_URL
    （本地存储在后两者之下会自动补 /files）
  · 只改数据库里的 URL 字符串，不移动、不重新处理任何图片文件
  · 写回立即生效，不需要重启容器；前台图库需刷新页面才会重新拉取
`)
}

function main(): void {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    return
  }

  if (!hasSettingsTable()) {
    print(`❌ 数据库里还没有 settings 表：${paths.database}`)
    print('   这通常说明 API 还没有成功启动过一次，请先启动 API 再执行本命令。')
    process.exitCode = 1
    return
  }

  const apply = args.includes('--apply')
  const backendFilter = readArgValue(args, '--backend')
  const limit = Number(readArgValue(args, '--limit') ?? 10)

  const settings = getGlobalSettings()
  const backends = settings.backends

  print(`数据库：${paths.database}`)
  print(`后端：${backends.map((b) => `${b.id}(${b.type}${b.enabled ? '' : ',已禁用'})`).join(', ') || '（无）'}`)
  print(
    `基地址优先级：后端「访问域名」 > 后台「自定义域名」(${settings.publicBaseUrl || '空'}) > ` +
      `env (${env.PUBLIC_BASE_URL}${process.env.PUBLIC_BASE_URL ? '' : '，未显式设置 → 用的就是内置默认值'})`,
  )
  print('')

  /*
   * 老库里可能还留着「首次启动时被写死的默认值」（见 db/bootstrap.ts 的迁移说明）。
   * 它会在优先级上压住 env，让本命令看起来「什么都不用改」—— 不说清楚就极难自查，
   * 所以这里显式提示。正常情况下这个值在 API 用新版本启动时已被自动清掉。
   */
  if (settings.publicBaseUrl === DEFAULT_PUBLIC_BASE_URL) {
    print(`⚠️ 后台「自定义域名」当前是 ${DEFAULT_PUBLIC_BASE_URL} —— 这几乎可以肯定是旧版本`)
    print('   首次启动时替你写进去的默认值，不是你自己配的。它优先级高于 env，')
    print('   会压住 PUBLIC_BASE_URL，导致本命令看起来无事可做。两种处理：')
    print('   · 用新版本重启一次 API（v1.0.2 起启动时会自动清掉这个假默认值）—— 推荐；')
    print('   · 或到后台「命名与域名 → 自定义域名」填成你的真实域名。')
    print('')
  }

  const records = sqlite
    .prepare(`SELECT id, backend, path, url FROM storage_records WHERE url IS NOT NULL`)
    .all() as RecordRow[]

  const changes: PendingChange[] = []
  const skipped = new Map<string, number>()
  let unchanged = 0

  for (const record of records) {
    if (backendFilter && record.backend !== backendFilter) continue

    const config = backends.find((b) => b.id === record.backend)
    if (!config) {
      skipped.set('后端配置已不存在', (skipped.get('后端配置已不存在') ?? 0) + 1)
      continue
    }

    let after: string
    try {
      // 用真实适配器算，而不是在这里重写一遍拼接规则 ——
      // 「同一件事两处实现」正是直链出错的老根源（见 storage/local.ts 的注释）。
      after = createAdapter(config, settings.publicBaseUrl).getUrl(record.path)
    } catch (error) {
      const key = `无法构建适配器（${(error as Error).message}）`
      skipped.set(key, (skipped.get(key) ?? 0) + 1)
      continue
    }

    if (after === record.url) {
      unchanged++
      continue
    }
    changes.push({ id: record.id, backend: record.backend, before: record.url, after })
  }

  print(`扫描记录 ${records.length} 条${backendFilter ? `（已按后端 ${backendFilter} 过滤）` : ''}：`)
  print(`  · 无需改动  ${unchanged}`)
  print(`  · 待改写    ${changes.length}`)
  for (const [reason, count] of skipped) print(`  · 跳过      ${count}（${reason}）`)
  print('')

  if (changes.length > 0) {
    print(`待改写的记录${apply ? '' : '（预演，未写入）'}：`)
    for (const c of changes.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10)) {
      print(`  [${c.backend}] ${c.before}`)
      print(`        → ${c.after}`)
    }
    if (changes.length > limit) print(`  … 另有 ${changes.length - limit} 条，加 --limit 可调显示条数`)
    print('')
  }

  if (!apply) {
    print(
      changes.length > 0
        ? '以上是**预演**，数据库未做任何修改。确认无误后加 --apply 重跑：'
        : '所有直链都与当前配置一致，无需改动。',
    )
    if (changes.length > 0) {
      print('  node apps/api/dist/cli/rebuild-urls.js --apply')
      print('')
      print('建议先备份：数据库里的 URL 是唯一记录（文件本身不受影响），改错了只能靠备份或再改配置改回来。')
    }
    return
  }

  if (changes.length === 0) {
    print('没有需要改写的记录。')
    return
  }

  const statement = sqlite.prepare(`UPDATE storage_records SET url = ? WHERE id = ?`)
  sqlite.transaction(() => {
    for (const c of changes) statement.run(c.after, c.id)
  })()

  print(`✅ 已改写 ${changes.length} 条记录的直链，立即生效（无需重启容器）。`)
  print('   前台图库若仍显示旧图片，强制刷新页面即可（列表数据在前端有缓存）。')
}

try {
  main()
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('[glimmer] 重建直链失败：', error)
  process.exitCode = 1
} finally {
  // WAL 模式下显式关库，让 -wal / -shm 正常回收
  sqlite.close()
}
