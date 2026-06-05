from __future__ import annotations

import html
import re
import sys
from pathlib import Path


def find_repo_root() -> Path:
    start = Path.cwd()
    for path in [start, *start.parents]:
        if (path / "reports").is_dir() and (path / ".git").exists():
            return path
    return Path(__file__).resolve().parents[1]


ROOT = find_repo_root()
REPORTS = ROOT / "reports"


CSS = """
:root{--bg:#eef2f6;--surface:#fff;--ink:#152033;--muted:#667085;--line:#dce3ee;--blue:#2870e8;--green:#23b887;--amber:#f0a331;--red:#ef5b45;--shadow:0 18px 45px rgba(16,24,40,.10)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body.wf-app-body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 Arial,"Microsoft YaHei",sans-serif}.wf-page{min-height:100vh;padding:18px}.wf-app{max-width:1400px;margin:auto;display:grid;grid-template-columns:230px minmax(0,1fr);background:#f7f9fc;border:1px solid #d7dfeb;border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.wf-side{background:#fff;border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:18px}.wf-brand{display:flex;align-items:center;gap:10px;font-weight:900}.wf-mark{width:34px;height:34px;border-radius:10px;background:#e8f6f1;display:grid;place-items:center;color:#11966e}.wf-brand small{display:block;color:var(--muted);font-weight:700}.wf-nav-label{font-size:11px;font-weight:900;color:#98a2b3;text-transform:uppercase;margin:8px 8px 6px}.wf-side a{display:flex;align-items:center;gap:9px;text-decoration:none;color:#344054;padding:9px 10px;border-radius:9px;font-weight:800}.wf-side a:hover,.wf-side a.active{background:#edf5ff;color:#175cd3}.wf-dot{width:9px;height:9px;border-radius:99px;background:currentColor}.wf-side-foot{margin-top:auto;border:1px solid #d8f0e4;background:#effaf4;border-radius:12px;padding:12px;color:#166534}.wf-side-foot b,.wf-side-foot small{display:block}.wf-main{min-width:0;padding:22px 24px 26px}.wf-topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.wf-search{height:40px;min-width:310px;background:#fff;border:1px solid var(--line);border-radius:999px;display:flex;align-items:center;gap:9px;padding:0 14px;color:#98a2b3}.wf-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 11px;color:#344054;font-weight:800;text-decoration:none}.wf-chip.live{background:#e9f8ef;color:#166534;border-color:#b7e4c7}.wf-hero{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;margin-bottom:16px}.wf-title-card,.wf-next-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 8px 24px rgba(16,24,40,.06)}.wf-eyebrow{font-size:12px;color:#667085;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.wf-title-card h1{font-size:30px;line-height:1.15;margin:8px 0 8px}.wf-title-card p{color:var(--muted);max-width:760px;margin:0}.wf-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.wf-btn{display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:10px 13px;text-decoration:none;font-weight:900}.wf-btn.primary{background:#152033;color:#fff}.wf-btn.green{background:#e9f8ef;color:#166534}.wf-btn.light{background:#eef4ff;color:#175cd3}.wf-next-card{background:#152033;color:#fff}.wf-next-card h2{margin:0 0 12px;font-size:19px}.wf-next-card a{display:flex;justify-content:space-between;gap:10px;text-decoration:none;color:#fff;background:#1f2937;border:1px solid #344054;border-radius:10px;padding:10px 11px;margin-top:8px}.wf-next-card small{color:#cbd5e1}.wf-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.wf-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px}.wf-kpi .value{font-size:25px;font-weight:950}.wf-kpi .label{display:block;color:#667085;font-weight:800;margin-top:4px}.wf-content{min-width:0}.wf-content>header,.wf-content>.wrap>h1:first-child,.wf-content>h1:first-child{display:none!important}.wf-content .wrap{max-width:none!important;margin:0!important;padding:0!important}.wf-content h2{font-size:19px;margin:0 0 12px!important;padding:0!important;border:0!important}.wf-content h3{font-size:16px;margin:16px 0 8px}.wf-panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 8px 24px rgba(16,24,40,.05)}.wf-panel>h2:first-child{display:flex;align-items:center;gap:8px}.wf-panel>h2:first-child:before{content:"";width:5px;height:20px;border-radius:5px;background:var(--blue);display:inline-block}.wf-content .card,.wf-content .section,.wf-content .callout{box-shadow:none!important;border-radius:12px!important;border-color:#e2e8f0!important}.wf-content table{width:100%;border-collapse:collapse;background:#fff!important;border:1px solid #e2e8f0!important;border-radius:12px;overflow:hidden}.wf-content th,.wf-content td{border:0!important;border-bottom:1px solid #edf1f7!important;padding:9px 10px!important;text-align:left;vertical-align:top}.wf-content th{background:#f1f5f9!important;color:#344054;font-weight:900;position:sticky;top:0;z-index:1}.wf-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:12px;margin:10px 0;max-height:680px;background:#fff}.wf-table-wrap table{border:0!important;margin:0!important;min-width:980px}.wf-content .grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))!important;gap:12px!important}.wf-content .tag,.wf-content .pill{border-radius:999px!important;padding:3px 9px!important;font-weight:900!important;font-size:12px!important}.wf-content ul,.wf-content ol{padding-left:20px}.wf-content a{color:#175cd3}.wf-content pre{white-space:pre-wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px}.wf-footer-note{color:#667085;margin-top:16px;font-size:13px}@media(max-width:1100px){.wf-app{grid-template-columns:1fr}.wf-side{display:none}.wf-hero{grid-template-columns:1fr}.wf-kpis{grid-template-columns:1fr 1fr}.wf-search{min-width:0;flex:1}}@media(max-width:680px){.wf-page{padding:0}.wf-app{border-radius:0;border:0}.wf-main{padding:18px}.wf-topbar{display:block}.wf-top-actions{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}.wf-title-card h1{font-size:26px}.wf-kpis{grid-template-columns:1fr}.wf-actions{display:grid}.wf-btn{justify-content:center}}
.wf-content .jumpcard{display:block;color:#172033!important;text-decoration:none}.wf-content .jumpcard:hover{border-color:#2870e8!important;box-shadow:0 8px 20px rgba(40,112,232,.10)!important}.wf-content .num{font-size:25px;font-weight:900;color:#175cd3}.wf-content .jumpnav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 18px}.wf-content .jumpnav a{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #d8e0ec;border-radius:999px;color:#172033;padding:7px 11px;text-decoration:none;line-height:1.2}.wf-content .jumpnav a:hover{border-color:#2870e8;color:#175cd3}.wf-content .callout{border-left:4px solid #2870e8!important;background:#f8fbff!important;padding:12px 14px!important;margin:12px 0!important}.wf-content .callout.warn{border-left-color:#b54708!important;background:#fff8ed!important}.wf-table-wrap .pricing-table{border-collapse:separate!important;border-spacing:0!important;min-width:2340px!important;table-layout:fixed!important}.wf-table-wrap .pricing-table .col-sku{width:330px}.wf-table-wrap .pricing-table .col-grade{width:150px}.wf-table-wrap .pricing-table .col-money{width:145px}.wf-table-wrap .pricing-table .col-platform{width:260px}.wf-table-wrap .pricing-table .col-margin{width:160px}.wf-table-wrap .pricing-table .col-issues{width:380px}.wf-table-wrap .pricing-table .col-actions{width:470px}.wf-content .pricing-table th,.wf-content .pricing-table td{font-size:13px!important;line-height:1.45!important;overflow-wrap:normal!important;word-break:normal!important}.wf-content .pricing-table th{z-index:3!important}.wf-content .pricing-table th:first-child,.wf-content .pricing-table td:first-child{position:sticky;left:0;z-index:2;background:#fff!important;box-shadow:1px 0 0 #edf1f7}.wf-content .pricing-table th:first-child{z-index:4!important;background:#f1f5f9!important}.wf-content .sku-cell b{display:block;font-size:13.5px}.wf-content .right{text-align:right!important;white-space:nowrap}.wf-content .small{color:#667085;font-size:12px;line-height:1.45;white-space:normal}.wf-content .text-list ul{margin:0;padding-left:16px}.wf-content .text-list li{margin:0 0 5px}.wf-content .text-list li:last-child{margin-bottom:0}.wf-content .action-list li{font-weight:700}.wf-content .costdetail{margin-top:7px;text-align:left;white-space:normal}.wf-content .costdetail summary{cursor:pointer;color:#175cd3;font-weight:800;white-space:normal}.wf-content .costgrid{margin:7px 0;padding:8px;background:#f8fafc;border:1px solid #d8e0ec;border-radius:6px;min-width:220px}.wf-content .costgrid div{display:flex;justify-content:space-between;gap:12px;padding:2px 0}.wf-content .costgrid span{color:#667085}.wf-content .backtop{margin-top:10px;text-align:right}.wf-content .backtop a{color:#175cd3;text-decoration:none}@media(max-width:900px){.wf-table-wrap .pricing-table{min-width:2200px!important}}
"""


