from __future__ import annotations

import html
import re
from pathlib import Path

import pandas as pd

from input_checks import require_files


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

CATALOG = RAW / "Wayfair_Pricing_Product Catalog_Jun 04 2026_15-00.xlsx"
CATALOG_CHECK = RAW / "Wayfair_Pricing_Product Catalog_Jun 04 2026_15-01.xlsx"
COST = RAW / "Pricing_export_cost_stack_report_May2026_06-04-2026_14-55-00.csv"
OUT_CSV = DATA / "Wayfair_Pricing_ProductCatalog_定价体检_20260604.csv"
OUT_HTML = REPORTS / "Wayfair_Pricing_ProductCatalog_定价体检_20260604.html"


def clean_money(v):
    if pd.isna(v):
        return None
    s = str(v).replace("$", "").replace("CA", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def num(v, default=0.0):
    if v is None or pd.isna(v):
        return default
    try:
        return float(v)
    except Exception:
        return default


def esc(v):
    if v is None or pd.isna(v):
        return ""
    return html.escape(str(v))


def money(v):
    return f"${num(v):,.2f}"


def pct(v):
    return f"{num(v) * 100:.1f}%"


def load_catalog(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="Pricing", header=None)
    cols = raw.iloc[1].tolist()
    df = raw.iloc[4:].copy()
    df.columns = cols
    df = df.dropna(how="all")
    keep = [
        "SupplierPartNumber", "Status", "skus", "CurrentBaseCost", "BaseCost",
        "CurrentB2bDiscountPercent", "B2bDiscountPercent", "B2bDiscountBaseCost",
        "CurrentMapUSD", "NewMapUSD", "CurrentMsrpUSD", "NewMsrpUSD",
        "CastlegateTargetQuantity", "CastlegateMarkdownDiscountPercent",
        "CastlegateMarkdownMap", "CastlegateInventory",
    ]
    return df[[c for c in keep if c in df.columns]].rename(columns={
        "SupplierPartNumber": "Part",
        "skus": "Listing",
        "CurrentBaseCost": "CurrentBaseCostCatalog",
        "BaseCost": "NewBaseCostCatalog",
        "CurrentB2bDiscountPercent": "CurrentB2BDiscount",
        "B2bDiscountPercent": "NewB2BDiscount",
        "B2bDiscountBaseCost": "NewB2BBaseCost",
        "CurrentMapUSD": "CurrentMAPUSD",
        "NewMapUSD": "NewMAPUSD",
        "CurrentMsrpUSD": "CurrentMSRPUSD",
        "NewMsrpUSD": "NewMSRPUSD",
    })


def load_retail(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="Retail Prices (View Only)", header=None)
    cols = raw.iloc[1].tolist()
    df = raw.iloc[3:].copy()
    df.columns = cols
    df = df.dropna(how="all")
    df["RetailPriceValue"] = df["Retail Price"].map(clean_money)
    pivot = df.pivot_table(
        index=["Supplier Part Number", "SKU"],
        columns="Brand Catalog",
        values="RetailPriceValue",
        aggfunc="first",
    ).reset_index()
    pivot.columns.name = None
    return pivot.rename(columns={
        "Supplier Part Number": "Part",
        "SKU": "Listing",
        "Wayfair": "RetailUS",
        "Wayfair CA": "RetailCA",
        "Wayfair CA (FR)": "RetailCAFR",
    })


def load_cost() -> pd.DataFrame:
    df = pd.read_csv(COST, encoding="utf-8-sig", low_memory=False)
    df = df[df["BrandCatalog"].astype(str).eq("Wayfair US")].copy()
    df["Report Week"] = pd.to_datetime(df["Report Week"], errors="coerce")
    df = df.sort_values("Report Week").groupby("SupplierPart Number", dropna=False).tail(1)
    df["PlatformMargin"] = pd.to_numeric(df["Retail Price Net"], errors="coerce") - pd.to_numeric(df["Total Cost"], errors="coerce")
    df["PlatformPct"] = df["PlatformMargin"] / pd.to_numeric(df["Retail Price Net"], errors="coerce")
    keep = [
        "SupplierPart Number", "Retail Price Net", "Base Cost", "WholesaleCost", "Total Cost",
        "Ship Outbound Cost", "Incident And Return Cost", "Product Allowance Cost",
        "Other Handling Cost", "B2C Discount", "PlatformMargin", "PlatformPct",
        "WSC MarketCompetitiveness Percentile", "ShipCost MarketCompetitiveness Percentile",
        "IncidentsAndReturnCost MarketCompetitiveness Percentile",
    ]
    return df[keep].rename(columns={
        "SupplierPart Number": "Part",
        "Retail Price Net": "CostStackRetailNet",
        "Base Cost": "CostStackBaseCost",
        "WSC MarketCompetitiveness Percentile": "WSCPercentile",
        "ShipCost MarketCompetitiveness Percentile": "ShipCostPercentile",
        "IncidentsAndReturnCost MarketCompetitiveness Percentile": "IncidentReturnPercentile",
    })


def build():
    catalog = load_catalog(CATALOG)
    catalog_check = load_catalog(CATALOG_CHECK)
    retail = load_retail(CATALOG)
    cost = load_cost()
    df = catalog.merge(retail, on=["Part", "Listing"], how="left").merge(cost, on="Part", how="left")
    df["CatalogFilesMatch"] = df[["Part", "Listing", "CurrentBaseCostCatalog"]].merge(
        catalog_check[["Part", "Listing", "CurrentBaseCostCatalog"]],
        on=["Part", "Listing", "CurrentBaseCostCatalog"],
        how="left",
        indicator=True,
    )["_merge"].eq("both").values
    df["BaseCostGap"] = pd.to_numeric(df["CurrentBaseCostCatalog"], errors="coerce") - pd.to_numeric(df["CostStackBaseCost"], errors="coerce")
    df["BaseToRetailUS"] = pd.to_numeric(df["CurrentBaseCostCatalog"], errors="coerce") / pd.to_numeric(df["RetailUS"], errors="coerce")
    df["PlatformPct"] = pd.to_numeric(df["PlatformPct"], errors="coerce").fillna(0)
    df["WSCPercentile"] = pd.to_numeric(df["WSCPercentile"], errors="coerce")
    df["ShipCostPercentile"] = pd.to_numeric(df["ShipCostPercentile"], errors="coerce")
    df["IncidentReturnPercentile"] = pd.to_numeric(df["IncidentReturnPercentile"], errors="coerce")

    decisions = []
    for _, r in df.iterrows():
        issues = []
        action = []
        retail_us = num(r.get("RetailUS"))
        cost_stack_retail = num(r.get("CostStackRetailNet"))
        if retail_us <= 0:
            issues.append("缺少美国前台价")
            action.append("先确认是否仍可售或是否仅部分店铺可售")
        if cost_stack_retail <= 0:
            issues.append("5月 Cost Stack 无匹配")
            action.append("等有效Cost Stack或用订单利润表补验")
        if abs(num(r.get("BaseCostGap"))) > 0.01:
            issues.append("Product Catalog Base Cost 与 Cost Stack Base Cost 不一致")
            action.append("先核对是否有最新Base Cost待生效")
        if num(r.get("PlatformPct")) < 0.12 and num(r.get("PlatformPct")) > 0:
            issues.append("平台空间低于12%")
            action.append("不进促销，先查物流/退货/操作成本")
        if retail_us > 0 and num(r.get("BaseToRetailUS")) > 0.72:
            issues.append("Base Cost / 前台价偏高")
            action.append("谨慎调高Base Cost，优先优化成本结构")
        if num(r.get("WSCPercentile")) > 0.7:
            issues.append("供货价市场竞争力弱")
            action.append("复核采购成本或Base Cost")
        if num(r.get("ShipCostPercentile")) > 0.7:
            issues.append("发货成本竞争力弱")
            action.append("复核包裹尺寸/配送方式")
        if num(r.get("IncidentReturnPercentile")) > 0.7:
            issues.append("客诉退货成本竞争力弱")
            action.append("回查Customer Feedback和退货原因")
        if not issues:
            issues.append("定价结构暂无明显红灯")
            action.append("维持当前Base Cost，促销前再结合SKU准入")
        decisions.append(("；".join(issues), "；".join(dict.fromkeys(action))))
    df["PricingDiagnosis"] = [x[0] for x in decisions]
    df["PricingAction"] = [x[1] for x in decisions]
    return df


def render(df: pd.DataFrame):
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    csv_columns = {
        "Part": "供应商SKU",
        "Status": "状态",
        "Listing": "Wayfair Listing/SKU",
        "CurrentBaseCostCatalog": "目录当前Base Cost",
        "NewBaseCostCatalog": "目录新Base Cost",
        "CurrentB2BDiscount": "当前B2B折扣",
        "NewB2BDiscount": "新B2B折扣",
        "NewB2BBaseCost": "新B2B Base Cost",
        "CurrentMAPUSD": "当前MAP(USD)",
        "NewMAPUSD": "新MAP(USD)",
        "CurrentMSRPUSD": "当前MSRP(USD)",
        "NewMSRPUSD": "新MSRP(USD)",
        "CastlegateTargetQuantity": "Castlegate目标数量",
        "CastlegateMarkdownDiscountPercent": "Castlegate清仓折扣",
        "CastlegateMarkdownMap": "Castlegate清仓MAP",
        "CastlegateInventory": "Castlegate库存",
        "RetailUS": "美国前台价",
        "RetailCA": "加拿大前台价",
        "RetailCAFR": "加拿大法语前台价",
        "CostStackRetailNet": "Cost Stack净零售价",
        "CostStackBaseCost": "Cost Stack Base Cost",
        "WholesaleCost": "Wholesale Cost",
        "Total Cost": "Total Cost",
        "Ship Outbound Cost": "出仓成本",
        "Incident And Return Cost": "客诉退货成本",
        "Product Allowance Cost": "产品津贴成本",
        "Other Handling Cost": "其他操作成本",
        "B2C Discount": "B2C折扣",
        "PlatformMargin": "平台空间金额",
        "PlatformPct": "平台空间率",
        "WSCPercentile": "供货价竞争百分位",
        "ShipCostPercentile": "发货成本竞争百分位",
        "IncidentReturnPercentile": "客诉退货竞争百分位",
        "CatalogFilesMatch": "两份Catalog是否一致",
        "BaseCostGap": "Catalog与CostStack Base差额",
        "BaseToRetailUS": "Base Cost/美国前台价",
        "PricingDiagnosis": "定价诊断",
        "PricingAction": "定价处理建议",
    }
    df.rename(columns=csv_columns).to_csv(OUT_CSV, index=False, encoding="utf-8-sig")

    risky = df[
        df["PricingDiagnosis"].astype(str).str.contains("缺少|无匹配|低于12|偏高|竞争力弱|不一致", regex=True)
    ].copy()
    risky = risky.sort_values(["PlatformPct", "BaseToRetailUS"], ascending=[True, False])

    def rows(rows_df):
        out = []
        for _, r in rows_df.iterrows():
            out.append(
                "<tr>"
                f"<td><b>{esc(r['Part'])}</b><div class='small'>{esc(r['Listing'])}</div></td>"
                f"<td>{esc(r['Status'])}</td>"
                f"<td class='right'>{money(r['CurrentBaseCostCatalog'])}</td>"
                f"<td class='right'>{money(r['RetailUS'])}<div class='small'>Base/零售价 {pct(r['BaseToRetailUS'])}</div></td>"
                f"<td class='right'>{money(r['PlatformMargin'])}<div class='small'>{pct(r['PlatformPct'])}</div></td>"
                f"<td class='right'>{num(r['WSCPercentile']):.2f}<div class='small'>发货 {num(r['ShipCostPercentile']):.2f} / 退货 {num(r['IncidentReturnPercentile']):.2f}</div></td>"
                f"<td>{esc(r['PricingDiagnosis'])}</td>"
                f"<td>{esc(r['PricingAction'])}</td>"
                "</tr>"
            )
        return "\n".join(out)

    help_summary = """
<ul>
<li>Cost Stack 每月 1 日发布，包含上月活跃产品，每周定价数据会重复列出同一产品。</li>
<li>Total Cost 包含 WholesaleCost、出仓成本、其他运输成本、客诉退货成本、津贴、回扣和其他操作成本。</li>
<li>平台空间按 Retail Price Net - Total Cost 看，不按 WholesaleCost - Total Cost 看。</li>
<li>市场竞争百分位越低，代表供货价、发货成本、客诉退货成本相对越有竞争力。</li>
<li>如果发货成本或客诉退货成本偏高，应先查包裹尺寸、配送方式、库存定位、Customer Feedback 和退货原因。</li>
</ul>
"""

    html_text = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayfair Product Catalog 定价体检</title>
<style>
body{{margin:0;background:#f6f7fb;color:#172033;font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.6}}header{{background:#10213d;color:#fff;padding:30px 34px}}h1{{margin:0;font-size:28px}}.meta{{color:#dbe7ff;margin-top:6px}}.wrap{{max-width:1220px;margin:auto;padding:24px 34px}}.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}.card,.section{{background:#fff;border:1px solid #d8e0ec;border-radius:8px;box-shadow:0 6px 18px #1018280a}}.card{{padding:16px}}.num{{font-size:26px;font-weight:800;color:#1f5cc4}}.section{{padding:20px;margin:18px 0}}h2{{margin:0 0 12px;font-size:21px}}.callout{{border-left:4px solid #1f5cc4;background:#f8fbff;padding:12px 14px;border-radius:8px;margin:12px 0}}.warn{{border-left-color:#b54708;background:#fff8ed}}.tablebox{{overflow:auto;border:1px solid #d8e0ec;border-radius:8px;max-height:660px}}table{{width:100%;border-collapse:collapse;min-width:1060px;background:#fff}}th,td{{padding:8px 10px;border-bottom:1px solid #edf1f7;text-align:left;vertical-align:top;font-size:12.5px}}th{{position:sticky;top:0;background:#eef2f6}}.right{{text-align:right}}.small{{color:#667085;font-size:12px}}@media(max-width:800px){{.cards{{grid-template-columns:1fr 1fr}}.wrap{{padding:16px}}}}
</style></head><body>
<header><h1>Wayfair Product Catalog 定价体检</h1><div class="meta">生成日期：2026-06-04 ｜ 数据源：Pricing Product Catalog 15:00 / 15:01、5月 Cost Stack、Wayfair 成本结构帮助文章</div></header>
<div class="wrap">
<div class="cards">
<div class="card"><div class="num">{len(df)}</div><div>Product Catalog SKU</div></div>
<div class="card"><div class="num">{int(df['CatalogFilesMatch'].sum())}</div><div>15:00/15:01 一致</div></div>
<div class="card"><div class="num">{len(risky)}</div><div>需复核定价项</div></div>
<div class="card"><div class="num">{int(df['RetailUS'].notna().sum())}</div><div>有美国前台价</div></div>
</div>
<div class="section"><h2>1. 口径说明</h2>
<div class="callout"><b>这份报告用于定价体检，不直接改价。</b>Product Catalog 能看到当前 Base Cost、B2B 折扣、MSRP 和前台 Retail Price；Cost Stack 用于判断平台空间和成本竞争力。</div>
<div class="callout warn"><b>防错：</b>平台空间 = Retail Price Net - Total Cost。市场竞争百分位越低越有竞争力。</div>
{help_summary}
</div>
<div class="section"><h2>2. 需要优先复核的 SKU</h2>
<div class="tablebox"><table><thead><tr><th>SKU / Listing</th><th>状态</th><th>当前Base Cost</th><th>美国前台价</th><th>平台空间</th><th>竞争百分位</th><th>诊断</th><th>动作</th></tr></thead><tbody>{rows(risky)}</tbody></table></div>
</div>
<div class="section"><h2>3. 全量定价体检表</h2>
<div class="tablebox"><table><thead><tr><th>SKU / Listing</th><th>状态</th><th>当前Base Cost</th><th>美国前台价</th><th>平台空间</th><th>竞争百分位</th><th>诊断</th><th>动作</th></tr></thead><tbody>{rows(df.sort_values('Part'))}</tbody></table></div>
</div>
</div></body></html>"""
    OUT_HTML.write_text(html_text, encoding="utf-8")


def main():
    require_files(
        [CATALOG, CATALOG_CHECK, COST],
        root=ROOT,
        context="生成 Product Catalog 定价体检",
    )
    df = build()
    render(df)
    print("wrote", OUT_CSV)
    print("wrote", OUT_HTML)
    print("rows", len(df))
    print("risk", int(df["PricingDiagnosis"].astype(str).str.contains("缺少|无匹配|低于12|偏高|竞争力弱|不一致", regex=True).sum()))


if __name__ == "__main__":
    main()
