# ---------- 构建阶段 ----------
FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json

# 根 package.json 挂的 preinstall 守卫（better-sqlite3 的 Node/ABI 检查）。
# pnpm 是否会执行工作区根的 preinstall 取决于版本与配置；一旦执行而文件不存在，
# 安装会以 "Cannot find module '/app/scripts/check-node.mjs'" 直接中断，所以先 COPY 进来。
COPY scripts/check-node.mjs scripts/check-node.mjs

RUN pnpm install --filter "@glimmer/web..." --no-frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG NUXT_PUBLIC_API_BASE=/api
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE

RUN pnpm --filter @glimmer/shared build \
    && pnpm --filter @glimmer/web build

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3001

WORKDIR /app

# Nitro node-server 产物自带完整依赖，无需再装 node_modules
COPY --from=build /app/apps/web/.output ./.output

EXPOSE 3001

CMD ["node", ".output/server/index.mjs"]
