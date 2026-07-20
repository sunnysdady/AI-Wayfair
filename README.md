# Wayfair AI 运营中台

面向 Wayfair 店铺日常经营的全栈运营工作台。项目把订单、广告、商品目录、库存、运营计划和复盘资料集中到同一个界面，并通过明确的审批、预检和开关机制保护高风险写入操作。

> 当前项目以 **OpenAI Sites / Cloudflare Workers** 为主要运行环境，依赖 Cloudflare D1 和 R2。Vercel 可以完成 Next.js 构建，但尚不能提供完整的数据读写能力，详见[部署说明](#部署说明)。

## 核心能力

- **经营 Dashboard**：按日期查看收入、订单、销量、AOV、利润估算、趋势和热销 SKU。
- **广告分析与优化**：聚合 Campaign 与 Listing 表现，结合利润、库存、链接质量和阶段目标生成建议。
- **安全广告执行**：建议先进入执行队列，经人工确认和 Dry-run 预检后才允许调用 Wayfair Advertising API。
- **计划与复盘**：跟踪月度目标、SKU 责任、预算节奏、活动阶段及历史周度调整效果。
- **商品与库存**：读取 Wayfair Catalog，校验 XLSX 库存文件，生成快照并支持受控推送。
- **运营资料库**：管理 HTML、PDF 和 XLSX 报告，文件保存至 R2，索引信息保存至 D1。
- **Outlook 日报接入**：通过带 Bearer Token 的接口写入邮件摘要和待办事项。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Next.js 16、React 19、TypeScript |
| Cloudflare 构建 | vinext、Vite、Cloudflare Workers |
| 数据库 | Cloudflare D1、Drizzle ORM |
| 文件存储 | Cloudflare R2 |
| 表格处理 | ExcelJS |
| 测试 | Node.js Test Runner |

## 项目结构

```text
app/
├── OpsCenter.tsx          # 运营中台主界面
├── api/                   # 订单、广告、商品、库存、计划和报告 API
└── page.tsx               # 应用入口与页面元信息
data/                      # 经营基线与结构化业务数据
db/schema.ts               # D1 数据模型
drizzle/                   # 数据库迁移文件
lib/                       # 广告决策、库存映射、计划和运行时绑定
public/reports/            # 随项目发布的复盘资料
tests/                     # 业务规则、渲染与兼容性测试
worker/index.ts            # Cloudflare Worker 入口
.openai/hosting.json       # OpenAI Sites 的 D1/R2 绑定声明
vite.config.ts             # vinext 与本地 Cloudflare 运行环境
vercel.json                # Vercel 的 Next.js 构建配置
```

## 本地开发

### 环境要求

- Node.js `>= 22.13.0`
- npm
- 可用的 Wayfair API 凭证（只浏览静态复盘内容时可暂不配置）

### 安装与启动

```bash
git clone https://github.com/sunnysdady/AI-Wayfair.git
cd AI-Wayfair
npm install
npm run dev
```

本地服务由 vinext 和 Cloudflare Vite 插件启动。D1、R2 及 Wrangler 的本地状态保存在项目内的 `.wrangler/`，该目录不会提交到 Git。

## 环境变量

在项目根目录创建 `.env.local`。所有 `.env*` 文件均已被 Git 忽略，请勿提交真实密钥。

```dotenv
WAYFAIR_OPS_CLIENT_ID=
WAYFAIR_OPS_CLIENT_SECRET=

WAYFAIR_CATALOG_CLIENT_ID=
WAYFAIR_CATALOG_CLIENT_SECRET=
WAYFAIR_CATALOG_SUPPLIER_ID=
WAYFAIR_DEPLOYMENT_ENV=development
WAYFAIR_EXPECTED_SUPPLIER_IDS=

WAYFAIR_AD_CLIENT_ID=
WAYFAIR_AD_CLIENT_SECRET=

OUTLOOK_INGEST_TOKEN=

ALLOW_WAYFAIR_LIVE_PUSH=false
ALLOW_WAYFAIR_AD_LIVE_CHANGES=false
```

当前 `vite.config.ts` 从进程环境读取这些值。启动本地服务前，将文件内容加载到当前终端：

```bash
set -a
source .env.local
set +a
npm run dev
```

<!-- AUTO-GENERATED: ENVIRONMENT -->
| 变量 | 必需条件 | 用途 |
| --- | --- | --- |
| `WAYFAIR_OPS_CLIENT_ID` | 使用订单或库存接口 | Wayfair Orders / Inventory OAuth Client ID |
| `WAYFAIR_OPS_CLIENT_SECRET` | 使用订单或库存接口 | Wayfair Orders / Inventory OAuth Client Secret |
| `WAYFAIR_CATALOG_CLIENT_ID` | 使用商品目录接口 | Wayfair Catalog OAuth Client ID |
| `WAYFAIR_CATALOG_CLIENT_SECRET` | 使用商品目录接口 | Wayfair Catalog OAuth Client Secret |
| `WAYFAIR_CATALOG_SUPPLIER_ID` | 使用商品目录接口 | 数字格式的 Supplier ID |
| `WAYFAIR_DEPLOYMENT_ENV` | 正式写入必需 | 只有精确设为 `production` 且运行于 Cloudflare 才可通过生产闸门 |
| `WAYFAIR_EXPECTED_SUPPLIER_IDS` | 正式写入必需 | 允许写入的 Supplier ID 逗号分隔清单；Catalog Supplier ID 必须属于该清单 |
| `WAYFAIR_AD_CLIENT_ID` | 使用广告接口 | Wayfair Advertising OAuth Client ID |
| `WAYFAIR_AD_CLIENT_SECRET` | 使用广告接口 | Wayfair Advertising OAuth Client Secret |
| `OUTLOOK_INGEST_TOKEN` | 写入 Outlook 日报 | `/api/email/daily` POST 请求的 Bearer Token |
| `ALLOW_WAYFAIR_LIVE_PUSH` | 可选，默认关闭 | 设为 `true` 后才允许正式推送库存 |
| `ALLOW_WAYFAIR_AD_LIVE_CHANGES` | 可选，默认关闭 | 设为 `true` 后才允许正式修改广告 |
<!-- END AUTO-GENERATED: ENVIRONMENT -->

## 常用命令

<!-- AUTO-GENERATED: PACKAGE SCRIPTS -->
| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 vinext 本地开发环境 |
| `npm run build` | 生成 Cloudflare / vinext 生产构建 |
| `npm run start` | 启动已构建的 vinext 应用 |
| `npm test` | 先构建，再执行全部 Node.js 测试 |
| `npm run lint` | 运行 ESLint，忽略构建产物目录 |
| `npm run db:generate` | 根据 `db/schema.ts` 生成 Drizzle 迁移 |
| `npx next build` | 验证标准 Next.js / Vercel 构建兼容性 |
<!-- END AUTO-GENERATED: PACKAGE SCRIPTS -->

## API 概览

| 路径 | 方法 | 功能 |
| --- | --- | --- |
| `/api/orders/summary` | GET | 同步并汇总指定日期范围内的订单 |
| `/api/ads/analysis` | GET | 生成广告周期分析与 Listing 建议 |
| `/api/ads/actions` | GET / POST / PATCH / DELETE | 管理广告执行队列和审批状态 |
| `/api/ads/actions/execute` | POST | 执行 Dry-run 或受控广告写入 |
| `/api/ads/history` | GET | 查看周度广告调整及复查记录 |
| `/api/catalog/items` | GET | 查询 Catalog 商品和近 30 天表现 |
| `/api/inventory/preview` | GET / POST | 校验 XLSX 并保存库存快照 |
| `/api/inventory/push` | POST | Dry-run 或受控推送库存 |
| `/api/plan/progress` | GET | 返回当前计划、进度、活动和下一阶段目标 |
| `/api/reports` | GET / POST / DELETE | 管理补充报告 |
| `/api/reports/file` | GET | 从 R2 安全读取报告文件 |
| `/api/email/daily` | GET / POST | 读取或写入 Outlook 运营日报 |

## 数据与安全边界

- `.openai/hosting.json` 声明 `DB`（D1）和 `FILES`（R2）绑定。
- 订单、广告缓存、执行队列、库存快照和日报元数据写入 D1。
- 用户上传的 HTML、PDF、XLSX 报告写入 R2；单文件上限为 20 MB。
- 库存与广告正式写入默认关闭，必须同时满足 Cloudflare production 环境、Supplier 身份清单、独立写入开关、人工确认文字和接口校验。
- 广告接口仅自动执行代码明确支持的动作；其余变更应在 Wayfair Partner Home 中人工完成。
- HTML 报告响应带有受限 CSP，文件名和输入参数在服务端进行校验。

## 部署说明

### OpenAI Sites / Cloudflare Workers（推荐）

这是项目的完整运行环境。部署时需要为应用配置：

1. D1 绑定 `DB`；
2. R2 绑定 `FILES`；
3. 所需 Wayfair API 密钥；
4. 按需配置正式写入开关。

数据库结构以 `db/schema.ts` 和 `drizzle/` 中的迁移为准。生产环境启用写操作前，应先完成数据库迁移并验证 Dry-run。

### Vercel（暂不作为生产环境）

`vercel.json` 使用 `npx next build`，因此项目可以通过 Vercel 的构建阶段。但 Vercel 没有原生 D1/R2 绑定，依赖数据库或文件存储的 API 会返回明确的不可用错误，完整运营功能无法正常工作。

在为 Vercel 配置等价的持久化数据库和对象存储之前，请不要把 Vercel 部署提升为本项目的生产版本。

## 验证清单

提交代码前建议运行：

```bash
npm run lint
npm test
npx next build
npm audit --omit=dev --audit-level=high
```

## 仓库

- GitHub：[sunnysdady/AI-Wayfair](https://github.com/sunnysdady/AI-Wayfair)
- 当前状态：内部运营项目，未声明开源许可证。
