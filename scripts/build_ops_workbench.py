from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

REPORT_DATE = "2026-06-12"

PRICING_CSV = DATA / "Wayfair_产品定价体检表_20260605.csv"
SKU_SCORE_CSV = DATA / "Wayfair_SKU价值分级_补齐版_20260604.csv"
INVENTORY_CSV = DATA / "Wayfair_库存映射对照_20260604.csv"

OUT_TASKS = DATA / "Wayfair_运营任务清单_20260605.csv"
OUT_PROFILES = DATA / "Wayfair_SKU经营档案_20260605.csv"

OUT_EXEC_CENTER = REPORTS / "Wayfair_运营执行中心_20260605.html"
OUT_TASK_REPORT = REPORTS / "Wayfair_SKU任务清单_20260605.html"
OUT_SKU_PROFILE = REPORTS / "Wayfair_SKU经营档案_20260605.html"

TASK_COLUMNS = [
    "任务ID",
    "优先级",
    "任务状态",
    "问题类型",
    "供应商SKU",
    "Wayfair Listing",
    "产品名",
    "SKU价值分层",
    "促销准入",
    "触发原因",
    "建议动作",
    "执行前检查",
    "复盘指标",
    "证据来源",
    "证据链接",
    "排序分",
]

PROFILE_COLUMNS = [
    "供应商SKU",
    "Wayfair Listing",
    "产品名",
    "类目",
    "SKU价值分层",
    "促销准入",
    "定价分组",
    "库存状态",
    "可用库存",
    "总可售含在途",
    "5月订单数",
    "YB历史订单数",
    "5月回款额",
    "YB历史回款额",
    "5月毛利",
    "YB历史毛利",
    "5月毛利率",
    "YB历史毛利率",
    "当前Base预估毛利率",
    "当前Base",
    "美国前台价",
    "Base前台价比例",
    "平台空间率",
    "Wayfair Total Cost",
    "客诉扣款记录数",
    "客诉扣款金额",
    "广告花费",
    "广告订单",
    "ROAS",
    "Listing问题",
    "系统总建议",
    "运营主动作",
    "执行前检查",
    "复盘指标",
    "详情锚点",
]

TYPE_SLUG = {
    "定价": "PRICING",
    "促销": "PROMO",
    "广告": "ADS",
    "库存": "INVENTORY",
    "Listing": "LISTING",
    "数据缺口": "DATA",
    "客诉": "FEEDBACK",
    "综合经营": "OPS",
}

PRIORITY_SCORE = {"P0": 300, "P1": 200, "P2": 100}


def is_missing(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, (list, tuple, dict, set)):
        return False
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def esc(value: object) -> str:
    if is_missing(value):
        return ""
    return html.escape(str(value).strip())


def text(value: object) -> str:
    if is_missing(value):
        return ""
    return str(value).strip()


def num(value: object, default: float = 0.0) -> float:
    if is_missing(value):
        return default
    if isinstance(value, str):
        value = value.replace("$", "").replace(",", "").replace("%", "").strip()
        if value == "":
            return default
    try:
        return float(value)
    except Exception:
        return default


def pct(value: object) -> str:
    return f"{num(value) * 100:.1f}%"


def money(value: object) -> str:
    return f"${num(value):,.2f}"


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value.strip()).strip("-")
    return cleaned or "SKU"


def make_task_id(sku: str, task_type: str, seq: int) -> str:
    task_slug = TYPE_SLUG.get(task_type, slug(task_type).upper())
    return f"TASK-{slug(sku)}-{task_slug}-{seq:03d}"


