'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/core/research-workspace-decision'),A=require('../src/core/research-workspace-analytics'),C=require('../src/core/research-workspace-diagnostics');
const {fixture,native,event,at,dates}=require('./helpers/research-workspace-fixtures');
test('every conclusion links evidence; real zero survives and missing original timestamps stay unknown',()=>{
 const r=D.buildWorkspaceDecision(fixture()),c=r.conditions.find(x=>x.field==='funds'),e=r.evidence.find(x=>x.id===c.evidenceIds[0]);
 assert.equal(c.value,0);assert.equal(c.status,'fail');assert.equal(e.value,0);assert.equal(e.sourceTimestamp,null);assert.equal(e.receivedAt,r.asOf);
 assert.ok(r.conditions.every(c=>c.evidenceIds.length&&c.evidenceIds.every(id=>r.evidence.some(e=>e.id===id))));assert.equal(r.sourceRefs[0].url,'https://example.org/data');assert.equal(r.canTrade,false);
});
test('field evidence received in the future cannot become an observed fact',()=>{
 const f=fixture();f.research36.evaluations[0].checks[0].evidence.recordedAt=f.asOf+1;
 const r=D.buildWorkspaceDecision(f),e=r.evidence.find(x=>x.field==='funds');assert.equal(e.value,null);assert.equal(e.status,'unknown');
});
test('foreign context, future bars, unordered bars and invalid OHLC cannot be borrowed',()=>{
 const f=fixture();f.evidenceBundle.symbol='600001';assert.equal(D.buildWorkspaceDecision(f).bundleHash,null);
 const later=fixture({index:71});later.asOf=at(70);later.stock.observedAt=at(70);assert.equal(D.buildWorkspaceDecision(later).tradeDate,dates[70]);
 for(const mutate of [x=>x.stock.bars.reverse(),x=>x.stock.bars[0].low=100,x=>x.stock.source='other']){const x=fixture();mutate(x);assert.throws(()=>D.buildWorkspaceDecision(x));}
});
test('four systems stay independent; native three-round evidence and GPT factors require exact identity and time',()=>{
 const f=fixture(),missing=D.buildWorkspaceDecision(f);assert.equal(missing.systems.find(s=>s.id==='python').verdict,'unknown');assert.equal(missing.systems.find(s=>s.id==='gpt').verdict,'unknown');
 assert.equal(missing.conditions.find(c=>c.id==='fourteen:11').status,'unknown');assert.ok(missing.systems.find(s=>s.id==='bazi').coverageOnly);
 const r=D.buildWorkspaceDecision(f,native());assert.equal(r.systems.find(s=>s.id==='python').verdict,'pass');assert.equal(r.systems.find(s=>s.id==='gpt').verdict,'pass');
 assert.match(r.systems[0].version,/fourteen\/[a-f0-9]{16}/);assert.equal(r.systems.find(s=>s.id==='bazi').support.length,0);
 const wrong=native();wrong.gptEvidence.symbol='600001';assert.throws(()=>D.buildWorkspaceDecision(f,wrong),/匹配/);
 const future=native();future.pythonEvidence.knownAt=f.asOf+1;assert.throws(()=>D.buildWorkspaceDecision(f,future),/时点/);
});
test('fourteen imports only actual same-stock native inputs, preserves zero and rejects identity/extra field tricks',()=>{
 const f=fixture(),fourteenEvidence={symbol:f.stock.symbol,date:f.stock.bars.at(-1).date,knownAt:f.asOf,source:'synthetic-native-evaluator',stock:{floatCap:7000000000,limitUpCount:0,breakCount:0,sealAmount:1000,amount:2000}};
 const r=D.buildWorkspaceDecision(f,{fourteenEvidence});assert.equal(r.conditions.find(c=>c.id==='fourteen:11').value,0);assert.equal(r.conditions.find(c=>c.id==='fourteen:11').status,'pass');assert.equal(r.conditions.find(c=>c.id==='fourteen:1').value,70);assert.equal(r.nativeInputs.fourteen.knownAt,f.asOf);
 assert.throws(()=>D.buildWorkspaceDecision(f,{fourteenEvidence:{...fourteenEvidence,symbol:'600001'}}),/身份/);
 assert.throws(()=>D.buildWorkspaceDecision(f,{fourteenEvidence:{...fourteenEvidence,stock:{...fourteenEvidence.stock,price:999}}}),/字段/);
});
test('timeline records numeric-only changes, rule-only changes and same-day source revisions separately',()=>{
 const a=D.buildWorkspaceDecision(fixture()),b=structuredClone(a);b.conditions[0].value=123;
 assert.deepEqual(D.conditionChanges(b,a).changes[0].fields,['value']);assert.equal(D.conditionChanges(b,a).changes[0].kind,'observed-change');
 b.conditions[0].version='changed';assert.equal(D.conditionChanges(b,a).changes[0].kind,'rule-version-changed');
 b.conditions[0].version=a.conditions[0].version;b.observationHash='x';assert.equal(D.conditionChanges(b,a).changes[0].kind,'data-revision');
 b.symbol='600001';assert.throws(()=>D.conditionChanges(b,a),/身份/);
});
test('complete screening keeps every first rejection once, zero scores and input order',()=>{
 const items=Array.from({length:60},(_,i)=>({symbol:String(600000+i),score:i,quality:{usable:i%3!==0},blockedBySafety:false,strategy:{pass:i%3!==1},tradable:true}));
 const r=D.screeningRecord({items});assert.equal(r.rows.length,60);assert.equal(r.rows[0].score,0);assert.equal(r.rows[0].firstReason,'quality');assert.equal(r.rows[1].firstReason,'strategy');assert.equal(r.rows[2].status,'selected');
 assert.equal(r.funnel.steps.reduce((s,x)=>s+x.removed,0)+r.funnel.remaining,60);
 assert.equal(D.screeningRecord({items:[{symbol:'600000',quality:{usable:false}}]}).rows[0].status,'rejected');
 assert.equal(D.screeningRecord({items:[{symbol:'600000'}]}).rows[0].status,'unknown');assert.throws(()=>D.screeningRecord({items:[items[0],items[0]]}),/重复/);
});
function board(data,changePct,members=['600000','600001','600002','600003','600004']){data.context.sectorContext={current:{boards:[{category:'industry',code:'BK001',name:'合成板块',members,membershipComplete:true,quoteDate:data.tradeDate,quoteAt:data.asOf,membersObservedAt:data.asOf,changePct}]}};return data;}
test('market phase needs three consecutive sessions with identical members; role needs actual same-day coverage',()=>{
 const events=[68,69,70].map((i,j)=>event(board(D.buildWorkspaceDecision(fixture({index:i})),j+1),j+1));
 let m=A.marketPosition(events,'600000',at(70));assert.equal(m.phase,'warming');assert.equal(m.role,'unknown');
 for(let i=1;i<5;i++)events.push(event(D.buildWorkspaceDecision(fixture({symbol:String(600000+i),priceShift:i})),events.length+1));
 m=A.marketPosition(events,'600000',at(70));assert.equal(m.boards[0].coveragePct,100);assert.equal(m.role,'relative-front');
 const drift=structuredClone(events);drift[0].data.context.sectorContext.current.boards[0].members.push('600005');assert.equal(A.marketPosition(drift,'600000',at(70)).phase,'unknown');
 const gap=[events[0],events[2]];assert.equal(A.marketPosition(gap,'600000',at(70)).phase,'unknown');
});
test('warmup diagnostics expose actual native MACD start-length differences and insufficient history',()=>{
 const a=C.inputAudit(D.buildWorkspaceDecision(fixture({index:31})));assert.equal(a.warmupStatus,'insufficient-history');
 const b=C.inputAudit(D.buildWorkspaceDecision(fixture({index:140})));assert.equal(b.warmup.length,4);assert.ok(b.warmup.find(x=>x.length===120).value);assert.equal(b.pointInTime.financialHistoricalEligibility,'not-certified');
});
test('paired comparison refuses different information sets and drift separates scope from quality',()=>{
 const a=D.buildWorkspaceDecision(fixture()),b=structuredClone(a);b.conditions[0].value=55;assert.equal(C.pairedComparison(b,a).status,'matched-frozen-input');b.asOf++;assert.equal(C.pairedComparison(b,a).status,'unmatched-inputs');
 const d=C.driftReport([event(a),event(D.buildWorkspaceDecision(fixture({index:71,symbol:'600001'})),2)],at(71));assert.equal(d.reports[0].matched,0);assert.equal(d.reports[0].added,1);assert.equal(d.reports[0].removed,1);assert.equal(d.reports[0].status,'insufficient-matched-universe');
});
