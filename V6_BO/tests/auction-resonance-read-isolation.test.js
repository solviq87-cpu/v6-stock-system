'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
const match=/async function auctionResonanceScan\(opts = \{\}\) \{[\s\S]*?\n\}\n/.exec(server);
const now=Date.parse('2026-11-09T09:25:45+08:00');
function engine(){
 assert.ok(match,'missing real scan function');
 const events={pushed:0,logged:0,computed:0,klineFetches:0,smoothPreviews:0,smoothWrites:0,errors:[]};
 const S={
  stocks:[
   {code:'000001',name:'A1',price:10.2,pct:2.2},
   {code:'000002',name:'A2',price:10.3,pct:2.3}
  ],stocksAt:now-20000,klines:new Map(),
  sectors:[{name:'半导体',mainInflow:100000000,pct:2.5}],
  auction:{date:'20261109',phase:3,time:'09:25:07',
   strong:[
    {code:'000001',auctionPct:2.2,score:75,auctionAmount:4500000},
    {code:'000002',auctionPct:2.3,score:70,auctionAmount:4000000}
   ]}
 };
 class Clock extends Date{static now(){return now;}}
 const context={
  Date:Clock,Math,Number,Map,Set,String,
  S,AUCTION_RESONANCE_CACHE_MS:30000,_auctionResonanceCache:new Map(),
  require:name=>{
   if(name==='./src/core/auction-resonance-basis')
    return require('../src/core/auction-resonance-basis');
   if(name==='./src/core/news-china-clock')
    return require('../src/core/news-china-clock');
   throw Error('unexpected import '+name);
  },
  A:{isMainBoard:()=>true,isGEM:()=>false,isMainOrGEM:()=>true,
   isJunkName:()=>false,limitPctOf:()=>10},
  capTooSmall:()=>false,
  sectorOfStock:()=> '半导体',
  loadSectorHistory:()=>{events.computed++;return {};},
  quoteDayOf:()=> '20261109',
  buildZTRoleMap:()=>new Map(),
  maxDrawdown:()=>null,
  scoreSmoothOf:(code,score,dryRun=false)=>{
   if(dryRun)events.smoothPreviews++;else events.smoothWrites++;
   return {score:Math.round(score),rawScore:Math.round(score),trend:0,trendText:'平稳'};
  },
  empNdProb:()=>null,
  isTradeDay:()=>true,
  isTradingTime:()=>true,
  klineRows:async()=>{events.klineFetches++;return [];},
  pushAuctionResonanceTop3:()=>{events.pushed++;},
  logSignal:()=>{events.logged++;},
  console:{error:(...args)=>events.errors.push(args.map(String).join(' '))}
 };
 const scan=vm.runInNewContext(match[0]+'\nauctionResonanceScan;',context);
 return {scan,S,events};
}
test('viewer GET recomputes market research without push, learning writes or trading commands',async()=>{
 const {scan,events}=engine();
 const r=await scan({board:'all',max:2,force:false});
 assert.equal(r.items.length,2,JSON.stringify({result:r,events}));
 assert.equal(r.auctionEvidence.status,'same-day-capture-unverified');
 assert.equal(r.items[0].auctionInputStatus,'auction-snapshot-unverified');
 assert.equal(r.items[0].auctionQuoteAt,null);
 assert.equal(r.auctionEvidence.providerQuoteAt,null);
 assert.equal(events.pushed,0);
 assert.equal(events.logged,0);
 assert.equal(events.klineFetches,0,'viewer must not trigger a historical Kline fetch');
 assert.equal(events.smoothWrites,0,'viewer must not update EMA state');
 assert.equal(events.smoothPreviews,2);
 assert.ok(events.computed>=1);
});
test('different page max counts do not poison 30 second board cache',async()=>{
 const {scan,events}=engine();
 const first=await scan({board:'all',max:1});
 assert.equal(first.items.length,1,JSON.stringify({result:first,events}));
 const computed=events.computed;
 const larger=await scan({board:'all',max:2});
 assert.equal(larger.items.length,2,'max=2 must not be truncated by prior max=1 reader');
 assert.equal(events.computed,computed+1,'new max needs one new projection');
 const smallAgain=await scan({board:'all',max:1});
 assert.equal(smallAgain.items.length,1);
 assert.equal(events.computed,computed+1,'smaller max reuses larger cached result');
 assert.equal(events.pushed,0);assert.equal(events.logged,0);
});
test('only internal scheduled scan may emit existing legacy learning/Feishu event',async()=>{
 const {scan,events}=engine();
 await scan({board:'all',max:2,force:true});
 assert.equal(events.logged,0);assert.equal(events.pushed,0,'editor force is not authorization for broadcast');
 await scan({board:'all',max:2,force:true,internal:true});
 assert.equal(events.logged,2,JSON.stringify(events));
 assert.equal(events.pushed,1);
 assert.ok(events.klineFetches>=2,'server scheduled scan retains normal internal Kline ability');
 assert.ok(events.smoothWrites>=2,'server owned scan may record actual smoothing observations');
});
test('Friday recovered auction and Monday stock quotes never mix; internal tick refuses stale send',async()=>{
 const {scan,S,events}=engine();
 S.auction.date='20261106';
 const r=await scan({board:'all',max:2,internal:true,force:true});
 assert.ok(r.auctionEvidence,JSON.stringify({result:r,events}));
 assert.equal(r.auctionEvidence.status,'stale-auction-snapshot');
 assert.equal(r.auctionEvidence.eligibleForAuctionEvidence,false);
 assert.equal(r.items.length,2,'sector-only read-only observations can remain visible');
 assert.ok(r.items.every(x=>x.auctionPct===null&&x.auctionInputStatus==='sector-only'));
 assert.equal(events.pushed,0);
 assert.equal(events.logged,0);
 S.auction.date='20261109';S.auction.phase=0;S.auction.time='11:15:00';
 const r2=await scan({board:'all',max:2,internal:true,force:true});
 assert.equal(r2.auctionEvidence.status,'unverifiable-auction-phase');
 assert.ok(r2.items.every(x=>x.auctionPct===null));
 assert.equal(events.pushed,0);
 assert.equal(events.logged,0);
});
test('Monday 09:00 with Friday old snapshot cannot be treated as current auction even when quoteBasis is Friday',async()=>{
 const {scan,S,events}=engine();
 const origDate=S.auction.date,origAt=S.stocksAt;
 S.auction.date='20261106';
 S.stocksAt=Date.parse('2026-11-06T15:00:00+08:00');
 // Even in a preopen integration the pure guard must reject old-Friday evidence.
 const basis=require('../src/core/auction-resonance-basis').auditAuctionResonanceBasis({
  auction:S.auction,stockSnapshotAt:S.stocksAt,
  now:Date.parse('2026-11-09T09:00:00+08:00'),
  calendarDay:'20261109',expectedDay:'20261106',stockSnapshotDay:'20261106'
 });
 assert.equal(basis.eligibleForAuctionEvidence,false);
 assert.equal(basis.status,'stale-auction-snapshot');
 S.auction.date=origDate;S.stocksAt=origAt;
 assert.equal(events.logged,0);assert.equal(events.pushed,0);
});
test('pure EMA preview leaves global trend map unchanged, internal observation still advances',()=>{
 const match=/function scoreSmoothOf\(code, raw, dryRun = false\) \{[\s\S]*?\n\}/.exec(server);
 assert.ok(match);
 const hist=new Map();
 class Clock extends Date{static now(){return now;}}
 const fn=vm.runInNewContext(match[0]+'\nscoreSmoothOf;',{Date:Clock,Math,Array,Map,
  _scoreHist:hist});
 const initial=fn('000001',80,true);
 assert.equal(initial.rawScore,80);
 assert.equal(hist.size,0,'preview without prior observation cannot create EMA state');
 fn('000001',50);
 const old=JSON.stringify([...hist.entries()]);
 fn('000001',95,true);
 assert.equal(JSON.stringify([...hist.entries()]),old,'preview must not mutate nested history arrays');
 fn('000001',95);
 assert.notEqual(JSON.stringify([...hist.entries()]),old,'internal event updates EMA');
});
test('public browser route does not pass hidden internal flag; server scheduler is guarded',()=>{
 assert.match(server,/await auctionResonanceScan\(\{ force, max, board \}\)/);
 const route=server.slice(server.indexOf("if (p === '/api/auction-resonance')"),
  server.indexOf('// jz 轮',server.indexOf("if (p === '/api/auction-resonance')")));
 assert.doesNotMatch(route,/internal\s*:/);
 const scheduler=server.slice(server.indexOf("setInterval(guard('auction-resonance-internal'"),
  server.indexOf("  // ── 竞价「早班车」预览："));
 assert.match(scheduler,/isReplica\(\)/);
 assert.match(scheduler,/isTradeDay\(clock\)/);
 assert.match(scheduler,/minute >= 9 \* 60 \+ 30/);
 assert.match(scheduler,/Date\.now\(\)-S\.stocksAt > 120000/);
 assert.match(scheduler,/await auctionResonanceScan\(\{force:true,max:40,board:'all',internal:true\}\)/);
});