def sort_tasks(rows: Iterable[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda r: (
            -PRIORITY_SCORE.get(text(r.get("优先级")), 0),
            -num(r.get("排序分")),
            text(r.get("供应商SKU")),
            text(r.get("问题类型")),
        ),
    )


def store_action_plan(row: dict | pd.Series, priority: str, metrics: dict[str, object]) -> tuple[str, str, str]:
    inventory_status = text(row.get("库存状态"))
    available = num(row.get("可用库存"))
    sellable = num(row.get("总可售含在途"))
    listing_issue = text(row.get("Listing问题"))
    promo = text(row.get("促销准入"))
    complaint_count = num(row.get("客诉扣款记录数"))
    complaint_amount = num(row.get("客诉扣款金额"))
    ad_spend = num(row.get("广告花费"))
    ad_orders = num(row.get("广告订单"))
    roas = num(row.get("ROAS"))
    base_ratio = num(row.get("Base前台价比例"))
    platform_pct = float(metrics.get("platform_pct", 0) or 0)
    est_margin = float(metrics.get("est_margin", 0) or 0)
    total_orders = float(metrics.get("total_orders", 0) or 0)

    if priority == "P2":
        return (
            "尾部只保留基础监控：不进大促、不加广告；等出现订单、可售库存和平台空间同时改善后再升级。",
            "确认是否有新品上架计划、样品图文是否完整、是否存在库存/价格基础错误。",
            "复盘是否新增订单、可售库存是否恢复、平台空间率是否仍高于18%。",
        )

    if inventory_status != "库存可查" or sellable <= 0:
        if complaint_count > 0 or "Damage" in listing_issue or "Missing" in listing_issue or "Defect" in listing_issue:
            return (
                "库存恢复前先闭环客诉：核对包装/配件/说明书问题；可售恢复后只做小流量验证，不直接放大促销。",
                f"查库存映射和客诉明细；当前可用 {available:.0f}，含在途 {sellable:.0f}，客诉/扣款 {complaint_count:.0f} 条。",
                "复盘可售恢复、Damage/Missing/Defect 反馈、扣款金额和恢复后7天转化。",
            )
        if ad_spend >= 300:
            return (
                "库存锁定+广告减损：库存未恢复前暂停该 SKU 商品广告；恢复后只回开高意图词，预算按原来的30%试跑。",
                f"查库存 ETA，同时导出 WSP：该 SKU 5月广告 spend {money(ad_spend)}、orders {ad_orders:.0f}、ROAS {roas:.2f}。",
                "复盘恢复前广告节省金额、恢复后7天订单、ROAS 和库存消耗速度。",
            )
        if "Required Tags" in listing_issue:
            return (
                "库存锁定+Listing补齐：等可售恢复时同步补 Required Tags/Review 承接，避免库存回来后流量仍不转化。",
                f"查库存映射；同步处理 {listing_issue}，补 TAG、标题关键词、主图/尺寸图和QA。",
                "复盘 Listing Health、可售恢复后7天 CVR、广告点击到订单转化。",
            )
        if ad_spend >= 80 and (ad_orders <= 1 or roas < 2):
            return (
                "库存锁定+关键词止损：库存未恢复前停低效词；恢复后先用精确高意图词测，不恢复广泛匹配。",
                f"查库存 ETA；广告 spend {money(ad_spend)}、orders {ad_orders:.0f}、ROAS {roas:.2f}，先标记浪费词。",
                "复盘低效词花费下降、恢复后精确词订单和 ROAS。",
            )
        if base_ratio >= 0.72:
            return (
                "库存锁定+价格护栏：可售恢复前不提 Base；先复核 Base/前台价比例，避免库存回来后价格继续压转化。",
                f"查库存映射；核对 Base/前台价 {base_ratio * 100:.1f}%、平台空间 {platform_pct * 100:.1f}%。",
                "复盘可售恢复、价格竞争百分位、CVR 和真实订单毛利。",
            )
        if listing_issue:
            return (
                "库存锁定+评价承接：库存恢复前补 Review/QA/卖点说明；先解决信任问题，再恢复轻促或广告。",
                f"查库存映射；同步处理 {listing_issue}，补评价承接、QA 和主图卖点。",
                "复盘 Review 数、CVR、加购/下单转化和恢复后7天订单。",
            )
        return (
            "先锁库存：当天核对库存映射和可售数；无可售先暂停促销/加预算，确认可售后再恢复轻促或广告。",
            f"查库存映射、仓库可售、在途 ETA；当前可用 {available:.0f}，含在途 {sellable:.0f}。",
            "复盘缺货天数、可售恢复时间、恢复后7天订单和广告花费是否回收。",
        )

    if ad_spend >= 20 and (ad_orders <= 0 or roas < 2):
        return (
            "先止损广告：暂停无订单 Campaign/Keyword，保留品牌词或高意图词；预算转给同类高转化款。",
            f"导出5月 WSP 搜索词，标记 spend {money(ad_spend)}、orders {ad_orders:.0f}、ROAS {roas:.2f} 的低效词。",
            "复盘7天广告花费、订单、ROAS、自然订单是否被误伤。",
        )

    if listing_issue:
        return (
            "先修 Listing 转化：补 Required Tags/主图/尺寸图，Review 少的先补 QA 和卖点；修完再开轻促或加预算。",
            f"逐项处理 Listing Health：{listing_issue}；同步检查标题关键词、图片数、Review 与差评关键词。",
            "复盘 Listing Health、Unique Visits、CVR、Review 数和客诉关键词是否改善。",
        )

    if complaint_count > 0:
        return (
            "先闭环客诉：按扣款原因拆包装、配件、说明书和质检责任；未定位前不放大促销流量。",
            f"拉客诉/扣款明细 {complaint_count:.0f} 条、金额 {money(complaint_amount)}，归因到 Damage/Missing/Defect/物流。",
            "复盘扣款率、退货/损坏反馈、差评关键词和补件成本。",
        )

    if base_ratio >= 0.72 or platform_pct < 0.16 or est_margin < 0.18:
        return (
            "先修成本/价格：复核 Base、前台价和 Total Cost，优先降拿货/包装/发货成本，不先提 Base。",
            f"核对 Base/前台价 {base_ratio * 100:.1f}%、平台空间 {platform_pct * 100:.1f}%、预估毛利 {est_margin * 100:.1f}%。",
            "复盘平台空间率、真实订单毛利率、价格竞争百分位和 Buy Box/转化。",
        )

    if "禁止" in promo or "暂不" in promo:
        return (
            "只做低风险承接：暂不报名深折扣；先用 Listing/库存/广告小修复验证转化，达标后再测5%轻促。",
            f"确认促销禁入原因：{promo}；促销前必须同时满足库存可售、毛利率和 Listing Health。",
            "复盘轻促前后订单、毛利、CVR、客诉和库存消耗速度。",
        )

    if priority == "P0" and total_orders >= 20:
        return (
            "可控放量：保安全库存，5%-8%轻促或高意图广告小幅加预算；不做深折扣换销量。",
            "确认7天安全库存、毛利底线、主图/TAG/Review 无红灯，再设置预算和促销上限。",
            "复盘7天订单增量、真实毛利、库存周转、ROAS 和客诉率。",
        )

    return (
        "腰部验证：先修最大短板，再做小流量测试；连续7天毛利和转化达标后升级到P0。",
        "按库存、Listing、价格、广告顺序查一遍，记录当前订单、毛利、CVR 和 ROAS 基线。",
        "复盘7天订单、毛利率、CVR、ROAS 和是否进入稳定可放量池。",
    )


def task(
    sku: str,
    listing: str,
    name: str,
    grade: str,
    promo: str,
    priority: str,
    task_type: str,
    reason: str,
    action: str,
    check: str,
    review_metric: str,
    source: str,
    link: str,
    score: float,
    seq: int,
) -> dict:
    return {
        "任务ID": make_task_id(sku, task_type, seq),
        "优先级": priority,
        "任务状态": "待执行",
        "问题类型": task_type,
        "供应商SKU": sku,
        "Wayfair Listing": listing,
        "产品名": name,
        "SKU价值分层": grade,
        "促销准入": promo,
        "触发原因": reason,
        "建议动作": action,
        "执行前检查": check,
        "复盘指标": review_metric,
        "证据来源": source,
        "证据链接": link,
        "排序分": score,
    }


def first_text(row: dict | pd.Series, *keys: str) -> str:
    for key in keys:
        value = text(row.get(key))
        if value:
            return value
    return ""


def base_fields(row: dict | pd.Series) -> tuple[str, str, str, str, str]:
    return (
        first_text(row, "供应商SKU", "Part", "SupplierPart"),
        first_text(row, "Wayfair Listing", "Listing", "Wayfair店铺SKU"),
        first_text(row, "中文名", "Name", "YB中文名"),
        first_text(row, "SKU价值分层", "NewGrade"),
        first_text(row, "促销准入", "PromoReadiness"),
    )


def pricing_tasks(row: dict | pd.Series) -> list[dict]:
    sku, listing, name, grade, promo = base_fields(row)
    group = text(row.get("定价分组"))
    issues = text(row.get("主要问题"))
    action_text = text(row.get("建议动作"))
    if group in {"不建议提价", "先修成本"}:
        priority = "P0"
        score = 95 if group == "不建议提价" else 88
    elif group in {"待补成本", "待确认价格"}:
        priority = "P1"
        score = 72
    else:
        return []
    return [
        task(
            sku=sku,
            listing=listing,
            name=name,
            grade=grade,
            promo=promo,
            priority=priority,
            task_type="定价",
            reason=f"{group}：{issues}",
            action=action_text,
            check="打开产品定价体检表，展开该 SKU 的 Total Cost 明细，确认 Base、前台价、平台空间和你的成本。",
            review_metric="下次复盘看：平台空间率、真实订单毛利率、是否仍被判为不建议提价或先修成本。",
            source="产品定价体检表",
            link="./Wayfair_产品定价体检表_20260605.html",
            score=score,
            seq=1,
        )
    ]


def promo_tasks(row: dict | pd.Series) -> list[dict]:
    sku, listing, name, grade, promo = base_fields(row)
    reason = text(row.get("PromoReason") or row.get("促销准入"))
    if "禁止" in promo or "禁促" in promo:
        priority = "P0"
        action = "不要进深折扣促销；先处理利润、客诉、库存或 Listing 承接问题。"
        score = 92
    elif "暂不" in promo:
        priority = "P1"
        action = "暂不报名促销；先确认库存、利润和 Listing 承接。"
        score = 70
    elif "谨慎" in promo:
        priority = "P2"
        action = "只允许轻促观察；促销前再次确认库存和真实毛利。"
        score = 45
    else:
        return []
    return [
        task(
            sku=sku,
            listing=listing,
            name=name,
            grade=grade,
            promo=promo,
            priority=priority,
            task_type="促销",
            reason=reason or promo,
            action=action,
            check="先看 SKU 分层与促销准入清单，再看定价体检和库存映射。",
            review_metric="下次复盘看：促销期订单、促销后毛利、是否出现客诉或退货异常。",
            source="SKU 分层与促销准入清单",
            link="./Wayfair_6月SKU分层与促销准入清单_20260604.html",
            score=score,
            seq=1,
        )
    ]


def listing_tasks(row: dict | pd.Series) -> list[dict]:
    sku, listing, name, grade, promo = base_fields(row)
    tags = num(row.get("ListingRequiredTags"))
    reviews = num(row.get("Reviews"))
    feedback_damage = num(row.get("FeedbackDamage"))
    reasons: list[str] = []
    if tags and tags < 0.8:
        reasons.append(f"Required Tags 覆盖率 {tags * 100:.1f}% 低于 80%")
    if reviews and reviews < 20:
        reasons.append(f"Review 数 {reviews:.0f} 低于 20")
    if feedback_damage > 0:
        reasons.append("客户反馈出现 Damage / Missing / Defect 类问题")
    if not reasons:
        return []
    return [
        task(
            sku=sku,
            listing=listing,
            name=name,
            grade=grade,
            promo=promo,
            priority="P1",
            task_type="Listing",
            reason="；".join(reasons),
            action="先修 Listing 承接：补必填 TAG、补图片/说明、复盘差评和客诉原因。",
            check="打开 SKU 分层与促销准入清单，查看 TAG、图片、客户反馈和促销准入。",
            review_metric="下次复盘看：Unique Visits、CVR、Review Count、Feedback Damage 数。",
            source="Detailed Listing Health / Customer Feedback",
            link="./Wayfair_6月SKU分层与促销准入清单_20260604.html",
            score=68 + min(feedback_damage, 5),
            seq=1,
        )
    ]


def inventory_tasks(row: dict | pd.Series) -> list[dict]:
    sku, listing, name, grade, promo = base_fields(row)
    if not sku:
        return []
    confidence = text(row.get("置信度"))
    available = num(row.get("可用量"))
    total_available = num(row.get("总可售含在途"))
    if confidence in {"低", "未匹配"}:
        reason = f"库存映射置信度为 {confidence}"
        priority = "P1"
        score = 74
    elif total_available <= 0:
        reason = "总可售含在途为 0"
        priority = "P0"
        score = 90
    elif available <= 2:
        reason = f"可用库存仅 {available:.0f}"
        priority = "P1"
        score = 66
    else:
        return []
    return [
        task(
            sku=sku,
            listing=listing,
            name=name,
            grade=grade,
            promo=promo,
            priority=priority,
            task_type="库存",
            reason=reason,
            action="促销、加预算、补货前先人工确认库存映射和可售数量。",
            check="打开库存映射对照工具，确认仓库 SKU、Wayfair SKU、可用量和在途量。",
            review_metric="下次复盘看：是否仍出现缺货 SKU 投广告或进入促销。",
            source="库存映射对照工具",
            link="./Wayfair_库存映射对照工具_20260604.html",
            score=score,
            seq=1,
        )
    ]


# ── Task 4: Dataset loading and profile building ──────────────────────────────

def load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig", low_memory=False)


def load_sources() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    pricing = load_csv(PRICING_CSV)
    score = load_csv(SKU_SCORE_CSV)
    inventory = load_csv(INVENTORY_CSV)
    return pricing, score, inventory


def inventory_by_part(inventory: pd.DataFrame) -> pd.DataFrame:
    inv = inventory.copy()
    inv["供应商SKU"] = inv["SupplierPart"].map(text)
    inv = inv[inv["供应商SKU"].ne("")]
    inv = inv.sort_values(["供应商SKU", "分数"], ascending=[True, False])
    return inv.drop_duplicates("供应商SKU", keep="first")


def build_profiles(pricing: pd.DataFrame, score: pd.DataFrame, inventory: pd.DataFrame) -> pd.DataFrame:
    inv = inventory_by_part(inventory)
    score_keep = [
        "Part", "Listing", "Name", "NewGrade", "PromoReadiness", "PromoReason",
        "ListingRequiredTags", "Reviews", "FeedbackDamage", "SPSpendNew",
        "SPOrdersNew", "SPRevenueNew", "ROAS", "NewAction",
    ]
    score_slim = score[[c for c in score_keep if c in score.columns]].copy()
    score_slim = score_slim.rename(columns={
        "Part": "供应商SKU",
        "Listing": "ScoreListing",
        "Name": "ScoreName",
        "NewGrade": "ScoreGrade",
        "PromoReadiness": "ScorePromoReadiness",
    })

    merged = (
        pricing.merge(score_slim, on="供应商SKU", how="left")
        .merge(inv[["供应商SKU", "置信度", "可用量", "总可售含在途"]], on="供应商SKU", how="left")
    )
    merged["详情锚点"] = merged["供应商SKU"].map(lambda s: f"sku-{slug(text(s))}")
    merged["库存状态"] = merged.apply(
        lambda r: "需人工确认库存映射" if text(r.get("置信度")) in {"低", "未匹配"} else (
            "库存不足" if num(r.get("总可售含在途")) <= 0 else "库存可查"
        ),
        axis=1,
    )
    merged["Listing问题"] = merged.apply(
        lambda r: "；".join(
            item for item in [
                f"Required Tags {num(r.get('ListingRequiredTags')) * 100:.1f}%" if num(r.get("ListingRequiredTags")) and num(r.get("ListingRequiredTags")) < 0.8 else "",
                f"Reviews {num(r.get('Reviews')):.0f}" if num(r.get("Reviews")) and num(r.get("Reviews")) < 20 else "",
                "客户反馈含 Damage/Missing/Defect" if num(r.get("FeedbackDamage")) > 0 else "",
            ] if item
        ),
        axis=1,
    )
    score_listing = merged["ScoreListing"] if "ScoreListing" in merged.columns else pd.Series("", index=merged.index)
    score_name = merged["ScoreName"] if "ScoreName" in merged.columns else pd.Series("", index=merged.index)
    score_grade = merged["ScoreGrade"] if "ScoreGrade" in merged.columns else pd.Series("", index=merged.index)
    score_promo = merged["ScorePromoReadiness"] if "ScorePromoReadiness" in merged.columns else pd.Series("", index=merged.index)

    def col(name: str) -> pd.Series:
        return merged[name] if name in merged.columns else pd.Series(0, index=merged.index)

    out = pd.DataFrame({
        "供应商SKU": merged["供应商SKU"],
        "Wayfair Listing": merged["Wayfair Listing"].fillna(score_listing),
        "产品名": merged["中文名"].fillna(score_name),
        "类目": col("类目"),
        "SKU价值分层": merged["SKU价值分层"].fillna(score_grade),
        "促销准入": merged["促销准入"].fillna(score_promo),
        "定价分组": col("定价分组"),
        "库存状态": merged["库存状态"],
        "可用库存": col("可用量"),
        "总可售含在途": col("总可售含在途"),
        "5月订单数": col("5月订单数"),
        "YB历史订单数": col("YB历史订单数"),
        "5月回款额": col("5月回款额"),
        "YB历史回款额": col("YB历史回款额"),
        "5月毛利": col("5月毛利"),
        "YB历史毛利": col("YB历史毛利"),
        "5月毛利率": col("5月毛利率"),
        "YB历史毛利率": col("YB历史毛利率"),
        "当前Base预估毛利率": col("当前Base预估毛利率"),
        "当前Base": col("Catalog当前Base Cost"),
        "美国前台价": col("美国前台价"),
        "Base前台价比例": col("Base/前台价"),
        "平台空间率": col("平台空间率"),
        "Wayfair Total Cost": col("Wayfair Total Cost"),
        "客诉扣款记录数": col("客诉扣款记录数"),
        "客诉扣款金额": col("客诉扣款金额"),
        "广告花费": col("SPSpendNew"),
        "广告订单": col("SPOrdersNew"),
        "ROAS": col("ROAS"),
        "Listing问题": merged["Listing问题"],
        "详情锚点": merged["详情锚点"],
    })
    advice = out.apply(
        lambda r: pd.Series(
            store_action_plan(r, store_priority(r, [])[0], commercial_metrics(r)),
            index=["运营主动作", "执行前检查", "复盘指标"],
        ),
        axis=1,
    )
    out[["运营主动作", "执行前检查", "复盘指标"]] = advice
    out["系统总建议"] = out.apply(
        lambda r: "；".join(item for item in [
            text(r.get("运营主动作")),
            text(r.get("执行前检查")),
        ] if item),
        axis=1,
    )
    return out[PROFILE_COLUMNS].copy()


def build_tasks(pricing: pd.DataFrame, score: pd.DataFrame, inventory: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []

    for row in pricing.to_dict("records"):
        rows.extend(pricing_tasks(row))

    for row in score.to_dict("records"):
        rows.extend(promo_tasks(row))
        rows.extend(listing_tasks(row))

    inv = inventory.rename(columns={
        "SupplierPart": "供应商SKU",
        "Wayfair店铺SKU": "Wayfair Listing",
        "YB中文名": "中文名",
    })
    for row in inv.to_dict("records"):
        rows.extend(inventory_tasks(row))

    ordered = sort_tasks(rows)
    used: dict[str, int] = {}
    for row in ordered:
        base = row["任务ID"]
        used[base] = used.get(base, 0) + 1
        if used[base] > 1:
            row["任务ID"] = f"{base}-{used[base]:02d}"

    df = pd.DataFrame(ordered)
    if df.empty:
        return pd.DataFrame(columns=TASK_COLUMNS)
    return df[TASK_COLUMNS].copy()


def commercial_metrics(row: dict | pd.Series) -> dict[str, float | str | bool]:
    grade = text(row.get("SKU价值分层"))
    may_orders = num(row.get("5月订单数"))
    hist_orders = num(row.get("YB历史订单数"))
    total_orders = may_orders + hist_orders
    may_revenue = num(row.get("5月回款额"))
    hist_revenue = num(row.get("YB历史回款额"))
    revenue = may_revenue + hist_revenue
    may_profit = num(row.get("5月毛利"))
    hist_profit = num(row.get("YB历史毛利"))
    profit = may_profit + hist_profit
    platform_pct = num(row.get("平台空间率"))
    est_margin = num(row.get("当前Base预估毛利率"))
    head_or_waist = grade in {"S", "A", "B"} or total_orders >= 12 or profit >= 300
    tail_no_sales = grade == "N" or (total_orders < 3 and revenue < 200 and profit <= 0)
    profitable_now = total_orders > 0 and profit > 0
    profit_candidate = platform_pct >= 0.18 and est_margin >= 0.20
    return {
        "grade": grade,
        "total_orders": total_orders,
        "revenue": revenue,
        "profit": profit,
        "platform_pct": platform_pct,
        "est_margin": est_margin,
        "head_or_waist": head_or_waist,
        "tail_no_sales": tail_no_sales,
        "profitable_now": profitable_now,
        "profit_candidate": profit_candidate,
    }


def store_priority(row: dict | pd.Series, sku_tasks: list[dict]) -> tuple[str, float]:
    metrics = commercial_metrics(row)
    if metrics["tail_no_sales"]:
        return "P2", 25 + min(float(metrics["platform_pct"]) * 50, 12)

    grade_score = {"S": 50, "A": 45, "B": 35, "C": 20}.get(str(metrics["grade"]), 0)
    score = grade_score
    score += min(float(metrics["total_orders"]) * 1.2, 40)
    score += min(max(float(metrics["profit"]), 0) / 50, 35)
    score += 12 if float(metrics["platform_pct"]) >= 0.20 else (6 if float(metrics["platform_pct"]) >= 0.16 else 0)
    score += 8 if num(row.get("5月订单数")) > 0 else 0
    score += 8 if text(row.get("库存状态")) != "库存可查" else 0
    score += 6 if "禁止" in text(row.get("促销准入")) else 0
    score += 5 if text(row.get("Listing问题")) else 0
    score += 5 if any(text(t.get("问题类型")) == "定价" for t in sku_tasks) else 0

    if score >= 75 and (metrics["profitable_now"] or metrics["profit_candidate"]):
        return "P0", score
    if score >= 45 and (metrics["profitable_now"] or metrics["profit_candidate"] or metrics["head_or_waist"]):
        return "P1", score
    return "P2", score


def build_store_actions(profiles: pd.DataFrame, tasks: pd.DataFrame) -> list[dict]:
    task_map = {
        sku: group.to_dict("records")
        for sku, group in tasks.groupby("供应商SKU", dropna=False)
    }
    actions: list[dict] = []
    for _, r in profiles.iterrows():
        sku = text(r["供应商SKU"])
        sku_tasks = task_map.get(sku, [])
        priority, score = store_priority(r, sku_tasks)
        metrics = commercial_metrics(r)
        risks = []
        if text(r.get("库存状态")) != "库存可查":
            risks.append("库存/映射")
        if "禁止" in text(r.get("促销准入")) or "暂不" in text(r.get("促销准入")):
            risks.append("促销准入")
        if text(r.get("Listing问题")):
            risks.append("Listing承接")
        if any(text(t.get("问题类型")) == "定价" for t in sku_tasks):
            risks.append("定价/成本")
        if num(r.get("客诉扣款记录数")) > 0:
            risks.append("客诉扣款")
        if num(r.get("广告花费")) >= 20 and (num(r.get("广告订单")) <= 0 or num(r.get("ROAS")) < 2):
            risks.append("广告止损")
        if not risks:
            risks.append("维持观察")

        if metrics["profitable_now"]:
            lead = "当前盈利款"
        elif metrics["profit_candidate"]:
            lead = "可盈利候选款"
        else:
            lead = "尾部观察款"

        action, check, review_metric = store_action_plan(r, priority, metrics)

        actions.append(task(
            sku=sku,
            listing=text(r.get("Wayfair Listing")),
            name=text(r.get("产品名")),
            grade=text(r.get("SKU价值分层")),
            promo=text(r.get("促销准入")),
            priority=priority,
            task_type="综合经营",
            reason=(
                f"{lead}：总订单 {float(metrics['total_orders']):.0f}，"
                f"累计毛利 {money(metrics['profit'])}，平台空间率 {pct(metrics['platform_pct'])}；"
                f"主要风险：{'、'.join(risks)}"
            ),
            action=action,
            check=check,
            review_metric=review_metric,
            source="SKU 经营档案",
            link=f"./Wayfair_SKU经营档案_20260605.html#{esc(r.get('详情锚点'))}",
            score=score,
            seq=1,
        ))
    return sort_tasks(actions)


def align_task_priorities_to_store_value(profiles: pd.DataFrame, tasks: pd.DataFrame) -> pd.DataFrame:
    store_priority_map = {
        text(row["供应商SKU"]): store_priority(row, tasks[tasks["供应商SKU"].eq(row["供应商SKU"])].to_dict("records"))[0]
        for _, row in profiles.iterrows()
    }
    adjusted = tasks.copy()
    priority_rank = {"P0": 3, "P1": 2, "P2": 1}
    for idx, row in adjusted.iterrows():
        store_p = store_priority_map.get(text(row["供应商SKU"]), "P2")
        task_p = text(row["优先级"])
        if priority_rank.get(task_p, 0) > priority_rank.get(store_p, 0):
            adjusted.at[idx, "优先级"] = store_p
            adjusted.at[idx, "排序分"] = min(num(row["排序分"]), {"P0": 95, "P1": 78, "P2": 42}[store_p])
            adjusted.at[idx, "触发原因"] = f"{row['触发原因']}；综合经营优先级为 {store_p}，按店铺价值降级处理"
    return pd.DataFrame(sort_tasks(adjusted.to_dict("records")))[TASK_COLUMNS]


# ── Task 5: HTML helpers and report rendering ─────────────────────────────────

def tag(value: str) -> str:
    cls = {
        "P0": "tag red",
        "P1": "tag amber",
        "P2": "tag blue",
        "待执行": "tag amber",
        "执行中": "tag blue",
        "已执行": "tag green",
        "暂缓": "tag gray",
        "等数据": "tag gray",
    }.get(value, "tag gray")
    return f"<span class='{cls}'>{esc(value)}</span>"


def page(title: str, body: str, extra_head: str = "") -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <style>
    body{{margin:0;background:#f6f7fb;color:#172033;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif}}
    header{{background:#10213d;color:#fff;padding:28px 34px}}
    h1{{margin:0;font-size:28px}}
    .meta{{color:#dbe7ff;margin-top:6px}}
    .wrap{{max-width:1320px;margin:auto;padding:24px 34px}}
    .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}}
    .card,.section{{background:#fff;border:1px solid #d8e0ec;border-radius:8px;padding:16px;box-shadow:0 6px 18px #1018280a}}
    .num{{font-size:28px;font-weight:900;color:#1f5cc4}}
    .tag{{display:inline-block;border-radius:999px;padding:3px 9px;font-weight:800;font-size:12px}}
    .red{{background:#fee4e2;color:#b42318}}.amber{{background:#fff3cd;color:#92400e}}.blue{{background:#dbeafe;color:#175cd3}}.green{{background:#dcfce7;color:#166534}}.gray{{background:#eef2f6;color:#475467}}
    .tablebox{{overflow:auto;border:1px solid #d8e0ec;border-radius:8px;background:#fff;max-height:720px}}
    table{{width:100%;border-collapse:collapse;min-width:1280px}}
    th,td{{padding:9px 10px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top}}
    th{{position:sticky;top:0;background:#eef2f6;z-index:2}}
    a{{color:#175cd3;text-decoration:none;font-weight:800}}
    .small{{color:#667085;font-size:12px}}
  </style>
  {extra_head}
</head>
<body>
<header><h1>{esc(title)}</h1><div class="meta">生成日期：{REPORT_DATE} ｜ 目标：打开后 10 分钟知道本周先做什么</div></header>
<div class="wrap">{body}</div>
</body>
</html>"""


_TABLE_STYLES = """<style>
/* ── fixed-layout task / exec tables ──────────────────── */
.task-tbl,.exec-tbl{table-layout:fixed;width:100%;border-collapse:collapse;word-break:break-all;overflow-wrap:anywhere}
.task-tbl td,.exec-tbl td,.task-tbl th,.exec-tbl th{padding:8px 9px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top;font-size:13px}
/* task-tbl (8 cols): pri sku type reason action metric evidence status */
.task-tbl col.c0{width:88px}.task-tbl col.c1{width:130px}.task-tbl col.c2{width:65px}
.task-tbl col.c3{width:155px}.task-tbl col.c4{width:215px}.task-tbl col.c5{width:140px}
.task-tbl col.c6{width:72px}.task-tbl col.c7{width:88px}
/* exec-tbl (7 cols): pri sku type reason action metric evidence */
.exec-tbl col.c0{width:90px}.exec-tbl col.c1{width:138px}.exec-tbl col.c2{width:86px}
.exec-tbl col.c3{width:170px}.exec-tbl col.c4{width:250px}.exec-tbl col.c5{width:155px}
.exec-tbl col.c6{width:78px}
/* line-clamp helpers */
.lc3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lc4{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.lc2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style>"""

_TASK_EXTRA_HEAD = _TABLE_STYLES + """<style>
  .state-btn{cursor:pointer;border:1px solid rgba(21,32,51,.14)!important;background:none;padding:3px 9px;border-radius:999px;font-weight:800;font-size:12px;line-height:1.4;white-space:nowrap}
  .state-btn:hover{opacity:.75}
  .exec-date{color:#667085;font-size:11px;margin-top:2px}
  .week-progress{display:flex;align-items:center;gap:10px;margin:10px 0;color:#344054;font-weight:800}
  .week-progress .pbar{flex:1;max-width:320px;height:8px;background:#e7ecf3;border-radius:99px;overflow:hidden}
  .week-progress .pbar i{display:block;height:100%;width:0;background:#23b887;border-radius:99px;transition:width .2s}
  .toolbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  .progress-label{font-weight:800;color:#10213d;white-space:nowrap}
  .progress-bar-wrap{flex:1;min-width:120px;max-width:260px;background:#eef2f6;border-radius:999px;height:8px;overflow:hidden}
  .progress-bar{height:8px;background:#166534;border-radius:999px;transition:width .3s}
  .filt-btn{cursor:pointer;border:1px solid #d8e0ec;border-radius:999px;padding:4px 14px;background:#fff;font-size:13px;white-space:nowrap}
  .filt-btn.active{background:#10213d;color:#fff;border-color:#10213d}
  tr[data-state="已执行"] td{opacity:.45}
  tr[data-state="已执行"]{background:#f6fff9}
  tr[data-state="暂缓"] td{opacity:.55}
  .logic-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:10px}
  .logic-flow a{display:block;background:#fbfdff;border:1px solid #d8e0ec;border-radius:10px;padding:12px;text-decoration:none;color:#172033}
  .logic-flow a:hover{border-color:#1f5cc4;box-shadow:0 8px 18px rgba(31,92,196,.10)}
  .logic-flow b{display:block;margin-bottom:4px;color:#10213d}
  .logic-flow small{display:block;color:#667085;line-height:1.45}
</style>
<script>window.WF_TASKS_GEN='20260605';</script>
<script src="./assets/task-state.js"></script>"""

_PROFILE_EXTRA = """<style>
.profile-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
.profile-toolbar input{height:36px;min-width:260px;flex:1;border:1px solid #d8e0ec;border-radius:10px;padding:0 12px;font-weight:700}
.profile-filter,.profile-action{border:1px solid #d8e0ec;background:#fff;border-radius:999px;padding:7px 11px;font-weight:800;cursor:pointer}
.profile-filter.active{background:#10213d;color:#fff;border-color:#10213d}
.profile-count{color:#667085;font-size:12px;font-weight:800}
.sku-profile{background:#fff;border:1px solid #d8e0ec;border-radius:12px;margin:8px 0;overflow:hidden}
.sku-profile[open]{box-shadow:0 8px 20px rgba(16,24,40,.06)}
.sku-profile summary{list-style:none;cursor:pointer;padding:12px 14px;display:grid;grid-template-columns:minmax(210px,1.2fr) repeat(5,minmax(90px,.6fr));gap:10px;align-items:center}
.sku-profile summary::-webkit-details-marker{display:none}
.sku-profile summary:hover{background:#f8fbff}
.sku-title b{display:block;font-size:16px}.sku-title small{color:#667085;font-weight:700}
.metric b{display:block}.metric small{display:block;color:#667085;font-size:12px}
.profile-detail{padding:0 14px 14px;border-top:1px solid #edf1f7}
.profile-detail .grid{margin-top:12px}
.sku-empty{padding:18px;color:#667085}
.course-note{background:#f8fbff;border:1px solid #d8e0ec;border-left:4px solid #1f5cc4;border-radius:10px;padding:12px 14px;margin:10px 0;color:#344054}
.course-note b{color:#10213d}
@media(max-width:900px){.sku-profile summary{grid-template-columns:1fr 1fr}.profile-toolbar input{min-width:100%}}
</style>
<script>
document.addEventListener('DOMContentLoaded',function(){
  const cards=Array.from(document.querySelectorAll('.sku-profile'));
  const input=document.getElementById('sku-profile-search');
  const count=document.getElementById('sku-profile-count');
  let current='all';
  function apply(){
    const q=(input?.value||'').trim().toLowerCase();
    let visible=0;
    cards.forEach(card=>{
      const hay=(card.dataset.search||'').toLowerCase();
      const matchText=!q||hay.includes(q);
      const matchFilter=current==='all'||card.dataset.grade===current||card.dataset.priority===current||card.dataset.stock===current;
      const show=matchText&&matchFilter;
      card.style.display=show?'':'none';
      if(show) visible++;
    });
    if(count) count.textContent=`显示 ${visible} / ${cards.length} 个 SKU`;
  }
  document.querySelectorAll('.profile-filter').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.profile-filter').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); current=btn.dataset.filter; apply();
    });
  });
  input?.addEventListener('input',apply);
  document.getElementById('profile-open-visible')?.addEventListener('click',()=>cards.forEach(c=>{if(c.style.display!=='none')c.open=true;}));
  document.getElementById('profile-close-all')?.addEventListener('click',()=>cards.forEach(c=>c.open=false));
  if(location.hash){
    const target=document.querySelector(location.hash);
    if(target&&target.tagName==='DETAILS') target.open=true;
  }
  apply();
});
</script>"""


_EXEC_COLGROUP = (
    "<colgroup>"
    "<col class='c0'><col class='c1'><col class='c2'>"
    "<col class='c3'><col class='c4'><col class='c5'><col class='c6'>"
    "</colgroup>"
)

_TASK_COLGROUP = (
    "<colgroup>"
    "<col class='c0'><col class='c1'><col class='c2'>"
    "<col class='c3'><col class='c4'><col class='c5'>"
    "<col class='c6'><col class='c7'>"
    "</colgroup>"
)


def task_table(tasks: pd.DataFrame, limit: int | None = None) -> str:
    rows = tasks.head(limit) if limit else tasks
    body = []
    for _, r in rows.iterrows():
        task_id = esc(r["任务ID"])
        priority = esc(r["优先级"])
        body.append(
            f"<tr data-task-id='{task_id}' data-priority='{priority}' data-state='待执行'>"
            f"<td>{tag(text(r['优先级']))}<div class='small'>{task_id}</div></td>"
            f"<td><b>{esc(r['供应商SKU'])}</b><div class='small'>{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</div></td>"
            f"<td>{esc(r['问题类型'])}<div class='small'><button type='button' class='state-btn tag amber'>待执行</button><div class='small exec-date'></div></div></td>"
            f"<td><div class='lc4'>{esc(r['触发原因'])}</div></td>"
            f"<td><b class='lc3'>{esc(r['建议动作'])}</b><div class='small lc2'>执行前：{esc(r['执行前检查'])}</div></td>"
            f"<td><div class='lc3'>{esc(r['复盘指标'])}</div></td>"
            f"<td><a href='{esc(r['证据链接'])}'>{esc(r['证据来源'])}</a></td>"
            "</tr>"
        )
    return (
        "<div class='tablebox'><table class='exec-tbl'>"
        + _EXEC_COLGROUP
        + "<thead><tr>"
        "<th>优先级</th><th>SKU / Listing</th><th>类型 / 状态</th><th>触发原因</th><th>建议动作</th><th>复盘指标</th><th>证据</th>"
        "</tr></thead><tbody>"
        + "\n".join(body)
        + "</tbody></table></div>"
    )


def interactive_task_table(tasks: pd.DataFrame) -> str:
    body = []
    for _, r in tasks.iterrows():
        task_id = esc(r["任务ID"])
        priority = esc(r["优先级"])
        body.append(
            f"<tr data-task-id='{task_id}' data-priority='{priority}' data-state='待执行'>"
            f"<td>{tag(text(r['优先级']))}<div class='small'>{task_id}</div></td>"
            f"<td><b>{esc(r['供应商SKU'])}</b><div class='small'>{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</div></td>"
            f"<td>{esc(r['问题类型'])}</td>"
            f"<td><div class='lc4'>{esc(r['触发原因'])}</div></td>"
            f"<td><b class='lc3'>{esc(r['建议动作'])}</b><div class='small lc2'>执行前：{esc(r['执行前检查'])}</div></td>"
            f"<td><div class='lc3'>{esc(r['复盘指标'])}</div></td>"
            f"<td><a href='{esc(r['证据链接'])}'>{esc(r['证据来源'])}</a></td>"
            f"<td><button class='state-btn tag amber'>待执行</button><div class='exec-date'></div></td>"
            "</tr>"
        )
    return (
        "<div class='tablebox'><table class='task-tbl'>"
        + _TASK_COLGROUP
        + "<thead><tr>"
        "<th>优先级</th><th>SKU / Listing</th><th>类型</th><th>触发原因</th><th>建议动作</th><th>复盘指标</th><th>证据</th><th>执行状态</th>"
        "</tr></thead><tbody>"
        + "\n".join(body)
        + "</tbody></table></div>"
    )


def task_toolbar(total: int) -> str:
    return f"""<div class="toolbar">
  <span class="progress-label">已执行 <span id="done-count">0</span> / <span id="total-count">{total}</span></span>
  <div class="progress-bar-wrap"><div class="progress-bar" id="progress-bar" style="width:0%"></div></div>
  <button class="filt-btn active" data-filter="all">全部</button>
  <button class="filt-btn" data-filter="P0">P0</button>
  <button class="filt-btn" data-filter="P1">P1</button>
  <button class="filt-btn" data-filter="P2">P2</button>
  <button class="filt-btn" data-filter="pending">待执行</button>
  <button class="filt-btn" data-filter="done">已执行</button>
  <button class="filt-btn" data-filter="defer">暂缓</button>
  <button class="filt-btn" id="reset-progress" type="button" style="margin-left:auto;color:#b42318">重置全部进度</button>
</div>"""


def render_execution_center(profiles: pd.DataFrame, tasks: pd.DataFrame) -> None:
    store_actions = pd.DataFrame(build_store_actions(profiles, tasks))
    counts = store_actions["优先级"].value_counts().to_dict()
    type_counts = tasks["问题类型"].value_counts().to_dict()
    weekly = store_actions.head(20)
    wait_data = tasks[tasks["问题类型"].eq("数据缺口")]
    body = f"""{_TASK_EXTRA_HEAD}
<div class="grid">
  <div class="card"><div class="num">{int(counts.get('P0', 0))}</div><b>P0 重点经营 SKU</b><div class="small">当前盈利或可放量，先保护收益</div></div>
  <div class="card"><div class="num">{int(counts.get('P1', 0))}</div><b>P1 腰部优化 SKU</b><div class="small">有机会盈利，按短板修复</div></div>
  <div class="card"><div class="num">{int(counts.get('P2', 0))}</div><b>P2 尾部观察 SKU</b><div class="small">无销量/无历史先不占核心资源</div></div>
  <div class="card"><div class="num">{len(tasks)}</div><b>明细任务数</b><div class="small">定价、促销、库存、Listing 证据拆解</div></div>
</div>
<div class="section"><h2>1. 课程逻辑落到工具的链接路径</h2>
<p>借鉴培训里的主线：价格先拆成供应商可控成本和平台不可控扣项，再用订单、毛利、库存和 Listing 承接决定流量与转化动作。</p>
<div class="logic-flow">
  <a href="./Wayfair_产品定价体检表_20260605.html"><b>1. 拆价格和利润</b><small>看 Base、拿货/包装/发货、Retail Price Net、Total Cost、平台空间。</small></a>
  <a href="./Wayfair_SKU经营档案_20260605.html"><b>2. 判断 SKU 经营价值</b><small>看历史订单、真实毛利、库存、广告、客诉和 Listing 证据。</small></a>
  <a href="./Wayfair_6月SKU分层与促销准入清单_20260604.html"><b>3. 决定流量/转化动作</b><small>盈利款放量，腰部款修短板，尾部无销量先观察。</small></a>
  <a href="./Wayfair_SKU任务清单_20260605.html"><b>4. 管理盘复盘</b><small>按 P0/P1/P2 跟进执行状态，下次用结果修正模型。</small></a>
</div></div>
<div class="section"><h2>2. 本周先做什么</h2><p>先按店铺经营价值排序：当前盈利款和可盈利候选款优先，尾部无销量产品不进入本周核心池。</p><div class='week-progress'>本周已执行 <b id='done-count'>0</b> / <span id='total-count'>20</span><div class='pbar'><i id='progress-bar'></i></div></div>{task_table(weekly, 20)}</div>
<div class="section"><h2>3. 问题类型分布</h2><div class="grid">
{''.join(f"<div class='card'><div class='num'>{int(v)}</div><b>{esc(k)}</b></div>" for k, v in type_counts.items())}
</div></div>
<div class="section"><h2>4. 等数据 / 需确认</h2>{task_table(wait_data, 20) if not wait_data.empty else '<div class="card">当前没有单独的数据缺口任务；仍需关注有效 6 月 Cost Stack 和当前促销折扣清单。</div>'}</div>
<div class="section"><h2>5. 全量任务入口</h2><div class="grid"><a class="linkcard" href="./Wayfair_SKU任务清单_20260605.html"><h3>SKU 任务清单</h3><p>全量 178 条任务，按 P0/P1/P2 筛选和标记进度。</p></a><a class="linkcard" href="./Wayfair_SKU经营档案_20260605.html"><h3>SKU 经营档案</h3><p>单 SKU 成本、库存、广告、促销和 Listing 证据。</p></a></div></div>
"""
    OUT_EXEC_CENTER.write_text(page("Wayfair 运营执行中心", body), encoding="utf-8")


def render_task_report(tasks: pd.DataFrame) -> None:
    # _TASK_EXTRA_HEAD is injected into the body so apply_dashboard_shell.py preserves it
    body = f"""{_TASK_EXTRA_HEAD}
<div class="section"><h2>全量 SKU 任务清单</h2>
<p>先处理 P0，再处理 P1。P2 只做观察。点击<b>执行状态</b>列的按钮标记进度，状态保存在本地浏览器，刷新不丢失。</p>
{task_toolbar(len(tasks))}
{interactive_task_table(tasks)}
</div>
"""
    OUT_TASK_REPORT.write_text(page("Wayfair SKU 任务清单", body), encoding="utf-8")


# ── Task 6: SKU profile report ────────────────────────────────────────────────

def render_profile_report(profiles: pd.DataFrame, tasks: pd.DataFrame) -> None:
    task_map = {
        sku: group.to_dict("records")
        for sku, group in tasks.groupby("供应商SKU", dropna=False)
    }
    priority_rank = {"P0": 0, "P1": 1, "P2": 2}

    def profile_priority(sku_tasks: list[dict]) -> str:
        priorities = [text(t.get("优先级")) for t in sku_tasks if text(t.get("优先级"))]
        if not priorities:
            return "观察"
        return sorted(priorities, key=lambda p: priority_rank.get(p, 9))[0]

    sections = []
    ordered = profiles.copy()
    ordered["_total_orders"] = ordered["5月订单数"].map(num) + ordered["YB历史订单数"].map(num)
    ordered["_profit"] = ordered["5月毛利"].map(num) + ordered["YB历史毛利"].map(num)
    ordered = ordered.sort_values(["SKU价值分层", "_total_orders", "_profit"], ascending=[True, False, False])
    for _, r in ordered.iterrows():
        sku = text(r["供应商SKU"])
        sku_tasks = task_map.get(sku, [])
        priority = profile_priority(sku_tasks)
        task_html = "".join(
            f"<li>{tag(text(t['优先级']))} <b>{esc(t['问题类型'])}</b>：{esc(t['建议动作'])}</li>"
            for t in sku_tasks[:8]
        ) or "<li>当前没有自动生成任务，维持观察。</li>"
        search_text = " ".join([
            sku,
            text(r["Wayfair Listing"]),
            text(r["产品名"]),
            text(r["SKU价值分层"]),
            text(r["促销准入"]),
            text(r["库存状态"]),
            text(r["定价分组"]),
            text(r["运营主动作"]),
        ])
        sections.append(f"""
<details class="sku-profile" id="{esc(r['详情锚点'])}" data-search="{esc(search_text)}" data-grade="{esc(r['SKU价值分层'])}" data-priority="{esc(priority)}" data-stock="{esc(r['库存状态'])}">
  <summary>
    <span class="sku-title"><b>{esc(sku)}</b><small>{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</small></span>
    <span class="metric">{tag(priority)} <small>任务优先级</small></span>
    <span class="metric"><b>{esc(r['SKU价值分层'])}</b><small>{esc(r['促销准入'])}</small></span>
    <span class="metric"><b>{esc(r['库存状态'])}</b><small>可用 {num(r['可用库存']):.0f} / 含在途 {num(r['总可售含在途']):.0f}</small></span>
    <span class="metric"><b>{num(r['5月订单数']):.0f} 单</b><small>5月 / 历史 {num(r['YB历史订单数']):.0f}</small></span>
    <span class="metric"><b>{money(r['YB历史毛利'])}</b><small>历史毛利</small></span>
  </summary>
  <div class="profile-detail">
  <div class="grid">
    <div class="card"><b>SKU 分层</b><div class="num">{esc(r['SKU价值分层'])}</div><div class="small">{esc(r['促销准入'])}</div></div>
    <div class="card"><b>定价</b><div>分组：{esc(r['定价分组'])}</div><div>Base：{money(r['当前Base'])}</div><div>前台价：{money(r['美国前台价'])}</div></div>
    <div class="card"><b>平台空间</b><div>{pct(r['平台空间率'])}</div><div class="small">Total Cost {money(r['Wayfair Total Cost'])}</div></div>
    <div class="card"><b>库存</b><div>{esc(r['库存状态'])}</div><div class="small">可用 {num(r['可用库存']):.0f} / 含在途 {num(r['总可售含在途']):.0f}</div></div>
  </div>
  <div class="grid">
    <div class="card"><b>经营贡献</b><div>5月 {num(r['5月订单数']):.0f} 单 / {money(r['5月毛利'])}</div><div>历史 {num(r['YB历史订单数']):.0f} 单 / {money(r['YB历史毛利'])}</div><div class="small">5月毛利率 {pct(r['5月毛利率'])}</div></div>
    <div class="card"><b>广告</b><div>Spend {money(r['广告花费'])}</div><div>Orders {num(r['广告订单']):.0f}</div><div class="small">ROAS {num(r['ROAS']):.2f}</div></div>
    <div class="card"><b>客诉扣款</b><div>{num(r['客诉扣款记录数']):.0f} 条</div><div class="small">{money(r['客诉扣款金额'])}</div></div>
    <div class="card"><b>Listing 问题</b><div>{esc(r['Listing问题']) or '暂无自动红灯'}</div></div>
  </div>
  <div class="grid">
    <div class="card"><b>运营主动作</b><p>{esc(r['运营主动作'])}</p></div>
    <div class="card"><b>执行前检查</b><p>{esc(r['执行前检查'])}</p></div>
    <div class="card"><b>复盘指标</b><p>{esc(r['复盘指标'])}</p></div>
  </div>
  <div class="card"><b>关联任务</b><ul>{task_html}</ul></div>
  </div>
</details>
""")
    body = f"""{_PROFILE_EXTRA}
<div class='section'>
  <h2>1. SKU 经营档案</h2>
  <p>先用列表扫 SKU，必要时再展开详情；从任务清单跳转过来会自动展开对应 SKU。</p>
  <div class="course-note"><b>课程逻辑落地：</b>每个 SKU 先看真实订单和毛利，再看平台空间和 Base/前台价，最后才决定广告、促销或 Listing 修复。无历史销量的尾部 SKU 不抢 P0 资源。</div>
  <div class="profile-toolbar">
    <input id="sku-profile-search" type="search" placeholder="搜索 SKU、Listing、产品名、状态">
    <button class="profile-filter active" type="button" data-filter="all">全部</button>
    <button class="profile-filter" type="button" data-filter="P0">P0</button>
    <button class="profile-filter" type="button" data-filter="P1">P1</button>
    <button class="profile-filter" type="button" data-filter="A">A</button>
    <button class="profile-filter" type="button" data-filter="B">B</button>
    <button class="profile-filter" type="button" data-filter="库存不足">库存不足</button>
    <button class="profile-action" id="profile-open-visible" type="button">展开当前</button>
    <button class="profile-action" id="profile-close-all" type="button">全部收起</button>
    <span class="profile-count" id="sku-profile-count"></span>
  </div>
</div>
<div class="sku-profile-list">
{''.join(sections) or '<div class="sku-empty">暂无 SKU 档案。</div>'}
</div>"""
    OUT_SKU_PROFILE.write_text(page("Wayfair SKU 经营档案", body), encoding="utf-8")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    pricing, score, inventory = load_sources()
    profiles = build_profiles(pricing, score, inventory)
    tasks = build_tasks(pricing, score, inventory)
    tasks = align_task_priorities_to_store_value(profiles, tasks)
    profiles.to_csv(OUT_PROFILES, index=False, encoding="utf-8-sig")
    tasks.to_csv(OUT_TASKS, index=False, encoding="utf-8-sig")
    print(f"wrote {OUT_PROFILES}")
    print(f"wrote {OUT_TASKS}")
    print(f"profiles {len(profiles)}")
    print(f"tasks {len(tasks)}")
    if not tasks.empty:
        print(tasks["优先级"].value_counts().to_string())
    render_execution_center(profiles, tasks)
    render_task_report(tasks)
    render_profile_report(profiles, tasks)
    print(f"wrote {OUT_EXEC_CENTER}")
    print(f"wrote {OUT_TASK_REPORT}")
    print(f"wrote {OUT_SKU_PROFILE}")


if __name__ == "__main__":
    main()
