# AI-Wayfair

Wayfair 店铺运营接手与诊断项目。

线上入口： https://ai-wayfair.vercel.app

## 使用顺序

1. 先打开 `index.html` 或线上首页，进入项目导航。
2. 日常接手先看 `reports/Wayfair_运营工作台_20260604.html`。
3. 定价相关优先看 `reports/Wayfair_产品定价体检表_20260605.html`。
4. 广告、促销和库存动作再结合 SKU 分层、广告调整、库存映射报告执行。

## 目录结构

- `index.html`：Vercel 首页，同事优先从这里进入。
- `reports/`：可公开给同事查看的 HTML 报告与导航页。
- `docs/`：内部接力文档、知识库、MEMORY、操作口径等 Markdown 文档。
- `data/`：结构化脱敏汇总，例如 SKU 分级、订单利润、定价体检 CSV。
- `archive/`：本地备份文件，不作为主要工作入口。

## 当前重点报告

- `reports/Wayfair_项目导航_20260604.html`：全部报告入口。
- `reports/Wayfair_运营工作台_20260604.html`：当前状态、缺口数据、下一步动作。
- `reports/Wayfair_产品定价体检表_20260605.html`：05月 YB 成本、订单、客诉扣款、Product Catalog、Cost Stack 合并后的定价体检；支持分类跳转和每个 SKU 的 Total Cost 明细展开。
- `reports/Wayfair_6月SKU分层与促销准入清单_20260604.html`：SKU 分层、促销准入、禁促原因。
- `reports/Wayfair_Pricing_ProductCatalog_定价体检_20260604.html`：Product Catalog 与 Cost Stack 口径校准。
- `reports/Wayfair_SKU价值分级_SABC_N_20260604.html`：SKU 价值分级。
- `reports/Wayfair_6月WSP广告调整执行清单_CostStack校准版.html`：广告层执行清单。
- `reports/Wayfair_库存映射对照工具_20260604.html`：仓库库存 SKU 与 Wayfair SKU 映射。
- `reports/Wayfair_店铺诊断_20260604.html`：店铺诊断总览。
- `reports/Wayfair_店铺交接_20260604.html`：接手原则和交接说明。
- `reports/Wayfair_6月待办甘特图_20260604.html`：6月任务节奏。

## 定价体检口径

定价体检表当前使用：

- `Wayfair YB-工具表 2026年 05月.xlsx` 的 `产品上架`、`订单处理`、`客诉扣款`。
- Pricing Product Catalog 2026-06-04 两份导出。
- 5月 Cost Stack Report。
- SKU 分层与促销准入结果。

定价体检表输出：

- 顶部分类卡片可点击跳转。
- 每个分类有独立 SKU 明细区。
- 每个 SKU 的 `平台空间` 列可展开 `Total Cost 明细`。
- CSV 同步输出 Cost Stack 分项：`Retail Price Net`、`Wholesale Cost`、`出仓成本`、`客诉退货成本`、`产品津贴成本`、`其他操作成本`、`Total Cost`、`平台空间`。

当前 2026-06-05 版结论：

- 可尝试提Base：0
- 价格健康：1
- 维持观察：18
- 不建议提价：29
- 先修成本：6
- 新品观察：18
- 待确认价格：10
- 待补成本：8

## 关键口径

Cost Stack 平台空间看：

`Retail Price Net - Total Cost`

平台空间率：

`(Retail Price Net - Total Cost) / Retail Price Net`

禁止仅凭 `WholesaleCost - Total Cost` 判断平台亏损、停投或禁促，因为 `Total Cost` 已包含 `Wholesale Cost`。

`Total Cost` 明细当前展示：

- `Wholesale Cost`
- `Ship Outbound Cost`
- `Incident And Return Cost`
- `Product Allowance Cost`
- `Other Handling Cost`

Pricing Product Catalog 用于看当前供货价、B2B 折扣、MSRP 和前台价；是否调价必须再结合 Cost Stack 平台空间、发货成本、客诉退货成本和订单利润。

Wayfair Cost Stack 帮助文章摘要见：`docs/Wayfair_CostStack帮助文章_2865_摘要_20260604.md`

## 数据安全

不要提交原始 YB 工具表、订单明细、客户姓名、地址、电话、账号密码等敏感信息。

当前仓库只提交脱敏后的 SKU 维度汇总和 HTML 报告。
