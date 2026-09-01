# DigitalOcean Droplet 生产部署

> 固定生产域名：`aiwayfair.sunnysdady.com`。本项目不得部署到
> `sunnysdady.com` 根域或 `www.sunnysdady.com`。

本文对应当前的独立 Node.js 运行时，不使用 Sites、D1、R2 或 Vercel 代理。推荐结构如下：

```text
你的域名
   │ HTTPS
   ▼
Caddy（Droplet）
   │
Next.js Web/API ───── DigitalOcean Managed PostgreSQL
   │
   ├──────────────── DigitalOcean Spaces（私有报告文件）
   │
   ├──────────────── Wayfair API
   │
   └──────────────── Microsoft Graph

Scheduler（Droplet）每 30 分钟调用受 CRON_SECRET 保护的同步接口
```

## 1. 购买清单

所有资源放在 `NYC3`，减少内网延迟和跨区流量。

| 资源 | 起步规格 | 当前参考月费 | 用途 |
|---|---:|---:|---|
| Droplet | Basic Shared CPU，2 vCPU / 4 GiB / 80 GiB | US$24 | Web、Caddy、Scheduler |
| Managed PostgreSQL | 1 GiB 单节点 | US$15 起 | 订单、广告、Catalog、日报和任务 |
| Spaces Standard | 私有 bucket | US$5 | HTML、PDF、XLSX 报告 |
| 合计 | 不含税和可选备份 | 约 US$44 起 | |

单节点 PostgreSQL 适合当前规模，但不是高可用集群。正式业务稳定后再升级为带 standby 的 HA 方案。不要把 PostgreSQL 唯一副本放在 Droplet 本地磁盘。

## 2. 创建 Droplet

在 DigitalOcean 控制台执行：

1. 新建 Project：`wayfair-ai-ops-prod`。
2. Marketplace 选择 DigitalOcean 官方 `Docker` 1-Click。
3. Region 选择 `New York / NYC3`。
4. 规格选择 `2 vCPU / 4 GiB / 80 GiB`。
5. Authentication 只选 SSH Key，不启用密码登录。
6. Hostname 填 `wayfair-ai-ops-prod`。
7. 启用 Monitoring；生产稳定后按需要开启 Droplet Backups。
8. 创建并绑定 Reserved IP，域名始终指向该 IP，后续更换 Droplet 不必改 DNS。

创建 DigitalOcean Cloud Firewall 并绑定 Droplet：

| 方向 | 协议/端口 | 来源 |
|---|---|---|
| Inbound | SSH 22 | 仅你的固定公网 IP |
| Inbound | HTTP 80 | All IPv4 / IPv6 |
| Inbound | HTTPS 443 | All IPv4 / IPv6 |
| Outbound | All | All |

不要向公网开放 PostgreSQL 端口。

## 3. 创建 Managed PostgreSQL

1. Databases → Create Database Cluster。
2. 选择 PostgreSQL，Region 选 `NYC3`，起步使用 1 GiB 单节点。
3. 名称建议 `wayfair-postgres-prod`。
4. 创建后进入 Network Access / Trusted Sources，把 Droplet 加为可信来源。
5. 使用数据库的 **private connection string**，并保留 `sslmode=require`。
6. 将该连接串填入服务器 `.env.production` 的 `DATABASE_URL`。

数据库迁移由部署脚本在每次上线前执行。迁移器有事务、advisory lock 和迁移账本，可重复运行。

## 4. 创建 Spaces

1. Spaces Object Storage → Create Bucket。
2. Region 选 `NYC3`，名称建议 `wayfair-ai-ops-prod`。
3. File Listing 保持 Restricted，不开启公开文件列表。
4. 开启 Object Versioning，便于误删恢复。
5. Access Keys → Create Access Key，为这个 bucket 创建单独的 `Read/Write/Delete` limited key。
6. 将 key 和 secret 只填入服务器 `.env.production`，不要提交 Git。

对应配置：

```dotenv
S3_BUCKET=wayfair-ai-ops-prod
S3_REGION=us-east-1
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_ID=填 Spaces Key
S3_SECRET_ACCESS_KEY=填 Spaces Secret
S3_USE_DEFAULT_CREDENTIAL_CHAIN=false
```

`S3_REGION` 使用 `us-east-1` 是 DigitalOcean 对 JavaScript AWS SDK 的官方兼容配置；实际机房由 `S3_ENDPOINT` 的 `nyc3` 决定。

## 5. 域名

在域名 DNS 服务中新增：

```text
Type: A
Name: aiwayfair
Value: 104.236.233.106
TTL: Auto
```

最终域名固定为 `aiwayfair.sunnysdady.com`。Cloudflare 记录保持 DNS only。只有为
该主机验证 Full (strict) 源站规则后才允许开启代理；不得修改全站 SSL 模式，
以免影响根域、`www` 或现有 Shoplazza 服务。

Caddy 会在 80/443 可访问且 DNS 生效后自动申请和续期 HTTPS 证书。

## 6. 把代码放到服务器

当前生产代码必须先提交并快进推送到 GitHub `production`。该分支是唯一生产代码备份与部署来源；历史 `main` 不作为服务器部署输入。私有仓库给服务器配置只读 GitHub Deploy Key，不要把个人 Token 写进命令历史。

首次引导可以通过 DigitalOcean 控制台登录；完成专用 SSH 后不再把网页控制台作为日常部署通道：

```bash
ssh root@<Droplet Reserved IP>
docker version
docker compose version
```

创建无密码、无通用 sudo 权限的普通部署用户；生产仓库与密钥仍由 root 持有：

```bash
adduser --disabled-password --gecos "" deploy
mkdir -p /opt/wayfair-ai-ops
chown root:root /opt/wayfair-ai-ops
```

