'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sourcePath=path.resolve(__dirname,'../src/strategy/model-experiment.js');
const ledgerPath=path.resolve(__dirname,'../src/strategy/research-v2-position-ledger-backtest.js');
const scannerPath=path.resolve(__dirname,'../src/strategy/research-v2-universe-scanner.js');
// Instrument the trainer and original ledger boundary, not the sample builder.
// No trained-performance assertion is made by these input-level counterexamples.
function harness(){
 const module={exports:{}},fits=[],scans=[],runs=[];
 const req=id=>{
  if(id==='node:child_process')return {spawnSync(_bin,_args,opts){
   const p=JSON.parse(opts.input);fits.push(p);
   return {status:0,stdout:JSON.stringify({version:'isolated-matrix-fixture',modelVersions:{ridge:'fixture'},scores:{ridge:p.test.map(()=>0)}})};
  }};
  if(id==='./research-v2-position-ledger-backtest')return {ledgerBacktest(opts){
   runs.push(opts);
   if(opts.selectCandidates)for(let day=opts.start;day<=opts.end;day++)opts.selectCandidates(opts.stocks.map(s=>({symbol:s.symbol})),day);
   return {metrics:{returnPct:0}};
  }};
  if(id==='./research-v2-universe-scanner')return {scanUniverse({stocks}){scans.push(stocks.map(s=>s.symbol));return {items:stocks.map(s=>({symbol:s.symbol,tradable:true}))};}};
  return require(id.startsWith('.')?path.resolve(path.dirname(sourcePath),id):id);
 };
 new Function('require','module','exports','__dirname',fs.readFileSync(sourcePath,'utf8'))(req,module,module.exports,path.dirname(sourcePath));
 return {run:module.exports.modelExperiment,fits,scans,runs};
}
function fixture(){
 const dates=[];for(let i=0;dates.length<104;i++){const d=new Date(Date.UTC(2025,0,2+i));if(d.getUTCDay()%6!==0)dates.push(d.toISOString().slice(0,10));}
 const stocks=Array.from({length:5},(_,j)=>({symbol:String(600000+j),market:'main',bars:dates.map((date,i)=>{
  const open=10+j+i*.02+.1*Math.sin(i/(j+3)),close=open+.02*Math.cos(i+j);
  return {date,open,high:Math.max(open,close)+.03,low:Math.min(open,close)-.03,close,volume:100000+i*5+j};
 })}));
 return {source:'simulated',splitDay:88,models:['ridge'],tradingDates:dates,stocks};
}
test('model experiment rejects adjusted raw dataset, stock or bar prices before calling the trainer',()=>{
 for(const patch of [d=>d.priceBasis='qfq',d=>d.priceAdjustment={mode:'unadjusted',provider:'eastmoney-public-history-fqt-1'},
  d=>d.stocks[0].priceBasis='hfq',d=>d.stocks[0].bars[5].priceAdjustment={mode:'unknown'}]){
  const h=harness(),d=fixture();patch(d);
  assert.throws(()=>h.run(d),/未复权|复权元数据/);assert.equal(h.fits.length,0);assert.equal(h.runs.length,0);
 }
});
test('declared late or invalid daily observations cannot become training features or latest baseline candidates',()=>{
 for(const late of [null,'2025-01-02 15:10:00','2026-01-01T15:10:00+08:00',1]){
  const h=harness(),d=fixture();d.stocks[0].bars[59].availableAt=late;
  const r=h.run(d);
  assert.equal(r.trainingRows,104);assert.equal(r.sampleAudit.training.rejected.RAW_WINDOW_NOT_KNOWN,26);
  assert.equal(r.latest.length,4);assert.ok(!r.latest.some(x=>x.symbol==='600000'));
  assert.ok(h.scans.length&&h.scans.every(group=>!group.includes('600000')));
  assert.equal(r.protocol.rawAvailability.declaredBars,1);assert.equal(r.protocol.rawAvailability.legacyUndeclaredBars,519);
 }
});
test('a label ending before the split is excluded if its declared observation is published at or after the split',()=>{
 const h=harness(),d=fixture(),end=87;
 d.stocks[0].bars[end].availableAt=d.tradingDates[d.splitDay]+'T00:00:00+08:00';
 const r=h.run(d);
 assert.equal(r.trainingRows,129);assert.equal(r.sampleAudit.training.rejected.LABEL_NOT_KNOWN_BEFORE_SPLIT,1);
 assert.equal(h.fits[0].x.length,129);assert.equal(h.fits[0].y.length,129);
 assert.ok(r.lastTrainingLabelDate<r.firstEvaluationDate);
 assert.equal(r.protocol.rawAvailability.purgedSignalSessions,2);
});
test('same-session declared daily availability and legacy omission preserve existing sample matrices',()=>{
 const d=fixture(),a=harness(),before=a.run(d);
 const original=JSON.stringify(a.fits[0]);
 d.priceBasis='unadjusted';
 for(const stock of d.stocks){
  stock.priceAdjustment={mode:'unadjusted'};
  // Separately adjusted research history is not execution-price metadata.
  stock.factorHistory={priceBasis:'adjusted',bars:[]};
  for(const b of stock.bars)b.availableAt=b.date+'T15:10:00+08:00';
 }
 const b=harness(),r=b.run(d);
 assert.equal(JSON.stringify(b.fits[0]),original);assert.equal(r.trainingRows,before.trainingRows);
 assert.equal(r.protocol.rawAvailability.declaredBars,520);assert.equal(r.protocol.rawAvailability.verifiedExternal,false);
});
