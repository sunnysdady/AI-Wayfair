# Wayfair AI 运营中台

独立运行的 Wayfair 运营数据中台。页面只读取 PostgreSQL 中已保存的快照；服务端定时任务负责同步 Wayfair 订单、广告、Catalog 与 Microsoft Outlook 邮件。生产环境只使用仓库内的 Docker Compose 方案部署到现有 DigitalOcean Droplet。

DigitalOcean 完整操作手册见 [`docs/DIGITALOCEAN_DEPLOYMENT.md`](./docs/DIGITALOCEAN_DEPLOYMENT.md)。

## 固定生产地址

本项目的页面、API、静态内容和自动任务全部统一部署到 `https://aiwayfair.sunnysdady.com`。不得部署到
`sunnysdady.com` 根域或 `www.sunnysdady.com`，也不得为本项目修改这两个入口的
DNS、代理或 SSL 配置，也不得使用其他托管平台作为本项目的生产或同步部署目标。完整的仓库级约束见 [`AGENTS.md`](./AGENTS.md)。

## 运行架构

| 层 | 生产方案 |
|---|---|
| Web/API | DigitalOcean Droplet 上的 Next.js Docker 服务 |
| 定时任务 | Docker Scheduler 每 30 分钟调用 `/api/cron/sync` |
| 数据库 | DigitalOcean Managed PostgreSQL |
| 报告文件 | DigitalOcean Spaces（S3 兼容） |
| 邮件 | Microsoft Graph |

应用不通过其他托管平台读取或发布生产数据。

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

## AI 助理

一级菜单“AI 助理”打开 `/assistant`。它以对话形式检索 PostgreSQL 中已保存的 SKU 成本、最新库存、订单、广告动作、运营任务、报告和 Outlook 日报，并将本次命中的数据作为受限上下文交给已配置的大模型。

模型接入使用 OpenAI 兼容的 Chat Completions API，仅在服务器环境变量中配置：

```bash
AI_MODEL_BASE_URL=https://<provider>/v1
AI_MODEL_API_KEY=<server-only-api-key>
AI_MODEL_NAME=<model-name>
```

浏览器只调用 `POST /api/assistant/chat`，不会获得 API Key。接口只读、会限制消息大小与历史条数、要求同源请求；未配置模型或模型暂时不可用时，页面会明确退回数据库检索结果，而不会伪造模型回答。AI 助理不会向 Wayfair 执行写操作。

助手还包含从本机 `amazon ops` 项目筛选出的通用运营方法论：证据优先、问题优先级、单变量调整与观察期、动作反馈沉淀。它不读取 Amazon 的业务数据，也不会把 Amazon 的阈值或结论用于 Wayfair。

## 分层同步

`GET /api/cron/sync` 只接受：

```text
Authorization: Bearer <CRON_SECRET>
```

每 30 分钟同步当月订单和近三日 Outlook 日报；领星站点时间 06:00 的运行额外同步成熟周广告及 Catalog 前 10 页。Outlook 会扫描收件箱与所有名称含 “Wayfair” 的自定义文件夹，分页覆盖领星站点时间今天减两天的 00:00。

生产环境由 Docker Scheduler 每 30 分钟调用同一受保护端点，并保留幂等锁与失败记录。

## Product Management 中台导入

SKU 经营中心的 90 天商品指标来自中台导出的 Product Management 快照，不依赖紫鸟。导出文件须符合 `schemaVersion: 1` 与 `sourceWindow: "last_90_days"` 的格式；导入前会校验 Store ID、SKU/Part 去重、日期和数值边界。

```bash
AIWAYFAIR_ORIGIN=https://aiwayfair.sunnysdady.com \
AIWAYFAIR_CRON_SECRET='<CRON_SECRET>' \
node scripts/ingest-product-management-snapshot.mjs data/product-management-2026-08-05.json
```

该导入仅写入运营数据库的审计记录和最新只读快照；页面不会通过此路径向 Wayfair 写入商品、价格、库存或广告数据。

## 部署顺序

1. 将待发布提交推送到 GitHub，并在现有 DigitalOcean 应用目录快进更新。
2. 保留服务器 `.env.production`、PostgreSQL、Spaces 与 Microsoft Graph 配置。
3. 运行 `bash scripts/deploy-digitalocean.sh`，依次校验 Compose、构建镜像、执行迁移并更新 Web 与 Scheduler。
4. 访问 `/api/health` 和 `/api/system/readiness` 检查服务与只读数据源。
5. 确认未登录首页为 `401`、已登录首页为 `200`，并手工核对最近一次 Scheduler 同步。
6. 核对 Supplier ID 后，再按需启用库存或广告写入开关。

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
