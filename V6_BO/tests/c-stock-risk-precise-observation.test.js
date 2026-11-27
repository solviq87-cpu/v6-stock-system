'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-20',code='600001',at=day+' 15:00';
const bar=(extra={})=>({code,date:day,role:'stock',period:'日K',open:10,high:10.1,low:9.9,close:10,volume:10000,...extra});
async function scan(extra={}){return (await api).addStockRiskEvidence({b:bar(),asOf:at,...extra},new Map());}
const yes=(f,...ks)=>ks.forEach(k=>assert.equal(f.get(k)?.pass,true,k));
const missing=(f,...ks)=>ks.forEach(k=>assert.equal(f.has(k),false,k));
const depth={bid1:9.8,ask1:10.2,quoteSource:'盘口',quoteAt:day+' 14:59',quoteReceivedAt:at};
const hold={code,shares:100,avgCost:8,source:'历史持仓',observedAt:day+' 14:59',knownAt:at};
const plan={code,frozenAt:day+' 09:00',stopPrice:11,targetPrice:9,strategy:'连板接力战法'};
const note={code,source:'本人交易日志',decisionId:'note',decisionAt:day+' 10:00',recordedAt:day+' 10:05',motive:'赌回流'};
test('C22.1 date-only quote and receipt cannot impersonate real observation clocks',async()=>{
 yes(await scan({b:bar(depth)}),'57:1');
 for(const patch of [{quoteAt:day},{quoteReceivedAt:day}])missing(await scan({b:bar({...depth,...patch})}),'57:1');
});
test('C22.1 date-only holding and current receipt are not precise observation evidence',async()=>{
 yes(await scan({b:bar({holdingSnapshot:hold,knownAt:at})}),'64:0');
 missing(await scan({b:bar({holdingSnapshot:{...hold,knownAt:day}})}),'64:0');
 assert.equal((await scan({b:bar({knownAt:day,holdingSnapshot:hold})})).size,0);
});
test('C22.1 rolled civil dates cannot become frozen decisions',async()=>{
 const a=await api,c=Date.parse(day+'T15:00:00+08:00'),base={code,intendedDate:day,entryMax:12,stop:11,target:13};
 for(const frozenAt of ['2026-11-19T24:00:00+08:00','2026-02-30T09:00:00+08:00','2026-11-19 24:00'])
   assert.equal(a.selectFrozenRiskPlan([{...base,frozenAt}],code,day,c),null);
 assert.equal(a.selectFrozenRiskPlan([{...base,frozenAt:day+'T01:00:00Z'}],code,day,c).stopPrice,11);
});
test('C22.1 date-only announcement receipt cannot establish a third precise notice',async()=>{
 const rows=['17','18','19'].map((d,i)=>({code,source:'原披露',eventId:String(i),title:'股票交易异常波动公告',type:'股票交易异常波动公告',verified:true,publishedAt:'2026-11-'+d+' 10:00',knownAt:'2026-11-'+d+' 11:00'}));
 yes(await scan({b:bar({announcements:rows})}),'49:1');
 missing(await scan({b:bar({announcements:[...rows.slice(0,2),{...rows[2],knownAt:'2026-11-19'}]})}),'49:1');
});
test('C22.2 conflicted holding snapshots never establish held-profit or stop facts',async()=>{
 yes(await scan({b:bar({holdingSnapshot:hold,frozenPlan:plan})}),'64:0','52:0');
 for(const flag of ['conflict','withdrawn','retracted'])missing(await scan({b:bar({holdingSnapshot:{...hold,[flag]:true},frozenPlan:plan})}),'64:0','52:0');
});
test('C22.2 conflicted or wrong-date plans cannot govern current held-position exits',async()=>{
 for(const patch of [{conflict:true},{withdrawn:true},{intendedDate:'2026-11-23'}]){
  const f=await scan({b:bar({holdingSnapshot:hold,frozenPlan:{...plan,...patch}}),stage:'退潮'});
  yes(f,'64:0');missing(f,'52:0','53:1','67:0');
 }
 yes(await scan({b:bar({holdingSnapshot:hold,frozenPlan:{...plan,intendedDate:day}}),stage:'退潮'}),'52:0','53:1','67:0');
});
test('C22.2 withdrawn self-report and conflicting frozen plan rejected',async()=>{
 yes(await scan({b:bar({traderRecord:note})}),'70:1');
 missing(await scan({b:bar({traderRecord:{...note,retracted:true}})}),'70:1');
 const a=await api,c=Date.parse(day+'T15:00:00+08:00');
 assert.equal(a.selectFrozenRiskPlan([{...plan,conflict:true}],code,day,c),null);
});
test('C22.3 explicitly invalid market cannot assert stage mismatch',async()=>{
 const b=bar({frozenPlan:plan,holdingSnapshot:hold});
 for(const market of [{date:day,knownAt:null},{date:'2026-11-19'},{date:day,sourceConflict:true},{conflict:true}]){
  const f=await scan({b,market,stage:'退潮'});yes(f,'64:0');missing(f,'67:0');
 }
 yes(await scan({b,market:{date:day},stage:'退潮'}),'67:0');
 yes(await scan({b,stage:'退潮'}),'67:0');
});
test('C22.3 invalid market does not turn holding profit into divergence exit',async()=>{
 const b=bar({sector:'设备',holdingSnapshot:hold}),sector={date:day,sector:'设备',change:-3};
 const f=await scan({b,sector,stage:'分歧',market:{date:day,withdrawn:true}});
 yes(f,'64:0','64:2');missing(f,'53:2');
 yes(await scan({b,sector,stage:'分歧',market:{date:day}}),'53:2');
});
const prev='2026-11-19',group={name:'设备',count:2,members:[{code,level:1,firstSealTime:'093000'},{code:'600002',level:1,firstSealTime:'093500'}]};
const themeScan=themes=>scan({b:bar({sector:'设备',open:9,low:9,limitDown:9}),market:{date:day,previousDay:prev},marketSeries:[{date:prev,themes}]});
test('C22.4 malformed theme arrays and members do not crash or assert reversal',async()=>{
 yes(await themeScan([group]),'30:1');
 for(const themes of [{},[null],[{...group,members:{length:2}}],[{...group,members:[group.members[0],null]}]])missing(await themeScan(themes),'30:1');
});
test('C22.4 conflicted theme or members and invalid first-board level rejected',async()=>{
 for(const g of [{...group,conflict:true},{...group,members:[group.members[0],{...group.members[1],withdrawn:true}]},{...group,members:[group.members[0],{...group.members[1],level:0}]}])missing(await themeScan([g]),'30:1');
 yes(await themeScan([group]),'30:1');
});
test('C22.5 next-session date must be real and calendar receipt precise',async()=>{
 const market={date:day,calendarSource:'交易日历',calendarKnownAt:day+' 10:00',nextTradingDay:'2026-11-26'};
 yes(await scan({market}),'58:0');
 for(const patch of [{nextTradingDay:'2026-11-31'},{calendarKnownAt:day},{calendarKnownAt:'2026-11-19 24:00'}])missing(await scan({market:{...market,...patch}}),'58:0');
});
