'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {investigateCurrentNews}=require('../src/core/index-news-association');
const {createIndexWindowResearch}=require('../src/core/index-window-research');
const t=Date.parse('2026-11-05T10:00:00+08:00');
const event={baseAt:t,quoteAt:t+60000,detectedAt:t+65000};
function fixture(){
 const hash='a'.repeat(64),e={source:'eastmoney-fast-news',eventId:'one',sourceRevisionId:'v1',kind:'original',publishedAt:t+1000,receivedAt:t+2000,revisedAt:null,securities:['600000']};
 const entry={evidence:e,eventHash:hash,sequence:1,recordedAt:t+3000};
 const row={id:'one',source:e.source,type:'good',codes:['600000'],publishedAt:e.publishedAt,receivedAt:t+4000,newsEvidence:{eventHash:hash,sequence:1,recordedAt:entry.recordedAt,sourceRevisionId:'v1'}};
 return {row,entry,news:{goodAll:[row],badAll:[],neutralAll:[]},resolveCurrent:()=>({entry,explicitSectors:['银行']})};
}
const run=(x,options={})=>investigateCurrentNews(event,x.news,{resolveCurrent:x.resolveCurrent,...options});
const empty=x=>{assert.deepEqual(x.evidenceHashes,[]);assert.deepEqual(x.relatedSecurities,[]);assert.equal(x.currentLocalEvidence,false);assert.equal(x.canTrade,false);assert.equal(x.canNotify,false);};
test('current local evidence links explicit securities and sectors without claiming causation',()=>{
 const f=fixture(),v=run(f);assert.equal(v.status,'cached-window-checked');assert.equal(v.currentLocalEvidence,true);assert.deepEqual(v.evidenceHashes,['a'.repeat(64)]);assert.deepEqual(v.relatedSecurities,['600000']);assert.deepEqual(v.explicitSectors,['银行']);assert.equal(v.attribution,'unknown');assert.equal(v.canTrade,false);assert.equal(v.canNotify,false);
});
test('no resolver, failed intake and malformed market clock fail closed',()=>{
 const f=fixture();empty(investigateCurrentNews(event,f.news));empty(investigateCurrentNews({...event,quoteAt:t-1},f.news,{resolveCurrent:f.resolveCurrent}));f.news.evidenceIntake={status:'unknown'};empty(run(f));
});
test('unbound and mismatched cache identity or source revision cannot be counted',()=>{
 for(const mutate of [f=>delete f.row.newsEvidence,f=>f.row.newsEvidence.sequence=2,f=>f.row.newsEvidence.sourceRevisionId='old',f=>f.row.newsEvidence.recordedAt++,f=>f.row.id='another',f=>f.row.source='other',f=>f.row.codes=['000001'],f=>f.row.type='bad']){const f=fixture();mutate(f);empty(run(f));}
});
test('withdrawn, replaced, unknown revised time and future revision are excluded',()=>{
 for(const mutate of [f=>f.entry.evidence.kind='retracted',f=>f.entry.eventHash='b'.repeat(64),f=>{f.entry.evidence.kind='revised';f.entry.evidence.revisedAt=null;},f=>{f.entry.evidence.kind='revised';f.entry.evidence.revisedAt=event.quoteAt+1;}]){const f=fixture();mutate(f);empty(run(f));}
});
test('revision inside the original market window and known receipt is eligible as association only',()=>{
 const f=fixture();f.entry.evidence.kind='revised';f.entry.evidence.revisedAt=t+1500;assert.equal(run(f).currentLocalEvidence,true);
});
test('late publication, receipt or archival time cannot backfill a prior event',()=>{
 for(const mutate of [f=>f.row.receivedAt=event.detectedAt+1,f=>f.row.publishedAt=t-1,f=>f.entry.evidence.receivedAt=event.detectedAt+1,f=>{f.entry.recordedAt=event.detectedAt+1;f.row.newsEvidence.recordedAt=f.entry.recordedAt;}]){const f=fixture();mutate(f);empty(run(f));}
});
test('duplicate cache copies and bounded scan do not manufacture independent evidence',()=>{
 const f=fixture();f.news.goodAll=Array(80).fill(f.row);let count=0;const v=run(f,{resolveCurrent:r=>{count++;return f.resolveCurrent(r);}});assert.equal(v.inspected,50);assert.equal(v.truncated,true);assert.equal(v.evidenceHashes.length,1);assert.equal(count,1);
});
test('read-time allowlist cannot add a newly found hash',()=>{
 const f=fixture();empty(run(f,{allowedHashes:[]}));empty(run(f,{allowedHashes:['b'.repeat(64)]}));assert.equal(run(f,{allowedHashes:[f.entry.eventHash]}).currentLocalEvidence,true);
});
test('resolver failure discards all partial local results instead of presenting a clean match',()=>{
 const f=fixture(),second={...f.row,id:'two',newsEvidence:{...f.row.newsEvidence,eventHash:'b'.repeat(64)}};f.news.goodAll.push(second);const v=run(f,{resolveCurrent:r=>{if(r.id==='two')throw Error('archive unavailable');return f.resolveCurrent(r);}});empty(v);assert.equal(v.status,'unavailable');
});
test('index view rechecks original association after revocation without altering event or reinvestigating',()=>{
 let current=true,investigations=0,reviews=0;const r=createIndexWindowResearch({investigate:()=>{investigations++;return {status:'cached-window-checked',evidenceHashes:['a'.repeat(64)]};},reviewInvestigation:e=>{reviews++;return {status:'cached-window-checked',evidenceHashes:current?e.investigation.evidenceHashes:[]};}});
 const dates=[];for(let at=Date.parse('2026-09-01T10:00:00+08:00');dates.length<21;at+=86400000)if(![0,6].includes(new Date(at).getUTCDay()))dates.push(at);
 function tick(d,m,price){const at=dates[d]+m*60000,day=new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');r.observe({day,indices:[{code:'1.000001',quoteAt:at,receivedAt:at,price,quoteSource:'sina-index'}]},{day,trading:true},at);return at;}
 for(let d=0;d<20;d++)for(let m=0;m<=5;m++)tick(d,m,100);for(let m=0;m<5;m++)tick(20,m,100);const at=tick(20,5,110);
 const first=r.view(at);assert.equal(first.events.length,2);assert.equal(first.events[0].investigation.initialEvidenceCount,1);assert.equal(first.events[0].investigation.evidenceHashes.length,1);current=false;
 const later=r.view(at+1000);assert.equal(later.events[0].id,first.events[0].id);assert.equal(later.events[0].investigation.initialEvidenceCount,1);assert.deepEqual(later.events[0].investigation.evidenceHashes,[]);assert.equal(investigations,2);assert.equal(reviews,4);
});
test('server adapter reuses reference-specific gate and matches sectors against archived text and current sector names',()=>{
 const {createIndexNewsInvestigator}=require('../src/core/index-news-association'),f=fixture();
 f.entry.evidence.title='银行行业消息';f.entry.evidence.body='原始正文';f.row.sectors=['银行','科技'];let checks=0,lookups=[];
 const invoke=createIndexNewsInvestigator({readNews:()=>f.news,allowsItem:r=>{assert.equal(r,f.row);checks++;return true;},currentState:id=>{lookups.push(id);return {unknown:false,latest:new Map([['one',f.entry]])};},readSectors:()=>[{name:'银行'},{name:'科技'}],explicitSectorMatch:(text,name)=>text.includes(name+'行业')});
 const v=invoke(event);assert.deepEqual(v.explicitSectors,['银行']);assert.equal(checks,1);assert.deepEqual(lookups,['one']);
});
test('server adapter rejects a withdrawn or disallowed row and fails closed on unknown archive',()=>{
 const {createIndexNewsInvestigator}=require('../src/core/index-news-association'),f=fixture();let allowed=true,unknown=false;
 const invoke=createIndexNewsInvestigator({readNews:()=>f.news,allowsItem:()=>allowed,currentState:()=>({unknown,latest:new Map([['one',f.entry]])}),readSectors:()=>[],explicitSectorMatch:()=>false});
 assert.equal(invoke(event).currentLocalEvidence,true);allowed=false;empty(invoke(event));unknown=true;const v=invoke(event);empty(v);assert.equal(v.status,'unavailable');
});
test('read-time recheck cannot edit the stored or visible market event through its input',()=>{
 const r=createIndexWindowResearch({investigate:()=>({status:'cached-window-checked',evidenceHashes:['a'.repeat(64)]}),reviewInvestigation:e=>{e.canTrade=true;e.price=999;return {status:'unavailable'};}});
 const days=[];for(let at=Date.parse('2026-09-01T10:00:00+08:00');days.length<21;at+=86400000)if(![0,6].includes(new Date(at).getUTCDay()))days.push(at);
 function tick(d,m,price){const at=days[d]+m*60000,day=new Date(at+28800000).toISOString().slice(0,10).replaceAll('-','');r.observe({day,indices:[{code:'1.000001',quoteAt:at,receivedAt:at,price,quoteSource:'sina-index'}]},{day,trading:true},at);return at;}
 for(let d=0;d<20;d++)for(let m=0;m<=5;m++)tick(d,m,100);for(let m=0;m<5;m++)tick(20,m,100);const at=tick(20,5,110);
 const v=r.view(at).events[0];assert.equal(v.canTrade,false);assert.equal(v.price,110);assert.equal(v.investigation.status,'unavailable');assert.equal(r.view(at).events[0].price,110);
});
