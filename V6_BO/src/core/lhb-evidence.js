'use strict';

// Historical disclosure evidence, not a realtime quote or permission.
const PAGE_SIZE=500,MAX_PAGES=6,MAX_BYTES=2*1024*1024;
const CLOCK=at=>Number.isSafeInteger(at)&&at>0&&at<8e15;
const nonDept=/自然人|机构|沪股通|深股通|中小投资者|其他/;
function dayOf(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.000)?)?$/.test(value))return null;
 const d=value.slice(0,10),at=Date.parse(d+'T00:00:00Z');
 return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===d?d:null;
}
function lhbNumber(v){
 if(typeof v!=='number'&&(typeof v!=='string'||!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v.trim())))return null;
 const n=Number(v);return Number.isFinite(n)&&Math.abs(n)<=1e15?n:null;
}
const missing=v=>v==null||typeof v==='string'&&['','-','--'].includes(v.trim());
const label=(v,max=256)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim():null;
const countOf=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:
 typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):null;
function normalizeSeat(row,day){
 if(!row||typeof row!=='object'||Array.isArray(row)||typeof day!=='string'||dayOf(day)!==day||dayOf(row.TRADE_DATE)!==day||
  typeof row.SECURITY_CODE!=='string'||!/^\d{6}$/.test(row.SECURITY_CODE))return null;
 const dept=label(row.OPERATEDEPT_NAME),deptId=missing(row.OPERATEDEPT_CODE)?null:label(row.OPERATEDEPT_CODE,80);
 if(!dept||!missing(row.OPERATEDEPT_CODE)&&!deptId)return null;
 const buy=lhbNumber(row.BUY),sell=lhbNumber(row.SELL),reported=lhbNumber(row.NET);
 if(buy!==null&&buy<0||sell!==null&&sell<0||
  !missing(row.BUY)&&buy===null||!missing(row.SELL)&&sell===null||!missing(row.NET)&&reported===null)return null;
 let net=reported;
 if(net===null&&buy!==null&&sell!==null)net=buy-sell;
 if(net===null||lhbNumber(net)===null)return null;
 if(reported!==null&&buy!==null&&sell!==null&&
  Math.abs(reported-(buy-sell))>Math.max(0.01,1e-10*Math.max(Math.abs(buy),Math.abs(sell),Math.abs(reported))))return null;
 const p=lhbNumber(row.RISE_PROBABILITY_3DAY),prob3=p!==null&&p>=0&&p<=100?p:null;
 const explanation=label(row.EXPLANATION,500),alias=label(row.EXPLAIN,500);
 if(explanation&&alias&&explanation!==alias)return null;
 const reason=explanation||alias||'';
 return {code:row.SECURITY_CODE,name:label(row.SECURITY_NAME_ABBR,80)||row.SECURITY_CODE,dept,deptId,buy,sell,net,prob3,reason,day};
}
const rowKey=s=>JSON.stringify([s.code,s.dept,s.deptId,s.reason,s.buy,s.sell,s.net,s.prob3]);
const amounts=s=>JSON.stringify([s.dept,s.buy,s.sell,s.net,s.prob3]);
const protocolError=()=>Error('龙虎榜上游分页、交易日或席位证据不完整');
async function readLhbPages(day,{request,clock=Date.now,deadline=Infinity}={}){
 if(typeof day!=='string'||dayOf(day)!==day||typeof request!=='function'||typeof clock!=='function'||
  deadline!==Infinity&&!CLOCK(deadline))throw Error('龙虎榜日期或请求参数无效');
 let high=0,lastReceipt=null;
 function sample(){const at=clock();if(!CLOCK(at)||at<high||at>=deadline)throw Error('龙虎榜采集时钟无效、倒退或超时');high=at;return at;}
 const initial=sample(),today=new Date(initial+28800000).toISOString().slice(0,10);
 if(day>today)throw Error('龙虎榜交易日在未来');
 let expected=null,pages=null;const seats=[],seen=new Set();
 for(let page=1;page<=MAX_PAGES;page++){
  const at=sample(),remaining=deadline-at;
  const params={maxBytes:MAX_BYTES,timeoutMs:Math.min(12000,remaining),processTimeoutMs:Math.min(13000,remaining+1000),
   beforeStart:()=>{const left=deadline-sample();return {timeoutMs:Math.min(12000,left),processTimeoutMs:Math.min(13000,left+1000)};}};
  const response=await request(page,params),receivedAt=sample();lastReceipt=receivedAt;
  if(response?.status!==200||!Buffer.isBuffer(response.raw)||!response.raw.length||response.raw.length>MAX_BYTES)throw protocolError();
  const len=response.headers?.['content-length'],enc=response.headers?.['content-encoding'];
  if(len!=null&&(!enc||String(enc).toLowerCase()==='identity')&&
   (typeof len!=='string'||!/^\d+$/.test(len)||Number(len)!==response.raw.length))throw protocolError();
  let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.raw));}catch{throw protocolError();}
  const result=json?.result,total=countOf(result?.count),pageCount=countOf(result?.pages);
  if(json?.success!==true||!Array.isArray(result?.data)||total===null||pageCount===null||
   total>PAGE_SIZE*MAX_PAGES||pageCount>MAX_PAGES||
   (total===0?![0,1].includes(pageCount):pageCount!==Math.ceil(total/PAGE_SIZE)))throw protocolError();
  if(expected===null){expected=total;pages=pageCount;}
  if(total!==expected||pageCount!==pages||result.data.length!==Math.min(PAGE_SIZE,Math.max(0,expected-(page-1)*PAGE_SIZE)))throw protocolError();
  for(const row of result.data){
   const seat=normalizeSeat(row,day);
   if(!seat||seen.has(rowKey(seat)))throw protocolError();
   seen.add(rowKey(seat));seats.push({seat,raw:row,receivedAt});
  }
  if(page>=pages)break;
 }
 if(expected!==seats.length)throw protocolError();
 sample(); // Check completion clock without refreshing the original receipt.
 return {seats,receivedAt:lastReceipt,tradeDate:seats.length?day:null,requestedDate:day,
  count:seats.length,complete:seats.length>0,source:'eastmoney',quoteAt:null,
  providerPublishedAt:null,verifiedLive:false,canTrade:false};
}
function groupLhbSeats(batch){
 const groups=new Map();
 for(const record of batch.seats){
  const s={...record.seat,receivedAt:record.receivedAt};
  let g=groups.get(s.code);
  if(!g){g={bySeat:new Map(),idNames:new Map(),anonymous:new Map(),ambiguous:false,conflict:false};groups.set(s.code,g);}
  if(s.deptId){
   const priorName=g.idNames.get(s.deptId);
   if(priorName&&priorName!==s.dept)g.conflict=true;
   g.idNames.set(s.deptId,s.dept);
  }
  // Repeated anonymous labels without IDs cannot establish separate seats.
  if(nonDept.test(s.dept)&&!s.deptId){
   const rows=g.anonymous.get(s.dept)||[];rows.push(s);g.anonymous.set(s.dept,rows);
   if(rows.length>1)g.ambiguous=true;
   continue;
  }
  const key=nonDept.test(s.dept)?'anonymous-id:'+s.deptId:'named:'+s.dept;
  const prior=g.bySeat.get(key);
  if(prior){
   if(amounts(prior)!==amounts(s)||prior.deptId&&s.deptId&&prior.deptId!==s.deptId)g.conflict=true;
   else if(!prior.deptId&&s.deptId)g.bySeat.set(key,{...prior,deptId:s.deptId});
  }else g.bySeat.set(key,s);
 }
 const out=new Map();let excludedSecurityCount=0;
 for(const [code,g] of groups){
  if(g.conflict){excludedSecurityCount++;continue;}
  for(const s of g.bySeat.values())if(g.anonymous.has(s.dept))g.ambiguous=true;
  const depts=[...g.bySeat.values(),...[...g.anonymous.values()].flat()];
  const total=depts.reduce((sum,s)=>sum+s.net,0);
  out.set(code,{depts:depts.map(s=>({name:s.dept,buy:s.buy,sell:s.sell,net:s.net,prob3:s.prob3,receivedAt:s.receivedAt})),
   netBuy:g.ambiguous||!Number.isSafeInteger(Math.trunc(total))?null:total,source:batch.source,
   sourceTradeDate:batch.tradeDate,receivedAt:batch.receivedAt,quoteAt:null,
   providerPublishedAt:null,verifiedLive:false,canTrade:false,ambiguousAnonymousSeats:g.ambiguous});
 }
 return {out,excludedSecurityCount};
}
module.exports={dayOf,lhbNumber,normalizeSeat,readLhbPages,groupLhbSeats};
