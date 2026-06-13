"""Build weekly action ledger and monthly review template reports."""
from __future__ import annotations

import csv
import html
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
LEDGER_CSV = DATA / "review_action_ledger_20260613.csv"
OUT_ACTION_LEDGER = REPORTS / "Wayfair_复盘动作账本_20260613.html"
OUT_MONTHLY_TEMPLATE = REPORTS / "Wayfair_月复盘模板_20260613.html"


STYLE = """
<style>
.review-note{border-left:4px solid #4880ff;background:#f4f7ff;border-radius:10px;padding:12px 14px;margin:12px 0;color:#344054}
.review-note.warn{border-color:#d97706;background:#fff7e6}
.review-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}
.review-card{border:1px solid #edf0f6;background:#fff;border-radius:12px;padding:14px;box-shadow:0 10px 24px rgba(15,23,42,.04)}
.review-card b{display:block;font-size:20px;margin-bottom:4px}
.review-card small{color:#667085}
.review-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #edf0f6;border-radius:12px;overflow:hidden;background:#fff;margin:12px 0}
.review-table th,.review-table td{padding:10px 12px;border-bottom:1px solid #edf0f6;text-align:left;vertical-align:top;font-size:13px}
.review-table th{background:#f8fafc;color:#344054;font-size:12px;text-transform:uppercase}
.review-table tr:last-child td{border-bottom:0}
.review-tag{display:inline-flex;border-radius:999px;padding:3px 8px;font-weight:900;font-size:12px}
.review-tag.p0{background:#fff0ee;color:#ef3826}
.review-tag.p1{background:#fff7e6;color:#d97706}
.review-tag.ok{background:#e9fff8;color:#00a88e}
.review-tag.info{background:#eef4ff;color:#4880ff}
.review-flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
.review-flow div{border:1px solid #edf0f6;border-radius:12px;background:#fff;padding:12px}
.review-flow span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#4880ff;color:#fff;font-weight:900;margin-bottom:6px}
@media(max-width:900px){.review-grid,.review-flow{grid-template-columns:1fr}.review-table{display:block;overflow-x:auto}}
</style>
"""


def esc(value: object) -> str:
    return html.escape(str(value or ""))


def rows() -> list[dict[str, str]]:
    with LEDGER_CSV.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def tag(level: str) -> str:
    cls = "p0" if level == "P0" else "p1" if level == "P1" else "info"
    return f'<span class="review-tag {cls}">{esc(level)}</span>'


def type_tag(t: str) -> str:
    if not t:
        return ""
    cls = "ok" if t in ("放量", "维持", "进攻") else "p1" if t in ("验证", "别误杀", "缩减") else "p0" if t == "止损" else "info"
    return f'<span class="review-tag {cls}">{esc(t)}</span>'


def result_cell(r: dict[str, str]) -> str:
    res = (r.get("result") or "").strip()
    if res:
        return f'<b>{esc(res)}</b>'
    return '<span class="review-tag info">待回填</span>'


