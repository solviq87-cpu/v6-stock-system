'use strict';
// Run from V6_BO. Original operator importer and authenticated, temporary service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname,input=path.join(__dirname,'news-input.json');
fs.mkdirSync(out,{recursive:true});
(async()=>{const f=await createFixture({count:0});try{
 const root=path.join(f.tmp,'data/news-evidence'),route='/api/research/news-evidence';
 const cli=file=>{const r=spawnSync(process.execPath,['scripts/news-evidence.js','import',file],{cwd:process.cwd(),env:{...process.env,V6_NEWS_EVIDENCE_DIR:root},encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const imported=cli(input),reused=cli(input);assert.ok(reused.results.every(x=>x.reused));
 const asOf=Date.now(),response=await f.request(route+'?asOf='+asOf);assert.equal(response.status,200);assert.equal(response.body.ok,true);
 const {projectNewsEvents}=await import(pathToFileURL(path.resolve('public/nova/event-research.mjs')).href);
 const projected=projectNewsEvents(response.body.result.rows,asOf,Date.now());assert.equal(projected.rows.length,2);
 const current=projected.rows.find(x=>x.row.evidence.eventId.endsWith('2026')),old=projected.rows.find(x=>x.row.evidence.eventId.endsWith('2025'));
 assert.equal(current.indexAdjustment.plannedDate,'2026-12-11');assert.equal(current.indexAdjustment.phase,'after-close');
 assert.equal(current.indexAdjustment.tables[0].removals.length,5);assert.equal(current.indexAdjustment.tables[0].additions.length,5);
 assert.equal(old.indexAdjustment.status,'date-passed-unverified');assert.equal(old.indexAdjustment.implementationConfirmed,false);
 assert.ok(projected.rows.every(x=>x.row.evidence.publishedAt===null&&x.indexAdjustment.canTrade===false&&x.indexAdjustment.canQualify===false));
 const first=Math.min(...response.body.result.rows.map(x=>x.recordedAt)),early=await f.request(route+'?asOf='+(first-1));assert.equal(early.body.result.rows.length,0);
 const denied=await f.request(route,'GET',null,f.viewerToken);assert.notEqual(denied.body.ok,true);
 const symbol=await f.request(route+'?symbol=600176&asOf='+Date.now());assert.equal(symbol.body.result.rows.length,1);
 assert.equal(projectNewsEvents(symbol.body.result.rows,symbol.body.result.asOf,Date.now()).rows[0].indexAdjustment.tables[0].additions[0].symbol,'600176');
 // Synthetic control is explicitly a different source/event from both actual public receipts.
 const t=Date.now(),original={...JSON.parse(fs.readFileSync(input))[0],source:'isolated-index-control',eventId:'synthetic-withdrawal',sourceRevisionId:'original',title:'隔离合成：指数样本调整计划',securities:['600000'],body:'指数样本调整于2026年12月11日收市后生效。',receivedAt:t};
 const synthetic=path.join(f.tmp,'index-control.json');fs.writeFileSync(synthetic,JSON.stringify(original));const a=cli(synthetic).results[0];
 const historical=(await f.request(route+'?symbol=600000&asOf='+Date.now())).body.result;
 const revisedAt=Date.now();fs.writeFileSync(synthetic,JSON.stringify({...original,kind:'retracted',sourceRevisionId:'retracted',supersedes:a.eventHash,receivedAt:revisedAt,revisedAt,title:'隔离合成：指数样本调整撤稿'}));cli(synthetic);
 const withdrawn=(await f.request(route+'?symbol=600000&asOf='+Date.now())).body.result;
 assert.equal(projectNewsEvents(withdrawn.rows,withdrawn.asOf,Date.now()).rows[0].indexAdjustment.status,'inactive');
 const past=await f.request(route+'?symbol=600000&asOf='+historical.asOf);assert.equal(projectNewsEvents(past.body.result.rows,historical.asOf,Date.now()).rows[0].indexAdjustment.status,'future-date');
 if(process.env.FAYO_INDEX_BROWSER){const p=spawnSync('python',[process.env.FAYO_INDEX_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out,historicalAsOf:historical.asOf}),encoding:'utf8',timeout:180000});assert.equal(p.status,0,p.stderr.slice(-2000));}
 const files=['public/nova/event-research.mjs','public/nova/research.js','src/core/news-evidence-journal.js','src/core/corporate-actions.js'];
 const receipt={scope:'Two actual public SSE article excerpts (one linked first table). Original CLI -> private journal -> authenticated API -> existing PC/mobile evidence page. Separate synthetic withdrawal control. No live quotes, actual membership, flow, transaction or publication-time attestation.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),inputSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),imported,reused,http:response.status,asOf,beforeArchiveRows:early.body.result.rows.length,viewerDenied:true,symbolRows:symbol.body.result.rows.length,records:response.body.result.rows,projection:projected,syntheticControl:{historicalAsOf:historical.asOf,withdrawnAsOf:withdrawn.asOf,source:'isolated-index-control',historicalStatus:'future-date',currentStatus:'inactive'}};
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({http:200,actualEvents:2,currentTableRows:[5,5],beforeArchiveRows:0,duplicateImports:reused.results.length,syntheticWithdrawal:'inactive'}));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
