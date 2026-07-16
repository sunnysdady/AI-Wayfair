"use client";

import { useEffect, useMemo, useState } from "react";

type View = "daily" | "plan" | "inventory" | "ads" | "review" | "catalog" | "sources";

const NAV: { id: View; label: string; meta: string }[] = [
  { id: "daily", label: "日报", meta: "今天" },
  { id: "plan", label: "运营计划", meta: "本月" },
  { id: "inventory", label: "库存更新", meta: "Gate" },
  { id: "ads", label: "广告优化", meta: "每周" },
  { id: "review", label: "月度复盘", meta: "13" },
  { id: "catalog", label: "商品数据", meta: "V2" },
  { id: "sources", label: "数据源", meta: "6/6" },
];

type OrderMetric = { revenue: number; orders: number; units: number; aov: number; profit: number; profitMode: "estimated" | "actual"; costCoverage: number; marginRate: number };
type OrderSummary = {
  current: OrderMetric;
  previous: OrderMetric;
  daily: { date: string; revenue: number; orders: number; units: number }[];
  topSkus: { partNumber: string; revenue: number; units: number }[];
  sync: { syncedAt?: string; refreshed?: boolean; stale?: boolean; error?: string };
  error?: string;
};

type CatalogInsight = { insightId?: string; title?: string; explanation?: string; monthsInViolation?: number; expirationDate?: string; resolution?: { url?: string; description?: string } };
type CatalogItem = {
  supplierPartNumber: string;
  catalogItemStatus?: string;
  class?: { classId?: string; className?: string };
  marketContext?: { locale?: string; country?: string; brand?: string; channel?: string; segment?: string; location?: string };
  listings?: { listingId?: string }[];
  insights?: { problems?: CatalogInsight[]; warnings?: CatalogInsight[]; opportunities?: CatalogInsight[] };
  recent30d?: { units: number; revenue: number };
};
type CatalogResponse = { items?: CatalogItem[]; paginationInfo?: { page: number; totalPages: number; totalCount: number; hasNextPage: boolean }; error?: string };

const presetOptions = [
  ["today", "今天"], ["yesterday", "昨天"], ["7d", "最近 7 天"], ["14d", "最近 14 天"],
  ["30d", "最近 30 天"], ["month", "本月"], ["lastMonth", "上个月"], ["custom", "自定义日期"],
] as const;

function dateText(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return dateText(date);
}

function rangeFor(preset: string) {
  const today = dateText(new Date());
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") { const day = shiftDate(today, -1); return { start: day, end: day }; }
  if (["7d", "14d", "30d"].includes(preset)) return { start: shiftDate(today, -(Number(preset.replace("d", "")) - 1)), end: today };
  const [year, month] = today.split("-").map(Number);
  if (preset === "month") return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: today };
  const lastMonth = new Date(Date.UTC(year, month - 2, 1, 12));
  const lastMonthEnd = new Date(Date.UTC(year, month - 1, 0, 12));
  return { start: dateText(lastMonth), end: dateText(lastMonthEnd) };
}

