from __future__ import annotations

import html
import math
import re
from pathlib import Path

import pandas as pd


ROOT = Path("/Users/pengzhang/Documents/Codex 2/AI-Wayfair")
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
OLD = DATA / "Wayfair_SKU价值分级_SABC_N_20260604.csv"
ORDERS = Path("/Users/pengzhang/Documents/Codex 2/wayfair_may_analysis/handover_package/04_全量订单清洗版.csv")

OUT_CSV = DATA / "Wayfair_SKU价值分级_补齐版_20260604.csv"
OUT_HTML = REPORTS / "Wayfair_6月SKU分层与促销准入清单_20260604.html"


FILES = {
    "listing": "Detailed_Listing_Health_May2026_06-04-2026_14-53-36.csv",
    "option": "Option_Drill_Down_May2026_06-04-2026_14-54-14.csv",
    "feedback": "Customer_Feedback_Report_May2026_06-04-2026_14-54-59.csv",
    "cancel": "New_Cancellation_Policy_Impact_May2026_06-04-2026_14-55-00.csv",
    "cost": "Pricing_export_cost_stack_report_May2026_06-04-2026_14-55-00.csv",
    "promo": "Supplier_Promotion_Revenue_May2026_06-04-2026_14-53-57.csv",
}


def read_csv(name: str) -> pd.DataFrame:
    return pd.read_csv(RAW / FILES[name], encoding="utf-8-sig", low_memory=False)


def num(v, default=0.0) -> float:
    if v is None:
        return default
    try:
        if pd.isna(v):
            return default
    except TypeError:
        pass
    if isinstance(v, str):
        s = v.replace("$", "").replace(",", "").replace("%", "").strip()
        if s == "":
            return default
        try:
            return float(s)
        except ValueError:
            return default
    try:
        return float(v)
    except Exception:
        return default


def text(v) -> str:
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except TypeError:
        pass
    return str(v).strip()


def pct_value(v) -> float:
    x = num(v, 0.0)
    if x > 1.5:
        return x / 100.0
    return x


def health_score(v: str) -> int:
    s = text(v).upper()
    if s == "GREEN":
        return 3
    if s == "YELLOW":
        return -2
    if s == "RED":
        return -7
    return 0


def money(v) -> str:
    return f"${num(v):,.2f}"


def pct(v) -> str:
    return f"{num(v) * 100:.1f}%"


def esc(v) -> str:
    return html.escape(text(v))


def first_nonblank(series: pd.Series):
    for v in series:
        if text(v):
            return v
    return ""


def weighted_mean(df: pd.DataFrame, value_col: str, weight_col: str) -> float:
    if value_col not in df.columns:
        return 0.0
    vals = pd.to_numeric(df[value_col], errors="coerce")
    if weight_col in df.columns:
        weights = pd.to_numeric(df[weight_col], errors="coerce").fillna(0)
        if weights.sum() > 0:
            return float((vals.fillna(0) * weights).sum() / weights.sum())
    return float(vals.mean()) if vals.notna().any() else 0.0


