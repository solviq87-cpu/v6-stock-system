'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-20',code='600001',at=day+' 15:00';
const bar=(date,extra={})=>({code,date,role:'stock',period:'日K',open:10,high:10.1,low:9.9,close:10,volume:10000,...extra});
const history=()=>[bar('2026-11-18',{limitUp:10,streak:3,volume:40000}),bar('2026-11-19',{limitUp:10,streak:4,volume:30000,sector:'设备',sectorAssists:4})];
const high=()=>({b:bar(day,{auctionGap:-6}),history:history(),f:{change:0,ratio:2}});
async function scan(extra={},seed=[]){const a=await api;return a.addStockRiskEvidence({b:bar(day),asOf:at,...extra},new Map(seed));}
const yes=(f,...keys)=>keys.forEach(k=>assert.equal(f.get(k)?.pass,true,k));
const missing=(f,...keys)=>keys.forEach(k=>assert.equal(f.has(k),false,k));
test('C21.1 explicit unknown or reversed daily receipt cannot establish historical high mark',async()=>{
 const x=high();
 for(const patch of [{knownAt:null},{availableAt:null},{knownAt:'2026-11-19 14:59'},{availableAt:'2026-11-18 15:00'}]){
  const h=history();Object.assign(h[1],patch);missing(await scan({...x,history:h}),'30:0','11:0');
 }
 yes(await scan(x),'30:0','11:0');
});
test('C21.1 legacy absent receipt differs from future or malformed current receipt',async()=>{
 const x=high();
 for(const patch of [{knownAt:null},{knownAt:day+' 14:59'},{knownAt:day+' 15:01'},{availableAt:'2026-02-30 15:00'}]){
  const f=await scan({...x,b:{...x.b,...patch}});assert.equal(f.size,0);
 }
 yes(await scan({...x,b:{...x.b,knownAt:at}}),'30:0');
});
test('C21.2 current conflict or adjusted price cannot create price-based high position or holding evidence',async()=>{
 const x=high(),holdingSnapshot={code,shares:100,avgCost:8,source:'历史持仓',observedAt:day+' 14:59',knownAt:at};
 for(const patch of [{sourceConflict:true},{retracted:true},{priceBasis:'hfq'},{suspended:true}]){
  missing(await scan({...x,b:{...x.b,holdingSnapshot,...patch}}),'30:0','11:0','64:0');
 }
 const f=await scan({...x,b:{...x.b,sourceConflict:true,tradingStatus:'停牌'}});yes(f,'57:1');
});
test('C21.2 visible contradictory prior price flag breaks sequence; future revision cannot rewrite history',async()=>{
 const x=high(),h=history();
 missing(await scan({...x,history:[...h,{...h[1],sourceConflict:true}]}),'30:0','30:3','11:0');
 yes(await scan({...x,history:[...h,{...h[1],sourceConflict:true,knownAt:day+' 15:01'}]}),'30:0','11:0');
});
test('C21.2 explicit special session cannot treat opening gap as ordinary decline',async()=>{
 const x=high();
 for(const patch of [{corporateAction:{kind:'reference-close-changed'}},{ipoNoLimit:true},{noPriceLimit:true},{referencePriceConflict:true}]){
  missing(await scan({...x,b:{...x.b,...patch}}),'30:0','30:3');
 }
 yes(await scan(x),'30:0');
});
test('C21.3 unrelated declared sector cannot provide held-profit weakness evidence',async()=>{
 const b=bar(day,{sector:'设备',holdingSnapshot:{code,shares:100,avgCost:8,source:'历史持仓',observedAt:day+' 14:59',knownAt:at}});
 yes(await scan({b,sector:{date:day,sector:'设备',change:-3}}),'64:0','64:2');
 for(const sector of [{date:day,sector:'医药',change:-3},{date:day,role:'sector',code:'医药',change:-3},{date:day,sourceConflict:true,change:-3}]){
  const f=await scan({b,sector});yes(f,'64:0');missing(f,'64:2');
 }
});
test('C21.3 conflicting leader observation or malformed member list cannot produce leader-specific high risk',async()=>{
 const b=bar(day,{sector:'设备',sectorRole:'跟风'}),f={position:'高位',ratio:2,sectorLeader:'600002'};
 const leader={code:'600002',date:day,sector:'设备',change:0,ratio:2};
 yes(await scan({b,f,sector:{date:day,sector:'设备',memberQuotes:[leader]}}),'37:0');
 for(const memberQuotes of [[{...leader,conflict:true}],{}])
  missing(await scan({b,f,sector:{date:day,sector:'设备',memberQuotes}}),'37:0');
});
function markets(){
 const series=[{date:'2026-11-18',indexChange:-1},{date:'2026-11-19',indexChange:-1.5},{date:day,indexChange:-2.5}];
 return {market:{date:day,indexChange:-2.5,volume:'放量下跌'},marketSeries:series};
}
test('C21.4 duplicate market reports deduplicate, same-day conflict cannot count as a consecutive market decline',async()=>{
 const x=markets(),m=x.marketSeries[1];yes(await scan(x),'62:0');
 yes(await scan({...x,marketSeries:[...x.marketSeries,{...m}]}),'62:0');
 for(const duplicate of [{...m,indexChange:1},{...m,sourceConflict:true}]){
  missing(await scan({...x,marketSeries:[...x.marketSeries,duplicate]}),'62:0');
 }
});
test('C21.4 visible same-day market value mismatch or explicit invalid current market receipt is not a verified decline',async()=>{
 const x=markets();
 for(const market of [{...x.market,indexChange:1},{...x.market,knownAt:null},{...x.market,conflict:true}]){
  missing(await scan({...x,market}),'62:0');
 }
 yes(await scan({...x,marketSeries:[...x.marketSeries,{...x.marketSeries[1],indexChange:1,knownAt:day+' 15:01'}]}),'62:0');
});
const notice=(id,date,extra={})=>({code,source:'原披露',eventId:id,title:'股票交易异常波动公告',type:'股票交易异常波动公告',verified:true,publishedAt:date+' 10:00',knownAt:date+' 11:00',...extra});
const notices=()=>[notice('a','2026-11-17'),notice('b','2026-11-18'),notice('c','2026-11-19')];
const newsScan=announcements=>scan({b:bar(day,{announcements})});
test('C21.5 latest visible withdrawn or explicitly corrected original event cannot keep old warning active',async()=>{
 const rows=notices(),a=rows[0];yes(await newsScan(rows),'49:1');
 for(const patch of [{withdrawn:true},{retracted:true},{verified:false},{title:'原公告撤销'}]){
  missing(await newsScan([...rows,{...a,knownAt:day+' 10:00',...patch}]),'49:1');
 }
 yes(await newsScan([...rows,{...a,knownAt:day+' 15:01',withdrawn:true}]),'49:1');
});
test('C21.5 same-event same-clock conflicts, explicit unknown and same-id conflicting disclosure days are not independent notices',async()=>{
 const rows=notices(),a=rows[0];
 for(const edit of [{...a,verified:false},{...a,knownAt:null,receivedAt:at},{...a,source:'other',publishedAt:'2026-11-16 10:00'}]){
  missing(await newsScan([...rows,edit]),'49:1');
 }
 yes(await newsScan([...rows,{...a}]),'49:1');
});
test('C21.5 wrong-symbol or late correction does not erase the original independent disclosure',async()=>{
 const rows=notices(),a=rows[0];
 yes(await newsScan([...rows,{...a,code:'600002',knownAt:day+' 10:00',withdrawn:true}]),'49:1');
 const f=await newsScan(null);missing(f,'49:1');
});

