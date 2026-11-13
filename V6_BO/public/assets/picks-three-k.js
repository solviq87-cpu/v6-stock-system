/* One results entry, two responsive layouts, and three read-only K-line views.
   Never edit either owner-approved homepage or generate synthetic market bars. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const validCode=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const source=window.V6PicksPeriods;
const followup=window.V6PicksFollowup;
const PAGE_SIZE=240,MAX_PAGES=6;
const TARGET_BARS={day:2,month:36,year:5};
let selected=null,period='day',daily=[],generation=0,controller=null;
let pages=0,hasMore=false,oldest=null,olderTask=null;
function message(text){
 $('periodStatus').textContent=text;
}
function emptyChart(text){
 $('periodChart').replaceChildren(document.createTextNode(text));
}
function clear(reason='尚未选择股票'){
 generation++;
 if(controller)controller.abort();controller=null;
 selected=null;daily=[];pages=0;hasMore=false;oldest=null;olderTask=null;
 $('pickDetailCode').textContent='尚未选择';
 $('pickDetailCaption').textContent='点击候选股票查看日K、月K、年K';
 $('detailReasons').replaceChildren(document.createTextNode('选择股票后显示服务器实际返回的命中条件。'));
 $('detailRisk').textContent='风险状态待核对';
 $('detailQuote').textContent='历史价格与报价独立，不认证实时';
 const followHost=$('pickFollowup');if(followHost)followHost.textContent='选择股票后查看冻结信号的后续观察。';
 message(reason);emptyChart('没有已选择的股票');
}
function draw(){
 if(!selected)return;
 const bars=source.aggregate(daily,period);
 // While a prior page remains available, the oldest monthly/yearly candle
 // is only a partial prefix of that period. Don't present it as a full bar.
 const hiddenFirst=period!=='day'&&hasMore&&bars.length>0;
 const shown=(hiddenFirst?bars.slice(1):bars).slice(-({day:55,month:36,year:16}[period]));
 const tag={day:'日K',month:'月K',year:'年K'}[period];
 if(shown.length<2){
  message(tag+'：历史日线覆盖期不足，无法形成可核实的走势'+(hasMore?'；更早历史尚未完整载入':'') );
  emptyChart('当前数据不足，不能凭空生成'+tag);
  return;
 }
 const low=Math.min(...shown.map(x=>x.low)),high=Math.max(...shown.map(x=>x.high));
 const ns='http://www.w3.org/2000/svg',w=640,h=250,left=12,right=55,top=12,bottom=213;
 const step=(w-left-right)/shown.length,y=v=>bottom-(v-low)*(bottom-top)/(high-low||1);
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 '+w+' '+h);
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label',selected.name+'的'+tag+'历史OHLC蜡烛图，不是实时');
 function part(name,props,text){
  const el=document.createElementNS(ns,name);
  for(const [key,val] of Object.entries(props||{}))el.setAttribute(key,String(val));
  if(text!==undefined)el.textContent=String(text);
  return el;
 }
 for(let i=0;i<=4;i++){
  const yy=top+(bottom-top)*i/4;
  svg.append(part('line',{x1:left,y1:yy,x2:w-right,y2:yy,stroke:'#284d70','stroke-opacity':'.62'}));
 }
 shown.forEach((bar,i)=>{
  const x=left+(i+.5)*step,color=bar.close>=bar.open?'#fa6d82':'#26d7a3';
  const group=part('g',{'aria-label':(bar.period||bar.date)+' 开'+bar.open+' 高'+bar.high+' 低'+bar.low+' 收'+bar.close});
  group.append(part('line',{x1:x,y1:y(bar.high),x2:x,y2:y(bar.low),stroke:color,'stroke-width':1.5}));
  group.append(part('rect',{x:x-step*.28,y:Math.min(y(bar.open),y(bar.close)),
    width:Math.max(1.5,step*.56),height:Math.max(1,Math.abs(y(bar.open)-y(bar.close))),fill:color}));
  group.append(part('title',{},(bar.period||bar.date)+'  开 '+bar.open.toFixed(2)+'  收 '+bar.close.toFixed(2)));
  svg.append(group);
 });
 for(const value of [low,(low+high)/2,high]){
  svg.append(part('text',{x:w-right+5,y:y(value)+4,fill:'#91b5cf','font-size':11},value.toFixed(2)));
 }
 $('periodChart').replaceChildren(svg);
 const last=shown[shown.length-1];
 message(tag+' · '+shown.length+' 根 · 已取得日线截止 '+last.date+
   (period==='day'?'':' · 月/年K由真实日K聚合（最新周期可能未结束）')+
   (hiddenFirst?' · 最早未完整周期已隐藏':'')+
   (period!=='day'&&!hasMore?' · 历史起点可能从上市日开始，首周期未必完整':'')+
   (hasMore&&pages>=MAX_PAGES?' · 已达到分批读取上限':'') );
}
function setPeriod(next){
 if(!['day','month','year'].includes(next))return;
 period=next;
 document.querySelectorAll('[data-period]').forEach(btn=>{
  const on=btn.dataset.period===next;
  btn.classList.toggle('active',on);
  btn.setAttribute('aria-pressed',String(on));
 });
 if(selected){draw();if(next!=='day')void loadOlder(generation);}
}
async function fetchHistoryPage(code,end,turn){
 const url='/api/kline?code='+encodeURIComponent(code)+'&n='+PAGE_SIZE+
  (end?'&end='+encodeURIComponent(end):'');
 const response=await fetch(url,{
  method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
  headers:{Accept:'application/json'}
 });
 if(turn!==generation)return null;
 // The result list and K-line detail share one read authorization boundary.
 // Fail closed when K-line access is revoked; a stale chart must not survive.
 if(response.status===401||response.status===403){
  document.dispatchEvent(new Event('v6:picks-kline-unauthorized'));
  return null;
 }
 if(!response.ok)throw Error('K线接口暂不可用（HTTP '+response.status+'）');
 const result=await response.json();
 if(turn!==generation)return null;
 if(result?.locked===true){
  document.dispatchEvent(new Event('v6:picks-kline-unauthorized'));
  return null;
 }
 if(!result||result.ok===false||result.simulated===true||
   result.isMock===true||!Array.isArray(result.rows)||
   (result.code!=null&&String(result.code)!==code))
  throw Error('没有可核实的历史日K数据');
 return result;
}
async function loadOlder(turn){
 if(turn!==generation||!selected||!hasMore||pages>=MAX_PAGES)return;
 if(olderTask)return olderTask;
 const task=(async()=>{
  try{
   while(turn===generation&&hasMore&&pages<MAX_PAGES&&
     (source.aggregate(daily,period).length-(period!=='day'?1:0))<TARGET_BARS[period]){
    if(!oldest||!/^\d{4}-\d{2}-\d{2}$/.test(oldest))break;
    const requested=oldest.replace(/-/g,'');
    message('正在补读更早历史K线（已读取'+pages+'页）…');
    const result=await fetchHistoryPage(selected.code,requested,turn);
    if(turn!==generation||!result)return;
    const older=source.normalize(result.rows).filter(bar=>bar.date<oldest);
    // A repeated, empty, or non-retreating page cannot make progress.
    if(!older.length){
     if(result.rows.length)throw Error('更早历史未向前推进，已停止以防重复K线');
     hasMore=false;break;
    }
    daily=source.normalize([...older,...daily]);
    oldest=daily[0].date;
    hasMore=result.hasMore===true;
    pages++;
   }
   if(turn===generation)draw();
  }catch(error){
   if(turn!==generation||error?.name==='AbortError')return;
   // A transport failure cannot certify that no older bars exist.
   // Keep hasMore so the oldest partial month/year stays hidden; user may
   // retry by reselecting a period without reloading the whole page.
   hasMore=true;
   draw();
   message('历史补读中断，较早月/年K未完整，最早周期不展示；已取得'+daily.length+'根日K。'+String(error?.message||'网络错误'));
  }
 })();
 olderTask=task;
 try{return await task;}finally{if(olderTask===task)olderTask=null;}
}
async function load(code){
 const turn=++generation;
 if(controller)controller.abort();
 controller=new AbortController();
 olderTask=null;daily=[];pages=0;hasMore=false;oldest=null;
 message('正在读取最近的历史日K…');
 emptyChart('读取中…');
 try{
  const result=await fetchHistoryPage(code,'',turn);
  if(turn!==generation||!result)return;
  if(result.dataQuality){
   const q=result.dataQuality,provider={em:'东方财富',tx:'腾讯',ths:'同花顺'}[q.source]||'未知';
   const cache={memory:'内存缓存',disk:'磁盘缓存',source:'本次取源','source-lagging':'源数据滞后','held-after-source-failure':'源不可用，沿用缓存','held-source-not-newer':'源未更新，沿用缓存'}[q.cacheLayer]||'缓存状态未知';
   $('detailQuote').textContent='日K截至'+(q.tradeDate||'未知')+' · 来源'+provider+
     ' · '+cache+(q.freshness==='source-lagging'&&q.cacheLayer!=='source-lagging'?' · 源数据滞后':'')+' · 历史价格不作执行价';
  }
  daily=source.normalize(result.rows);
  if(daily.length<2)throw Error('有效历史日K不足');
  pages=1;oldest=daily[0].date;
  hasMore=result.hasMore===true;
  draw();
  // Only month/year need more than the latest 240 real daily candles.
  if(period!=='day')void loadOlder(turn);
 }catch(err){
  if(turn!==generation||err?.name==='AbortError')return;
  message('历史K线暂不可用');emptyChart(String(err?.message||'网络读取失败'));
 }
}
function showFollowup(payload,code){
 const host=$('pickFollowup');if(!host)return;
 const report=followup?.project(payload,code);
 host.replaceChildren();
 if(!report||report.state!=='available'){
  host.textContent=report?.note||'暂无冻结信号的后续观察记录，不能把当天涨跌当作验证结果。';
  return;
 }
 const summary=document.createElement('p');summary.className='muted follow-summary';
 summary.textContent='观察截止 '+report.asOf+' · '+report.totalSignals+' 条冻结信号 · '+
   report.observed+' 个周期已观察，'+report.unresolved+' 个周期待核验';
 host.append(summary);
 for(const signal of report.entries){
  const box=document.createElement('div');box.className='follow-signal';
  const title=document.createElement('div');title.className='follow-signal-title';
  title.textContent=signal.date+' · '+signal.system+' · '+signal.cohort;
  box.append(title);
  const windows=document.createElement('div');windows.className='follow-windows';
  for(const w of signal.windows){
   const item=document.createElement('div');item.className='follow-window';
   const name=document.createElement('span');name.textContent=w.days+'交易日';
   const value=document.createElement('strong');
   value.className=w.pct===null?'flat':w.pct>0?'gain':w.pct<0?'loss':'flat';
   value.textContent=w.pct===null?w.label:(w.pct>0?'+':'')+w.pct.toFixed(2)+'%';
   item.append(name,value);windows.append(item);
  }
  box.append(windows);host.append(box);
 }
 if(report.totalSignals>report.entries.length){
  const more=document.createElement('p');more.className='muted';
  more.textContent='另有 '+(report.totalSignals-report.entries.length)+' 条记录未展开';host.append(more);
 }
 const note=document.createElement('p');note.className='footnote';note.textContent=report.note;host.append(note);
}
function updateDetailEvidence(stock){
 if(!selected||!stock||stock.code!==selected.code)return;
 selected.name=String(stock.name||stock.code).slice(0,64);
 $('pickDetailCaption').textContent=selected.name+' · '+selected.code;
 const reasons=Array.isArray(stock.reasons)?stock.reasons.filter(x=>typeof x==='string'&&x.trim()).slice(0,30):[];
 const host=$('detailReasons');host.replaceChildren();
 if(reasons.length){
  const ul=document.createElement('ul');ul.className='reason';
  for(const t of reasons){const li=document.createElement('li');li.textContent=t.slice(0,220);ul.append(li);}
  host.append(ul);
 }else host.textContent='后端未返回可核实命中条件，不能视作已命中。';
 $('detailRisk').textContent=String(stock.risk||'风险尚未评估').slice(0,130);
 $('detailQuote').textContent=String(stock.quoteProof||'报价原始时点未知，不是实时价').slice(0,200);
 showFollowup(stock.followup,stock.code);
}
function show(stock){
 if(!stock||!validCode(stock.code))return;
 selected={code:stock.code,name:String(stock.name||stock.code).slice(0,64)};
 $('pickDetailCode').textContent=stock.code;
 updateDetailEvidence(stock);
 load(stock.code);
 if(matchMedia('(max-width:850px)').matches)
  $('pickDetail').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
}
document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>setPeriod(btn.dataset.period)));
document.addEventListener('v6:picks-select',e=>show(e.detail));
document.addEventListener('v6:picks-detail-refresh',e=>updateDetailEvidence(e.detail));
document.addEventListener('v6:picks-unauthorized',()=>clear('选股查看权限已失效'));
document.addEventListener('v6:picks-reset',()=>clear('该股票已不在最新候选池中'));
clear();
})();