def build_sources():
    base = pd.read_csv(OLD, encoding="utf-8-sig", low_memory=False)
    for c in ["Score", "Qty", "Orders", "Sales", "Gross", "Deduction", "NetGross", "HistMargin", "Rating", "Reviews", "CR", "Images"]:
        if c in base.columns:
            base[c] = pd.to_numeric(base[c], errors="coerce").fillna(0)

    listing = read_csv("listing")
    listing_us = listing[listing["Wayfair Brand"].astype(str).eq("Wayfair US")].copy()
    listing_us = listing_us.sort_values(["Supplier Part Number", "Revenue"], ascending=[True, False])
    listing_map = listing_us.groupby("Supplier Part Number", dropna=False).agg(
        ProductClass=("Product Class", first_nonblank),
        ProductName=("Product Name", first_nonblank),
        ListingRevenue=("Revenue", "sum"),
        ListingUnits=("Unit Sold", "sum"),
        TotalImpressions=("Total Impressions", "sum"),
        UniqueVisits=("Unique Visits", "sum"),
        ListingCR=("Conversion Rate", "mean"),
        ClassCR=("Class Conversion Rate", "mean"),
        RequiredTags=("Percent Required Tags Completed", "max"),
        RecommendedTags=("Percent Recommended Tags Completed", "max"),
        TagHealth=("Tag Health", first_nonblank),
        FullProductImage=("Full Product Image", first_nonblank),
        ImageHealth=("Image Health", first_nonblank),
        AvailabilityRate=("Availability Rate", "mean"),
        AvailabilityHealth=("Availability Health", first_nonblank),
        FastDeliveryBadging=("Percent Fast Delivery Badging", "mean"),
        MedianDeliveryDays=("Median Estimated Delivery Days", "mean"),
        DeliverySpeedHealth=("Delivery Speed Health", first_nonblank),
        LifetimeReviews=("Lifetime Review Count", "max"),
        LifetimeRating=("Lifetime Average Customer Review Rating", "max"),
        ReviewCountHealth=("Review Count Health", first_nonblank),
        ReviewRatingHealth=("Review Rating Health", first_nonblank),
        PriceHealth=("Price Competitiveness Health", first_nonblank),
        IncidentReturnLevel=("Incidents and Returns Protection Level", first_nonblank),
        IncidentReturnHealth=("Incidents and Returns Health", first_nonblank),
    )

    option = read_csv("option")
    option_us = option[option["Brand Catalog"].astype(str).eq("Wayfair US")].copy()
    option_map = option_us.groupby("Supplier Part Number", dropna=False).agg(
        OptionRevenue=("Total Revenue", "sum"),
        OptionOrders=("Total Orders", "sum"),
        OptionUnits=("Units Sold", "sum"),
        Sessions=("Sessions", "sum"),
        UnitSessionPct=("Unit Session Percentage", "mean"),
        AddToCartRate=("Add To Cart Rate", "mean"),
        OptionCR=("Conversion Rate", "mean"),
        OptionImageCoverage=("Option Combination Image Coverage", "mean"),
        OptionRequiredTagCoverage=("Required Tag Coverage", "mean"),
        SPImpressions=("Sponsored Product Impressions (SKU Level)", "sum"),
        SPClicks=("Sponsored Product Clicks (SKU Level)", "sum"),
        SPSpend=("Sponsored Product Total Spend (SKU Level)", "sum"),
        SPRevenue=("Sponsored Product Attributed Revenue (SKU Level)", "sum"),
        SPOrders=("Sponsored Product Attributed Orders (SKU Level)", "sum"),
        SPCPC=("Sponsored Product Cost Per Click (SKU Level)", "mean"),
        SPROAS=("Sponsored Product Return On Ad Spend Revenue (SKU Level)", "mean"),
    )

    cost = read_csv("cost")
    cost_us = cost[cost["BrandCatalog"].astype(str).eq("Wayfair US")].copy()
    cost_us["Report Week"] = pd.to_datetime(cost_us["Report Week"], errors="coerce")
    cost_us["PlatformMargin"] = pd.to_numeric(cost_us["Retail Price Net"], errors="coerce") - pd.to_numeric(cost_us["Total Cost"], errors="coerce")
    cost_us["PlatformPct"] = cost_us["PlatformMargin"] / pd.to_numeric(cost_us["Retail Price Net"], errors="coerce")
    cost_latest = cost_us.sort_values("Report Week").groupby("SupplierPart Number", dropna=False).tail(1)
    cost_map = cost_latest.set_index("SupplierPart Number")[[
        "Retail Price Net", "Base Cost", "WholesaleCost", "Ship Outbound Cost",
        "Incident And Return Cost", "Product Allowance Cost", "Other Handling Cost",
        "Total Cost", "B2C Discount", "PlatformMargin", "PlatformPct",
        "WSC MarketCompetitiveness Percentile", "ShipCost MarketCompetitiveness Percentile",
        "IncidentsAndReturnCost MarketCompetitiveness Percentile",
    ]]

    feedback = read_csv("feedback")
    feedback["IsLowReview"] = pd.to_numeric(feedback["Review Rating"], errors="coerce").fillna(5).le(3)
    feedback["IsDamage"] = feedback["Comment Theme"].astype(str).str.contains("Defect|Damage", case=False, na=False) | feedback["Comment Subtheme"].astype(str).str.contains("Damage|Missing|Parts", case=False, na=False)
    feedback_map = feedback.groupby("Supplier Part Number", dropna=False).agg(
        FeedbackCount=("Customer Feedback ID", "count"),
        FeedbackLowReview=("IsLowReview", "sum"),
        FeedbackDamage=("IsDamage", "sum"),
        FeedbackTypes=("Feedback Type", lambda s: "; ".join(sorted(set(text(x) for x in s if text(x)))[:4])),
        FeedbackThemes=("Comment Theme", lambda s: "; ".join(sorted(set(text(x) for x in s if text(x)))[:4])),
        FeedbackSample=("Comment", first_nonblank),
    )

    promo = read_csv("promo")
    promo_us = promo[promo["Store"].astype(str).eq("Wayfair US")].copy()
    promo_us["PriorDaily"] = pd.to_numeric(promo_us["Avg Daily Revenue Prior 30 Days"], errors="coerce").fillna(0)
    promo_us["PromoDaily"] = pd.to_numeric(promo_us["Avg Daily Revenue During Promotion"], errors="coerce").fillna(0)
    promo_us["PromoLift"] = promo_us.apply(lambda r: (r["PromoDaily"] / r["PriorDaily"]) if r["PriorDaily"] > 0 else (1.0 if r["PromoDaily"] > 0 else 0.0), axis=1)
    promo_map = promo_us.groupby("Product Part #", dropna=False).agg(
        PromoCount=("Promotion Name", "count"),
        AvgDiscount=("Discount Percent", "mean"),
        MaxDiscount=("Discount Percent", "max"),
        PromoRevenue=("Revenue During Promotion", "sum"),
        PriorDailyRevenue=("PriorDaily", "mean"),
        PromoDailyRevenue=("PromoDaily", "mean"),
        PromoLift=("PromoLift", "mean"),
        PromoUnits=("# of Units Sold During Promotion", "sum"),
        PromoCVR=("Conversion Rate", "mean"),
    )

    cancel = read_csv("cancel")
    cancel_map = pd.DataFrame()
    if ORDERS.exists():
        orders = pd.read_csv(ORDERS, low_memory=False)
        po_to_sku = orders.dropna(subset=["单号"]).drop_duplicates("单号").set_index("单号")["SKU"].to_dict()
        rows = []
        for _, r in cancel.iterrows():
            po_list = text(r.get("Total PO List"))
            for po in re.split(r"[;,\\s]+", po_list):
                if po:
                    rows.append({"PO": po, "SKU": po_to_sku.get(po, ""), "CancelType": text(r.get("Cancellation Type")), "WSC": num(r.get("Total WSC"))})
        if rows:
            cancel_df = pd.DataFrame(rows)
            cancel_map = cancel_df[cancel_df["SKU"].astype(bool)].groupby("SKU", dropna=False).agg(
                CancelPO=("PO", "count"),
                CancelWSC=("WSC", "sum"),
                CancelTypes=("CancelType", lambda s: "; ".join(sorted(set(text(x) for x in s if text(x)))[:4])),
            )

    return base, listing_map, option_map, cost_map, feedback_map, promo_map, cancel_map