function money(value = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function change(current = 0, previous = 0) {
  if (!previous) return current ? "新发生" : "无变化";
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% 较前周期`;
}
const reportSections = [
  ["01", "广告执行口径已升级", "Campaign 级执行成为唯一有效版本；预算、Daily Cap、Bid Adjustment 与 SKU 统一回到账本。"],
  ["02", "目标池状态更新", "当前无法再获取历史库存量证据。本月目标从 8 月拆解到周节奏，并锁定可售 SKU。"],
  ["03", "150 单经营模型", "以 150 单为业务目标，基础广告预算 $1,800，硬上限 $2,500，放量 ROAS 不低于 4.0×。"],
  ["04", "SKU / Listing 责任表", "每个核心 SKU 对应库存、Catalog、广告和复盘责任，避免结论停留在报告里。"],
];

function ShellHeader({ active, onNavigate }: { active: View; onNavigate: (view: View) => void }) {
  return <>
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("daily")}><span>W</span><strong>Wayfair AI</strong><small>运营中台</small></button>
      <div className="workspace"><span>店铺</span><strong>YB店</strong></div>
      <div className="workspace"><span>复盘月</span><strong>2026年6月</strong></div>
      <div className="system"><i></i><span><strong>生产数据已连接</strong><small>写操作保留人工确认</small></span></div>
    </header>
    <nav className="nav" aria-label="主导航">
      {NAV.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}><span>{item.meta}</span>{item.label}</button>)}
    </nav>
  </>;
}

function Hero({ eyebrow, title, text, side }: { eyebrow: string; title: string; text: string; side?: React.ReactNode }) {
  return <header className="hero"><div><p>{eyebrow}</p><h1>{title}</h1><span>{text}</span></div>{side}</header>;
}

function Daily({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [checked, setChecked] = useState(false);
  const initialRange = rangeFor("today");
  const [preset, setPreset] = useState("today");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [data, setData] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/orders/summary?start=${start}&end=${end}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as OrderSummary;
        if (!response.ok) throw new Error(body.error || "订单数据读取失败");
        return body;
      })
      .then(setData)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "订单数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end]);

  function selectPreset(next: string) {
    setPreset(next);
    if (next !== "custom") { const range = rangeFor(next); if (range.start !== start || range.end !== end) { setLoading(true); setError(""); setStart(range.start); setEnd(range.end); } }
  }

  const current = data?.current;
  const previous = data?.previous;
  const chartMax = Math.max(1, ...(data?.daily || []).map((item) => Number(item.revenue)));
  const rangeLabel = start === end ? start : `${start} — ${end}`;
  return <>
    <Hero eyebrow="ORDERS API · OPERATING BRIEF" title="经营日报" text={`${rangeLabel} · 订单业绩、邮件摘要和运营待办`} side={<div className="hero-side"><b>{loading ? "同步中" : error ? "需检查" : "已更新"}</b><span>{data?.sync.stale ? "正在使用最近缓存" : "Ops API（库存 + 订单）"}</span></div>} />
    <section className="date-console" aria-label="经营周期">
      <div className="preset-list">{presetOptions.map(([id, label]) => <button key={id} className={preset === id ? "active" : ""} onClick={() => selectPreset(id)}>{label}</button>)}</div>
      {preset === "custom" && <div className="custom-range"><label>开始<input type="date" value={start} max={end} onChange={(event) => {setLoading(true);setError("");setStart(event.target.value);}} /></label><label>结束<input type="date" value={end} min={start} onChange={(event) => {setLoading(true);setError("");setEnd(event.target.value);}} /></label></div>}
      <span className={error ? "sync-state error" : "sync-state"}>{error || (data?.sync.stale ? `同步失败，显示缓存：${data.sync.error}` : data?.sync.syncedAt ? `最近同步 ${new Date(data.sync.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "正在连接订单数据")}</span>
    </section>
    <section className="stat-grid five order-kpis">
      {[
        [loading ? "—" : money(current?.revenue), "销售额", change(current?.revenue, previous?.revenue)],
        [loading ? "—" : String(current?.orders || 0), "订单", change(current?.orders, previous?.orders)],
        [loading ? "—" : String(current?.units || 0), "件数", change(current?.units, previous?.units)],
        [loading ? "—" : money(current?.aov), "客单价", change(current?.aov, previous?.aov)],
        [loading ? "—" : money(current?.profit), current?.profitMode === "actual" ? "实际利润" : "估算利润", current?.profitMode === "actual" ? "SKU 成本已完整覆盖" : `成本覆盖 ${Math.round((current?.costCoverage || 0) * 100)}% · 其余按 ${((current?.marginRate || .2826) * 100).toFixed(2)}%`],
      ].map(([value,label,note]) => <article className={`stat ${label.includes("利润") ? "profit-stat" : ""}`} key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}
    </section>
    <section className="cadence">
      <button onClick={() => onNavigate("daily")}><b>每日</b><span>订单与邮件</span><small>经营日报不触发广告动作</small></button>
      <button onClick={() => onNavigate("ads")}><b>本周</b><span>广告优化</span><small>35 项建议待处理</small></button>
      <button onClick={() => onNavigate("review")}><b>本月</b><span>经营复盘</span><small>13 份证据已归档</small></button>
    </section>
    <section className="card order-performance">
      <div className="section-head"><div><span>ORDER PERFORMANCE</span><h2>{rangeLabel} 订单走势</h2></div><b>{data?.sync.refreshed ? "API 已刷新并写入缓存" : "15 分钟缓存 · 增量预载"}</b></div>
      <div className="order-performance-body">
        <div className="daily-bars">{(data?.daily || []).length ? data?.daily.map((item) => <div key={item.date} title={`${item.date} · ${money(item.revenue)} · ${item.orders} 单`}><span>{money(item.revenue)}</span><i style={{ height: `${Math.max(4, Number(item.revenue) / chartMax * 100)}%` }}></i><b>{item.date.slice(5)}</b></div>) : <p>{loading ? "正在拉取订单数据…" : "所选周期暂无订单"}</p>}</div>
        <aside className="top-skus"><span>TOP SKU · 所选周期</span>{(data?.topSkus || []).slice(0, 5).map((item, index) => <div key={item.partNumber}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.partNumber}</strong><small>{item.units} 件</small></span><em>{money(item.revenue)}</em></div>)}{!data?.topSkus?.length && <p>暂无 SKU 销售记录</p>}</aside>
      </div>
    </section>
    <div className="daily-grid">
      <article className="card feature-card">
        <span className="pill amber">需尽快处理 · PERFORMANCE</span>
        <h2>Supplier Scorecard 有 3 项黄色指标</h2>
        <p className="meta">Asia Supplier Service Desk · 2026-07-16 03:47 · 已读</p>
        <p>Wayfair 发送 2026/06 月度供应商绩效卡，需要运营侧审阅并制定整改。当前没有明确罚款或封禁，但库存准确率、首扫/揽收和入库履约需要快速复盘。</p>
        <div className="score-table">
          <div className="head"><b>指标</b><b>当前值</b><b>状态</b><b>目标</b></div>
          {[['DS – SP – OTS','1.96','Yellow','≤ 1.4'],['Induction Fill Rate','89.66%','Yellow','≥ 93%'],['Inventory Inaccuracy Rate','1.45%','Yellow','< 0.51%']].map(row => <div key={row[0]}>{row.map(cell => <span key={cell}>{cell}</span>)}</div>)}
        </div>
        <p><b>建议：</b>今天先定位库存准确率和揽收链路；发货事项转交履约同事，中台只跟踪结果。</p>
        <button className="text-link">在 Outlook 打开原邮件</button>
      </article>
      <aside className="side-stack">
        <article className="card risk-card"><h2>最高风险</h2><div className="risk-number"><strong>3</strong><span>项黄色指标</span></div><p>最高风险来自 Supplier Scorecard，而不是财务扣款或订单异常。优先级高于培训和市场资讯。</p><div className="soft-note"><b>当前无新增：</b>订单取消、退款、退货、扣款、账号权限、合规封禁或产品下架。</div></article>
        <article className="card todo-card"><h2>我的待办</h2><label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /><span><b>审阅 Supplier Scorecard 并制定整改</b><small>负责人：用户本人 · 建议 07-18 前完成</small></span></label><label><input type="checkbox" /><span><b>确认是否参加广告投放 Webinar</b><small>优先级 P3 · 可选待办</small></span></label></article>
      </aside>
    </div>
  </>;
}

function Plan({ onNavigate }: { onNavigate: (view: View) => void }) {
  return <><Hero eyebrow="MONTHLY OPERATING PLAN" title="运营计划" text="目标、护栏、责任和执行证据共用一套节奏" side={<button className="hero-button" onClick={() => onNavigate("review")}>查看月度复盘</button>} />
    <section className="stat-grid five">{[["150 单","8月目标"],["$1,800","基础广告预算"],["$2,500","预算硬上限"],["≥ 4.0×","放量 ROAS"],["≥ 95%","Fill Rate"]].map(x=><article className="stat" key={x[1]}><strong>{x[0]}</strong><span>{x[1]}</span></article>)}</section>
    <div className="plan-grid"><article className="card"><div className="section-head"><div><span>OPERATING LOOP</span><h2>本月执行闭环</h2></div><b>数据齐套 86%</b></div><div className="timeline">{[["01","日报归集","每天"],["02","库存与商品 Gate","按需"],["03","广告优化","每周"],["04","经营复盘","月末"]].map(x=><button key={x[0]} onClick={()=>onNavigate(x[0]==='01'?'daily':x[0]==='02'?'inventory':x[0]==='03'?'ads':'review')}><b>{x[0]}</b><span>{x[1]}</span><small>{x[2]}</small></button>)}</div></article><article className="card"><div className="section-head"><div><span>OWNER QUEUE</span><h2>本月责任清单</h2></div></div><div className="owner-list">{[["经营","确认150单拆解","进行中"],["库存","修复准确率指标","优先"],["广告","处理35项周建议","待审批"],["复盘","归档13份证据","正常"]].map(x=><div key={x[0]}><b>{x[0]}</b><span>{x[1]}</span><em>{x[2]}</em></div>)}</div></article></div>
  </>;
}

function Inventory() {
  const [file, setFile] = useState(""); const [state, setState] = useState("等待库存文件");
  return <><Hero eyebrow="INVENTORY UPDATE · CONTROLLED WRITE" title="库存更新" text="上传、校验、Dry-run、确认推送；发货操作不在本系统内" side={<div className="hero-side"><b>Gate</b><span>{state}</span></div>} />
    <div className="inventory-grid"><article className="card upload-card"><span className="step">STEP 01</span><h2>更新最新库存</h2><label className="drop"><input type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]?.name||'');setState('文件待校验')}}/><b>{file || "选择领星库存 XLSX"}</b><span>系统套用 Supplier / SKU 映射</span></label><button className="primary" disabled={!file} onClick={()=>setState('Dry-run 已通过')}>校验并生成库存</button></article><article className="card gate-card"><span className="step">STEP 02</span><h2>推送前检查</h2><div className="gate-metrics">{[["可推送行","258"],["Supplier","1"],["零库存","14"],["未匹配","0"]].map(x=><div key={x[0]}><span>{x[0]}</span><strong>{state==='Dry-run 已通过'?x[1]:'—'}</strong></div>)}</div><div className="soft-note">正式推送需要再次确认；库存为零的记录会影响商品可售状态。</div><button className="primary dark" disabled={state!=='Dry-run 已通过'} onClick={()=>setState('等待正式确认')}>进入正式推送确认</button></article></div>
  </>;
}