JS = """
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".wf-content table").forEach((table) => {
    if (table.closest(".wf-table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "wf-table-wrap";
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    if (!table.classList.contains("pricing-table") && !table.classList.contains("task-tbl") && !table.classList.contains("exec-tbl")) {
      const columns = table.querySelector("tr")?.children.length || 0;
      table.style.minWidth = `${Math.max(980, columns * 130)}px`;
    }
  });
  document.querySelectorAll(".wf-content").forEach((content) => {
    const children = Array.from(content.children);
    let current = null;
    children.forEach((node) => {
      if (node.tagName === "H2") {
        current = document.createElement("section");
        current.className = "wf-panel";
        content.insertBefore(current, node);
        current.appendChild(node);
      } else if (current && node.parentNode === content) {
        current.appendChild(node);
      }
    });
  });
});
"""


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def first_matching(*needles: str) -> str:
    files = sorted(REPORTS.glob("*.html"))
    for path in files:
        hay = path.name
        if all(n in hay for n in needles):
            return "./" + path.name
    for path in files:
        src = text(path)
        title = extract_title(src, "")
        hay = path.name + "\n" + title
        if all(n in hay for n in needles):
            return "./" + path.name
    return "#"


def extract_title(src: str, fallback: str) -> str:
    for pattern in [r"<h1[^>]*>(.*?)</h1>", r"<title[^>]*>(.*?)</title>"]:
        match = re.search(pattern, src, re.I | re.S)
        if match:
            clean = re.sub(r"<[^>]+>", "", match.group(1)).strip()
            if clean:
                return clean
    return fallback