把本机项目专用公钥加入 `deploy` 用户的 `authorized_keys`，并在本机 `~/.ssh/config` 固定主机身份：

```sshconfig
Host wayfair-production
  HostName <Droplet Reserved IP>
  User deploy
  IdentityFile ~/.ssh/aiwayfair_deploy
  IdentitiesOnly yes
```

服务器 root 配置只读 GitHub Deploy Key 后：

```bash
git clone --branch production --single-branch git@github.com:sunnysdady/AI-Wayfair.git /opt/wayfair-ai-ops
cd /opt/wayfair-ai-ops
cp .env.example .env.production
chmod 600 .env.production
```

安装仓库内受审计的发布包装器和最小 sudo 规则：

```bash
install -o root -g root -m 0755 deploy/digitalocean/wayfair-deploy /usr/local/sbin/wayfair-deploy
visudo -cf deploy/digitalocean/wayfair-deploy.sudoers
install -o root -g root -m 0440 deploy/digitalocean/wayfair-deploy.sudoers /etc/sudoers.d/wayfair-deploy
```

`deploy` 用户不能读取 `.env.production`、不能直接操作 Docker，也没有通用 root 权限；它只能请求包装器部署 GitHub `production` 当前完整 SHA。包装器本身验证固定仓库地址和远程分支后，才以 root 执行目标提交中的部署脚本。

## 7. 配置生产变量

编辑 `.env.production`，至少完成以下内容：

```dotenv
APP_DOMAIN=aiwayfair.sunnysdady.com
APP_ORIGIN=https://aiwayfair.sunnysdady.com
DATABASE_URL=postgresql://...private.../defaultdb?sslmode=require
DATABASE_POOL_MAX=5

CRON_SECRET=至少32字节的随机值
APP_ACCESS_USER=operator
APP_ACCESS_PASSWORD=独立的高强度密码
APP_ACCESS_CREDENTIALS_JSON={}

S3_BUCKET=wayfair-ai-ops-prod
S3_REGION=us-east-1
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_USE_DEFAULT_CREDENTIAL_CHAIN=false

WAYFAIR_DEPLOYMENT_ENV=production
WAYFAIR_EXPECTED_SUPPLIER_IDS=...
ALLOW_WAYFAIR_AD_LIVE_CHANGES=false
ALLOW_WAYFAIR_LIVE_PUSH=false
```

然后补齐 Wayfair Ops、Advertising、Catalog 凭证和 Microsoft Graph 凭证。

如果 Outlook 是个人 Microsoft Account，使用 delegated refresh token；如果是 Microsoft 365 工作/学校邮箱，可使用应用权限并配置 `OUTLOOK_MAILBOX_USER`。不要把 Codex Outlook 连接器当作服务器生产凭证。

生成随机值可使用：

```bash
openssl rand -base64 48
```

## 8. 固定发布

日常发布只从本地干净仓库执行：

```bash
bash scripts/release-digitalocean.sh
```

脚本会依次：

1. 拒绝本地未提交文件，并要求远程 `production` 只能快进；
2. 先将当前完整 Commit SHA 推送并读回核验，确保 Git 已保存待部署代码；
3. 通过 `wayfair-production` 专用 SSH 通道调用该 SHA 对应的部署脚本；
4. 服务器获取部署锁，拒绝生产漂移，只允许保留 `backups/` 与 `DEPLOYED_SHA`；
5. 记录旧 SHA、逐表行数、对象数，并在迁移前生成 PostgreSQL 备份；
6. 构建固定 SHA 镜像、运行迁移、启动 Web、Scheduler、Caddy、PostgreSQL 与 MinIO；
7. 验证 `/api/health` 为 `200`、未登录首页为 `401`，并执行一次 Scheduler 同步；
8. 成功后原子写入 `DEPLOYED_SHA`；应用启动失败时恢复上一版应用，数据库迁移不自动反向回滚。

## 9. 上线验收

数据库健康检查无需 Basic 登录，但只返回 `ok/unavailable`：

```bash
curl -fsS https://aiwayfair.sunnysdady.com/api/health
```

预期：

```json
{"status":"ok"}
```

检查页面保护：

```bash
curl -I https://aiwayfair.sunnysdady.com/
```

未带凭证时应返回 `401`。浏览器访问域名后使用 `APP_ACCESS_USER` / `APP_ACCESS_PASSWORD` 登录。

查看服务：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 web
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 scheduler
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 caddy
```

手工触发一次同步：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec scheduler node scripts/run-scheduled-sync.mjs
```

确认订单、近三日邮件快照写入成功；领星站点时间 06:00 的任务还会同步成熟周广告和 Catalog。

## 10. 后续更新与回滚

更新：

```bash
cd /opt/wayfair-ai-ops
git fetch origin
git checkout main
git pull --ff-only
bash scripts/deploy-digitalocean.sh
```

部署脚本拒绝 dirty worktree，并使用 Git commit 作为镜像标签。回滚时切回已验证 commit，再执行同一个部署脚本：

```bash
git checkout <已验证的commit>
bash scripts/deploy-digitalocean.sh
```

数据库迁移应保持向前兼容；涉及破坏性数据库变更时，必须先从 Managed PostgreSQL 备份恢复演练。

## 11. 正式切流前的硬门槛

- PostgreSQL 基线迁移成功。
- 旧 D1/R2 历史数据已迁移，或明确批准从空库重新同步。
- Spaces 私有读写测试成功。
- `/api/health` 连续正常。
- 首页未授权访问返回 401。
- 手工同步成功，且没有打印凭证。
- Supplier ID 完全核对。
- 广告和库存 live 开关继续保持 `false`，直到 Dry-run 验证完成。
- 域名切换前保留旧系统只读窗口，至少观察一个完整同步周期。