function Ads() {
  const [tab,setTab]=useState<'week'|'month'>('week');
  const [group,setGroup]=useState<'sku'|'campaign'>('sku');
  const [start,setStart]=useState('2026-06-01'); const [end,setEnd]=useState('2026-06-30');
  const [message,setMessage]=useState('当前载入 2026-06-01 → 2026-06-30'); const [approved,setApproved]=useState<string[]>([]);
  const skuActions = [
    { id:'DMOM1025', children:'2 个 Listing · 1 个 Campaign', action:'暂停父体下低效 Listing', evidence:'28 次点击 · 0 单 · ROAS 0.00×', gate:'库存正常 · Catalog LIVE', state:'待审批' },
    { id:'DMOM1022', children:'3 个 Listing · Campaign 622721 / 622722', action:'父体 Bid 下调 10%', evidence:'31 次点击 · 1 单 · ROAS 1.39×，低于盈亏线 3.54×', gate:'库存正常 · Catalog LIVE', state:'待审批' },
    { id:'DMOM1017', children:'2 个 Listing · Campaign 622715', action:'保留出价，下一周期复查', evidence:'3 单 · ROAS 2.94×，证据未达到加价条件', gate:'不执行写入', state:'观察' },
  ];
  const campaignActions = [
    { id:'Campaign 622721', children:'DMOM1022 · 3 个 Listing', action:'Campaign Bid 下调 10%', evidence:'父体汇总 ROAS 1.39× · 31 次点击', gate:'SKU 库存与商品状态通过', state:'待审批' },
    { id:'Campaign 622731', children:'DMOM1029 · 2 个 Listing', action:'维持 Campaign，拆分低效 Listing', evidence:'父体 ROAS 4.14×，但子体差异大', gate:'父体通过 · 子体需复核', state:'暂缓' },
    { id:'Campaign 622709', children:'DMOM1025 · 2 个 Listing', action:'暂停无转化子体', evidence:'28 次点击 · 0 单 · 已越过最小样本线', gate:'库存正常 · Catalog LIVE', state:'待审批' },
  ];
  const actions = group === 'sku' ? skuActions : campaignActions;
  return <><Hero eyebrow="WEEKLY OPTIMIZATION · MONTHLY REVIEW" title="广告优化" text="周度形成父体执行清单；月度解释结果并进入经营复盘" side={<button className="hero-button" onClick={()=>setMessage('本周建议已按库存、Catalog 与利润 Gate 重新生成')}>生成本周清单</button>} />
    <section className="period-bar"><div><button className={tab==='week'?'active':''} onClick={()=>setTab('week')}>周优化</button><button className={tab==='month'?'active':''} onClick={()=>setTab('month')}>月度广告复盘</button></div><label>开始<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button onClick={()=>setMessage(`已创建 ${start} → ${end} 的官方报表拉取任务`)}>拉取该周期</button><span>{message}</span></section>
    <section className="ad-decision-grid">
      <article className="card decision-card"><span>本周期结论</span><h2>{tab==='week'?'先止损，再观察，不放量':'本月效率未稳定，不提高预算上限'}</h2><p>{tab==='week'?'DMOM1025 已满足无转化止损条件；DMOM1022 低于盈亏线，只下调，不暂停。':'月度表现用完整归因窗口复盘；下一月预算仍受 ROAS 与利润护栏约束。'}</p><div><b>3</b><small>父体动作</small><b>2</b><small>可执行</small><b>1</b><small>继续观察</small></div></article>
      <article className="card evidence-card"><span>判断依据</span><h2>每条动作必须回答“为什么”</h2><ul><li><b>样本门槛：</b>点击达到 20 次后才做止损判断。</li><li><b>效率护栏：</b>ROAS 与 3.54× 盈亏线比较，不只看订单数。</li><li><b>归因窗口：</b>周报结束后保留 7 天回看，避免误杀延迟转化。</li><li><b>经营 Gate：</b>库存、Catalog 状态和利润任一异常，动作暂缓。</li></ul></article>
    </section>
    <section className="card action-ledger"><div className="section-head"><div><span>EXECUTION LEDGER</span><h2>{tab==='week'?'本周父体执行清单':'月度复盘动作清单'}</h2></div><b>只在父体层审批 · 不会自动执行</b></div>
      <div className="group-switch"><button className={group==='sku'?'active':''} onClick={()=>setGroup('sku')}>按 SKU 父体</button><button className={group==='campaign'?'active':''} onClick={()=>setGroup('campaign')}>按广告父体</button><span>子 Listing 作为证据展开，不生成重复审批。</span></div>
      <div className="action-list"><div className="action-head"><span>父体对象 / 包含子体</span><span>执行动作</span><span>数据证据</span><span>经营 Gate</span><span>状态</span></div>{actions.map(row=><article key={row.id}><div><strong>{row.id}</strong><small>{row.children}</small></div><b>{row.action}</b><p>{row.evidence}</p><span className={row.gate.includes('正常')||row.gate.includes('通过')?'good':'warn'}>{row.gate}</span><div><em>{approved.includes(row.id)?'已批准':row.state}</em><button disabled={approved.includes(row.id)||row.state!=='待审批'} onClick={()=>setApproved([...approved,row.id])}>审批</button></div></article>)}</div>
    </section>
  </>;
}

