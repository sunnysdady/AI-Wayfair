# AI-Wayfair

Wayfair 店铺运营接手与诊断项目。

线上入口：https://ai-wayfair.vercel.app  
版本日志：[CHANGELOG.md](CHANGELOG.md)  
接力文档：[docs/Wayfair_接力文档_20260606.md](docs/Wayfair_接力文档_20260606.md)

---

## 使用顺序

1. 先打开 `reports/Wayfair_运营执行中心_20260605.html`，看本周 P0 / P1 执行任务。
2. 需要看全量动作时，打开 `reports/Wayfair_SKU任务清单_20260605.html`。
3. 需要复核单个 SKU 时，打开 `reports/Wayfair_SKU经营档案_20260605.html`。
4. 证据层再打开定价体检、促销准入、库存映射、广告调整等报告。

---

## 目录结构

```
AI-Wayfair/
├── index.html                  # Vercel 首页 / Dashboard 导航
├── CHANGELOG.md                # 版本更新日志
├── reports/                    # 所有 HTML 报告（已套 Dashboard shell）
│   └── assets/
│       ├── dashboard-shell.css # 统一侧栏/顶栏/面板样式
│       └── dashboard-shell.js  # 统一交互脚本（含表格 min-width 注入）
├── scripts/                    # 报告生成脚本
│   ├── build_ops_workbench.py       # 生成执行中心 / 任务清单 / SKU档案
│   ├── apply_dashboard_shell.py     # 给 HTML 套统一 Dashboard 框架
│   ├── build_product_pricing_health.py   # 生成定价体检表
│   └── rebuild_sku_promo_readiness.py    # 生成促销准入清单
├── docs/                       # 接力文档、知识库、操作口径（Markdown）
├── data/                       # 脱敏 SKU 汇总 CSV（可提交）
└── data/raw/                   # 原始数据（已 gitignore，禁止提交）
```

---

## 当前报告清单（v0.3 · 2026-06-06）

### 核心入口（每日必看）

| 报告 | 说明 |
|------|------|
| `Wayfair_运营执行中心_20260605.html` | P0/P1 任务聚合，每日第一入口 |
| `Wayfair_SKU任务清单_20260605.html` | 全量任务清单，含执行状态追踪（localStorage） |
| `Wayfair_SKU经营档案_20260605.html` | 单 SKU 档案卡（价格/库存/广告/利润） |

### 证据层报告

| 报告 | 说明 |
|------|------|
| `Wayfair_产品定价体检表_20260605.html` | 定价体检主力版（YB + Cost Stack + Product Catalog） |
| `Wayfair_6月SKU分层与促销准入清单_20260604.html` | SKU 分层、促销准入、禁促原因 |
| `Wayfair_SKU价值分级_SABC_N_20260604.html` | S/A/B/C/N 价值分级 |
| `Wayfair_库存映射对照工具_20260604.html` | 仓库库存 SKU 与 Wayfair SKU 映射 |
| `Wayfair_Pricing_ProductCatalog_定价体检_20260604.html` | Product Catalog 与 Cost Stack 口径校准 |
| `Wayfair_6月WSP广告调整执行清单_CostStack校准版.html` | WSP 广告层执行清单 |
| `Wayfair_6月WSP关键词调整清单_20260604.html` | Listing × Keyword 停词/降 bid 建议 |
| `Wayfair_产品信息评分评论体检_20260604.html` | 评分/评论/转化/图片体检 |

### 诊断与规范

| 报告 | 说明 |
|------|------|
| `Wayfair_店铺诊断_20260604.html` | 店铺整体诊断总览 |
| `Wayfair_店铺交接_20260604.html` | 接手原则与交接说明 |
| `Wayfair_运营工作台_20260604.html` | 当前状态、缺口数据、下一步动作 |
| `Wayfair_操作护栏_20260604.html` | 禁止踩的错误口径和误操作清单 |
| `Wayfair_CostStack口径校准与建议复核_20260604.html` | Cost Stack 正确用法说明 |
| `Wayfair_数据补齐清单_20260604.html` | 已收到 / 待补数据状态 |
| `Wayfair_6月待办甘特图_20260604.html` | 6月任务节奏（彩色进度条） |
| `Wayfair_项目导航_20260604.html` | 全部报告入口 Dashboard |

