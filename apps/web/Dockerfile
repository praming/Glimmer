# ---------- 构建阶段 ----------
# 与 apps/api、本地 .nvmrc / engines 保持同一大版本（Node 22 = ABI 127）。
# web 自身没有原生依赖，但 @glimmer/shared 是两边共用的，统一版本可避免"本地能跑、镜像不能跑"。
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
# 工作区必须「形状完整」：lockfile 里记录了 apps/api 这个 importer，
# 缺了它的 package.json，pnpm 会认为 lockfile 与工作区不一致而拒绝安装。
# 注意这不等于会装 api 的依赖 —— 下面用 --filter 限定了范围。
COPY apps/api/package.json apps/api/package.json

# 根 package.json 挂的 preinstall 守卫（better-sqlite3 的 Node/ABI 检查）。
# 一旦 pnpm 执行工作区根的 preinstall 而文件不存在，
# 安装会以 "Cannot find module '/app/scripts/check-node.mjs'" 直接中断，所以先 COPY 进来。
COPY scripts/check-node.mjs scripts/check-node.mjs

# 必须带 pnpm-lock.yaml 并加 --frozen-lockfile：不带 lockfile 时 pnpm 会现场解析最新版本，
# 而 .npmrc 指向国内镜像、镜像同步有滞后，就会 ERR_PNPM_FETCH_404
# （实测：没锁版本时解析出 type-fest@5.10.0，镜像上还不存在，构建直接失败）。
RUN pnpm install --filter "@glimmer/web..." --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

# packages/shared 的 tsconfig.json 是 "extends": "../../tsconfig.base.json"。
# 不 COPY 这个文件，extends 会静默失效（只报一句 WARNING），moduleResolution 回落到默认值，
# 编译时连 zod 都解析不到，构建以 TS2792 + ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL 失败。
COPY tsconfig.base.json tsconfig.base.json

ARG NUXT_PUBLIC_API_BASE=/api
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE

RUN pnpm --filter @glimmer/shared build \
    && pnpm --filter @glimmer/web build

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3001

WORKDIR /app

# Nitro node-server 产物自带完整依赖，无需再装 node_modules
COPY --from=build /app/apps/web/.output ./.output

EXPOSE 3001

CMD ["node", ".output/server/index.mjs"]