function Review() {
  const [report,setReport]=useState(0); const reports=["8月150单完整增长 Playbook","2026年6月月度复盘总览","店铺诊断：6月增长成立","SKU 广告执行清单","类目对标与主图替代"];
  return <><Hero eyebrow="MONTHLY REVIEW · NEXT PLAN" title="月度复盘" text="经营事实、广告月复盘、执行证据与下月计划" side={<button className="hero-button">补充复盘资料</button>} />
    <div className="review-grid"><aside className="card report-list"><div><span>EVIDENCE LIBRARY</span><h2>复盘资料</h2><b>13</b></div>{reports.map((x,i)=><button className={report===i?'active':''} onClick={()=>setReport(i)} key={x}><strong>{x}</strong><small>2026/07/15 · {i===0?'57':'35'} KB</small></button>)}</aside><article className="card report-native"><header><span>PLAYBOOK</span><h2>{reports[report]}</h2><p>150单拆到 SKU、Listing、周节奏和广告预算；Conditional Offers 只是其中一个模块。</p></header><div className="report-metrics">{[["月度目标","150 单"],["基础预算","$1,800"],["预算上限","$2,500"],["放量 ROAS","≥ 4.0×"],["Fill Rate","≥ 95%"]].map(x=><div key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong></div>)}</div><div className="report-sections">{reportSections.map(x=><section key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p></section>)}</div></article></div>
  </>;
}

