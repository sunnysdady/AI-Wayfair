"use client";

import { useMemo, useState } from "react";

type View = "daily" | "plan" | "inventory" | "ads" | "review" | "catalog" | "sources";

const NAV: { id: View; label: string; meta: string }[] = [
  { id: "daily", label: "日报", meta: "今天" },
  { id: "plan", label: "运营计划", meta: "本月" },
  { id: "inventory", label: "库存更新", meta: "Gate" },
  { id: "ads", label: "广告优化", meta: "每周" },
  { id: "review", label: "月度复盘", meta: "13" },
  { id: "catalog", label: "商品数据", meta: "V2" },
  { id: "sources", label: "数据源", meta: "6/7" },
];

const revenue = [17822, 9220, 9200, 13860, 6641, 9499];
const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月"];
const adRows = [
  ["DMOM1025", "暂停 Listing", "ROAS 0.00× · 0 单", "通过", "待审批"],
  ["DMOM1029", "调整 Listing Bid", "ROAS 4.14× · 2 单", "警戒", "暂缓"],
  ["DMOM1000", "暂停 Listing", "ROAS 0.00× · 0 单", "通过", "待审批"],
  ["DMOM1017", "调整 Listing Bid", "ROAS 2.94× · 3 单", "通过", "待审批"],
  ["DMOM1022", "调整 Listing Bid", "ROAS 1.39× · 1 单", "通过", "待审批"],
];
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
  return <>
    <Hero eyebrow="WAYFAIR PARTNER · DAILY OPERATING BRIEF" title="今日运营简报" text="2026-07-16 · 销售业绩、邮件摘要和运营待办" side={<div className="hero-side"><b>中高</b><span>今日运营关注度</span></div>} />
    <section className="stat-grid four">
      {[["$9,499", "营收", "+44% 环比"], ["85", "订单", "+57% 环比"], ["3,964", "Sessions", "+33% 环比"], ["2.80%", "CVR", "+90% 环比"]].map(([value,label,note]) => <article className="stat" key={label}><strong>{value}</strong><span>{label}</span><small>{note}</small></article>)}
    </section>
    <section className="cadence">
      <button onClick={() => onNavigate("daily")}><b>今日</b><span>经营与邮件</span><small>1 项中台待办</small></button>
      <button onClick={() => onNavigate("ads")}><b>本周</b><span>广告优化</span><small>35 项建议待处理</small></button>
      <button onClick={() => onNavigate("review")}><b>本月</b><span>经营复盘</span><small>13 份证据已归档</small></button>
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
    <section className="card sales-card"><div className="section-head"><div><span>SALES PERFORMANCE</span><h2>2026-06 经营表现</h2></div><b>订单毛利 $3,128 · 28.26%</b></div><div className="sales-layout"><div><h3>营收增长 44.4%，转化改善是主要驱动。</h3><p>广告调整不会由日报触发，统一进入周度优化。</p></div><div className="bars">{revenue.map((value,index)=><div key={value}><span>${value.toLocaleString()}</span><i style={{height:`${value / Math.max(...revenue) * 100}%`}}></i><b>{monthLabels[index]}</b></div>)}</div></div></section>
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
  const [tab,setTab]=useState<'week'|'month'>('week'); const [start,setStart]=useState('2026-06-01'); const [end,setEnd]=useState('2026-06-30'); const [message,setMessage]=useState('当前载入 2026-06-01 → 2026-06-30'); const [approved,setApproved]=useState<string[]>([]);
  return <><Hero eyebrow="WEEKLY OPTIMIZATION · MONTHLY REVIEW" title="广告优化" text="周维度生成建议、审批与复查；月维度进入经营复盘" side={<button className="hero-button" onClick={()=>setMessage('本周建议已根据经营 Gate 重新生成')}>生成本周建议</button>} />
    <section className="period-bar"><div><button className={tab==='week'?'active':''} onClick={()=>setTab('week')}>周优化</button><button className={tab==='month'?'active':''} onClick={()=>setTab('month')}>月度广告复盘</button></div><label>开始<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button onClick={()=>setMessage(`已创建 ${start} → ${end} 的官方报表拉取任务`)}>拉取该周期</button><span>{message}</span></section>
    <section className="stat-grid five">{[["35","建议总数"],["10","暂缓执行"],["25","待审批"],["0","已批准"],["1.0.0","规则版本"]].map(x=><article className="stat" key={x[1]}><strong>{x[0]}</strong><span>{x[1]}</span></article>)}</section>
    <section className="card table-card"><div className="section-head"><div><span>AI RECOMMENDATION LEDGER</span><h2>{tab==='week'?'本周动作账本':'月度广告表现'}</h2></div><b>不会自动执行</b></div><div className="data-table ad-table"><div className="thead"><span>对象</span><span>建议动作</span><span>核心证据</span><span>安全检查</span><span>状态</span><span></span></div>{adRows.map(row=><div key={row[0]}>{row.map((cell,i)=><span key={i} className={i===3?cell==='通过'?'good':'warn':''}>{i===4&&approved.includes(row[0])?'已批准':cell}</span>)}<button disabled={approved.includes(row[0])||row[3]==='警戒'} onClick={()=>setApproved([...approved,row[0]])}>审批</button></div>)}</div></section>
  </>;
}

