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
.wf-side{gap:8px}.wf-side a{padding:6px 10px;font-size:13px;font-weight:700}.wf-nav-label{margin:8px 8px 3px}.wf-side .wf-dot{width:7px;height:7px}
.wf-nav-root{display:grid;gap:4px}.wf-nav-group{border:1px solid transparent;border-radius:10px}.wf-nav-group[open]{background:#f8fafc;border-color:#edf1f7}.wf-nav-group summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#667085;font-size:12px;font-weight:900;padding:7px 9px;border-radius:9px;-webkit-user-select:none;user-select:none}.wf-nav-group summary::-webkit-details-marker{display:none}.wf-nav-group summary:after{content:"▾";font-size:10px;color:#98a2b3;transition:transform .16s ease}.wf-nav-group:not([open]) summary:after{transform:rotate(-90deg)}.wf-nav-group nav{display:grid;gap:2px;padding:0 5px 7px}.wf-nav-group a{padding:6px 8px 6px 16px}.wf-nav-group .wf-dot{width:5px;height:5px}
.wf-content .clause-list{margin:3px 0 0!important;padding-left:15px!important}.wf-content .clause-list li{margin:0 0 3px;font-size:13px;line-height:1.45;font-weight:400}
.wf-content details.clause-more{margin-top:2px}.wf-content details.clause-more summary{cursor:pointer;color:#175cd3;font-size:12px;font-weight:700;list-style:none;-webkit-user-select:none;user-select:none}.wf-content details.clause-more summary::-webkit-details-marker{display:none}.wf-content details.clause-more summary:before{content:"+ "}.wf-content details.clause-more[open] summary:before{content:"− "}
.wf-content b.lead{display:block;margin-bottom:2px;font-size:13px;line-height:1.45}
.wf-content .kpi-note{color:#667085;font-size:12px;line-height:1.5}
.wf-content .state-btn:after{content:"▾";font-size:10px;margin-left:4px;opacity:.55}
.wf-content .section{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 8px 24px rgba(16,24,40,.05)}
.wf-content .section>h2:first-child{display:flex;align-items:center;gap:8px}.wf-content .section>h2:first-child:before{content:"";width:5px;height:20px;border-radius:5px;background:var(--blue);display:inline-block}
.wf-content .card{background:#fbfcfe;border:1px solid #e4e9f2!important;border-radius:12px!important;padding:12px 14px}
.wf-content .card .num{margin-bottom:2px}.wf-content .card b{display:block}.wf-content .card .small{color:#667085;font-size:12px}
.wf-content .linkcard{display:block;background:#fbfcfe;border:1px solid #e4e9f2;border-radius:12px;padding:12px 14px;text-decoration:none;color:#152033}
.wf-content .linkcard:hover{border-color:var(--blue);box-shadow:0 8px 20px rgba(40,112,232,.10)}
.wf-content .linkcard h3{margin:0 0 4px;font-size:14px}.wf-content .linkcard p{margin:0;color:#667085;font-size:12px}
.wf-content .meta{color:#667085;font-size:12px;margin:0 0 12px}
.wf-content .tag.red,.wf-content .pill.red{background:#fee4e2;color:#b42318}.wf-content .tag.amber,.wf-content .pill.amber,.wf-content .tag.todo{background:#fef0c7;color:#b54708}.wf-content .tag.blue,.wf-content .pill.blue{background:#dbeafe;color:#1d4ed8}.wf-content .tag.green,.wf-content .pill.green{background:#dcfce7;color:#166534}.wf-content .tag.gray,.wf-content .pill.gray{background:#f0f1f3;color:#475467}.wf-content .tag.purple,.wf-content .pill.purple{background:#f3e8ff;color:#6d28d9}
.wf-content .tag.keep{background:#dcfce7;color:#166534}.wf-content .tag.reduce{background:#fef0c7;color:#b54708}.wf-content .tag.stop{background:#fee4e2;color:#b42318}.wf-content .tag.repair{background:#dbeafe;color:#1d4ed8}
.wf-content .pill.S{background:#0f766e;color:#fff}.wf-content .pill.A{background:#dcfce7;color:#166534}.wf-content .pill.B{background:#dbeafe;color:#1d4ed8}.wf-content .pill.C{background:#fef0c7;color:#b54708}.wf-content .pill.N{background:#f0f1f3;color:#475467}
.wf-content .pill.low{background:#fee4e2;color:#b42318}.wf-content .pill.mid{background:#fef0c7;color:#b54708}.wf-content .pill.high{background:#dcfce7;color:#166534}
.wf-content .card.ok{border-left:4px solid #23b887!important}.wf-content .card.bad{border-left:4px solid #ef5b45!important}
.wf-content .tablebox{margin:10px 0}
.wf-content .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:10px 0}
.wf-content .note{border-left:4px solid #f0a331;background:#fff8ed;border-radius:0 10px 10px 0;padding:10px 12px;margin:10px 0}
.wf-content .muted{color:#667085}
.wf-content .section-note{color:#667085;font-size:13px;margin:6px 0 12px}
.wf-content .legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;color:#475467;font-size:12px;font-weight:700;margin:8px 0}
.wf-content .legend .dot,.wf-content .legend i{display:inline-block;width:9px;height:9px;border-radius:99px;margin-right:5px;vertical-align:-1px}
.wf-content .dot.red,.wf-content .bar.red{background:#ef5b45}.wf-content .dot.amber,.wf-content .bar.amber{background:#f0a331}.wf-content .dot.blue,.wf-content .bar.blue{background:#2870e8}.wf-content .dot.green,.wf-content .bar.green{background:#23b887}.wf-content .dot.purple,.wf-content .bar.purple{background:#8b5cf6}
.wf-content a.card{text-decoration:none;color:inherit}.wf-content .card.jump:hover{border-color:var(--blue)!important;box-shadow:0 8px 20px rgba(40,112,232,.10)}
.wf-content .card .link,.wf-content .card a.link{display:inline-block;font-weight:700;margin:2px 0}
.wf-content .exec-date{color:#98a2b3;font-size:11px;margin-top:3px}
.wf-content .clause-wrap{margin:6px 0}
.wf-content .barrow{display:grid;grid-template-columns:150px 1fr 92px;gap:10px;align-items:center;margin:7px 0;font-size:13px}
.wf-content .barrow .small{text-align:right}
.wf-content .lane{position:relative;height:13px;background:#eef2f7;border-radius:99px;overflow:hidden}
.wf-content .lane>.bar{position:absolute;top:0;height:100%;border-radius:99px;background:#2870e8}
.wf-content .days{display:flex;margin:4px 0 8px;padding:0 102px 0 160px}
.wf-content .days span{flex:1;text-align:center;color:#98a2b3;font-size:10px}
.wf-content .card.kpi span{display:block;color:#667085;font-size:12px;font-weight:700}.wf-content .card.kpi b{font-size:22px}
.wf-data-alert{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;background:#fff8ed;border:1px solid #fed7aa;border-left:5px solid var(--amber);border-radius:14px;padding:14px 16px;margin:0 0 16px;color:#344054}.wf-data-alert b{display:block;color:#92400e}.wf-data-alert .stamp{font-size:24px;font-weight:950;color:#b54708}.wf-data-alert p{margin:0 0 6px}.wf-data-alert ul{margin:6px 0 0;padding-left:18px}.wf-data-alert li{margin:2px 0}@media(max-width:680px){.wf-data-alert{grid-template-columns:1fr}.wf-data-alert .stamp{font-size:20px}}
.wf-content .upload-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))!important;gap:12px!important;margin:10px 0}.wf-content .upload-card{background:#fbfcfe;border:1px solid #e4e9f2;border-radius:12px;padding:14px;display:grid;gap:9px}.wf-content .upload-card h3{margin:0;font-size:16px}.wf-content .upload-card small{color:#667085}.wf-content .upload-card input{width:100%;border:1px solid #d8e0ec;border-radius:9px;background:#fff;padding:8px}.wf-content .upload-meta{min-height:22px;color:#166534;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wf-content .freq{display:inline-flex;align-items:center;justify-self:start;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:900;background:#dbeafe;color:#1d4ed8}.wf-content .freq.week{background:#dcfce7;color:#166534}.wf-content .freq.month{background:#fef0c7;color:#b54708}.wf-content .freq.need{background:#f0f1f3;color:#475467}.wf-content .upload-actions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.wf-content .upload-actions button,.wf-content .upload-actions a{border:0;border-radius:10px;padding:10px 13px;font-weight:900;text-decoration:none;cursor:pointer}.wf-content .upload-actions button{background:#152033;color:#fff}.wf-content .upload-actions a{background:#eef4ff;color:#175cd3}.wf-content .route-list{display:grid;gap:8px}.wf-content .route-list a{display:flex;justify-content:space-between;gap:10px;background:#fff;border:1px solid #e4e9f2;border-radius:10px;padding:9px 11px;text-decoration:none;color:#152033}.wf-content .route-list span{color:#667085;font-size:12px}.wf-content .status-box{background:#f8fafc;border:1px solid #e4e9f2;border-radius:12px;padding:12px;white-space:pre-wrap;color:#344054}
.wf-content td:empty:before{content:"—";color:#c6cfdd}
a.wf-search{text-decoration:none}
@media(max-width:1100px){.wf-side{display:flex!important;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;gap:6px;padding:10px 12px;border-right:0;border-bottom:1px solid var(--line)}.wf-brand,.wf-nav-label,.wf-side-foot{display:none}.wf-nav-root,.wf-nav-group nav{display:flex;flex-direction:row;gap:4px}.wf-nav-group{display:flex;background:transparent!important;border:0!important}.wf-nav-group summary{white-space:nowrap;background:#eef4ff;color:#175cd3}.wf-nav-group summary:after{display:none}.wf-side a{white-space:nowrap;padding:6px 9px}}
"""

TASK_JS = """
(function(){
  var GEN=window.WF_TASKS_GEN||'';
  var STATES=['待执行','执行中','已执行','暂缓'];
  var CLS={'待执行':'tag amber','执行中':'tag blue','已执行':'tag green','暂缓':'tag gray'};
  var KEY=function(id){return 'wf2:'+id;};
  var currentFilter='all';
  function load(id){
    try{
      var obj=JSON.parse(localStorage.getItem(KEY(id)))||{};
      if(obj.gen&&GEN&&obj.gen!==GEN) return {};  // 旧版清单的标记不再展示，避免错位误导
      return obj;
    }catch(e){return {};}
  }
  function save(id,obj){try{localStorage.setItem(KEY(id),JSON.stringify(obj));}catch(e){alert('保存失败：浏览器存储不可用（隐私模式或空间已满），本次标记不会保留。');}}
  function applyRow(row,st){
    var btn=row.querySelector('.state-btn');
    if(!btn)return;
    var s=st.status||'待执行';
    btn.textContent=s; btn.className='state-btn '+(CLS[s]||'tag gray');
    btn.title='点击切换：待执行 → 执行中 → 已执行 → 暂缓';
    row.dataset.state=s;
    var d=row.querySelector('.exec-date');
    if(d) d.textContent=st.date||'';
  }
  function rows(){return document.querySelectorAll('tr[data-task-id]');}
  function updateProgress(){
    var done=0,n=0;
    rows().forEach(function(r){n++;if(r.dataset.state==='已执行')done++;});
    var dc=document.getElementById('done-count'); if(dc) dc.textContent=done;
    var tc=document.getElementById('total-count'); if(tc) tc.textContent=n;
    var bar=document.getElementById('progress-bar'); if(bar) bar.style.width=(n?Math.round(done/n*100):0)+'%';
  }
  function filterRows(f){
    currentFilter=f;
    rows().forEach(function(r){
      var show=f==='all'||f===r.dataset.priority||
        (f==='pending'&&r.dataset.state!=='已执行'&&r.dataset.state!=='暂缓')||
        (f==='done'&&r.dataset.state==='已执行')||
        (f==='defer'&&r.dataset.state==='暂缓');
      r.style.display=show?'':'none';
    });
  }
  document.addEventListener('DOMContentLoaded',function(){
    rows().forEach(function(row){
      var id=row.dataset.taskId;
      applyRow(row,load(id));
      var btn=row.querySelector('.state-btn');
      if(!btn)return;
      btn.addEventListener('click',function(){
        var next=STATES[(STATES.indexOf(row.dataset.state)+1)%STATES.length];
        var prev=load(id);
        var obj={status:next,date:next==='已执行'?new Date().toLocaleDateString('zh-CN'):(prev.date||''),gen:GEN};
        save(id,obj); applyRow(row,obj); updateProgress(); filterRows(currentFilter);
      });
    });
    updateProgress();
    document.querySelectorAll('.filt-btn[data-filter]').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('.filt-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active'); filterRows(btn.dataset.filter);
      });
    });
    var reset=document.getElementById('reset-progress');
    if(reset) reset.addEventListener('click',function(){
      if(!confirm('确定清空本页所有任务的执行进度吗？此操作不可恢复。'))return;
      rows().forEach(function(r){try{localStorage.removeItem(KEY(r.dataset.taskId));}catch(e){}});
      rows().forEach(function(r){applyRow(r,{});});
      updateProgress(); filterRows(currentFilter);
    });
    window.addEventListener('storage',function(e){
      if(!e.key||e.key.indexOf('wf2:')!==0)return;
      var id=e.key.slice(4);
      rows().forEach(function(r){if(r.dataset.taskId===id)applyRow(r,load(id));});
      updateProgress(); filterRows(currentFilter);
    });
  });
})();
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
    # latest dated file wins (filenames sort lexicographically by date suffix)
    files = sorted(REPORTS.glob("*.html"), reverse=True)
    for path in files:
        if all(n in path.name for n in needles):
            return "./" + path.name
    for path in files:
        src = text(path)
        title = extract_title(src, "")
        hay = path.name + "\n" + title
        if all(n in hay for n in needles):
            return "./" + path.name
    sys.exit(f"nav target not found, needles={needles} — 检查文件是否被改名/归档")


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
        match = re.search(
            r'<(?:main|div) id="content" class="wf-content">\s*(.*?)\s*</(?:main|div)>\s*(?:<p class="wf-footer-note"|</main>)',
            src, re.I | re.S,
        )
        if match:
            return match.group(1).strip()
        # a shelled page we cannot parse means the template/regex drifted;
        # falling back to <body> here would wrap the shell inside a new shell
        sys.exit("extract_body failed on an already-shelled page — 模板或正则漂移，禁止整 body 兜底")
    match = re.search(r"<body[^>]*>(.*?)</body>", src, re.I | re.S)
    return (match.group(1) if match else src).strip()


def context(title: str) -> tuple[str, str]:
    rules = [
        ("数据上传中心", ("Data intake", "按上传频率提交新数据，并进入对应工具和报告。")),
        ("每日库存生成", ("Inventory tool", "上传模板、映射表和领星库存，生成 Wayfair 每日库存文件。")),
        ("帮助中心", ("Help", "分类帮助和关键词查询。")),
        ("运营执行中心", ("Start here", "工作第一入口：本周必须先处理的 SKU、原因和动作。")),
        ("SKU任务清单", ("Task list", "按优先级聚合所有 SKU 运营动作。")),
        ("SKU经营档案", ("SKU profile", "单 SKU 的成本、库存、广告、促销和 Listing 证据。")),
        ("项目状态", ("Status brief", "项目状态、数据补齐进度和风险汇报。")),
        ("库存映射", ("Inventory check", "加预算、促销、补货前先确认库存和映射置信度。")),
        ("促销准入", ("Promotion gate", "决定哪些 SKU 可以促销、哪些要先修复。")),
        ("SKU价值", ("SKU value", "用历史订单、利润、评分、客诉、广告判断 SKU 价值。")),
        ("定价", ("Pricing health", "检查成本、售价、平台空间和提价风险。")),
        ("数据补齐", ("Data status", "确认数据已经收到、仍缺什么。")),
        ("WSP", ("Ads action", "关键词、Campaign、Product 层调整建议。")),
        ("甘特图", ("Timeline", "任务节奏和时间安排。")),
        ("口径", ("Calibration", "成本口径校准和防错规则。")),
        ("诊断", ("Diagnosis", "店铺问题、机会和风险。")),
        ("交接", ("Handoff", "接手流程和运营原则。")),
        ("护栏", ("Guardrails", "防止错误口径和误操作。")),
    ]
    for key, value in rules:
        if key in title.replace(" ", ""):
            return value
    return ("Report", "关键数据和执行建议已经按 Dashboard 内页重新整理。")


NAV_GROUPS: list[tuple[str, list[tuple[tuple[str, ...], str]]]] = [
    ("每日 / 高频", [
        (("数据上传中心",), "数据上传中心"),
        (("每日库存生成",), "每日库存生成"),
        (("库存映射",), "库存映射"),
        (("运营执行中心",), "执行中心"),
        (("SKU任务清单",), "任务清单"),
    ]),
    ("每周经营", [
        (("促销准入",), "促销准入"),
        (("WSP广告调整",), "广告调整"),
        (("WSP关键词",), "关键词调整"),
        (("SKU经营档案",), "SKU经营档案"),
        (("SKU价值分级",), "SKU价值分级"),
    ]),
    ("月度 / 复盘", [
        (("产品定价体检表",), "定价体检表"),
        (("ProductCatalog",), "Catalog定价"),
        (("评分评论",), "评分评论体检"),
        (("店铺诊断",), "店铺诊断"),
    ]),
    ("规则与背景", [
        (("数据补齐",), "数据补齐"),
        (("运营工作台",), "项目状态"),
        (("待办甘特图",), "待办甘特图"),
        (("操作护栏",), "操作护栏"),
        (("CostStack口径",), "口径校准"),
        (("店铺交接",), "店铺交接"),
        (("帮助中心",), "帮助中心"),
    ]),
]


def nav(current_name: str) -> str:
    def link(href: str, label: str) -> str:
        active = "active" if href != "#" and current_name in href else ""
        return f'<a class="{active}" href="{href}"><span class="wf-dot"></span>{html.escape(label)}</a>'

    parts = ['<nav class="wf-nav-root">' + link("../index.html", "Dashboard") + "</nav>"]
    for group_label, items in NAV_GROUPS:
        links = "\n".join(link(first_matching(*needles), label) for needles, label in items)
        open_attr = " open" if any(current_name in first_matching(*needles) for needles, _ in items) else ""
        parts.append(
            f'<details class="wf-nav-group"{open_attr}><summary>{html.escape(group_label)}</summary><nav>{links}</nav></details>'
        )
    return "\n".join(parts)


# KPI 单一事实来源：数据刷新时只改这里（index 与全部报告页共用）
KPI_AS_OF = "2026-06-05"
DATA_REFRESH_DATE = "2026-06-12"
DATA_REFRESH_WINDOW = "2026-06-06 至 2026-06-12"
KPIS = [
    ("5月", "有效 Cost Stack"),
    ("686", "库存明细行"),
    ("11", "A 级 SKU"),
    ("准入", "促销判断已生成"),
]


def kpi_section() -> str:
    cells = "".join(
        f'<div class="wf-kpi"><div class="value">{html.escape(v)}</div><span class="label">{html.escape(l)}</span></div>'
        for v, l in KPIS
    )
    return f'<section class="wf-kpis" title="数据截至 {KPI_AS_OF}">{cells}</section>'


def data_alert() -> str:
    return f"""<section class="wf-data-alert">
      <div><b>数据提醒</b><div class="stamp">需更新</div></div>
      <div><p>当前页面数据截至 <b>{KPI_AS_OF}</b>。截至 {DATA_REFRESH_DATE}，若要做本周执行、促销、补货或广告判断，需要补齐 <b>{DATA_REFRESH_WINDOW}</b> 的最新数据。</p>
      <ul><li>优先提交：有效 6月 Cost Stack、当前 active/upcoming 促销/折扣清单、最新库存、Listing Health、WSP Keyword/Targeting、6月订单与客诉扣款。</li><li>未补齐前，本页结论只代表 2026-06-05 版本，不建议直接当作 2026-06-12 的最新决策。</li></ul></div>
    </section>"""


def shell(title: str, body: str, filename: str) -> str:
    eyebrow, desc = context(title)
    exec_center = first_matching("运营执行中心")
    inventory = first_matching("库存映射")
    promo = first_matching("促销准入")
    help_page = first_matching("帮助中心")
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
    {nav(filename)}
    <div class="wf-side-foot"><b>Production</b><small>ai-wayfair.vercel.app</small></div>
  </aside>
  <main class="wf-main">
    <div class="wf-topbar"><a class="wf-search" href="{help_page}#help-q">搜索帮助、操作说明、口径规则…</a><div class="wf-top-actions"><span class="wf-chip">数据截至 {KPI_AS_OF}</span><a class="wf-chip" href="../index.html">返回 Dashboard</a><a class="wf-chip live" href="https://ai-wayfair.vercel.app">线上查看</a></div></div>
    <section class="wf-hero">
      <div class="wf-title-card"><div class="wf-eyebrow">{html.escape(eyebrow)}</div><h1>{html.escape(title)}</h1><div class="wf-actions"><a class="wf-btn primary" href="{exec_center}">执行中心</a><a class="wf-btn green" href="{inventory}">查库存</a><a class="wf-btn light" href="{promo}">促销准入</a></div></div>
      <aside class="wf-next-card"><h2>最短路径</h2><a href="{exec_center}"><span>1. 本周做什么</span><small>执行中心</small></a><a href="{inventory}"><span>2. 动手前查库存</span><small>库存映射</small></a><a href="{promo}"><span>3. 判断能不能促</span><small>促销准入</small></a></aside>
    </section>
    {kpi_section()}
    {data_alert()}
    <div id="content" class="wf-content">
{body}
    </div>
  </main>
</div></div>
<script src="./assets/dashboard-shell.js"></script>
</body>
</html>
"""


def index_nav() -> str:
    """index.html 侧栏与报告页共用同一份 NAV_GROUPS，消除导航双源。"""
    def link(href: str, label: str) -> str:
        return f'<a href="{href}"><span class="ndot"></span>{html.escape(label)}</a>'

    parts = [
        '      <nav class="side-section nav-root">\n'
        '        <a class="active" href="./index.html"><span><svg viewBox="0 0 24 24"><path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z"/></svg></span>Dashboard</a>\n'
        "      </nav>"
    ]
    for group_label, items in NAV_GROUPS:
        links = "\n        ".join(
            link("./reports/" + first_matching(*needles)[2:], label) for needles, label in items
        )
        parts.append(
            f'      <details class="side-section nav-group" open>\n        <summary>{html.escape(group_label)}</summary>\n        <nav>{links}</nav>\n      </details>'
        )
    return "\n".join(parts)


def patch_index() -> None:
    path = ROOT / "index.html"
    src = text(path)
    start, end = "<!-- WF-NAV-START -->", "<!-- WF-NAV-END -->"
    if start not in src or end not in src:
        sys.exit("index.html 缺少 WF-NAV-START/END 标记，无法生成侧栏")
    pre, rest = src.split(start, 1)
    _, post = rest.split(end, 1)
    path.write_text(pre + start + "\n" + index_nav() + "\n      " + end + post, encoding="utf-8")
    print("index.html sidebar regenerated from NAV_GROUPS")


def main() -> None:
    if not REPORTS.exists():
        print(f"reports not found: {REPORTS}", file=sys.stderr)
        sys.exit(1)
    assets = REPORTS / "assets"
    assets.mkdir(exist_ok=True)
    (assets / "dashboard-shell.css").write_text(CSS, encoding="utf-8")
    (assets / "dashboard-shell.js").write_text(JS, encoding="utf-8")
    (assets / "task-state.js").write_text(TASK_JS, encoding="utf-8")

    count = 0
    for path in sorted(REPORTS.glob("*.html")):
        if "项目导航" in path.name or "每日库存生成工具" in path.name:
            continue
        src = text(path)
        title = extract_title(src, path.stem)
        body = extract_body(src)
        path.write_text(shell(title, body, path.name), encoding="utf-8")
        count += 1
    print(f"dashboard shell applied to {count} report pages")
    patch_index()


if __name__ == "__main__":
    main()
