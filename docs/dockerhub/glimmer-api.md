# 浮光 / Glimmer · `glimmer-api`

> 自建图床「浮光」的**后端**镜像：上传图片 → 自动压缩与格式转换 → 并行写入本地 / S3 / WebDAV 等多个存储后端 → 在图库中统一管理。
> 不开放注册，账号由管理员创建，为**个人或 2~3 人小团队**的自托管场景而做：整套服务只依赖一个 SQLite 文件与本地磁盘，**不需要 Redis、不需要消息队列、不需要任何额外中间件**。

> ## ⚠️ 本镜像不能单独使用
>
> 浮光是**两个镜像**的组合，缺一不可：
>
> | 镜像 | 职责 | 端口 |
> | --- | --- | --- |
> | `praming/glimmer-api` ← 本镜像 | API、图片处理、SQLite 数据库 | `3000`，**仅容器内网** |
> | [`praming/glimmer-web`](https://hub.docker.com/r/praming/glimmer-web) | 前端页面，并把 `/api` 与图片直链转发给后端 | `3001`，**唯一对外端口** |
>
> 正确用法是使用仓库里的 `docker-compose.yml` 一起启动（见下），而不是单独 `docker run` 本镜像。

## 快速开始

只需要下载**一个文件**，而且**不需要创建 `.env`**（每一项配置都有可用默认值）：

```bash
mkdir glimmer && cd glimmer
curl -fsSLO https://raw.githubusercontent.com/praming/Glimmer/main/docker-compose.yml
docker compose up -d
```

然后访问 `http://<服务器IP>:3001`，用 `admin` / `change-me` 登录 —— **登录后请立刻改掉密码**。

> 也可以用 git：`git clone https://github.com/praming/Glimmer.git && cd Glimmer && docker compose up -d`

首次启动会自动完成三件事：拉取两个镜像、生成加密密钥、创建初始管理员。资源占用很低，**1 核 1G 起步就够**。

## 镜像内容

| 项目 | 说明 |
| --- | --- |
| 基础镜像 | `node:22-bookworm-slim`（Debian / glibc —— `sharp`、`better-sqlite3`、`@node-rs/argon2` 是原生模块，**不能换成 alpine**） |
| 入口 | `node apps/api/dist/index.js` |
| HTTP 框架 | Hono + `@hono/node-server` |
| 图片处理 | `sharp`：自动旋转 → 限制最大宽高（不放大）→ 剥离 EXIF → 按目标格式编码（`webp` / `avif` / `jpeg` / `png` / `gif`，多帧 GIF 保留动画） |
| 异步队列 | 进程内 `p-queue`，**无 Redis**；失败按 30s → 2m → 8m → 32m 指数退避重试，排期写入数据库，**重启进程不丢任务** |
| 数据库 | SQLite（better-sqlite3）+ Drizzle ORM |
| 存储后端 | 本地磁盘 / S3 兼容对象存储（AWS S3、MinIO、Cloudflare R2、阿里云 OSS、腾讯云 COS、七牛 Kodo）/ 标准 WebDAV（Nextcloud、坚果云等）；一次上传可同时写多个，**单个后端失败不阻塞其他** |
| 认证 | Cookie 会话（httpOnly + SameSite）+ Argon2id 哈希 + `Authorization: Bearer glm_…` API Token；登录限流按 IP 与账号两个维度、只统计失败次数 |
| 镜像体积 | 压缩后约 **97 MB** |

## 端口与卷

### 端口

| 端口 | 说明 |
| --- | --- |
| `3000` | HTTP API。**默认只 `expose`，不发布到宿主机** —— 由 `glimmer-web`（或你自己的反向代理）转发进来 |

```bash
curl http://127.0.0.1:3000/api/health     # 健康检查端点
```

镜像自带 `HEALTHCHECK`（每 30s 探测 `/api/health`），`docker compose ps` 中会显示 `healthy`。

### 卷（数据全在这里，务必持久化）

| 容器内路径 | 内容 |
| --- | --- |
| `/data/glimmer` | SQLite 数据库、本地上传目录、临时目录、加密密钥文件 `.secrets.json` |

compose 中映射为宿主机的 `./glimmer-data`。

> ⚠️ **`.secrets.json` 必须随数据目录一起备份。** 它用于解密你在后台保存的存储后端凭据（S3 Secret Key / WebDAV 密码）；删掉它，那些凭据就再也解不回来（届时只能重新填一遍）。
> 想自己管理密钥（例如多台机器共用一份数据），设置 `ENCRYPTION_KEY` 环境变量即可 —— 它的优先级最高。

## 环境变量（全部可选）

不创建 `.env` 也能直接 `docker compose up -d`。最常改的几项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `change-me` | 初始管理员密码。**只在「`users` 表为空」的那一次启动生效**，之后改它无效（日常改密请去后台「个人资料」） |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | 图片直链的域名回落值。**配错的表现是「复制出去的链接别人打不开」** |
| `COOKIE_SECURE` | 生产环境为 `true` | 用 `http://` 访问**必须设为 `false`**，否则浏览器会丢弃登录 Cookie → 「密码明明正确却登不上」 |
| `FILES_ROUTE_PREFIX` | 空 | 直链路径前缀的**部署级强制值**（设置后会锁定后台同名输入框）：填 `img` → `https://域名/img/2026/xxx.webp`；填 `/` → 直链挂在根路径（即去掉默认的 `/files`） |
| `MAX_UPLOAD_SIZE_MB` | `20` | 单文件上限（仅首次初始化作为默认值，之后以后台设置为准） |
| `QUEUE_CONCURRENCY` | `2` | 图片处理并发数 |
| `TRUST_PROXY` | 生产环境为 `true` | 依据 `X-Forwarded-For` 取真实客户端 IP 做登录限流。**仅在本镜像不直接暴露公网时开启**；若你把 `3000` 直接发布出去，请设为 `false`，否则伪造该请求头即可绕过 IP 限流 |
| `DATABASE_URL` / `LOCAL_STORAGE_DIR` / `TEMP_DIR` | `/data/glimmer/…` | 数据位置，一般不用改 |

> 本项目**没有** `SESSION_SECRET`：会话 Cookie 里放的是 32 字节随机 token，数据库只存它的 SHA-256 哈希，校验靠「算哈希查表」而非 HMAC 签名，因此不存在签名密钥这一环。

完整清单见仓库根目录的 [`.env.example`](https://github.com/praming/Glimmer/blob/main/.env.example) 与 README 的「配置」一节。

## 单独运行（仅供调试）

只想让后端起来看一眼时：

```bash
docker run -d --name glimmer-api \
  -p 3000:3000 \
  -v glimmer-data:/data/glimmer \
  -e ADMIN_PASSWORD=your-password \
  -e COOKIE_SECURE=false \
  praming/glimmer-api:latest

curl http://127.0.0.1:3000/api/health
```

⚠️ 这样只跑起了后端：**没有页面**。前端 SPA 是按**同源** `/api` 访问后端的，所以直接用浏览器访问 `3000` 端口仍可能被 CORS 拦住。生产部署请用上面的 compose 把两个容器一起跑。

## 运维命令

镜像内附带两个命令行工具，WAL 模式下可与运行中的 API 并存写入 —— **不必停服、不必删库**：

```bash
# 账号：列出 / 重置密码（忘记管理员密码时的官方通道；顺带撤销该账号的会话与令牌）
docker exec glimmer-api node apps/api/dist/cli/reset-password.js --list
docker exec glimmer-api node apps/api/dist/cli/reset-password.js admin '新密码'

# 直链：按当前域名与路径前缀重写历史图片的 URL（**默认 dry-run**，确认后加 --apply 才落库；只改 URL，不移动文件）
docker exec glimmer-api node apps/api/dist/cli/rebuild-urls.js
docker exec glimmer-api node apps/api/dist/cli/rebuild-urls.js --apply
```

## 标签与平台

| 标签 | 说明 |
| --- | --- |
| `latest` | 最新发布，对应最近的 `v*` tag |
| `1.0.0` … `1.0.5` | 固定版本；历史版本均保留，可随时回退（GitHub tag `v1.0.5` → 镜像 `1.0.5`） |

- **平台：仅 `linux/amd64`。** 目前没有 arm64 清单，ARM 设备（Apple Silicon、部分 NAS）`docker pull` 会报 `no matching manifest` —— 这类机器请在本地用仓库里的 Dockerfile 自行构建。
- 升级：`docker compose pull && docker compose up -d`。

## 相关链接

- 源码与完整文档（部署、配置、常见问题）：https://github.com/praming/Glimmer
- 前端镜像：https://hub.docker.com/r/praming/glimmer-web
- 许可证：AGPL-3.0