def get_metric(row: pd.Series, maps: dict[str, pd.DataFrame], col: str, default=0):
    keys = [text(row.get("Part")), text(row.get("Listing"))]
    for key in keys:
        if not key:
            continue
        for df in maps.values():
            if col in df.columns and key in df.index:
                return df.at[key, col]
    return default


def present_in_maps(row: pd.Series, maps: dict[str, pd.DataFrame]) -> bool:
    keys = [text(row.get("Part")), text(row.get("Listing"))]
    for key in keys:
        if key and any(key in df.index for df in maps.values()):
            return True
    return False


def score_row(row: pd.Series, maps: dict[str, pd.DataFrame]):
    qty = num(row.get("Qty"))
    orders = num(row.get("Orders"))
    sales = num(row.get("Sales"))
    net = num(row.get("NetGross"))
    hist_margin = num(row.get("HistMargin"))
    listing_revenue = num(get_metric(row, maps, "ListingRevenue"))
    listing_units = num(get_metric(row, maps, "ListingUnits"))
    is_new = (orders <= 0 and sales <= 0 and listing_units <= 0 and listing_revenue <= 0)

    if is_new:
        return 0, "N", ["无历史订单/销售记录，按新品观察"], "新品观察：先补图文与基础价格口径，只允许小预算测款，不进大促"

    score = 0
    reasons = []
    actions = []

    if net >= 1500:
        score += 20; reasons.append("历史净毛利强")
    elif net >= 800:
        score += 16; reasons.append("历史净毛利较好")
    elif net >= 300:
        score += 10; reasons.append("历史净毛利可用")
    elif net > 0:
        score += 4; reasons.append("历史净毛利偏薄")
    else:
        score -= 15; reasons.append("历史净毛利为负或不足")

    if orders >= 40:
        score += 15; reasons.append("历史销量高")
    elif orders >= 20:
        score += 12; reasons.append("历史销量稳定")
    elif orders >= 8:
        score += 8; reasons.append("有一定销量")
    elif orders > 0:
        score += 3; reasons.append("销量样本少")

    if hist_margin >= 0.32:
        score += 10; reasons.append("历史净毛利率高")
    elif hist_margin >= 0.22:
        score += 7; reasons.append("历史净毛利率健康")
    elif hist_margin >= 0.15:
        score += 2; reasons.append("历史净毛利率偏低")
    elif hist_margin > 0:
        score -= 7; reasons.append("历史净毛利率偏低")
    else:
        score -= 12; reasons.append("历史利润率需复核")

    rating = max(num(row.get("Rating")), num(get_metric(row, maps, "LifetimeRating")))
    reviews = max(num(row.get("Reviews")), num(get_metric(row, maps, "LifetimeReviews")))
    if rating >= 4.5:
        score += 5; reasons.append("评分优秀")
    elif rating >= 4:
        score += 2; reasons.append("评分健康")
    elif rating > 0:
        score -= 8; reasons.append("评分低于4.0")
        actions.append("评分低：先处理差评原因，不建议放量")
    if reviews >= 20:
        score += 5; reasons.append("评论数达标")
    elif reviews >= 8:
        score += 2; reasons.append("评论数有基础")
    else:
        score -= 2; reasons.append("评论样本偏少")

    required_tags = max(pct_value(get_metric(row, maps, "RequiredTags")), pct_value(get_metric(row, maps, "OptionRequiredTagCoverage")))
    recommended_tags = pct_value(get_metric(row, maps, "RecommendedTags"))
    if required_tags >= 0.95 and recommended_tags >= 0.8:
        score += 6; reasons.append("TAG较完整")
    elif required_tags >= 0.8:
        score += 2; reasons.append("必填TAG基本合格")
        actions.append("补推荐TAG到95%目标")
    else:
        score -= 8; reasons.append("TAG不足")
        actions.append("优先补必填/推荐TAG")

    image_health = text(get_metric(row, maps, "ImageHealth")).upper()
    images = max(num(row.get("Images")), num(get_metric(row, maps, "OptionImageCoverage")))
    if image_health == "GREEN":
        score += 3; reasons.append("图片健康")
    elif image_health == "RED":
        score -= 7; reasons.append("图片健康度RED")
        actions.append("补主图/尺寸图/细节图")
    if 0 < images < 8:
        score -= 3; actions.append("图片不足8张：优先补图")

    for col, label in [
        ("AvailabilityHealth", "可售率"),
        ("DeliverySpeedHealth", "配送速度"),
        ("PriceHealth", "价格竞争力"),
        ("IncidentReturnHealth", "退货/事故"),
    ]:
        hs = health_score(get_metric(row, maps, col))
        score += hs
        if hs < 0:
            reasons.append(f"{label}健康度偏弱")
            actions.append(f"复核{label}问题")
        elif hs > 0:
            reasons.append(f"{label}健康")

    platform_pct = num(get_metric(row, maps, "PlatformPct"))
    platform_margin = num(get_metric(row, maps, "PlatformMargin"))
    if platform_pct >= 0.22:
        score += 8; reasons.append("平台空间充足")
    elif platform_pct >= 0.15:
        score += 4; reasons.append("平台空间可用")
    elif platform_pct > 0:
        score -= 6; reasons.append("平台空间偏低")
        actions.append("促销前复核Base Cost和平台成本")
    elif platform_margin < 0:
        score -= 14; reasons.append("平台空间为负")
        actions.append("禁止促销，先复核Cost Stack")

    sessions = max(num(get_metric(row, maps, "Sessions")), num(get_metric(row, maps, "UniqueVisits")), num(row.get("Visits")))
    cr = max(pct_value(get_metric(row, maps, "OptionCR")), pct_value(get_metric(row, maps, "ListingCR")), pct_value(row.get("CR")))
    class_cr = pct_value(get_metric(row, maps, "ClassCR"))
    if sessions >= 200 and cr < 0.02:
        score -= 6; reasons.append("高访问低转化")
        actions.append("先修价格/主图/评价/配送承接")
    elif cr >= max(0.025, class_cr or 0):
        score += 4; reasons.append("转化率可用")

    sp_spend = num(get_metric(row, maps, "SPSpend"))
    sp_revenue = num(get_metric(row, maps, "SPRevenue"))
    sp_orders = num(get_metric(row, maps, "SPOrders"))
    roas = sp_revenue / sp_spend if sp_spend > 0 else 0
    if sp_spend >= 5 and sp_orders <= 0:
        score -= 8; reasons.append("5月广告有花费无订单")
        actions.append("广告降到最低或暂停")
    elif roas >= 5 and sp_orders > 0:
        score += 5; reasons.append("广告回收较好")

    feedback_count = num(get_metric(row, maps, "FeedbackCount"))
    feedback_damage = num(get_metric(row, maps, "FeedbackDamage"))
    if feedback_damage >= 2:
        score -= 10; reasons.append("多次损坏/缺件反馈")
        actions.append("处理包装、配件和说明书问题")
    elif feedback_count > 0:
        score -= 3; reasons.append("存在客户反馈/退货")
        actions.append("回看Customer Feedback原因")

    cancel_po = num(get_metric(row, maps, "CancelPO"))
    if cancel_po > 0:
        score -= min(6, int(cancel_po) * 2)
        reasons.append("存在取消记录")
        actions.append("复核履约和取消原因")

    promo_count = num(get_metric(row, maps, "PromoCount"))
    promo_lift = num(get_metric(row, maps, "PromoLift"))
    avg_discount = num(get_metric(row, maps, "AvgDiscount"))
    if promo_count > 0 and avg_discount >= 10 and promo_lift and promo_lift < 1:
        score -= 5; reasons.append("历史促销未带来有效提升")
        actions.append("不重复深折扣，先复盘促销承接")
    elif promo_count > 0 and promo_lift >= 1.2:
        score += 3; reasons.append("促销曾有提升")

    score = max(0, min(100, int(round(score))))
    if score >= 80:
        grade = "S"
    elif score >= 60:
        grade = "A"
    elif score >= 40:
        grade = "B"
    elif score >= 15:
        grade = "C"
    else:
        grade = "C"

    if not actions:
        if grade in ("S", "A"):
            actions.append("重点经营：保库存，控广告ACOS，补Listing短板")
        elif grade == "B":
            actions.append("观察优化：先修转化和成本，再放预算")
        else:
            actions.append("谨慎经营：暂停低效广告，复核利润/客诉后再决定")

    return score, grade, reasons, "；".join(dict.fromkeys(actions))


