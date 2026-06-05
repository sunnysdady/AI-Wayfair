from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

REPORT_DATE = "2026-06-05"

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
    "5月毛利率",
    "YB历史毛利率",
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


def base_fields(row: dict | pd.Series) -> tuple[str, str, str, str, str]:
    return (
        text(row.get("供应商SKU") or row.get("Part")),
        text(row.get("Wayfair Listing") or row.get("Listing")),
        text(row.get("中文名") or row.get("Name")),
        text(row.get("SKU价值分层") or row.get("NewGrade")),
        text(row.get("促销准入") or row.get("PromoReadiness")),
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
    confidence = text(row.get("置信度"))
    available = num(row.get("可用量"))
    total_available = num(row.get("总可售含在途"))
    if confidence in {"低", "未匹配"}:
        reason = f"库存映射置信度为 {confidence}"
        priority = "P1"
        score = 74
    elif total_available <= 0 and sku:
        reason = "总可售含在途为 0"
        priority = "P0"
        score = 90
    elif available <= 2 and sku:
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
