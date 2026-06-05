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
    merged["系统总建议"] = merged.apply(
        lambda r: "；".join(item for item in [
            text(r.get("建议动作")),
            text(r.get("NewAction")),
            "促销/广告前先确认库存" if text(r.get("库存状态")) != "库存可查" else "",
        ] if item),
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
        "5月毛利率": col("5月毛利率"),
        "YB历史毛利率": col("YB历史毛利率"),
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
        "系统总建议": merged["系统总建议"],
        "详情锚点": merged["详情锚点"],
    })
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
  .state-btn{cursor:pointer;border:none;background:none;padding:3px 9px;border-radius:999px;font-weight:800;font-size:12px;line-height:1.4;white-space:nowrap}
  .state-btn:hover{opacity:.75}
  .exec-date{color:#667085;font-size:11px;margin-top:2px}
  .toolbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  .progress-label{font-weight:800;color:#10213d;white-space:nowrap}
  .progress-bar-wrap{flex:1;min-width:120px;max-width:260px;background:#eef2f6;border-radius:999px;height:8px;overflow:hidden}
  .progress-bar{height:8px;background:#166534;border-radius:999px;transition:width .3s}
  .filt-btn{cursor:pointer;border:1px solid #d8e0ec;border-radius:999px;padding:4px 14px;background:#fff;font-size:13px;white-space:nowrap}
  .filt-btn.active{background:#10213d;color:#fff;border-color:#10213d}
  tr[data-state="已执行"] td{opacity:.45}
  tr[data-state="已执行"]{background:#f6fff9}
  tr[data-state="暂缓"] td{opacity:.55}
</style>
<script>
(function(){
  var STATES=['待执行','执行中','已执行','暂缓'];
  var CLS={'待执行':'tag amber','执行中':'tag blue','已执行':'tag green','暂缓':'tag gray'};
  var KEY=function(id){return 'wf2:'+id;};
  function load(id){try{return JSON.parse(localStorage.getItem(KEY(id)))||{};}catch(e){return {};}}
  function save(id,obj){try{localStorage.setItem(KEY(id),JSON.stringify(obj));}catch(e){}}
  function applyRow(row,st){
    var s=st.status||'待执行';
    var btn=row.querySelector('.state-btn');
    btn.textContent=s; btn.className='state-btn '+(CLS[s]||'tag gray');
    row.dataset.state=s;
    var d=row.querySelector('.exec-date');
    if(d) d.textContent=st.date||'';
  }
  function updateProgress(){
    var rows=document.querySelectorAll('tr[data-task-id]');
    var done=0; rows.forEach(function(r){if(r.dataset.state==='已执行')done++;});
    var n=rows.length;
    var dc=document.getElementById('done-count'); if(dc) dc.textContent=done;
    var tc=document.getElementById('total-count'); if(tc) tc.textContent=n;
    var bar=document.getElementById('progress-bar'); if(bar) bar.style.width=(n?Math.round(done/n*100):0)+'%';
  }
  function filterRows(f){
    document.querySelectorAll('tr[data-task-id]').forEach(function(r){
      var show=f==='all'||f===r.dataset.priority||
        (f==='pending'&&r.dataset.state!=='已执行'&&r.dataset.state!=='暂缓')||
        (f==='done'&&r.dataset.state==='已执行')||
        (f==='defer'&&r.dataset.state==='暂缓');
      r.style.display=show?'':'none';
    });
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('tr[data-task-id]').forEach(function(row){
      var id=row.dataset.taskId;
      applyRow(row,load(id));
      row.querySelector('.state-btn').addEventListener('click',function(){
        var cur=row.dataset.state;
        var next=STATES[(STATES.indexOf(cur)+1)%STATES.length];
        var prev=load(id);
        var date=next==='已执行'?new Date().toLocaleDateString('zh-CN'):(prev.date||'');
        var obj={status:next,date:date};
        save(id,obj); applyRow(row,obj); updateProgress();
      });
    });
    updateProgress();
    document.querySelectorAll('.filt-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('.filt-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active'); filterRows(btn.dataset.filter);
      });
    });
  });
})();
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
        body.append(
            "<tr>"
            f"<td>{tag(text(r['优先级']))}<div class='small'>{esc(r['任务ID'])}</div></td>"
            f"<td><b>{esc(r['供应商SKU'])}</b><div class='small'>{esc(r['Wayfair Listing'])} / {esc(r['产品名'])}</div></td>"
            f"<td>{esc(r['问题类型'])}<div class='small'>{tag(text(r['任务状态']))}</div></td>"
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
</div>"""


def render_execution_center(tasks: pd.DataFrame) -> None:
    counts = tasks["优先级"].value_counts().to_dict()
    type_counts = tasks["问题类型"].value_counts().to_dict()
    p0 = tasks[tasks["优先级"].eq("P0")]
    wait_data = tasks[tasks["问题类型"].eq("数据缺口")]
    body = f"""{_TABLE_STYLES}
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


# ── Main ──────────────────────────────────────────────────────────────────────

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
    render_execution_center(tasks)
    render_task_report(tasks)
    render_profile_report(profiles, tasks)
    print(f"wrote {OUT_EXEC_CENTER}")
    print(f"wrote {OUT_TASK_REPORT}")
    print(f"wrote {OUT_SKU_PROFILE}")


if __name__ == "__main__":
    main()