function Catalog() {
  const [query,setQuery]=useState(''); const [submitted,setSubmitted]=useState(''); const [status,setStatus]=useState('');
  const [page,setPage]=useState(1); const [refresh,setRefresh]=useState(0); const [data,setData]=useState<CatalogResponse | null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [selected,setSelected]=useState<CatalogItem | null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),pageSize:'20'}); if(submitted)params.set('q',submitted); if(status)params.set('status',status);
    fetch(`/api/catalog/items?${params}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as CatalogResponse;if(!response.ok)throw new Error(body.error||'商品数据读取失败');return body;}).then(body=>{setData(body);setSelected(body.items?.[0]||null);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message||'商品数据读取失败');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[submitted,status,page,refresh]);
  const pages=data?.paginationInfo;
  const insights=selected?.insights;
  const insightTotal=(insights?.problems?.length||0)+(insights?.warnings?.length||0)+(insights?.opportunities?.length||0);
  function submit(){setLoading(true);setError('');setPage(1);setSubmitted(query.trim().toUpperCase());setRefresh(value=>value+1);}
  return <><Hero eyebrow="CATALOG READ V2 · ORDER JOIN" title="商品数据" text="Catalog 商品事实与近 30 天订单表现合并为 SKU 360° 视图" side={<div className="hero-side"><b>{loading?'同步中':error?'需检查':'已连接'}</b><span>Catalog Read V2 · {pages?.totalCount||0} 个商品</span></div>} />
    <section className="card catalog-card"><div className="filters"><label>Supplier Part #<input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}} placeholder="精确输入，如 DMOM1022"/></label><label>商品状态<select value={status} onChange={e=>{setLoading(true);setError('');setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option><option value="LIVE">LIVE</option><option value="NOT_LIVE">NOT LIVE</option><option value="LAUNCHING">LAUNCHING</option></select></label><button className="primary" onClick={submit}>查询商品</button></div>
      {error&&<div className="inline-error">{error}</div>}
      <div className="catalog-layout"><div className="catalog-results"><div className="catalog-row catalog-head"><span>SKU / Listing</span><span>状态</span><span>品牌 · 类目</span><span>市场</span><span>诊断</span><span>近 30 天</span></div>{(data?.items||[]).map(item=>{const issues=(item.insights?.problems?.length||0)+(item.insights?.warnings?.length||0);return <button className={`catalog-row ${selected?.supplierPartNumber===item.supplierPartNumber?'selected':''}`} key={item.supplierPartNumber} onClick={()=>setSelected(item)}><span><strong>{item.supplierPartNumber}</strong><small>{item.listings?.length||0} 个 Listing</small></span><em className={item.catalogItemStatus==='LIVE'?'good':'bad'}>{item.catalogItemStatus?.replace('_',' ')||'—'}</em><span><b>{item.marketContext?.brand||'—'}</b><small>{item.class?.className||'未分类'}</small></span><span><b>{item.marketContext?.country||'—'} · {item.marketContext?.locale||'—'}</b><small>{item.marketContext?.channel||'—'} / {item.marketContext?.segment||'—'}</small></span><span><b>{issues} 问题</b><small>{item.insights?.opportunities?.length||0} 机会</small></span><span><b>{item.recent30d?.units||0} 件</b><small>{money(item.recent30d?.revenue||0)}</small></span></button>})}{!loading&&!data?.items?.length&&<p className="empty-state">没有符合条件的商品</p>} {loading&&<p className="empty-state">正在读取 Catalog…</p>}
        <div className="pagination"><span>第 {pages?.page||1} / {pages?.totalPages||1} 页 · 共 {pages?.totalCount||0} 个</span><button disabled={page<=1} onClick={()=>{setLoading(true);setError('');setPage(page-1);}}>上一页</button><button disabled={!pages?.hasNextPage} onClick={()=>{setLoading(true);setError('');setPage(page+1);}}>下一页</button></div></div>
        <aside className="product-detail">{selected?<><span>SKU 360°</span><h2>{selected.supplierPartNumber}</h2><div className="product-facts"><div><small>商品状态</small><b>{selected.catalogItemStatus?.replace('_',' ')}</b></div><div><small>Listing</small><b>{selected.listings?.length||0}</b></div><div><small>近 30 天销售</small><b>{money(selected.recent30d?.revenue||0)}</b></div><div><small>诊断信号</small><b>{insightTotal}</b></div></div><section><h3>市场与标识</h3><p>{selected.marketContext?.brand||'—'} · {selected.class?.className||'未分类'} · {selected.marketContext?.country||'—'} / {selected.marketContext?.channel||'—'}</p><div className="listing-tags">{selected.listings?.map(item=><i key={item.listingId}>{item.listingId}</i>)}</div></section><section><h3>Catalog 诊断</h3>{([['问题',insights?.problems],['警告',insights?.warnings],['机会',insights?.opportunities]] as [string,CatalogInsight[]|undefined][]).map(([label,list])=>list?.map(item=><article className="insight" key={item.insightId||item.title}><b>{label} · {item.title||'未命名信号'}</b><p>{item.explanation||'Catalog 未提供详细解释。'}</p>{item.monthsInViolation? <small>已持续 {item.monthsInViolation} 个月</small>:null}{item.resolution?.url&&/^https:\/\//.test(item.resolution.url)&&<a href={item.resolution.url} target="_blank" rel="noreferrer">查看 Wayfair 处理指引</a>}</article>))}{!insightTotal&&<p className="empty-insight">当前没有 Catalog 问题、警告或机会。</p>}</section><section className="linkage-note"><h3>跨模块联动</h3><p>订单表现已关联；库存写入前进入 Inventory Gate，广告动作在周度父体清单统一审批。</p></section></>:<p>选择左侧商品查看完整信息。</p>}</aside></div>
    </section></>;
}

function Sources() {
  const sources=[['Outlook 邮件日报','已同步','2026-07-16','风险与待办'],['Ops API · 库存 + 订单','生产','同一套 OAuth 应用','库存写 · 订单读'],['Advertising API','生产','凭证已配置','报表读 · Bid 写'],['Catalog Read V2','生产','双版本权限','商品、Listing 与诊断'],['月度报告资料库','已同步','13 份报告','复盘证据与计划'],['订单历史缓存','运行中','D1 增量预载','15 分钟刷新']];
  return <><Hero eyebrow="DATA SOURCES · PERMISSION CONTROL" title="数据源" text="库存与订单共用 Ops 应用；每个连接只承担明确的数据职责" /><div className="source-grid">{sources.map(x=><article className="card source-card" key={x[0]}><span className="connected">{x[1]}</span><h2>{x[0]}</h2><p>{x[2]}</p><small>{x[3]}</small></article>)}</div></>;
}

export default function OpsCenter() {
  const [view,setView]=useState<View>('daily');
  const page=useMemo(()=>({daily:<Daily onNavigate={setView}/>,plan:<Plan onNavigate={setView}/>,inventory:<Inventory/>,ads:<Ads/>,review:<Review/>,catalog:<Catalog/>,sources:<Sources/>})[view],[view]);
  return <div className="app"><ShellHeader active={view} onNavigate={setView}/><main>{page}</main><footer><span>Wayfair AI 运营中台 · 个人测试阶段</span><span>写操作均保留确认与审计</span></footer></div>;
}