def promo_decision(row: pd.Series, maps: dict[str, pd.DataFrame], grade: str, reasons: list[str]):
    hist_margin = num(row.get("HistMargin"))
    platform_pct = num(get_metric(row, maps, "PlatformPct"))
    rating = max(num(row.get("Rating")), num(get_metric(row, maps, "LifetimeRating")))
    required_tags = max(pct_value(get_metric(row, maps, "RequiredTags")), pct_value(get_metric(row, maps, "OptionRequiredTagCoverage")))
    feedback_damage = num(get_metric(row, maps, "FeedbackDamage"))
    availability = text(get_metric(row, maps, "AvailabilityHealth")).upper()
    incident_health = text(get_metric(row, maps, "IncidentReturnHealth")).upper()
    promo_lift = num(get_metric(row, maps, "PromoLift"))
    avg_discount = num(get_metric(row, maps, "AvgDiscount"))

    blockers = []
    if grade == "N":
        return "新品不进大促", "只允许小预算测款，先补基础Listing和价格口径"
    if hist_margin < 0.15:
        blockers.append("卖家历史净毛利率低于15%")
    if 0 < platform_pct < 0.12:
        blockers.append("平台空间偏低")
    if platform_pct < 0:
        blockers.append("平台空间为负")
    if rating and rating < 4:
        blockers.append("评分低于4.0")
    if required_tags and required_tags < 0.8:
        blockers.append("TAG不足80%")
    if feedback_damage >= 2:
        blockers.append("损坏/缺件反馈较多")
    if availability == "RED":
        blockers.append("可售率RED")
    if incident_health == "RED":
        blockers.append("退货/事故健康度RED")
    if avg_discount >= 10 and promo_lift and promo_lift < 1:
        blockers.append("历史深折扣促销未提升")

    if blockers:
        return "禁止促销/先修复", "；".join(blockers)
    if grade in ("S", "A") and hist_margin >= 0.3 and platform_pct >= 0.2 and rating >= 4.2:
        return "可参加5%-10%轻促", "先控折扣，不建议直接上深折扣"
    if grade in ("A", "B") and hist_margin >= 0.22 and platform_pct >= 0.15:
        return "谨慎参加5%轻促", "必须同时看库存和广告ACOS"
    return "暂不促销", "利润/平台空间/承接未完全通过"


