'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fetchPublicStockHistory,requestPublicStockJson}=require('../src/core/public-stock-history');
const NOW=Date.parse('2026-11-12T16:00:00+08:00');
const emRow=(date='2026-11-11')=>`${date},10,11,12,9,23,24680,1,2,3,4`;
const txRow=(date='2026-11-11')=>[date,'10','11','12','9','23'];
const em=(rows=[emRow()],extra={})=>({rc:0,data:{code:'600000',market:1,name:'样本',klines:rows,...extra}});
const tx=(rows=[txRow()],symbol='600000',prefix='sh')=>({code:0,data:{[prefix+symbol]:{day:rows,qt:{[prefix+symbol]:['1','样本',symbol]}}}});
const bytes=json=>({raw:Buffer.from(JSON.stringify(json))});
const load=(json,opts={})=>fetchPublicStockHistory({symbol:'600000',provider:'eastmoney',...opts},{now:()=>NOW,requestJson:async()=>bytes(json)});
test('EM uses fixed unadjusted daily parameters, real CNY amount, lots to shares and response-time knowledge',async()=>{
 let now=NOW,target;
 const r=await fetchPublicStockHistory({symbol:'600000',historyDays:120},{now:()=>now++,requestJson:async u=>{target=new URL(u);return bytes(em());}});
 assert.equal(target.origin,'https://push2his.eastmoney.com');assert.equal(target.searchParams.get('fqt'),'0');assert.equal(target.searchParams.get('klt'),'101');assert.equal(target.searchParams.get('fields2'),'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
 assert.equal(r.status,'observed-unverified');assert.equal(r.stock.bars[0].volume,2300);assert.equal(r.stock.bars[0].amount,24680);assert.equal(r.stock.bars[0].knownAt,NOW+1);assert.equal(r.stock.observedAt,NOW+1);assert.equal(r.priceBasis,'unadjusted');assert.equal(r.sourceTimestamp,null);assert.equal(r.canTrade,false);assert.equal(r.provenance.supplierFinalityConfirmed,false);
 for(const field of ['isST','tradable','suspended','corporateAction','limitUpPrice','statusKnownAt'])assert.equal(r.stock.bars[0][field],undefined);
});
test('auto makes one EM attempt then one TX; TX original day has no manufactured amount',async()=>{
 const calls=[];
 const r=await fetchPublicStockHistory({symbol:'600000'},{now:()=>NOW,requestJson:async u=>{calls.push(u);if(calls.length===1)throw Error('HTTP 503');return bytes(tx());}});
 assert.equal(calls.length,2);assert.equal(r.provider,'tencent');assert.equal(new URL(calls[1]).searchParams.get('param'),'sh600000,day,,,120,');assert.equal(r.stock.bars[0].volume,2300);assert.equal(r.stock.bars[0].amount,undefined);assert.equal(r.errors.length,1);assert.equal(r.errors[0].provider,'eastmoney');
});
test('actual 120-bar TX dividend annotation shape retains extras only in exact raw evidence',async()=>{
 // Observed on one bounded 120-bar request: the 2026-07-16 row has
 // seven fields while ordinary rows have six. Prices here remain mock data.
 const annotation={nd:'2025',fh_sh:'4.2',djr:'2026-07-15',cqr:'2026-07-16',FHcontent:'10派4.2元'};
 const row=[...txRow('2026-07-16'),annotation],response=tx([row,txRow()]);
 const r=await load(response,{provider:'tencent'});
 assert.equal(r.status,'observed-unverified');assert.equal(r.stock.bars.length,2);assert.equal(r.stock.bars[0].amount,undefined);assert.equal(r.stock.bars[0].corporateAction,undefined);
 const raw=JSON.parse(Buffer.from(r.rawEvidence.data,'base64').toString('utf8'));assert.deepEqual(raw.data.sh600000.day[0][6],annotation);
 for(const malformed of [[...row.slice(0,3),{},...row.slice(4)],[...row.slice(0,5)],['2026-07-16',['10'],'11','12','9','23',annotation]]){
  const rejected=await load(tx([malformed]),{provider:'tencent'});assert.equal(rejected.status,'unknown');assert.deepEqual(rejected.stock.bars,[]);assert.ok(rejected.rawEvidence);
 }
});
test('parsed but rejected responses retain the same supplier raw bytes, identity and SHA',async()=>{
 const rejectedEM=em([emRow().replace(',10,',',-,')]),rejectedTX=tx([txRow().slice(0,5)]);
 for(const finalResponse of [null,rejectedTX]){
  const responses=[rejectedEM,finalResponse];let calls=0;
  const r=await fetchPublicStockHistory({symbol:'600000'},{now:()=>NOW,requestJson:async()=>{const json=responses[calls++];if(!json)throw Error('TX offline');return bytes(json);}});
  const expected=finalResponse||rejectedEM,expectedProvider=finalResponse?'tencent':'eastmoney',raw=Buffer.from(JSON.stringify(expected));
  assert.equal(r.status,'unknown');assert.equal(r.provider,expectedProvider);assert.equal(r.stock.source,expectedProvider);assert.equal(r.provenance.source,expectedProvider);
  assert.deepEqual(Buffer.from(r.rawEvidence.data,'base64'),raw);assert.equal(r.rawHash,crypto.createHash('sha256').update(raw).digest('hex'));assert.equal(r.rawEvidence.sha256,r.rawHash);assert.deepEqual(r.stock.bars,[]);
 }
});
test('source outages are unknown and are never retried',async()=>{
 let calls=0;const r=await fetchPublicStockHistory({symbol:'600000'},{now:()=>NOW,requestJson:async()=>{calls++;throw Error('offline');}});
 assert.equal(calls,2);assert.equal(r.status,'unknown');assert.deepEqual(r.stock.bars,[]);assert.equal(r.errors.length,2);
});
test('actual raw UTF8 bytes determine SHA; conflicting injected json is ignored',async()=>{
 const raw=Buffer.from('  '+JSON.stringify(em())+'\n');
 const r=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>NOW,requestJson:async()=>({raw,json:em([], {code:'600001'})})});
 assert.equal(r.rawHash,crypto.createHash('sha256').update(raw).digest('hex'));assert.equal(r.provenance.rawByteLength,raw.length);assert.equal(r.provenance.hashBasis,'raw-response-bytes');assert.equal(r.stock.bars.length,1);
 const bad=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>NOW,requestJson:async()=>em()});assert.equal(bad.errors[0].code,'missing-raw-bytes');
});
test('selected raw evidence reconstructs exact response bytes and hash including unsupported units',async()=>{
 for(const [symbol,provider,json] of [['600000','eastmoney',em()],['688001','tencent',tx([txRow()],'688001')]]){
  const raw=Buffer.from(' \n'+JSON.stringify(json,null,2)+'\r\n','utf8');
  const r=await fetchPublicStockHistory({symbol,provider},{now:()=>NOW,requestJson:async()=>({raw})});
  assert.equal(r.rawEvidence.encoding,'base64');
  const reconstructed=Buffer.from(r.rawEvidence.data,'base64');
  assert.deepEqual(reconstructed,raw);assert.equal(r.rawEvidence.byteLength,raw.length);
  assert.equal(crypto.createHash('sha256').update(reconstructed).digest('hex'),r.rawEvidence.sha256);
  assert.equal(r.rawEvidence.sha256,r.rawHash);
 }
 const missing=await fetchPublicStockHistory({symbol:'600000'},{now:()=>NOW,requestJson:async()=>{throw Error('offline');}});assert.equal(missing.rawEvidence,undefined);
});
test('response code, mandatory security identity and raw day identity are strict',async()=>{
 for(const json of [em([], {code:'600001'}),em([], {code:undefined}),em([], {market:0}),{...em(),rc:1}])assert.equal((await load(json)).status,'unknown');
 for(const json of [{code:0,data:{sh600000:{qfqday:[txRow()]}}},tx([txRow()],'600001'),{code:0,data:{sh600000:{day:[txRow()],qt:{sh600000:['1','错误','600001']}}}}]){
  const r=await load(json,{provider:'tencent'});assert.equal(r.status,'unknown');assert.deepEqual(r.stock.bars,[]);
 }
});
test('malformed OHLCV, missing fields, impossible ranges and invalid dates reject the response',async()=>{
 for(const row of [emRow().replace(',10,',',,').replace(',11,',',-,') ,'2026-11-11,10,11,12,9',emRow('2026-11-31'),emRow().replace(',12,',',10,'),emRow().replace(',23,',',-1,'),emRow().replace(',10,',',0,'),emRow().replace(',23,',',Infinity,')]){
  const r=await load(em([row]));assert.equal(r.status,'unknown',row);assert.deepEqual(r.stock.bars,[]);
 }
});
test('missing real amount stays absent, actual zero volume and amount are preserved',async()=>{
 const missing=await load(em([emRow().replace(',24680,',',-,')]));assert.equal(missing.stock.bars[0].amount,undefined);
 const zero=await load(em([emRow().replace(',23,24680,',',0,0,')]));assert.equal(zero.stock.bars[0].volume,0);assert.equal(zero.stock.bars[0].amount,0);
});
test('duplicate identical dates are deduplicated; conflicting or descending dates reject',async()=>{
 const r=await load(em([emRow(),emRow(),emRow('2026-11-12')]));assert.equal(r.stock.bars.length,2);assert.equal(r.duplicateCount,1);
 for(const rows of [[emRow(),emRow().replace(',23,',',24,')],[emRow('2026-11-12'),emRow()]])assert.equal((await load(em(rows))).status,'unknown');
});
test('future bars are excluded without changing dates; history length selects trailing actual sessions',async()=>{
 const r=await load(em([emRow('2026-11-10'),emRow(),emRow('2026-11-12'),emRow('2026-11-13')]),{historyDays:2});
 assert.deepEqual(r.stock.bars.map(x=>x.date),['2026-11-11','2026-11-12']);assert.equal(r.futureCount,1);
});
test('same-day bars wait until 15:10 China time; retain unclosed raw rows and receipt time',async()=>{
 for(const [time,expected] of [['2026-11-12T15:09:59+08:00',1],['2026-11-12T15:10:00+08:00',2]]){
  const now=Date.parse(time),r=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>now,requestJson:async()=>bytes(em([emRow(),emRow('2026-11-12')]))});
  assert.equal(r.stock.bars.length,expected);assert.equal(r.unclosedObservations.length,2-expected);
  if(expected===1){assert.equal(r.unclosedObservations[0].rawRow,emRow('2026-11-12'));assert.equal(r.unclosedObservations[0].knownAt,now);}
 }
});
test('an unclosed EM observation survives a failed fallback without entering research bars',async()=>{
 const now=Date.parse('2026-11-12T10:00:00+08:00');let calls=0;
 const r=await fetchPublicStockHistory({symbol:'600000'},{now:()=>now,requestJson:async()=>{if(++calls===2)throw Error('TX offline');return bytes(em([emRow('2026-11-12')]));}});
 assert.equal(calls,2);assert.equal(r.status,'unknown');assert.equal(r.source,'eastmoney');assert.deepEqual(r.stock.bars,[]);assert.equal(r.unclosedObservations[0].receivedAt,now);assert.equal(r.errors.length,2);
});
test('late historical bars are first observed at current receipt time, never at historical close',async()=>{
 const r=await load(em([emRow('2020-01-02')]));assert.equal(r.stock.bars[0].knownAt,NOW);assert.equal(r.provenance.firstObservedAt,NOW);
});
test('old TX endpoint unverified STAR/BSE units remain unsupported, source identity retained',async()=>{
 for(const [symbol,prefix] of [['688001','sh'],['920001','bj']]){
  const r=await fetchPublicStockHistory({symbol,provider:'tencent'},{now:()=>NOW,requestJson:async()=>bytes(tx([txRow()],symbol,prefix))});
  assert.equal(r.status,'unknown');assert.equal(r.errors[0].code,'unsupported-unit');assert.equal(r.source,'tencent');assert.equal(r.units.volume,'unknown');assert.deepEqual(r.stock.bars,[]);assert.equal(r.rawHash.length,64);
 }
});
test('Beijing EM market zero and A-share input validation reject B shares/URLs/CDR/index codes',async()=>{
 let target;
 const r=await fetchPublicStockHistory({symbol:'920001',provider:'eastmoney'},{now:()=>NOW,requestJson:async u=>{target=new URL(u);return bytes(em([emRow()],{code:'920001',market:0}));}});
 assert.equal(target.searchParams.get('secid'),'0.920001');assert.equal(r.stock.bars[0].volume,2300);
 for(const options of [{symbol:'900001'},{symbol:'200001'},{symbol:'689009'},{symbol:'399001'},{symbol:'600000;echo'},{symbol:'https://evil'},{symbol:'600000',historyDays:0},{symbol:'600000',historyDays:501},{symbol:'600000',provider:'url'}])await assert.rejects(()=>fetchPublicStockHistory(options,{now:()=>NOW,requestJson:()=>assert.fail('must not fetch')}));
});
test('transport rejects arbitrary endpoints, adjusted data and bad identity before any network',async()=>{
 for(const url of ['https://example.com/','http://push2his.eastmoney.com/api/qt/stock/kline/get','https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600000,day,,,120,qfq','https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&fqt=1&klt=101'])await assert.rejects(()=>requestPublicStockJson(url));
});
test('oversized/invalid raw bytes and backwards completion clock remain unknown',async()=>{
 for(const raw of [Buffer.alloc(2*1024*1024+1),'{no']){
  const r=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>NOW,requestJson:async()=>({raw})});assert.equal(r.status,'unknown');
 }
 let tick=NOW;const r=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>tick--,requestJson:async()=>bytes(em())});assert.equal(r.errors[0].code,'invalid-clock');
});
