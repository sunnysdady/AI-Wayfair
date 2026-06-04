# Wayfair Cost Stack 帮助文章摘要

来源：`partners.wayfair.com/d/help-center/help_article_2865.pdf`

用途：给定价、促销、广告决策提供 Cost Stack 口径护栏。

## 核心结论

- Cost Stack 报告通常按月提供，覆盖上月活跃产品；同一产品可能因为周度定价数据重复出现。
- `Total Cost` 不是单纯供货价，包含 `WholesaleCost`、出仓成本、其他运输成本、客诉退货成本、产品津贴、回扣和其他操作成本。
- 判断平台空间时使用：`Retail Price Net - Total Cost`。
- 不要用 `WholesaleCost - Total Cost` 判断平台亏损，因为 `Total Cost` 本来就包含 `WholesaleCost`。
- Market Competitiveness Percentile 越低越有竞争力；越高越需要复核供货价、运输成本或客诉退货成本。

## 运营使用方式

1. 定价时先看 Product Catalog 的当前 Base Cost、B2B 折扣、MSRP、前台价。
2. 再用 Cost Stack 判断平台空间、发货成本竞争力、客诉退货成本竞争力。
3. 如果平台空间低，不要第一反应提高供货价；先查物流尺寸、配送方式、库存位置、退货原因和 Customer Feedback。
4. 如果客诉退货成本百分位高，先处理 Listing 误导、图片/尺寸信息、包装和质量反馈。
5. 促销准入必须同时看 SKU 分层、库存、订单利润、评分评论和 Cost Stack，不只看当前前台售价。

## 已落地到项目

- `reports/Wayfair_Pricing_ProductCatalog_定价体检_20260604.html`
- `data/Wayfair_Pricing_ProductCatalog_定价体检_20260604.csv`
- `scripts/build_pricing_catalog_report.py`