def extract_body(src: str) -> str:
    if 'class="wf-page"' in src:
        match = re.search(r'<main id="content" class="wf-content">\s*(.*?)\s*</main>\s*<p class="wf-footer-note"', src, re.I | re.S)
        if match:
            return match.group(1).strip()
    match = re.search(r"<body[^>]*>(.*?)</body>", src, re.I | re.S)
    return (match.group(1) if match else src).strip()


def context(title: str) -> tuple[str, str]:
    rules = [
        ("运营执行中心", ("Execution center", "本周必须先处理的 SKU、原因和动作。")),
        ("SKU任务清单", ("Task list", "按优先级聚合所有 SKU 运营动作。")),
        ("SKU经营档案", ("SKU profile", "单 SKU 的成本、库存、广告、促销和 Listing 证据。")),
        ("运营工作台", ("Start here", "当前状态、风险和下一步动作都在这里。")),
        ("库存映射", ("Inventory check", "加预算、促销、补货前先确认库存和映射置信度。")),
        ("促销准入", ("Promotion gate", "决定哪些 SKU 可以促销、哪些要先修复。")),
        ("SKU价值", ("SKU value", "用历史订单、利润、评分、客诉、广告判断 SKU 价值。")),
        ("定价", ("Pricing health", "检查成本、售价、平台空间和提价风险。")),
        ("数据补齐", ("Data status", "确认数据已经收到、仍缺什么。")),
        ("WSP", ("Ads action", "关键词、Campaign、Product 层调整建议。")),
        ("诊断", ("Diagnosis", "店铺问题、机会和风险。")),
        ("交接", ("Handoff", "接手流程和运营原则。")),
        ("护栏", ("Guardrails", "防止错误口径和误操作。")),
    ]
    for key, value in rules:
        if key in title:
            return value
    return ("Report", "关键数据和执行建议已经按 Dashboard 内页重新整理。")


