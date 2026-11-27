'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const J=require('../src/core/news-evidence-journal');
const {readSecurityLifecycleEvidence:read}=require('../src/core/security-lifecycle-evidence');
const symbol='600000',t0=Date.parse('2026-11-20T14:00:00+08:00'),now=t0+60000;
const url=id=>'https://static.cninfo.com.cn/finalpage/2026-11-20/'+id+'.pdf';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d34-')),root=path.join(dir,'news');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const input=(id,title,extra={})=>({schemaVersion:1,source:'cninfo',eventId:'event-'+id,sourceRevisionId:'v1',
  kind:'original',supersedes:null,url:url(id),title,body:'原文待复核',bodyScope:'declared-body',securities:[symbol],
  publishedAt:t0-1000,receivedAt:t0,revisedAt:null,...extra});
 const append=(items,at=t0)=>J.appendBatch(root,Array.isArray(items)?items:[items],{now:at}).results;
 const get=(opts={})=>read({root,symbol,asOf:now,now,...opts});
 return {root,input,append,get};
}
test('existing journal is the only input and unlock plan and release are distinct nonconfirmed clues',t=>{
 const f=fixture(t);f.append([f.input(1,'限售股解禁计划公告'),f.input(2,'关于限售股份上市流通的公告')]);
 const r=f.get();assert.equal(r.categories.unlock.clueDocuments,2);
 assert.deepEqual(r.rows.map(x=>x.phase).sort(),['unlock-plan-clue','unlock-release-clue']);
 assert.equal(r.rows[0].actualEventConfirmed,false);assert.equal(r.shareQuantity,null);assert.equal(r.canTrade,false);
});
test('pledge disclosure and release never become net pledged shares or cancellation of risk',t=>{
 const f=fixture(t);f.append([f.input(1,'控股股东股份质押公告'),f.input(2,'关于股份解除质押的公告')]);
 const r=f.get();assert.equal(r.categories.pledge.clueDocuments,2);
 assert.deepEqual(r.rows.map(x=>x.phase).sort(),['pledge-disclosure-clue','pledge-release-clue']);
 assert.equal(r.pledgedShares,null);assert.equal(r.impactScore,null);
});
test('delisting warning, warning removal and termination process remain separate title clues',t=>{
 const f=fixture(t);f.append([f.input(1,'关于退市风险警示的公告'),f.input(2,'关于申请撤销退市风险警示的公告'),f.input(3,'收到终止上市决定的公告')]);
 const r=f.get();assert.deepEqual(r.rows.map(x=>x.phase).sort(),['delisting-decision-or-process-clue','delisting-warning-clue','delisting-warning-removal-clue'].sort());
 assert.equal(r.delisted,null);assert.equal(r.categories.delisting.confirmedEvents,null);
});
test('negated, corrected, uncertain and multiple lifecycle titles stay manual review, never a directional signal',t=>{
 const f=fixture(t);f.append([f.input(1,'澄清尚未发生解禁事项'),f.input(2,'质押及解除质押公告'),f.input(3,'可能退市风险提示'),f.input(4,'关于解除限售及股份质押的公告')]);
 const r=f.get();assert.equal(r.rows.length,4);assert.ok(r.rows.every(x=>x.phase==='manual-review'&&x.actualEventConfirmed===false));
 assert.equal(r.canNotify,false);assert.equal(r.canTrain,false);
});
test('late correction and retraction change only later visible evidence, not earlier decision snapshots',t=>{
 const f=fixture(t),original=f.input(1,'股份质押公告'),a=f.append(original)[0];
 const correction={...original,title:'关于股份解除质押的公告',kind:'revised',sourceRevisionId:'v2',supersedes:a.eventHash,revisedAt:t0+1000,receivedAt:t0+1000};
 const b=f.append(correction,t0+2000)[0];
 f.append({...correction,kind:'retracted',sourceRevisionId:'v3',supersedes:b.eventHash,revisedAt:t0+3000,receivedAt:t0+3000},t0+4000);
 assert.equal(f.get({asOf:t0}).rows[0].phase,'pledge-disclosure-clue');
 assert.equal(f.get({asOf:t0+2000}).rows[0].phase,'pledge-release-clue');
 const r=f.get();assert.equal(r.rows.length,0);assert.equal(r.excluded.withdrawn,1);assert.equal(r.absenceClaim,null);
});
test('same official document across provider labels counts once; conflicting variants and removed association suppress it',t=>{
 const f=fixture(t),x=f.input(1,'限售股上市流通公告'),alias={...x,source:'eastmoney-fast-news',eventId:'alias-one'};
 const a=f.append([x,alias]);assert.equal(f.get().rows.length,1);assert.equal(f.get().rows[0].sourceLabels.length,2);
 assert.equal(f.get().rows[0].independentPublisherCount,null);
 const conflict={...alias,title:'关于解除质押的公告',sourceRevisionId:'v2',kind:'revised',supersedes:a[1].eventHash,receivedAt:t0+1000,revisedAt:t0+1000};
 const b=f.append(conflict,t0+2000)[0];assert.equal(f.get().rows.length,0);assert.equal(f.get().conflicts.length,1);
 f.append({...conflict,securities:['600001'],sourceRevisionId:'v3',supersedes:b.eventHash,receivedAt:t0+3000,revisedAt:t0+3000},t0+4000);
 assert.equal(f.get().rows.length,0);assert.equal(f.get().excluded.securityRemoved,1);
});
test('wrong security, untrusted path, unknown publication and mock source never establish facts or scope coverage',t=>{
 const f=fixture(t);f.append([f.input(1,'退市风险警示',{securities:['600001']}),f.input(2,'解禁公告',{url:'https://example.org/a.pdf'}),f.input(3,'股份质押',{publishedAt:null}),f.input(4,'解禁公告',{source:'mock'})]);
 const r=f.get();assert.equal(r.rows.length,0);assert.equal(r.status,'no-qualified-evidence');assert.equal(r.excluded.unknownTimeOrSource,3);
 assert.equal(r.categories.unlock.status,'unknown');assert.equal(r.completeMarketCoverage,false);
 assert.throws(()=>f.get({symbol:600000}));assert.throws(()=>f.get({asOf:now+1}));
});
test('bounded result retains honest denominator; corrupt original journal refuses all results without repairing bytes',t=>{
 const f=fixture(t);f.append([f.input(1,'解禁公告'),f.input(2,'质押公告'),f.input(3,'退市风险警示')]);
 const r=f.get({limit:1});assert.equal(r.rows.length,1);assert.equal(r.coverage.qualifiedDocuments,3);assert.equal(r.coverage.truncated,true);
 const file=path.join(f.root,'000001.json');fs.writeFileSync(file,'{}');const x=f.get();
 assert.equal(x.status,'archive-unavailable');assert.equal(x.rows.length,0);assert.equal(x.coverage.scannedVisibleEvents,null);
 assert.equal(fs.readFileSync(file,'utf8'),'{}');assert.equal(x.canTrade,false);
});
