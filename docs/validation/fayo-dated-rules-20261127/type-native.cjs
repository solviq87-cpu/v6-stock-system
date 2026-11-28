'use strict';
// Run from V6_BO; import public PDF excerpts through the original operator CLI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname;
(async()=>{const f=await createFixture({count:0});try{
 const root=path.join(f.tmp,'data/news-evidence'),input=path.join(__dirname,'type-news-input.json');
 const imported=spawnSync(process.execPath,['scripts/news-evidence.js','import',input],{cwd:process.cwd(),env:{...process.env,V6_NEWS_EVIDENCE_DIR:root},encoding:'utf8',timeout:20000});assert.equal(imported.status,0,imported.stderr);
 const route='/api/research/news-evidence',asOf=Date.now();
 const r=await f.request(route+'?asOf='+asOf);assert.equal(r.status,200);assert.equal(r.body.ok,true);
 const {projectNewsEvents}=await import(pathToFileURL(path.resolve('public/nova/event-research.mjs')).href);
 const projected=projectNewsEvents(r.body.result.rows,asOf,Date.now());assert.equal(projected.rows.length,3);
 const types=Object.fromEntries(projected.rows.map(e=>[e.row.evidence.source,Object.fromEntries(e.securityIdentity.rows.map(x=>[x.symbol,x.type]))]));
 assert.deepEqual(types['spdb-2025-summary'],{'360003':null,'360008':null,'600000':'ordinary-a-share'});
 assert.deepEqual(types['510300-product-summary'],{'510300':'etf'});
 assert.deepEqual(types['spdb-preference-dividend'],{'360003':'preferred-share','360008':'preferred-share','600000':null});
 assert.ok(projected.rows.every(e=>e.securityIdentity.canQualify===false&&e.securityIdentity.canTrade===false&&e.row.evidence.publishedAt===null));
 const first=Math.min(...r.body.result.rows.map(e=>e.recordedAt));const early=await f.request(route+'?asOf='+(first-1));assert.equal(early.body.result.rows.length,0);
 const denied=await f.request(route,'GET',null,f.viewerToken);assert.notEqual(denied.body.ok,true);
 const privateArchive=fs.readdirSync(root).filter(n=>n.endsWith('.json')).map(n=>({file:n,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')}));
 if(process.env.FAYO_DATED_BROWSER){const p=spawnSync('python',[process.env.FAYO_DATED_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out}),encoding:'utf8',timeout:180000});if(p.status!==0)throw Error(p.stderr.slice(-1500));}
 const files=['public/nova/event-research.mjs','public/nova/research.js','src/core/news-evidence-journal.js'];
 fs.writeFileSync(path.join(out,'type-native.json'),JSON.stringify({scope:'Three actual received public PDF excerpts through the existing local news CLI, authenticated journal API, original projection and native desktop/mobile evidence page. Source/types are unverified claims; no source timestamp, exchange, PIT or execution qualification.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),inputSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),imported:JSON.parse(imported.stdout),http:r.status,asOf,types,archive:privateArchive,firstRecordedAt:first,beforeArchiveRows:early.body.result.rows.length,viewerDenied:true,records:r.body.result.rows,projection:projected},null,2)+'\n');console.log(types);
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
