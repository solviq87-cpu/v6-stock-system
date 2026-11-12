'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const J=require('../src/core/news-evidence-journal');
const NOW=Date.parse('2026-11-10T08:00:00Z');
const base=(extra={})=>({schemaVersion:1,source:'fixture-source',eventId:'event-1',sourceRevisionId:'edition-1',kind:'original',supersedes:null,url:'https://example.test/original',title:'中标传言待核实',body:'原始正文',securities:['600000'],publishedAt:NOW-60000,receivedAt:NOW,revisedAt:null,...extra});
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'news-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'private');}
const put=(root,input,now=NOW)=>J.appendBatch(root,[input],{now}).results[0];
test('persisted original, two revisions and terminal retraction survive a separate process restart',t=>{
 const root=temp(t),one=put(root,base());
 const two=put(root,base({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,body:'修订一次',receivedAt:NOW+1000,revisedAt:NOW+500}),NOW+1000);
 const three=put(root,base({kind:'revised',sourceRevisionId:'edition-3',supersedes:two.eventHash,body:'修订二次',receivedAt:NOW+2000,revisedAt:NOW+1500}),NOW+2000);
 put(root,base({kind:'retracted',sourceRevisionId:'edition-4',supersedes:three.eventHash,body:'原文撤回，原因待核实',receivedAt:NOW+3000,revisedAt:NOW+2500}),NOW+3000);
 assert.equal(put(root,base(),NOW+4000).reused,true,'repeated original cannot revive a retracted event');
 const child=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(require(process.argv[1]).query(process.argv[2],{now:Number(process.argv[3])})))',require.resolve('../src/core/news-evidence-journal'),root,String(NOW+4000)],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
 assert.equal(result.rows.length,4);assert.deepEqual(result.summary,{totalRevisions:4,currentEvents:1,retractedEvents:1,eligibleForResearchSupport:0,unknownEvents:0});
 assert.ok(result.rows.every(r=>r.eligibleForResearchSupport===false));assert.equal(result.rows[0].supportStatus,'retracted');
 assert.equal(result.rows[1].supportStatus,'superseded');assert.equal(result.canTrade,false);
 assert.equal(fs.statSync(root).mode&0o777,0o700);assert.equal(fs.statSync(path.join(root,'000001.json')).mode&0o777,0o600);
});
test('revision identity dedupes repeated intake but conflicts never overwrite',t=>{
 const root=temp(t),one=put(root,base()),before=fs.readFileSync(path.join(root,'000001.json'));
 assert.equal(put(root,base({receivedAt:NOW+1000}),NOW+1000).reused,true);
 assert.throws(()=>put(root,base({body:'不同内容'})),/CONFLICTING_SOURCE_REVISION/);
 assert.deepEqual(fs.readFileSync(path.join(root,'000001.json')),before);
 assert.equal(J.query(root,{now:NOW}).summary.eligibleForResearchSupport,1);
 assert.equal(J.query(root,{symbol:'000001',now:NOW}).total,0);assert.ok(one.eventHash);
});
test('wrong supersedes, event/source, original clock and post-retraction edits fail closed',t=>{
 const root=temp(t),one=put(root,base());
 const revision=base({kind:'revised',sourceRevisionId:'edition-2',supersedes:one.eventHash,revisedAt:NOW,receivedAt:NOW});
 for(const mutation of [{supersedes:'a'.repeat(64)},{source:'other-source'},{eventId:'other-event'},{publishedAt:NOW-50000},{receivedAt:NOW-1}])assert.throws(()=>put(root,{...revision,...mutation}));
 const last=put(root,{...revision,kind:'retracted'});
 assert.throws(()=>put(root,{...revision,sourceRevisionId:'edition-3',supersedes:last.eventHash}),/TERMINAL_RETRACTION/);
 assert.equal(J.readJournal(root,{now:NOW}).length,2);
});
test('future clocks are rejected and missing source time/link stays unknown rather than received time',t=>{
 const root=temp(t);
 for(const mutation of [{publishedAt:NOW+1},{receivedAt:NOW+1},{publishedAt:'2026-11-10T08:00:00Z'},{publishedAt:Infinity},{url:'javascript:alert(1)'},{url:'https://user:secret@example.test'}])assert.throws(()=>put(root,base(mutation)));
 put(root,base({publishedAt:null,url:null}));const row=J.query(root,{now:NOW}).rows[0];
 assert.equal(row.evidence.publishedAt,null);assert.equal(row.evidence.receivedAt,NOW);assert.equal(row.supportStatus,'unknown');assert.equal(row.eligibleForResearchSupport,false);
 assert.equal(J.query(root,{now:NOW,limit:1}).summary.unknownEvents,1);
});
test('invalid batch validates before any publish; read-only empty query creates no directory',t=>{
 const root=temp(t);assert.equal(J.query(root,{now:NOW}).total,0);assert.equal(fs.existsSync(root),false);
 assert.throws(()=>J.appendBatch(root,[base(),base({eventId:'two',receivedAt:NOW+1})],{now:NOW}));assert.equal(fs.existsSync(root),false);
 put(root,base());assert.throws(()=>J.appendBatch(root,[base({eventId:'two'}),base({kind:'revised',sourceRevisionId:'bad',supersedes:'a'.repeat(64)})],{now:NOW}));
 assert.equal(J.readJournal(root,{now:NOW}).length,1);
});
test('mutation, chain gaps, symlinks, exposed output and active writers are observable failures',t=>{
 const root=temp(t);put(root,base());const file=path.join(root,'000001.json'),raw=fs.readFileSync(file);
 const altered=JSON.parse(raw);altered.evidence.body='篡改';fs.writeFileSync(file,JSON.stringify(altered));assert.throws(()=>J.query(root,{now:NOW}),/INTEGRITY/);
 fs.writeFileSync(file,raw);fs.renameSync(file,path.join(root,'000002.json'));assert.throws(()=>J.query(root,{now:NOW}),/GAP/);
 fs.renameSync(path.join(root,'000002.json'),file);fs.writeFileSync(path.join(root,'.lock'),'');assert.throws(()=>J.query(root,{now:NOW}),/WRITER_ACTIVE/);assert.throws(()=>put(root,base()),/EEXIST/);fs.unlinkSync(path.join(root,'.lock'));
 fs.chmodSync(root,0o755);assert.throws(()=>J.query(root,{now:NOW}),/0700/);fs.chmodSync(root,0o700);
 fs.renameSync(file,path.join(root,'saved'));fs.symlinkSync(path.join(root,'saved'),file);assert.throws(()=>J.query(root,{now:NOW}));
 assert.throws(()=>J.query(path.join(root,'public')));assert.throws(()=>J.query(root,{symbol:'600000/../../x'}));
});
test('provider batches preserve source clocks, dedupe columns and mark un-timed revisions unknown',t=>{
 const root=temp(t),raw={code:'vendor-id',title:'订单标题',summary:'body',showTime:'2026-11-10 15:59:00',url:'https://example.test/vendor',stockList:['1.600000']};
 const first=J.captureProviderBatch(root,[raw,raw],{now:NOW});assert.equal(first.captured,1);assert.equal(J.readJournal(root,{now:NOW}).length,1);
 assert.equal(J.captureProviderBatch(root,[raw],{now:NOW+1}).captured,0);
 J.captureProviderBatch(root,[{...raw,summary:'修订正文'}],{now:NOW+1000});let q=J.query(root,{now:NOW+1000});assert.equal(q.rows[0].evidence.kind,'revised');assert.equal(q.rows[0].supportStatus,'unknown');
 J.captureProviderBatch(root,[{...raw,summary:'撤稿说明',retracted:true,revisedAt:'2026-11-10 16:00:01'}],{now:NOW+2000});q=J.query(root,{now:NOW+2000});assert.equal(q.summary.retractedEvents,1);assert.ok(q.rows.every(x=>!x.eligibleForResearchSupport));
 const unknown={...raw,code:'no-time',showTime:null,url:null};J.captureProviderBatch(root,[unknown],{now:NOW+3000});q=J.query(root,{now:NOW+3000});assert.equal(q.summary.unknownEvents,1);
 assert.equal(J.captureProviderBatch(root,[{...raw,code:'future',showTime:'2026-11-11 09:00:00'}],{now:NOW+4000}).rejected,1);
});
test('provider time parsing uses explicit China zone, rejects ambiguity and invalid civil dates',()=>{
 assert.equal(J.sourceTime('2026-11-10 16:00:00'),NOW);assert.equal(J.sourceTime('2026-11-10T08:00:00Z'),NOW);assert.equal(J.sourceTime(null),null);
 for(const x of ['2026-02-30 12:00:00','2026-11-10T08:00:00','11/10/2026 08:00','2026-13-10 08:00:00'])assert.throws(()=>J.sourceTime(x));
});
test('actual server producer metadata does not replace absent, invalid or future publication with receipt time',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8'),start=source.indexOf('function newsPublicationMetadata('),end=source.indexOf('// Revocation is checked',start);
 const serverRequire=require('node:module').createRequire(path.resolve(__dirname,'../server.js'));
 const metadata=new Function('require',source.slice(start,end)+'\nreturn newsPublicationMetadata;')(serverRequire);
 for(const showTime of [undefined,'','2026-02-30 12:00:00','2026-11-11 16:00:00']){
  const row=metadata({showTime},NOW);assert.equal(row.publishedAt,null);assert.equal(row.receivedAt,NOW);assert.equal(row.publicationTimeStatus,'unknown');
 }
 assert.equal(metadata({showTime:'2026-11-10 15:59:00'},NOW).publishedAt,NOW-60000);
});
test('existing server consumers refresh retractions after CLI append without process restart',t=>{
 const root=temp(t),source=fs.readFileSync(path.resolve(__dirname,'../server.js'),'utf8');
 const start=source.indexOf('let newsEvidenceCache='),end=source.indexOf('const HOLIDAY_BUF_CAP',start);
 assert.ok(start>0&&end>start);
 const state={news:{goodCodes:new Set(['600000']),goodAll:[{id:'vendor-1',codes:['600000']}]}};
 state.news.badAll=[];state.news.neutralAll=[];
 const serverRequire=require('node:module').createRequire(path.resolve(__dirname,'../server.js'));
 const functions=new Function('fs','NEWS_EVIDENCE_ROOT','S','require',source.slice(start,end)+'\nreturn {newsSupportsCode,newsEvidenceAllowsItem};')(fs,root,state,serverRequire);
 assert.equal(functions.newsSupportsCode('600000'),true);
 const one=put(root,base({source:'eastmoney-fast-news',eventId:'vendor-1'}));
 assert.equal(functions.newsSupportsCode('600000'),true);
 put(root,base({source:'eastmoney-fast-news',eventId:'vendor-1',sourceRevisionId:'withdrawn',kind:'retracted',supersedes:one.eventHash,revisedAt:NOW,receivedAt:NOW}));
 assert.equal(functions.newsSupportsCode('600000'),false);assert.equal(functions.newsEvidenceAllowsItem({id:'vendor-1'}),false);
 assert.equal(functions.newsEvidenceAllowsItem({id:'unrelated'}),true);
 const digestStart=source.indexOf('function buildNewsDigest'),digestEnd=source.indexOf('// __HOLIDAY_HELPERS_END__',digestStart);
 const digest=new Function('S','PAPER_CFG','PAPER','isTradeDay','newsEvidenceAllowsItem',source.slice(digestStart,digestEnd)+'\nreturn buildNewsDigest;')(state,{}, {},()=>true,functions.newsEvidenceAllowsItem);
 const item={id:'vendor-1',t:'2026-11-10 15:00:00',title:'WITHDRAWN_TITLE',codes:['600000'],stocks:[],sectors:[]};
 const message=digest(['2026-11-10'],'fixture',5,{bad:[item],good:[item],neutral:[]});assert.doesNotMatch(message,/WITHDRAWN_TITLE/);
 state.news.evidenceRejected=new Set(['unrelated']);assert.equal(functions.newsEvidenceAllowsItem({id:'unrelated'}),false);
 state.news.evidenceIntake={status:'unknown'};assert.equal(functions.newsEvidenceAllowsItem({id:'any'}),false);
});
test('full provider seed batches over 200 rows are preserved rather than silently truncated',t=>{
 const root=temp(t),raw=Array.from({length:205},(_,i)=>({code:'vendor-'+i,title:'fixture '+i,summary:'summary',showTime:null,stockList:[]}));
 assert.equal(J.captureProviderBatch(root,raw,{now:NOW}).captured,205);
 assert.equal(J.query(root,{now:NOW,limit:1}).summary.currentEvents,205);
 assert.equal(J.query(root,{now:NOW,limit:1}).summary.eligibleForResearchSupport,0);
});
test('read-only UI uses text nodes for titles/body and rejects script and credential links',()=>{
 const ui=require('../public/assets/news-evidence-workbench');
 class Element{constructor(tag){this.tag=tag;this.children=[];}appendChild(x){this.children.push(x);}replaceChildren(){this.children=[];}set innerHTML(_){throw Error('dynamic HTML forbidden');}}
 const doc={createElement:tag=>new Element(tag)},container=new Element('div');
 ui.render(doc,container,{rows:[{sequence:1,supportStatus:'retracted',evidence:{title:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>',url:'javascript:alert(1)',kind:'retracted',uncertainty:[]}}]});
 assert.equal(container.children.length,1);assert.match(container.children[0].children[0].textContent,/<img/);
 assert.equal(container.children[0].children.some(x=>x.tag==='a'),false);assert.equal(ui.allowedUrl('https://example.test/original'),'https://example.test/original');
 assert.equal(ui.allowedUrl('https://user:secret@example.test'),null);assert.equal(ui.clock(null),'未知');
});
