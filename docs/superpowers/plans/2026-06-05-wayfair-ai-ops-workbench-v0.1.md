# Wayfair AI Ops Workbench v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a v0.1 Wayfair ops execution center that turns existing SKU reports into prioritized, actionable tasks.

**Architecture:** Add one focused build script that reads existing sanitized CSV outputs, generates a unified SKU task dataset, renders three static HTML pages, then applies the existing dashboard shell. Keep current reports as evidence pages and make the new execution center the primary operating entry.

**Tech Stack:** Python 3, pandas, static HTML/CSS/JS, existing `scripts/apply_dashboard_shell.py`, local Chrome/Playwright for page verification.

---

## File Structure

Create:

- `scripts/build_ops_workbench.py`: Builds the unified task dataset, SKU profile dataset, and three HTML reports.
- `scripts/test_build_ops_workbench.py`: Lightweight `unittest` coverage for rule classification, task priority sorting, and required output columns.
- `data/Wayfair_运营任务清单_20260605.csv`: Generated task-level dataset.
- `data/Wayfair_SKU经营档案_20260605.csv`: Generated SKU-level profile dataset.
- `reports/Wayfair_运营执行中心_20260605.html`: First-entry page for weekly actions.
- `reports/Wayfair_SKU任务清单_20260605.html`: Full task list with filters and evidence links.
- `reports/Wayfair_SKU经营档案_20260605.html`: SKU detail page with one anchored section per SKU.

Modify:

- `scripts/apply_dashboard_shell.py`: Add execution-center nav item and context text.
- `index.html`: Make the execution center the primary dashboard entry.
- `reports/Wayfair_项目导航_20260604.html`: Add the execution center and task list near the top.
- `README.md`: Document the new v0.1 operating flow.

Do not commit:

- Raw YB workbooks.
- Raw customer order records.
- Customer names, addresses, phone numbers, or account credentials.

---

## Data Contract

### Task Dataset Columns

`data/Wayfair_运营任务清单_20260605.csv` must contain exactly these reader-facing columns:

```text
任务ID
优先级
任务状态
问题类型
供应商SKU
Wayfair Listing
产品名
SKU价值分层
促销准入
触发原因
建议动作
执行前检查
复盘指标
证据来源
证据链接
排序分
```

### SKU Profile Dataset Columns

`data/Wayfair_SKU经营档案_20260605.csv` must contain exactly these reader-facing columns:

```text
供应商SKU
Wayfair Listing
产品名
类目
SKU价值分层
促销准入
定价分组
库存状态
可用库存
总可售含在途
5月订单数
YB历史订单数
5月毛利率
YB历史毛利率
当前Base
美国前台价
Base前台价比例
平台空间率
Wayfair Total Cost
客诉扣款记录数
客诉扣款金额
广告花费
广告订单
ROAS
Listing问题
系统总建议
详情锚点
```

---

## Task 1: Add Unit Tests First

**Files:**

- Create: `scripts/test_build_ops_workbench.py`

- [ ] **Step 1: Create the test file**

Create `scripts/test_build_ops_workbench.py` with this content:

```python
from __future__ import annotations

import unittest

import build_ops_workbench as ops


class OpsWorkbenchRulesTest(unittest.TestCase):
    def test_priority_sort_order(self) -> None:
        rows = [
            {"优先级": "P2", "排序分": 20, "任务ID": "T-003"},
            {"优先级": "P0", "排序分": 90, "任务ID": "T-001"},
            {"优先级": "P1", "排序分": 60, "任务ID": "T-002"},
        ]
        ordered = ops.sort_tasks(rows)
        self.assertEqual([r["任务ID"] for r in ordered], ["T-001", "T-002", "T-003"])

    def test_task_id_is_stable(self) -> None:
        task_id = ops.make_task_id("MFC-D3-B", "定价", 1)
        self.assertEqual(task_id, "TASK-MFC-D3-B-PRICING-001")

    def test_pricing_task_for_no_raise_group(self) -> None:
        row = {
            "供应商SKU": "MFC-D3-B",
            "Wayfair Listing": "DMOM1022",
            "中文名": "3抽鹅颈活动柜黑色",
            "SKU价值分层": "B",
            "促销准入": "禁止促销/先修复",
            "定价分组": "不建议提价",
            "主要问题": "Base/前台价高于72%；大促2B利润率低于12%",
            "建议动作": "不要先提Base；禁止深折扣促销",
        }
        tasks = ops.pricing_tasks(row)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["优先级"], "P0")
        self.assertEqual(tasks[0]["问题类型"], "定价")
        self.assertIn("不要先提Base", tasks[0]["建议动作"])

    def test_required_task_columns(self) -> None:
        self.assertEqual(ops.TASK_COLUMNS, [
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
        ])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
python3 scripts/test_build_ops_workbench.py
```

