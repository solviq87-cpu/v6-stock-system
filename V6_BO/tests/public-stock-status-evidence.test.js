'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {fetchPublicStockStatusEvidence,requestPublicStockStatusRaw}=require('../src/core/public-stock-status-evidence');
const NOW=Date.parse('2026-11-12T16:00:00+08:00');
const dividend={SECURITY_CODE:'600000',SECUCODE:'600000.SH',SECURITY_NAME_ABBR:'样本',REPORT_DATE:'2025-12-31 00:00:00',PLAN_NOTICE_DATE:'2026-03-31 00:00:00',EQUITY_RECORD_DATE:'2026-07-15 00:00:00',EX_DIVIDEND_DATE:'2026-07-16 00:00:00',NOTICE_DATE:'2026-07-10 00:00:00',PUBLISH_DATE:'2026-03-31 00:00:00',PRETAX_BONUS_RMB:4.2,IMPL_PLAN_PROFILE:'样本分红方案',ASSIGN_PROGRESS:'实施分配'};
const suspension={SECURITY_CODE:'600000',SECUCODE:'600000.SH',SUSPEND_START_TIME:'2026-11-13 09:30:00',SUSPEND_END_TIME:'2026-11-19 15:00:00',SUSPEND_START_DATE:'2026-11-13 00:00:00',PREDICT_RESUME_DATE:'2026-11-20 00:00:00',SUSPEND_REASON:'公告计划',SUSPEND_EXPIRE:'连续停牌'};
const page=(data,count=data.length,pages=1)=>({success:true,result:{data,count,pages}});
const raw=json=>({raw:Buffer.from(JSON.stringify(json))});
function quote({code='600000',timestamp='20261112092000',up='12',down='8'}={}){const f=Array(49).fill('');f[2]=code;f[4]='10';f[30]=timestamp;f[47]=up;f[48]=down;return `v_sh600000="${f.join('~')}";`;}
function request(overrides={}){return async target=>{const u=new URL(target);if(u.hostname==='qt.gtimg.cn')return {raw:overrides.quote??quote()};const kind=u.searchParams.get('reportName')==='RPT_SHAREBONUS_DET'?'dividend':'suspension';return raw(overrides[kind]??page([kind==='dividend'?dividend:suspension]));};}
const collect=(overrides={},now=NOW)=>fetchPublicStockStatusEvidence({symbol:'600000',date:'2026-11-12'},{now:()=>now,requestJson:request(overrides)});
test('actual report field shapes retain source dates, date-only publication precision and actual receipt knowledge',async()=>{
 const r=await collect();assert.equal(r.requestCount,3);assert.equal(r.source,'public-stock-status-evidence');assert.equal(r.canTrade,false);
 const d=r.dividendEvents.records[0];assert.equal(d.exDividendDate,'2026-07-16');assert.equal(d.planNoticeDate,'2026-03-31');assert.equal(d.vendorDates.NOTICE_DATE.precision,'date');assert.equal(d.vendorDates.NOTICE_DATE.publicationInstant,null);assert.equal(d.knownAt,NOW);assert.equal(d.pretaxBonusRmb,4.2);
 const s=r.suspensionAnnouncements.records[0];assert.equal(s.suspendStartDate,'2026-11-13');assert.equal(s.suspendStartTime,'2026-11-13 09:30:00');assert.equal(s.predictResumeDate,'2026-11-20');assert.equal(s.announcementTime,null);
 for(const group of [r.dividendEvents,r.suspensionAnnouncements]){assert.equal(group.absenceClaim,null);assert.equal(group.coverage.complete,true);for(const row of group.records)for(const k of ['tradable','isST','corporateAction','suspended'])assert.equal(row[k],undefined);}
});
test('precise raw bytes, including whitespace, are reconstructable and hash without reserialization',async()=>{
 const bytes=Buffer.from(' \n'+JSON.stringify(page([dividend]),null,2)+'\r\n');const delegate=request();
 const r=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async target=>target.includes('RPT_SHAREBONUS_DET')?{raw:bytes,json:{bad:true}}:delegate(target)});
 const e=r.rawEvidence.find(e=>e.source==='eastmoney:dividendEvents');assert.deepEqual(Buffer.from(e.data,'base64'),bytes);assert.equal(e.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(e.byteLength,bytes.length);assert.equal(e.receivedAt,NOW);assert.ok(e.url.startsWith('https://datacenter-web.eastmoney.com/'));
});
test('valid empty reports and unrelated suspension announcements never imply a normal trading state',async()=>{
 const r=await collect({dividend:page([],0,0),suspension:page([{...suspension,SECURITY_CODE:'000635',SECUCODE:'000635.SZ'}])});
 assert.equal(r.dividendEvents.coverage.complete,true);assert.deepEqual(r.dividendEvents.records,[]);assert.equal(r.dividendEvents.absenceClaim,null);assert.equal(r.suspensionAnnouncements.coverage.fetchedCount,1);assert.deepEqual(r.suspensionAnnouncements.records,[]);assert.equal(r.suspensionAnnouncements.absenceClaim,null);
});
test('all pages must have stable totals and unique records to claim complete coverage',async()=>{
 const delegate=request();
 const r=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async target=>{
  const u=new URL(target);if(!target.includes('RPT_SHAREBONUS_DET'))return delegate(target);
  return raw(page([{...dividend,EX_DIVIDEND_DATE:u.searchParams.get('pageNumber')==='1'?'2026-07-16 00:00:00':'2026-08-16 00:00:00'}],2,2));
 }});
 assert.equal(r.dividendEvents.coverage.complete,true);assert.equal(r.dividendEvents.coverage.fetchedPages,2);assert.equal(r.dividendEvents.records.length,2);
 for(const second of [page([dividend],3,2),page([dividend],2,2)]){
  const rejected=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async target=>target.includes('RPT_SHAREBONUS_DET')?raw(new URL(target).searchParams.get('pageNumber')==='1'?page([dividend],2,2):second):delegate(target)});
  assert.equal(rejected.dividendEvents.status,'partial');assert.equal(rejected.dividendEvents.coverage.complete,false);assert.ok(rejected.errors.some(e=>e.code==='unstable-pagination'));
 }
});
test('request scheduling stays within two concurrent calls and eight requests, no retries',async()=>{
 let active=0,maxActive=0,calls=0;
 const r=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async(target,options)=>{
  calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));active--;
  assert.equal(options.maxBytes,2*1024*1024);assert.ok(options.timeoutMs<=12000);assert.ok(options.processTimeoutMs<=13000);
  if(target.includes('RPT_SHAREBONUS_DET')){const p=Number(new URL(target).searchParams.get('pageNumber'));return raw(page([{...dividend,EX_DIVIDEND_DATE:`2026-07-${String(p).padStart(2,'0')} 00:00:00`}],8,8));}
  return request({suspension:page([])})(target);
 }});
 assert.equal(calls,8);assert.equal(r.requestCount,8);assert.ok(maxActive<=2);assert.equal(r.dividendEvents.status,'partial');assert.equal(r.dividendEvents.coverage.complete,false);assert.ok(r.errors.some(e=>e.code==='request-budget'));assert.equal(r.bounds.totalTimeoutMs,35000);
});
test('same-day quote first received before 09:30 qualifies only as preopen observed vendor evidence',async()=>{
 for(const [clock,expected] of [['2026-11-12T09:29:59+08:00',true],['2026-11-12T09:30:00+08:00',false],['2026-11-13T08:00:00+08:00',false]]){
  const now=Date.parse(clock),r=await collect({},now),p=r.priceLimits;
  assert.equal(p.preopenObserved,expected);assert.equal(p.tradeDate,'2026-11-12');assert.equal(p.limitKnownAt,now);assert.equal(p.limitUpPrice,12);assert.equal(p.limitDownPrice,8);assert.equal(p.quoteAt,Date.parse('2026-11-12T09:20:00+08:00'));
 }
});
test('old quote dates are retained and can never become requested-date preopen limits',async()=>{
 const r=await collect({quote:quote({timestamp:'20261111092000'})},Date.parse('2026-11-12T09:25:00+08:00'));
 assert.equal(r.priceLimits.status,'dated-snapshot');assert.equal(r.priceLimits.tradeDate,'2026-11-11');assert.equal(r.priceLimits.preopenObserved,false);
});
test('quote identity, timestamp and missing actual limit prices fail closed without evaluating text',async()=>{
 for(const q of [quote({code:'600001'}),quote({timestamp:'20261131092000'}),quote({timestamp:'20261113092000'}),quote({up:'-'}),quote({down:'0'}),quote()+'\nglobalThis.bad=true;']){
  const r=await collect({quote:q});assert.equal(r.priceLimits.status,'unknown');assert.equal(r.priceLimits.preopenObserved,false);assert.equal(r.priceLimits.limitUpPrice,null);assert.ok(r.rawEvidence.some(e=>e.source==='tencent:priceLimits'));
 }
});
test('source errors do not block independent evidence and absent fields remain null',async()=>{
 const delegate=request();
 const r=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async target=>{if(target.includes('RPT_SHAREBONUS_DET'))throw Error('HTTP 503');return delegate(target);}});
 assert.equal(r.requestCount,3);assert.equal(r.dividendEvents.status,'unknown');assert.equal(r.suspensionAnnouncements.status,'observed-unverified');assert.equal(r.errors.length,1);assert.equal(r.rawEvidence.length,2);
 const missing=await collect({dividend:page([{SECURITY_CODE:'600000'}])});assert.equal(missing.dividendEvents.records[0].exDividendDate,null);assert.equal(missing.dividendEvents.absenceClaim,null);
});
test('invalid report identities, dates and undeclared coverage cannot produce complete evidence',async()=>{
 for(const d of [page([{...dividend,SECURITY_CODE:'600001'}]),page([{...dividend,SECUCODE:'600001.SH'}]),page([{...dividend,EX_DIVIDEND_DATE:'2026-02-31 00:00:00'}]),{success:true,result:{data:[dividend]}},{success:false,result:{data:[dividend],count:1,pages:1}}]){
  const r=await collect({dividend:d});assert.equal(r.dividendEvents.coverage.complete,false);assert.ok(r.errors.some(e=>e.source==='dividendEvents'));assert.ok(r.rawEvidence.some(e=>e.source==='eastmoney:dividendEvents'));
 }
});
test('input and transport URL allowlists reject arbitrary targets and parameter injection before network',async()=>{
 for(const options of [{symbol:'600000;echo'},{symbol:'200001'},{symbol:'689009'},{symbol:'600000',date:'2026-11-31'},{symbol:'600000',date:'2026-11-13'}])await assert.rejects(()=>fetchPublicStockStatusEvidence(options,{now:()=>NOW,requestJson:()=>assert.fail('no fetch')}));
 for(const url of ['http://qt.gtimg.cn/q=sh600000','https://qt.gtimg.cn/q=sh600000,sz000001','https://qt.gtimg.cn/q=sh600000?callback=evil','https://example.com/','https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=OTHER'])await assert.rejects(()=>requestPublicStockStatusRaw(url));
});
test('oversized and missing raw bytes are rejected; malformed JSON keeps exact raw evidence for auditing',async()=>{
 for(const response of [{json:page([dividend])},{raw:Buffer.alloc(2*1024*1024+1)},{raw:'not json'}]){
  const delegate=request(),r=await fetchPublicStockStatusEvidence({symbol:'600000'},{now:()=>NOW,requestJson:async target=>target.includes('RPT_SHAREBONUS_DET')?response:delegate(target)});
  assert.equal(r.dividendEvents.status,'unknown');assert.ok(r.errors.length);assert.equal(r.rawEvidence.filter(e=>e.source==='eastmoney:dividendEvents').length,response.raw==='not json'?1:0);
 }
});