def enrich():
    base, listing_map, option_map, cost_map, feedback_map, promo_map, cancel_map = build_sources()
    maps = {
        "listing": listing_map,
        "option": option_map,
        "cost": cost_map,
        "feedback": feedback_map,
        "promo": promo_map,
    }
    if not cancel_map.empty:
        maps["cancel"] = cancel_map

    rows = []
    for _, row in base.iterrows():
        revised_score, grade, reasons, action = score_row(row, maps)
        promo_status, promo_reason = promo_decision(row, maps, grade, reasons)
        out = row.to_dict()
        out.update({
            "NewGrade": grade,
            "NewScore": revised_score,
            "NewReason": "；".join(dict.fromkeys(reasons)),
            "NewAction": action,
            "PromoReadiness": promo_status,
            "PromoReason": promo_reason,
            "ListingRequiredTags": max(pct_value(get_metric(row, maps, "RequiredTags")), pct_value(get_metric(row, maps, "OptionRequiredTagCoverage"))),
            "ListingRecommendedTags": pct_value(get_metric(row, maps, "RecommendedTags")),
            "TagHealth": text(get_metric(row, maps, "TagHealth")),
            "ImageHealth": text(get_metric(row, maps, "ImageHealth")),
            "AvailabilityHealth": text(get_metric(row, maps, "AvailabilityHealth")),
            "DeliverySpeedHealth": text(get_metric(row, maps, "DeliverySpeedHealth")),
            "PriceHealth": text(get_metric(row, maps, "PriceHealth")),
            "IncidentReturnHealth": text(get_metric(row, maps, "IncidentReturnHealth")),
            "PlatformMarginNew": num(get_metric(row, maps, "PlatformMargin")),
            "PlatformPctNew": num(get_metric(row, maps, "PlatformPct")),
            "RetailPriceNet": num(get_metric(row, maps, "Retail Price Net")),
            "TotalCost": num(get_metric(row, maps, "Total Cost")),
            "SPSpendNew": num(get_metric(row, maps, "SPSpend")),
            "SPRevenueNew": num(get_metric(row, maps, "SPRevenue")),
            "SPOrdersNew": num(get_metric(row, maps, "SPOrders")),
            "FeedbackCount": num(get_metric(row, maps, "FeedbackCount")),
            "FeedbackDamage": num(get_metric(row, maps, "FeedbackDamage")),
            "FeedbackThemes": text(get_metric(row, maps, "FeedbackThemes")),
            "FeedbackSample": text(get_metric(row, maps, "FeedbackSample")),
            "PromoCount": num(get_metric(row, maps, "PromoCount")),
            "AvgDiscount": num(get_metric(row, maps, "AvgDiscount")),
            "PromoLift": num(get_metric(row, maps, "PromoLift")),
            "CancelPO": num(get_metric(row, maps, "CancelPO")),
            "HasNewReportMatch": present_in_maps(row, maps),
        })
        rows.append(out)
    return pd.DataFrame(rows)


