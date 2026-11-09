/* V6 read-only selection results. One cloud authority; never run scanner, trade or notify from a browser. */
(function(root){
'use strict';
const document=root.document;
if(!document||!document.getElementById('pickCards'))return;
const el=id=>document.getElementById(id);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const numeric=(r,names)=>{for(const k of names){if(finite(r?.[k]))return r[k];}return null;};
const codeOf=r=>{const s=String(r?.code??r?.symbol??'');return /^\d{6}$/.test(s)?s:null;};
const dateText=v=>{
 if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=Date.now())return new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:[ T].{1,25})?$/.test(v))return v.slice(0,25);
 return null;
};
const reasonsOf=r=>{
 const hits=Array.isArray(r?.hit)?r.hit:[];
 const reasons=hits.map(x=>typeof x==='string'?x:typeof x?.text==='string'?x.text:null)
  .filter(x=>typeof x==='string'&&x.trim()).slice(0,12);
 if(reasons.length)return reasons.map(s=>s.slice(0,240));
 if(Array.isArray(r?.reasons))return r.reasons.filter(x=>typeof x==='string'&&x.trim()).slice(0,12).map(x=>x.slice(0,240));
 if(typeof r?.reason==='string'&&r.reason.trim())return [r.reason.slice(0,240)];
 if(Array.isArray(r?.hitIds)&&r.hitIds.length)return r.hitIds.filter(n=>Number.isInteger(n)||typeof n==='string'&&/^[\w-]{1,32}$/.test(n)).slice(0,12).map(id=>'条件编号 '+String(id)+'（暂无解释文本）');
 return [];
};
function riskInfo(r){
 const blocked=r?.blocked===true||r?.risk?.blocked===true||r?.pass===false;
 const level=[r?.riskLevel,r?.risk?.level,r?.risk].find(v=>typeof v==='string'&&v.trim());
 return {blocked,text:blocked?'存在阻断 · 需核对':level?level.slice(0,80):'风险状态未核验'};
}
function quoteProof(r){
 const at=r?.quoteAt,src=r?.quoteSource;
 if(!Number.isSafeInteger(at)||at<=0||typeof src!=='string'||!src.trim())return '报价原始时点或来源未知 · 非实时认证';
 if(at>Date.now())return '报价原始时点异常 · 不可视为实时';
 return '报价快照 '+dateText(at)+' · 来源 '+src.slice(0,65)+' · 未认证实时性';
}
function normalizedRecord(r,key){
 if(!r||typeof r!=='object'||Array.isArray(r)||!codeOf(r))return null;
 return {key,code:codeOf(r),name:typeof r.name==='string'&&r.name.trim()?r.name.trim().slice(0,80):codeOf(r),
  price:numeric(r,['price','last','close']),pct:numeric(r,['pct','changePct','change']),
  score:numeric(r,['score','finalScore']),sector:typeof r.sector==='string'&&r.sector.trim()?r.sector.trim().slice(0,70):null,
  reasons:reasonsOf(r),risk:riskInfo(r),source:typeof (r.strategy||r.strategyName||r.source)==='string'?(r.strategy||r.strategyName||r.source).slice(0,100):null,
  proof:quoteProof(r),raw:r};
}
const price=v=>v===null?'—':v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=v=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
let entries=[],selectedKey=null,mode='all',query='',sort='original',busy=false,hadResponse=false,seq=0,abortKline=null;
function listForDisplay(){
 let rows=entries.filter(r=>mode==='hit'?r.reasons.length>0:mode==='risk'?r.risk.blocked||r.risk.text!=='风险状态未核验':true);
 const needle=query.toLowerCase();
 if(needle)rows=rows.filter(r=>[r.code,r.name,r.sector||'',...r.reasons].some(v=>v.toLowerCase().includes(needle)));
 if(sort!=='original'){const metric=r=>sort==='score'?r.score:r.pct;
  rows=rows.slice().sort((a,b)=>(metric(b)??-Infinity)-(metric(a)??-Infinity)||a.key-b.key);
 }
 return rows;
}
function renderList(){
 const visible=listForDisplay();
 el('resultSummary').textContent='显示 '+visible.length+' 只 · 仅展示本次云端已返回且代码有效的候选 · 原始排序和评分不重算';
 el('pickCards').innerHTML=visible.length?visible.map((r,i)=>{
  const selected=r.key===selectedKey,signal=r.reasons[0]||'尚无可核验的命中条件';
  return '<button type="button" class="stock'+(selected?' is-selected':'')+'" data-pick="'+r.key+'" aria-pressed="'+selected+'" aria-label="查看'+escape(r.name)+' '+r.code+'选股详情">'+
   '<span class="rank">'+(i+1)+'</span><span class="stock-main"><span class="name"><b>'+escape(r.name)+'</b><small>'+r.code+'</small></span>'+
   '<span class="tags">'+(r.sector?'<span class="tag">'+escape(r.sector)+'</span>':'')+
   (r.reasons.length?'<span class="tag good">命中依据 '+r.reasons.length+' 条</span>':'<span class="tag">理由待核验</span>')+
   '<span class="tag'+(r.risk.blocked?' warn':'')+'">'+escape(r.risk.text)+'</span></span>'+
   '<span class="cause">'+escape(signal)+'</span></span>'+
   '<span class="quote" title="'+escape(r.proof)+'"><strong class="'+(r.pct===null?'unknown':r.pct>=0?'up':'down')+'">'+price(r.price)+'</strong><small class="'+(r.pct===null?'unknown':r.pct>=0?'up':'down')+'">'+pct(r.pct)+'</small></span></button>';
 }).join(''):'<p class="empty">'+(hadResponse?'当前筛选下没有符合条件的已返回股票。不会显示虚构候选。':'尚无可用数据，请检查云端选股服务。')+'</p>';
}
function clearDetail(message){
 el('detailStatus').textContent='未选中';
 el('detailBody').innerHTML='<p class="empty">'+escape(message)+'</p>';
 el('chartCanvas').innerHTML='<span class="tiny">未取得真实历史 K 线</span>';
 el('chartAsOf').textContent='未载入';
}
function showDetail(r,{scroll=false,loadChart=true}={}){
 selectedKey=r.key;
 el('detailStatus').textContent='当前股票 · '+r.code;
 const risks=r.risk.blocked?'此记录存在明确的风险或阻断标识，禁止将其当成可以买入的信号':r.risk.text;
 el('detailBody').innerHTML=
  '<div class="detailtitle"><strong>'+escape(r.name)+'</strong><small>'+r.code+(r.sector?' · '+escape(r.sector):'')+'</small></div>'+
  '<div class="factgrid"><div class="fact"><span>快照价格（未认证实时）</span><b>'+price(r.price)+'</b></div><div class="fact"><span>涨跌幅（来源未认证）</span><b>'+pct(r.pct)+'</b></div><div class="fact"><span>原系统综合评分</span><b>'+(r.score===null?'待返回':r.score.toFixed(1))+'</b></div><div class="fact"><span>服务端归属</span><b>'+escape(r.source||'归属未返回')+'</b></div></div>'+
  '<div class="reasons"><h3>命中条件 · '+r.reasons.length+' 条</h3>'+
   (r.reasons.length?'<ul>'+r.reasons.map(v=>'<li>'+escape(v)+'</li>').join('')+'</ul>':
     '<p class="tiny">接口未返回可核验的入选理由。不能因为有评分就称某套战法已经命中。</p>')+'</div>'+
  '<div class="reasons risks"><h3>风险与数据时点</h3><ul><li>'+escape(risks)+'</li><li>'+escape(r.proof)+'</li><li>命中条目可能属于同一研究家族，不自动重复加权。</li></ul></div>';
 renderList();
 if(scroll){el('stockDetail').scrollIntoView({behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
 if(loadChart)loadKline(r.code);
}
function renderChart(rows){
 const bars=rows.filter(r=>r&&[r.open,r.high,r.low,r.close].every(finite)&&r.low>0&&r.high>=Math.max(r.open,r.close,r.low)&&r.low<=Math.min(r.open,r.close)).slice(-45);
 if(bars.length<3){el('chartCanvas').innerHTML='<span class="tiny">有效历史 K 线不足，无法绘图</span>';return;}
 const w=620,h=235,l=12,right=53,top=12,bottom=205;
 const lo=Math.min(...bars.map(r=>r.low)),hi=Math.max(...bars.map(r=>r.high)),range=hi-lo||1,step=(w-l-right)/bars.length;
 const y=v=>bottom-(v-lo)/range*(bottom-top);
 const candles=bars.map((b,i)=>{const x=l+step*(i+.5),color=b.close>=b.open?'#ff6478':'#30deab',cy=Math.min(y(b.open),y(b.close)),bh=Math.max(1,Math.abs(y(b.open)-y(b.close)));
 return '<line x1="'+x+'" y1="'+y(b.high)+'" x2="'+x+'" y2="'+y(b.low)+'" stroke="'+color+'"/><rect x="'+(x-step*.28)+'" y="'+cy+'" width="'+Math.max(1.5,step*.56)+'" height="'+bh+'" fill="'+color+'"/>';}).join('');
 const grid=[0,.25,.5,.75,1].map(p=>{const yy=top+(bottom-top)*p;return '<line x1="'+l+'" y1="'+yy+'" x2="'+(w-right)+'" y2="'+yy+'" stroke="#244869" stroke-opacity=".6"/>';}).join('');
 const labels=[lo,(lo+hi)/2,hi].map(v=>'<text x="'+(w-right+6)+'" y="'+(y(v)+4)+'" fill="#9fb6cd" font-size="11">'+v.toFixed(2)+'</text>').join('');
 el('chartCanvas').innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="实际返回的'+bars.length+'根历史日K线，未认证为实时">'+grid+candles+labels+'</svg>';
}
async function loadKline(code){
 const current=++seq;
 if(abortKline)abortKline.abort();
 abortKline=new AbortController();
 el('chartAsOf').textContent=code+' · 读取中';
 el('chartCanvas').innerHTML='<span class="tiny">正在读取历史 K 线（不重新选股）</span>';
 try{
 const r=await fetch('/api/kline?code='+encodeURIComponent(code)+'&n=60',{credentials:'same-origin',cache:'no-store',signal:abortKline.signal,headers:{accept:'application/json'}});
 if(current!==seq)return;
 if(!r.ok)throw new Error(r.status===401||r.status===403?'没有权限读取历史K线':'历史K线暂不可用');
 const d=await r.json();if(current!==seq)return;
 if(d?.simulated===true||d?.isMock===true||d?.ok===false)throw new Error('行情服务没有返回已核验的历史K线');
 el('chartAsOf').textContent=(dateText(d.asOf)||'时点未注明')+' · 历史参考';
 renderChart(Array.isArray(d.rows)?d.rows:[]);
 }catch(e){if(current!==seq||e?.name==='AbortError')return;el('chartAsOf').textContent='不可用';el('chartCanvas').innerHTML='<span class="tiny">'+escape(e?.message||'K线网络异常')+'</span>';}
}
function applyResponse(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||d.locked===true||d.simulated===true||d.isMock===true||!Array.isArray(d.items)){
  throw new Error(d?.locked?'访问受限 · 请使用已授权身份':'云端尚未返回有效选股结果');
 }
 const prior=entries.find(x=>x.key===selectedKey);
 entries=d.items.slice(0,100).map((x,i)=>normalizedRecord(x,i)).filter(Boolean);
 hadResponse=true;
 const reported=Number.isSafeInteger(d.count)&&d.count>=0?d.count:null;
 el('totalVisible').textContent=String(entries.length);
 el('totalReported').textContent=reported===null?'已返回的候选记录':('接口报告总数 '+reported+' 只');
 el('hitCount').textContent=String(entries.filter(r=>r.reasons.length>0).length);
 el('riskCount').textContent=String(entries.filter(r=>r.risk.blocked).length);
 const at=dateText(d.asOf||d.snapshotDay);
 el('snapshotDay').textContent=at?at.slice(0,10):'时点未知';
 el('snapshotHint').textContent='选股扫描日期 · 非行情原始时点';
 el('listSource').textContent='只读云端结果';
 const requestedCode=typeof root.location?.search==='string'?new URLSearchParams(root.location.search).get('code'):null;
 const chosen=prior&&entries.find(r=>r.code===prior.code&&r.name===prior.name)||entries.find(r=>r.code===requestedCode)||entries[0];
 if(chosen){
  // Quiet background refresh must preserve selected stock and scroll position.
  const changed=!prior||prior.code!==chosen.code;
  showDetail(chosen,{loadChart:changed});
 }else{selectedKey=null;renderList();clearDetail('云端返回空选股池。没有命中股票可展示。');}
}
async function refresh(){
 if(busy||document.hidden)return;
 busy=true;el('refreshPicks').disabled=true;el('cloudStatus').textContent='正在读取云端已缓存的选股结果（不会强制扫描）…';
 try{
  const r=await fetch('/api/quant-picks?max=100',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
  if(r.status===401||r.status===403){entries=[];selectedKey=null;hadResponse=false;el('totalVisible').textContent='—';el('totalReported').textContent='需要授权';el('hitCount').textContent='—';el('riskCount').textContent='—';el('snapshotDay').textContent='不可用';el('snapshotHint').textContent='权限失效';renderList();clearDetail('访问权限已失效，请回到首页重新验证');throw new Error('没有查看候选池的权限');}
  if(!r.ok)throw new Error('云端选股接口不可用 · HTTP '+r.status);
  const d=await r.json();applyResponse(d);
  el('cloudStatus').textContent='选股结果已同步 · 获取时间 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'（不代表行情实时）';
 }catch(e){
  el('cloudStatus').textContent=(hadResponse?'云端暂时不可用，保留上次画面 · 非实时':'尚未取得可核验的选股结果')+' · '+String(e?.message||'网络异常').slice(0,110);
  el('listSource').textContent=hadResponse?'上次画面 · 非实时':'未连接';
 }finally{busy=false;el('refreshPicks').disabled=false;}
}
function renderRules(){
 const catalog=root.V6PicksRuleCatalog?.catalog||[];
 el('ruleCards').innerHTML=catalog.length?catalog.map(x=>
  '<article class="rule"><h3>'+escape(x.name)+'</h3><span class="tag">'+escape(x.family)+'</span>'+
  '<p>'+escape(x.logic)+'</p><p><b>需要：</b>'+escape(x.needs)+'</p>'+
  '<p><small>'+escape(x.status)+' · 未验证收益 · 不改变四套策略</small></p>'+
  '<a href="'+escape(x.source)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">查看研究出处 ↗</a></article>'
 ).join(''):'<p class="tiny">研究目录暂不可用，不会生成假战法命中。</p>';
}
el('pickCards').addEventListener('click',event=>{const btn=event.target.closest('button[data-pick]');if(!btn)return;const item=entries.find(x=>x.key===Number(btn.dataset.pick));if(item)showDetail(item,{scroll:true});});
el('stockSearch').addEventListener('input',e=>{query=String(e.target.value||'').trim().slice(0,80);renderList();});
el('sortPicks').addEventListener('change',e=>{sort=e.target.value;renderList();});
document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{
 mode=btn.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>{const on=item===btn;item.classList.toggle('on',on);item.setAttribute('aria-pressed',String(on));});renderList();
}));
el('refreshPicks').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
root.addEventListener('pageshow',e=>{if(e.persisted)refresh();});
root.setInterval(()=>{if(!document.hidden)refresh();},20000);
renderRules();clearDetail('尚未选中股票。');refresh();
})(typeof window!=='undefined'?window:this);
