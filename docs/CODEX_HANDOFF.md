# Codex 接力文档 — Wayfair AI 运营中台

> 写给下一个接手的 Codex / 工程师。读完这份应能不回头问上一任，直接开工。
> 生成时间：2026-09-19 12:10 JST（Asia/Shanghai 同日 11:10）
> 上一任上下文来源：Grok 在本项目会话里完成的库存映射 / 领星接入 / 生产部署，加上 GitHub `production` 与 `main` 的实时状态。

---

## 0. 先读这 20 行（否则会改错仓库）

1. **真正在跑的生产代码在 `production` 分支，不是 `main`。**
2. **唯一生产域名：`https://aiwayfair.sunnysdady.com`。** 库存页：`https://aiwayfair.sunnysdady.com/?view=products&tab=inventory`
3. **唯一生产机器：DigitalOcean Droplet `codex-calm-forge-8d48` / `wayfair-ai-ops-prod`，目录 `/opt/wayfair-ai-ops`，SSH 别名 `wayfair-production`，用户 `deploy`。**
4. **唯一发布命令：工作树干净后 `bash scripts/release-digitalocean.sh`。** 服务器侧执行 `sudo /usr/local/sbin/wayfair-deploy <full-sha>`。
5. **禁止**部署到 `sunnysdady.com` / `www.sunnysdady.com`，禁止新建 `ops.*` 或第二套生产。
6. **Vercel 与 OpenAI Sites 已暂停同步。不要删、不要覆盖、不要重新开通，除非用户明确要求。**
7. **`main` 是另一套 Cloudflare Workers / vinext / D1 / R2 骨架**，和线上 Droplet 的 Next.js + PostgreSQL 不是同一棵树。改 `main` 不会上生产。
8. 仓库规则全文：`AGENTS.md`（`production` 分支）。架构图：`docs/architecture.md`。部署手册：`docs/DIGITALOCEAN_DEPLOYMENT.md`。
9. 生产密钥只在服务器 `/opt/wayfair-ai-ops/.env.production`（权限 `600`）。禁止提交、打印、写进普通日志。
10. 库存 / 广告正式写入默认关闭。改 `ALLOW_WAYFAIR_*` 必须用户单独批准。

---

## 1. 当前指针（2026-09-19 核对）

| 位置 | SHA | 说明 |
|---|---|---|
| GitHub `production` HEAD（本文档推入前） | `8cd81f7e4cfb0f6fa6be4e251df45e63971d7ffb` | 线上应跑的代码源。最近提交是架构图 + 共享领星快照 + 15 分钟 TRUE_UP |
| GitHub `main` HEAD | `8d582cfa3b1f200d6d5474970cb017b7099dafbc` | 只在 `main` 放了架构图，避免打开默认分支看不到。**不是生产。** |
| 历史生产修复（已合入 `production`） | `6292497e3cc3c2a46ffc5ef7522a8dbd0e3bd1cf` | 领星 sync 路由补类型，修掉 `80f047e` 的 Next 生产构建 implicit any |
| 第一次领星生产尝试（已回滚） | `80f047e` | Next build 失败，回滚到 `9adf4cb` 后再上 typed 修复 |

GitHub：https://github.com/sunnysdady/AI-Wayfair

接手第一步必须是：

```bash
git clone https://github.com/sunnysdady/AI-Wayfair.git
cd AI-Wayfair
git fetch --all --prune
git checkout production
git pull --ff-only origin production
git log -1 --oneline
```

不要在 Grok 留下的 `artifacts/AI-Wayfair`（`main` + vinext）上继续改生产功能。

---

## 2. 系统是什么

独立的 Wayfair 店铺运营中台（店：YB / 供应商广州 youbao 等）。页面只读 PostgreSQL 快照；写 Wayfair 必须过安全闸门。

生产栈（`production` 分支）：

| 层 | 实现 |
|---|---|
| Web / API | Next.js 16 + React 19，Docker，Caddy 终止 TLS，端口 3000 |
| 定时 | Docker Scheduler 每 15 分钟 `GET /api/cron/sync`，Bearer `CRON_SECRET` |
| 库 | DigitalOcean Managed PostgreSQL；迁移在 `migrations/postgres/`，命令 `npm run db:migrate:postgres` |
| 文件 | DigitalOcean Spaces（S3 兼容） |
| 邮件 | Microsoft Graph |
| 库存源 | **供应链看板** systemd 每 15 分钟写 `/var/lib/lingxing/inventory-raw.json`；本中台 20 分钟内只读，过期才回退领星 OpenAPI |
| 写 Wayfair 库存 | dry-run 通过后 TRUE_UP（全量 Part × 仓，缺的补 0）。SKU×仓数量指纹不变则跳过 |
| 登录 | HTTP Basic：`APP_ACCESS_USER` / `APP_ACCESS_PASSWORD`，可选 `APP_ACCESS_CREDENTIALS_JSON` |
| AI 助理 | `/assistant`，服务端 OpenAI 兼容 Chat Completions，只读库，不写 Wayfair |

