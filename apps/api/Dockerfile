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

# 只安装 api 及其依赖（不会拉取 Nuxt 相关依赖）
RUN pnpm install --filter "@glimmer/api..." --no-frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api

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
