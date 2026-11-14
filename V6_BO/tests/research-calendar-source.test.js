'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {readResearchCalendar}=require('../src/core/research-calendar-source');
const bundledFile=path.resolve(__dirname,'../config/research-calendar-2026.json');
const data=JSON.parse(fs.readFileSync(bundledFile));
const asOf='2026-11-13T12:00:00+08:00';
function fixture(t,changes={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-calendar-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calendar={schemaVersion:1,exchange:'SSE',source:'explicit-test-fixture',from:'2026-11-12',to:'2026-11-16',
  firstObservedAt:'2026-11-12T01:00:00Z',sessions:[
   {date:'2026-11-12',open:true},{date:'2026-11-13',open:true},
   {date:'2026-11-14',open:false},{date:'2026-11-15',open:false},{date:'2026-11-16',open:true}],...changes};
 const file=path.join(dir,'calendar.json');fs.writeFileSync(file,JSON.stringify(calendar));
 return {dir,file,calendar};
}
test('official facts cover all 365 calendar days, 242 sessions, holidays and makeup weekends',()=>{
 assert.equal(data.sessions.length,365);assert.equal(data.sessions.filter(d=>d.open).length,242);
 const days=new Map(data.sessions.map(d=>[d.date,d.open]));assert.equal(days.size,365);
 for(let ms=Date.parse(data.from);ms<=Date.parse(data.to);ms+=86400000)assert.ok(days.has(new Date(ms).toISOString().slice(0,10)));
 for(const range of data.holidayRanges)for(let ms=Date.parse(range.from);ms<=Date.parse(range.to);ms+=86400000)assert.equal(days.get(new Date(ms).toISOString().slice(0,10)),false);
 for(const d of data.weekendMakeupClosures)assert.equal(days.get(d),false);
 for(const d of ['2026-01-01','2026-01-04','2026-02-23','2026-05-09','2026-10-10','2026-11-14','2026-11-15'])assert.equal(days.get(d),false);
 for(const d of ['2026-01-05','2026-02-24','2026-10-08','2026-11-13','2026-11-16'])assert.equal(days.get(d),true);
});
test('SSE/SZSE explicit calendar retains future sessions and next is strictly after China date',()=>{
 for(const symbol of ['600000','sh.600000','600000.SH','000001','sz000001','300001.SZ']){
  const r=readResearchCalendar({asOf,symbol});assert.equal(r.status,'available',r.reason);
  assert.equal(r.tradeDates.length,242);assert.equal(r.calendar.sessions.length,365);
  assert.equal(r.nextTradeDate,'2026-11-16');
  assert.equal(r.tradeDates.find(d=>d>'2026-11-12'),'2026-11-13');
  assert.ok(r.tradeDates.includes('2026-12-31'));
  assert.equal(r.calendar.exchange,symbol.includes('600000')?'SSE':'SZSE');
  for(const flag of ['sourceAuthenticated','verifiedExternal','tradeEligible','runtimeEligible','realTime'])assert.equal(r.metadata[flag],false);
 }
 assert.equal(readResearchCalendar({asOf:'2026-11-13T16:00:00Z'}).nextTradeDate,'2026-11-16');
});
test('source proof records raw hashes, real observation and separate historical rule periods',()=>{
 const r=readResearchCalendar({asOf});
 assert.equal(r.metadata.sha256,crypto.createHash('sha256').update(fs.readFileSync(bundledFile)).digest('hex'));
 const evidence=new Map(data.sourceEvidence.map(e=>[e.key,e]));
 assert.equal(evidence.get('sse').rawHash,'sha256:ff188c710b8904758c185eb955e9eaa2c9bd7c2061af984d4f1d743f899c12a4');
 assert.equal(evidence.get('szse_canonical').rawHash,'sha256:1656d8708d5faed33c7588538639d96128f39fdface02cfa6eb66d796c40f14e');
 assert.equal(evidence.get('szse_rule2023').rawHash,'sha256:7018114a6e11deb239c2a72e71e49defc6e8841b3e2c093b3bbf809282c67222');
 for(const e of evidence.values()){
  assert.match(e.sourceUrl,/^https:\/\//);assert.match(e.rawHash,/^sha256:[a-f0-9]{64}$/);
  assert.equal(e.httpStatus,200);assert.match(e.firstObservedAt,/^2026-11-12T/);
  if(e.sourcePublicationDate){assert.match(e.sourcePublicationDate,/^\d{4}-\d{2}-\d{2}$/);assert.equal(e.publicationPrecision,'date');}
 }
 for(const exchange of ['SSE','SZSE']){
  const rules=data.ruleBasis.filter(r=>r.exchange===exchange);assert.equal(rules.length,2);
  assert.equal(rules[0].appliesFrom,'2026-01-01');assert.equal(rules[0].appliesTo,'2026-07-05');
  assert.equal(rules[1].appliesFrom,'2026-07-06');assert.equal(rules[1].appliesTo,'2026-12-31');
  for(const rule of rules){assert.match(rule.weekendRule,/每周一至周五/);for(const key of rule.evidenceKeys)assert.ok(evidence.has(key),key);}
 }
});
test('before actual first observation and outside annual coverage are unknown',()=>{
 for(const clock of [Date.parse(data.firstObservedAt)-1,'2026-01-01T12:00:00+08:00','2027-01-01T00:00:00+08:00','2025-12-31T00:00:00Z','bad-clock']){
  const r=readResearchCalendar({asOf:clock});assert.equal(r.status,'unavailable');assert.deepEqual(r.tradeDates,[]);assert.equal(r.nextTradeDate,null);
 }
 assert.equal(readResearchCalendar({asOf:'2026-12-31T12:00:00+08:00'}).nextTradeDate,null);
});
test('BSE is unsupported by bundled evidence; custom explicit BSE calendar can supply coverage',t=>{
 for(const symbol of ['920001','830001','bj.430001','430001.BJ'])assert.match(readResearchCalendar({asOf,symbol}).reason,/BSE/);
 const {file}=fixture(t,{exchange:'BSE',supportedExchanges:['BSE','SSE']});
 const r=readResearchCalendar({asOf,symbol:'920001',calendarFile:file});assert.equal(r.status,'available');assert.equal(r.calendar.exchange,'BSE');
 assert.deepEqual(r.metadata.supportedExchanges,['BSE']);
 assert.equal(readResearchCalendar({asOf,symbol:'600000',calendarFile:file}).status,'unavailable');
 assert.equal(readResearchCalendar({asOf,symbol:'unknown'}).status,'unavailable');
});
test('operator custom files must have explicit full schema and truthful clocks',t=>{
 const f=fixture(t);assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'available');
 for(const change of [
  {sessions:f.calendar.sessions.slice(1)}, {sessions:[...f.calendar.sessions,f.calendar.sessions[0]]},
  {sessions:f.calendar.sessions.map((r,i)=>i? r:{...r,open:'true'})}, {schemaVersion:2},
  {firstObservedAt:'2026-11-14T00:00:00Z'}, {sourcePublicationDate:'2026-11-14'},
  {publishedAt:'2026-11-14T00:00:00Z'}, {sourceEvidence:[{firstObservedAt:'bad'}]},
  {sourceEvidence:[{sourcePublicationDate:'2026-11-14'}]}
 ]){
  fs.writeFileSync(f.file,JSON.stringify({...f.calendar,...change}));
  assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'unavailable',JSON.stringify(change));
 }
 fs.writeFileSync(f.file,'{invalid');assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'unavailable');
});
test('reject public paths, symlink files and ancestors, directories, URLs and oversized files',t=>{
 const {dir,file,calendar}=fixture(t);
 const publicDir=path.join(dir,'public');fs.mkdirSync(publicDir);const exposed=path.join(publicDir,'calendar.json');fs.writeFileSync(exposed,JSON.stringify(calendar));
 const link=path.join(dir,'link.json');fs.symlinkSync(file,link);
 const linkedDir=path.join(dir,'linked');fs.symlinkSync(publicDir,linkedDir);
 const big=path.join(dir,'big.json');fs.writeFileSync(big,' '.repeat(1024*1024+1));
 for(const calendarFile of [exposed,link,path.join(linkedDir,'calendar.json'),big,dir,'https://example.com/calendar.json','file:///tmp/calendar.json']){
  const r=readResearchCalendar({asOf,calendarFile});assert.equal(r.status,'unavailable',calendarFile);assert.deepEqual(r.tradeDates,[]);
 }
});
test('numeric receipt times are accepted, absent receipt never borrows disk mtime, and filesystem errors stay private',t=>{
 const f=fixture(t);const numeric=Date.parse(f.calendar.firstObservedAt);
 const {firstObservedAt,...plain}=f.calendar;
 fs.writeFileSync(f.file,JSON.stringify({...plain,observedAt:numeric}));
 assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'available');
 fs.writeFileSync(f.file,JSON.stringify(plain));assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'unavailable');
 const missing=readResearchCalendar({asOf,calendarFile:path.join(f.dir,'missing.json')});
 assert.equal(missing.status,'unavailable');assert.ok(!JSON.stringify(missing).includes(f.dir));
 fs.writeFileSync(f.file,JSON.stringify({...f.calendar,observedAt:Date.parse(asOf)+1}));assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'unavailable');
});

