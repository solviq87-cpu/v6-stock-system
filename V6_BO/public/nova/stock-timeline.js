import {h,format} from './ui.js';

// Track the observations already delivered to this authenticated page. Keep the
// latest point per minute per provider. Never interpolate missing sessions.
export function minutePoint(row, day, now=Date.now()){
 const at=row?.vendorQuoteAt??row?.quoteAt??row?.quoteTimestamp,source=row?.quoteSource||row?.source||row?.quoteProvider;
 if(!Number.isSafeInteger(at)||at<=0||at>now||typeof source!=='string'||!source.trim()||!Number.isFinite(row.price)||row.price<=0)return null;
 const stamp=new Date(at+28800000).toISOString(),hm=stamp.slice(11,16);
 if(stamp.slice(0,10)!==day||!(hm>='09:30'&&hm<='11:30'||hm>='13:00'&&hm<='15:00'))return null;
 return {at,value:row.price,source,minute:hm};
}

export function createQuoteTrail(){
 const series=new Map();
 function add(row,now=Date.now()){
  if(!/^\d{6}$/.test(row?.code))return;
  const at=row.vendorQuoteAt??row.quoteAt??row.quoteTimestamp;
  if(!Number.isSafeInteger(at)||at<=0||at>now)return;
  const day=new Date(at+28800000).toISOString().slice(0,10),point=minutePoint(row,day,now);
  if(!point)return;
  const key=day+'/'+row.code;
  if(!series.has(key)){if(series.size>=240)series.delete(series.keys().next().value);series.set(key,new Map());}
  const groups=series.get(key);
  if(!groups.has(point.source)){if(groups.size>=4)return;groups.set(point.source,new Map());}
  const minutes=groups.get(point.source),previous=minutes.get(point.minute);
  if(!previous||point.at>previous.at)minutes.set(point.minute,point);
 }
 return {add,read:(code,day)=>new Map([...(series.get(day+'/'+code)||[])].map(([src,rows])=>[src,new Map(rows)])),clear:()=>series.clear()};
}

export function archivePoints(bars,code,day,now=Date.now()){
 const groups=new Map(),conflicts=new Set();
 for(const b of Array.isArray(bars)?bars:[]){
  if(!b||typeof b!=='object'||typeof b.date!=='string')continue;
  if(b.code!==code||b.role!=='stock'||!['1m','5m'].includes(b.period)||!b.date?.startsWith(day+' ')||
     !Number.isSafeInteger(b.knownAt)||b.knownAt>now||b.knownAt<Date.parse(day+'T15:00:00+08:00')||typeof b.source!=='string'||!b.source.trim()||
     (b.priceBasis!=null&&b.priceBasis!=='unadjusted')||(b.volumeUnit!=null&&b.volumeUnit!=='shares')||
     (b.secid!=null&&b.secid!==(code.startsWith('6')?'1.':'0.')+code)||!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(b.date))continue;
  const hm=b.date.slice(11),m=Number(hm.slice(0,2))*60+Number(hm.slice(3)),origin=m>570&&m<=690?570:m>780&&m<=900?780:null;
  if(origin===null||Number(hm.slice(3))>59||(m-origin)%(b.period==='5m'?5:1)!==0)continue;
  const at=Date.parse(b.date.replace(' ','T')+':00+08:00');
  const point=minutePoint({quoteAt:at,quoteSource:b.source,price:b.close},day,b.knownAt);
  if(!point)continue;
  const key=b.source+' / '+b.period;
  if(!groups.has(key))groups.set(key,new Map());
  const series=groups.get(key),id=JSON.stringify([key,point.minute]),prior=series.get(point.minute);
  if(prior&&prior.value!==point.value){conflicts.add(id);series.delete(point.minute);}
  if(!conflicts.has(id)&&!prior)series.set(point.minute,{...point,source:key});
 }
 return [...groups.values()].sort((a,b)=>b.size-a.size)[0]||new Map();
}

export function priceLine(points,label,{digits=2,timeLabel}={}){
 const sorted=points.filter(p=>Number.isFinite(p.at)&&Number.isFinite(p.value)).slice().sort((a,b)=>a.at-b.at);
 if(!sorted.length)return h('p',{class:'fy-muted'},'尚无可绘制的记录。');
 const values=sorted.map(p=>p.value),lo=Math.min(...values),hi=Math.max(...values),first=sorted[0],last=sorted.at(-1);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 320 76');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);
 const coords=sorted.map(p=>[4+(p.at-first.at)*312/Math.max(1,last.at-first.at),hi===lo?38:70-(p.value-lo)*64/(hi-lo)]);
 const line=document.createElementNS(ns,'polyline');line.setAttribute('points',coords.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);
 const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',coords.at(-1)[0]);dot.setAttribute('cy',coords.at(-1)[1]);dot.setAttribute('r','3');dot.setAttribute('fill','currentColor');svg.append(dot);
 return h('figure',{class:'fy-observed-line'},svg,h('figcaption',{},[timeLabel?.(first),timeLabel?.(last)].filter(Boolean).join(' 至 '),' · 最低 '+format(lo,digits)+' / 最高 '+format(hi,digits)));
}
