'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../src/core/deep-research-evidence');
const at=x=>Date.parse(x+'+08:00');
const entry=at('2026-11-04T10:01:00'),exit=at('2026-11-05T11:01:00'),source='supplied-provider';
function paperArchive(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deep-research-paper-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {createPaperApplicationService}=require('../src/core/paper-application-service');
  const {importSettledPaperTrades}=require('../src/research/shortline-paper-import');
  let now=entry;const file=path.join(dir,'pool.json'),service=createPaperApplicationService({file,clock:()=>now,calendar:{isOpen:()=>true}});
  service.initialize(100000);
  for(const [id,side,price,stamp]of [['buy','buy',10,'2026-11-04T10:01:00'],['sell','sell',11,'2026-11-05T11:01:00']]){
    now=at(stamp);const date=stamp.slice(0,10);
    service.submit({orderId:id,side,quantity:100,symbol:'600000',limitPrice:price,tradeDate:date,strategyId:'fourteen'});
    service.fill(id,id+'-fill',{symbol:'600000',timestamp:now,source:'simulated',tradeDate:date,suspended:false,tradable:true,price,volume:1000000,volumeUnit:'shares',upperLimit:20,lowerLimit:5});
  }
  now+=60000;const archive={scope:'live',plans:[],trades:[]};importSettledPaperTrades(archive,{accountDir:dir,now});
  assert.equal(archive.trades.length,1);return {archive,now,file};
}
function depthAt(stamp,px,tag){
 const base={revision:1,source,sourceUrl:'https://example.org/research/'+tag,symbol:'600000',publishedAt:stamp,firstKnownAt:stamp,recordedAt:stamp,quoteAt:stamp,receivedAt:stamp,price:px,volumeUnit:'shares'};
 const auth={provider:source,status:'granted',scope:['depth-snapshot','trade-ticks'],evidenceId:'authorization-document',knownAt:entry-86400000,validFrom:entry-86400000,validUntil:exit+86400000};
 return [{...base,id:tag+'-book',granularity:'depth-snapshot',authorization:auth,bids:[{price:px-.01,quantity:200}],asks:[{price:px+.01,quantity:200}]},{...base,id:tag+'-ticks',granularity:'trade-ticks',authorization:auth,trades:[{id:tag+'-1',at:stamp-1000,price:px-.01,quantity:100,aggressor:'unknown'},{id:tag+'-2',at:stamp,price:px+.01,quantity:100,aggressor:'unknown'}]}];
}
test('F16.3 original archived depth and mature simulated ledger produce a read-only same-window comparison',t=>{
 const x=paperArchive(t),before=fs.readFileSync(x.file),depth=[...depthAt(entry,10,'entry'),...depthAt(exit,11,'exit')];
 const report=D.buildDeepResearchEvidence({archive:x.archive,depth},{asOf:x.now});
 const review=report.modules[71].sampledFillCostReview;
 assert.equal(review.attempted,2);assert.equal(review.matched,2);assert.equal(review.rows[0].sampledVwap,10);assert.equal(review.rows[1].sampledVwap,11);assert.equal(review.priceImpactCertified,false);assert.equal(review.canTrade,false);assert.equal(review.rows[0].side,'buy');assert.equal(review.rows[1].side,'sell');assert.equal(report.modules[71].rows[0].executionFills,undefined);assert.deepEqual(fs.readFileSync(x.file),before);
 const missing=D.buildDeepResearchEvidence({archive:x.archive,depth:depth.filter(d=>d.granularity==='depth-snapshot')},{asOf:x.now}).modules[71].sampledFillCostReview;assert.equal(missing.matched,0);assert.equal(missing.unknown,2);
});
