'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../src/core/research-interaction-workbench'),S=require('../src/core/research-workspace-store'),J=require('../src/core/news-evidence-journal');
const {handle}=require('../src/server/research-interaction-http');
const {fixture,at}=require('./helpers/research-workspace-fixtures'),D=require('../src/core/research-workspace-decision');
function setup(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-research-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 return {root:path.join(base,'workspace'),newsRoot:path.join(base,'news'),manualRoot:path.join(base,'manual'),shortlineRoot:path.join(base,'shortline'),signalRoot:path.join(base,'signals')};}
test('FAYO server news pagination freezes archive receipt and includes removed associations',t=>{
 const {newsRoot}=setup(t),a=at(70),b=a+60000;
 const raw={schemaVersion:1,source:'test-only',eventId:'event-1',sourceRevisionId:'revision-1',kind:'original',supersedes:null,url:'https://example.org/announcement',title:'合成研究公告',body:'自2026年8月1日起生效',bodyScope:'declared-body',securities:['600000'],publishedAt:a-1000,receivedAt:a-500,revisedAt:null};
 const first=J.appendBatch(newsRoot,[raw],{now:a}).results[0].eventHash;
 const second=J.appendBatch(newsRoot,[{...raw,sourceRevisionId:'revision-2',kind:'revised',supersedes:first,receivedAt:b-500,revisedAt:b-1000,securities:[]}],{now:b}).results[0].eventHash;
 const old=J.queryAt(newsRoot,{symbol:'600000',asOf:a,now:b});assert.equal(old.headHash,first);assert.equal(old.total,1);assert.equal(old.rows[0].current,true);
 const latest=J.queryAt(newsRoot,{symbol:'600000',asOf:b,now:b,limit:1});assert.equal(latest.headHash,second);assert.equal(latest.rows[0].associated,false);assert.equal(latest.rows[0].eligibleForResearchSupport,false);assert.equal(latest.nextOffset,1);
 assert.equal(J.queryAt(newsRoot,{symbol:'600000',asOf:b,now:b,offset:1,limit:1}).rows[0].current,false);
 assert.throws(()=>J.queryAt(newsRoot,{asOf:b+1,now:b}));
});
test('FAYO shared templates persist, require fresh authorization and reject unsupported scopes and stale CAS',async t=>{
 const {root}=setup(t),raw='精选评分前5且股价低于20元',input={action:'save-template',raw,expectedRevision:0,requestId:'evidence_template_001'};
 assert.deepEqual(W.readTemplates(root).templates,[]);
 await assert.rejects(W.saveTemplate(root,input),/授权/);
 const saved=await W.saveTemplate(root,input,{authorize:()=>true});assert.equal(saved.revision,1);assert.equal(saved.canTrade,false);
 assert.equal(W.readTemplates(root).templates[0].raw,raw);
 assert.equal((await W.saveTemplate(root,input,{authorize:()=>true})).reused,true);
 await assert.rejects(W.saveTemplate(root,{...input,requestId:'evidence_template_002'},{authorize:()=>true}),/版本冲突/);
 await assert.rejects(W.saveTemplate(root,{...input,raw:'全市场精选评分前5',requestId:'evidence_template_003'},{authorize:()=>true}),/全市场/);
 assert.equal(fs.existsSync(root),false);
});
test('FAYO replay rejects future knowledge and returns original points without trade permissions',async t=>{
 const roots=setup(t),a=at(70),data=D.buildWorkspaceDecision(fixture());
 const e=S.appendEvent(roots.root,'analysis',data,{now:a,requestId:'evidence_analysis_001'});
 const result=await W.readReplay(roots,{symbol:'600000',runId:e.hash,asOf:a,window:7},{readShortline:async()=>({ok:true,state:{plans:[],trades:[]}})});
 assert.equal(result.runId,e.hash);assert.equal(result.rows.length,7);assert.equal(result.scope,'historical-readonly');
 assert.equal(result.rows.at(-1).close.ref,e.hash);assert.equal(result.rows.at(-1).close.knownAt,a);
 assert.ok(result.rows.every(r=>r.sector===null&&r.index===null));assert.equal(result.canTrade,false);
 await assert.rejects(W.readReplay(roots,{symbol:'600000',runId:e.hash,asOf:a-1},{readShortline:async()=>({ok:true,state:{}})}));
});
test('FAYO optional model: unconfigured, grounded ordinal citation and failed citation retain rule-only permissions',async t=>{
 const {root}=setup(t),a=at(70),data=D.buildWorkspaceDecision(fixture());
 const e=S.appendEvent(root,'analysis',data,{now:a,requestId:'evidence_model_001'});
 const input={action:'explain',symbol:'600000',runId:e.hash,asOf:a,question:'missing'};
 assert.equal((await W.explain(root,input,{adapter:null})).status,'unconfigured');
 let prompt=null;const adapter={id:'synthetic-local',complete:async x=>{prompt=x.prompt;return {text:JSON.stringify({answer:'仅合成验证',citations:['R1']})}}};
 const out=await W.explain(root,input,{adapter,authorize:()=>true});
 assert.equal(out.status,'completed');assert.equal(out.model,'synthetic-local');assert.equal(out.canTrade,false);assert.equal(out.accountMutated,false);assert.ok(out.citations.length);
 assert.ok(!prompt.includes('private-test-value'));assert.ok(!prompt.includes('合成验证股票'));
 const bad=await W.explain(root,input,{authorize:()=>true,adapter:{id:'test',complete:async()=>({text:'{"answer":"无来源","citations":["R999"]}'})}});
 assert.equal(bad.status,'failed');assert.equal(bad.canTrade,false);
});
test('FAYO endpoint denies viewer, replica or cross-site writes, rejects unknown actions and revoked reads',async()=>{
 const call=async({method='GET',url='?mode=templates',body='',authorize=()=>true,primary=()=>true,sameOrigin=()=>true,job=async()=>({ok:true,result:{canTrade:false}})}={})=>{
  let status,headers,value;await handle({method},{writeHead:(c,h)=>{status=c;headers=h;},end:x=>{value=JSON.parse(x)}},new URL('http://localhost/api/research/evidence-workbench'+url),body,{authorize,primary,sameOrigin,roots:{},job});return {status,headers,value};};
 assert.equal((await call({authorize:()=>false})).status,403);
 for(const gate of [{primary:()=>false},{sameOrigin:()=>false}])assert.equal((await call({method:'POST',url:'',body:'{"action":"save-template"}',...gate})).status,403);
 assert.equal((await call({method:'POST',url:'',body:'{"action":"buy"}'})).status,422);
 assert.equal((await call({url:'?mode=templates&mode=replay'})).status,422);
 let allowed=true;assert.equal((await call({authorize:()=>allowed,job:async()=>{allowed=false;return {ok:true,result:{private:true}};}})).status,403);
 const read=await call();assert.equal(read.status,200);assert.match(read.headers['Cache-Control'],/no-store/);
});
test('FAYO headline paths cannot promote numerical scores or bypass original news risk review',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.doesNotMatch(s,/newsSupportsCode\([^)]*\)\)\s*\{\s*(?:s|prob)\s*\+=/);
 assert.doesNotMatch(s,/if\s*\(o\.goodHit\)\s*p\s*\+=/);
 assert.doesNotMatch(s,/goodHit\s*\?\s*0\.88/);
 assert.match(s,/badHit\s*\?\s*1\.15/);
 assert.match(s,/function reviewRecommendationNews\(/);
});
