'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {assessNews,newsIsCurrent}=require('../src/core/news-sentiment');
const Journal=require('../src/core/news-evidence-journal');
const {createReader}=require('../src/core/news-signal-evidence');
const NOW=Date.parse('2026-11-12T02:00:00Z');
const fixture=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-news-integrity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private');};
const evidence=(extra={})=>({schemaVersion:1,source:'operator-fixture',eventId:'event-1',sourceRevisionId:'edition-1',kind:'original',supersedes:null,url:'https://example.test/original',title:'新闻原文',body:'原始正文',bodyScope:'declared-body',securities:['600000'],publishedAt:NOW-60000,receivedAt:NOW,revisedAt:null,...extra});
const append=(root,input=evidence(),now=NOW)=>Journal.appendBatch(root,[input],{now}).results[0];
const capture=(reader,root,triggerAt=NOW,now=triggerAt)=>reader(root,{code:'600000',triggerAt,now});
const partial=r=>{assert.equal(r.originalEvidence,null);assert.equal(r.binding.status,'partial');assert.equal(r.binding.canTrade,false);assert.equal(r.binding.canNotify,false);assert.equal(r.binding.canTrain,false);};
function retract(root,prior){return append(root,evidence({kind:'retracted',sourceRevisionId:'edition-2',supersedes:prior.eventHash,body:'撤稿说明',receivedAt:NOW+1000,revisedAt:NOW+1000}),NOW+1000);}
// 1. No realized positive direction may be inferred from explicit negation.
test('negated contracts and awards cannot become positive news',()=>{
 for(const title of ['公司未中标重大订单','公司尚未签订重大合同','公司并未获得新增订单','公司未获准收购项目','公司尚无增持计划','公司不会增持股份','公司没有正式签署合同'])assert.notEqual(assessNews(title,'').type,'good',title);
});
test('denied positive statement also blocks promotion from its separately worded title',()=>{
 assert.equal(assessNews('公司中标项目','公司尚未签订合同').type,'neutral');
});
test('negated positive does not erase explicit separately stated adverse event',()=>{
 assert.equal(assessNews('公司未能中标重大订单，同时收到监管函','').type,'bad');
 assert.equal(assessNews('公司已签署重大合同','').type,'good');
});
// 2. Empty text must remain missing, not complete research evidence.
test('blank and invisible-only news input stays unknown',()=>{
 for(const args of [['',''],['  \n','\t'],['\u200b\u2060','\u200d\ufeff']]){const r=assessNews(...args);assert.equal(r.type,'neutral');assert.equal(r.status,'unknown');}
 assert.equal(assessNews('','公司已中标项目').type,'good');
});
test('whitespace-only original body cannot be a complete journal reference',t=>{
 const root=fixture(t),reader=createReader();append(root,evidence({body:' \t\n\u200b'}));const r=capture(reader,root);partial(r);assert.ok(r.binding.versions[0].issues.includes('MISSING_BODY'));
});
test('whitespace-only title cannot be a complete journal reference',t=>{
 const root=fixture(t),reader=createReader();append(root,evidence({title:' \t\u200b'}));const r=capture(reader,root);partial(r);assert.ok(r.binding.versions[0].issues.includes('MISSING_TITLE'));
});
// 3. Match the original journal's bounded publication and receipt time domain.
test('out-of-domain publication or decision clocks cannot make a current news item',()=>{
 for(const at of [4102444800000,Number.MAX_SAFE_INTEGER])assert.equal(newsIsCurrent(at,at),false);
 assert.equal(newsIsCurrent(4102444799999,4102444800000),false);
 assert.equal(newsIsCurrent(4102444799999,4102444799999),true);
});
test('valid China calendar expiry and same-second receipt remain unchanged',()=>{
 const now=Date.parse('2026-11-13T00:00:00+08:00');assert.equal(newsIsCurrent(now,now),true);assert.equal(newsIsCurrent(now+1,now),false);assert.equal(newsIsCurrent(Date.parse('2026-11-10T23:59:59+08:00'),now),false);
});
// 4. Cached verification cannot move backwards with a rolled-back read clock.
test('rollback in the actual verification clock is not an eligible cached reference',t=>{
 const root=fixture(t),reader=createReader();append(root);assert.equal(capture(reader,root,NOW,NOW+2000).binding.status,'recorded');
 partial(capture(reader,root,NOW,NOW+1000));
 // A retry must not forget the last verified clock after a rejected read.
 partial(capture(reader,root,NOW,NOW+1000));
 assert.equal(capture(reader,root,NOW,NOW+2000).binding.status,'recorded');
});
test('later cached metadata checks preserve the most recent verification clock',t=>{
 const root=fixture(t),reader=createReader();append(root);capture(reader,root,NOW,NOW);capture(reader,root,NOW,NOW+500);partial(capture(reader,root,NOW,NOW+100));
});
// 5. An observed retraction cannot disappear by restoring a shorter or replaced chain.
test('removing a previously observed retraction cannot revive old news',t=>{
 const root=fixture(t),reader=createReader(),one=append(root);retract(root,one);
 const before=capture(reader,root,NOW+1000);partial(before);assert.ok(before.binding.reasons.includes('RETRACTED'));
 fs.unlinkSync(path.join(root,'000002.json'));
 const bytes=fs.readFileSync(path.join(root,'000001.json'));partial(capture(reader,root,NOW+2000));partial(capture(reader,root,NOW+3000));assert.deepEqual(fs.readFileSync(path.join(root,'000001.json')),bytes);
});
test('an observed nonempty archive cannot vanish and then reappear with different history',t=>{
 const root=fixture(t),reader=createReader();append(root);assert.equal(capture(reader,root).binding.status,'recorded');fs.rmSync(root,{recursive:true,force:true});partial(capture(reader,root,NOW+1000));
 append(root,evidence({body:'replacement'}),NOW+2000);partial(capture(reader,root,NOW+2000));
});
test('a same-length valid but rewritten chain cannot substitute its verified prefix',t=>{
 const root=fixture(t),other=fixture(t),reader=createReader();append(root);append(other,evidence({body:'different but valid'}));assert.equal(capture(reader,root).binding.status,'recorded');fs.copyFileSync(path.join(other,'000001.json'),path.join(root,'000001.json'));partial(capture(reader,root,NOW+1001));
});
test('legitimate append preserves prefix and an earlier trigger sees only earlier evidence',t=>{
 const root=fixture(t),reader=createReader(),one=append(root);assert.equal(capture(reader,root).originalEvidence[0].eventHash,one.eventHash);retract(root,one);
 partial(capture(reader,root,NOW+1000,NOW+2000));const past=capture(reader,root,NOW,NOW+2000);assert.equal(past.originalEvidence[0].eventHash,one.eventHash);assert.equal(past.binding.asOfSequence,1);assert.equal(past.binding.canNotify,false);assert.equal(past.binding.canTrain,false);
});
