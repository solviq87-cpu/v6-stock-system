/* Additive, read-only detail plugin for the already-merged selection results UI. */
(() => {
'use strict';
const el=id=>document.getElementById(id),finite=x=>typeof x==='number'&&Number.isFinite(x);
const label=(id,v)=>{if(el(id))el(id).textContent=String(v??'未知');};
let generation=0,aborter=null;
function reset(note){
 generation++;if(aborter)aborter.abort();aborter=null;
 label('pickDetailState',note||'尚未选中');label('pickDetailName','请选择候选股票');
 label('pickDetailInfo','尚未选择');label('pickDetailQuote','—');
 label('pickDetailReasons','等待已返回的命中依据');
 label('pickDetailRisk','风险尚未核验');label('pickDetailProvenance','报价原始时点未认证');
 label('pickKlineAsOf','未获取');
 el('pickKline').replaceChildren(document.createTextNode('选择股票后读取历史日 K 线'));
}
function plot(rows){
 if(!Array.isArray(rows))return false;
 const bars=rows.filter(b=>b&&[b.open,b.high,b.low,b.close].every(finite)&&
   b.low>0&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close)).slice(-50);
 if(bars.length<3)return false;
 const low=Math.min(...bars.map(b=>b.low)),high=Math.max(...bars.map(b=>b.high));
 if(!finite(low)||!finite(high))return false;
 const ns='http://www.w3.org/2000/svg',w=610,h=235,left=8,right=54,top=10,bottom=208;
 const y=v=>bottom-(v-low)*(bottom-top)/(high-low||1),step=(w-left-right)/bars.length;
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.setAttribute('role','img');
 svg.setAttribute('aria-label','真实历史K线接口返回的OHLC数据，未经实时认证');
 for(let i=0;i<5;i++){
  const yy=top+(bottom-top)*i/4,line=document.createElementNS(ns,'line');
  for(const [key,val] of [['x1',left],['x2',w-right],['y1',yy],['y2',yy],['stroke','#29476c']])
   line.setAttribute(key,val);
  svg.append(line);
 }
 bars.forEach((b,i)=>{
  const x=left+step*(i+.5),color=b.close>=b.open?'#fa6c81':'#30d9a8';
  const line=document.createElementNS(ns,'line');
  for(const [k,v] of [['x1',x],['x2',x],['y1',y(b.high)],['y2',y(b.low)],['stroke',color]])line.setAttribute(k,v);
  svg.append(line);
  const rect=document.createElementNS(ns,'rect');
  for(const [k,v] of [['x',x-step*.27],['y',Math.min(y(b.open),y(b.close))],['width',Math.max(1.5,step*.54)],['height',Math.max(1,Math.abs(y(b.open)-y(b.close)))],['fill',color]])rect.setAttribute(k,v);
  svg.append(rect);
 });
 for(const price of [low,(low+high)/2,high]){
  const item=document.createElementNS(ns,'text');
  item.setAttribute('x',w-right+5);item.setAttribute('y',y(price)+4);
  item.setAttribute('fill','#9fb5d0');item.setAttribute('font-size','10');
  item.textContent=price.toFixed(2);svg.append(item);
 }
 el('pickKline').replaceChildren(svg);return true;
}
async function loadKline(code){
 const request=++generation;
 if(aborter)aborter.abort();aborter=new AbortController();
 label('pickKlineAsOf','读取中 · 非实时');
 el('pickKline').replaceChildren(document.createTextNode('正在读取所选股票历史K线…'));
 try{
  const response=await fetch('/api/kline?code='+encodeURIComponent(code)+'&n=60',{
   method:'GET',credentials:'same-origin',cache:'no-store',signal:aborter.signal,
   headers:{Accept:'application/json'}
  });
  if(request!==generation)return;
  if(!response.ok)throw Error(response.status===401||response.status===403?'没有历史K线读取权限':'历史K线暂不可用');
  const data=await response.json();if(request!==generation)return;
  if(!data||data.ok===false||data.isMock===true||data.simulated===true)throw Error('历史数据尚未核验');
  if(!plot(data.rows))throw Error('有效K线数量不足，不绘制');
  label('pickKlineAsOf',typeof data.asOf==='string'?data.asOf.slice(0,32)+' · 历史':'时点未知 · 历史');
 }catch(err){
  if(request!==generation||err?.name==='AbortError')return;
  label('pickKlineAsOf','不可用');
  el('pickKline').replaceChildren(document.createTextNode(String(err?.message||'读取失败')));
 }
}
function showPick(info){
 if(!info||typeof info.code!=='string'||!/^\d{6}$/.test(info.code))return;
 label('pickDetailState','当前候选 · '+info.code);
 label('pickDetailName',info.name||info.code);
 label('pickDetailInfo','证券代码 '+info.code+(info.sector?' · 板块 '+info.sector:' · 板块未知'));
 label('pickDetailQuote',finite(info.price)?info.price.toFixed(2)+' · '+(finite(info.pct)?(info.pct>0?'+':'')+info.pct.toFixed(2)+'%':'涨跌未知'):'报价未知');
 const box=el('pickDetailReasons');box.replaceChildren();
 const reasons=Array.isArray(info.reasons)?info.reasons.filter(x=>typeof x==='string'&&x.trim()).slice(0,30):[];
 if(reasons.length){
  const ul=document.createElement('ul');ul.className='reason';
  for(const reason of reasons){const li=document.createElement('li');li.textContent=reason.slice(0,220);ul.append(li);}
  box.append(ul);
 }else box.textContent='服务器未返回可核实的命中依据，不推断战法已命中。';
 label('pickDetailRisk',String(info.risk||'风险未评估').slice(0,160));
 label('pickDetailProvenance',String(info.provenance||'报价原始时点未知').slice(0,180));
 loadKline(info.code);
 const pane=el('pickDetailPanel');
 if(pane)pane.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function catalog(){
 const host=el('picksRuleCatalog');if(!host)return;
 const rules=window.V6PicksRuleCatalog?.catalog||[];
 host.replaceChildren();
 for(const r of rules){
  const card=document.createElement('article');card.className='picks-rule';
  const h=document.createElement('h3');h.textContent=r.name;card.append(h);
  const p=document.createElement('p');p.textContent=r.logic;card.append(p);
  const s=document.createElement('small');s.textContent=r.family+' · '+r.status+' · 非交易信号';card.append(s);
  if(/^https:\/\/[a-z0-9.-]+\//i.test(r.source)){
   const a=document.createElement('a');a.textContent='查看规则来源 ↗';a.href=r.source;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';card.append(a);
  }
  host.append(card);
 }
 if(!rules.length)host.textContent='研究目录暂不可用，不能虚构规则已命中。';
}
document.addEventListener('v6:picks-select',event=>showPick(event.detail));
document.addEventListener('v6:picks-unauthorized',()=>reset('权限已失效'));
reset('尚未选中');catalog();
})();