def render_table(df: pd.DataFrame, limit: int = 120) -> str:
    rows = []
    cols = [
        "NewGrade", "Part", "Listing", "NewScore", "Qty", "Sales", "NetGross", "HistMargin",
        "PlatformMarginNew", "PlatformPctNew", "ListingRequiredTags", "TagHealth", "ImageHealth",
        "FeedbackCount", "PromoReadiness", "PromoReason", "NewAction",
    ]
    for _, r in df.head(limit).iterrows():
        grade = esc(r["NewGrade"])
        rows.append(
            "<tr>"
            f"<td><span class='pill {grade}'>{grade}</span></td>"
            f"<td><b>{esc(r['Part'])}</b><div class='small'>{esc(r.get('Listing'))}</div></td>"
            f"<td class='right'>{num(r['NewScore']):.0f}</td>"
            f"<td class='right'>{num(r['Qty']):.0f}</td>"
            f"<td class='right'>{money(r['Sales'])}<div class='small'>净毛利 {money(r['NetGross'])} / {pct(r['HistMargin'])}</div></td>"
            f"<td class='right'>{money(r['PlatformMarginNew'])}<div class='small'>{pct(r['PlatformPctNew'])}</div></td>"
            f"<td class='right'>{pct(r['ListingRequiredTags'])}<div class='small'>{esc(r['TagHealth'])} / 图 {esc(r['ImageHealth'])}</div></td>"
            f"<td class='right'>{num(r['FeedbackCount']):.0f}<div class='small'>{esc(r['FeedbackThemes'])}</div></td>"
            f"<td>{esc(r['PromoReadiness'])}<div class='small'>{esc(r['PromoReason'])}</div></td>"
            f"<td>{esc(r['NewAction'])}</td>"
            "</tr>"
        )
    return "\n".join(rows)


