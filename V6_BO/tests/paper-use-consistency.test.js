'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const epoch=Date.parse('2026-11-13T10:00:00+08:00');
function harness(){
 let now=epoch;const sold=[];
 const c={S:{lastPx:new Map(),stocks:[],stocksAt:epoch,candidatePool:[],trendPool:[]},Map,Date:{now:()=>now},
  require:require('node:module').createRequire(require.resolve('../server.js')),limitPctOfCode:()=>.1,
  PAPER_CFG:{pool:{tp:.08,sl:-.03,expireDays:4}},PAPER:{pool:{enabled:true,positions:{}}},paperTouch(){},
  tradeDaysSince:()=>1,paperT1Locked:()=>false,isLimitDownPrice:()=>false,linkedStop:()=>-.03,effStopOf:()=>-.03,
  paperSell:(...args)=>sold.push(args)};
 const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
 vm.runInNewContext(section('function paperAuthorityQuotes(){','refreshPaperAuthority();')+'\n'+
  section('function ingestPx(rows)','function paperEquity(key, pm)')+'\n'+section('function paperCheck(key, pm)','function paperCheckAll(pm)'),c);
 return {c,sold,clock:value=>{now=value;}};
}
const quote=(patch={})=>({code:'600000',price:10,preClose:10,volume:100000,quoteAt:epoch-1000,receivedAt:epoch,quoteSource:'tencent',canTrade:true,...patch});
test('full-A fallback, authority and risk marks enforce the same original-row use gate',()=>{
 const bad=[{receivedAt:undefined},{receivedAt:0},{receivedAt:epoch+1},{receivedAt:epoch-2000},
  {canTrade:undefined},{canTrade:false},{readOnlyBackup:true},{imported:true},{fixture:true},{mock:true},
  {synthetic:true},{simulated:true},{quoteMode:'research'},{quoteSource:'mock-feed'},
  {tradable:false},{suspended:true},{quoteAt:epoch-15001},{quoteAt:epoch+1},{price:'10'}];
 for(const patch of bad){
  const {c}=harness(),row=quote(patch);c.S.stocks=[row,quote({code:'600001'})];c.ingestPx([row]);
  assert.equal(c.S.lastPx.size,0,JSON.stringify(patch));assert.equal(c.paperPxFresh(row.code),0,JSON.stringify(patch));
  const q=c.paperAuthorityQuotes();assert.equal(q[row.code],undefined,JSON.stringify(patch));
  assert.equal(q['600001'].riskContext.marks[row.code],undefined,JSON.stringify(patch));
 }
});
test('read-only full-A prices remain displayable without raising the holding profit peak or selling',()=>{
 const {c,sold}=harness(),row=quote({price:20,readOnlyBackup:true});c.S.stocks=[row];
 const pos={code:row.code,buyPrice:10,lastPrice:10,shares:100,peak:.03,buyTs:epoch-86400000};
 c.PAPER.pool.positions[row.code]=pos;c.paperCheck('pool',c.paperPrices());
 assert.equal(pos.lastPrice,20);assert.equal(pos.pxStale,true);assert.equal(pos.peak,.03);assert.equal(sold.length,0);
});
test('cached price-only legacy marks cannot authorize live decisions or risk marks',()=>{
 const {c}=harness();c.S.lastPx.set('600000',{p:20,t:epoch,quoteAt:epoch-500,quoteSource:'tencent'});
 c.S.stocks=[quote({code:'600001'})];
 assert.equal(c.paperPxFresh('600000'),0);assert.equal(c.paperAuthorityQuotes()['600001'].riskContext.marks['600000'],undefined);
});
test('fresh restored-looking marks require original permission and receive evidence at consumption',()=>{
 const {c}=harness();c.ingestPx([quote()]);assert.equal(c.paperPxFresh('600000'),10);
 const cached=c.S.lastPx.get('600000');cached.wireQuote.canTrade=false;
 assert.equal(c.paperPxFresh('600000'),0);assert.equal(c.paperAuthorityQuotes()['600000'],undefined);
});
test('15-second boundary and cross-day rejection stay identical across consumers',()=>{
 const {c,clock}=harness();c.S.stocks=[quote({quoteAt:epoch})];c.ingestPx(c.S.stocks);
 clock(epoch+15000);assert.equal(c.paperPxFresh('600000'),10);assert.equal(c.paperAuthorityQuotes()['600000'].price,10);
 clock(epoch+15001);assert.equal(c.paperPxFresh('600000'),0);assert.equal(c.paperAuthorityQuotes()['600000'],undefined);
 const midnight=Date.parse('2026-11-14T00:00:00+08:00');clock(midnight+1000);c.S.stocksAt=midnight;
 c.S.stocks=[quote({quoteAt:midnight-1000,receivedAt:midnight})];
 assert.equal(c.paperPxFresh('600000'),0);assert.equal(c.paperAuthorityQuotes()['600000'],undefined);
});
