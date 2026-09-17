# ---------- 构建阶段 ----------
FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

# better-sqlite3 在缺少预编译包时需要 node-gyp
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json

# 根 package.json 挂的 preinstall 守卫（better-sqlite3 的 Node/ABI 检查）。
# pnpm 是否会执行工作区根的 preinstall 取决于版本与配置；一旦执行而文件不存在，
# 安装会以 "Cannot find module '/app/scripts/check-node.mjs'" 直接中断，所以先 COPY 进来。
COPY scripts/check-node.mjs scripts/check-node.mjs

# 只安装 api 及其依赖（不会拉取 Nuxt 相关依赖）
RUN pnpm install --filter "@glimmer/api..." --no-frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

# packages/shared 与 apps/api 的 tsconfig.json 都是 "extends": "../../tsconfig.base.json"。
# 不 COPY 这个文件，extends 会静默失效（只报一句 WARNING），moduleResolution 回落到默认值，
# 编译时连 zod 都解析不到，构建以 TS2792 + ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL 失败。
COPY tsconfig.base.json tsconfig.base.json

RUN pnpm --filter @glimmer/shared build \
    && pnpm --filter @glimmer/api build

# ---------- 运行阶段 ----------
FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api

# 数据卷挂载点（SQLite + 本地上传目录 + 临时目录）
RUN mkdir -p /data/glimmer/uploads /data/glimmer/tmp

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
