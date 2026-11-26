'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{spawnSync}=require('node:child_process');
const {collectEcbFxRate}=require('../src/core/ecb-fx-daily');
const {collectSecCompanyFact}=require('../src/core/sec-companyfacts');
const {collectWorldBankIndicator}=require('../src/core/worldbank-indicators');
const {appendBackgroundReceipt,readBackgroundAsOf,readReceipts}=require('../src/core/market-data-evidence');
const {readEvents}=require('../src/core/research-workspace-store');
const ECB={currency:'USD',start:'2025-01-02',end:'2025-01-03'};
const SEC={cik:320193,tag:'Assets',unit:'USD',asOf:'2025-09-01'};
const WB={country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2023,endYear:2024};
const csv=rate=>Buffer.from('KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\r\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2025-01-02,'+rate+'\r\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2025-01-03,\r\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const response=(raw,type,decoded=false)=>({ok:true,status:200,headers:{get:k=>k==='content-type'?type:null},...(decoded?{text:async()=>raw.toString('utf8')}:{body:Readable.from([raw])})});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-background-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;
}
const read=(root,provider,scope,decisionAt=Date.now())=>readBackgroundAsOf({root,provider,scope,decisionAt});
const capture=(root,raw,observedAt,scope=ECB)=>appendBackgroundReceipt({root,provider:'ecb',scope,raw,byteBasis:'response-body',observedAt,requestStartedAt:observedAt-50});

test('official background responses share the original private evidence journal and preserve exact streamed bytes, source timing gaps and null values',async t=>{
 const root=fixture(t),before=Date.now()-2000;
 let ecbCalls=0,secCalls=0,wbCalls=0;
 const ecbRaw=csv('1.2'),secRaw=Buffer.from(JSON.stringify({cik:320193,facts:{'us-gaap':{Assets:{units:{USD:[{end:'2024-12-31',val:2000,accn:'0000320193-25-000011',form:'10-K',filed:'2025-02-02'}]}}}}})),
  wbRaw=Buffer.from(JSON.stringify([{pages:1},[{countryiso3code:'CHN',indicator:{id:WB.indicator},date:'2023',value:0},{countryiso3code:'CHN',indicator:{id:WB.indicator},date:'2024',value:null}]]));
 const er=await collectEcbFxRate({...ECB,archiveRoot:root,fetchImpl:async()=>{ecbCalls++;return response(ecbRaw,'text/csv');}});
 const sr=await collectSecCompanyFact({...SEC,userAgent:'FAYO research researcher@example.org',archiveRoot:root,fetchImpl:async()=>{secCalls++;return response(secRaw,'application/json');}});
 const wr=await collectWorldBankIndicator({...WB,archiveRoot:root,fetchImpl:async()=>{wbCalls++;return response(wbRaw,'application/json');}});
 assert.deepEqual([ecbCalls,secCalls,wbCalls],[1,1,1]);
 const events=readEvents(path.join(root,'events'));assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.data.provider),['ecb','sec-edgar','worldbank']);
 for(const [result,raw,provider,scope] of [[er,ecbRaw,'ecb',ECB],[sr,secRaw,'sec-edgar',SEC],[wr,wbRaw,'worldbank',WB]]){
  assert.equal(result.archiveReceipt.dataVersion,sha(raw));assert.equal(result.archiveReceipt.version,1);
  assert.deepEqual(fs.readFileSync(path.join(root,'blobs',sha(raw)+'.bin')),raw);
  assert.equal(read(root,provider,scope,before).status,'unavailable-at-decision');
  const r=read(root,provider,scope);assert.equal(r.receipt.hash,result.archiveReceipt.hash);assert.equal(r.receipt.byteBasis,'response-body');
  assert.equal(r.receipt.sourcePublishedAt,null);assert.equal(r.receipt.sourceRevisedAt,null);assert.equal(r.receipt.sourceRevisionKnown,false);
  assert.ok(r.receipt.requestStartedAt<=r.receipt.observedAt&&r.receipt.observedAt<=r.receipt.availableAt);
  assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);assert.equal(r.pointInTimeBacktestReady,false);
 }
 assert.deepEqual(read(root,'ecb',ECB).data.rows.map(x=>x.unitsPerEuro),[1.2,null]);
 assert.deepEqual(read(root,'worldbank',WB).data.rows.map(x=>x.value),[0,null]);
 assert.equal(read(root,'sec-edgar',SEC).data.records[0].acceptedAt,null);
 assert.doesNotMatch(JSON.stringify(events),/researcher@example.org|User-Agent/);
 assert.deepEqual(readReceipts(root,{verifyRaw:true}),[],'background is not imported stock history');
});