姐妹项目（同一台 Droplet，不要混仓改）：

- 供应链看板：https://github.com/sunnysdady/supply-chain-workbench
- 看板负责 **唯一主路径拉领星库存** 和店级销售。本中台不抢领星配额（1.05s 节流，429 本轮跳过）。

`main` 分支是另一套：vinext + Cloudflare Workers + D1 + R2 + OpenAI Sites。本地 `npm run dev` 是 vinext，不是 `next dev`。那套现在不是生产。

---

## 3. 最近业务事实（必须继承，不要回滚）

### 3.1 丢单 SKU 解冻（2026-09-17）

用户要求解除 Wayfair 报表 `347069.xlsx` 里这些 SKU 的库存同步冻结（供应商 347069 广州 youbao）：

| Wayfair Part | 市场 | 正确领星 SKU | 备注 |
|---|---|---|---|
| MFC-D3-W / MFC-D3W | US+CA | `B01PF-002WMJ` | 非 J 后缀的 `B01PF-002WM` 四仓都是 0 |
| MFC-D3-B / MFC-D3B | US | `B01PF-002BMJ` | 真库存在 J 后缀 |
| MFC-D2B / MFC-D2-B | US | `B01PF-001BMJ` | 同上 |
| MFC-D2W / MFC-D2-W | — | `B01PF-001WMJ` | 一并改了，避免白柜漏映射 |
| 4T-Kayak | US | **不要映射** | `B01KS-003BM` 四仓真 0。生产 commit `86fdf567` 已 unlink，让平台库存保持 0。8T `B01KS-004BM` 在 LA10 有货（当时 85） |

领星当日库存文件：`库存明细-仓库库存-20260917-959019149317464064.xlsx`（会话提供，不在 Git）。

### 3.2 仓库折叠

派速捷 `MSNJ01仓` 有大量未映射库存。生产把 MSNJ01 **并进** Wayfair supplier `360343`（XHNJ02）：

- `production` 写法：`warehouse: "派速捷 XHNJ02仓|派速捷 MSNJ01仓"`（pipe 分隔，数量求和）。相关 commit：`9d741a93`、`9adf4cba`
- `main` 写法：`aliases: ["派速捷 MSNJ01仓", ...]`。两套映射文件形状不同，**改生产请按 pipe 格式**

仓库对照（生产）：

| supplierId | 领星仓 |
|---|---|
| 360344 | 派速捷 美东南 GA 亚特兰大2仓 |
| 360342 | 派速捷 LA10仓 |
| 360343 | 派速捷 XHNJ02仓 \| 派速捷 MSNJ01仓 |
| 347072 | 派速捷 美南HOU04 |
| 360346 | 派速捷 美东南 GA 亚特兰大2仓 |

### 3.3 领星接入时间线（不要重复踩坑）

1. `80f047e` 第一次把领星拉库存合进生产 → **Next 生产构建因 implicit any 失败** → 回滚 `9adf4cb`
2. `6292497e` typed 修复，构建通过
3. `17463d13` / `092e9fc3` cron 每 15 分钟自动 TRUE_UP（先 dry-run）
4. `67abb572` 领星 1 次/秒节流；数量指纹不变不推 Castle
5. `ec89a457` 库存页看板主卡 + 成本侧栏
6. `07ef5314` 20 分钟内读 `/var/lib/lingxing/inventory-raw.json`
7. `8cd81f7` 文档与架构图

库存失败 **不得** 中断订单同步。

---

## 4. 开工命令

本地（`production` 分支）：

```bash
node -v          # >= 22.13.0
npm install
cp .env.example .env.local
npm run lint
npm test         # 先 next build 再 node --test tests/*.test.mjs
```

只读看生产状态：

```bash
ssh wayfair-production 'sudo -n /usr/local/sbin/wayfair-deploy status'
curl -fsS https://aiwayfair.sunnysdady.com/api/health    # {"status":"ok"}
curl -I https://aiwayfair.sunnysdady.com/                 # 未登录 401
```

发布：

```bash
bash scripts/release-digitalocean.sh
```

脚本会：拒绝脏工作树 → 只允许快进 `origin/production` → 核对远程完整 SHA → `ssh wayfair-production` → `sudo -n /usr/local/sbin/wayfair-deploy '<sha>'`。

