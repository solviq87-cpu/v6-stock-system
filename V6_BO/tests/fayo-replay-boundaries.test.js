'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const W=require('../src/core/research-interaction-workbench'),S=require('../src/core/research-workspace-store'),D=require('../src/core/research-workspace-decision'),J=require('../src/core/news-evidence-journal');
const {createPaperExecutionReportStore}=require('../src/core/paper-execution-report-store');
const {fixture,at,dates,event}=require('./helpers/research-workspace-fixtures');
const {createReplayFixture,linkedInput}=require('./helpers/fayo-replay-boundaries-fixture');
function setup(t){const x=createReplayFixture();t.after(x.cleanup);return x;}
test('replay series preserves index code, methodology and basis instead of merging distinct instruments',()=>{
 const build=(index,options)=>event(D.buildWorkspaceDecision(fixture({index}),{marketLinkageEvidence:linkedInput(index,options)}),index,at(index));
 for(const change of [{benchmark:'399001'},{method:'fixture-v2'},{basis:'price-return'}]){
  const own=[build(69),build(70,change)],rows=W.dailySeries(own,own[1],[dates[69],dates[70]],at(70)).rows;
  assert.equal(rows[0].index.identity.code,'000001');assert.notEqual(rows[0].index.seriesIdentity,rows[1].index.seriesIdentity);
  assert.match(rows[0].index.seriesIdentity,/^[a-f0-9]{64}$/);
 }
 const own=[build(69),build(70)],rows=W.dailySeries(own,own[1],[dates[69],dates[70]],at(70)).rows;
 assert.equal(rows[0].index.seriesIdentity,rows[1].index.seriesIdentity,'same instrument and calculation basis remain comparable');
});
test('news occurrence uses original source clocks while admission uses the immutable archive clock',t=>{
 const x=setup(t),rows=J.queryAt(x.roots.newsRoot,{symbol:'600000',asOf:x.asOf,now:x.asOf,limit:200}).rows;
 const markers=W.newsMarkers(rows,'600000',x.asOf),original=markers.find(m=>m.ref===x.news[0].eventHash),revision=markers.find(m=>m.ref===x.news[1].eventHash),retraction=markers.find(m=>m.ref===x.news[2].eventHash);
 assert.equal(original.at,at(69,'10:00'));assert.equal(original.knownAt,x.stamp('14:00:00'));
 assert.equal(revision.at,x.stamp('14:30:00'));assert.equal(revision.knownAt,x.stamp('15:00:00'));
 assert.equal(retraction.at,x.stamp('16:55:00'));assert.equal(retraction.knownAt,x.stamp('17:00:00'));
 const unknown=markers.find(m=>m.detail.sourceEventId==='page-event-0');assert.equal(unknown.detail.timeBasis,'archive-receipt');assert.equal(unknown.at,unknown.knownAt);
 assert.equal(W.newsMarkers(rows,'600000',x.stamp('16:00:00')).some(m=>m.ref===x.news[2].eventHash),false);
});
test('a board snapshot keeps its own provider instead of borrowing the stock feed identity',()=>{
 const data=D.buildWorkspaceDecision(fixture());data.context.sectorContext={provider:'eastmoney-current-board-members',current:{source:'eastmoney',classificationVersion:'frozen-members-v1',boards:[
  {code:'BK0001',category:'industry',name:'隔离板块',members:['600000'],membershipComplete:true,membersObservedAt:at(70),quoteDate:dates[70],quoteAt:Date.parse(dates[70]+'T15:00:00+08:00'),changePct:2}]} };
 const stored=event(data),r=W.dailySeries([stored],stored,[dates[70]],at(70)).rows[0];
 assert.equal(r.stock.source,'tencent');assert.equal(r.sector.source,'eastmoney');assert.equal(r.sector.identity.classificationVersion,'frozen-members-v1');
 delete data.context.sectorContext.provider;delete data.context.sectorContext.current.source;
 const unknown=event(data);assert.equal(W.dailySeries([unknown],unknown,[dates[70]],at(70)).rows[0].sector,null);
});
test('bounded original report snapshots retain every version and never modify or recreate the archive',t=>{
 const x=setup(t),store=createPaperExecutionReportStore({root:x.reportRoot}),file=path.join(x.reportRoot,'days',x.day,'000001.json'),before=fs.readFileSync(file);
 const full=store.snapshots({day:x.day,asOf:x.asOf,limit:128});assert.equal(full.complete,true);assert.equal(full.versions.length,4);
 assert.equal(full.versions[1].reportHash,x.reports[1].reportHash);assert.equal(full.versions[1].recordedAt,x.stamp('15:30:00'));
 const bounded=store.snapshots({day:x.day,asOf:x.asOf,limit:1});assert.equal(bounded.complete,false);assert.equal(bounded.total,4);assert.equal(bounded.versions[0].reportVersion,4);
 assert.equal(store.snapshots({day:x.day,asOf:x.stamp('15:20:00')}).versions.length,1);
 for(const patch of [{limit:0},{limit:129},{limit:1.5},{asOf:Date.now()+60000},{day:'2026-02-30'}])assert.throws(()=>store.snapshots({day:x.day,asOf:x.asOf,...patch}));
 assert.deepEqual(fs.readFileSync(file),before);
 const absent=path.join(x.base,'absent');assert.deepEqual(createPaperExecutionReportStore({root:absent}).snapshots({day:x.day,asOf:x.asOf}).versions,[]);assert.equal(fs.existsSync(absent),false);
 const last=path.join(x.reportRoot,'days',x.day,'000004.json'),payload=JSON.parse(fs.readFileSync(last));payload.data.report.note='tampered';fs.writeFileSync(last,JSON.stringify(payload));
 assert.throws(()=>store.snapshots({day:x.day,asOf:x.stamp('15:20:00')}),/完整性/,'future corruption still invalidates historical reads');
});
test('replay retains first sealed fill and risk history when later reports repeat or omit them',async t=>{
 const x=setup(t),before=JSON.stringify(S.readEvents(x.roots.root));
 const result=await W.readReplay(x.roots,{symbol:'600000',asOf:x.asOf,window:7});
 const fill=result.markers.find(m=>m.kind==='fill'&&m.ref===x.entry.eventId);
 assert.ok(fill);assert.equal(fill.knownAt,x.stamp('15:30:00'));assert.equal(fill.detail.reportHash,x.reports[1].reportHash);
 assert.equal(result.markers.filter(m=>m.kind==='fill'&&m.ref===x.entry.eventId).length,1);
 const risk=result.markers.find(m=>m.kind==='risk');assert.ok(risk);assert.equal(risk.knownAt,x.stamp('15:30:00'));assert.equal(risk.detail.reportHash,x.reports[1].reportHash);
 const early=await W.readReplay(x.roots,{symbol:'600000',asOf:x.stamp('15:20:00'),window:7});assert.equal(early.markers.some(m=>m.kind==='fill'),false);
 assert.ok(result.markers.every(m=>m.at<=m.knownAt&&m.knownAt<=x.asOf&&m.canTrade===false));
 assert.equal(result.accountMutated,false);assert.equal(JSON.stringify(S.readEvents(x.roots.root)),before);
});
test('strict Beijing replay input preserves milliseconds and rejects normalized civil dates',async()=>{
 const {replayTime}=await import('../public/nova/evidence-workbench.mjs'),now=at(70,'20:00');
 assert.equal(replayTime(dates[70]+'T17:30:00.123',now),at(70,'17:30')+123);
 for(const value of ['2026-02-30T10:00','2026-04-09T24:00','2026-04-09T21:00','04/09/2026 10:00'])assert.equal(Number.isNaN(replayTime(value,now)),true,value);
});
