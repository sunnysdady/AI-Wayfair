export const METRIC_DEFINITIONS = [
  { id: "orders", label: "订单", unit: "orders", grain: "去重 PO", source: "Wayfair Ops API", definition: "统计周期内去重 purchase order 数；不等同于商品件数。" },
  { id: "units", label: "件数", unit: "units", grain: "订单行数量求和", source: "Wayfair Ops API", definition: "统计周期内各订单行 quantity 之和；用于库存和月度件数目标。" },
  { id: "adOrders", label: "广告归因订单", unit: "orders", grain: "Campaign / Listing · 日", source: "Wayfair Advertising API", definition: "Wayfair 14 天 view-through 归因窗口内的订单数，只用于广告分析。" },
  { id: "wsc", label: "WSC 销售额", unit: "USD", grain: "Campaign / Listing · 日", source: "Wayfair Advertising API", definition: "广告报表归因的 Wholesale Cost 销售额。" },
  { id: "retail", label: "Retail 销售额", unit: "USD", grain: "Campaign / Listing · 日", source: "Wayfair Advertising API", definition: "广告报表归因的零售销售额，不与 WSC 混算。" },
  { id: "wscRoas", label: "WSC ROAS", unit: "ratio", grain: "所选广告周期", source: "Wayfair Advertising API", definition: "WSC 销售额 ÷ 广告花费；花费为 0 时显示 0。" },
  { id: "contributionAfterAds", label: "广告后贡献", unit: "USD", grain: "所选订单周期", source: "Ops API + SKU 成本 + Advertising API", definition: "广告前商品毛利减已同步广告花费；成本或广告覆盖不完整时不得称为实际利润。" },
];
