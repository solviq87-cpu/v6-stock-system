'use strict';
// Isolated synthetic revision states plus the previously received public PDF excerpts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const journal=require(path.resolve('src/core/news-evidence-journal'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname;
(async()=>{const f=await createFixture({count:0});try{
 const root=path.join(f.tmp,'data/news-evidence'),receivedAt=Date.now()-1;
 function add(eventId,symbol,prior=null,{kind='revised',conflict=false}={}){
  const body='优先股代码：'+symbol+(conflict?'\n股票种类  股票上市交易所 股票简称 股票代码\n普通股 A股    隔离样本    '+symbol+'    -':'');
  const result=journal.appendBatch(root,[{schemaVersion:1,source:'isolated-state-study',eventId,sourceRevisionId:crypto.randomBytes(12).toString('hex'),kind:prior?kind:'original',supersedes:prior?.eventHash||null,url:null,title:'隔离状态样本：'+eventId,body,bodyScope:'provider-summary',securities:[symbol],publishedAt:null,receivedAt,revisedAt:null}]);
  return journal.readJournal(root).find(e=>e.eventHash===result.results[0].eventHash);
 }
 let chain=null;for(let i=0;i<57;i++)chain=add('paged-chain','600101',chain);
 const retractedOriginal=add('retraction','600108');await new Promise(r=>setTimeout(r,5));add('retraction','600108',retractedOriginal,{kind:'retracted'});
 const association=add('association','600104');add('association','600204',association);
 const complete=add('complete-chain','600105');add('complete-chain','600105',complete);
 const conflict=add('conflict','600106',null,{conflict:true});add('conflict','600106',conflict,{kind:'retracted',conflict:true});
 const imported=spawnSync(process.execPath,['scripts/news-evidence.js','import',path.join(__dirname,'type-news-input.json')],{env:{...process.env,V6_NEWS_EVIDENCE_DIR:root},encoding:'utf8',timeout:20000});assert.equal(imported.status,0,imported.stderr);
 const {projectNewsEvents}=await import(pathToFileURL(path.resolve('public/nova/event-research.mjs')).href);
 const cases=[
  {id:'incomplete',symbol:'600101',reasons:['incomplete-chain'],label:'本页修订链不完整，待核对'},
  {id:'superseded',symbol:'600101',offset:50,reasons:['superseded'],label:'该截点已被后续版本替代'},
  {id:'retracted',symbol:'600108',reasons:['retracted'],label:'来源已撤稿'},
  {id:'association',symbol:'600104',reasons:['association-removed'],label:'本次查询的证券关联已移除'},
  {id:'complete',symbol:'600105',reasons:[],label:'原文字样'},
  {id:'conflict',symbol:'600106',reasons:['retracted'],label:'类型冲突，待核对'},
  {id:'historical',symbol:'600108',asOf:retractedOriginal.recordedAt,reasons:[],label:'原文字样'}];
 const rows=[];
 for(const c of cases){const asOf=c.asOf??Date.now(),q=new URLSearchParams({symbol:c.symbol,asOf:String(asOf),offset:String(c.offset||0),limit:'50'}),r=await f.request('/api/research/news-evidence?'+q);assert.equal(r.status,200);assert.equal(r.body.ok,true);
  const p=projectNewsEvents(r.body.result.rows,asOf,Date.now());assert.equal(p.rows.length,1);assert.deepEqual(p.rows[0].securityIdentity.inactiveReasons.map(x=>x.code),c.reasons);
  assert.equal(p.rows[0].securityIdentity.canQualify,false);if(c.id==='conflict')assert.equal(p.rows[0].securityIdentity.rows[0].typeConflict,true);
  rows.push({case:c.id,http:r.status,asOf,projection:p,summary:r.body.result.summary});}
 const asOf=Date.now(),all=await f.request('/api/research/news-evidence?asOf='+asOf+'&limit=200');assert.equal(all.body.result.rows.length,68);
 const allProjection=projectNewsEvents(all.body.result.rows,asOf,Date.now());
 const actual=Object.fromEntries(allProjection.rows.filter(e=>e.row.evidence.source!=='isolated-state-study').map(e=>[e.row.evidence.source,Object.fromEntries(e.securityIdentity.rows.map(x=>[x.symbol,x.type]))]));
 assert.equal(actual['spdb-2025-summary']['600000'],'ordinary-a-share');assert.equal(actual['510300-product-summary']['510300'],'etf');assert.equal(actual['spdb-preference-dividend']['360003'],'preferred-share');
 const denied=await f.request('/api/research/news-evidence','GET',null,f.viewerToken);assert.notEqual(denied.body.ok,true);
 fs.writeFileSync(path.join(out,'state-cases.json'),JSON.stringify(cases,null,2)+'\n');
 if(process.env.FAYO_DATED_BROWSER){const b=spawnSync('python',[process.env.FAYO_DATED_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out,cases}),encoding:'utf8',timeout:240000});if(b.status!==0)throw Error(b.stderr.slice(-1800));}
 const files=['public/nova/event-research.mjs','public/nova/research.js','src/core/news-evidence-journal.js'];
 fs.writeFileSync(path.join(out,'state-native.json'),JSON.stringify({scope:'Synthetic bounded revision/pagination/association/retraction cases through original append, authenticated query and native evidence UI. Three actual public PDF excerpts are compatibility cases only. No production operations or qualification.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),cases:rows,actualPublicPdfTypes:actual,records:all.body.result.rows,viewerDenied:true,imported:JSON.parse(imported.stdout)},null,2)+'\n');console.log(rows.map(r=>[r.case,r.projection.rows[0].securityIdentity.inactiveReasons]));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
