# ---------- 构建阶段 ----------
# Node 大版本必须与 apps/api 里原生模块的预编译 ABI 对得上，且与本地 .nvmrc / engines 保持一致。
# Node 22 = ABI 127，better-sqlite3 / sharp / @node-rs/argon2 都有对应预编译包。
#
# 本镜像分三个阶段，目的是**只把运行需要的东西带进最终镜像**：
#   build     完整依赖（含 devDependencies）+ 编译 shared / api
#   prod-deps 只装生产依赖（不带 tsup / typescript / tsx / drizzle-kit / @types）
#   runner    最终镜像 = 基础镜像 + prod-deps 的依赖 + build 的 dist
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

# better-sqlite3 在缺少预编译包时需要 node-gyp
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
# 工作区必须「形状完整」：lockfile 里记录了 apps/web 这个 importer，
# 缺了它的 package.json，pnpm 会认为 lockfile 与工作区不一致而拒绝安装。
# 注意这不等于会装 web 的依赖 —— 下面用 --filter 限定了范围。
COPY apps/web/package.json apps/web/package.json

# 根 package.json 挂的 preinstall 守卫（better-sqlite3 的 Node/ABI 检查）。
# 一旦 pnpm 执行工作区根的 preinstall 而文件不存在，
# 安装会以 "Cannot find module '/app/scripts/check-node.mjs'" 直接中断，所以先 COPY 进来。
COPY scripts/check-node.mjs scripts/check-node.mjs

# 只安装 api 及其依赖（不会拉取 Nuxt 相关依赖）。
# 必须带 pnpm-lock.yaml 并加 --frozen-lockfile：不带 lockfile 时 pnpm 会现场解析最新版本，
# 而 .npmrc 指向国内镜像、镜像同步有滞后，就会 ERR_PNPM_FETCH_404
# （实测：没锁版本时解析出 type-fest@5.10.0，镜像上还不存在，构建直接失败）。
RUN pnpm install --filter "@glimmer/api..." --frozen-lockfile

# 原生模块自检：安装期就把「ABI 不匹配」挡在这里，而不是等容器启动才崩。
# 换基础镜像的 Node 大版本时，node_modules 若被 Docker 缓存复用，就会装成上一个 ABI 的二进制；
# Docker 的缓存键包含父层，改 FROM 本应使其失效，这里再显式兜一道底。
RUN node --input-type=module -e "import { createRequire } from 'node:module'; const r = createRequire('/app/apps/api/package.json'); for (const m of ['better-sqlite3','sharp','@node-rs/argon2']) { r(m); console.log('  native ok:', m); } console.log('native modules OK on ' + process.version + ' (ABI ' + process.versions.modules + ')')"

COPY packages/shared packages/shared
COPY apps/api apps/api

# packages/shared 与 apps/api 的 tsconfig.json 都是 "extends": "../../tsconfig.base.json"。
# 不 COPY 这个文件，extends 会静默失效（只报一句 WARNING），moduleResolution 回落到默认值，
# 编译时连 zod 都解析不到，构建以 TS2792 + ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL 失败。
COPY tsconfig.base.json tsconfig.base.json

RUN pnpm --filter @glimmer/shared build \
    && pnpm --filter @glimmer/api build

# ---------- 生产依赖阶段 ----------
# 单独一层只装运行时需要的依赖。build 阶段那份带着 tsup / typescript / tsx / drizzle-kit /
# @types/* 等纯编译期工具，直接 COPY 进运行镜像会白占几十 MB。
FROM node:22-bookworm-slim AS prod-deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY scripts/check-node.mjs scripts/check-node.mjs

RUN pnpm install --filter "@glimmer/api..." --prod --frozen-lockfile

# 断言 --prod 真的把编译期工具挡在外面了。没有这道检查的话，
# 一旦 pnpm 行为变化，镜像会悄悄胖回去而没人发现。
RUN pkgs=$(ls node_modules/.pnpm) \
    && for bad in tsup typescript tsx drizzle-kit; do \
         if echo "$pkgs" | grep -q "^${bad}@"; then \
           echo "生产依赖里不该出现 ${bad}"; exit 1; \
         fi; \
       done \
    && echo "[glimmer] 已确认生产依赖不含 tsup / typescript / tsx / drizzle-kit"

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 运行期只用 `node` 跑编译产物，npm / corepack 都用不到，删掉能省体积。
# （compose 的 healthcheck 用的是 node 自带的 fetch，不依赖 npm。）
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
             /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

# 依赖：来自只装生产依赖的 prod-deps 阶段
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
# packages/shared 被 tsup 标为 external（见 apps/api/tsup.config.ts），运行时要按包名解析到它的
# dist，所以 package.json（type 与入口）与 dist 都必须在场；src 与它自己的 devDeps 不必带。
COPY --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules

# 编译产物
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# 数据卷挂载点（SQLite + 本地上传目录 + 临时目录）
RUN mkdir -p /data/glimmer/uploads /data/glimmer/tmp

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
