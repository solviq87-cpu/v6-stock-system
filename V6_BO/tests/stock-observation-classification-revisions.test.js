'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {retainStockObservation:retain,readObservedStock:read}=require('../src/core/stock-observation-store');
const {archivedOutcome}=require('../src/core/probability-reliability-sources');
const initial=Date.parse('2026-11-12T15:30:00+08:00'),firstDay='2026-11-11',lastDay='2026-11-12';
const identity={provider:'eastmoney',priceBasis:'unadjusted'};
const bar=(date,close)=>({date,open:10,high:12,low:9,close,volume:1000,suspended:false,tradable:true,isST:false,corporateAction:false});
function stock(){return {scope:'formal',symbol:'600001',name:'隔离样本',source:'eastmoney-public-history',...identity,bars:[bar(firstDay,10),bar(lastDay,11)]};}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-classification-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let now=initial;t.mock.method(Date,'now',()=>now);return {root,advance:()=>now+=1000,now:()=>now};}
const statuses=view=>view.sampleClassification.rows.map(row=>row.status);
const files=root=>fs.readdirSync(root,{recursive:true}).filter(name=>/^\d{6}\.json$/.test(path.basename(name))).sort().map(name=>path.join(root,name));
test('a new adverse raw scope or context is retained even when the market projection is unchanged',t=>{
 const f=fixture(t);
 for(const mark of ['context','raw']){
  const root=path.join(f.root,mark),at=f.now(),input=stock(),first=retain(root,{stock:input,observedAt:at}),original=fs.readFileSync(files(root)[0]);
  const before=read(root,input.symbol,{...identity,asOf:at});assert.deepEqual(statuses(before),['standard-declared','standard-declared']);
  const next=structuredClone(input),context=mark==='context'?{sampleScope:'demo'}:{};if(mark==='raw')next.synthetic=true;
  f.advance();const result=retain(root,{stock:next,observedAt:f.now(),context});assert.equal(result.changed,true);assert.equal(result.revision,2);
  const current=read(root,input.symbol,{...identity,asOf:f.now()});assert.deepEqual(statuses(current),['nonstandard','nonstandard']);
  assert.deepEqual(current.stock.bars,first.stock.bars,'classification cannot refresh price/status time');
  assert.deepEqual(read(root,input.symbol,{...identity,asOf:at}),before);assert.deepEqual(fs.readFileSync(files(root)[0]),original);
  f.advance();assert.equal(retain(root,{stock:next,observedAt:f.now(),context}).changed,false);
  f.advance();assert.equal(retain(root,{stock:input,observedAt:f.now()}).changed,false);
  assert.deepEqual(statuses(read(root,input.symbol,identity)),['nonstandard','nonstandard']);assert.equal(files(root).length,2);
 }
});
test('an adverse declaration on one existing bar isolates only that date without adding fake market data',t=>{
 const f=fixture(t),input=stock(),first=retain(f.root,{stock:input,observedAt:f.now()});
 const next={...input,bars:[{...input.bars[1],provenance:{isTest:true}}]};
 // Preserve an already archived provenance envelope; the later negative
 // declaration must still reach the raw journal even when projection dedups it.
 const initialStock={...input,bars:input.bars.map(b=>({...b,provenance:{rawHash:'initial'}}))};
 // This separate root avoids changing the first evidence while exercising the
 // same existing-bar/unchanged-projection path.
 const another=path.join(f.root,'another');retain(another,{stock:initialStock,observedAt:f.now()});
 f.advance();assert.equal(retain(another,{stock:next,observedAt:f.now()}).revision,2);
 const r=read(another,input.symbol,identity);assert.deepEqual(statuses(r),['standard-declared','nonstandard']);
 assert.equal(r.stock.bars[1].priceKnownAt,first.stock.bars[1].priceKnownAt);
 assert.deepEqual(r.stock.bars[1].provenance,{rawHash:'initial'});
});
test('known contamination of unchanged observations invalidates a previously available probability label at current as-of only',t=>{
 const f=fixture(t),input=stock(),prediction={id:'fixture-signal',fingerprint:'a'.repeat(64),code:input.symbol,signalDay:firstDay,targetDay:lastDay};
 const plan={target:'upNext',sourcePolicy:{predictionChannel:'model',outcomeProvider:'eastmoney'}};
 retain(f.root,{stock:input,observedAt:f.now()});const evaluate=now=>archivedOutcome(plan,prediction,{}, {observationRoot:f.root,now});
 assert.equal(evaluate(initial).value,true);f.advance();retain(f.root,{stock:input,context:{repeatable:false},observedAt:f.now()});
 assert.throws(()=>evaluate(f.now()),/样本范围/);assert.equal(evaluate(initial).value,true);
});