test('later revisions cannot change earlier local knowledge; repeated bytes share first-known time, exact retries are idempotent',t=>{
 const root=fixture(t),now=Date.now()-5000;let wall=now+100;
 t.mock.method(Date,'now',()=>wall);
 const first=capture(root,csv('1.1'),now);wall+=100;
 const repeated=capture(root,csv('1.1'),now+10);assert.equal(repeated.data.version,1);assert.equal(repeated.data.firstKnownAt,first.recordedAt);
 const same=capture(root,csv('1.1'),now+10);assert.equal(same.reused,true);assert.equal(same.hash,repeated.hash);
 wall+=100;const revised=capture(root,csv('1.3'),now+20);
 assert.equal(revised.data.version,2);assert.equal(revised.data.previousReceipt,repeated.hash);assert.equal(revised.data.revisionDetectedAt,now+20);
 assert.equal(revised.data.firstKnownAt,revised.recordedAt);assert.equal(revised.data.sourceRevisedAt,null);
 assert.equal(read(root,'ecb',ECB,first.recordedAt-1).data,null);
 assert.equal(read(root,'ecb',ECB,repeated.recordedAt).data.rows[0].unitsPerEuro,1.1);
 assert.equal(read(root,'ecb',ECB,revised.recordedAt).data.rows[0].unitsPerEuro,1.3);
 assert.equal(readEvents(path.join(root,'events')).length,3);
 assert.throws(()=>capture(root,csv('1.4'),now+20),/冲突/);
 assert.throws(()=>capture(root,csv('1.4'),now+15),/回退/);
});

test('bad scope, public roots, unregistered source and corrupted raw receipts fail closed',t=>{
 const root=fixture(t),now=Date.now()-1000;
 assert.throws(()=>capture(root,csv('1.1'),now,{...ECB,token:'secret'}),/未知字段/);
 assert.throws(()=>capture(path.join(root,'public'),csv('1.1'),now),/公开/);
 assert.throws(()=>capture(path.join(root,'htdocs'),csv('1.1'),now),/公开/);
 assert.throws(()=>appendBackgroundReceipt({root,provider:'unknown',scope:ECB,raw:csv('1.1'),byteBasis:'response-body',observedAt:now,requestStartedAt:now-50}),/未登记/);
 assert.throws(()=>capture(root,Buffer.from([0xff]),now),/UTF-8/);
 const receipt=capture(root,csv('1.1'),now);const rawFile=path.join(root,'blobs',receipt.data.dataVersion+'.bin');
 fs.writeFileSync(rawFile,csv('9.9'));const before=fs.readFileSync(rawFile);
 assert.throws(()=>read(root,'ecb',ECB),/哈希/);
 assert.throws(()=>capture(root,csv('1.2'),now+100),/哈希/);
 assert.deepEqual(fs.readFileSync(rawFile),before);assert.equal(readEvents(path.join(root,'events')).length,1);
});

test('decoded fallback is explicitly distinguished from exact response-body bytes; old collector remains opt-in',async t=>{
 const root=fixture(t),raw=csv('1.2'),fetchImpl=async()=>response(raw,'text/csv',true);
 const noArchive=await collectEcbFxRate({...ECB,fetchImpl});assert.equal(noArchive.archiveReceipt,undefined);assert.deepEqual(fs.readdirSync(root),[]);
 const archived=await collectEcbFxRate({...ECB,fetchImpl,archiveRoot:root});assert.ok(archived.archiveReceipt);
 assert.equal(read(root,'ecb',ECB).receipt.byteBasis,'decoded-body-text');
});

test('existing manual market CLI reads a frozen background snapshot with no network or journal mutation',async t=>{
 const root=fixture(t),e=capture(root,csv('1.1'),Date.now()-1000),file=path.join(root,'events','000001.json'),before=fs.readFileSync(file);
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/market-data-sync.js'),'--background-as-of',root,'ecb',JSON.stringify(ECB),new Date(e.recordedAt).toISOString()],{encoding:'utf8',timeout:5000,env:{...process.env,V6_MARKET_SYNC_INTERVAL_MS:'60000'}});
 assert.equal(result.status,0,result.stderr);const out=JSON.parse(result.stdout);assert.equal(out.receipt.hash,e.hash);assert.equal(out.canTrade,false);assert.deepEqual(fs.readFileSync(file),before);
});

test('SEC and World Bank decoded text fallback retain explicit archive byte basis',async t=>{
 const root=fixture(t),secRaw=Buffer.from(JSON.stringify({cik:320193,facts:{'us-gaap':{Assets:{units:{USD:[{end:'2024-12-31',val:2000,accn:'0000320193-25-000011',form:'10-K',filed:'2025-02-02'}]}}}}})),
  wbRaw=Buffer.from(JSON.stringify([{pages:1},[{countryiso3code:'CHN',indicator:{id:WB.indicator},date:'2023',value:0}]]));
 const sr=await collectSecCompanyFact({...SEC,userAgent:'FAYO research researcher@example.org',archiveRoot:root,fetchImpl:async()=>response(secRaw,'application/json',true)});
 const wr=await collectWorldBankIndicator({...WB,archiveRoot:root,fetchImpl:async()=>response(wbRaw,'application/json',true)});
 for(const [r,provider,scope,raw] of [[sr,'sec-edgar',SEC,secRaw],[wr,'worldbank',WB,wbRaw]]){
  assert.equal(r.archiveReceipt.dataVersion,sha(raw));assert.equal(read(root,provider,scope).receipt.byteBasis,'decoded-body-text');
 }
});
