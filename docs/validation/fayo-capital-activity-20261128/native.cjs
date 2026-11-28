'use strict';
// Original journal CLI -> authenticated original service -> existing evidence page.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname,input=path.join(__dirname,'news-input.json');fs.mkdirSync(out,{recursive:true});
(async()=>{const f=await createFixture({count:0});try{
 const root=path.join(f.tmp,'data/news-evidence'),route='/api/research/news-evidence';
 const cli=file=>{const p=spawnSync(process.execPath,['scripts/news-evidence.js','import',file],{cwd:process.cwd(),env:{...process.env,V6_NEWS_EVIDENCE_DIR:root},encoding:'utf8',timeout:20000});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
 const compatibility=cli(path.join(__dirname,'../fayo-index-adjustment-20261128/news-input.json')),imported=cli(input),reused=cli(input);assert.ok(reused.results.every(x=>x.reused));
 const read=async symbol=>{const r=await f.request(route+'?asOf='+Date.now()+(symbol?'&symbol='+symbol:''));assert.equal(r.status,200);assert.equal(r.body.ok,true);return r.body.result;};
 const response=await read(''),asOf=response.asOf;
 const {projectNewsEvents}=await import(pathToFileURL(path.resolve('public/nova/event-research.mjs')).href);
 const projected=projectNewsEvents(response.rows,asOf,Date.now());assert.equal(projected.rows.length,4);
 const capitals=projected.rows.filter(x=>x.capitalActivity);assert.equal(capitals.length,2);
 const buyback=capitals.find(x=>x.capitalActivity.action==='buyback').capitalActivity,disposal=capitals.find(x=>x.capitalActivity.action==='disposal').capitalActivity;
 assert.equal(buyback.reportedThrough,'2026-11-10');assert.equal(buyback.sourceCompletion,'completed');
 assert.equal(buyback.documentDate,'2026-11-11');assert.equal(buyback.executionPeriod,null);
 assert.deepEqual(buyback.rows[0].quantities.map(x=>[x.text,x.unit,x.bound]),[['3,000','万元','lower'],['5,000','万元','upper']]);
 const cumulative=buyback.rows.find(x=>x.role==='cumulative');assert.equal(cumulative.quantities.find(x=>x.measure==='money').text,'34,789,896.38');
 assert.equal(disposal.sourceCompletion,'in-progress');assert.equal(disposal.rows.find(x=>x.role==='reported').quantities[0].text,'40,700,300');assert.equal(disposal.actualMarketFlow,null);
 assert.equal(disposal.documentDate,'2025-11-12');assert.equal(disposal.executionPeriod.start,'2025-11-10');assert.equal(disposal.executionPeriod.end,'2025-11-12');
 assert.ok(capitals.every(x=>x.row.evidence.publishedAt===null&&!x.capitalActivity.canTrade&&!x.capitalActivity.canTrain&&!x.capitalActivity.canNotify&&!x.capitalActivity.canQualify));
 assert.equal(projected.rows.filter(x=>x.indexAdjustment).length,2,'prior index plan inputs retain their own consumer');
 const first=Math.min(...response.rows.map(x=>x.recordedAt)),early=await f.request(route+'?asOf='+(first-1));assert.equal(early.body.result.rows.length,0);
 const denied=await f.request(route,'GET',null,f.viewerToken);assert.notEqual(denied.body.ok,true);
 const associated=await read('600050');assert.equal(associated.rows.length,2,'same security can link independent index and disposal events without merging quantities');
 const t=Date.now(),original={...JSON.parse(fs.readFileSync(input))[0],source:'isolated-capital-control',eventId:'synthetic-retraction',sourceRevisionId:'original',title:'隔离合成回购控制',securities:['600001'],body:'证券代码：600001\n回购计划不超过人民币100万元。',receivedAt:t};
 const synthetic=path.join(f.tmp,'capital-control.json');fs.writeFileSync(synthetic,JSON.stringify(original));const a=cli(synthetic).results[0],historical=await read('600001');
 const revisedAt=Date.now();fs.writeFileSync(synthetic,JSON.stringify({...original,kind:'retracted',sourceRevisionId:'retracted',supersedes:a.eventHash,receivedAt:revisedAt,revisedAt}));cli(synthetic);
 const withdrawn=await read('600001');assert.equal(projectNewsEvents(withdrawn.rows,withdrawn.asOf,Date.now()).rows[0].capitalActivity.status,'inactive');
 const past=await f.request(route+'?asOf='+historical.asOf+'&symbol=600001');assert.equal(projectNewsEvents(past.body.result.rows,historical.asOf,Date.now()).rows[0].capitalActivity.status,'source-claims');
 if(process.env.FAYO_CAPITAL_BROWSER){const p=spawnSync('python',[process.env.FAYO_CAPITAL_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out,historicalAsOf:historical.asOf}),encoding:'utf8',timeout:180000});assert.equal(p.status,0,p.stderr.slice(-2000));}
 const files=['public/nova/event-research.mjs','public/nova/research.js','src/core/news-evidence-journal.js','src/core/corporate-actions.js','src/strategy/issuer-event-linkage.js'];
 const receipt={scope:'Two actual received capital-disclosure factual excerpts plus two previous actual index-excerpt compatibility controls, through original CLI/private journal/authenticated service/desktop-mobile evidence page. Synthetic retraction is separate. No independent issuer/actor, publication-time, fund-flow or execution attestation.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),inputSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),compatibility,imported,reused,asOf,http:200,beforeArchiveRows:early.body.result.rows.length,viewerDenied:true,associatedRows:associated.rows.length,records:response.rows,projection:projected,syntheticControl:{source:'isolated-capital-control',historicalAsOf:historical.asOf,currentStatus:'inactive',historicalStatus:'source-claims'}};
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({actualCapitalEvents:2,indexCompatibility:2,stockAssociationRows:2,duplicateImports:2,viewerDenied:true,syntheticRetraction:'inactive'}));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
