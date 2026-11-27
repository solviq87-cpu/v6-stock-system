'use strict';
// Deterministic historical research fixtures, never actual orders or market verification.
const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../public/nova/shortline/stock-risk-evidence.mjs');
const day='2026-11-20',code='600001',at=day+' 15:00';
const bar=(date,extra={})=>({code,date,role:'stock',period:'日K',open:10,high:10.1,low:9.9,close:10,volume:10000,...extra});
async function scan(extra={}){
 const {addStockRiskEvidence}=await modulePromise,facts=new Map();
 return addStockRiskEvidence({b:bar(day),asOf:at,...extra},facts);
}
const yes=(facts,...keys)=>keys.forEach(k=>assert.equal(facts.get(k)?.pass,true,k));
const missing=(facts,...keys)=>keys.forEach(k=>assert.equal(facts.has(k),false,k));
const h=()=>[bar('2026-11-18',{limitUp:10,streak:3,volume:40000}),bar('2026-11-19',{limitUp:10,streak:4,volume:30000,sector:'机器人',sectorAssists:4})];
const high=()=>({b:bar(day,{auctionGap:-6}),history:h(),f:{change:0,ratio:2}});
test('C6.1 conflicting daily observations cannot create a high-mark warning by input order',async()=>{
 const x=high(),last=x.history.at(-1),bad={...last,streak:1};
 for(const history of [[...x.history,bad],[x.history[0],bad,last]])missing(await scan({...x,history}),'11:0','30:0','30:3');
});
test('C6.1 equivalent visible daily duplicates do not destroy a genuine sequence',async()=>{
 const x=high();yes(await scan({...x,history:[...x.history,{...x.history.at(-1)}]}),'11:0','30:0','30:3');
});
test('C6.1 conflicting earlier volume interrupts the consecutive shrinking sequence',async()=>{
 const x=high(),history=[x.history[0],{...x.history[0],volume:1000},x.history[1]];
 const f=await scan({...x,history});yes(f,'30:0');missing(f,'30:3');
});
test('C6.1 explicit invalid previous-day reference cannot be silently replaced by a weekday guess',async()=>{
 const x=high();for(const previousDay of ['2026-11-20','2026-02-30','invalid'])missing(await scan({...x,b:{...x.b,previousDay}}),'30:0');
});
test('C6.2 negative assist count is unknown, not observed collapse',async()=>{
 const x={history:h(),b:bar(day,{streak:5,limitUp:10,sector:'机器人',sectorAssists:-1})};
 const f=await scan(x);yes(f,'40:0');missing(f,'40:1','20:1');
});
test('C6.2 real zero assists remains a verified adverse observation',async()=>{
 const f=await scan({history:h(),b:bar(day,{streak:5,limitUp:10,sector:'机器人',sectorAssists:0})});yes(f,'40:0','40:1','20:1');
});
const follow=(lead,quotes)=>({b:bar(day,{sector:'设备',sectorRole:'跟风'}),f:{sectorLeader:lead,position:'高位',ratio:2},sector:{date:day,memberQuotes:quotes}});
const leader=(extra={})=>({code:'600002',name:'设备龙头',date:day,sector:'设备',change:0,ratio:2,...extra});
test('C6.2 leader name or stock code must identify a real distinct stock',async()=>{
 for(const q of [leader({code:undefined}),leader({code:'bad'}),leader({role:'sector'}),leader({code})])missing(await scan(follow('设备龙头',[q])),'37:0');
 missing(await scan(follow('600099',[leader({name:'600099'})])),'37:0');
});
test('C6.2 unique valid leader and numeric code still verify while ambiguous or late evidence stays unknown',async()=>{
 yes(await scan(follow('600002',[leader()])),'37:0');
 yes(await scan(follow('设备龙头',[leader()])),'37:0');
 missing(await scan(follow('设备龙头',[leader(),leader({code:'600003'})])),'37:0');
 missing(await scan(follow('设备龙头',[leader({knownAt:day+' 15:01'})])),'37:0');
});
const hold=()=>({code,shares:100,avgCost:8,source:'历史持仓快照',observedAt:day+' 14:59',knownAt:at});
const plan=()=>({code,stopPrice:11,targetPrice:9,strategy:'连板接力战法',frozenAt:day+'T01:00:00Z'});
test('C6.3 late explicit plan receipts cannot cause hindsight stop, target or regime mismatch',async()=>{
 for(const key of ['firstKnownAt','knownAt','availableAt','receivedAt','recordedAt']){
  const f=await scan({b:bar(day,{holdingSnapshot:hold(),frozenPlan:{...plan(),[key]:day+' 15:01'}}),stage:'退潮'});
  yes(f,'64:0');missing(f,'52:0','53:1','67:0');
 }
});
test('C6.3 malformed, unknown or reversed freeze receipt cannot become a known plan',async()=>{
 for(const patch of [{frozenAt:day},{knownAt:null},{receivedAt:'invalid'},{recordedAt:day+' 08:59'}]){
  const f=await scan({b:bar(day,{holdingSnapshot:hold(),frozenPlan:{...plan(),...patch}}),stage:'退潮'});missing(f,'52:0','53:1','67:0');
 }
});
test('C6.3 valid original receipt preserves research facts; fractional holding cannot assert position',async()=>{
 const p={...plan(),receivedAt:day+' 09:01'};
 yes(await scan({b:bar(day,{holdingSnapshot:hold(),frozenPlan:p}),stage:'退潮'}),'52:0','53:1','64:0','67:0');
 missing(await scan({b:bar(day,{holdingSnapshot:{...hold(),shares:1.5},frozenPlan:p})}),'64:0','52:0');
});
test('C6.3 actual backtest selector excludes late and same-second future freeze, retains unique visible plan',async()=>{
 const {selectFrozenRiskPlan}=await modulePromise;
 const cutoff=Date.parse(day+'T10:00:00+08:00'),p={code,intendedDate:day,frozenAt:day+'T09:00:00+08:00',entryMax:12,stop:11,target:13,strategy:'连板接力战法'};
 assert.equal(selectFrozenRiskPlan([{...p,knownAt:cutoff+1}],code,day,cutoff),null);
 assert.equal(selectFrozenRiskPlan([{...p,frozenAt:day+'T10:00:00.001+08:00'}],code,day,cutoff),null);
 assert.equal(selectFrozenRiskPlan([{...p,knownAt:cutoff}],code,day,cutoff).stopPrice,11);
 assert.equal(selectFrozenRiskPlan([p,{...p,stop:10}],code,day,cutoff),null);
});
const depth=()=>({bid1:9.8,ask1:10.2,quoteAt:day+' 14:59',quoteReceivedAt:day+' 14:59',quoteSource:'盘口'});
test('C6.4 conflict flags block unsupported bid-ask spread evidence',async()=>{
 for(const patch of [{sourceConflict:true},{conflict:true},{quoteStatus:'conflict'},{evidenceStatus:'conflict'},{suspended:true}]){
  missing(await scan({b:bar(day,{...depth(),...patch})}),'57:1');
 }
});
test('C6.4 original suspension cannot be erased or replaced by contradictory quotes',async()=>{
 const f=await scan({b:bar(day,{...depth(),tradingStatus:'停牌',sourceConflict:true})});yes(f,'57:1');assert.match(f.get('57:1').source,/停牌/);
 yes(await scan({b:bar(day,depth())}),'57:1');
 missing(await scan({b:bar(day,{...depth(),quoteAt:day+' 10:00'})}),'57:1');
});
const minute=(m,close,extra={})=>bar(day+' '+m,{period:'1分钟',close,...extra});
const fall=()=>[minute('10:00',10),minute('10:01',9.6),minute('10:02',9.9),minute('10:03',9.5)];
test('C6.5 conflicting duplicate minute and alias of same timestamp cannot generate a repeated plunge',async()=>{
 const rows=fall(),duplicate={...rows[3],close:10.2},alias={...duplicate,date:duplicate.date.replace(' ','T')};
 for(const intraday of [[...rows,duplicate],[...rows.slice(0,3),duplicate,rows[3]],[...rows,alias]])missing(await scan({intraday}),'60:1');
});
test('C6.5 explicit invalid duplicate value cannot be filtered away before conflict detection',async()=>{
 const rows=fall();missing(await scan({intraday:[...rows,{...rows[3],close:null}]}),'60:1');
});
test('C6.5 lunch, premarket or after-session sequences cannot claim continuous trading plunges',async()=>{
 for(const times of [['11:29','11:30','11:31','11:32'],['08:30','08:31','08:32','08:33'],['15:00','15:01','15:02','15:03']]){
  missing(await scan({intraday:times.map((m,i)=>minute(m,[10,9.6,9.9,9.5][i]))}),'60:1');
 }
});
test('C6.5 identical duplicates deduplicate; real continuous morning and afternoon plunges stay visible',async()=>{
 const rows=fall();yes(await scan({intraday:[...rows.slice(0,2),{...rows[1]},...rows.slice(2)]}),'60:1');
 yes(await scan({intraday:['13:00','13:01','13:02','13:03'].map((m,i)=>minute(m,[10,9.6,9.9,9.5][i]))}),'60:1');
});
test('C6.5 late conflicting minute cannot rewrite earlier visible history',async()=>{
 const rows=fall();yes(await scan({intraday:[...rows,{...rows[3],close:10.2,knownAt:day+' 15:01'}]}),'60:1');
});
