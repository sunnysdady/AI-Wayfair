# 项目部署规则

## 固定生产入口

- 本项目唯一生产域名是 `aiwayfair.sunnysdady.com`。
- 以后新增、更新和迁移的页面、API、静态内容与自动任务都部署到这个域名对应的现有 DigitalOcean 服务。
- 禁止把本项目部署到 `sunnysdady.com` 根域或 `www.sunnysdady.com`，也不要修改这两个入口的 DNS、代理或 SSL 配置。
- 不再新建 `ops.*`、临时生产域名或第二套生产服务；预览环境必须明确标注为非生产。
- Vercel 与 OpenAI Sites 暂停同步部署。保留两边现有数据、项目、配置、部署记录、构建产物和代码框架，不得删除、覆盖、重置或清空。
- 只有用户明确要求恢复 Vercel 或 Sites 部署时才允许重新同步，恢复前必须先核对现有数据与配置。

## 固定服务器

- DigitalOcean Droplet：`codex-calm-forge-8d48`。
- 应用目录：`/opt/wayfair-ai-ops`。
- HTTPS 与反向代理：Caddy。
- PostgreSQL 与 MinIO 只在 Docker 私有网络中访问，不向公网开放。
- Cloudflare 的 `aiwayfair` DNS 记录保持 DNS only；除非已为该主机验证 Full (strict) 源站规则，否则不要开启代理。不得为此修改全站 SSL 模式。

## 完整部署定义

生产部署必须同时包含：

1. 当前仓库的完整 Web/API 代码；
2. 旧生产库的全部结构化数据及报告文件；
3. Wayfair Ops、Advertising、Catalog 与 Microsoft Graph 的服务器端生产配置；
4. 服务器端静默 Scheduler，并保留幂等锁和失败记录；
5. 迁移前后逐表记录数与对象文件数量核对。

只有代码上线但业务表为空、生产凭证缺失或 Scheduler 未启用时，不得称为“全量部署完成”。

## 安全与验收

- 生产密钥只保存在服务器 `/opt/wayfair-ai-ops/.env.production`，权限必须为 `600`；禁止提交、打印或写入普通日志。
- 默认保持 `ALLOW_WAYFAIR_AD_LIVE_CHANGES=false` 和 `ALLOW_WAYFAIR_LIVE_PUSH=false`，除非用户单独批准生产写操作。
- 每次部署后至少验证：
  - `https://aiwayfair.sunnysdady.com/api/health` 返回 `200`；
  - 未登录首页返回 `401`；
  - 已登录首页返回 `200`；
  - Scheduler 容器健康，最近一次静默同步有成功记录；
  - 订单、广告、Catalog、库存、日报和报告文件均有迁移/同步核对结果。
