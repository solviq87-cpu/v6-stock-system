/* One results entry, two responsive layouts, and three read-only K-line views.
   Never edit either owner-approved homepage or generate synthetic market bars. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const validCode=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const source=window.V6PicksPeriods;
let selected=null,period='day',daily=[],generation=0,controller=null;
function message(text){
 $('periodStatus').textContent=text;
}
function emptyChart(text){
 $('periodChart').replaceChildren(document.createTextNode(text));
}
function clear(reason='尚未选择股票'){
 generation++;
 if(controller)controller.abort();controller=null;
 selected=null;daily=[];
 $('pickDetailCode').textContent='尚未选择';
 $('pickDetailCaption').textContent='点击候选股票查看日K、月K、年K';
 $('detailReasons').replaceChildren(document.createTextNode('选择股票后显示服务器实际返回的命中条件。'));
 $('detailRisk').textContent='风险状态待核对';
 $('detailQuote').textContent='历史价格与报价独立，不认证实时';
 message(reason);emptyChart('没有已选择的股票');
}
function draw(){
 if(!selected)return;
 const bars=source.aggregate(daily,period);
 const shown=bars.slice(-({day:55,month:36,year:16}[period]));
 const tag={day:'日K',month:'月K',year:'年K'}[period];
 if(shown.length<2){
  message(tag+'：历史日线覆盖期不足，无法形成可核实的走势');
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
 message(tag+' · '+shown.length+' 根 · 已取得日线截止 '+last.date+' · 月/年K由真实日K聚合（最新周期可能未结束）');
}
function setPeriod(next){
 if(!['day','month','year'].includes(next))return;
 period=next;
 document.querySelectorAll('[data-period]').forEach(btn=>{
  const on=btn.dataset.period===next;
  btn.classList.toggle('active',on);
  btn.setAttribute('aria-pressed',String(on));
 });
 if(selected)draw();
}
async function load(code){
 const turn=++generation;
 if(controller)controller.abort();
 controller=new AbortController();
 daily=[];message('正在读取历史日K，以便生成日/月/年K…');
 emptyChart('读取中…');
 try{
  // Ask for enough genuine daily history for yearly bars. The existing server
  // may cap n: never infer missing months or years from fewer returned rows.
  const response=await fetch('/api/kline?code='+encodeURIComponent(code)+'&n=1200',{
   method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}
  });
  if(turn!==generation)return;
  if(!response.ok)throw Error('K线接口暂不可用（HTTP '+response.status+'）');
  const result=await response.json();
  if(turn!==generation)return;
  if(!result||result.ok===false||result.simulated===true||result.isMock===true||!Array.isArray(result.rows))
    throw Error('没有可核实的历史日K数据');
  daily=source.normalize(result.rows);
  if(daily.length<2)throw Error('有效历史日K不足');
  draw();
 }catch(err){
  if(turn!==generation||err?.name==='AbortError')return;
  message('历史K线暂不可用');emptyChart(String(err?.message||'网络读取失败'));
 }
}
function show(stock){
 if(!stock||!validCode(stock.code))return;
 selected={code:stock.code,name:String(stock.name||stock.code).slice(0,64)};
 $('pickDetailCode').textContent=stock.code;
 $('pickDetailCaption').textContent=selected.name+' · '+stock.code;
 const reasons=Array.isArray(stock.reasons)?stock.reasons.filter(x=>typeof x==='string'&&x.trim()).slice(0,30):[];
 const host=$('detailReasons');host.replaceChildren();
 if(reasons.length){
  const ul=document.createElement('ul');ul.className='reason';
  for(const t of reasons){const li=document.createElement('li');li.textContent=t.slice(0,220);ul.append(li);}
  host.append(ul);
 }else host.textContent='后端未返回可核实命中条件，不能视作已命中。';
 $('detailRisk').textContent=String(stock.risk||'风险尚未评估').slice(0,130);
 $('detailQuote').textContent=String(stock.quoteProof||'报价原始时点未知，不是实时价').slice(0,200);
 load(stock.code);
 if(matchMedia('(max-width:850px)').matches)
  $('pickDetail').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
}
document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>setPeriod(btn.dataset.period)));
document.addEventListener('v6:picks-select',e=>show(e.detail));
document.addEventListener('v6:picks-unauthorized',()=>clear('选股查看权限已失效'));
document.addEventListener('v6:picks-reset',()=>clear('该股票已不在最新候选池中'));
clear();
})();