def nav(current_name: str) -> str:
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
    return "\n".join(
        f'<a class="{"active" if current_name in href else ""}" href="{href}"><span class="wf-dot"></span>{html.escape(label)}</a>'
        for href, label in items
    )


def shell(title: str, body: str, filename: str) -> str:
    eyebrow, desc = context(title)
    workbench = first_matching("运营工作台")
    inventory = first_matching("库存映射")
    promo = first_matching("促销准入")
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <link rel="stylesheet" href="./assets/dashboard-shell.css">
</head>
<body class="wf-app-body">
<div class="wf-page"><div class="wf-app">
  <aside class="wf-side">
    <div class="wf-brand"><span class="wf-mark">W</span><div>Wayfair Ops<small>AI Command Center</small></div></div>
    <div class="wf-nav-label">Main</div><nav>{nav(filename)}</nav>
    <div class="wf-nav-label">Anchors</div><nav><a href="#content"><span class="wf-dot"></span>正文内容</a><a href="https://ai-wayfair.vercel.app"><span class="wf-dot"></span>线上首页</a></nav>
    <div class="wf-side-foot"><b>Dashboard 内页</b><small>统一侧栏、顶栏、摘要、面板和数据表样式。</small></div>
  </aside>
  <main class="wf-main">
    <div class="wf-topbar"><div class="wf-search">搜索报告、SKU、库存、广告动作</div><div class="wf-top-actions"><a class="wf-chip" href="../index.html">返回 Dashboard</a><a class="wf-chip live" href="https://ai-wayfair.vercel.app">线上查看</a></div></div>
    <section class="wf-hero">
      <div class="wf-title-card"><div class="wf-eyebrow">{html.escape(eyebrow)}</div><h1>{html.escape(title)}</h1><p>{html.escape(desc)}</p><div class="wf-actions"><a class="wf-btn primary" href="{workbench}">工作台</a><a class="wf-btn green" href="{inventory}">查库存</a><a class="wf-btn light" href="{promo}">促销准入</a></div></div>
      <aside class="wf-next-card"><h2>最短路径</h2><a href="{workbench}"><span>先确认状态</span><small>工作台</small></a><a href="{inventory}"><span>再看库存</span><small>库存映射</small></a><a href="{promo}"><span>最后执行</span><small>准入清单</small></a></aside>
    </section>
    <section class="wf-kpis"><div class="wf-kpi"><div class="value">5月</div><span class="label">有效 Cost Stack</span></div><div class="wf-kpi"><div class="value">686</div><span class="label">库存明细行</span></div><div class="wf-kpi"><div class="value">11</div><span class="label">A 级 SKU</span></div><div class="wf-kpi"><div class="value">准入</div><span class="label">促销判断已生成</span></div></section>
    <main id="content" class="wf-content">
{body}
    </main>
    <p class="wf-footer-note">建议按：工作台 → 库存映射 → 促销准入 → 具体报告 的顺序使用。</p>
  </main>
</div></div>
<script src="./assets/dashboard-shell.js"></script>
</body>
</html>
"""


def main() -> None:
    if not REPORTS.exists():
        print(f"reports not found: {REPORTS}", file=sys.stderr)
        sys.exit(1)
    assets = REPORTS / "assets"
    assets.mkdir(exist_ok=True)
    (assets / "dashboard-shell.css").write_text(CSS, encoding="utf-8")
    (assets / "dashboard-shell.js").write_text(JS, encoding="utf-8")

    count = 0
    for path in sorted(REPORTS.glob("*.html")):
        if "项目导航" in path.name:
            continue
        src = text(path)
        title = extract_title(src, path.stem)
        body = extract_body(src)
        path.write_text(shell(title, body, path.name), encoding="utf-8")
        count += 1
    print(f"dashboard shell applied to {count} report pages")


if __name__ == "__main__":
    main()
