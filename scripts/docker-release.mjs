#!/usr/bin/env node
/**
 * Docker 镜像构建 / 推送脚本（跨平台，Windows / Linux / macOS 通用）。
 *
 * 为什么不直接写 docker compose 命令：
 *  - 推送前要先确认 docker 可用、已登录、标签命名符合 Docker Hub 规范；
 *  - 两个镜像（api / web）要成对打同一版本号，避免手工漏一个；
 *  - 出错时要给出中文可执行建议，而不是甩一堆 docker 原始报错。
 *
 * 用法：
 *   node scripts/docker-release.mjs build              # 构建两个镜像
 *   node scripts/docker-release.mjs push               # 推送到仓库（需先 docker login）
 *   node scripts/docker-release.mjs all                # 构建 + 推送
 *   node scripts/docker-release.mjs tags               # 只打印将要使用的镜像名
 *
 * 环境变量：
 *   IMAGE_PREFIX  镜像名前缀，Docker Hub 推送时应为「用户名/」，例如 praming/
 *   IMAGE_TAG     版本标签，默认 latest；发版建议用 1.0.0 这类语义化版本
 *   PLATFORMS     传给 buildx 的目标平台，默认 linux/amd64
 *
 * 例：
 *   IMAGE_PREFIX=praming/ IMAGE_TAG=1.0.0 node scripts/docker-release.mjs all
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = process.env.IMAGE_PREFIX ?? ''
const TAG = process.env.IMAGE_TAG ?? 'latest'
const PLATFORMS = process.env.PLATFORMS ?? 'linux/amd64'
const COMPOSE_FILE = process.env.COMPOSE_FILE ?? 'docker-compose.yml'

const IMAGES = [`${PREFIX}glimmer-api:${TAG}`, `${PREFIX}glimmer-web:${TAG}`]

const action = process.argv[2] ?? 'help'

function log(message) {
  console.log(`[docker-release] ${message}`)
}

/** 所有子命令统一出口，Windows 下不能直接 spawn .cmd，必须走 shell */
function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
    ...options,
  })
  if (result.error) {
    throw new Error(`无法执行 ${command}：${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${command} 退出码 ${result.status}`)
  }
}

function ensureDocker() {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (probe.error || probe.status !== 0) {
    console.error(
      [
        '',
        '未检测到可用的 Docker。这个脚本必须在**装了 Docker 的机器**上运行。',
        '',
        '  Windows / macOS：安装 Docker Desktop 并启动（Windows 需要 WSL2 后端）',
        '  Linux：curl -fsSL https://get.docker.com | sh && systemctl enable --now docker',
        '',
        '装好后先跑 `docker info` 确认能连上 daemon，再回来执行本脚本。',
        '若本机无法安装，可以改用 GitHub Actions 云端构建：',
        '  .github/workflows/docker-publish.yml（推 tag 即自动构建并推送 Docker Hub）',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  log(`Docker 服务端版本 ${probe.stdout.trim()}`)
}

/** 校验 Docker Hub 镜像名规范：全小写，用户名不能有下划线 */
function validateNames() {
  for (const image of IMAGES) {
    const [name, tag] = image.split(':')
    if (name !== name.toLowerCase()) {
      throw new Error(`镜像名必须全小写：${image}（Docker Hub 不接受大写）`)
    }
    if (!/^[a-z0-9][a-z0-9._/-]*$/.test(name)) {
      throw new Error(`镜像名含非法字符：${image}`)
    }
    if (!/^[\w][\w.-]{0,127}$/.test(tag)) {
      throw new Error(`标签非法：${tag}`)
    }
  }
}

function build() {
  log(`构建镜像（平台 ${PLATFORMS}）…`)
  const isSinglePlatform = PLATFORMS === 'linux/amd64' && process.arch === 'x64'
  if (isSinglePlatform) {
    // 单平台且与宿主一致：直接用 compose 构建，最省事也最快
    run('docker', ['compose', '-f', COMPOSE_FILE, 'build'])
  } else {
    // 跨平台：交给 buildx
    for (const service of ['glimmer-api', 'glimmer-web']) {
      run('docker', [
        'buildx',
        'build',
        '--platform',
        PLATFORMS,
        '--load',
        '-t',
        `${PREFIX}${service.replace('glimmer-', 'glimmer-')}:${TAG}`,
        '-f',
        service === 'glimmer-api' ? 'apps/api/Dockerfile' : 'apps/web/Dockerfile',
        '.',
      ])
    }
  }
  log('构建完成：')
  for (const image of IMAGES) console.log(`  · ${image}`)
}

function push() {
  log('推送到镜像仓库…')
  for (const image of IMAGES) {
    run('docker', ['push', image])
  }
  log('推送完成。')
}

switch (action) {
  case 'tags':
    for (const image of IMAGES) console.log(image)
    break
  case 'build':
    ensureDocker()
    validateNames()
    build()
    break
  case 'push':
    ensureDocker()
    validateNames()
    push()
    break
  case 'all':
    ensureDocker()
    validateNames()
    build()
    push()
    break
  default:
    console.log(
      [
        '用法：node scripts/docker-release.mjs <build|push|all|tags>',
        '',
        '  build  构建 glimmer-api / glimmer-web 两个镜像',
        '  push   推送到 IMAGE_PREFIX 指向的仓库（需先 docker login）',
        '  all    build + push',
        '  tags   只打印镜像名，便于脚本化',
        '',
        '环境变量：IMAGE_PREFIX（如 praming/）、IMAGE_TAG（如 1.0.0）、PLATFORMS',
      ].join('\n'),
    )
}
