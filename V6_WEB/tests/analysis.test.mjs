import test from 'node:test';
import assert from 'node:assert/strict';
import {demoDataset,analyzeSnapshot,analyzeFactors,buildEvidenceSummary} from '../src/analysis.mjs';
const copy=x=>structuredClone(x);

test('deterministic demo yields usable research snapshots and distinct evidence summaries',()=>{
 const input=demoDataset();assert.deepEqual(input,demoDataset());
 const out=analyzeSnapshot(input);
 assert.equal(out.total,10);assert.equal(out.passed,10);assert.equal(out.autoTrade,false);
 assert.ok(out.items.every(s=>s.features&&s.patterns.usable&&s.evidence));
 assert.ok(out.items.some(s=>Number.isFinite(s.patterns.rps120)));
 assert.equal(out.simulated,true);
});
test('strict snapshot rejects unsafe symbols, duplicate dates and future evaluation dates',()=>{
 for(const mutate of [d=>d.stocks.push(d.stocks[0]),d=>d.stocks[0].symbol='<img>',
  d=>d.stocks[0].bars[2].date=d.stocks[0].bars[1].date,
  d=>d.asOf=Date.now()+86400000,d=>d.asOf-=86400000*20,
  d=>d.stocks[0].bars[3].date='2026-02-30']){
  const input=demoDataset();mutate(input);assert.throws(()=>analyzeSnapshot(input));
 }
});
test('turnover filtering fails missing amount while omission retains the historical research row',()=>{
 const input=demoDataset();delete input.stocks[0].bars.at(-2).amount;
 input.stocks[0].bars.at(-3).amount=null;
 const base=analyzeSnapshot(input);assert.equal(base.items[0].eligible,true);
 const filtered=analyzeSnapshot(input,{minAverageTurnover20:1});
 assert.equal(filtered.items[0].eligible,false);
 assert.ok(filtered.items[0].conditions.reasons.includes('TURNOVER20_UNKNOWN'));
 assert.equal(filtered.items[0].averageTurnover20,null);
});
test('tied feature ranks match the average-rank Spearman numerical oracle',()=>{
 const input=demoDataset(),base=input.stocks[0].bars.slice(0,63);
 input.stocks=input.stocks.slice(0,5).map((stock,j)=>{
  const bars=base.map(b=>({...b}));
  bars[60].close=10+[1,1,2,3,3][j]*.1;
  bars[60].high=Math.max(bars[60].high,bars[60].close);
  bars[60].low=Math.min(bars[60].low,bars[60].close);
  bars[61]={...bars[61],open:10,close:10,high:10.2,low:9.8};
  const exit=10*(1+(j+1)*.01);
  bars[62]={...bars[62],open:exit,close:exit,high:exit+.2,low:exit-.2};
  return {...stock,bars};
 });
 const feature=analyzeFactors(input).features.find(f=>f.name==='return5');
 assert.equal(feature.daily.length,1);assert.equal(feature.daily[0].samples,5);
 assert.ok(Math.abs(feature.meanRankIC-9/Math.sqrt(90))<1e-12);
});
test('future observation timestamp excludes snapshot and factor observations',()=>{
 const input=demoDataset();input.stocks[0].feed.timestamp=input.asOf+1;
 assert.equal(analyzeSnapshot(input).items[0].eligible,false);
 const result=analyzeFactors(input);
 assert.ok(result.features.every(f=>f.daily.every(d=>d.samples===9)));
});
test('daily factor reports use only matured labels and never mix later dates into earlier IC',()=>{
 const input=demoDataset(),before=analyzeFactors(input);
 assert.ok(before.features.every(f=>f.validDates>0));
 const end=input.stocks[0].bars.at(-3).date;
 assert.ok(before.features.every(f=>f.daily.at(-1).date===end));
 const changed=copy(input);
 for(const stock of changed.stocks){const bar=stock.bars.at(-1);bar.open*=2;bar.high=Math.max(bar.high,bar.open);}
 const after=analyzeFactors(changed);
 for(let i=0;i<before.features.length;i++)assert.deepEqual(
  before.features[i].daily.slice(0,-1),after.features[i].daily.slice(0,-1));
});
test('factor IC uses average ranks for ties, constants produce null rather than false evidence',()=>{
 const input=demoDataset();
 for(const stock of input.stocks)stock.bars=input.stocks[0].bars.map(b=>({...b}));
 const result=analyzeFactors(input);
 assert.ok(result.features.every(f=>f.meanRankIC===null&&f.validDates===0));
 assert.ok(result.features.every(f=>f.quantiles.every(q=>q.meanReturn===null)));
});
test('invalid and missing observations reduce per-date sample coverage, rather than creating labels',()=>{
 const input=demoDataset();input.stocks[0].bars[85].close=null;
 input.stocks[1].bars.splice(95,1);
 const result=analyzeFactors(input);
 assert.ok(result.features.every(f=>f.coverage<1));
 assert.ok(result.features[0].daily.some(d=>d.samples<10));
 const short=copy(input);short.stocks=short.stocks.slice(0,4);
 assert.ok(analyzeFactors(short).features.every(f=>f.validDates===0));
});
test('correlated signal duplicates cannot raise family count and bearish evidence is preserved',()=>{
 const a={id:'breakout20_liquid',label:'突破',side:'bullish'},b={id:'ma5_ma20_volume',label:'均线',side:'bullish'};
 const risk={id:'heavy_distribution',label:'放量长阴',side:'bearish'};
 const out=buildEvidenceSummary({matched:[a,a,b,risk,risk]});
 assert.equal(out.familyCount,1);assert.equal(out.uniquePositiveCount,2);assert.equal(out.rawPositiveCount,3);
 assert.equal(out.riskCount,1);assert.equal(out.confidence,null);assert.match(out.note,/不代表统计独立/);
});
test('historical feature disclosure is checked at its decision close, not the later report time',()=>{
 const input=demoDataset(),baseline=analyzeFactors(input),index=80;
 input.stocks[0].bars[index].publishedAt=input.stocks[0].bars[index+1].date+'T09:00:00+08:00';
 const changed=analyzeFactors(input),date=input.stocks[0].bars[index].date;
 for(let i=0;i<baseline.features.length;i++){
  const before=baseline.features[i].daily,after=changed.features[i].daily;
  assert.deepEqual(before.filter(d=>d.date<date),after.filter(d=>d.date<date));
  assert.equal(after.find(d=>d.date===date).samples,9);
  assert.equal(after.find(d=>d.date===input.stocks[0].bars[index+1].date).samples,10);
 }
});
function membership(input,eligible=()=>true){
 return input.stocks.map(stock=>({symbol:stock.symbol,from:stock.bars[0].date,through:stock.bars.at(-1).date,
  eligible:eligible(stock),source:'fixture-membership',knownAt:stock.bars[0].date+'T08:00:00+08:00'}));
}
test('nonmembers cannot influence factor ranks or snapshot cross-sectional RPS',()=>{
 const input=demoDataset();input.universeHistory=membership(input,s=>s.symbol!=='600010');
 const excluded=analyzeFactors(input),snapshot=analyzeSnapshot(input);
 const row=snapshot.items.find(s=>s.symbol==='600010');
 assert.equal(row.eligible,false);assert.ok(row.conditions.reasons.includes('UNIVERSE_NOT_ELIGIBLE'));
 assert.equal(row.patterns.rps120,undefined);
 const shock=copy(input);shock.stocks[9].bars.forEach(b=>{b.close*=10;b.open*=10;b.high*=10;b.low*=10;});
 assert.deepEqual(analyzeFactors(shock).features,excluded.features);
 const shocked=analyzeSnapshot(shock);
 assert.deepEqual(snapshot.items.slice(0,9).map(s=>s.patterns),shocked.items.slice(0,9).map(s=>s.patterns));
 const removed=copy(input);removed.stocks.pop();
 assert.deepEqual(analyzeFactors(removed).features,excluded.features);
});
test('membership disclosed after entry open cannot qualify an earlier close signal',()=>{
 const input=demoDataset(),stock=input.stocks[0],entry=stock.bars[81].date;
 input.universeHistory=membership(input).filter(row=>row.symbol!==stock.symbol);
 input.universeHistory.push(
  {symbol:stock.symbol,from:stock.bars[0].date,through:stock.bars[80].date,eligible:true,source:'fixture',knownAt:stock.bars[0].date+'T08:00:00+08:00'},
  {symbol:stock.symbol,from:entry,through:stock.bars.at(-1).date,eligible:true,source:'fixture',knownAt:entry+'T09:31:00+08:00'});
 const report=analyzeFactors(input).features[0];
 assert.equal(report.daily.find(d=>d.date===stock.bars[80].date).samples,9);
 assert.equal(report.daily.find(d=>d.date===entry).samples,10);
 const invalid=copy(input);invalid.universeHistory.push({...input.universeHistory[0]});
 assert.throws(()=>analyzeSnapshot(invalid),/重叠/);
});
test('actual vendor candle IDs map to their candle evidence family',()=>{
 const input=demoDataset(),checks=analyzeSnapshot(input).items[0].patterns.checks;
 for(const id of ['red_three_soldiers','bullish_engulfing','hammer_rebound','morning_star']){
  const signal=checks.find(row=>row.id===id);assert.ok(signal,id);
  assert.equal(buildEvidenceSummary({matched:[signal]}).families[0].id,'candle-structure');
 }
});
