
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
