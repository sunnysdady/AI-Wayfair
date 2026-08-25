# Wayfair AI 运营中台

独立运行的 Wayfair 运营数据中台。页面只读取 PostgreSQL 中已保存的快照；服务端定时任务负责同步 Wayfair 订单、广告、Catalog 与 Microsoft Outlook 邮件。当前支持 Vercel，也可使用仓库内的 Docker Compose 方案部署到 DigitalOcean Droplet 和自有域名。

DigitalOcean 完整操作手册见 [`docs/DIGITALOCEAN_DEPLOYMENT.md`](./docs/DIGITALOCEAN_DEPLOYMENT.md)。

## 固定生产地址

本项目以后统一部署到 `https://aiwayfair.sunnysdady.com`。不得部署到
`sunnysdady.com` 根域或 `www.sunnysdady.com`，也不得为本项目修改这两个入口的
DNS、代理或 SSL 配置。完整的仓库级约束见 [`AGENTS.md`](./AGENTS.md)。

## 运行架构

| 层 | 当前方案 | 自有服务器迁移 |
|---|---|---|
| Web/API | Next.js Node runtime on Vercel | Node.js 进程或 Docker |
| 定时任务 | Vercel Cron 调用 `/api/cron/sync` | Docker Scheduler 调用同一路由 |
| 数据库 | 托管 PostgreSQL | 托管或自建 PostgreSQL |
| 报告文件 | S3 兼容对象存储 | 同一存储或 MinIO |
| 邮件 | Microsoft Graph | 不变 |

应用不再通过 Sites 或 Cloudflare 代理读取生产数据。

## 本地启动

要求 Node.js 22.13 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run db:migrate:postgres
npm run dev
```

构建与验证：

```bash
npm run build
npm run lint
npm test
```

## 环境变量

完整模板见 [`.env.example`](./.env.example)。生产部署至少需要：

- `DATABASE_URL`：PostgreSQL 连接串。
- `S3_BUCKET`、`S3_REGION`：报告对象存储；非 AWS 服务再配置 `S3_ENDPOINT` 与路径风格。
- S3 必须配置访问密钥；只有使用 AWS IAM Role/OIDC 等默认凭证链时才显式设置 `S3_USE_DEFAULT_CREDENTIAL_CHAIN=true`。
- `CRON_SECRET`：保护定时同步端点的随机长字符串。
- `APP_ORIGIN`：固定为 `https://aiwayfair.sunnysdady.com`。
- `APP_ACCESS_USER`、`APP_ACCESS_PASSWORD`：生产页面和普通 API 的主 HTTP Basic 登录。生产环境缺少这两个变量时应用会拒绝访问。
- `APP_ACCESS_CREDENTIALS_JSON`：可选的额外 HTTP Basic 账号对象，例如 `{"xiaotong":"a-strong-password"}`；仅写入生产环境文件，主账号继续保留。
- Microsoft Graph：`MICROSOFT_CLIENT_ID`、`MICROSOFT_CLIENT_SECRET`，并选择：
  - 委托授权：配置 `MICROSOFT_REFRESH_TOKEN`；
  - 应用授权：配置 `OUTLOOK_MAILBOX_USER`，并在 Entra 中授予目标邮箱的 `Mail.Read` 应用权限。
- Wayfair Ops、Advertising、Catalog 的客户端凭证与 Supplier ID。
- `WAYFAIR_DEPLOYMENT_ENV=production` 与 `WAYFAIR_EXPECTED_SUPPLIER_IDS`。

库存和广告写入默认关闭。只有显式设置对应 `ALLOW_WAYFAIR_*` 开关、生产环境与 Supplier ID 均通过安全校验后才允许写入。

## 数据库迁移

首次连接空 PostgreSQL 数据库时执行：

```bash
DATABASE_URL='postgresql://…' npm run db:migrate:postgres
```

迁移器使用事务、PostgreSQL advisory lock 和 `schema_migrations` 账本，可安全重复执行。迁移文件位于 `migrations/postgres/`。

## 分层同步

`GET /api/cron/sync` 只接受：

```text
Authorization: Bearer <CRON_SECRET>
```

每两小时同步当月订单和近三日 Outlook 日报；上海时间 06:00 的运行额外同步成熟周广告及 Catalog 前 10 页。Outlook 会扫描收件箱与所有名称含 “Wayfair” 的自定义文件夹，分页覆盖上海时间今天减两天的 00:00。

`vercel.json` 已配置两小时一次的 Cron。若 Vercel 套餐不支持该频率，可用 GitHub Actions、Uptime Kuma 或自有服务器 cron 调用同一受保护端点。

## Product Management 中台导入

SKU 经营中心的 90 天商品指标来自中台导出的 Product Management 快照，不依赖紫鸟。导出文件须符合 `schemaVersion: 1` 与 `sourceWindow: "last_90_days"` 的格式；导入前会校验 Store ID、SKU/Part 去重、日期和数值边界。

```bash
AIWAYFAIR_ORIGIN=https://aiwayfair.sunnysdady.com \
AIWAYFAIR_CRON_SECRET='<CRON_SECRET>' \
node scripts/ingest-product-management-snapshot.mjs data/product-management-2026-08-05.json
```

该导入仅写入运营数据库的审计记录和最新只读快照；页面不会通过此路径向 Wayfair 写入商品、价格、库存或广告数据。

## 部署顺序

1. 创建 PostgreSQL 数据库与 S3 兼容 bucket。
2. 在本地执行 PostgreSQL 迁移。
3. 在 Vercel 配置 `.env.example` 中的生产变量。
4. 将 Microsoft Graph 应用配置为允许读取目标邮箱。
5. 部署后先访问 `/api/system/readiness` 检查只读数据源。
6. 手工调用一次受保护的 `/api/cron/sync`，确认订单、邮件、广告和 Catalog 快照。
7. 核对 Supplier ID 后，再按需启用库存或广告写入开关。

迁移到自有服务器时，保留 PostgreSQL、S3 和 Graph 配置；仓库内置的 Docker Scheduler 会按上海时间每两小时调用同一同步端点。

## DigitalOcean Droplet

仓库提供：

- `Dockerfile`：Next.js standalone、Scheduler 和 PostgreSQL Migrator 多阶段镜像；
- `docker-compose.production.yml`：Web、Scheduler、Caddy HTTPS 与迁移服务；
- `deploy/digitalocean/Caddyfile`：自有域名反向代理和安全响应头；
- `scripts/deploy-digitalocean.sh`：校验、构建、迁移和滚动更新入口；
- `/api/health`：供容器和外部监控使用的数据库健康检查。

服务器上完成 `.env.production` 后运行：

```bash
bash scripts/deploy-digitalocean.sh
```