def render_html(df: pd.DataFrame):
    REPORTS.mkdir(exist_ok=True)
    main_df = df[~df.get("IsInventoryAlias", False)].copy()
    alias_count = int(df.get("IsInventoryAlias", pd.Series(False, index=df.index)).sum())
    grade_counts = main_df["NewGrade"].value_counts().reindex(["S", "A", "B", "C", "N"], fill_value=0)
    promo_counts = main_df["PromoReadiness"].value_counts()
    matched = int(main_df["HasNewReportMatch"].sum())
    actionable = main_df[main_df["NewGrade"].isin(["S", "A", "B", "C"])].copy()
    focus = actionable.sort_values(["NewGrade", "NewScore", "NetGross"], ascending=[True, False, False])
    stop_ads = actionable[actionable["NewAction"].astype(str).str.contains("暂停|最低", na=False)].sort_values("SPSpendNew", ascending=False)
    fix_listing = actionable[
        (actionable["ListingRequiredTags"] < 0.8)
        | actionable["TagHealth"].astype(str).str.upper().eq("RED")
        | actionable["ImageHealth"].astype(str).str.upper().eq("RED")
    ].sort_values(["Sales", "NewScore"], ascending=False)
    promo_block = actionable[actionable["PromoReadiness"].astype(str).str.contains("禁止|暂不", na=False)].sort_values("Sales", ascending=False)

    def card(label, value, note="", cls=""):
        return f"<div class='card {cls}'><div class='num'>{value}</div><div>{label}</div><small>{note}</small></div>"

    html_text = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayfair 6月SKU分层与促销准入清单</title>
