'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fetchPublicStockHistory}=require('../src/core/public-stock-history');
const {readResearchCalendar}=require('../src/core/research-calendar-source');
const now=Date.parse('2026-11-13T16:00:00+08:00');
const day='2026-11-12';
const em=(row=day+',10,11,12,9,23,24680,1,2,3,4')=>({rc:0,data:{code:'600000',market:1,klines:[row]}});
const tx=()=>({code:0,data:{sh600000:{day:[[day,'10','11','12','9','23']]}}});
const raw=j=>Buffer.from(JSON.stringify(j));
const load=(response,options={})=>fetchPublicStockHistory({symbol:'600000',provider:'eastmoney',...options},{now:()=>now,requestJson:async()=>response});
test('HTTP partial success cannot supply daily history',async()=>{const r=await load({status:206,raw:raw(em())});assert.equal(r.status,'unknown');assert.equal(r.errors[0].code,'http-error');assert.equal(r.stock.bars.length,0);assert.ok(r.rawEvidence);});
test('explicit noninteger HTTP status, contradictory ok and hidden redirect fail closed',async()=>{for(const patch of [{status:'200'},{status:200,ok:false},{status:200,redirected:true},{status:200,url:'https://example.org/wrong'}]){const r=await load({raw:raw(em()),...patch});assert.equal(r.status,'unknown');assert.equal(r.stock.bars.length,0);}});
test('invalid declared length or truncated raw document is not accepted',async()=>{const bytes=raw(em());for(const length of ['1e3','1',String(bytes.length+1)]){const r=await load({status:200,raw:bytes,headers:{'Content-Length':length}});assert.equal(r.status,'unknown');assert.equal(r.errors[0].code,'invalid-response-length');assert.ok(r.rawEvidence);}});
test('exact valid response length remains usable',async()=>{const bytes=raw(em());const r=await load({status:200,raw:bytes,headers:{'Content-Length':String(bytes.length)}});assert.equal(r.status,'observed-unverified');assert.equal(r.stock.bars[0].volume,2300);});
test('invalid UTF8 in an otherwise ignored field preserves rejection evidence',async()=>{const text=JSON.stringify({...em(),ignored:'TOKEN'}),parts=text.split('TOKEN'),bytes=Buffer.concat([Buffer.from(parts[0]),Buffer.from([255]),Buffer.from(parts[1])]);const r=await load({status:200,raw:bytes});assert.equal(r.status,'unknown');assert.equal(r.errors[0].code,'invalid-utf8');assert.ok(r.rawEvidence);});
test('decimal lots become exact whole shares, not binary fractions',async()=>{const r=await load({raw:raw(em(day+',10,11,12,9,0.29,100,1,2,3,4'))});assert.equal(r.stock.bars[0].volume,29);});
test('fractional share and unsafe integer refuse the bar',async()=>{for(const v of ['0.001','90071992547409.92']){const r=await load({raw:raw(em(day+',10,11,12,9,'+v+',100,1,2,3,4'))});assert.equal(r.status,'unknown');assert.equal(r.errors[0].code,'invalid-volume');}});
test('real zero remains zero and missing amount remains absent',async()=>{const r=await load({raw:raw(em(day+',10,11,12,9,0,-,1,2,3,4'))});assert.equal(r.stock.bars[0].volume,0);assert.equal(r.stock.bars[0].amount,undefined);});
test('regressing response clock blocks fallback even if a later reading recovers',async()=>{let reads=0,calls=0;const times=[now,now-1,now+1,now+2];const r=await fetchPublicStockHistory({symbol:'600000'},{now:()=>times[Math.min(reads++,3)],requestJson:async()=>{calls++;return {raw:raw(calls===1?em():tx())};}});assert.equal(calls,1);assert.equal(r.status,'unknown');assert.equal(r.clockInvalid,true);assert.equal(r.stock.bars.length,0);});
test('failed attempt without raw response has no fabricated receipt time',async()=>{const r=await fetchPublicStockHistory({symbol:'600000',provider:'eastmoney'},{now:()=>now,requestJson:async()=>{throw Error('offline');}});assert.equal(r.status,'unknown');assert.equal(r.retrievedAt,null);});
function cal(t,patch={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-d16-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'calendar.json'),data={schemaVersion:1,exchange:'SSE',source:'isolated-calendar',from:'2026-11-12',to:'2026-11-13',
  firstObservedAt:'2026-11-12T01:00:00.123456Z',sessions:[{date:day,open:true},{date:'2026-11-13',open:true}],...patch};
 fs.writeFileSync(file,JSON.stringify(data));return file;
}
test('explicit exchange cannot contradict known security prefix',t=>{const file=cal(t);assert.equal(readResearchCalendar({asOf:now,symbol:'SH.000001',calendarFile:file}).status,'unavailable');assert.equal(readResearchCalendar({asOf:now,symbol:'600000.SH',calendarFile:file}).status,'available');});
test('invalid civil timestamp cannot roll over into an accepted calendar receipt',t=>{const file=cal(t,{firstObservedAt:'2026-02-30T01:00:00Z'});assert.equal(readResearchCalendar({asOf:now,calendarFile:file}).status,'unavailable');});
test('timezone-free audit clock is not a historical availability proof',t=>{const file=cal(t);assert.equal(readResearchCalendar({asOf:'2026-11-13',calendarFile:file}).status,'unavailable');assert.equal(readResearchCalendar({asOf:'2026-11-13T16:00:00+08:00',calendarFile:file}).status,'available');});
test('malformed and duplicate calendar source evidence is rejected',t=>{for(const sourceEvidence of [{key:'sse'},[null],[{key:'sse'},{key:'sse'}]]){const file=cal(t,{sourceEvidence});assert.equal(readResearchCalendar({asOf:now,calendarFile:file}).status,'unavailable');}});
test('nested calendar observation time cannot contradict or exceed audit time',t=>{for(const observedAt of ['2026-11-11T01:00:00Z','2026-11-14T01:00:00Z','not-a-time']){const file=cal(t,{metadata:{observedAt}});assert.equal(readResearchCalendar({asOf:now,calendarFile:file}).status,'unavailable');}});
