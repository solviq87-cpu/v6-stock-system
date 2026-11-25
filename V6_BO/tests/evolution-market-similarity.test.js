'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../public/nova/shortline');
const {signals,parseKCsv,similarCases}=require(path.join(base,'backtest.mjs'));
function archive(){
 const bars=parseKCsv(fs.readFileSync(path.join(base,'sample-kline.csv'),'utf8'));
 for(const b of bars)if(!b.role||b.role==='stock')Object.assign(b,{amount:b.volume*10,auctionGap:2,first15mChange:1.5,last30mChange:0,newsSource:'同日公告原文',newsPublishedAt:b.date.slice(0,10)+' 08:00',newsKnownAt:b.date.slice(0,10)+' 08:01',announcementType:'业绩预增',newsStatus:'已核实',newsCoverageComplete:true});
 const dates=[...new Set(bars.map(b=>b.date))].sort();
 const market=dates.map((date,i)=>({date,indexChange:i%2?1:-1,trend:'多头',availableAt:date+' 15:00'}));
 return {catalog:require(path.join(base,'catalog.json')),bars,market,corrections:[]};
}
test('32 extended snapshot uses amount, relative strength, auction, intraday and same-time news with disclosed denominators',()=>{
 const s=archive(),all=signals(s),target=all.find(t=>similarCases(s,t).neighbours.length>0&&t.features.position!=='缺失');
 assert.ok(target);const r=similarCases(s,target);
 for(const key of ['amountState','relativeStrength','auctionState','intradayState','knownNews'])assert.ok(r.dimensions.includes(key),key);
 assert.equal(r.dimensions.length,11);assert.equal(r.coverage.matched,r.neighbours.length);
 assert.equal(r.coverage.mature+r.coverage.unavailable,r.neighbours.length);
 assert.equal(r.coverage.comparable+r.coverage.incomplete,r.coverage.eligible);
 for(const neighbour of r.neighbours){assert.equal(neighbour.similarity,neighbour.coverage.matched/neighbour.coverage.total);assert.ok(neighbour.coverage.comparable<=neighbour.coverage.total);}
});
test('32 later news revisions and future OHLCV cannot alter earlier similarity order',()=>{
 const s=archive(),target=signals(s).find(t=>similarCases(s,t).neighbours.length>0),before=similarCases(s,target);
 const future=structuredClone(s);
 for(const b of future.bars)if(b.date>target.date)Object.assign(b,{close:999,high:1000,volume:1e12,announcementType:'后来事实',newsKnownAt:b.date.slice(0,10)+' 16:00'});
 assert.deepEqual(similarCases(future,target),before);
 const unproven=structuredClone(s),chosen=unproven.bars.find(b=>b.code===target.code&&b.date===target.date);
 chosen.newsKnownAt=chosen.date.slice(0,10)+' 15:01';
 const late=signals(unproven,target.date).find(t=>t.id===target.id);
 assert.equal(late.features.knownNews,'缺失');assert.ok(similarCases(unproven,late).optionalMissing.includes('当时已知消息'));
 chosen.announcementType='另一个后来消息';
 assert.equal(signals(unproven,target.date).find(t=>t.id===target.id).features.knownNews,'缺失');
});
test('32 unavailable optional inputs cannot increase a candidate rank or erase failure denominators',()=>{
 const s=archive(),target=signals(s).find(t=>similarCases(s,t).neighbours.length>0),report=similarCases(s,target);
 const id=report.neighbours[0].id,code=report.neighbours[0].code,date=report.neighbours[0].date;
 const weaker=structuredClone(s),bar=weaker.bars.find(b=>b.code===code&&b.date===date);
 delete bar.auctionGap;delete bar.first15mChange;delete bar.last30mChange;
 const next=similarCases(weaker,target),candidate=next.neighbours.find(n=>n.id===id);
 if(candidate)assert.ok(candidate.similarity<=report.neighbours[0].similarity);
 assert.equal(next.success.length+next.failure.length+next.neutral.length,next.coverage.mature);
 assert.equal(next.excursions[5].n,next.coverage.mature);
 assert.equal(next.distributions[5].n,next.coverage.mature);
});