Expected:

```text
ModuleNotFoundError: No module named 'build_ops_workbench'
```

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add scripts/test_build_ops_workbench.py
git commit -m "test: add ops workbench rule tests"
```

---

## Task 2: Create the Build Script Skeleton

**Files:**

- Create: `scripts/build_ops_workbench.py`
- Test: `scripts/test_build_ops_workbench.py`

- [ ] **Step 1: Create script with constants and pure helper functions**

Create `scripts/build_ops_workbench.py` with this content:

```python
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path("/Users/pengzhang/Documents/Codex 2/AI-Wayfair")
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


def esc(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return html.escape(str(value).strip())


def text(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def num(value: object, default: float = 0.0) -> float:
    if value is None or pd.isna(value):
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
```

- [ ] **Step 2: Run tests**

Run:

```bash
python3 scripts/test_build_ops_workbench.py
```

Expected:

```text
AttributeError: module 'build_ops_workbench' has no attribute 'pricing_tasks'
```

- [ ] **Step 3: Commit skeleton**

Run:

```bash
git add scripts/build_ops_workbench.py scripts/test_build_ops_workbench.py
git commit -m "feat: add ops workbench build skeleton"
```

---

## Task 3: Implement Task Generation Rules

**Files:**

- Modify: `scripts/build_ops_workbench.py`
- Test: `scripts/test_build_ops_workbench.py`

- [ ] **Step 1: Add task helper and rule functions**

Append this code to `scripts/build_ops_workbench.py`:

```python
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
```

- [ ] **Step 2: Run tests**

Run:

```bash
python3 scripts/test_build_ops_workbench.py
```

Expected:

```text
....
----------------------------------------------------------------------
Ran 4 tests

OK
```

- [ ] **Step 3: Commit rule functions**

Run:

```bash
git add scripts/build_ops_workbench.py scripts/test_build_ops_workbench.py
git commit -m "feat: add ops task generation rules"
```

---

## Task 4: Build Datasets from Existing CSVs

**Files:**

- Modify: `scripts/build_ops_workbench.py`
- Generate: `data/Wayfair_运营任务清单_20260605.csv`
- Generate: `data/Wayfair_SKU经营档案_20260605.csv`

- [ ] **Step 1: Add dataset loading and profile generation**

Append this code to `scripts/build_ops_workbench.py`:

```python
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
    merged["系统总建议"] = merged.apply(
        lambda r: "；".join(item for item in [
            text(r.get("建议动作")),
            text(r.get("NewAction")),
            "促销/广告前先确认库存" if text(r.get("库存状态")) != "库存可查" else "",
        ] if item),
        axis=1,
    )

    out = pd.DataFrame({
        "供应商SKU": merged["供应商SKU"],
        "Wayfair Listing": merged["Wayfair Listing"].fillna(merged.get("ScoreListing", "")),
        "产品名": merged["中文名"].fillna(merged.get("ScoreName", "")),
        "类目": merged.get("类目", ""),
        "SKU价值分层": merged["SKU价值分层"].fillna(merged.get("ScoreGrade", "")),
        "促销准入": merged["促销准入"].fillna(merged.get("ScorePromoReadiness", "")),
        "定价分组": merged.get("定价分组", ""),
        "库存状态": merged["库存状态"],
        "可用库存": merged.get("可用量", 0),
        "总可售含在途": merged.get("总可售含在途", 0),
        "5月订单数": merged.get("5月订单数", 0),
        "YB历史订单数": merged.get("YB历史订单数", 0),
        "5月毛利率": merged.get("5月毛利率", 0),
        "YB历史毛利率": merged.get("YB历史毛利率", 0),
        "当前Base": merged.get("Catalog当前Base Cost", 0),
        "美国前台价": merged.get("美国前台价", 0),
        "Base前台价比例": merged.get("Base/前台价", 0),
        "平台空间率": merged.get("平台空间率", 0),
        "Wayfair Total Cost": merged.get("Wayfair Total Cost", 0),
        "客诉扣款记录数": merged.get("客诉扣款记录数", 0),
        "客诉扣款金额": merged.get("客诉扣款金额", 0),
        "广告花费": merged.get("SPSpendNew", 0),
        "广告订单": merged.get("SPOrdersNew", 0),
        "ROAS": merged.get("ROAS", 0),
        "Listing问题": merged["Listing问题"],
        "系统总建议": merged["系统总建议"],
        "详情锚点": merged["详情锚点"],
    })
    return out[PROFILE_COLUMNS].copy()
```

- [ ] **Step 2: Add task dataset builder**

Append this code to `scripts/build_ops_workbench.py`:

```python
def build_tasks(pricing: pd.DataFrame, score: pd.DataFrame, inventory: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []

    pricing_records = pricing.to_dict("records")
    for row in pricing_records:
        rows.extend(pricing_tasks(row))

    score_records = score.to_dict("records")
    for row in score_records:
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
```

- [ ] **Step 3: Add main function**

Append this code to `scripts/build_ops_workbench.py`:

```python
def main() -> None:
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    pricing, score, inventory = load_sources()
    profiles = build_profiles(pricing, score, inventory)
    tasks = build_tasks(pricing, score, inventory)
    profiles.to_csv(OUT_PROFILES, index=False, encoding="utf-8-sig")
    tasks.to_csv(OUT_TASKS, index=False, encoding="utf-8-sig")
    print(f"wrote {OUT_PROFILES}")
    print(f"wrote {OUT_TASKS}")
    print(f"profiles {len(profiles)}")
    print(f"tasks {len(tasks)}")
    if not tasks.empty:
        print(tasks["优先级"].value_counts().to_string())


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run unit tests**

Run:

```bash
python3 scripts/test_build_ops_workbench.py
```

Expected:

```text
....
----------------------------------------------------------------------
Ran 4 tests

OK
```

- [ ] **Step 5: Generate datasets**

Run:

```bash
python3 scripts/build_ops_workbench.py
```

Expected:

```text
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/data/Wayfair_SKU经营档案_20260605.csv
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/data/Wayfair_运营任务清单_20260605.csv
profiles 90
tasks [number greater than 0]
```

- [ ] **Step 6: Verify generated columns**

Run:

```bash
python3 - <<'PY'
import pandas as pd
tasks = pd.read_csv('data/Wayfair_运营任务清单_20260605.csv', encoding='utf-8-sig')
profiles = pd.read_csv('data/Wayfair_SKU经营档案_20260605.csv', encoding='utf-8-sig')
print(list(tasks.columns))
print(list(profiles.columns))
assert '任务ID' in tasks.columns
assert '优先级' in tasks.columns
assert '供应商SKU' in profiles.columns
assert len(tasks) > 0
assert len(profiles) == 90
PY
```

Expected:

```text
No assertion errors.
```

- [ ] **Step 7: Commit datasets**

Run:

```bash
git add scripts/build_ops_workbench.py data/Wayfair_运营任务清单_20260605.csv data/Wayfair_SKU经营档案_20260605.csv
git commit -m "feat: build ops workbench datasets"
```

---

## Task 5: Render Execution Center and Task List

**Files:**

- Modify: `scripts/build_ops_workbench.py`
- Generate: `reports/Wayfair_运营执行中心_20260605.html`
- Generate: `reports/Wayfair_SKU任务清单_20260605.html`

- [ ] **Step 1: Add shared HTML helpers**

Append this code above `main()` in `scripts/build_ops_workbench.py`:

```python
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


def page(title: str, body: str) -> str:
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
</head>
<body>
<header><h1>{esc(title)}</h1><div class="meta">生成日期：{REPORT_DATE} ｜ 目标：打开后 10 分钟知道本周先做什么</div></header>
<div class="wrap">{body}</div>
</body>
</html>"""


def task_table(tasks: pd.DataFrame, limit: int | None = None) -> str:
    rows = tasks.head(limit) if limit else tasks
    body = []
    for _, r in rows.iterrows():
        body.append(
            "<tr>"
            f"<td>{tag(text(r['优先级']))}<div class='small'>{esc(r['任务ID'])}</div></td>"
            f"<td><b>{esc(r['供应商SKU'])}</b><div class='small'>{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</div></td>"
            f"<td>{esc(r['问题类型'])}<div class='small'>{tag(text(r['任务状态']))}</div></td>"
            f"<td>{esc(r['触发原因'])}</td>"
            f"<td><b>{esc(r['建议动作'])}</b><div class='small'>执行前：{esc(r['执行前检查'])}</div></td>"
            f"<td>{esc(r['复盘指标'])}</td>"
            f"<td><a href='{esc(r['证据链接'])}'>{esc(r['证据来源'])}</a></td>"
            "</tr>"
        )
    return (
        "<div class='tablebox'><table><thead><tr>"
        "<th>优先级</th><th>SKU / Listing</th><th>类型 / 状态</th><th>触发原因</th><th>建议动作</th><th>复盘指标</th><th>证据</th>"
        "</tr></thead><tbody>"
        + "\n".join(body)
        + "</tbody></table></div>"
    )
```

- [ ] **Step 2: Add report rendering functions**

Append this code above `main()` in `scripts/build_ops_workbench.py`:

```python
def render_execution_center(tasks: pd.DataFrame) -> None:
    counts = tasks["优先级"].value_counts().to_dict()
    type_counts = tasks["问题类型"].value_counts().to_dict()
    p0 = tasks[tasks["优先级"].eq("P0")]
    wait_data = tasks[tasks["问题类型"].eq("数据缺口")]
    body = f"""
<div class="grid">
  <div class="card"><div class="num">{int(counts.get('P0', 0))}</div><b>P0 必须先处理</b><div class="small">亏损、禁促、库存、定价红灯</div></div>
  <div class="card"><div class="num">{int(counts.get('P1', 0))}</div><b>P1 本周处理</b><div class="small">影响放量和转化的任务</div></div>
  <div class="card"><div class="num">{int(counts.get('P2', 0))}</div><b>P2 观察</b><div class="small">新品和轻促观察</div></div>
  <div class="card"><div class="num">{len(tasks)}</div><b>总任务数</b><div class="small">来自定价、促销、库存、Listing</div></div>
</div>
<div class="section"><h2>1. 本周先做什么</h2>{task_table(p0, 20)}</div>
<div class="section"><h2>2. 问题类型分布</h2><div class="grid">
{''.join(f"<div class='card'><div class='num'>{int(v)}</div><b>{esc(k)}</b></div>" for k, v in type_counts.items())}
</div></div>
<div class="section"><h2>3. 等数据 / 需确认</h2>{task_table(wait_data, 20) if not wait_data.empty else '<div class="card">当前没有单独的数据缺口任务；仍需关注有效 6 月 Cost Stack 和当前促销折扣清单。</div>'}</div>
<div class="section"><h2>4. 全量任务入口</h2><div class="card"><a href="./Wayfair_SKU任务清单_20260605.html">打开 SKU 任务清单</a><br><a href="./Wayfair_SKU经营档案_20260605.html">打开 SKU 经营档案</a></div></div>
"""
    OUT_EXEC_CENTER.write_text(page("Wayfair 运营执行中心", body), encoding="utf-8")


def render_task_report(tasks: pd.DataFrame) -> None:
    body = f"""
<div class="section"><h2>1. 全量 SKU 任务清单</h2>
<p>使用顺序：先处理 P0，再处理 P1。P2 只做观察或等数据。</p>
{task_table(tasks)}
</div>
"""
    OUT_TASK_REPORT.write_text(page("Wayfair SKU 任务清单", body), encoding="utf-8")
```

- [ ] **Step 3: Update `main()` to render the pages**

Modify the bottom of `main()` so it contains these lines before the final print statements end:

```python
    render_execution_center(tasks)
    render_task_report(tasks)
    print(f"wrote {OUT_EXEC_CENTER}")
    print(f"wrote {OUT_TASK_REPORT}")
```

- [ ] **Step 4: Run script**

Run:

```bash
python3 scripts/build_ops_workbench.py
```

Expected:

```text
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_运营执行中心_20260605.html
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_SKU任务清单_20260605.html
```

- [ ] **Step 5: Apply dashboard shell**

Run:

```bash
python3 scripts/apply_dashboard_shell.py
```

Expected:

```text
dashboard shell applied to [number] report pages
```

- [ ] **Step 6: Commit reports**

Run:

```bash
git add scripts/build_ops_workbench.py reports/Wayfair_运营执行中心_20260605.html reports/Wayfair_SKU任务清单_20260605.html
git commit -m "feat: render ops execution center"
```

---

## Task 6: Render SKU Profile Page

**Files:**

- Modify: `scripts/build_ops_workbench.py`
- Generate: `reports/Wayfair_SKU经营档案_20260605.html`

- [ ] **Step 1: Add SKU profile renderer**

Append this code above `main()` in `scripts/build_ops_workbench.py`:

```python
def render_profile_report(profiles: pd.DataFrame, tasks: pd.DataFrame) -> None:
    task_map = {
        sku: group.to_dict("records")
        for sku, group in tasks.groupby("供应商SKU", dropna=False)
    }
    sections = []
    for _, r in profiles.iterrows():
        sku = text(r["供应商SKU"])
        sku_tasks = task_map.get(sku, [])
        task_html = "".join(
            f"<li>{tag(text(t['优先级']))} <b>{esc(t['问题类型'])}</b>：{esc(t['建议动作'])}</li>"
            for t in sku_tasks[:8]
        ) or "<li>当前没有自动生成任务，维持观察。</li>"
        sections.append(f"""
<section class="section" id="{esc(r['详情锚点'])}">
  <h2>{esc(sku)} <span class="small">{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</span></h2>
  <div class="grid">
    <div class="card"><b>SKU 分层</b><div class="num">{esc(r['SKU价值分层'])}</div><div class="small">{esc(r['促销准入'])}</div></div>
    <div class="card"><b>定价</b><div>分组：{esc(r['定价分组'])}</div><div>Base：{money(r['当前Base'])}</div><div>前台价：{money(r['美国前台价'])}</div></div>
    <div class="card"><b>平台空间</b><div>{pct(r['平台空间率'])}</div><div class="small">Total Cost {money(r['Wayfair Total Cost'])}</div></div>
    <div class="card"><b>库存</b><div>{esc(r['库存状态'])}</div><div class="small">可用 {num(r['可用库存']):.0f} / 含在途 {num(r['总可售含在途']):.0f}</div></div>
  </div>
  <div class="grid">
    <div class="card"><b>订单</b><div>5月 {num(r['5月订单数']):.0f} 单</div><div>历史 {num(r['YB历史订单数']):.0f} 单</div><div class="small">5月毛利率 {pct(r['5月毛利率'])}</div></div>
    <div class="card"><b>广告</b><div>Spend {money(r['广告花费'])}</div><div>Orders {num(r['广告订单']):.0f}</div><div class="small">ROAS {num(r['ROAS']):.2f}</div></div>
    <div class="card"><b>客诉扣款</b><div>{num(r['客诉扣款记录数']):.0f} 条</div><div class="small">{money(r['客诉扣款金额'])}</div></div>
    <div class="card"><b>Listing 问题</b><div>{esc(r['Listing问题']) or '暂无自动红灯'}</div></div>
  </div>
  <div class="card"><b>系统总建议</b><p>{esc(r['系统总建议'])}</p></div>
  <div class="card"><b>关联任务</b><ul>{task_html}</ul></div>
</section>
""")
    body = "<div class='section'><h2>1. SKU 经营档案</h2><p>从任务清单点击 SKU 后，用本页复核该 SKU 的成本、库存、广告、促销和 Listing 状态。</p></div>" + "\n".join(sections)
    OUT_SKU_PROFILE.write_text(page("Wayfair SKU 经营档案", body), encoding="utf-8")
```

- [ ] **Step 2: Update `main()` to render SKU profiles**

Add this line after `render_task_report(tasks)` in `main()`:

```python
    render_profile_report(profiles, tasks)
    print(f"wrote {OUT_SKU_PROFILE}")
```

- [ ] **Step 3: Run script and shell**

Run:

```bash
python3 scripts/build_ops_workbench.py
python3 scripts/apply_dashboard_shell.py
```

Expected:

```text
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_SKU经营档案_20260605.html
dashboard shell applied to [number] report pages
```

- [ ] **Step 4: Commit SKU profile page**

Run:

```bash
git add scripts/build_ops_workbench.py reports/Wayfair_SKU经营档案_20260605.html
git commit -m "feat: render sku profile report"
```

---

## Task 7: Wire Navigation and README

**Files:**

- Modify: `scripts/apply_dashboard_shell.py`
- Modify: `index.html`
- Modify: `reports/Wayfair_项目导航_20260604.html`
- Modify: `README.md`

- [ ] **Step 1: Update dashboard shell nav**

In `scripts/apply_dashboard_shell.py`, modify `nav()` so the `items` list starts with execution center:

```python
    items = [
        ("../index.html", "Dashboard"),
        (first_matching("运营执行中心"), "执行中心"),
        (first_matching("SKU任务清单"), "任务清单"),
        (first_matching("运营工作台"), "工作台"),
        (first_matching("库存映射"), "库存映射"),
        (first_matching("促销准入"), "促销准入"),
        (first_matching("SKU价值"), "SKU分级"),
        (first_matching("定价体检表", "20260605"), "定价体检"),
    ]
```

- [ ] **Step 2: Update dashboard shell context**

In `scripts/apply_dashboard_shell.py`, add these rules near the top of `context()`:

```python
        ("运营执行中心", ("Execution center", "本周必须先处理的 SKU、原因和动作。")),
        ("SKU任务清单", ("Task list", "按优先级聚合所有 SKU 运营动作。")),
        ("SKU经营档案", ("SKU profile", "单 SKU 的成本、库存、广告、促销和 Listing 证据。")),
```

- [ ] **Step 3: Apply shell**

Run:

```bash
python3 scripts/apply_dashboard_shell.py
```

Expected:

```text
dashboard shell applied to [number] report pages
```

- [ ] **Step 4: Update `README.md` usage order**

Modify `README.md` so the “使用顺序” section starts with:

```markdown
1. 先打开 `reports/Wayfair_运营执行中心_20260605.html`，看本周 P0 / P1 执行任务。
2. 需要看全量动作时，打开 `reports/Wayfair_SKU任务清单_20260605.html`。
3. 需要复核单个 SKU 时，打开 `reports/Wayfair_SKU经营档案_20260605.html`。
4. 证据层再打开定价体检、促销准入、库存映射、广告调整等报告。
```

- [ ] **Step 5: Update `index.html` and `reports/Wayfair_项目导航_20260604.html`**

Add these three cards near the top of each navigation page:

```html
<a class="card primary" href="./reports/Wayfair_运营执行中心_20260605.html"><h2>运营执行中心</h2><p>本周必须先处理的 SKU、原因和动作。</p><span class="tag">第一入口</span></a>
<a class="card primary" href="./reports/Wayfair_SKU任务清单_20260605.html"><h2>SKU 任务清单</h2><p>按 P0 / P1 / P2 聚合所有 SKU 动作。</p><span class="tag">执行</span></a>
<a class="card green" href="./reports/Wayfair_SKU经营档案_20260605.html"><h2>SKU 经营档案</h2><p>单 SKU 成本、库存、广告、促销和 Listing 证据。</p><span class="tag">复核</span></a>
```

For `reports/Wayfair_项目导航_20260604.html`, use `./Wayfair_运营执行中心_20260605.html`, `./Wayfair_SKU任务清单_20260605.html`, and `./Wayfair_SKU经营档案_20260605.html` because that file lives inside `reports/`.

- [ ] **Step 6: Commit navigation docs**

Run:

```bash
git add scripts/apply_dashboard_shell.py reports/assets/dashboard-shell.css reports/assets/dashboard-shell.js index.html reports/Wayfair_项目导航_20260604.html README.md
git commit -m "feat: make ops execution center primary entry"
```

---

## Task 8: Full Local Verification

**Files:**

- Read all generated HTML pages.
- No repository files should be edited in this task unless verification fails.

- [ ] **Step 1: Run unit tests**

Run:

```bash
python3 scripts/test_build_ops_workbench.py
```

Expected:

```text
....
----------------------------------------------------------------------
Ran 4 tests

OK
```

- [ ] **Step 2: Regenerate all v0.1 outputs**

Run:

```bash
python3 scripts/build_ops_workbench.py
python3 scripts/apply_dashboard_shell.py
```

Expected:

```text
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/data/Wayfair_SKU经营档案_20260605.csv
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/data/Wayfair_运营任务清单_20260605.csv
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_运营执行中心_20260605.html
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_SKU任务清单_20260605.html
wrote /Users/pengzhang/Documents/Codex 2/AI-Wayfair/reports/Wayfair_SKU经营档案_20260605.html
dashboard shell applied to [number] report pages
```

- [ ] **Step 3: Check for conflict markers and placeholder text**

Run:

```bash
rg -n "<<<<<<<|>>>>>>>|=======" .
```

Expected:

```text
No output.
```

- [ ] **Step 4: Browser-check local pages**

Run this verification script:

```bash
NODE_PATH=/Users/pengzhang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/pengzhang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node <<'NODE'
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const repo = '/Users/pengzhang/Documents/Codex 2/AI-Wayfair';
const pages = [
  'index.html',
  'reports/Wayfair_运营执行中心_20260605.html',
  'reports/Wayfair_SKU任务清单_20260605.html',
  'reports/Wayfair_SKU经营档案_20260605.html'
];
const toUrl = file => 'file://' + path.join(repo, file).split(path.sep).map((p,i)=>i===0?p:encodeURIComponent(p)).join('/');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const results = [];
  for (const file of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', msg => { if (['error','warning'].includes(msg.type())) errors.push(msg.text()); });
    await page.goto(toUrl(file), { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => ({
      title: document.title,
      hasDashboard: !!document.querySelector('.wf-app') || document.title.includes('Dashboard'),
      bodyLen: document.body.innerText.trim().length,
      links: document.querySelectorAll('a[href]').length,
      tables: document.querySelectorAll('table').length,
    }));
    results.push({ file, errors: errors.length, ...info });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (results.some(r => r.errors > 0 || r.bodyLen < 100 || r.links < 1)) process.exit(1);
})();
NODE
```

Expected:

```text
JSON output showing all four pages with errors: 0, bodyLen > 100, links >= 1.
```

- [ ] **Step 5: Commit verification-safe final state**

If regeneration changed files, commit them:

```bash
git status --short
git add scripts/build_ops_workbench.py scripts/apply_dashboard_shell.py reports data README.md index.html
git commit -m "chore: refresh ops workbench outputs"
```

If `git status --short` is empty, do not create an empty commit.

---

## Task 9: Push and Verify Vercel

**Files:**

- No file edits unless verification shows a real issue.

- [ ] **Step 1: Push to GitHub**

Run:

```bash
git push origin main
```

Expected:

```text
main -> main
```

- [ ] **Step 2: Verify live execution center**

Run:

```bash
NODE_PATH=/Users/pengzhang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/pengzhang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node <<'NODE'
const { chromium } = require('playwright');
const url = 'https://ai-wayfair.vercel.app/reports/Wayfair_%E8%BF%90%E8%90%A5%E6%89%A7%E8%A1%8C%E4%B8%AD%E5%BF%83_20260605.html';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const bad = [];
  page.on('response', res => { if (res.status() >= 400) bad.push({ status: res.status(), url: res.url() }); });
  const response = await page.goto(url + `?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 20000 });
  const result = await page.evaluate(() => ({
    title: document.title,
    hasDashboard: !!document.querySelector('.wf-app'),
    hasP0: document.body.innerText.includes('P0'),
    hasTaskListLink: document.body.innerText.includes('SKU 任务清单'),
    bodyLen: document.body.innerText.trim().length,
  }));
  await browser.close();
  console.log(JSON.stringify({ status: response.status(), bad, result }, null, 2));
  if (response.status() !== 200 || bad.length || !result.hasDashboard || !result.hasP0 || !result.hasTaskListLink) process.exit(1);
})();
NODE
```

Expected:

```text
status 200, bad [], hasDashboard true, hasP0 true, hasTaskListLink true.
```

- [ ] **Step 3: Final status check**

Run:

```bash
git status --short --branch
```

Expected:

```text
## main...origin/main
```

---

## Self-Review

Spec coverage:

- Unified task structure: Task 1 through Task 4.
- Execution center: Task 5.
- SKU task list: Task 5.
- SKU profile page: Task 6.
- Existing reports remain evidence layer: Task 5 and Task 7 link back to evidence reports.
- Homepage first-entry shift: Task 7.
- Local and live verification: Task 8 and Task 9.
- Data safety: File Structure and Data Contract avoid raw sensitive data.

Placeholder scan:

- The plan contains no unresolved placeholder markers.
- Each code-changing task includes concrete code or exact edit blocks.
- Each verification task includes exact command and expected result.

Type consistency:

- `TASK_COLUMNS` and unit test column list match.
- `PROFILE_COLUMNS` and profile output columns match.
- Report paths match generated filenames and navigation links.
- Rule functions return task dictionaries using the same `TASK_COLUMNS`.
