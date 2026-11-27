'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {normalizeSeat,readLhbPages}=require('../src/core/lhb-evidence');
const {seatFrom}=require('../src/core/close-review-evidence');
const {normalizeClsLimitPool}=require('../src/core/cls-limit-up-pool');
const DAY='2026-11-27',AT=Date.parse(DAY+'T19:00:00+08:00');
const raw=(p={})=>({SECURITY_CODE:'600001',SECURITY_NAME_ABBR:'样本',OPERATEDEPT_NAME:'国盛证券宁波桑田路证券营业部',
 TRADE_DATE:DAY+' 00:00:00',BUY:50000000,SELL:10000000,NET:40000000,RISE_PROBABILITY_3DAY:50,EXPLANATION:'三日偏离',...p});
const packet=(rows,count=rows.length,pages=Math.ceil(count/500))=>({success:true,result:{count,pages,data:rows}});
const wire=(json,status=200,headers={})=>({status,headers,raw:Buffer.from(JSON.stringify(json))});
const source=fs.readFileSync(path.join(__dirname,'../em.js'),'utf8');
const block=source.slice(source.indexOf('const WHALE_KEYS ='),source.indexOf('// 同花顺涨停池：拿涨停原因'));
const nativeRequire=createRequire(path.resolve(__dirname,'../em.js'));
function producer(respond,clock=()=>AT){
 const calls=[];
 class Clock extends Date{static now(){return clock();}}
 const request=async(url,opt)=>{
  const p=Number(new URL(url).searchParams.get('pageNumber'));calls.push(p);
  opt.beforeStart?.();return respond(p,opt);
 };
 const oldCurl=async(url)=>{const p=Number(new URL(url).searchParams.get('pageNumber'));calls.push(p);return JSON.parse((await respond(p,{})).raw.toString('utf8'));};
 const em=new Function('require','Date','curlGet',block+'\nreturn {fetchLhb,judgeWhale};')(
  n=>n==='./src/core/research-curl-bytes'?{requestResearchBytes:request}:nativeRequire(n),Clock,oldCurl);
 return {...em,calls};
}
const filler=Array.from({length:500},(_,i)=>raw({SECURITY_CODE:String(600000+i)}));
test('D19 valid same-day seat reaches original main strategy output with source and actual receipt',async()=>{
 const seen=[],p=producer(async()=>wire(packet([raw()])));
 const map=await p.fetchLhb(DAY,{onSeat:r=>seen.push(r)});
 const s=map.get('600001');assert.equal(s.whale,true);assert.equal(s.whaleNet,40000000);assert.equal(s.netBuy,40000000);
 assert.equal(s.sourceTradeDate,DAY);assert.equal(s.receivedAt,AT);assert.equal(s.quoteAt,null);assert.equal(s.canTrade,false);
 assert.equal(seen.length,1);assert.equal(map.lhbEvidence.providerCount,1);assert.deepEqual(p.calls,[1]);
});
test('D19 missing explicit net cannot invent buy or sell zero',async()=>{
 const p=producer(async()=>wire(packet([raw({BUY:undefined,SELL:undefined,NET:undefined})])));
 await assert.rejects(p.fetchLhb(DAY),/龙虎榜/);
 const q=producer(async()=>wire(packet([raw({BUY:undefined,SELL:undefined,NET:0})])));
 const row=(await q.fetchLhb(DAY)).get('600001');assert.equal(row.netBuy,0);assert.equal(row.whale,false);
});
test('D19 wrong original trade day, malformed security and coerced identities fail closed',async()=>{
 for(const patch of [{TRADE_DATE:'2026-11-26'},{TRADE_DATE:'2026-02-30'},{SECURITY_CODE:600001},{SECURITY_CODE:['600001']},{OPERATEDEPT_NAME:' '}])
  await assert.rejects(producer(async()=>wire(packet([raw(patch)]))).fetchLhb(DAY),/龙虎榜/);
});
test('D19 malformed request or future day dispatches zero physical requests',async()=>{
 for(const day of ['2026-02-30','2026-11-28',20261127,['2026-11-27']]){
  const p=producer(async()=>wire(packet([raw()])));await assert.rejects(p.fetchLhb(day),/龙虎榜/);assert.equal(p.calls.length,0);
 }
});
test('D19 invalid monetary strings and inconsistent original net cannot become seat evidence',async()=>{
 for(const patch of [{BUY:'0x4000000',NET:undefined},{NET:'40000000bad'},{NET:45000000},{SELL:-1},{NET:'Infinity'}])
  await assert.rejects(producer(async()=>wire(packet([raw(patch)]))).fetchLhb(DAY),/龙虎榜/);
 assert.equal(normalizeSeat(raw({NET:Infinity}),DAY),null);
});
test('D19 out-of-range or malformed win rates cannot make an unknown seat a whale',async()=>{
 for(const rate of [101,'0x50','90bad',null,-1]){
  const p=producer(async()=>wire(packet([raw({OPERATEDEPT_NAME:'普通营业部',RISE_PROBABILITY_3DAY:rate})])));
  const row=(await p.fetchLhb(DAY)).get('600001');assert.equal(row.whale,false);assert.equal(row.depts[0].prob3,null);
 }
 const p=producer(async()=>wire(packet([raw({OPERATEDEPT_NAME:'普通营业部',RISE_PROBABILITY_3DAY:75})])));
 assert.equal((await p.fetchLhb(DAY)).get('600001').whale,true);
});
test('D19 page count mismatch, missing declaration and false success never pass',async()=>{
 for(const j of [packet([raw()],2,1),packet([raw()],1,2),{success:true,result:{data:[raw()]}},{...packet([raw()]),success:false},packet([raw()],3500,7)])
  await assert.rejects(producer(async()=>wire(j)).fetchLhb(DAY),/龙虎榜/);
});
test('D19 a complete multi-page response retains all securities and original receipts',async()=>{
 const last=raw({SECURITY_CODE:'600999'}),p=producer(async n=>wire(n===1?packet(filler,501,2):packet([last],501,2)));
 const seen=[];const map=await p.fetchLhb(DAY,{onSeat:x=>seen.push(x)});
 assert.equal(map.size,501);assert.equal(seen.length,501);assert.deepEqual(p.calls,[1,2]);
});
test('D19 second page failure cannot emit a valid prefix to the close-review callback',async()=>{
 const seen=[],p=producer(async n=>wire(n===1?packet(filler,501,2):packet([],501,2)));
 await assert.rejects(p.fetchLhb(DAY,{onSeat:r=>seen.push(r)}),/龙虎榜/);assert.deepEqual(seen,[]);
});
test('D19 pagination duplicated row or changed total refuses the entire observation',async()=>{
 for(const second of [packet([filler[0]],501,2),packet([raw({SECURITY_CODE:'600999'})],502,2)]){
  const p=producer(async n=>wire(n===1?packet(filler,501,2):second));
  await assert.rejects(p.fetchLhb(DAY),/龙虎榜/);
 }
});
test('D19 same named seat repeated across disclosure reasons cannot double net amount',async()=>{
 const p=producer(async()=>wire(packet([raw(),raw({EXPLANATION:'日偏离',OPERATEDEPT_CODE:'0001'})])));
 const row=(await p.fetchLhb(DAY)).get('600001');
 assert.equal(row.netBuy,40000000);assert.equal(row.depts.length,1);assert.equal(row.whaleNet,40000000);
});
test('D19 inconsistent repeated named seat excludes only the ambiguous security',async()=>{
 for(const patch of [{BUY:60000000,NET:50000000},{OPERATEDEPT_CODE:'0002'},{OPERATEDEPT_NAME:'别名营业部'}]){
  const p=producer(async()=>wire(packet([raw({OPERATEDEPT_CODE:'0001'}),raw({EXPLANATION:'另一原因',OPERATEDEPT_CODE:'0001',...patch}),raw({SECURITY_CODE:'600002'})])));
  const map=await p.fetchLhb(DAY);assert.equal(map.has('600001'),false);assert.equal(map.has('600002'),true);
  assert.equal(map.lhbEvidence.excludedSecurityCount,1);
 }
});
test('D19 anonymous institutions cannot be conflated into an exact net total',async()=>{
 for(const patch of [{BUY:60000000,NET:50000000},{OPERATEDEPT_CODE:'0012'}]){
  const p=producer(async()=>wire(packet([raw({OPERATEDEPT_NAME:'机构专用'}),raw({OPERATEDEPT_NAME:'机构专用',...patch})])));
  const row=(await p.fetchLhb(DAY)).get('600001');assert.equal(row.netBuy,null);assert.equal(row.whale,false);assert.equal(row.ambiguousAnonymousSeats,true);
 }
});
test('D19 exact zero row count remains unverified empty rather than a published same-day board',async()=>{
 const p=producer(async()=>wire(packet([])));const m=await p.fetchLhb(DAY);assert.equal(m.size,0);assert.equal(m.lhbEvidence.complete,false);assert.equal(m.lhbEvidence.sourceTradeDate,null);
});
test('D40 D19 HTTP partial, length mismatch and malformed UTF8 never enter the main data collector',async()=>{
 for(const response of [wire(packet([raw()]),206),wire(packet([raw()]),302),wire(packet([raw()]),200,{'content-length':'3'}),
  {status:200,raw:Buffer.from([255,254,123])}]){
  await assert.rejects(producer(async()=>response).fetchLhb(DAY),/龙虎榜/);
 }
});
test('D19 D27 deadline and clock rollback reject before delivering callbacks',async()=>{
 const expired=producer(async()=>wire(packet([raw()])));await assert.rejects(expired.fetchLhb(DAY,{deadline:AT}),/龙虎榜/);assert.equal(expired.calls.length,0);
 let times=[AT,AT,AT,AT-1],seen=[];const p=producer(async()=>wire(packet([raw()])),()=>times.shift()??AT);
 await assert.rejects(p.fetchLhb(DAY,{onSeat:r=>seen.push(r)}),/龙虎榜/);assert.deepEqual(seen,[]);
});
test('D19 final validation clock never replaces the original receivedAt',async()=>{
 const times=[AT,AT,AT,AT+100,AT+500];
 const b=await readLhbPages(DAY,{clock:()=>times.shift(),request:async(p,o)=>{o.beforeStart();return wire(packet([raw()]));}});
 assert.equal(b.receivedAt,AT+100);assert.equal(b.seats[0].receivedAt,AT+100);
});
test('D19 close-review consumes the same strict seat identities and preserves negative real net',()=>{
 const valid=seatFrom(raw({OPERATEDEPT_NAME:'机构专用',NET:-3000,BUY:undefined,SELL:undefined}),DAY);
 assert.equal(valid.net,-3000);assert.equal(valid.category,'机构专用');
 for(const patch of [{SECURITY_CODE:['600001']},{TRADE_DATE:DAY+'garbage'},{NET:'0x20',BUY:undefined,SELL:undefined},{BUY:undefined,SELL:undefined,NET:undefined}])
  assert.equal(seatFrom(raw(patch),DAY),null);
});
test('D19 numeric controls keep explicit zero, true negative and exact decimal fields, direct rule refuses invalid values',()=>{
 assert.equal(normalizeSeat(raw({NET:undefined,BUY:'12.5',SELL:'12.5'}),DAY).net,0);
 assert.equal(normalizeSeat(raw({NET:undefined,BUY:'1',SELL:'3'}),DAY).net,-2);
 const p=producer(async()=>wire(packet([])));
 assert.equal(p.judgeWhale({name:'桑田路',net:Infinity,prob3:99}).whale,false);
 assert.equal(p.judgeWhale({name:'普通营业部',net:40000000,prob3:101}).whale,false);
});
test('D18 old cold-market fixture uses distinct real plate identifiers and conflicting identifiers remain rejected',()=>{
 const item=(code,name,plates)=>({secu_code:code,secu_name:name,num_stocks:2,time:DAY+' 14:56:03',
   plate:plates.map(n=>({secu_code:n==='同题材'?'state-sector':'state-other',secu_name:n}))});
 const cls={code:200,data:[item('sh600000','浦发银行',['同题材','其他']),item('sz000001','平安银行',['同题材'])]};
 assert.equal(normalizeClsLimitPool(cls,{requestedDate:DAY,receivedAt:AT}).complete,true);
 cls.data[0].plate[1].secu_code='state-sector';
 assert.equal(normalizeClsLimitPool(cls,{requestedDate:DAY,receivedAt:AT}).complete,false);
});
