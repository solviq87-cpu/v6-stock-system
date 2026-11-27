'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {collectEiaSpotDaily,projectEiaJson}=require('../src/core/eia-spot-daily');
const E=require('../src/core/market-data-evidence');
const {readEcbCrossAsOf}=require('../src/core/ecb-cross-reference');
const tick=Date.parse('2025-02-10T16:00:00Z'),scope={series:'RWTC',start:'2025-02-03',end:'2025-02-07'},key='fixture-key-not-real-123456';
const row=(period,value,series='RWTC')=>({period,value,series,units:'$/BBL'});
const body=(data,extra={})=>JSON.stringify({response:{total:String(data.length),frequency:'daily',dateFormat:'YYYY-MM-DD',data,...extra}});
const raw=()=>body([row('2025-02-03','72.5'),row('2025-02-04',null),row('2025-02-05','-3.2'),row('2025-02-07',0)]);
const config={...scope,apiKey:key,clock:()=>tick};
const wire=(text=raw(),init={})=>new Response(text,{headers:{'content-type':'application/json'},...init});
const project=text=>projectEiaJson(text,{...scope,observedAt:tick});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-d24-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'archive');}
const receipt=(root,raw,observedAt=tick)=>E.appendBackgroundReceipt({root,provider:'us-eia',scope,raw:Buffer.from(raw),byteBasis:'response-body',requestStartedAt:observedAt-1,observedAt});
test('one explicit EIA daily request per WTI/Brent series, never a futures or executable quote',async()=>{
 for(const series of ['RWTC','RBRTE']){let calls=0;const r=await collectEiaSpotDaily({...config,series,fetchImpl:async(url,opts)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://api.eia.gov');assert.equal(u.pathname,'/v2/petroleum/pri/spt/data/');assert.equal(u.searchParams.get('api_key'),key);assert.equal(u.searchParams.get('facets[series][]'),series);assert.equal(u.searchParams.get('frequency'),'daily');assert.equal(opts.redirect,'error');return wire(body([row('2025-02-03','75.01',series)]));}});assert.equal(calls,1);assert.equal(r.series,series);assert.equal(r.rows[0].value,75.01);assert.equal(r.rows[0].unit,'USD/barrel');assert.equal(r.canTrade,false);assert.equal(r.rows[0].quoteAt,null);assert.ok(!JSON.stringify(r).includes(key));}
});
test('series, daily frequency, dates, total and units cannot be forged; null, signed and zero values are distinct',()=>{
 assert.deepEqual(project(raw()).rows.map(x=>x.value),[72.5,null,-3.2,0]);assert.equal(project(raw()).coverage.completeTradingCalendar,false);
 for(const bad of [body([row('2025-02-03','75','RBRTE')]),body([{...row('2025-02-03',75),units:'USD/ton'}]),body([row('2025-02-30',75)]),body([row('2025-02-08',75)]),body([row('2025-02-03',75),row('2025-02-03',76)]),body([row('2025-02-03',' 72')]),body([row('2025-02-03',75)],{total:'2'}),body([row('2025-02-03',75)],{frequency:'weekly'}),JSON.stringify({warning:'truncated',...JSON.parse(raw())})])assert.throws(()=>project(bad));
 assert.equal(project(body([])).coverage.knownValues,0);
});
test('missing credentials stop before dispatch; HTTP denial and partial response never retry or reveal credential',async()=>{
 let calls=0;await assert.rejects(()=>collectEiaSpotDaily({...config,apiKey:undefined,fetchImpl:async()=>{calls++;return wire();}}),/密钥/);assert.equal(calls,0);
 for(const status of [401,403,429,206]){await assert.rejects(()=>collectEiaSpotDaily({...config,fetchImpl:async()=>{calls++;return wire('',{status});}}),e=>e.message===`EIA HTTP ${status}`);}
 assert.equal(calls,4);
 await assert.rejects(()=>collectEiaSpotDaily({...config,fetchImpl:async url=>{throw Error(url);}}),e=>!e.message.includes(key)&&/请求失败/.test(e.message));
});
test('transport length, UTF8, redirect, rollback and echoed secrets fail closed before archival',async t=>{
 const archiveRoot=fixture(t);
 const broken=Buffer.from([0xff,0x7b]);
 for(const make of [()=>wire(raw(),{headers:{'content-type':'application/json','content-length':'1'}}),()=>wire(raw(),{headers:{'content-type':'text/html'}}),()=>wire(broken),()=>({...wire(),ok:true,status:200,redirected:true}),()=>wire(JSON.stringify({...JSON.parse(raw()),request:{params:{api_key:key}}})),()=>wire(JSON.stringify({...JSON.parse(raw()),note:key}))])await assert.rejects(()=>collectEiaSpotDaily({...config,archiveRoot,fetchImpl:async()=>make()}));
 const times=[tick,tick+10,tick-1,tick+100];let i=0;
 await assert.rejects(()=>collectEiaSpotDaily({...config,clock:()=>times[Math.min(i++,3)],archiveRoot,fetchImpl:async()=>wire()}),/时钟/);
 assert.equal(fs.existsSync(archiveRoot),false);
 assert.throws(()=>receipt(archiveRoot,JSON.stringify({...JSON.parse(raw()),request:{api_key:'redacted'}})),/凭据/);
 assert.equal(fs.existsSync(archiveRoot),false);
});
test('EIA reuses the existing private original-raw journal, receipt replay and background overview',async t=>{
 const root=fixture(t),r=await collectEiaSpotDaily({...config,archiveRoot:root,fetchImpl:async()=>wire()});
 assert.ok(r.archiveReceipt.hash);assert.equal(E.readBackgroundAsOf({root,provider:'us-eia',scope,decisionAt:r.archiveReceipt.availableAt-1}).status,'unavailable-at-decision');
 const found=E.readBackgroundAsOf({root,provider:'us-eia',scope,decisionAt:Date.now()});assert.deepEqual(found.data.rows.map(x=>x.value),[72.5,null,-3.2,0]);assert.equal(found.canTrade,false);
 const again=E.appendBackgroundReceipt({root,provider:'us-eia',scope,raw:Buffer.from(raw()),byteBasis:'response-body',requestStartedAt:tick,observedAt:tick});assert.equal(again.hash,r.archiveReceipt.hash);
 const overview=E.readBackgroundOverview({root});assert.equal(overview.rows[0].sourceTimePrecision,'observation-date');assert.equal(overview.rows[0].records[0].unit,'USD/barrel');assert.equal(overview.rows[0].missingValues,1);
 const bytes=found.receipt.rawEvidence;fs.writeFileSync(path.join(root,'blobs',bytes.sha256+'.bin'),Buffer.alloc(bytes.byteLength,120));assert.throws(()=>E.readBackgroundAsOf({root,provider:'us-eia',scope,decisionAt:Date.now()}),/哈希/);
});
test('ECB cross-reference reads both original archived legs as-of, joins same-day only and never invents a live quote',t=>{
 const root=fixture(t),start=scope.start,end=scope.end;
 const csv=(currency,rows)=>'KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\n'+rows.map(([d,v])=>`EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,${d},${v??''}`).join('\n')+'\n';
 const append=(currency,rows,observedAt)=>E.appendBackgroundReceipt({root,provider:'ecb',scope:{currency,start,end},raw:Buffer.from(csv(currency,rows)),byteBasis:'response-body',requestStartedAt:observedAt-1,observedAt});
 const a=append('USD',[['2025-02-03','1.1'],['2025-02-04','1.2']],tick);
 const cfg={root,baseCurrency:'USD',quoteCurrency:'CNY',start,end};assert.equal(readEcbCrossAsOf({...cfg,decisionAt:Date.now()}).status,'unavailable-at-decision');
 const b=append('CNY',[['2025-02-03','7.7'],['2025-02-05','7.8']],tick+1);
 const r=readEcbCrossAsOf({...cfg,decisionAt:Date.now()});assert.equal(r.status,'derived-research-snapshot');assert.ok(Math.abs(r.rows[0].unitsPerBase-7)<1e-12);assert.deepEqual(r.rows.slice(1).map(x=>x.unitsPerBase),[null,null]);
 assert.equal(r.rows[0].knownAt,Math.max(a.recordedAt,b.recordedAt));assert.equal(r.rows[0].quoteAt,null);assert.equal(r.canTrade,false);assert.equal(r.providerIndependenceVerified,false);
});
