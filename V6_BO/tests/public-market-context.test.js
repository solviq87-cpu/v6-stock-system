'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fetchPublicContext,requestPublicJson}=require('../src/core/public-market-context');
const {capturePublicContext}=require('../scripts/capture-public-market-context');
const NOW=Date.parse('2026-11-12T16:00:00+08:00');
const flow={rc:0,data:{klines:['2026-11-11,100,-20,-30,40,60,1,-2,-3,4,6,3200,0.5,10000,0.6','2026-11-12,-,0,null, ,50,1,2,3,4,5,3300,0.2,11000,0.3']}};
function pool(symbol,tc=1,qdate=20261112){return {rc:0,data:{tc,qdate,pool:[{c:symbol,n:'样本',p:12340,ztp:13500,zdp:9.99,amount:10000,fbt:92500,lbt:150000,zbc:2,lbc:1,fund:3000,hybk:'行业'}]}};}
function source(overrides={}){return async target=>{const u=new URL(target);if(u.pathname.endsWith('getTopicZTPool'))return overrides.sealed??pool('600001');if(u.pathname.endsWith('getTopicZBPool'))return overrides.broken??pool('600002');return overrides.flow??flow;};}
test('actual source field order/units and pool scale are parsed, missing numbers stay null',async()=>{
 const targets=[],request=source(),report=await fetchPublicContext({date:'2026-11-12',sectorCode:'BK1034',symbol:'600000',historyDays:2},{now:()=>NOW,requestJson:target=>{targets.push(target);return request(target);}});
 assert.equal(targets.length,5);assert.ok(targets.some(u=>new URL(u).searchParams.get('secid')==='90.BK1034'));assert.ok(targets.some(u=>new URL(u).searchParams.get('secid2')==='0.399001'));
 const r=report.marketFlow.records[0];assert.equal(r.mainNetInflow,100);assert.equal(r.smallNetInflow,-20);assert.equal(r.midNetInflow,-30);assert.equal(r.bigNetInflow,40);assert.equal(r.superNetInflow,60);assert.equal(r.shenzhenClose,10000);
 assert.equal(report.marketFlow.records[1].mainNetInflow,null);assert.equal(report.marketFlow.records[1].smallNetInflow,0);assert.equal(report.marketFlow.records[1].midNetInflow,null);assert.equal(report.marketFlow.records[1].bigNetInflow,null);
 assert.equal(report.stockFlow.records[0].close,3200);assert.equal(report.stockFlow.symbol,'600000');assert.equal(report.stockFlow.source,'eastmoney');assert.equal(report.stockFlow.fundsMethod,'vendor-order-size-estimate');assert.equal(report.sectorFlow.sectorCode,'BK1034');assert.equal(report.sectorFlow.records[0].close,undefined);assert.equal(report.marketFlow.unit,'CNY');assert.equal(report.marketFlow.interpretation,'vendor-order-size-estimate');assert.equal(report.marketFlow.sourceTimestamp,null);
 assert.equal(report.limitPools.sealRate,.5);assert.equal(report.limitPools.breakRate,.5);assert.equal(report.limitPools.limitUpToBrokenRatio,1);assert.equal(report.limitPools.sealed.records[0].price,12.34);assert.equal(report.limitPools.broken.records[0].limitUpPrice,13.5);assert.equal(report.canTrade,false);
});
test('only one context intake runs at a time, without automatic retries',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;}),request=source();
 const first=fetchPublicContext({date:'2026-11-12'},{now:()=>NOW,requestJson:async target=>{calls++;await gate;return request(target);}});
 await assert.rejects(()=>fetchPublicContext({date:'2026-11-12'},{now:()=>NOW,requestJson:source()}),/已在运行/);release();await first;assert.equal(calls,3);
 const after=await fetchPublicContext({date:'2026-11-12'},{now:()=>NOW,requestJson:source()});assert.equal(after.limitPools.complete,true);
});
test('requested pool dates never replace actual dates; incomplete pages, unknown totals and overlaps cannot produce sentiment ratios',async()=>{
 for(const override of [{broken:pool('600002',2)},{broken:pool('600002',1,20261111)},{broken:{rc:0,data:{qdate:20261112,pool:[]}}},{broken:pool('600001')},{sealed:{rc:0,data:null}}]){
  const r=await fetchPublicContext({date:'2026-11-12'},{now:()=>NOW,requestJson:source(override)});assert.equal(r.limitPools.status,'unknown');assert.equal(r.limitPools.sealRate,null);assert.equal(r.limitPools.limitUpToBrokenRatio,null);
 }
});
test('history keeps original dates, never fills absent dates, reports undeclared completeness and empty pools honestly',async()=>{
 const r=await fetchPublicContext({date:'2026-11-11',historyDays:1},{now:()=>NOW,requestJson:source({sealed:{rc:0,data:{tc:0,qdate:20261111,pool:[]}},broken:{rc:0,data:{tc:0,qdate:20261111,pool:[]}}})});
 assert.deepEqual(r.marketFlow.records.map(x=>x.tradeDate),['2026-11-11']);assert.equal(r.marketFlow.totalCount,null);assert.equal(r.marketFlow.partial,null);assert.equal(r.limitPools.status,'observed-unverified');assert.equal(r.limitPools.sealRate,null);assert.equal(r.limitPools.limitUpToBrokenRatio,null);assert.equal(r.sectorFlow.status,'not-requested');
});
test('request completion timestamps and raw hashes are retained; partial transport failures remain separate',async()=>{
 let now=NOW;const r=await fetchPublicContext({date:'2026-11-12'},{now:()=>now++,requestJson:async target=>{if(target.includes('getTopicZBPool'))throw Error('HTTP 403');const json=target.includes('getTopicZTPool')?pool('600001'):flow;return {json,raw:JSON.stringify(json)};}});
 assert.ok(r.marketFlow.firstObservedAt>r.startedAt);assert.equal(r.marketFlow.rawHash.length,64);assert.equal(r.marketFlow.hashBasis,'raw-response-bytes');assert.equal(r.marketFlow.sourceTimestamp,null);assert.equal(r.limitPools.status,'unknown');assert.equal(r.errors.length,1);assert.match(r.errors[0].message,/403/);assert.equal(r.marketFlow.status,'observed-unverified');
});
test('input bounds and arbitrary URL transport are rejected before fetching',async()=>{
 for(const input of [{date:'2026-11-31'},{date:'2026-11-13'},{historyDays:121},{historyDays:0},{sectorCode:'https://evil'},{symbol:'600001;echo'}])await assert.rejects(()=>fetchPublicContext(input,{now:()=>NOW,requestJson:()=>assert.fail('must not request')}));
 await assert.rejects(()=>requestPublicJson('https://example.com/'),/URL/);await assert.rejects(()=>requestPublicJson('http://push2ex.eastmoney.com/getTopicZTPool'),/URL/);
});
test('capture writes immutable private dated artifacts and refuses public/symlink paths',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-context-'));try{
  const dependencies={now:()=>NOW,requestJson:source()},one=await capturePublicContext(root,{date:'2026-11-12'},dependencies),two=await capturePublicContext(root,{date:'2026-11-12'},dependencies);
  assert.equal(two.reused,true);assert.equal(one.file,two.file);assert.match(path.basename(one.file),/^2026-11-12-[a-f0-9]{64}\.json$/);assert.equal(fs.statSync(one.file).mode&0o777,0o600);assert.equal(fs.statSync(root).mode&0o777,0o700);
  const alias=path.join(root,'alias');fs.symlinkSync(root,alias);await assert.rejects(()=>capturePublicContext(alias,{},dependencies),/符号/);await assert.rejects(()=>capturePublicContext(path.join(root,'public'),{},dependencies),/公开/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('default weekend intake requests pools for the actual latest market session, without inventing a calendar',async()=>{
 const weekend=Date.parse('2026-11-15T08:00:00+08:00'),targets=[];
 const result=await fetchPublicContext({}, {now:()=>weekend,requestJson:async target=>{
  const u=new URL(target);targets.push(u);if(u.pathname.includes('daykline'))return {rc:0,data:{klines:['2026-11-13,1,2,3,4,5,6,7,8,9,10,11,12,13,14']}};
  assert.equal(u.searchParams.get('date'),'20261113');return pool(u.pathname.includes('ZTPool')?'600001':'600002',1,20261113);
 }});
 assert.equal(targets[0].pathname.includes('daykline'),true);assert.equal(result.requestedDate,'2026-11-15');assert.equal(result.tradeDate,'2026-11-13');assert.equal(result.limitPools.complete,true);
});
test('market 503 falls back to actual optional-flow dates; entirely missing data leaves tradeDate null',async()=>{
 const weekend=Date.parse('2026-11-15T08:00:00+08:00');
 const result=await fetchPublicContext({sectorCode:'BK1034'}, {now:()=>weekend,requestJson:async target=>{
  const u=new URL(target);if(u.searchParams.get('secid')==='1.000001')throw Error('HTTP 503');
  if(u.pathname.includes('daykline'))return {rc:0,data:{klines:['2026-11-12,1,2,3,4,5,6,7,8,9,10,11,12,13,14']}};
  assert.equal(u.searchParams.get('date'),'20261112');return pool(u.pathname.includes('ZTPool')?'600001':'600002',1,20261112);
 }});assert.equal(result.tradeDate,'2026-11-12');assert.equal(result.requestedDate,'2026-11-15');assert.equal(result.limitPools.complete,true);assert.equal(result.errors[0].source,'marketFlow');
 const missing=await fetchPublicContext({}, {now:()=>weekend,requestJson:async()=>{throw Error('HTTP 503');}});assert.equal(missing.tradeDate,null);assert.equal(missing.requestedDate,'2026-11-15');
});
test('Beijing 92 prefix uses secid market zero; B-share prefixes are excluded',async()=>{
 const targets=[],request=source();const report=await fetchPublicContext({symbol:'920001',date:'2026-11-12'},{now:()=>NOW,requestJson:target=>{targets.push(new URL(target));return request(target);}});
 assert.equal(report.stockFlow.symbol,'920001');assert.ok(targets.some(u=>u.searchParams.get('secid')==='0.920001'));assert.ok(!targets.some(u=>u.searchParams.get('secid')==='1.920001'));
 for(const symbol of ['900001','200001'])await assert.rejects(()=>fetchPublicContext({symbol},{now:()=>NOW,requestJson:source()}),/A股/);
});
test('explicit target remains a query upper bound while stale responses expose actual dates',async()=>{
 const result=await fetchPublicContext({date:'2026-11-13'},{now:()=>Date.parse('2026-11-13T18:00:00+08:00'),requestJson:source()});
 assert.equal(result.requestedDate,'2026-11-13');assert.equal(result.tradeDate,'2026-11-12');assert.equal(result.marketFlow.matchesRequestedDate,false);assert.equal(result.limitPools.sealed.dateMatched,false);assert.equal(result.limitPools.complete,false);
 const fallback=await fetchPublicContext({}, {now:()=>NOW,requestJson:async target=>{if(target.includes('daykline'))throw Error('503');return target.includes('ZTPool')?pool('600001',1,20261111):pool('600002',1,20261111);}});assert.equal(fallback.tradeDate,'2026-11-11');assert.equal(fallback.limitPools.complete,false);
});