test('C21.3 visible conflicting leader copy cannot be discarded beside a valid copy',async()=>{
 const b=bar(day,{sector:'设备',sectorRole:'跟风'}),f={position:'高位',ratio:2,sectorLeader:'600002'};
 const leader={code:'600002',date:day,sector:'设备',change:0,ratio:2};
 for(const rows of [[leader,{...leader,conflict:true}],[{...leader,conflict:true},leader]])
  missing(await scan({b,f,sector:{date:day,sector:'设备',memberQuotes:rows}}),'37:0');
 yes(await scan({b,f,sector:{date:day,sector:'设备',memberQuotes:[leader,{...leader,conflict:true,knownAt:day+' 15:01'}]}}),'37:0');
});
test('C21.2 conflicted or retracted minute does not establish repeated observed plunge',async()=>{
 const rows=[10,9.6,9.9,9.5].map((close,i)=>bar(day+' 10:0'+i,{period:'1分钟',close}));
 yes(await scan({intraday:rows}),'60:1');
 for(const flag of ['conflict','withdrawn','suspended']){
  const broken=rows.map((r,i)=>i===2?{...r,[flag]:true}:r);
  missing(await scan({intraday:broken}),'60:1');
  missing(await scan({intraday:[...rows,{...rows[2],[flag]:true}]}),'60:1');
 }
});