def action_ledger() -> str:
    data = rows()
    weekly = [r for r in data if r["cadence"] == "Weekly"]
    pending = [r for r in data if r["status"] == "Pending"]
    body_rows = "\n".join(
        "<tr>"
        f"<td>{tag(r['level'])} {type_tag(r.get('type',''))}<br><small>{esc(r['action_id'])}</small></td>"
        f"<td><b>{esc(r['object'])}</b><br><small>{esc(r['cycle'])}</small></td>"
        f"<td><b>{esc(r['decision'])}</b><br>{esc(r['reason'])}</td>"
        f"<td>{esc(r['expected_metric'])}<br><small>Next: {esc(r['next_check'])}</small></td>"
        f"<td>{result_cell(r)}</td>"
        f"<td>{esc(r['promote_rule'])}</td>"
        f"<td>{esc(r['stop_loss_rule'])}</td>"
        f"<td>{esc(r['owner'])}<br><span class=\"review-tag info\">{esc(r['status'])}</span></td>"
        "</tr>"
        for r in data
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Wayfair 复盘动作账本</title></head><body>
{STYLE}
<h1>Wayfair 复盘动作账本</h1>
<div class="review-note"><b>用途：</b>把周复盘和月复盘的建议变成可跟踪动作。每条动作都必须回答：为什么做、谁做、什么时候复查、成功后如何推广、失败后如何止损。</div>
<div class="review-note warn"><b>v2 口径升级（在 codex 基础上）：</b>① <b>真实订单优先于广告 14 天归因</b>——0 归因不等于该停，先看真实成交件数（DMOM1019 即被纠偏）；② <b>利润闸</b>：6 月成本未回填期间，所有"加预算"标"待毛利确认"；③ <b>库存硬门槛</b>：赢家要加预算必须库存健康，缺货先补货；④ <b>闭环结果列</b>：到 Next check 把实际结果回填到"结果"列，再触发推广或止损。</div>
<div class="review-grid">
  <div class="review-card"><b>{len(data)}</b><small>当前动作</small></div>
  <div class="review-card"><b>{len(weekly)}</b><small>周复盘动作</small></div>
  <div class="review-card"><b>{len(pending)}</b><small>待验证</small></div>
  <div class="review-card"><b>3</b><small>单次复盘最多主动作</small></div>
</div>
<h2>1. 本期动作账本</h2>
<table class="review-table">
  <thead><tr><th>级别 / 类型</th><th>对象</th><th>动作与原因</th><th>复盘指标</th><th>结果</th><th>推广规则</th><th>止损规则</th><th>负责人</th></tr></thead>
  <tbody>{body_rows}</tbody>
</table>
<h2>2. 闭环规则</h2>
<div class="review-flow">
  <div><span>1</span><b>发现问题</b><small>订单、WSP 或月报触发异常。</small></div>
  <div><span>2</span><b>定位对象</b><small>落到账号、类目、Listing、SKU 或关键词。</small></div>
  <div><span>3</span><b>给动作</b><small>止损、修复、验证、放量、进攻五类动作。</small></div>
  <div><span>4</span><b>回填结果</b><small>到 Next check 把实际指标写进"结果"列。</small></div>
  <div><span>5</span><b>推广/止损</b><small>成功沉淀打法，失败停止消耗。</small></div>
</div>
<div class="review-note warn">周复盘不做结构性定论，只做快速止损和小预算验证；且优先看真实订单而非广告归因。月复盘才决定长期 SKU 分层、Listing 修复优先级和类目策略。周动作到 Next check 未回填结果的，下次自动进入月复盘重审，避免临时止损悄悄变永久。</div>
</body></html>"""


def monthly_template() -> str:
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Wayfair 月复盘模板</title></head><body>
{STYLE}
<h1>Wayfair 月复盘模板：账号 -> 类目 -> SKU -> 动作</h1>
<div class="review-note"><b>目标：</b>让运营从店铺全盘看清问题，把增长、修复、止损和复制打法拆到 SKU 级别。月复盘只使用有效完整月报；空表、To Date 少量行、字段不完整的数据不得进入结构判断。</div>
<div class="review-note warn"><b>四道闸（v2，进入 SKU 四象限前先过）：</b>① <b>真实订单闸</b>——以真实成交件数为主信号，广告 14 天归因只作辅助，0 归因但有真实单的不判止损；② <b>利润闸</b>——YB 成本/回款回填后用真实毛利重算 ROAS，未回填前所有"放量"只是候选；③ <b>库存闸</b>——放量前库存必须健康，缺货先补货不加预算；④ <b>闭环闸</b>——上期周/月动作的"结果"必须先回填，验证成功才推广、失败才止损。</div>
<h2>1. 月复盘总览</h2>
<div class="review-grid">
  <div class="review-card"><b>Revenue</b><small>MoM / YoY / vs category</small></div>
  <div class="review-card"><b>Traffic</b><small>Visits / sessions / ad clicks</small></div>
  <div class="review-card"><b>CVR</b><small>Listing, price, review, delivery</small></div>
  <div class="review-card"><b>AOV</b><small>SKU mix, bundle, discount</small></div>
</div>
<h2>2. 诊断框架</h2>
<table class="review-table">
  <thead><tr><th>层级</th><th>输入</th><th>核心问题</th><th>输出</th></tr></thead>
  <tbody>
    <tr><td>账号</td><td>Account Overview / Business Performance</td><td>销售额变化来自流量、转化还是客单价？</td><td>本月主矛盾和最多 3 个经营动作。</td></tr>
    <tr><td>类目</td><td>Sales Dashboard</td><td>店铺类目涨跌是否跑赢大盘？哪个类目拖累？</td><td>类目机会、类目止损、类目修复优先级。</td></tr>
    <tr><td>SKU</td><td>Option Drill Down / Detailed Listing Health / Cost Stack</td><td>SKU 是该放量、修承接、保守验证还是退出？</td><td>SKU 四象限动作清单。</td></tr>
    <tr><td>投放</td><td>WSP Campaign / Product / Keyword / Search Term</td><td>广告是在放大好 SKU，还是给坏承接继续输血？</td><td>预算重排、关键词推广、无效组合止损。</td></tr>
  </tbody>
</table>
<h2>3. SKU 四象限</h2>
<table class="review-table">
  <thead><tr><th>象限</th><th>判定</th><th>动作</th><th>是否可推广</th></tr></thead>
  <tbody>
    <tr><td><span class="review-tag ok">放量</span></td><td>有订单、有毛利、库存健康、CVR 不弱、广告可解释。</td><td>增加预算或促销，但保留 7 天复查。</td><td>提炼关键词、图片、价格、配送、评价打法后复制。</td></tr>
    <tr><td><span class="review-tag info">修复</span></td><td>有流量或历史订单，但 Listing / 价格 / 评价 / 配送短板明显。</td><td>先修承接，再开广告或促销。</td><td>修复后连续两周达标再推广。</td></tr>
    <tr><td><span class="review-tag p1">验证</span></td><td>样本小但信号好，或自然单强但广告弱。</td><td>小预算、小范围、短周期测试。</td><td>成功两轮才进入放量池。</td></tr>
    <tr><td><span class="review-tag p0">止损</span></td><td>连续消耗无订单，或毛利/库存/客诉/评价任一项严重拖累。</td><td>暂停广告、促销或下架候选。</td><td>不推广；除非修复证据明确。</td></tr>
  </tbody>
</table>
<h2>4. 月度交付物</h2>
<div class="review-flow">
  <div><span>1</span><b>全盘结论</b><small>本月最大问题和最大机会。</small></div>
  <div><span>2</span><b>SKU 矩阵</b><small>放量、修复、验证、止损。</small></div>
  <div><span>3</span><b>方法库</b><small>成功打法可复制条件。</small></div>
  <div><span>4</span><b>动作账本</b><small>负责人、截止时间、复盘指标。</small></div>
  <div><span>5</span><b>下月目标</b><small>Revenue、CVR、AOV、ROAS。</small></div>
</div>
</body></html>"""


def main() -> None:
    REPORTS.mkdir(exist_ok=True)
    OUT_ACTION_LEDGER.write_text(action_ledger(), encoding="utf-8")
    OUT_MONTHLY_TEMPLATE.write_text(monthly_template(), encoding="utf-8")
    print(f"wrote {OUT_ACTION_LEDGER.relative_to(ROOT)}")
    print(f"wrote {OUT_MONTHLY_TEMPLATE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
