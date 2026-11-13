'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {reviewPushedOutcomes:review}=require('../src/core/pushed-outcome-review');
const ts=Date.parse('2026-11-12T10:00:00+08:00'),now=Date.parse('2026-11-13T16:00:00+08:00');
const log=(status='✅ 已送达(私密)',extra={})=>({ts,status,title:'趋势样本',extra:{codes:['600000']},...extra});
const input=()=>({date:'20261112',now,pushlog:[log()],histories:{'600000':[{date:'2026-11-12',close:10,pct:-2,receivedAt:now},{date:'2026-11-13',close:11,pct:10}]}});
test('review uses exact historical day, never latest price or same-day close features for training',()=>{
 const r=review(input()),s=r.samples[0];assert.equal(s.pct,-2);assert.equal(s.close,10);assert.equal(s.outcome,'down');assert.equal(s.feat,null);assert.equal(s.zt,null);assert.equal(s.trainEligible,false);
 assert.equal(r.summary.titleStats[0].closeUpRate,0);assert.equal(r.summary.titleStats[0].closeLimitUpRate,null);
});
test('unknown, queued, failed and replica logs do not count as accepted notifications',()=>{
 for(const status of ['⚠️ 送达结果未知(私密)','发送中','❌ 发送失败','副本拦截(不外发)',''])assert.throws(()=>review({...input(),pushlog:[log(status)]}),/没有可核对/);
 const r=review({...input(),pushlog:[log(),log('⚠️ 送达结果未知(私密)')]});assert.equal(r.samples.length,1);assert.equal(r.skipped.unconfirmed,1);
});
test('same-day post-close messages cannot claim earlier close as a later outcome',()=>{
 assert.throws(()=>review({...input(),pushlog:[log(undefined,{ts:ts+5*3600000})]}),/没有可核对/);assert.throws(()=>review({...input(),now:ts}),/尚未收盘/);assert.throws(()=>review({...input(),date:'20260230'}),/日期无效/);
});
test('missing or duplicate target bars cannot overwrite valid results with empty success',()=>{
 for(const rows of [[],[{date:'2026-11-13',close:11,pct:10}],[{date:'2026-11-12',close:10,pct:null}],[{date:'2026-11-12',close:10,pct:0,receivedAt:now},{date:'2026-11-12',close:10,pct:0,receivedAt:now}]])assert.throws(()=>review({...input(),histories:{'600000':rows}}),/没有完整/);
});
test('receipt deduplication and explicit close-limit observations have separate denominators',()=>{
 const r=review({...input(),pushlog:[log(),log(undefined,{extra:"{'codes': ['600000', '600001']}"})],histories:{'600000':[{date:'20261112',close:10,pct:0,receivedAt:now}],'600001':[{date:'20261112',close:11,pct:10,isLimitUp:true,receivedAt:now}]}});
 assert.equal(r.samples.length,2);assert.equal(r.summary.titleStats[0].n,2);assert.equal(r.summary.titleStats[0].ztKnown,1);assert.equal(r.summary.titleStats[0].closeLimitUpRate,100);assert.equal(r.summary.titleStats[0].closeUpRate,50);
});
test('legacy CLI preserves v1 and prior v2 on missing data, is idempotent, rejects revisions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-outcome-test-'));try{
  fs.mkdirSync(path.join(root,'.kline_cache'));fs.writeFileSync(path.join(root,'learn_pushed_outcomes.json'),'legacy untouched');fs.writeFileSync(path.join(root,'pushlog.json'),JSON.stringify([log()]));
  const kfile=path.join(root,'.kline_cache/600000.json');fs.writeFileSync(kfile,JSON.stringify({rows:input().histories['600000']}));
  const run=()=>spawnSync(process.execPath,[path.join(__dirname,'../_learn_pushed_outcomes.js'),'20261112'],{env:{PATH:process.env.PATH,V6_PUSH_OUTCOME_ROOT:root},encoding:'utf8'});
  const a=run();assert.equal(a.status,0,a.stderr);assert.equal(run().status,0);
  const out=path.join(root,'learn_pushed_outcomes_review.json'),before=fs.readFileSync(out,'utf8');fs.writeFileSync(kfile,JSON.stringify({rows:[{date:'20261112',close:20,pct:20,receivedAt:now}]}));assert.equal(run().status,1);assert.equal(fs.readFileSync(out,'utf8'),before);
  fs.writeFileSync(path.join(root,'pushlog.json'),'[]');assert.equal(run().status,1);assert.equal(fs.readFileSync(out,'utf8'),before);assert.equal(fs.readFileSync(path.join(root,'learn_pushed_outcomes.json'),'utf8'),'legacy untouched');assert.equal(fs.existsSync(out+'.lock'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('intraday cache cannot become a final close just because the clock moved past close',()=>{
 for(const receivedAt of [undefined,ts,now+1]){
  const x=input();x.histories['600000'][0].receivedAt=receivedAt;
  assert.throws(()=>review(x),/没有完整/);
 }
});