<style>
body{{margin:0;background:#f5f7fb;color:#172033;font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.6}}
header{{background:#10213d;color:#fff;padding:30px 34px}}h1{{margin:0;font-size:28px}}.meta{{color:#dbe7ff;margin-top:6px}}
.wrap{{padding:24px 34px;max-width:1280px;margin:auto}}.grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:0 0 18px}}
.card,.section{{background:#fff;border:1px solid #d8e0ec;border-radius:8px;box-shadow:0 6px 18px #1018280a}}.card{{padding:16px}}.num{{font-size:26px;font-weight:800;color:#1f5cc4}}
.section{{padding:20px;margin:18px 0}}h2{{margin:0 0 12px;font-size:21px}}h3{{margin:18px 0 8px;font-size:16px}}small,.small{{color:#667085;font-size:12px}}
.callout{{border-left:4px solid #1f5cc4;background:#f8fbff;padding:12px 14px;border-radius:8px;margin:12px 0}}.warn{{border-left-color:#b54708;background:#fff8ed}}
.tablebox{{overflow:auto;border:1px solid #d8e0ec;border-radius:8px;max-height:620px}}table{{width:100%;border-collapse:collapse;background:#fff;min-width:1120px}}
th,td{{padding:8px 10px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top;font-size:12.5px}}th{{position:sticky;top:0;background:#eef2f6;z-index:1}}.right{{text-align:right}}
.pill{{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800}}.S{{background:#075f46;color:#fff}}.A{{background:#1d5fd1;color:#fff}}.B{{background:#e3a008;color:#1d2430}}.C{{background:#c2410c;color:#fff}}.N{{background:#6b7280;color:#fff}}
.ok{{color:#087443;font-weight:700}}.bad{{color:#b42318;font-weight:700}}@media(max-width:900px){{.grid{{grid-template-columns:1fr 1fr}}.wrap{{padding:16px}}}}@media(max-width:620px){{.grid{{grid-template-columns:1fr}}}}
</style></head><body>
<header><h1>Wayfair 6月SKU分层与促销准入清单</h1><div class="meta">生成日期：2026-06-04 ｜ 已补齐 Detailed Listing Health、Option Drill Down、Customer Feedback、Cancellation、Promotion、5月 Cost Stack</div></header>
<div class="wrap">
<div class="grid">
{card('S 核心利润款', int(grade_counts['S']), '可放量但仍看库存')}
{card('A 重点经营款', int(grade_counts['A']), '优先经营和修短板')}
{card('B 观察优化款', int(grade_counts['B']), '修转化/成本后复测')}
{card('C 谨慎款', int(grade_counts['C']), '控广告和促销')}
{card('N 新品/无销售', int(grade_counts['N']), '只小预算测款')}
</div>
<div class="section">
<h2>1. 口径说明</h2>
<div class="callout"><b>这不是 Wayfair 官方分数。</b>Wayfair 原始报告提供 TAG、图片、可售、配送、评论、价格竞争力、退货健康度、Option 转化、促销表现、客户反馈、Cost Stack 等指标；本报告的 NewScore / SABC 分级是基于这些数据的运营综合评分。</div>
<div class="callout warn"><b>Cost Stack 已按正确口径处理：</b>平台空间 = Retail Price Net - Total Cost。禁止再用 WholesaleCost - Total Cost 判断平台亏损。</div>
<p>新增报告匹配到的主 SKU 行数：<b>{matched}</b> / {len(main_df)}。已从主表排除库存/仓库 SKU 对照行：<b>{alias_count}</b>。促销准入统计：{', '.join(f'{esc(k)} {int(v)}' for k, v in promo_counts.items())}</p>
</div>
<div class="section">
<h2>2. 立即执行重点</h2>
<ul>
<li>先处理“禁止促销/先修复”和“暂不促销”的 SKU，不要直接进大促。</li>
<li>有客户反馈中出现 Damage / Missing Parts / Defect 的 SKU，先回查包装、配件、说明书和质检。</li>
<li>TAG 低于 80% 或 Tag Health 为 RED 的 SKU，先补 Listing，再考虑广告加预算。</li>
<li>平台空间低于 12% 或卖家历史净毛利率低于 15% 的 SKU，不要叠加广告和促销。</li>
</ul>
</div>
<div class="section">
<h2>3. SKU 分层与促销准入总表</h2>
<div class="tablebox"><table><thead><tr><th>级别</th><th>SKU / Listing</th><th>分数</th><th>历史件数</th><th>历史销售/利润</th><th>平台空间</th><th>TAG/图片</th><th>客户反馈</th><th>促销准入</th><th>动作</th></tr></thead><tbody>
{render_table(focus, 260)}
</tbody></table></div>
</div>
<div class="section">
<h2>4. 需要先降广告/暂停的 SKU</h2>
<div class="tablebox"><table><thead><tr><th>级别</th><th>SKU / Listing</th><th>分数</th><th>历史件数</th><th>历史销售/利润</th><th>平台空间</th><th>TAG/图片</th><th>客户反馈</th><th>促销准入</th><th>动作</th></tr></thead><tbody>
{render_table(stop_ads, 80)}
</tbody></table></div>
</div>
<div class="section">
<h2>5. Listing 先修复 SKU</h2>
<div class="tablebox"><table><thead><tr><th>级别</th><th>SKU / Listing</th><th>分数</th><th>历史件数</th><th>历史销售/利润</th><th>平台空间</th><th>TAG/图片</th><th>客户反馈</th><th>促销准入</th><th>动作</th></tr></thead><tbody>
{render_table(fix_listing, 80)}
</tbody></table></div>
</div>
<div class="section">
<h2>6. 禁促/暂不促销 SKU</h2>
<div class="tablebox"><table><thead><tr><th>级别</th><th>SKU / Listing</th><th>分数</th><th>历史件数</th><th>历史销售/利润</th><th>平台空间</th><th>TAG/图片</th><th>客户反馈</th><th>促销准入</th><th>动作</th></tr></thead><tbody>
{render_table(promo_block, 100)}
</tbody></table></div>
</div>
</div></body></html>"""
    OUT_HTML.write_text(html_text, encoding="utf-8")


def main():
    df = enrich()
    historical_parts = set(df.loc[(pd.to_numeric(df["Orders"], errors="coerce").fillna(0) > 0) | (pd.to_numeric(df["Sales"], errors="coerce").fillna(0) > 0), "Part"].astype(str))
    df["IsInventoryAlias"] = (
        pd.to_numeric(df["Orders"], errors="coerce").fillna(0).le(0)
        & pd.to_numeric(df["Sales"], errors="coerce").fillna(0).le(0)
        & df["Listing"].astype(str).isin(historical_parts)
    )
    df.loc[df["IsInventoryAlias"], "PromoReadiness"] = "库存对照行不单独决策"
    df.loc[df["IsInventoryAlias"], "PromoReason"] = "该行是仓库/库存SKU映射，主决策以对应销售SKU为准"
    preferred = [
        "NewGrade", "NewScore", "Part", "Listing", "Name", "Category", "Status",
        "Qty", "Orders", "Sales", "NetGross", "HistMargin", "PlatformMarginNew",
        "PlatformPctNew", "ListingRequiredTags", "ListingRecommendedTags", "TagHealth",
        "ImageHealth", "AvailabilityHealth", "DeliverySpeedHealth", "PriceHealth",
        "IncidentReturnHealth", "FeedbackCount", "FeedbackDamage", "PromoReadiness",
        "PromoReason", "NewReason", "NewAction",
    ]
    ordered = [c for c in preferred if c in df.columns] + [c for c in df.columns if c not in preferred]
    df = df[ordered].sort_values(["NewGrade", "NewScore", "NetGross"], ascending=[True, False, False])
    DATA.mkdir(exist_ok=True)
    df.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")
    render_html(df)
    print("wrote", OUT_CSV)
    print("wrote", OUT_HTML)
    main_df = df[~df["IsInventoryAlias"]]
    print(main_df["NewGrade"].value_counts().reindex(["S", "A", "B", "C", "N"], fill_value=0).to_string())
    print(main_df["PromoReadiness"].value_counts().to_string())
    print("inventory_alias_rows", int(df["IsInventoryAlias"].sum()))


if __name__ == "__main__":
    main()