---

## 重新生成报告

```bash
cd /path/to/AI-Wayfair
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

# 1. 生成执行中心 / 任务清单 / SKU档案
.venv/bin/python scripts/build_ops_workbench.py

# 2. 套 Dashboard shell（注意：会覆盖 <head>，页面专有 CSS 必须在 <body>）
python3 scripts/apply_dashboard_shell.py

# 3. 本地预览
python3 -m http.server 8787 --directory reports
# 访问 http://localhost:8787/
```

`build_all.sh` 使用仓库内已脱敏汇总数据生成站点并运行全站审计。若要从原始导出文件重建定价、Cost Stack 或 SKU 促销准入，请先把原始文件放到 `data/raw/`；该目录按数据安全规则不提交。

---

## 每日 Wayfair 库存文件

使用 `scripts/build_wayfair_inventory.py` 将领星海外仓库存明细转换成 Wayfair 每日库存 CSV。输出以 Wayfair 库存模板的 `Supplier ID + Supplier Part#` 行为准，只更新 `In Stock`；无 SKU 映射、无仓库映射或领星无库存记录的行，库存填 `0`，并写入审计清单。

```bash
.venv/bin/python scripts/build_wayfair_inventory.py \
  --template "/path/to/Inventory_YYYY-MM-DD.csv" \
  --mapping "/path/to/YB-映射关系表.xlsx" \
  --lingxing "/path/to/库存明细-仓库库存-YYYYMMDD.xlsx" \
  --output outputs/Wayfair_Inventory_YYYY-MM-DD_generated.csv \
  --audit-output outputs/Wayfair_Inventory_YYYY-MM-DD_audit.csv \
  --issues-output outputs/Wayfair_Inventory_YYYY-MM-DD_issues.csv \
  --summary-output outputs/Wayfair_Inventory_YYYY-MM-DD_summary.json
```

字段会自动识别：模板 `Supplier ID / Supplier Part# / In Stock`，映射表 `Supplier Part# / 领星SKU` 和 `云仓仓库ID / BZ领星仓库`，领星库存 `SKU / 仓库 / 可用量`。如果以后导出表头变化，可用脚本里的 `--*-col` 参数显式指定列名。

---

## 定价体检口径

定价体检表当前数据来源：

- `Wayfair YB-工具表 2026年 05月.xlsx`（`产品上架`、`订单处理`、`客诉扣款`）
- Pricing Product Catalog 2026-06-04 两份导出
- 5月 Cost Stack Report
- SKU 分层与促销准入结果

**平台空间 = `Retail Price Net - Total Cost`**  
**平台空间率 = `(Retail Price Net - Total Cost) / Retail Price Net`**

> ⚠️ 禁止用 `WholesaleCost - Total Cost` 判断平台亏损或禁促——`Total Cost` 已包含 `WholesaleCost`。

`Total Cost` 明细：`Wholesale Cost` + `Ship Outbound Cost` + `Incident And Return Cost` + `Product Allowance Cost` + `Other Handling Cost`

Cost Stack 帮助摘要：`docs/Wayfair_CostStack帮助文章_2865_摘要_20260604.md`

当前 2026-06-05 版定价结论：

| 分类 | SKU数 |
|------|-------|
| 可尝试提 Base | 0 |
| 价格健康 | 1 |
| 维持观察 | 18 |
| 不建议提价 | 29 |
| 先修成本 | 6 |
| 新品观察 | 18 |
| 待确认价格 | 10 |
| 待补成本 | 8 |

---

## 数据安全

**禁止提交**：原始 YB 工具表、订单明细、客户姓名/地址/电话、账号密码。

- 原始文件只放 `data/raw/`（已在 `.gitignore`）
- 仓库只提交脱敏 SKU 维度汇总 CSV 和 HTML 报告
