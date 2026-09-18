# 浮光 / Glimmer

> Glimmer — 一个轻量、自建、够用的图床。

浮光是一套**自建图床**：上传图片 → 自动压缩与格式转换 → 并行写入一个或多个存储后端 → 一键复制各种格式的链接 → 在图库中统一管理。

它不开放注册，账号由管理员创建，适合**个人或 2~3 人的小团队**部署在自己的 VPS 上。整套服务只依赖一个 SQLite 文件与本地磁盘，**不需要 Redis、不需要消息队列、不需要任何额外中间件**。

---

## 目录

- [特性](#特性)
- [技术栈](#技术栈)
- [部署](#部署)
- [开发与自建镜像](#开发与自建镜像)
- [配置](#配置)
- [部署要点](#部署要点)
- [API](#api)
- [常见问题](#常见问题)
- [项目结构](#项目结构)
- [License](#license)

---

## 特性

**存储**

- **三种后端，可并行写入**：本地磁盘、S3 兼容对象存储（AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS）、标准 WebDAV（Nextcloud、坚果云等）。
- 一次上传可同时写多个后端，**单个后端失败不会阻塞其他后端**；每个后端独立记录 `pending / ready / failed` 与失败原因，可单独重试。
- 重命名会逐后端执行「读回 → 写新路径 → 删除旧对象」，保证多后端内容一致；删除同理，未能清理的残留会以警告形式回传。

**图片处理**

- 基于 `sharp` 的异步流水线：自动旋转 → 限制最大宽高（不放大）→ 剥离 EXIF → 按目标格式编码。
- 输出格式支持 `webp / avif / jpeg / png / gif`，一次可生成多种；多帧 GIF 在输出 GIF / WebP 时保留动画。
- 上传立即返回 `202`，处理在后台队列完成，前端实时显示每个文件的进度与结果。

**上传体验**

- 点击选择、拖拽（整页投放区）、`Ctrl/⌘ + V` 粘贴，支持多文件队列。
- **秒传去重**：浏览器用 WebCrypto 先算原图 SHA-256 做预检，命中则直接复用已有结果，跳过整段文件传输。
- 四种链接一键复制：**直链 / Markdown / HTML / BBCode**。
- 可自定义命名模板（如 `{date}/{random}-{origin}`），支持按后端配置不同的路径前缀。

**管理与安全**

- 图库：网格 / 列表切换、搜索、按格式·后端·上传者·状态·日期筛选、排序、批量删除、详情抽屉。
- 关闭公开注册，账号由管理员创建；密码以 **Argon2id** 哈希存储，会话使用 `httpOnly` + `SameSite=Lax` Cookie。
- **登录限流防爆破**：按来源 IP 与按账号两个维度，**只统计失败次数**（正常登录不消耗额度）；超限返回 `429` + `Retry-After`，且**在密码校验之前**就拒绝，避免攻击者借慢哈希打满 CPU。
- **API Token**：`Authorization: Bearer glm_…`，给脚本与 CI 使用，可随时撤销；改密会自动级联撤销名下全部令牌。
- **访问统计**：直链访问次数、出口流量、Top 热门图、按天趋势（详见 [部署要点](#部署要点) 中的统计口径说明）。
- **失败自动重试**：按 `30s → 2m → 8m → 32m` 指数退避，最多 4 次；排期写入数据库，**重启进程不会丢任务**。

**界面**

- 响应式：桌面左侧固定导航（图库 3~5 列）→ 平板折叠 → 手机底部 Tab 导航（2 列）。
- 浅色为主，可切换深色或跟随系统；中文字体与英文/数字字体可分别指定。

---

## 技术栈

| 层级     | 技术                                            |
| -------- | ----------------------------------------------- |
| 后端     | Hono + `@hono/node-server` + TypeScript         |
| 前端     | Nuxt 3（SPA 模式）+ Vue 3 + TypeScript          |
| UI       | Tailwind CSS + shadcn 风格组件 + VueUse          |
| 状态管理 | Pinia                                           |
| 数据库   | SQLite + Drizzle ORM + better-sqlite3           |
| 图片处理 | sharp                                           |
| 异步队列 | p-queue（进程内，无 Redis）                      |
| 认证     | Cookie 会话（httpOnly）+ Argon2id + Bearer 令牌   |
| 参数校验 | Zod                                             |
| 部署     | Docker Compose（两个容器，可选 Nginx），或纯 Node 进程 |

包名：`@glimmer/api` / `@glimmer/web` / `@glimmer/shared`（pnpm workspace monorepo）。

---

## 部署

> 这一节是写给「只想把它跑起来」的使用者的，每一步都可以直接复制执行，不需要 Docker 基础。
> 想二次开发请跳到 [本地开发](#本地开发)。

### 0. 准备一台机器

VPS、NAS、迷你主机、家里的旧电脑都行，**1 核 1G 内存起步就够** —— 这个项目平时几乎不占资源，
只在处理图片时吃一点 CPU。

先确认是否已装 Docker：

```bash
docker version           # 有 Client 和 Server 两段输出才算装好
docker compose version   # 需要 v2.x，Docker 官方安装包自带
```

两条命令任意一条报 `command not found`，就执行官方安装脚本：

```bash
curl -fsSL https://get.docker.com | sh
```

> **NAS 用户**：群晖在「套件中心」装 **Container Manager**，威联通装 **Container Station**，
> Unraid / 极空间 / 绿联等一般已内置。它们都带 Docker Compose，下面的命令在 NAS 的「终端」或 SSH 里执行
> （也可以把 `docker-compose.yml` 内容粘贴进面板的「编排 / Compose」界面）。

### 1. 下载部署文件

**只需要一个文件**：`docker-compose.yml`。不需要创建 `.env` —— 所有配置都有可用默认值。

**有 git：**

```bash
git clone https://github.com/praming/Glimmer.git
cd Glimmer
```

**没有 git** —— 直接下这一个文件就行，不必克隆整个仓库：

```bash
mkdir glimmer && cd glimmer
curl -fsSLO https://raw.githubusercontent.com/praming/Glimmer/main/docker-compose.yml
```

> 只有想改默认值（端口、域名等）时才需要 `.env`，见 [第 4 步](#4-可选自定义配置)。

### 2. 启动

```bash
docker compose up -d
```

就这一条，**不需要先做任何配置**。看到 `Started` 就成功了。

首次启动会自动完成三件事：

| 事项         | 说明                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| 拉取镜像     | 优先从 Docker Hub 拉官方镜像；拉不到（离线 / 镜像缺失）自动回退为本地构建 |
| 生成加密密钥 | 自动生成并保存到数据目录的 `.secrets.json`                               |
| 创建管理员   | 账号 `admin`、密码 `change-me` —— **登录后请立刻改掉**                   |

> ⚠️ `.secrets.json` 用来解密你在后台填写的 S3 / WebDAV 凭据。它就在 `glimmer-data/` 里，
> **备份数据目录时请一并带上**；删掉它，那些凭据就再也解不回来。
> 想自己管理密钥（例如多台机器共用一份数据），在 `.env` 里显式设置 `ENCRYPTION_KEY` 即可，它优先级更高。
>
> 本编排把 `.env` 声明为**可选文件**（`env_file` 长语法），需要 **Docker Compose ≥ 2.24**
> （`docker compose version` 可查）。更老的版本会报解析错误，升级 compose 即可。

> 想**强制**用本地源码构建（例如自行改过代码），加上 `--build`：`docker compose up -d --build`。
> 首次构建会在容器内编译原生模块，视机器性能约 **3–10 分钟**（NAS 上更久），期间没有任何输出是正常的。

看看跑起来没有：

```bash
docker compose ps        # glimmer-api 与 glimmer-web 都应是 running（api 显示 healthy 更好）
docker compose logs -f   # 跟踪日志；按 Ctrl+C 退出，不会停服务
```

### 3. 打开浏览器

访问 `http://你的服务器IP:3001`，用 **`admin` / `change-me`** 登录
（若在 `.env` 里把 `WEB_PORT` 改成了 `80`，则直接访问 `http://你的服务器IP`）。

> 如果你启动前就建过 `.env` 并填了 `ADMIN_PASSWORD`，请用**你填的那个**密码 ——
> `change-me` 只在没配置过时才是默认值。两个都试过仍登不上，见
> 「常见问题 → 登录提示「用户名或密码不正确」，或忘记管理员密码了」，
> 那里有一条命令可以**直接重置**，不必删库。

登进去后建议顺手做三件事：

1. 到**「个人资料」把密码改掉** —— `ADMIN_PASSWORD` 只在**首次初始化**时生效，之后改 `.env` 不会同步；
2. 到**「设置 → 存储后端」**确认默认的本地存储可用；需要接 S3 / WebDAV 也在这里配；
3. 到**「设置 → 命名与域名」**把直链域名核成你的实际地址（它决定复制出来的图片链接长什么样）。

### 4. （可选）自定义配置

想改端口、域名这些，再建一个 `.env`（可以只写你要覆盖的那几行）：

```bash
curl -fsSL https://raw.githubusercontent.com/praming/Glimmer/main/.env.example -o .env.example
cp .env.example .env
```

改完执行 `docker compose up -d` 重启生效。**最常改的几项**：

| 变量              | 改成                       | 不改会怎样                                          |
| ----------------- | -------------------------- | --------------------------------------------------- |
| `ADMIN_PASSWORD`  | 你自己的登录密码            | 默认 `change-me`，**谁都能登进来**                   |
| `PUBLIC_BASE_URL` | `http://你的服务器IP:3001`  | 复制出去的图片直链**别人打不开**                     |
| `COOKIE_SECURE`   | 用 `http://` 访问就填 `false` | **密码明明对，却一直登录不上**（登录 Cookie 被浏览器丢弃） |
| `WEB_PORT`        | 想直接 `http://IP` 访问就填 `80` | 默认 3001，网址要带端口号                       |

完整清单见 [配置](#配置)。

> ⚠️ `ADMIN_PASSWORD` **只在 `users` 表为空的那一次启动**里用于创建管理员。账号一旦创建，
> 密码哈希就已落库，之后再改 `.env` 不会被采纳（启动日志里会明确打印「已忽略 ADMIN_PASSWORD」）。
> 所以：「先 `up -d` 看了一眼，才想起去建 `.env`」这种顺序，密码是不会生效的。
>
> 日常改密码：登录后到**「个人资料」**；已经登不进去：用
> `docker exec glimmer-api node apps/api/dist/cli/reset-password.js` 重置（见「常见问题」）。

### 这两个容器分别在做什么

| 容器          | 作用                                        | 端口                              |
| ------------- | ------------------------------------------- | --------------------------------- |
| `glimmer-api` | 后端：登录、上传、图片处理、SQLite 数据库     | 3000，**仅容器内网**，不对公网开放  |
| `glimmer-web` | 前端页面；同时把 `/api` 与 `/files` 转发给后端 | 3001，**唯一对外端口**             |

关键在第二行：`glimmer-web` **自带同源转发**
（实现见 [`apps/web/server/middleware/api-proxy.ts`](apps/web/server/middleware/api-proxy.ts)），
所以**不需要额外装 Nginx** —— 你只暴露一个端口，登录、上传、图片直链就全通了。
这是本项目与「一个应用 + 一个反代」常见组合最大的不同。

---

### 可选：加上 Nginx（80 / 443 与 HTTPS）

只有这三种情况才需要它：

- 想让服务监听到标准的 **80 / 443** 端口；
- 想用**自己的域名 + HTTPS 证书**；
- 想让图片由 Nginx 直接读磁盘返回，不走 Node 进程（有性能意义，但对小团队基本无感）。

```bash
docker compose --profile nginx up -d
```

`glimmer-nginx` 带 **profile** 标记，所以：

- 不加 `--profile nginx` 时它**既不会启动、也不会被拉取**，等于不存在；
- 加了才启动，且**一条命令随时可加可去**：

```bash
docker compose --profile nginx up -d     # 加上 Nginx
docker compose up -d                     # 去掉 Nginx（compose 会移除多余容器，数据不动）
```

> ⚠️ **代价**：图片改为由 Nginx 直接返回后就不再经过 API，**访问统计会缺失**
> （详见 [访问统计的覆盖范围](#-访问统计的覆盖范围重要)）。默认的两个容器形态统计才是完整的。
>
> 它需要仓库根目录的 `nginx.conf`；用 `curl` 方式下载的话请补一句：
> `curl -fsSLO https://raw.githubusercontent.com/praming/Glimmer/main/nginx.conf`

**启用 HTTPS：** 把证书放到 `./certs/fullchain.pem` 与 `./certs/privkey.pem`，
取消 `nginx.conf` 末尾 443 段的注释，并把 `.env` 里的 `COOKIE_SECURE` 改回 `true`。

### 可选：不用 Compose，用 `docker run`

只用两条命令，适合不想引入 compose 的场景。**容器名请保持 `glimmer-api` / `glimmer-web`**
（前端按这个名字找后端；改了就要同步改 `API_PROXY_TARGET`）。

```bash
docker network create glimmer-net
mkdir -p glimmer-data/uploads glimmer-data/tmp
```

```bash
docker run -d --name glimmer-api --network glimmer-net --restart unless-stopped \
  -v "$PWD/glimmer-data:/data/glimmer" \
  -e NODE_ENV=production -e PORT=3000 -e TRUST_PROXY=true \
  -e DATABASE_URL=/data/glimmer/glimmer.db \
  -e LOCAL_STORAGE_DIR=/data/glimmer/uploads \
  -e TEMP_DIR=/data/glimmer/tmp \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=换成你的密码 \
  -e PUBLIC_BASE_URL=http://你的IP:3001 -e COOKIE_SECURE=false \
  praming/glimmer-api:latest
```

```bash
docker run -d --name glimmer-web --network glimmer-net --restart unless-stopped \
  -p 3001:3001 \
  -e NODE_ENV=production -e NITRO_HOST=0.0.0.0 -e NITRO_PORT=3001 \
  -e NUXT_PUBLIC_API_BASE=/api \
  -e API_PROXY_TARGET=http://glimmer-api:3000 \
  praming/glimmer-web:latest
```

然后访问 `http://你的IP:3001`。

> `glimmer-api` 特意**没有** `-p`：它只在容器内网可达，公网无法直连 —— 这既是安全设计，
> 也是登录限流能正确识别访客 IP 的前提。所以跑 `docker run` 时请**不要**给它加 `-p 3000:3000`。
>
> 想换成自己构建的镜像，把 `praming/` 前缀去掉（本地构建的 tag 就叫 `glimmer-api:latest`）。
>
> 上面没有传 `ENCRYPTION_KEY`：它会自动生成到 `glimmer-data/.secrets.json`，也就是 `-v` 挂载的那个目录。
> 想自己指定就加 `-e ENCRYPTION_KEY=你的随机串`。

### 可选：已经有 1Panel / 宝塔面板

面板自带的 OpenResty 可以接管对外端口，这时用另一份编排（端口只绑 `127.0.0.1`，不直接对外）：

```bash
docker compose -f docker-compose.1panel.yml up -d
```

面板侧只需两步：

1. 新建一个**反向代理**站点，目标填 `http://127.0.0.1:3001` —— **一条规则就够**，
   因为前端自己会把 `/api` 与 `/files` 转给后端；
2. 在该站点配置里把上传体积上限调大：

   ```nginx
   client_max_body_size 64m;
   ```

   ⚠️ 面板默认是 **1m**，不改的话**超过 1MB 的图会被面板直接拦成 413**，
   而且容器日志里什么都看不到，很容易误判成后端故障。

> 反向代理请勿使用面板的「静态网站」功能托管前端 —— 它的产物不是纯静态站点（见下方说明）。

### 升级、备份与卸载

**升级到新版本：**

```bash
docker compose pull && docker compose up -d --no-build    # 用镜像升级
docker compose up -d --build                              # 从源码升级
```

**备份** —— 全部运行数据都在 `./glimmer-data`，打包它即可，不需要停服务：

```bash
tar czf glimmer-backup-$(date +%F).tar.gz glimmer-data
```

**卸载**（下面的命令会**删除全部图片与数据库**，请先备份）：

```bash
docker compose down
rm -rf glimmer-data
```

---

## 开发与自建镜像

### 本地开发

> ⚠️ **Node 版本必须是 18 / 20 / 22 / 23（推荐 22）**
>
> `better-sqlite3` 是 **ABI 绑定**的原生模块，官方只发布了以上四个 ABI 的预编译二进制。用 Node 24+
> 安装时找不到预编译包，会回落到 `node-gyp` 源码编译，没有 Visual Studio C++ 工具链就会失败。
> 仓库已内置守卫 `scripts/check-node.mjs`（挂在 `preinstall`），版本不受支持时会在下载依赖**之前**
> 直接中止并给出提示。版本声明同时写在 `.nvmrc` 与 `package.json` 的 `engines`。
>
> ⚠️ 原生模块的 ABI 在**安装期**确定，因此「安装依赖」与「运行服务」必须使用**同一个 Node 大版本**。

```bash
node -v && pnpm -v      # 需要 Node 18/20/22/23 + pnpm 9

pnpm install
cp .env.example .env    # 可选：密钥会自动生成，本地开发一般只需改 ADMIN_PASSWORD
pnpm db:migrate         # 建库 + 创建管理员（幂等，可重复执行）
pnpm dev                # 同时启动 API(3000) 与 Web(3001)
```

打开 <http://localhost:3001> 登录。Nuxt 开发服务器已通过 Nitro `devProxy` 把 `/api/**` 与 `/files/**`
代理到 `127.0.0.1:3000`，因此开发环境无需处理跨域。

也可以分开启动：`pnpm dev:api`（端口 3000）、`pnpm dev:web`（端口 3001）。

### 生产构建（不使用 Docker）

```bash
pnpm build                          # shared → api → web
pnpm start:api                      # node apps/api/dist/index.js
pnpm --filter @glimmer/web start    # node apps/web/.output/server/index.mjs
```

生产产物下 `/api` 与 `/files` 由 **Nuxt（Nitro）自身转发**给 API，与 Docker 里的形态一致。
容器部署时通过 `API_PROXY_TARGET` 指定后端地址（默认 `http://glimmer-api:3000`，纯本机运行可设为
`http://127.0.0.1:3000`）：

```bash
API_PROXY_TARGET=http://127.0.0.1:3000 pnpm --filter @glimmer/web start
```

> 注意：该转发**只在生产构建下生效**（开发环境由 `devProxy` 负责）。
> 想在不启动 API 的情况下单独预览前端产物，用 `pnpm preview` —— 它会自行拉起 nitro 与同源代理，
> 并在上游不可达时返回带原因的 `502`，不会静默失败。端口可用 `PREVIEW_PORT` / `NITRO_PORT` / `API_PORT` 覆盖。

### 发布镜像到 Docker Hub（维护者）

镜像由 GitHub Actions 自动构建并推送，配置见 [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)。

**一次性准备**

1. 在 Docker Hub 生成访问令牌：Account settings → Personal access tokens → 权限选 **Read & Write**。
2. 在 GitHub 仓库添加两个 secret（Settings → Secrets and variables → Actions）：
   - `DOCKERHUB_USERNAME`：你的 Docker Hub 用户名
   - `DOCKERHUB_TOKEN`：上一步生成的令牌
   不要用登录密码 —— Docker Hub 已不支持密码推送。
3. 两个仓库**不必手动创建**，首次推送时 Docker Hub 会自动建；但请到该仓库的 **Settings** 确认
   可见性是 **Public**，否则别人拉不到镜像。

**发布一个版本**

```bash
git tag v1.0.0
git push origin v1.0.0     # 触发构建，推送 1.0.0 与 latest 两个标签
```

| 触发方式 | 推送到 Docker Hub 的标签 |
| --- | --- |
| 推送 `v*` 标签 | 版本号（如 `1.0.0`）+ `latest` |
| 推送到 `main`（且 `apps/**`、`packages/**`、锁文件等有变化） | `latest` |
| Actions 页面手动触发 | 自定义标签，留空则 `latest` |

发布的镜像只有 **两个**：`glimmer-api` 与 `glimmer-web`。
Nginx 用的是官方 `nginx:alpine` 镜像，**不占用本项目的镜像标签** ——
所以「带不带 Nginx」不是靠拉取不同的镜像来区分的，而是靠 compose 的 `--profile nginx`（见上一节）。

> **为什么不用 Docker Hub 自带的自动构建？** 它的 Automated Builds 已于 2026-05 宣布废弃
> （2027-04-01 完全停用），且需要付费订阅；免 PAT 的 OIDC 登录也只对付费组织开放。
> GitHub Actions 是 Docker 官方给出的迁移方向，而且**一个仓库就能构建本项目这样的多个镜像**，
> 这是 Docker Hub 原生方案做不到的（每个 repository 只能配一个 Dockerfile）。

> 镜像默认只构建 `linux/amd64`。需要 ARM 时把 workflow 里的 `platforms` 改为
> `linux/amd64,linux/arm64` 并启用 `setup-qemu-action` —— 注意在 QEMU 模拟下编译
> native 模块（better-sqlite3 / sharp）会明显变慢。

## 配置

所有配置都通过环境变量，**每一项都有可用默认值**，不建 `.env` 也能跑。完整清单与注释见 [`.env.example`](.env.example)。关键项：

| 变量                              | 默认                      | 说明                                                                 |
| --------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                    | `./data/glimmer.db`       | SQLite 文件路径（容器内建议 `/data/glimmer/glimmer.db`）               |
| `LOCAL_STORAGE_DIR`               | `./data/uploads`          | 本地存储后端根目录                                                     |
| `TEMP_DIR`                        | `./data/tmp`              | 上传临时目录（处理完成后自动清理）                                      |
| `ENCRYPTION_KEY`                  | 自动生成                  | 加密存储后端凭据（S3 Secret Key / WebDAV 密码）的主密钥。**留空即首次启动自动生成**并存到 `glimmer-data/.secrets.json`，请随数据一起备份 |
| `ADMIN_USERNAME`                  | `admin`                   | 首次启动创建的管理员用户名                                              |
| `ADMIN_PASSWORD`                  | `change-me`               | 首次启动创建的管理员密码，**务必修改**                                  |
| `SESSION_TTL_DAYS`                | `7`                       | 默认会话有效期（天）；用户可在个人资料里单独覆盖                          |
| `COOKIE_SECURE`                   | 生产为 `true`             | 仅 HTTPS 下为 `true`；纯 HTTP 访问必须设为 `false`。**`.env.example` 已预设 `false`** |
| `PUBLIC_BASE_URL`                 | `http://localhost:3000`   | 对外基地址，也是本地后端直链域名的默认值                                 |
| `TRUST_PROXY`                     | 生产为 `true`             | 是否信任反代传来的 `X-Forwarded-For`。**API 端口直连公网时必须设为 `false`** |
| `MAX_UPLOAD_SIZE_MB`              | `20`                      | 单文件大小上限                                                          |
| `QUEUE_CONCURRENCY`               | `2`                       | 异步队列并发数                                                          |
| `CORS_ORIGIN`                     | `http://localhost:3001`   | 允许的跨域来源，逗号分隔                                                 |
| `AUTH_RATE_LIMIT_MAX_PER_IP`      | `20`                      | 单个 IP 在窗口内的登录失败上限                                           |
| `AUTH_RATE_LIMIT_MAX_PER_ACCOUNT` | `5`                       | 单个账号在窗口内的登录失败上限                                           |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS`  | `900`                     | 限流窗口长度（秒）                                                       |

下面三项**只在 Docker 部署时用到**（它们是给 compose 做变量替换的，应用自身不读取）：

| 变量                        | 默认                      | 说明                                                         |
| --------------------------- | ------------------------- | ------------------------------------------------------------ |
| `WEB_PORT`                  | `3001`                    | `glimmer-web` 的对外端口；填 `80` 即可用 `http://IP` 直接访问  |
| `API_PROXY_TARGET`          | `http://glimmer-api:3000` | 前端把 `/api`、`/files` 转发到哪个后端（改了容器名要同步改）    |
| `IMAGE_PREFIX` / `IMAGE_TAG` | `praming/` / `latest`    | 镜像来源；把前缀留空即改用本地构建出的镜像                      |

> ⚠️ **`ADMIN_PASSWORD` 只在 `users` 表为空的那一次启动里生效**。账号一旦创建，改 `.env`
> 不会更新密码（启动日志会打印「已忽略 ADMIN_PASSWORD」）。日常改密码请到**个人资料**页；
> 已经登不进去时用 `docker exec glimmer-api node apps/api/dist/cli/reset-password.js` 重置 ——
> **不必删库**（见「常见问题」）。
>
> 启动时若检测到弱密钥或默认管理员密码，日志中会输出安全提示。
>
> ⚠️ 计流数据存在**进程内存**中，因此**登录限流是单实例的**：进程重启即清零（这同时也是「把自己锁在门外」的逃生口），
> 若将来横向扩成多实例，额度会被实例数放大，那时需要换成 Redis 之类的共享存储。

---

## 部署要点

### 反向代理与 HTTPS

默认形态**不需要任何反向代理** —— `glimmer-web` 自己会把 `/api` 与 `/files` 转发给 API。
另外两种形态都是可选的：

- **自带 Nginx**：`docker compose --profile nginx up -d`（见上文「可选：加上 Nginx」）。
  它的 `nginx.conf` 做两件事：`/` 与 `/api/*` 分流；`location /files/` 直接 `alias` 到数据目录下的
  `uploads`，图片由 Nginx 直接返回、不消耗 Node 进程，未命中时回源 API。
- **面板反代**（1Panel / 宝塔）：见上文「可选：已经有 1Panel / 宝塔面板」。

⚠️ 无论哪种形态，`glimmer-web` 都**不能**省略：它是 Nitro node-server 产物，
`.output/public/` 中只有 `_nuxt/` 与 `favicon.svg`，**没有 `index.html`**
（HTML 入口由 Nitro 运行时生成），因此不能当作纯静态站点交给面板的「静态网站」功能托管。

### ⚠️ 访问统计的覆盖范围（重要）

统计的计数入口是 API 的 `GET /files/*` 路由，因此**只有「经本项目后端返回的本地存储文件」会被统计**：

| 部署形态 | 图片何时经 API | 统计 |
| --- | --- | --- |
| **默认两容器**（含面板只配 `/` 一条规则） | 总是 | **完整** ✅ |
| 启用 Nginx（`--profile nginx`） | 仅未命中磁盘时 | Nginx 直出的那部分**不计入** ❌ |
| 面板反代并把 `/files` 单独指到 `:3000` | 总是 | 完整 ✅ |
| S3 / WebDAV 后端 | 从不（由对象存储自有域名直出） | **不计入** ❌ |

也就是说：**默认形态的统计是全量的**；一旦让 Nginx 或对象存储直出图片，统计口径就只剩「经 API 的那部分」。
若需要精确的全量统计，建议在 Nginx access log 或 CDN 侧另行统计。

（统计采用内存聚合 + 定时落盘，满 5 秒或累计 200 个键刷新一次；`304` 命中不计次数与流量。）

### 单实例假设

限流计数与处理队列都在**进程内存**中。本项目按「一台 VPS、一个 API 进程」设计，未做多实例协调。

## API

所有回包统一为 `{ data: ... }` 或 `{ error: { code, message, details? } }`。
除 `/api/auth/*` 与 `/api/health` 外均需认证；管理员接口额外校验角色。

认证支持两种方式，可混用：

- **Cookie 会话**（浏览器）：`glimmer_session`，由 `POST /api/auth/login` 下发。
- **Bearer 令牌**（脚本 / CI）：`Authorization: Bearer glm_xxxxxxxx…`，在「设置 → 存储后端 → 访问令牌」创建。

| 方法     | 路径                          | 权限         | 说明                                        |
| -------- | ----------------------------- | ------------ | ------------------------------------------- |
| `GET`    | `/api/health`                 | 公开         | 健康检查 + 队列状态                          |
| `POST`   | `/api/auth/login`             | 公开         | 登录                                         |
| `POST`   | `/api/auth/logout`            | 登录         | 退出并失效当前会话                            |
| `GET`    | `/api/auth/me`                | 公开         | 当前用户 + 个人偏好（未登录返回 null）         |
| `PATCH`  | `/api/auth/me`                | 登录         | 改自己的用户名 / 头像 / 会话有效期             |
| `POST`   | `/api/auth/password`          | 登录         | 改密（同时撤销名下全部令牌）                   |
| `POST`   | `/api/upload`                 | 登录         | multipart 上传，返回 `202` 并进入异步队列      |
| `POST`   | `/api/upload/check`           | 登录         | **秒传预检**：指纹命中则跳过文件传输            |
| `GET`    | `/api/upload/queue`           | 登录         | 队列运行状态                                 |
| `GET`    | `/api/images`                 | 登录         | 分页 / 搜索 / 多条件筛选                      |
| `GET`    | `/api/images/:id`             | 登录         | 详情（含变体与各后端状态）                     |
| `PATCH`  | `/api/images/:id`             | 本人或管理员  | 重命名（跨后端同步）/ 补充同步后端              |
| `DELETE` | `/api/images/:id`             | 本人或管理员  | 同步删除所有后端并移除记录                     |
| `POST`   | `/api/images/:id/retry`       | 本人或管理员  | 重试失败同步 / 补充指定后端                    |
| `GET`    | `/api/images/:id/urls`        | 登录         | 各格式的四种复制文本                          |
| `POST`   | `/api/images/batch/delete`    | 登录         | 批量删除（逐条鉴权）                          |
| `GET`    | `/api/stats`                  | 登录         | 访问统计（管理员默认看全局，成员看自己）        |
| `GET`    | `/api/settings`               | 管理员        | 全局配置（密钥以占位符回显）+ 运行信息          |
| `PATCH`  | `/api/settings`               | 管理员        | 保存全局配置                                 |
| `POST`   | `/api/settings/backends/test` | 管理员        | 测试存储后端连通性                            |
| `GET`    | `/api/settings/options`       | 登录         | 上传页所需的公开选项（不含密钥）               |
| `GET`    | `/api/me/preferences`         | 登录         | 个人偏好                                     |
| `PATCH`  | `/api/me/preferences`         | 登录         | 保存个人偏好                                 |
| `GET`    | `/api/me/tokens`              | 登录         | 访问令牌列表（不含明文）                      |
| `POST`   | `/api/me/tokens`              | 登录         | 创建令牌，**仅此一次**返回明文                 |
| `DELETE` | `/api/me/tokens/:id`          | 登录         | 撤销令牌（软删除，保留审计记录）               |
| `DELETE` | `/api/me/tokens/:id?purge=1`  | 登录         | 彻底删除该令牌记录（不可恢复）                 |
| `GET/POST/PATCH/DELETE` | `/api/users[/:id]` | 管理员   | 用户管理（创建 / 改角色 / 禁用 / 重置密码 / 删除） |
| `GET`    | `/files/*`                    | 公开         | 本地存储后端静态文件兜底                      |

### 上传示例

```bash
# 登录（保存 Cookie）
curl -c cookie.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}'

# 上传（formats / backends 用逗号分隔）
curl -b cookie.txt -X POST http://localhost:3000/api/upload \
  -F 'files=@photo.jpg' \
  -F 'formats=webp,avif' \
  -F 'backends=local' \
  -F 'keepOriginal=false'
# → 202 {"data":{"images":[{"id":"...","status":"pending"}],"rejected":[]}}

# 轮询直到 ready
curl -b cookie.txt http://localhost:3000/api/images/<id>
```

用 **Bearer 令牌**（适合脚本）：

```bash
TOKEN=glm_xxxxxxxxxxxxxxxxxxxx
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/images
curl -H "Authorization: Bearer $TOKEN" -X POST http://localhost:3000/api/upload \
  -F 'files=@photo.jpg' -F 'formats=webp' -F 'backends=local'
```

**秒传预检**（先算原图 SHA-256，命中则完全跳过文件传输）：

```bash
HASH=$(sha256sum photo.jpg | cut -d' ' -f1)

curl -b cookie.txt -X POST http://localhost:3000/api/upload/check \
  -H 'Content-Type: application/json' \
  -d "{\"hash\":\"$HASH\",\"size\":123456,\"formats\":[\"webp\"],\"backends\":[\"local\"],\"keepOriginal\":false}"
# → {"data":{"hit":true,"image":{ ...完整图片详情... }}}
```

`hit=true` 时可直接使用回包里的 `image`（含各格式 URL），无需再调 `/api/upload`。

---

## 常见问题

**Q：`docker compose up -d` 卡在拉取，或报 `manifest unknown` / `pull access denied`？**
说明镜像还没发布，或 Docker Hub 上的仓库是私有的。改用本地构建，结果完全一样，只是首次要多等几分钟：

```bash
docker compose up -d --build
```

**Q：服务起来了，但浏览器打不开页面？**
按顺序排查：

1. `docker compose ps` —— 两个容器是否都是 `running`（`glimmer-api` 显示 `healthy` 更好）；
2. `docker compose logs glimmer-web` —— 有没有明显的报错；
3. **云服务器的安全组 / 防火墙**是否放行了 `WEB_PORT`（默认 3001）—— 这是最常见的原因；
4. 若把端口改成了 80，确认没被别的东西占用：`sudo ss -lntp | grep :80`。

**Q：想让网址不带端口（直接 `http://IP`）？**
把 `.env` 里的 `WEB_PORT=3001` 改成 `WEB_PORT=80`，再 `docker compose up -d` 即可。
80 端口常被面板或其他服务占用，被占用时换个端口，或按「可选：加上 Nginx」那一节处理。

**Q：上传大图失败 / 浏览器报 `413`？**
① 本项目单文件上限默认 20MB，由 `MAX_UPLOAD_SIZE_MB` 控制；
② 如果前面有 1Panel / 宝塔面板，它的 `client_max_body_size` 默认只有 **1m**，必须调到 `64m` 或更大 ——
否则请求在面板层就被拦掉了，**容器日志里不会有任何记录**，极易误判成后端故障。

**Q：登录提示「用户名或密码不正确」，或忘记管理员密码了？**
先别急着怀疑自己记错 —— 绝大多数是**你填的密码不是数据库里那个**：

1. `ADMIN_USERNAME` / `ADMIN_PASSWORD` **只在数据库为空的那一次启动里生效**。
   如果你是「先 `docker compose up -d` 跑起来，之后才建 `.env`」，那么库里存的仍是
   `change-me`，后来写进 `.env` 的密码被静默忽略了（可查启动日志确认：
   `docker compose logs glimmer-api | grep 已忽略`）。
2. `.env` 必须和 `docker-compose.yml` **在同一个目录**。面板部署时是面板的编排项目目录，
   放在别处（例如你下载 yml 的那个目录）等于没配。
3. 用户名**区分大小写**，`Admin` 与 `admin` 是两个不同的账号名。

**重置密码**（不需删库、不需停服，新镜像自带该命令）：

```bash
# 1) 先看一眼库里到底有哪些账号（用户名、角色、是否被禁用）
docker exec glimmer-api node apps/api/dist/cli/reset-password.js --list

# 2) 重置密码 —— 同时会撤销该账号的全部登录会话与 API 令牌
docker exec glimmer-api node apps/api/dist/cli/reset-password.js admin '你的新密码'

# 账号显示「已禁用」时，加 --enable 一并解除
docker exec glimmer-api node apps/api/dist/cli/reset-password.js admin '你的新密码' --enable
```

新密码**立即生效，无需重启**；规则与界面一致（8 ~ 128 个字符）。
若提示找不到该文件，说明镜像还是旧的，拉一下即可：`docker compose pull && docker compose up -d`

> 连续输错 5 次会触发限流，此时报的是「尝试过于频繁，请在 N 秒后重试」而不是
> 「用户名或密码不正确」——**两者是两回事**：前者等 15 分钟（或重启 API 容器，额度在内存里）
> 再试，后者才是真的密码不对。

**Q：`pnpm install` 报 `gyp ERR! find VS Could not find any Visual Studio installation to use`？**
当前 Node 版本太新，`better-sqlite3` 没有对应 ABI 的预编译包。改用 Node 18 / 20 / 22 / 23（推荐 22），
并确保「安装依赖」和「运行服务」用的是同一个 Node 大版本。新版仓库已在 `preinstall` 阶段拦截该情况。

**Q：登录成功但立刻掉登录态？**
多半是 `COOKIE_SECURE=true` 但通过 HTTP 访问。纯 HTTP（例如 `http://1.2.3.4`）请设为 `false`，配好 HTTPS 后再改回 `true`。

**Q：本地后端图片 404？**
直链形如 `{PUBLIC_BASE_URL}/files/{路径}`。检查 `.env` 的 `PUBLIC_BASE_URL` 是否指向 Nginx 对外地址，并确认数据目录已正确挂载。

**Q：访问统计一直是 0？**
见上方 [访问统计的覆盖范围](#-访问统计的覆盖范围重要)。若图片放在 S3/WebDAV，或线上由 Nginx 直服 `/files/`，
这些请求不经过 API，自然不计入。另外统计是**内存聚合 + 每 5 秒落盘**，刚访问完立刻刷新可能还没写库。

**Q：上传同一张图没有触发秒传？**
按可能性排查：① 访问方式不是安全上下文（`crypto.subtle` 只在 HTTPS 或 `localhost` 可用，局域网 IP + HTTP 会**静默降级**为普通上传，这是有意设计）；
② 处理配置变了（秒传指纹包含输出格式、`keepOriginal`、目标后端、质量参数、最大宽高、命名模板，任一项不同即视为不同产物）；
③ 换了账号（去重作用域是 per-user）；④ 上次的产物是 `failed`（不参与去重）。

**Q：登录时提示「尝试过于频繁，请在 N 秒后重试」？**
触发了登录限流（默认单账号 5 次失败 / 15 分钟、单 IP 20 次失败 / 15 分钟）。等窗口过去即可，或重启 API 进程直接清零
（额度存在内存里，不落库）。也可以调大 `AUTH_RATE_LIMIT_MAX_PER_ACCOUNT` / `AUTH_RATE_LIMIT_MAX_PER_IP`。

**Q：同一 IP 下的另一个同事被我的失败次数连累了？**
这是刻意设计：IP 维度不区分账号（否则伪造来源即可拆分计数）。配额是「每窗口 20 次失败」，正常输入密码不会触发。
若部署在反向代理后面，还要确认 `TRUST_PROXY=true`，否则所有请求会被视为来自同一个内网 IP。

**Q：令牌丢了怎么办？**
无法找回 —— 服务端只存 SHA-256 摘要。请到「设置 → 存储后端 → 访问令牌」撤销后重新创建。
注意修改密码会**自动撤销名下全部令牌**，脚本需要同步更换。

**Q：图片一直失败，详情里显示「自动重试已用尽配额」？**
后台已按 30s → 2m → 8m → 32m 重试过 4 次仍未成功。通常是后端配置问题（密钥失效、bucket 不存在、WebDAV 密码过期、磁盘满）。
修正配置后在详情抽屉点「重试失败同步」即可 —— 手动重试会**清零重试预算**，重新获得完整的 4 次自动重试机会。

**Q：S3 上传报 checksum / SignatureDoesNotMatch？**
MinIO、R2 等对 AWS SDK 新版默认 checksum 敏感，本项目已设 `requestChecksumCalculation: 'WHEN_REQUIRED'`。
若仍失败，确认 `forcePathStyle` 与 `region` 是否与服务商文档一致（R2 常用 `auto`）。

**Q：设置了字体但看不到变化？**
项目**不打包字体文件**，只是把字体名写进 CSS。浏览器不会告诉你「这个字体没装」，只会安静回落，
因此最常见的原因就是**本机没有这个字体**。设置页内置了可用性检测，会直接写明「本机已安装 · 实际使用 X」或「本机未安装 · 已回落到 Y」。

---

## 项目结构

```
glimmer/
├── apps/
│   ├── api/                  # @glimmer/api —— Hono 服务
│   │   ├── src/
│   │   │   ├── index.ts      # 启动入口（建表 → 恢复任务 → 监听）
│   │   │   ├── app.ts        # 应用装配、中间件、统一错误处理
│   │   │   ├── env.ts        # 环境变量校验与路径推导
│   │   │   ├── db/           # Drizzle schema / 连接 / 幂等建表
│   │   │   ├── lib/          # crypto / session / errors / http / tokens
│   │   │   ├── storage/      # local / s3 / webdav 适配器 + 注册表
│   │   │   ├── services/     # settings / pipeline / queue / images
│   │   │   │                 # + dedup（秒传）/ access（计数）/ stats / retry
│   │   │   └── routes/       # auth / users / upload / images / settings / files / stats
│   │   └── Dockerfile
│   └── web/                  # @glimmer/web —— Nuxt 3 前端
│       ├── pages/            # login / index(上传) / gallery / settings / users / profile
│       ├── layouts/          # default（侧边栏 + 底部 Tab）/ auth
│       ├── components/       # ui/* 基础组件 + 业务组件
│       ├── stores/           # auth / options / upload / gallery / settings
│       ├── composables/      # useApi / useToast / useTheme / useTypography …
│       └── server/           # Nitro 服务端代码
│           └── middleware/   #   api-proxy.ts —— 生产环境把 /api、/files 转发给 API
├── packages/
│   └── shared/               # @glimmer/shared —— 类型、常量、Zod schema、纯函数
├── scripts/                  # 仓库级脚本（Node 版本守卫 / 预览服务 / 镜像发布）
├── docker-compose.yml        # 默认：api + web 两个容器（nginx 是可选 profile，默认不启动不拉取）
├── docker-compose.1panel.yml # 面板反代场景：端口只绑回环，交给 1Panel / 宝塔
├── nginx.conf                # 可选 Nginx 的配置（仅 --profile nginx 时被挂载）
├── .env.example
└── LICENSE
```

---

## License

Copyright (C) 2026 Praming

本项目以 **GNU Affero General Public License v3.0（AGPL-3.0）** 授权发布，完整协议文本见 [`LICENSE`](./LICENSE)。

| 场景 | 是否允许 | 需要做什么 |
| --- | --- | --- |
| 自己 / 团队内部部署使用 | ✅ | 无需公开任何代码 |
| 修改后仅在内部使用 | ✅ | 无需公开任何代码 |
| 二次分发（无论是否修改） | ✅ | 附上协议全文、保留版权声明，并提供完整对应源代码 |
| **把修改版作为网络服务对外提供** | ✅ | **必须**向使用者提供完整对应源代码（AGPL 比 GPL 多出的第 13 条） |
| 闭源商用 / 把衍生作品藏起来 | ❌ | —— |

> 一句话：**内部怎么用都行；一旦对外提供网络服务，改动就必须开源。**

第 13 条（Remote Network Interaction）是 AGPL 与 GPL 的唯一实质区别：它把「分发」的触发点扩大到「通过网络与之交互」。
所以自建图床给外部人用、且改过代码的话，需要提供源码。

第三方运行时依赖的许可均为宽松许可（MIT / ISC / Apache-2.0，如 Hono、Drizzle、sharp、better-sqlite3、Nuxt、Vue），
与 AGPL-3.0 兼容，不构成额外限制。