服务器部署会加互斥锁、备份 PostgreSQL、记逐表行数、跑迁移和 Scheduler、验健康。**应用启动失败会回滚上一版镜像；数据库迁移不会自动反向回滚。**

Docker compose 注意：不要把 `--parallel 1` 当服务名传；用 `COMPOSE_PARALLEL_LIMIT`（已修，`cedca24c`）。

---

## 5. 代码地图（生产分支）

| 路径 | 职责 |
|---|---|
| `AGENTS.md` | 仓库级部署禁令 |
| `app/api/inventory/sync` | 领星/共享快照 → 映射 → 快照入库 |
| `app/api/inventory/push` | dry-run / 受控 TRUE_UP |
| `app/api/cron/sync` | Scheduler：库存 → 订单 → 邮件；（上海 06:00）广告 + Catalog 前 10 页 |
| `lib/inventory-mapping.json` | Part ↔ 领星 SKU，仓 ↔ supplierId |
| `scripts/release-digitalocean.sh` | 唯一发布入口 |
| `migrations/postgres/` | 正向迁移 |
| `tests/*.test.mjs` | 改规则先补失败用例 |
| `docs/architecture.md` | 共享快照 + TRUE_UP + cron 分层图 |
| `docs/DIGITALOCEAN_DEPLOYMENT.md` | 机器、DNS、备份、验收 |
| `CHANGELOG.md` | 正式版本叙事，停在 0.3.0 / 2026-08-27，**未包含 9 月库存工作** |

---

## 6. 安全闸门

同时满足才允许 live：`WAYFAIR_DEPLOYMENT_ENV=production`；`WAYFAIR_EXPECTED_SUPPLIER_IDS` 包含 Catalog Supplier ID；凭证齐全；对应 `ALLOW_WAYFAIR_*`；库存 supplierId 全在白名单；TRUE_UP 全量补零。

Cron 自动 TRUE_UP 已在生产打开，但改逻辑必须保持：指纹不变跳过、429 跳过本轮、库存失败不挡订单。

---

## 7. 未完成 / 已知坑

1. `CHANGELOG.md` 没写 9 月库存工作。
2. `main` 与 `production` 分叉严重，不要暴力合并。新功能只进 `production`。
3. **4T-Kayak 保持 unlink。** 补 `B01KS-003BM` 会把 0 库存 SKU 重新推上架。
4. 非 J 后缀抽屉 SKU 四仓为 0 是常态。映射必须指向 `*J`。
5. 领星限流：看板是主路径；回退 OpenAPI 必须 1.05s 间隔。
6. TRUE_UP 指纹按 SKU×仓数量，不是总件数。
7. 生产是 `next build`。`route.ts` implicit any 会让镜像构建失败。
8. 供应商 347069 是店铺/报表编号，不是 `warehouseMappings` 里的 Wayfair 仓 supplierId（36034x / 347072）。

---

## 8. Codex 公约

- 先写失败测试，再改规则。
- 不打印生产密钥。
- 不改 `sunnysdady.com` DNS / SSL。`aiwayfair` DNS 保持 DNS only。
- 用户没点头不要开广告 live、不要开 Product Addition live、不要把 4T-Kayak 映射回去。
- 发布前工作树干净；用 `release-digitalocean.sh`。

---

## 9. 验收

```bash
npm run lint
npm test
curl -fsS https://aiwayfair.sunnysdady.com/api/health
curl -I https://aiwayfair.sunnysdady.com/
```

- 库存页：MFC-D3-W / D3-B / D2B 应对上 J 后缀数量
- 4T-Kayak 仍为 0
- 订单同步在库存失败时仍继续

---

## 10. 给 Codex 的第一句提示词

```text
你在接手 sunnysdady/AI-Wayfair。只在 production 分支工作。
生产域名 https://aiwayfair.sunnysdady.com，发布用 bash scripts/release-digitalocean.sh。
先 git fetch && git checkout production && 读 AGENTS.md、docs/architecture.md、docs/CODEX_HANDOFF.md。
不要改 main，不要动 sunnysdady.com，不要把 4T-Kayak 映射回 B01KS-003BM。
MFC 抽屉必须映射 *J 后缀；MSNJ01 库存并进 360343。
写 Wayfair 必须过 ALLOW_* 闸门；库存推送是 TRUE_UP 全量补零。
确认当前 HEAD，然后问我这一轮要改什么。
```

---

## 11. 文档位置

- `docs/CODEX_HANDOFF.md` @ `production`（本文件）
- `AGENTS.md` 仍是部署禁令的权威来源；本文件补业务上下文与当前 SHA
