(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const text = (s, v) => { const el=$(s); if(el) el.textContent = v == null || v === '' ? '--' : String(v); };
  const num = (v, digits=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '--';
  const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v)>0?'+':''}${Number(v).toFixed(2)}%` : '暂无';
  const date = $('#trade-date');
  const updateClock = () => { if(date) date.textContent = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' · A股行情'; };
  updateClock(); window.setInterval(updateClock,1000);
  async function get(url) { const r=await fetch(url,{credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'}); if(!r.ok) throw new Error(`${url} HTTP ${r.status}`); return r.json(); }
  function pickNum(obj, keys) { for(const k of keys){ const v=obj?.[k]; if(v!==undefined && v!==null && Number.isFinite(Number(v))) return Number(v); } return null; }
  function renderMood(d) {
    const m=d?.mood||{}; const score=pickNum(m,['score','value','moodScore']);
    text('#mood-score',score===null?'--':Math.round(score));
    text('#mood-label',m.verdict||m.advice||m.mood||'情绪数据已载入');
    text('#market-verdict',m.verdict||m.advice||'市场状态待判断');
    text('#market-why',m.why||m.note||`上涨 ${m.upN??'--'} · 下跌 ${m.downN??'--'} · 涨停 ${m.ztN??'--'}`);
    const zt=d?.ztPool?.count; text('#risk-zt',zt==null?'待计算':`${zt} 家`); text('#risk-zt-desktop',zt==null?'待计算':`${zt} 家`);
    text('#risk-asof',d?.ready?'行情服务已就绪':d?.isSnapshot?`历史快照 ${d.snapshotDay||''}`:'行情服务未就绪');
  }
  function renderPicks(d) {
    const items=Array.isArray(d?.items)?d.items:[];
    text('#pick-count',d?.count ?? items.length);
    text('#focus-count',items.filter(x=>Number(x.score??x.finalScore)>=80).length);
    text('#research-count',items.filter(x=>x.pass===true || x.status==='research').length);
    text('#blocked-count',items.filter(x=>x.blocked===true || x.risk?.blocked===true).length);
    const body=$('#ranking-body'); if(!body)return;
    if(!items.length){ body.innerHTML='<tr><td colspan="10">当前没有可展示的选股结果；请检查行情采集和策略扫描状态</td></tr>'; text('#chart-state','暂无候选股K线'); return; }
    const rows=items.slice(0,12); body.innerHTML=rows.map((x,i)=>{
      const code=String(x.code||x.symbol||'').replace(/[^0-9]/g,'').slice(0,6); const name=String(x.name||code||'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const price=pickNum(x,['price','last','close']); const change=pickNum(x,['pct','changePct','change']); const score=pickNum(x,['score','finalScore']); const reasonList=Array.isArray(x.hit)?x.hit.map(h=>typeof h==='string'?h:h.text).filter(Boolean):Array.isArray(x.reasons)?x.reasons:[]; const reasons=reasonList.slice(0,2).join('、')||'命中条件详见研究页'; const source=String(x.strategy||x.source||'量化选股'); const risk=String(x.riskLevel||x.risk?.level||'待评估');
      return `<tr data-code="${code}"><td>${i+1}</td><td>${code||'--'}</td><td>${name}</td><td>${price===null?'--':num(price)}</td><td>${pct(change)}</td><td>${score===null?'--':num(score,1)}</td><td>${reasons||'待解释'}</td><td>${source}</td><td>${risk}</td><td><a href="/research.html">研究</a></td></tr>`;
    }).join('');
    text('#risk-candidates',items.length); text('#risk-candidates-desktop',items.length);
    const first=rows.find(x=>/^\d{6}$/.test(String(x.code||x.symbol||'')));
    if(first) loadKline(String(first.code||first.symbol));
    body.querySelectorAll('tr[data-code]').forEach(tr=>tr.addEventListener('click',()=>loadKline(tr.dataset.code)));
  }
  function renderStrategy(d) {
    const items=Array.isArray(d?.items)?d.items:[]; const market=d?.market||{};
    const counts={rule14:0,bazi:0,gpt:0,python:0};
    for(const x of items){ const s=String(x.strategy||x.strategyName||'').toLowerCase(); if(s.includes('十四')||s.includes('14'))counts.rule14++; else if(s.includes('八字'))counts.bazi++; else if(s.includes('gpt'))counts.gpt++; else if(s.includes('python'))counts.python++; }
    for(const [k,v] of Object.entries(counts)){ const el=document.querySelector(`[data-strategy="${k}"]`); if(el)el.textContent=items.length?`${v} 条`: '无独立计数'; }
    if(items.length) text('#strategy-state',`策略引擎已返回 ${items.length} 条候选`);
    text('#risk-fresh',d?.updatedAt?new Date(d.updatedAt).toLocaleTimeString('zh-CN'):'未取得');
  }
  async function loadKline(code) {
    text('#chart-stock',`${code} · K线走势`); text('#chart-state','正在读取历史K线');
    try {
      const d=await get(`/api/kline?code=${encodeURIComponent(code)}&n=60`);
      if(!d?.ok||!Array.isArray(d.rows)||!d.rows.length) throw new Error(d?.error||'暂无K线数据');
      const rows=d.rows; const vals=rows.map(x=>Number(x.close)).filter(Number.isFinite); if(!vals.length)throw new Error('K线收盘价无效');
      const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,w=640,h=220,step=w/rows.length;
      const ma=(period)=>rows.map((r,i)=>{const a=rows.slice(Math.max(0,i-period+1),i+1).map(z=>Number(z.close)).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;});
      const lines=[{v:ma(5),c:'#f3bd49'},{v:ma(10),c:'#48d8cf'},{v:ma(20),c:'#c77bf2'}];
      const grid=[0,1,2,3].map(i=>`<line x1="0" y1="${i*h/3}" x2="${w}" y2="${i*h/3}" stroke="#29425f" stroke-width="1"/>`).join('');
      const candles=rows.map((r,i)=>{const o=Number(r.open),c=Number(r.close),hi=Number(r.high),lo=Number(r.low);if(![o,c,hi,lo].every(Number.isFinite))return '';const y=v=>h-(v-min)/span*(h-12)-6;const up=c>=o;const x=i*step+step/2;return `<line x1="${x}" x2="${x}" y1="${y(hi)}" y2="${y(lo)}" stroke="${up?'#ed5266':'#18c78b'}"/><rect x="${x-step*.28}" y="${Math.min(y(o),y(c))}" width="${Math.max(2,step*.56)}" height="${Math.max(1,Math.abs(y(o)-y(c)))}" fill="${up?'#ed5266':'#18c78b'}"/>`;}).join('');
      const maLines=lines.map(l=>`<polyline fill="none" stroke="${l.c}" stroke-width="2" points="${l.v.map((v,i)=>v===null?'':`${i*step+step/2},${h-(v-min)/span*(h-12)-6}`).filter(Boolean).join(' ')}"/>`).join('');
      const chart=$('#chart-canvas'); if(chart)chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${code}日K线与MA均线" preserveAspectRatio="none">${grid}${candles}${maLines}</svg>`;
      const volume=$('#chart-volume'); if(volume){const maxV=Math.max(1,...rows.map(r=>Number(r.volume)||0));volume.innerHTML=rows.slice(-24).map(r=>`<i style="height:${Math.max(3,Math.round((Number(r.volume)||0)/maxV*30))}px;background:${Number(r.close)>=Number(r.open)?'#ed5266':'#18c78b'}"></i>`).join('');}
      text('#chart-stock',`${d.name||code} (${code})`);text('#chart-state',`数据截至 ${d.asOf||'未知'} · ${rows.length}根`);
      const diag=$('#diagnosis-list'); if(diag){const last=rows[rows.length-1],prev=rows[rows.length-2];diag.innerHTML=`<li>趋势：${Number(last.close)>=Number(last.open)?'当日收阳':'当日收阴'}，收盘 ${num(last.close)}</li><li>区间：最高 ${num(last.high)}，最低 ${num(last.low)}</li><li>成交量：${last.volume==null?'未提供':num(last.volume,0)}</li><li>均线：MA5 ${num(ma(5).at(-1))} · MA10 ${num(ma(10).at(-1))} · MA20 ${num(ma(20).at(-1))}</li><li>说明：仅作历史行情展示，不构成买卖指令。</li>`;}
    } catch(e){text('#chart-state',e.message||'K线读取失败');const c=$('#chart-canvas');if(c)c.textContent='暂无可验证的历史K线数据';}
  }
  async function refresh(){
    const jobs=await Promise.allSettled([get('/api/mobile-digest'),get('/api/quant-picks?max=12'),get('/api/strategy/dashboard')]);
    if(jobs[0].status==='fulfilled')renderMood(jobs[0].value);else text('#source-state','行情接口暂不可用：'+jobs[0].reason.message);
    if(jobs[1].status==='fulfilled')renderPicks(jobs[1].value);else {const b=$('#ranking-body');if(b)b.innerHTML='<tr><td colspan="10">选股数据接口暂不可用，请进入智能选股页检查服务状态</td></tr>';}
    if(jobs[2].status==='fulfilled')renderStrategy(jobs[2].value);
    for(const key of ['sh','sz','cyb','kc50']) { const node=document.querySelector(`[data-index-pct="${key}"]`); if(node && node.textContent==='等待行情接口') node.textContent='指数专用数据源未接入'; }
    text('#source-state',`数据源状态：行情摘要 ${jobs[0].status==='fulfilled'?'已连接':'未连接'} · 选股 ${jobs[1].status==='fulfilled'?'已连接':'未连接'} · 策略 ${jobs[2].status==='fulfilled'?'已连接':'未连接'}；价格与信号以接口返回为准`);
  }
  refresh(); window.setInterval(refresh,60000);
})();
