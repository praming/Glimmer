# 浮光 / Glimmer

> Glimmer — 一个轻量、自建、够用的图床。

浮光是一套**自建图床**：上传图片 → 自动压缩与格式转换 → 并行写入一个或多个存储后端 → 一键复制各种格式的链接 → 在图库中统一管理。

它不开放注册，账号由管理员创建，适合**个人或 2~3 人的小团队**部署在自己的 VPS 上。整套服务只依赖一个 SQLite 文件与本地磁盘，**不需要 Redis、不需要消息队列、不需要任何额外中间件**。

---

## 目录

- [特性](#特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
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
| 部署     | Docker Compose + Nginx，或纯 Node 进程           |

包名：`@glimmer/api` / `@glimmer/web` / `@glimmer/shared`（pnpm workspace monorepo）。

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/praming/Glimmer.git
cd Glimmer
cp .env.example .env
# 编辑 .env：至少修改 SESSION_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD / PUBLIC_BASE_URL
docker compose up -d --build
docker compose logs -f glimmer-api
```

启动后访问 `http://<你的服务器IP>/`，用 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

| 服务            | 说明                                              | 端口        |
| --------------- | ------------------------------------------------- | ----------- |
| `glimmer-api`   | Hono API + sharp + p-queue，含 `/files/*` 静态兜底  | 3000（内网） |
| `glimmer-web`   | Nuxt 3（Nitro node-server）                        | 3001（内网） |
| `glimmer-nginx` | 反向代理：`/api/*` → API，其余 → Web（**可选**）      | 80 / 443    |

> **已经用 1Panel / 宝塔等面板反代？** 那 `glimmer-nginx` 就是重复的一层，可以去掉 ——
> 改用 `docker compose -f docker-compose.1panel.yml up -d --build`，详见
> [反向代理与 HTTPS](#反向代理与-https) 的「形态 B」。

> **本地部署不需要 Docker Hub 账号**：`docker compose up -d --build` 是在**本机构建镜像**，只打本地 tag，不会推送或拉取任何仓库。
>
> 首次构建会在容器内编译 `better-sqlite3`，视机器性能约 3–8 分钟；之后命中层缓存会快很多。
>
> 更新版本：`git pull && docker compose up -d --build`。

### 方式二：本地开发

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
cp .env.example .env    # 至少修改 SESSION_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD
pnpm db:migrate         # 建库 + 创建管理员（幂等，可重复执行）
pnpm dev                # 同时启动 API(3000) 与 Web(3001)
```

打开 <http://localhost:3001> 登录。Nuxt 开发服务器已通过 Nitro `devProxy` 把 `/api/**` 与 `/files/**`
代理到 `127.0.0.1:3000`，因此开发环境无需处理跨域。

也可以分开启动：`pnpm dev:api`（端口 3000）、`pnpm dev:web`（端口 3001）。

### 方式三：生产构建（不使用 Docker）

```bash
pnpm build                          # shared → api → web
pnpm start:api                      # node apps/api/dist/index.js
pnpm --filter @glimmer/web start    # node apps/web/.output/server/index.mjs
```

> 这种方式下前端能加载，但**接口会 404** —— 生产环境依赖反向代理（自带 Nginx 或面板反代）同源代理 `/api` 与 `/files`。
> 想在不装 Nginx 的情况下预览生产产物，用：

```bash
pnpm start:api    # 终端 A：API :3000
pnpm preview      # 终端 B：nitro :3100 + 同源代理 :4000
```

`pnpm preview` 会自行拉起 nitro 并探测两个上游是否就绪，任一不可达时接口返回带原因的 `502`，不会静默失败。
端口可用 `PREVIEW_PORT` / `NITRO_PORT` / `API_PORT` 覆盖。

---

## 配置

所有配置都通过环境变量，完整清单与注释见 [`.env.example`](.env.example)。关键项：

| 变量                              | 默认                      | 说明                                                                 |
| --------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                    | `./data/glimmer.db`       | SQLite 文件路径（容器内建议 `/data/glimmer/glimmer.db`）               |
| `LOCAL_STORAGE_DIR`               | `./data/uploads`          | 本地存储后端根目录                                                     |
| `TEMP_DIR`                        | `./data/tmp`              | 上传临时目录（处理完成后自动清理）                                      |
| `SESSION_SECRET`                  | —                         | 会话签名/派生密钥，**≥ 32 字符，务必修改**                              |
| `ENCRYPTION_KEY`                  | —                         | 敏感配置加密主密钥（AES-256-GCM），**≥ 32 字符，务必修改**               |
| `ADMIN_USERNAME`                  | `admin`                   | 首次启动创建的管理员用户名                                              |
| `ADMIN_PASSWORD`                  | `change-me`               | 首次启动创建的管理员密码，**务必修改**                                  |
| `SESSION_TTL_DAYS`                | `7`                       | 默认会话有效期（天）；用户可在个人资料里单独覆盖                          |
| `COOKIE_SECURE`                   | 生产为 `true`             | 仅 HTTPS 下为 `true`；纯 HTTP 访问（如 `http://1.2.3.4`）必须设为 `false` |
| `PUBLIC_BASE_URL`                 | `http://localhost:3000`   | 对外基地址，也是本地后端直链域名的默认值                                 |
| `TRUST_PROXY`                     | 生产为 `true`             | 是否信任反代传来的 `X-Forwarded-For`。**API 端口直连公网时必须设为 `false`** |
| `MAX_UPLOAD_SIZE_MB`              | `20`                      | 单文件大小上限                                                          |
| `QUEUE_CONCURRENCY`               | `2`                       | 异步队列并发数                                                          |
| `CORS_ORIGIN`                     | `http://localhost:3001`   | 允许的跨域来源，逗号分隔                                                 |
| `AUTH_RATE_LIMIT_MAX_PER_IP`      | `20`                      | 单个 IP 在窗口内的登录失败上限                                           |
| `AUTH_RATE_LIMIT_MAX_PER_ACCOUNT` | `5`                       | 单个账号在窗口内的登录失败上限                                           |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS`  | `900`                     | 限流窗口长度（秒）                                                       |

> ⚠️ **`ADMIN_PASSWORD` 只在 `users` 表为空时生效**。若账号已存在，改 `.env` 不会更新密码 ——
> 请登录后到**个人资料**页修改，或删除数据库重新初始化（会清空所有数据）。
>
> 启动时若检测到弱密钥或默认管理员密码，日志中会输出安全提示。
>
> ⚠️ 计流数据存在**进程内存**中，因此**登录限流是单实例的**：进程重启即清零（这同时也是「把自己锁在门外」的逃生口），
> 若将来横向扩成多实例，额度会被实例数放大，那时需要换成 Redis 之类的共享存储。

---

## 部署要点

### 反向代理与 HTTPS

#### 形态 A：使用仓库自带 Nginx（默认）

`docker-compose.yml` 会额外起一个 `glimmer-nginx` 容器，已完成：

- `/` → `glimmer-web`，`/api/*` → `glimmer-api`；
- `location /files/` 直接 `alias` 到数据目录下的 `uploads`，本地存储后端的图片由 **Nginx 直接返回**，不消耗 Node 进程；未命中时回源 API。

启用 HTTPS：把证书放到 `./certs/`，取消 `nginx.conf` 底部 443 server 块的注释，并把 `COOKIE_SECURE` 设为 `true`。

#### 形态 B：交给面板反代 —— 不需要 `glimmer-nginx`

如果宿主机上已经跑着 **1Panel / 宝塔** 这类面板（自带 OpenResty），那么 `glimmer-nginx` 是重复的一层，可以直接去掉。仓库提供了对应的编排文件：

```bash
docker compose -f docker-compose.1panel.yml up -d --build
```

它只起 `glimmer-api` 与 `glimmer-web`，两者端口绑定在 `127.0.0.1`，由面板对外提供 80/443。面板侧需要配置三处：

| 项目       | 配置                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| 代理规则   | `/` → `127.0.0.1:3001`；`/api` → `127.0.0.1:3000`；`/files` → `127.0.0.1:3000` |
| 上传体积   | `client_max_body_size 64m;`（面板默认 1m，不改则超过 1MB 的上传被拦成 413）  |
| 上传超时   | `/api` 加 `proxy_read_timeout 300s; proxy_send_timeout 300s;`               |

> ⚠️ 三条代理规则缺一不可。前端是 SPA，`/api` 与 `/files` 必须一起转发，否则页面能打开但登录、上传、图片全部 404。

> `glimmer-web` **不能**省略。它是 Nitro node-server 产物，`.output/public/` 中只有 `_nuxt/` 与 `favicon.svg`，**没有 `index.html`**（HTML 入口由 Nitro 运行时生成），因此无法当作纯静态站点交给面板的静态托管。

去掉自带 Nginx 后 `/files/` 会回到 API，**访问统计反而变完整**（见下节）；代价是图片流量多过一次 Node。API 自身已返回 `Cache-Control: public, max-age=31536000, immutable`，缓存语义与 Nginx 直服一致。

> 两个编排文件共用项目名与容器名，**二选一**，不要同时运行；切换时 compose 会自动移除多出来的 `glimmer-nginx` 容器，数据都在宿主机的 `./glimmer-data`，不会丢。

### 数据与备份

Docker 部署下全部运行数据都在 `./glimmer-data`（挂载到容器 `/data/glimmer`）：

```
glimmer-data/
├── glimmer.db        # SQLite 数据库
├── uploads/          # 本地存储后端的文件
└── tmp/              # 上传临时目录（处理完成后自动清理）
```

重建容器不会丢数据，**备份直接打包这个目录即可**。

### ⚠️ 访问统计的覆盖范围（重要）

统计的计数入口是 API 的 `GET /files/*` 路由，因此**只有「经本项目后端返回的本地存储文件」会被统计**：

- **S3 / WebDAV 后端**：直链由其自有域名（CDN / 对象存储）直接提供，请求根本不经过本项目，**不会被计数**。
- **本地后端 + Nginx 直服**（本仓库 `nginx.conf` 的默认形态）：图片由 Nginx 直接返回，不经过 API，**不会被计数**。
- **本地后端 + 反代到 API**：把 `/files/` 的 `alias` 改成 `proxy_pass http://glimmer-api:3000`，此时统计最完整，代价是图片流量要过一遍 Node。用 `docker-compose.1panel.yml` 的面板部署（形态 B）即属此形态。

也就是说：**开箱默认配置下，统计口径 ≈ 本机预览 / 开发环境下的本地后端访问量。**
若需要精确的全量统计，建议在 Nginx access log 或 CDN 侧另行统计。

（统计采用内存聚合 + 定时落盘，满 5 秒或累计 200 个键刷新一次；`304` 命中不计次数与流量。）

### 单实例假设

限流计数与处理队列都在**进程内存**中。本项目按「一台 VPS、一个 API 进程」设计，未做多实例协调。

---

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
│       └── composables/      # useApi / useToast / useTheme / useTypography …
├── packages/
│   └── shared/               # @glimmer/shared —— 类型、常量、Zod schema、纯函数
├── scripts/                  # 仓库级脚本（Node 版本守卫 / 预览服务 / 镜像发布）
├── docker-compose.yml        # 形态 A：自带 glimmer-nginx
├── docker-compose.1panel.yml # 形态 B：交给面板反代（不含 nginx）
├── nginx.conf
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
