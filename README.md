# AI-Wayfair

Wayfair 店铺运营接手与诊断项目。

线上入口： https://ai-wayfair.vercel.app

## 目录结构

- `index.html`：Vercel 首页，同事优先从这里进入。
- `reports/`：可公开给同事查看的 HTML 报告与导航页。
- `docs/`：内部接力文档、知识库、MEMORY、操作口径等 Markdown 文档。
- `data/`：结构化数据导出，例如 SKU 分级 CSV。
- `archive/`：本地备份文件，不作为主要工作入口。

## 当前重点报告

- `reports/Wayfair_项目导航_20260604.html`
- `reports/Wayfair_6月SKU分层与促销准入清单_20260604.html`
- `reports/Wayfair_Pricing_ProductCatalog_定价体检_20260604.html`
- `reports/Wayfair_SKU价值分级_SABC_N_20260604.html`
- `reports/Wayfair_店铺诊断_20260604.html`
- `reports/Wayfair_店铺交接_20260604.html`
- `reports/Wayfair_6月待办甘特图_20260604.html`
- `reports/Wayfair_6月WSP广告调整执行清单_CostStack校准版.html`

## 关键口径

Cost Stack 平台空间看：

`Retail Price Net - Total Cost`

禁止仅凭 `WholesaleCost - Total Cost` 判断平台亏损、停投或禁促。

Pricing Product Catalog 用于看当前供货价、B2B 折扣、MSRP 和前台价；是否调价必须再结合 Cost Stack 平台空间、发货成本、客诉退货成本和订单利润。

Wayfair Cost Stack 帮助文章摘要见：`docs/Wayfair_CostStack帮助文章_2865_摘要_20260604.md`