function Review() {
  const [report,setReport]=useState(0); const reports=["8月150单完整增长 Playbook","2026年6月月度复盘总览","店铺诊断：6月增长成立","SKU 广告执行清单","类目对标与主图替代"];
  return <><Hero eyebrow="MONTHLY REVIEW · NEXT PLAN" title="月度复盘" text="经营事实、广告月复盘、执行证据与下月计划" side={<button className="hero-button">补充复盘资料</button>} />
    <div className="review-grid"><aside className="card report-list"><div><span>EVIDENCE LIBRARY</span><h2>复盘资料</h2><b>13</b></div>{reports.map((x,i)=><button className={report===i?'active':''} onClick={()=>setReport(i)} key={x}><strong>{x}</strong><small>2026/07/15 · {i===0?'57':'35'} KB</small></button>)}</aside><article className="card report-native"><header><span>PLAYBOOK</span><h2>{reports[report]}</h2><p>150单拆到 SKU、Listing、周节奏和广告预算；Conditional Offers 只是其中一个模块。</p></header><div className="report-metrics">{[["月度目标","150 单"],["基础预算","$1,800"],["预算上限","$2,500"],["放量 ROAS","≥ 4.0×"],["Fill Rate","≥ 95%"]].map(x=><div key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong></div>)}</div><div className="report-sections">{reportSections.map(x=><section key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p></section>)}</div></article></div>
  </>;
}

function Catalog() {
  const [query,setQuery]=useState(''); const rows=[['DMOM1021','LIVE','Sofa','0','1'],['DMOM1022','LIVE','Accent Chairs','0','2'],['DMOM1003','NOT LIVE','Tables','1','0'],['DMOM1017','LIVE','Storage','0','1']].filter(x=>x[0].includes(query.toUpperCase()));
  return <><Hero eyebrow="CATALOG READ V2" title="商品数据" text="Listing、商品状态与诊断信号，为库存和广告提供统一事实" side={<div className="hero-side"><b>已连接</b><span>Catalog Read V2</span></div>} /><section className="card catalog-card"><div className="filters"><label>Supplier Part #<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入 DMOM"/></label><label>商品状态<select><option>全部状态</option><option>LIVE</option><option>NOT LIVE</option></select></label><button className="primary">查询 Catalog</button></div><div className="data-table catalog-table"><div className="thead"><span>Listing</span><span>状态</span><span>类目</span><span>问题</span><span>机会</span></div>{rows.map(row=><div key={row[0]}>{row.map((cell,i)=><span key={i} className={i===1?(cell==='LIVE'?'good':'bad'):''}>{cell}</span>)}</div>)}</div></section></>;
}

function Sources() {
  const sources=[['Outlook 邮件日报','已同步','2026-07-16'],['店铺经营数据','已同步','2026-06'],['库存 Ops API','生产','凭证已配置'],['Advertising API','生产','凭证已配置'],['Catalog Read V2','生产','双版本权限'],['月度报告资料库','已同步','13 份报告'],['订单明细 API','待开通','利润精算所需']];
  return <><Hero eyebrow="DATA SOURCES · PERMISSION CONTROL" title="数据源" text="统一管理连接状态、数据周期与写入权限" /><div className="source-grid">{sources.map((x,i)=><article className="card source-card" key={x[0]}><span className={i===6?'waiting':'connected'}>{x[1]}</span><h2>{x[0]}</h2><p>{x[2]}</p><small>{i===6?'建议下一步开通订单读取权限':'连接健康'}</small></article>)}</div></>;
}

export default function OpsCenter() {
  const [view,setView]=useState<View>('daily');
  const page=useMemo(()=>({daily:<Daily onNavigate={setView}/>,plan:<Plan onNavigate={setView}/>,inventory:<Inventory/>,ads:<Ads/>,review:<Review/>,catalog:<Catalog/>,sources:<Sources/>})[view],[view]);
  return <div className="app"><ShellHeader active={view} onNavigate={setView}/><main>{page}</main><footer><span>Wayfair AI 运营中台 · 个人测试阶段</span><span>写操作均保留确认与审计</span></footer></div>;
}