test('calendar cannot claim its source was observed before that source was published',t=>{
 const f=fixture(t);
 const bad=[
  {sourcePublishedAt:'2026-11-12T01:00:01Z'},
  {sourcePublicationDate:'2026-11-13'},
  {sourceEvidence:[{firstObservedAt:'2026-11-12T02:00:00Z',
   sourcePublishedAt:'2026-11-12T02:00:01Z'}]},
  {sourceEvidence:[{firstObservedAt:'2026-11-12T02:00:00Z',
   sourcePublicationDate:'2026-11-12'}]},
  {sourceEvidence:[{firstObservedAt:'2026-11-12T00:30:00Z',
   observedAt:'2026-11-12T02:00:00Z'}]},
  {observedAt:'2026-11-12T00:59:00Z'},
  {firstObservedAt:'2026-11-12T01:00:00Z',
   observedAt:'2026-11-12T00:59:00Z'}
 ];
 for(const patch of bad){
  fs.writeFileSync(f.file,JSON.stringify({...f.calendar,...patch}));
  const result=readResearchCalendar({asOf,calendarFile:f.file});
  assert.equal(result.status,'unavailable',JSON.stringify(patch));
  assert.deepEqual(result.tradeDates,[]);
  assert.equal(result.nextTradeDate,null);
 }
});
test('a historical calendar is usable when publication precedes recorded observation',t=>{
 const f=fixture(t,{
  sourcePublishedAt:'2026-11-12T00:59:59Z',
  sourcePublicationDate:'2026-11-12',
  sourceEvidence:[{firstObservedAt:'2026-11-12T00:59:59Z',
   sourcePublishedAt:'2026-11-12T00:59:58Z'}]
 });
 const result=readResearchCalendar({asOf,calendarFile:f.file});
 assert.equal(result.status,'available',result.reason);
 assert.equal(result.metadata.sourceAuthenticated,false);
 assert.equal(result.metadata.knowledgeAvailableAt,new Date(f.calendar.firstObservedAt).toISOString());
 assert.equal(result.metadata.tradeEligible,false);
});

test('explicit +08:00 publication instants preserve causal ordering just like UTC Z',t=>{
 const f=fixture(t,{sourcePublishedAt:'2026-11-12T08:59:59+08:00'});
 assert.equal(readResearchCalendar({asOf,calendarFile:f.file}).status,'available');
 fs.writeFileSync(f.file,JSON.stringify({...f.calendar,
  sourcePublishedAt:'2026-11-12T09:00:01+08:00'}));
 const blocked=readResearchCalendar({asOf,calendarFile:f.file});
 assert.equal(blocked.status,'unavailable');
});
