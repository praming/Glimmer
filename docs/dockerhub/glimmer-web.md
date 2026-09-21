# 浮光 / Glimmer · `glimmer-web`

> 自建图床「浮光」的**前端**镜像：Nuxt 3 单页应用（SPA），同时内置一个**同源反向代理**，把 `/api` 与图片直链转发给后端。
> 它也是部署时**唯一对外暴露端口**的容器 —— 有了它，你**不需要额外安装 Nginx**。

> ## ⚠️ 本镜像不能单独使用
>
> 它只是「页面 + 转发层」，必须有后端配合：
>
> | 镜像 | 职责 | 端口 |
> | --- | --- | --- |
> | `praming/glimmer-web` ← 本镜像 | 前端页面；把 `/api` 与图片直链转发给后端 | `3001`，**唯一对外端口** |
> | [`praming/glimmer-api`](https://hub.docker.com/r/praming/glimmer-api) | API、图片处理、SQLite 数据库 | `3000`，仅容器内网 |
>
> 正确用法是使用仓库里的 `docker-compose.yml` 一起启动（见下）。

## 快速开始

只需要下载**一个文件**，而且**不需要创建 `.env`**：

```bash
mkdir glimmer && cd glimmer
curl -fsSLO https://raw.githubusercontent.com/praming/Glimmer/main/docker-compose.yml
docker compose up -d
```

然后访问 `http://<服务器IP>:3001`，用 `admin` / `change-me` 登录 —— **登录后请立刻改掉密码**。

> 也可以用 git：`git clone https://github.com/praming/Glimmer.git && cd Glimmer && docker compose up -d`

## 镜像内容

| 项目 | 说明 |
| --- | --- |
| 基础镜像 | `node:22-alpine`（运行阶段是纯 JS 产物，无原生模块，所以能用体积更小的 musl 镜像） |
| 入口 | `node .output/server/index.mjs`（Nitro `node-server` 产物，依赖已打包在内） |
| 框架 | Nuxt 3（**SPA 模式**，`ssr: false`）+ Vue 3 + TypeScript |
| UI | Tailwind CSS + shadcn 风格组件 + VueUse；状态管理 Pinia |
| 体积 | 压缩后约 **59 MB**（其中约 53 MB 是 Node 运行时本身） |
| 状态 | **无状态**：不持有数据库、不存文件。数据全在 `glimmer-api` 的数据卷里，本容器可随时删除重建 |

## 端口与反向代理

| 端口 | 说明 |
| --- | --- |
| `3001` | 页面 + `/api` + 图片直链。**唯一对外端口**（`.env` 里 `WEB_PORT` 可改；设成 `80` 就能不带端口号访问） |

本镜像的核心是 [`apps/web/server/middleware/api-proxy.ts`](https://github.com/praming/Glimmer/blob/main/apps/web/server/middleware/api-proxy.ts)：
在生产环境下，凡是 `/api/**`，或者「看起来是文件路径」的请求（末段带图片扩展名，例如 `/files/2026/0919-xxx.webp`、`/img/2026/0919-xxx.webp`、`/2026/0919-xxx.webp`），
都会由本容器转发给 `API_PROXY_TARGET`（默认 `http://glimmer-api:3000`）。于是浏览器只跟一个端口打交道，**不存在跨域问题**，
面板（1Panel / 宝塔）也只需要一条 `/` 反代规则，不必拆分 location。

> 图片直链的路径前缀是**可配置**的（默认 `/files`，可改成 `img`，也可以留空直接挂根路径），
> 本镜像**不感知具体前缀**、按「像不像文件路径」分流 —— 所以你在后台改完前缀后，**不需要重建或重启本镜像**。

⚠️ 转发发生在应用层，因此**不要在它前面再套一层会重复转发的代理**（同一条路径被转发两次会得到 502）。面板反代请用仓库里的 `docker-compose.1panel.yml`（端口绑回环，交给面板）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NITRO_PORT` / `NITRO_HOST` | `3001` / `0.0.0.0` | 监听端口与地址，一般不用改 |
| `API_PROXY_TARGET` | `http://glimmer-api:3000` | 上游 API 地址。**若改了后端容器的名字，必须同步改这里** |
| `NUXT_PUBLIC_API_BASE` | `/api` | 前端请求前缀。这是**构建期参数**（Dockerfile 的 `ARG`），单跑镜像时改它不会生效，需自行 `--build-arg` 重新构建 |
| `NODE_ENV` | `production` | **必须保持 `production`**，否则内置转发中间件不启用（那时本容器只剩静态页面，登录与上传都会失败） |

## 单独运行（仅供调试）

```bash
docker run -d --name glimmer-web -p 3001:3001 \
  -e NODE_ENV=production \
  -e API_PROXY_TARGET=http://<你的后端地址>:3000 \
  praming/glimmer-web:latest
```

⚠️ 没有后端时页面能打开，但登录、上传会失败 —— 转发层会返回一句可读的 502（`upstream_unreachable`，并提示后端不可达），不会给你一个无解的空白页。

## 什么时候才需要 Nginx

**默认不需要。** 只有这三种情况才值得加：

1. 想让服务监听标准的 `80` / `443` 端口；
2. 想用自己的域名 + HTTPS 证书；
3. 想让图片由 Nginx 直接读磁盘返回，不经过 Node 进程（有性能意义，但对小团队基本无感）。

仓库里附带 `nginx.conf`，用 `docker compose --profile nginx up -d` 启用（该服务带 `profiles` 标记，默认既不启动也不拉取）。
⚠️ 代价：图片不再经过 API，**访问统计会缺失**；默认的两个容器形态统计才是完整的。

## 标签与平台

| 标签 | 说明 |
| --- | --- |
| `latest` | 最新发布，对应最近的 `v*` tag |
| `1.0.0` … `1.0.5` | 固定版本；历史版本均保留，可随时回退（GitHub tag `v1.0.5` → 镜像 `1.0.5`） |

- **平台：仅 `linux/amd64`。** 目前没有 arm64 清单，ARM 设备（Apple Silicon、部分 NAS）`docker pull` 会报 `no matching manifest` —— 这类机器请在本地用仓库里的 Dockerfile 自行构建。
- 升级：`docker compose pull && docker compose up -d`。因为本镜像无状态，升级不会碰到你的数据。

## 相关链接

- 源码与完整文档（部署、配置、常见问题）：https://github.com/praming/Glimmer
- 后端镜像：https://hub.docker.com/r/praming/glimmer-api
- 许可证：AGPL-3.0
