from __future__ import annotations

import html
from pathlib import Path

import pandas as pd


ROOT = Path("/Users/pengzhang/Documents/Codex 2/AI-Wayfair")
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
RAW = ROOT / "data" / "raw"

YB_TOOL = Path("/Users/pengzhang/Downloads/Wayfair YB-工具表 2026年 05月.xlsx")
PRICING_CATALOG = DATA / "Wayfair_Pricing_ProductCatalog_定价体检_20260604.csv"
SKU_SCORE = DATA / "Wayfair_SKU价值分级_补齐版_20260604.csv"

OUT_CSV = DATA / "Wayfair_产品定价体检表_20260605.csv"
OUT_HTML = REPORTS / "Wayfair_产品定价体检表_20260605.html"
OUT_COST = DATA / "Wayfair_YB_产品成本定价_脱敏版_20260605.csv"
OUT_MAY = DATA / "Wayfair_5月订单利润_SKU汇总_脱敏版_20260605.csv"
OUT_HISTORY = DATA / "Wayfair_YB_历史订单利润_SKU汇总_脱敏版_20260605.csv"
OUT_DEDUCTIONS = DATA / "Wayfair_YB_客诉扣款_SKU汇总_脱敏版_20260605.csv"

FEE_RATE = 0.06
TARGET_MARGIN = 0.25
REPORT_DATE = "2026-06-05"
MAY_START = pd.Timestamp("2026-05-01")
MAY_END = pd.Timestamp("2026-06-01")


def n(v, default=0.0) -> float:
    if v is None or pd.isna(v):
        return default
    try:
        return float(v)
    except Exception:
        return default


def esc(v) -> str:
    if v is None or pd.isna(v):
        return ""
    return html.escape(str(v))


def money(v) -> str:
    return f"${n(v):,.2f}"


def pct(v) -> str:
    return f"{n(v) * 100:.1f}%"


def clean_sku(v) -> str:
    if v is None or pd.isna(v):
        return ""
    return str(v).strip()


