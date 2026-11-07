'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {freezeSignals,evaluateForwardOutcomes}=require('../src/strategy/signal-outcome-journal');
const {createSixLinkageRunner}=require('../src/core/six-linkage-research-runner');
const {main}=require('../scripts/run-six-linkages');
const asOf=d=>Date.parse(d+'T07:00:00Z');
function bars(last='2026-02-04',n=35){
 const end=Date.parse(last+'T00:00:00Z');
 const a=Array.from({length:n},(_,i)=>({date:new Date(end-(n-1-i)*86400000).toISOString().slice(0,10),
  open:10,close:10,low:9.8,high:10.2,volume:1000000,amount:120000000}));
 a.splice(-3,3,
  {...a.at(-3),open:9.8,close:10.1,low:9.7,high:10.15},
  {...a.at(-2),open:9.95,close:10.3,low:9.8,high:10.35},
  {...a.at(-1),open:10.1,close:10.5,low:9.9,high:10.55});
 return a;
}
function snapshot(date='2026-02-04',list=bars(date)){
 return {asOfMs:asOf(date),stocks:[{symbol:'600001',name:'测试股',feed:{source:'imported',timestamp:asOf(date)},
   bars:list,market:'main',tradable:true}],market:{}};
}
test('signal journal freezes actual observed signal and never records duplicate same-date events',()=>{
 const input=snapshot();
 const scan=scanUniverse({stocks:input.stocks,now:input.asOfMs});
 const frozen=freezeSignals({items:scan.items,stocks:input.stocks,now:input.asOfMs});
 assert.equal(frozen.added.length,1);
 assert.equal(frozen.added[0].code,'600001');
 assert.equal(frozen.added[0].date,'2026-02-04');
 assert.ok(frozen.added[0].names.includes('red_three_soldiers'));
 assert.equal(frozen.added[0].researchOnly,true);
 assert.equal(frozen.added[0].scoreBonus,0);
 assert.equal(JSON.stringify(frozen).includes('shares'),false);
 const repeat=freezeSignals({items:scan.items,stocks:input.stocks,now:input.asOfMs,journal:frozen.journal});
 assert.equal(repeat.added.length,0);
});
test('future price cannot leak into a point-in-time forward label before its observation date',()=>{
 const input=snapshot();
 const scan=scanUniverse({stocks:input.stocks,now:input.asOfMs});
 const frozen=freezeSignals({items:scan.items,stocks:input.stocks,now:input.asOfMs});
 const later=[...input.stocks[0].bars];
 for(let i=1;i<=12;i++){
  const d=new Date(Date.parse('2026-02-04T00:00:00Z')+i*86400000).toISOString().slice(0,10);
  later.push({date:d,open:10.5,close:10.5+i*.1,low:10.3,high:10.7+i*.1,volume:1000000,amount:100000000});
 }
 const future={symbol:'600001',bars:later};
 const start=evaluateForwardOutcomes({journal:frozen.journal,stocks:[future],now:input.asOfMs});
 assert.equal(start.outcomes.length,0,'cannot record outcomes not yet known');
 const tomorrow=evaluateForwardOutcomes({journal:frozen.journal,stocks:[future],now:asOf('2026-02-05')});
 assert.deepEqual(tomorrow.outcomes.map(x=>x.horizon),[1]);
 const complete=evaluateForwardOutcomes({journal:frozen.journal,stocks:[future],now:asOf('2026-02-16')});
 assert.deepEqual(complete.outcomes.map(x=>x.horizon),[1,3,5,10]);
 assert.ok(complete.metrics[10].averageReturnPct>0);
 assert.equal(complete.metrics[1].evaluated,1);
 assert.equal(complete.outcomes[0].evidence,'historical-close, pre-cost');
});
test('runtime research state survives restart, rejects corruption and rejects backward snapshot',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-six-links-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const runner=createSixLinkageRunner({outputDir:dir}),input=snapshot();
 const first=runner.runOnce(input);
 assert.equal(first.scanTotal,1);
 assert.equal(first.newSignals,1);
 assert.equal(first.canTrade,false);
 assert.equal(first.canNotify,false);
 assert.equal(first.observations,1);
 assert.equal(createSixLinkageRunner({outputDir:dir}).read().journal.length,1);
 const second=createSixLinkageRunner({outputDir:dir}).runOnce(input);
 assert.equal(second.newSignals,0,'replaying a snapshot must not create a second event');
 assert.equal(second.recordedSignals,1);
 assert.throws(()=>runner.runOnce({...input,asOfMs:input.asOfMs-86400000}),/倒序/);
 const file=runner.stateFile;
 const tampered=fs.readFileSync(file,'utf8').replace('"revision":2','"revision":999');
 fs.writeFileSync(file,tampered);
 assert.throws(()=>runner.runOnce(input),/校验失败/);
});
test('command-line entry saves research output without private portfolio, and invalid input does not create a report',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v6-six-cli-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const inputPath=path.join(folder,'snapshot.json'),dir=path.join(folder,'out');
 fs.writeFileSync(inputPath,JSON.stringify(snapshot()));
 const reply=main([inputPath,dir]);
 assert.equal(reply.newSignals,1);
 assert.equal(reply.canTrade,false);
 assert.equal(reply.canNotify,false);
 const saved=fs.readFileSync(path.join(dir,'six-linkages-state.json'),'utf8');
 assert.ok(!saved.includes('"holdings"'));
 assert.throws(()=>main(['relative/file.json',dir]),/用法/);
 const invalidPath=path.join(folder,'broken.json');fs.writeFileSync(invalidPath,'{}');
 assert.throws(()=>main([invalidPath,dir]),/研究快照/);
});
test('research pipeline cannot introduce scores or push endpoints via the journal interface',()=>{
 const moduleText=fs.readFileSync(require.resolve('../src/strategy/signal-outcome-journal'),'utf8');
 assert.ok(!moduleText.includes('pushAll('));
 assert.ok(!moduleText.includes('sendOrder('));
 const script=fs.readFileSync(require.resolve('../scripts/run-six-linkages'),'utf8');
 assert.match(script,/离线研究文件已写入/);
});
