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