def parse_excel_date(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    parsed = pd.to_datetime(series, errors="coerce")
    serial = pd.to_datetime(numeric, unit="D", origin="1899-12-30", errors="coerce")
    return parsed.mask(numeric.notna() & (numeric > 20000), serial)


def load_yb_listing() -> pd.DataFrame:
    df = pd.read_excel(YB_TOOL, sheet_name="产品上架")
    df.columns = [str(c).strip() for c in df.columns]
    keep = [
        "平台", "UPC", "wayfair 店铺 sku", "SKU编码", "类目", "中文名字", "拿货成本",
        "Base cost", "小促销2C", "大促销2C", "大促折后价", "大促2C利润", "利润率",
        "小促销2B", "大促销2B", "大促折后价.1", "大促销2B利润", "利润率.1",
    ]
    df = df[[c for c in keep if c in df.columns]].copy()
    df = df.rename(columns={
        "wayfair 店铺 sku": "Part",
        "SKU编码": "WarehouseSKU",
        "中文名字": "ChineseName",
        "拿货成本": "ProcurementCost",
        "Base cost": "YBBaseCost",
        "利润率": "YBPromo2CMargin",
        "利润率.1": "YBPromo2BMargin",
        "大促销2B利润": "YBPromo2BProfit",
        "大促折后价.1": "YBPromo2BNetPrice",
    })
    df["Part"] = df["Part"].map(clean_sku)
    for c in ["ProcurementCost", "YBBaseCost", "YBPromo2BMargin", "YBPromo2BProfit", "YBPromo2BNetPrice"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["Part"].ne("")]
    return df.drop_duplicates("Part", keep="last")


def load_order_lines() -> pd.DataFrame:
    df = pd.read_excel(YB_TOOL, sheet_name="订单处理")
    df.columns = [str(c).strip() for c in df.columns]
    df = df.rename(columns={
        "SKU": "Part",
        "数量": "Qty",
        "回款价\n手工填写": "SellerNetPrice",
        "采购成本": "OrderCost",
        "毛利润": "OrderGross",
        "毛利率": "OrderMargin",
    })
    df["OrderDate"] = parse_excel_date(df["日期"])
    df["Part"] = df["Part"].map(clean_sku)
    df = df[df["Part"].ne("")]
    df = df[df["OrderDate"].ge(pd.Timestamp("2025-01-01"))]
    for c in ["Qty", "SellerNetPrice", "OrderCost", "OrderGross", "OrderMargin"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["Revenue"] = df["SellerNetPrice"].fillna(0) * df["Qty"].fillna(1)
    df["Cost"] = df["OrderCost"].fillna(0) * df["Qty"].fillna(1)
    df["ZeroRevenueOrder"] = df["Revenue"].fillna(0).le(0)
    keep = [
        "OrderDate", "Part", "Qty", "SellerNetPrice", "OrderCost", "OrderGross",
        "OrderMargin", "Revenue", "Cost", "ZeroRevenueOrder", "发货状态", "订单类型",
    ]
    return df[[c for c in keep if c in df.columns]].copy()


def aggregate_orders(df: pd.DataFrame, prefix: str, month_only: bool = False) -> pd.DataFrame:
    if month_only:
        df = df[df["OrderDate"].ge(MAY_START) & df["OrderDate"].lt(MAY_END)].copy()
    if df.empty:
        return pd.DataFrame(columns=["Part"])
    agg = df.groupby("Part", dropna=False).agg(
        **{
            f"{prefix}Orders": ("Part", "size"),
            f"{prefix}Units": ("Qty", "sum"),
            f"{prefix}SellerRevenue": ("Revenue", "sum"),
            f"{prefix}ProcurementCost": ("Cost", "sum"),
            f"{prefix}Gross": ("OrderGross", "sum"),
            f"{prefix}AvgSellerNet": ("SellerNetPrice", "mean"),
            f"{prefix}AvgCost": ("OrderCost", "mean"),
            f"{prefix}ZeroRevenueOrders": ("ZeroRevenueOrder", "sum"),
            f"{prefix}FirstOrderDate": ("OrderDate", "min"),
            f"{prefix}LastOrderDate": ("OrderDate", "max"),
        }
    ).reset_index()
    agg[f"{prefix}Margin"] = agg[f"{prefix}Gross"] / agg[f"{prefix}SellerRevenue"].replace(0, pd.NA)
    return agg


def load_order_aggregates() -> tuple[pd.DataFrame, pd.DataFrame]:
    lines = load_order_lines()
    may = aggregate_orders(lines, "May", month_only=True)
    hist = aggregate_orders(lines, "YBHist", month_only=False)
    return may, hist


def load_deductions() -> pd.DataFrame:
    df = pd.read_excel(YB_TOOL, sheet_name="客诉扣款")
    df.columns = [str(c).strip() for c in df.columns]
    if "Part number" not in df.columns:
        return pd.DataFrame(columns=["Part"])
    df = df.rename(columns={
        "Part number": "Part",
        "Quantity": "DeductionQty",
        "Total amount扣款金额": "DeductionAmount",
        "Deduction type": "DeductionType",
        "Return Reason/客速": "DeductionReason",
    })
    df["Part"] = df["Part"].map(clean_sku)
    df = df[df["Part"].ne("")]
    for c in ["DeductionQty", "DeductionAmount"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    def joined(values: pd.Series) -> str:
        items = [str(v).strip() for v in values.dropna().tolist() if str(v).strip()]
        return "；".join(dict.fromkeys(items[:3]))

    return df.groupby("Part", dropna=False).agg(
        DeductionRecords=("Part", "size"),
        DeductionQty=("DeductionQty", "sum"),
        DeductionAmount=("DeductionAmount", "sum"),
        DeductionTypes=("DeductionType", joined),
        DeductionReasons=("DeductionReason", joined),
    ).reset_index()


def load_pricing_catalog() -> pd.DataFrame:
    df = pd.read_csv(PRICING_CATALOG, encoding="utf-8-sig")
    df = df.rename(columns={
        "供应商SKU": "Part",
        "状态": "Status",
        "Wayfair Listing/SKU": "Listing",
        "目录当前Base Cost": "CatalogBaseCost",
        "当前B2B折扣": "CurrentB2BDiscount",
        "美国前台价": "RetailUS",
        "Cost Stack净零售价": "CostStackRetailNet",
        "Cost Stack Base Cost": "CostStackBaseCost",
        "Wholesale Cost": "WholesaleCost",
        "Total Cost": "TotalCost",
        "出仓成本": "ShipOutboundCost",
        "客诉退货成本": "IncidentReturnCost",
        "产品津贴成本": "ProductAllowanceCost",
        "其他操作成本": "OtherHandlingCost",
        "平台空间金额": "PlatformMargin",
        "平台空间率": "PlatformPct",
        "供货价竞争百分位": "WSCPercentile",
        "发货成本竞争百分位": "ShipCostPercentile",
        "客诉退货竞争百分位": "IncidentReturnPercentile",
        "Base Cost/美国前台价": "BaseToRetailUS",
        "定价诊断": "CatalogDiagnosis",
    })
    df["Part"] = df["Part"].map(clean_sku)
    numeric = [
        "CatalogBaseCost", "CurrentB2BDiscount", "RetailUS", "CostStackRetailNet",
        "CostStackBaseCost", "WholesaleCost", "TotalCost", "ShipOutboundCost",
        "IncidentReturnCost", "ProductAllowanceCost", "OtherHandlingCost",
        "PlatformMargin", "PlatformPct", "WSCPercentile", "ShipCostPercentile",
        "IncidentReturnPercentile", "BaseToRetailUS",
    ]
    for c in numeric:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def load_sku_score() -> pd.DataFrame:
    df = pd.read_csv(SKU_SCORE, encoding="utf-8-sig")
    df["Part"] = df["Part"].map(clean_sku)
    keep = [
        "Part", "Listing", "NewGrade", "NewScore", "Orders", "Sales", "NetGross",
        "HistMargin", "Rating", "Reviews", "CR", "Images", "FeedbackCount",
        "FeedbackDamage", "PromoReadiness", "PromoReason", "NewAction",
        "IsInventoryAlias",
    ]
    df = df[[c for c in keep if c in df.columns]].copy()
    df = df[df.get("IsInventoryAlias", False).astype(str).str.lower().ne("true")]
    for c in ["NewScore", "Orders", "Sales", "NetGross", "HistMargin", "Rating", "Reviews", "CR", "Images", "FeedbackCount", "FeedbackDamage"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.drop_duplicates("Part", keep="first")


def recommendation(row: pd.Series) -> tuple[str, str, str]:
    issues: list[str] = []
    actions: list[str] = []
    grade = "观察"

    procurement = n(row.get("ProcurementCost"))
    catalog_base = n(row.get("CatalogBaseCost"))
    retail = n(row.get("RetailUS"))
    wholesale = n(row.get("WholesaleCost")) or catalog_base * (1 - n(row.get("CurrentB2BDiscount")) / 100)
    estimated_margin = row.get("EstimatedCurrentMargin")
    platform_pct = n(row.get("PlatformPct"))
    base_to_retail = n(row.get("BaseToRetailUS"))
    wsc = n(row.get("WSCPercentile"))
    ship = n(row.get("ShipCostPercentile"))
    incident = n(row.get("IncidentReturnPercentile"))
    promo_margin_2b = n(row.get("YBPromo2BMargin"))
    may_orders = n(row.get("MayOrders"))
    hist_orders = n(row.get("YBHistOrders")) or n(row.get("Orders"))
    observed_orders = max(may_orders, hist_orders)
    margin_value = None
    if pd.notna(row.get("MayMargin")) and n(row.get("MayOrders")) > 0:
        margin_value = n(row.get("MayMargin"))
    elif pd.notna(row.get("YBHistMargin")) and n(row.get("YBHistOrders")) > 0:
        margin_value = n(row.get("YBHistMargin"))
    elif pd.notna(row.get("HistMargin")) and observed_orders > 0:
        margin_value = n(row.get("HistMargin"))

    if retail <= 0:
        return "待确认价格", "缺少美国前台价，不能做提价/促销判断", "先确认是否仍可售或仅部分店铺可售"
    if procurement <= 0:
        return "待补成本", "缺少你的拿货成本", "先补产品上架成本，再决定 Base Cost"

    if observed_orders < 3:
        issues.append("成交样本不足")
    elif may_orders <= 0 and hist_orders >= 3:
        issues.append("5月无成交，仅历史订单支撑")
    elif may_orders > 0 and may_orders < 3:
        issues.append("5月成交样本不足")
    if margin_value is not None and margin_value < 0.15:
        issues.append("真实订单毛利率低于15%")
    elif margin_value is not None and margin_value < 0.25:
        issues.append("真实订单毛利率一般")
    if n(row.get("YBHistZeroRevenueOrders")) > 0:
        issues.append("历史存在0回款/异常订单")
    if n(row.get("DeductionRecords")) > 0:
        issues.append("YB客诉扣款有记录")

    if pd.notna(estimated_margin) and n(estimated_margin) < 0.15:
        issues.append("按当前Base预估毛利偏低")
    if promo_margin_2b and promo_margin_2b < 0.12:
        issues.append("大促2B利润率低于12%")
    if platform_pct and platform_pct < 0.16:
        issues.append("平台空间偏低")
    if base_to_retail > 0.72:
        issues.append("Base/前台价高于72%")
    if wsc > 0.70:
        issues.append("供货价竞争百分位偏高")
    if ship > 0.70:
        issues.append("发货成本竞争百分位偏高")
    if incident > 0.70:
        issues.append("客诉退货竞争百分位偏高")

    can_raise = (
        margin_value is not None
        and margin_value < 0.25
        and may_orders >= 3
        and platform_pct >= 0.22
        and base_to_retail <= 0.68
        and wsc <= 0.70
        and retail > 0
    )
    must_hold = base_to_retail > 0.72 or wsc > 0.70 or platform_pct < 0.16

    if can_raise:
        grade = "可尝试提Base"
        actions.append("可向Wayfair小幅上调Base Cost 3%-5%，先挑5月有订单且平台空间充足SKU")
    elif must_hold and (margin_value is None or margin_value < 0.25):
        grade = "不建议提价"
        actions.append("不要先提Base；先降拿货/包装/发货成本，或修Listing承接")
    elif observed_orders < 3:
        grade = "新品观察"
        actions.append("先不提Base，保留当前价格做成交验证；有3单以上再复核")
    elif margin_value is not None and margin_value >= 0.30 and platform_pct >= 0.20 and base_to_retail <= 0.72 and wsc <= 0.70:
        grade = "价格健康"
        actions.append("维持当前Base Cost，可做5%-10%轻促候选")
    elif margin_value is not None and margin_value >= 0.20 and platform_pct >= 0.18:
        grade = "维持观察"
        actions.append("维持Base Cost，促销不超过5%，先看库存和转化")
    else:
        grade = "先修成本"
        actions.append("先复核成本、退货和物流，不进大促")

    if ship > 0.70:
        actions.append("优先复核包裹尺寸、发货方式、仓库位置")
    if incident > 0.70:
        actions.append("回看Customer Feedback/退货原因，修说明、包装或质量")
    if promo_margin_2b and promo_margin_2b < 0.12:
        actions.append("禁止深折扣促销，当前促销利润不够")
    if n(row.get("YBHistZeroRevenueOrders")) > 0:
        actions.append("把0回款/TT订单从常规利润复盘中单独标记，避免误判定价")
    if n(row.get("DeductionRecords")) > 0:
        actions.append("先复盘客诉扣款原因，再决定是否促销或放量")

    if not issues:
        issues.append("价格结构暂无明显红灯")
    return grade, "；".join(issues), "；".join(dict.fromkeys(actions))


def build() -> pd.DataFrame:
    yb = load_yb_listing()
    may, hist = load_order_aggregates()
    deductions = load_deductions()
    pricing = load_pricing_catalog()
    score = load_sku_score()

    yb.to_csv(OUT_COST, index=False, encoding="utf-8-sig")
    may.to_csv(OUT_MAY, index=False, encoding="utf-8-sig")
    hist.to_csv(OUT_HISTORY, index=False, encoding="utf-8-sig")
    deductions.to_csv(OUT_DEDUCTIONS, index=False, encoding="utf-8-sig")

    df = (
        pricing.merge(yb, on="Part", how="left")
        .merge(may, on="Part", how="left")
        .merge(hist, on="Part", how="left")
        .merge(deductions, on="Part", how="left")
        .merge(score, on="Part", how="left", suffixes=("", "_Score"))
    )

    df["OwnerCostSource"] = df["ProcurementCost"].notna().map({True: "YB产品上架", False: "缺成本"})
    df["WholesaleAfterB2B"] = df["WholesaleCost"].fillna(
        df["CatalogBaseCost"] * (1 - df["CurrentB2BDiscount"].fillna(0) / 100)
    )
    df["EstimatedCurrentGross"] = df["WholesaleAfterB2B"] * (1 - FEE_RATE) - df["ProcurementCost"]
    df["EstimatedCurrentMargin"] = df["EstimatedCurrentGross"] / df["WholesaleAfterB2B"].replace(0, pd.NA)
    df["RequiredBaseFor25Pct"] = df["ProcurementCost"] / (
        (1 - df["CurrentB2BDiscount"].fillna(0) / 100) * (1 - FEE_RATE - TARGET_MARGIN)
    )
    df["MaxBaseByRetail70Pct"] = df["RetailUS"] * 0.70
    df["BaseGapToTarget25Pct"] = df["RequiredBaseFor25Pct"] - df["CatalogBaseCost"]
    df["YBBaseGap"] = df["CatalogBaseCost"] - df["YBBaseCost"]
    for c in [
        "MayMargin", "YBHistMargin", "HistMargin", "MayOrders", "YBHistOrders",
        "MayZeroRevenueOrders", "YBHistZeroRevenueOrders", "DeductionRecords",
        "DeductionAmount",
    ]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df["HistMargin"] = pd.to_numeric(df["HistMargin"], errors="coerce")

    recs = df.apply(recommendation, axis=1)
    df["定价分组"] = [r[0] for r in recs]
    df["主要问题"] = [r[1] for r in recs]
    df["建议动作"] = [r[2] for r in recs]

    order = [
        "Part", "Listing", "Status", "ChineseName", "类目", "ProcurementCost", "YBBaseCost",
        "CatalogBaseCost", "CurrentB2BDiscount", "WholesaleAfterB2B", "RetailUS",
        "BaseToRetailUS", "TotalCost", "PlatformMargin", "PlatformPct", "WSCPercentile",
        "ShipCostPercentile", "IncidentReturnPercentile", "MayOrders", "MaySellerRevenue",
        "MayGross", "MayMargin", "MayZeroRevenueOrders", "YBHistOrders", "YBHistSellerRevenue",
        "YBHistGross", "YBHistMargin", "YBHistZeroRevenueOrders", "YBHistFirstOrderDate",
        "YBHistLastOrderDate", "DeductionRecords", "DeductionAmount", "DeductionTypes",
        "DeductionReasons", "Orders", "Sales", "NetGross", "HistMargin",
        "EstimatedCurrentGross", "EstimatedCurrentMargin", "YBPromo2BMargin",
        "RequiredBaseFor25Pct", "MaxBaseByRetail70Pct", "BaseGapToTarget25Pct",
        "YBBaseGap", "NewGrade", "PromoReadiness", "定价分组", "主要问题", "建议动作",
    ]
    df = df[[c for c in order if c in df.columns]].copy()
    df = df.sort_values(["定价分组", "MayOrders", "YBHistOrders"], ascending=[True, False, False])
    return df


def render(df: pd.DataFrame) -> None:
    rename = {
        "Part": "供应商SKU",
        "Listing": "Wayfair Listing",
        "Status": "状态",
        "ChineseName": "中文名",
        "类目": "类目",
        "ProcurementCost": "你的拿货成本",
        "YBBaseCost": "YB表Base Cost",
        "CatalogBaseCost": "Catalog当前Base Cost",
        "CurrentB2BDiscount": "当前B2B折扣",
        "WholesaleAfterB2B": "当前供货收入",
        "RetailUS": "美国前台价",
        "BaseToRetailUS": "Base/前台价",
        "TotalCost": "Wayfair Total Cost",
        "PlatformMargin": "平台空间金额",
        "PlatformPct": "平台空间率",
        "WSCPercentile": "供货价竞争百分位",
        "ShipCostPercentile": "发货成本竞争百分位",
        "IncidentReturnPercentile": "退货客诉竞争百分位",
        "MayOrders": "5月订单数",
        "MaySellerRevenue": "5月回款额",
        "MayGross": "5月毛利",
        "MayMargin": "5月毛利率",
        "MayZeroRevenueOrders": "5月0回款订单数",
        "YBHistOrders": "YB历史订单数",
        "YBHistSellerRevenue": "YB历史回款额",
        "YBHistGross": "YB历史毛利",
        "YBHistMargin": "YB历史毛利率",
        "YBHistZeroRevenueOrders": "YB历史0回款订单数",
        "YBHistFirstOrderDate": "YB首单日期",
        "YBHistLastOrderDate": "YB末单日期",
        "DeductionRecords": "客诉扣款记录数",
        "DeductionAmount": "客诉扣款金额",
        "DeductionTypes": "客诉扣款类型",
        "DeductionReasons": "客诉扣款原因",
        "Orders": "平台历史订单数",
        "Sales": "平台历史销售额",
        "NetGross": "平台历史净毛利",
        "HistMargin": "平台历史毛利率",
        "EstimatedCurrentGross": "当前Base预估毛利",
        "EstimatedCurrentMargin": "当前Base预估毛利率",
        "YBPromo2BMargin": "YB大促2B利润率",
        "RequiredBaseFor25Pct": "25%毛利所需Base",
        "MaxBaseByRetail70Pct": "按前台价70%上限Base",
        "BaseGapToTarget25Pct": "距25%目标Base差额",
        "YBBaseGap": "Catalog-YB Base差额",
        "NewGrade": "SKU价值分层",
        "PromoReadiness": "促销准入",
    }
    out = df.rename(columns=rename)
    out.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")

    counts = df["定价分组"].value_counts().to_dict()
    key_order = ["可尝试提Base", "价格健康", "维持观察", "不建议提价", "先修成本", "新品观察", "待确认价格", "待补成本"]
    group_ids = {name: f"group-{i + 1}" for i, name in enumerate(key_order)}
    table_header = (
        "<table><thead><tr><th>SKU / Listing</th><th>定价分组</th><th>你的成本</th>"
        "<th>当前Base</th><th>前台价</th><th>平台空间</th><th>真实毛利</th>"
        "<th>预估毛利</th><th>主要问题</th><th>建议动作</th></tr></thead>"
    )

    def table_rows(rows: pd.DataFrame) -> str:
        result = []
        for _, r in rows.iterrows():
            result.append(
                "<tr>"
                f"<td><b>{esc(r.get('Part'))}</b><div class='small'>{esc(r.get('Listing'))} / {esc(r.get('ChineseName'))}</div></td>"
                f"<td>{esc(r.get('定价分组'))}<div class='small'>{esc(r.get('NewGrade'))} / {esc(r.get('PromoReadiness'))}</div></td>"
                f"<td class='right'>{money(r.get('ProcurementCost'))}<div class='small'>YB Base {money(r.get('YBBaseCost'))}</div></td>"
                f"<td class='right'>{money(r.get('CatalogBaseCost'))}<div class='small'>供货收入 {money(r.get('WholesaleAfterB2B'))}</div></td>"
                f"<td class='right'>{money(r.get('RetailUS'))}<div class='small'>Base/前台 {pct(r.get('BaseToRetailUS'))}</div></td>"
                f"<td class='right'>{money(r.get('PlatformMargin'))}<div class='small'>{pct(r.get('PlatformPct'))}</div></td>"
                f"<td class='right'>{pct(r.get('MayMargin'))}<div class='small'>5月单 {n(r.get('MayOrders')):.0f} / YB历史 {n(r.get('YBHistOrders')):.0f}单 {pct(r.get('YBHistMargin'))}</div></td>"
                f"<td class='right'>{pct(r.get('EstimatedCurrentMargin'))}<div class='small'>目标Base {money(r.get('RequiredBaseFor25Pct'))}</div></td>"
                f"<td>{esc(r.get('主要问题'))}</td>"
                f"<td>{esc(r.get('建议动作'))}</td>"
                "</tr>"
            )
        return "\n".join(result)

    top = df[df["定价分组"].isin(["可尝试提Base", "不建议提价", "先修成本", "待确认价格", "待补成本"])].copy()
    if top.empty:
        top = df.head(30)
    else:
        top = top.head(80)

    cards = "".join(
        f"<a class='card jumpcard' href='#{group_ids[k]}'><div class='num'>{counts.get(k, 0)}</div><div>{k}</div></a>"
        for k in key_order
    )
    quick_nav = "".join(
        f"<a href='#{group_ids[k]}'>{esc(k)} <b>{counts.get(k, 0)}</b></a>"
        for k in key_order
    )
    group_sections = []
    for k in key_order:
        rows = df[df["定价分组"].eq(k)].copy()
        body = table_rows(rows) if not rows.empty else "<tr><td colspan='10'>当前没有这个分类的 SKU</td></tr>"
        group_sections.append(
            f"<div class='section group-section' id='{group_ids[k]}'>"
            f"<h2>{esc(k)} <span class='small'>共 {counts.get(k, 0)} 个 SKU</span></h2>"
            f"<div class='tablebox'>{table_header}<tbody>{body}</tbody></table></div>"
            f"<div class='backtop'><a href='#top'>返回顶部</a></div></div>"
        )
    group_sections_html = "\n".join(group_sections)
    html_text = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayfair 产品定价体检表</title>
<style>
html{{scroll-behavior:smooth}}body{{margin:0;background:#f6f7fb;color:#172033;font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.6}}header{{background:#10213d;color:#fff;padding:30px 34px}}h1{{margin:0;font-size:28px}}.meta{{color:#dbe7ff;margin-top:6px}}.wrap{{max-width:1320px;margin:auto;padding:24px 34px}}.grid{{display:grid;grid-template-columns:repeat(8,1fr);gap:10px}}.card,.section{{background:#fff;border:1px solid #d8e0ec;border-radius:8px;box-shadow:0 6px 18px #1018280a}}.card{{padding:14px}}.jumpcard{{display:block;color:#172033;text-decoration:none}}.jumpcard:hover{{border-color:#1f5cc4;box-shadow:0 8px 20px #1f5cc41a}}.num{{font-size:25px;font-weight:800;color:#1f5cc4}}.section{{padding:20px;margin:18px 0;scroll-margin-top:16px}}h2{{margin:0 0 12px;font-size:21px}}.callout{{border-left:4px solid #1f5cc4;background:#f8fbff;padding:12px 14px;border-radius:8px;margin:12px 0}}.warn{{border-left-color:#b54708;background:#fff8ed}}.jumpnav{{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 18px}}.jumpnav a{{background:#fff;border:1px solid #d8e0ec;border-radius:999px;color:#172033;padding:7px 11px;text-decoration:none}}.jumpnav a:hover{{border-color:#1f5cc4;color:#1f5cc4}}.tablebox{{overflow:auto;border:1px solid #d8e0ec;border-radius:8px;max-height:720px}}table{{width:100%;border-collapse:collapse;min-width:1480px;background:#fff}}th,td{{padding:8px 10px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top;font-size:12.5px}}th{{position:sticky;top:0;background:#eef2f6}}.right{{text-align:right;white-space:nowrap}}.small{{color:#667085;font-size:12px}}.backtop{{margin-top:10px;text-align:right}}.backtop a{{color:#1f5cc4;text-decoration:none}}@media(max-width:900px){{.grid{{grid-template-columns:1fr 1fr}}.wrap{{padding:16px}}}}
</style></head><body>
<header id="top"><h1>Wayfair 产品定价体检表</h1><div class="meta">生成日期：{REPORT_DATE} ｜ 数据源：05月YB工具表（产品上架/订单处理/客诉扣款）、Product Catalog、5月 Cost Stack、SKU 分层</div></header>
<div class="wrap">
<div class="grid">{cards}</div>
<div class="jumpnav">{quick_nav}</div>
<div class="section"><h2>1. 定价结论</h2>
<div class="callout"><b>核心判断：</b>这张表不是看 Wayfair 前台价能不能涨，而是判断你的 Base Cost 是否健康。只有在“2026年5月有真实订单、你的毛利偏低、平台空间足够、Base/前台价不高、供货价竞争百分位不差”的 SKU，才建议尝试小幅上调 Base Cost。</div>
<div class="callout warn"><b>执行护栏：</b>Base/前台价超过 72%、供货价竞争百分位高于 0.70、平台空间低于 16%、大促2B利润率低于 12%、或有明显客诉扣款的 SKU，不建议先提价或进深折扣。</div>
</div>
<div class="section"><h2>2. 优先处理清单</h2>
<div class="tablebox">{table_header}<tbody>{table_rows(top)}</tbody></table></div>
</div>
<div class="section"><h2>3. 按定价分类查看</h2><div class="jumpnav">{quick_nav}</div></div>
{group_sections_html}
<div class="section"><h2>4. 全量体检表</h2>
<div class="tablebox">{table_header}<tbody>{table_rows(df)}</tbody></table></div>
</div>
</div></body></html>"""
    OUT_HTML.write_text(html_text, encoding="utf-8")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    df = build()
    render(df)
    print("wrote", OUT_CSV)
    print("wrote", OUT_HTML)
    print("rows", len(df))
    print(df["定价分组"].value_counts().to_string())


if __name__ == "__main__":
    main()
