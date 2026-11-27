'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const review=require('../src/core/limit-review-pool'),clsModule=require('../src/core/cls-limit-up-pool'),reason=require('../src/core/limit-reason-evidence');
const day='2026-11-27',now=Date.parse(day+'T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const src=fs.readFileSync(path.join(__dirname,'../external_data.js'),'utf8');
function external(request=async()=>{throw Error('fixture network disabled');}){
 const load=new Function('require','module','__dirname','Date',src+'\nreturn {parseCommod,pickFlow,normalizeFinancialPage,httpsGet,fetchNorth,fetchSouth,fetchAll,fetchMargin};');
 return load(n=>n==='./src/core/research-curl-bytes'?{requestResearchBytes:request}:require(n),{exports:{}},path.resolve(__dirname,'..'),Clock);
}
const commodity=(code,p,delta,prev)=>'v_'+code+'="'+p+','+delta+',0,'+prev+',sample";';
const clsInput=(plate=[{secu_code:'a',secu_name:'theme'}])=>({code:200,data:[{secu_code:'sh600000',secu_name:'sample',num_stocks:1,time:day+' 09:30:00',plate}]});
const item=(code='600000',p={})=>({code,src:'cls',tradeDate:day,sourceTradeDate:day,receivedAt:now,...p});
const pool=(items=[item()],p={})=>({status:'available',complete:true,source:'cls',tradeDate:day,totalCount:items.length,fetchedCount:items.length,uniqueCount:items.length,items,...p});
const em=(code='600001',p={})=>({code,src:'em',tradeDate:day,sourceTradeDate:day,receivedAt:now,...p});
const merge=(cls,rows=[],meta={totalCount:rows.length},extra={})=>review.mergeLimitReviewPools({tradeDate:day,cls,eastmoneyRows:rows,eastmoneyMeta:meta,...extra});
const flow={dayNetAmtIn:0,monthNetAmtIn:'-12.5',date2:'20261127'};
const fin=(p={})=>({SECURITY_CODE:'600000',TRADE_MARKET:'沪',REPORTDATE:'2026-09-30',SJLTZ:0,UPDATE_DATE:day,...p});
const financial=rows=>({success:true,result:{data:rows}});
const wire=(value,status=200,headers={})=>({status,headers,raw:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
test('D24 reference-close percentage uses the correct denominator and cannot certify live trade',()=>{
 const x=external().parseCommod(commodity('hf_GC','110','10','100'),now).hf_GC;
 assert.equal(x.pct,10);assert.equal(x.quoteAt,null);assert.equal(x.receivedAt,now);assert.equal(x.decisionEligible,false);assert.equal(x.canTrade,false);
});
test('D24 unknown or contradictory reference fields cannot manufacture a return',()=>{
 const p=external().parseCommod;
 for(const row of [commodity('hf_GC','110','10',''),commodity('hf_GC','110','2','100'),commodity('hf_GC','110','bad','100')])assert.equal(p(row,now).hf_GC.pct,null);
});
test('D24 malformed, unknown and duplicate commodity instruments are refused',()=>{
 const p=external().parseCommod;
 assert.equal(p(commodity('hf_GC','110junk','10','100'),now).hf_GC,undefined);
 assert.equal(p(commodity('hf_XXX','110','10','100'),now).hf_XXX,undefined);
 assert.equal(p(commodity('hf_GC','110','10','100')+commodity('hf_GC','111','11','100'),now).hf_GC,undefined);
});
test('D24 known zero return and negative oil remain actual read-only observations',()=>{
 const r=external().parseCommod(commodity('hf_SI','100','0','100')+commodity('hf_CL','-37','-57','20'),now);
 assert.equal(r.hf_SI.pct,0);assert.equal(r.hf_CL.price,-37);assert.equal(r.hf_CL.pct,-285);assert.equal(r.hf_CL.canTrade,false);
});
test('D18 sparse or duplicate plate identity cannot certify a provider pool',()=>{
 for(const plates of [Array(1),[{secu_code:'a',secu_name:'x'},{secu_code:'a',secu_name:'y'}]]){
  const r=clsModule.normalizeClsLimitPool(clsInput(plates),{requestedDate:day,receivedAt:now});
  assert.equal(r.complete,false);assert.equal(r.errors[0].code,'cls-plate-invalid');
 }
 const ok=clsModule.normalizeClsLimitPool(clsInput(),{requestedDate:day,receivedAt:now});assert.equal(ok.complete,true);
});
test('D18 downstream refuses duplicate, empty, spoofed and inconsistent CLS completeness claims',()=>{
 for(const c of [pool([item(),item()]),pool([]),pool([item()],{totalCount:2}),pool([item()],{fetchedCount:2}),pool([item()],{uniqueCount:2}),pool([item('600000',{source:'eastmoney'})]),pool([item(600000)]),pool(Array(1))]){
  const r=merge(c);assert.equal(r.rows.length,0);assert.equal(r.meta.sources[1].providerComplete,false);assert.equal(r.meta.sources[1].status,'invalid');
 }
});
test('D18 EM rejects numeric codes and quarantines duplicate security without losing the valid peer',()=>{
 let r=merge(null,[em(600001)]);assert.equal(r.rows.length,0);assert.equal(r.meta.sources[0].providerComplete,false);
 r=merge(null,[em('600001',{price:10}),em('600001',{price:11}),em('600002')]);
 assert.deepEqual(r.rows.map(x=>x.code),['600002']);assert.equal(r.meta.sources[0].duplicateCount,1);assert.equal(r.meta.sources[0].providerComplete,false);
});
test('D18 source partial flag and malformed empty response cannot be recertified by the consumer',()=>{
 assert.equal(merge(null,[em()],{totalCount:1,providerComplete:false}).meta.sources[0].providerComplete,false);
 assert.equal(review.auditLimitPoolRows(null,{totalCount:0}).providerComplete,false);
 assert.equal(merge(null,null,{totalCount:0}).meta.sources[0].providerComplete,false);
});
test('D18 valid two-source union, held old CLS and partial EM behavior are preserved',()=>{
 const first=merge(pool(),[em()]);
 assert.equal(first.rows.length,2);assert.ok(first.meta.sources.every(s=>s.providerComplete));assert.ok(first.rows.every(x=>x.canTrade===false));
 const held=merge(pool([item()],{uniqueCount:2}),[em()],{totalCount:1},{previousRows:first.rows,previousMeta:first.meta});
 const r=held.rows.find(x=>x.code==='600000');assert.equal(r.heldRecord,true);assert.equal(r.currentSourceConfirmed,false);assert.equal(r.receivedAt,now);assert.equal(held.meta.sources[1].lastAttempt.status,'invalid');
 const partial=merge(pool(),[em('600001'),em('600002')],{totalCount:3});
 assert.equal(partial.rows.length,3);assert.equal(partial.meta.partial,true);assert.equal(partial.meta.sources[0].providerComplete,false);
});
test('D25 date identity does not accept coercible objects or arrays',()=>{
 assert.equal(reason.normalizeDay([day]),null);assert.equal(reason.normalizeDay({toString:()=>day}),null);
 assert.equal(reason.normalizeDay(20261127),day);assert.equal(reason.normalizeDay(day),day);
});
test('D17 connect flow keeps genuine zero, negative, missing and exact original date apart',()=>{
 const x=external().pickFlow(flow,now,'hk2sh');
 assert.equal(x.dayNet,0);assert.equal(x.monthNet,-12.5);assert.equal(x.yearNet,null);assert.equal(x.date,day);assert.equal(x.quoteAt,null);assert.equal(x.canTrade,false);
 assert.equal(external().pickFlow({date2:day,dayNetAmtIn:'-'},now,'hk2sh'),null);
});
test('D17 future or ambiguous source date stays unknown; no local-day substitution',()=>{
 for(const d of ['2026-11-28','11-27','20260230']){
  const x=external().pickFlow({...flow,date2:d},now,'sh2hk-only');
  assert.equal(x.date,null);assert.equal(x.providerDateRaw,d);assert.equal(x.decisionEligible,false);
 }
});
test('D21 future periods, malformed percentages and future update labels cannot alter the report summary',()=>{
 const r=external().normalizeFinancialPage(financial([fin({SJLTZ:'12bad',UPDATE_DATE:'2026-11-28'}),fin({SECURITY_CODE:'600001',REPORTDATE:'2026-12-31',SJLTZ:100})]),now);
 assert.equal(r.total,1);assert.equal(r.knownGrowthCount,0);assert.equal(r.updated,null);assert.equal(r.updatedSrc,'2026-11-28');assert.equal(r.highGrow,0);
});
test('D21 contradictory revisions cannot choose an arbitrary same-security row; genuine zero remains',()=>{
 const r=external().normalizeFinancialPage(financial([fin(),fin({SJLTZ:99}),fin({SECURITY_CODE:'600001'})]),now);
 assert.equal(r.total,1);assert.equal(r.conflictingSecurityCount,1);assert.equal(r.knownGrowthCount,1);assert.equal(r.top[0].sjltz,0);
});
test('D21 correct report still reaches original display contract with no real-time certification',()=>{
 const r=external().normalizeFinancialPage(financial([fin({SJLTZ:'75'})]),now);
 assert.equal(r.highGrow,1);assert.equal(r.updated,day);assert.equal(r.reportSeason,'2026-09-30');assert.equal(r.decisionEligible,false);
});
test('D40 external display transport rejects non-200, empty, oversized, and truncated bodies',async()=>{
 for(const w of [wire('{}',206),wire('{}',302),wire('{}',503),wire(''),wire('x'.repeat(2*1024*1024+1)),wire('{}',200,{'content-length':'3'})]){
  await assert.rejects(external(async()=>w).httpsGet('https://push2.eastmoney.com/api/qt/kamt/get'));
 }
 const w=wire('{}',200,{'content-length':'2'}),calls=[];
 assert.equal(await external(async(url,options)=>{calls.push(options);return w;}).httpsGet('https://push2.eastmoney.com/api/qt/kamt/get'),'{}');
 assert.equal(calls.length,1);assert.equal(calls[0].maxBytes,2*1024*1024);assert.equal(calls[0].timeoutMs,12000);
});
test('D09/D17 connect north and south use one original response in the actual fetchAll chain',async()=>{
 const calls=[],e=external(async url=>{
  calls.push(url);
  if(url.includes('/kamt/get'))return wire({data:{hk2sh:flow,hk2sz:flow,sh2hk:flow}});
  if(url.includes('hf_GC'))return wire(commodity('hf_GC','110','10','100'));
  if(url.includes('RPT_RZRQ_TOTALNEW'))return wire({success:true,result:{data:[{DATE:day,RZYE:1}]}});
  if(url.includes('RPT_LICO_FN_CPD'))return wire(financial([fin()]));
  throw Error('unexpected supplier request');
 });
 const snap=await e.fetchAll();
 assert.equal(calls.filter(x=>x.includes('/kamt/get')).length,1);
 assert.equal(calls.length,4);assert.equal(snap.ok.north,true);assert.equal(snap.ok.south,true);assert.equal(snap.ok.commodities,true);
 assert.equal(snap.ok.margin,true);assert.equal(snap.ok.financials,true);assert.equal(snap.items.north.receivedAt,snap.items.south.receivedAt);
});
test('D17 shared connect failure is reported independently without a duplicate physical request',async()=>{
 let calls=0;const e=external(async url=>{if(url.includes('/kamt/get'))calls++;throw Error('unavailable');});
 const snap=await e.fetchAll();assert.equal(calls,1);assert.ok(snap.fail.north);assert.ok(snap.fail.south);
});
test('D08/D39 margin restriction never falls through to the alternate same-supplier report',async()=>{
 let calls=0;const e=external(async()=>{calls++;throw Object.assign(Error('restricted'),{code:'MARKET_RESTRICTED'});});
 await assert.rejects(e.fetchMargin(),/restricted/);assert.equal(calls,1);
});
