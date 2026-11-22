'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline=process.env.V6_REVIEW_POOL_BASELINE_REF;
const read=file=>baseline?execFileSync('git',['show',baseline+':V6_BO/'+file],{cwd:path.dirname(root),encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(path.join(root,file),'utf8');
const em=read('em.js'),server=read('server.js'),now=Date.parse('2026-11-15T10:00:00+08:00');
class Clock extends Date{static now(){return now;}}
function fn(source,name){const a=source.indexOf('function '+name+'(');return source.slice(source.slice(a-6,a)==='async '?a-6:a,source.indexOf('\n}',a)+2);}
async function fetchPool(tc,pool){const c=vm.createContext({Date:Clock,EMX:'https://push2ex.eastmoney.com',get:async()=>({data:{qdate:20261113,tc,pool}}),curlGet(){throw Error('unexpected fallback');},fetchZTPoolThs:async()=>[],_srcWarn(){},require:require('node:module').createRequire(path.join(root,'em.js'))});vm.runInContext(fn(em,'fetchZTPool'),c);return c.fetchZTPool('20261113');}
const raw=(code='600000')=>({c:code,n:'样本',p:10000,zdp:10});
test('provider completeness requires tc equality and unique valid records, never requested page size',async()=>{
 for(const [tc,records,complete,duplicates,invalid]of [[2,[raw(),raw('600001')],true,0,0],[3,[raw(),raw('600001')],false,0,0],[2,[raw(),raw()],false,1,0],[1,[raw('invalid')],false,0,1],[undefined,[raw()],false,0,0]]){
  const rows=await fetchPool(tc,records),meta=rows.poolMeta;assert.ok(meta);assert.equal(meta.providerComplete,complete);assert.equal(meta.fetchedCount,records.length);assert.equal(meta.duplicateCount,duplicates);assert.equal(meta.invalidCount,invalid);assert.equal(meta.completenessScope,'provider-response-only');
 }
});
test('full API state builds an uncropped read-only review pool and its provenance together',()=>{
 const route=server.slice(server.indexOf("if (p === '/api/state')"),server.indexOf("if (p === '/api/reference-indexes')"));
 assert.match(route,/sharedMarketRead\('state',isEditorReq\(req,''\)\)/,
  'real state route must call the shared authenticated state builder');
 assert.match(fn(server,'sharedMarketRead'),/marketCardState\(kind,kind==='state'\?buildDashboardState\(edit\):buildMobileDigest\(edit\)\)/);
 const builder=server.slice(server.indexOf('function buildDashboardState('),server.indexOf('// ──',server.indexOf('function buildDashboardState(')+32));
 assert.match(builder,/ztReviewPool:\s*D\.ztReviewPool\s*\|\|\s*\[\]/,
  'state returns the saved full source pool, not its strategy subset');
 assert.match(builder,/ztReviewPoolMeta:\s*D\.ztReviewPoolMeta\s*\|\|\s*null/,
  'count/date/source metadata must accompany the rows');
 assert.doesNotMatch(builder,/ztReviewPool:\s*D\.ztReviewPool\.slice/,
  'do not shrink supplier coverage to make the UI look complete');
});

const {buildLimitReviewPool,mergeLimitReviewPools,selectLimitReviewDisplay}=require('../src/core/limit-review-pool');
const analysis=require('../analysis');
const policies={isStrategyExcluded:row=>!analysis.countsInZtTally(row.name),isRecommendationExcluded:row=>analysis.isJunkName(row.name)};
function sources(){
 const emRows=Array.from({length:37},(_,i)=>({code:String(600000+i),name:'样本'+i,price:10,pct:10,src:'em',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',receivedAt:now,sector:'源行业'}));
 const cls={status:'available',complete:true,tradeDate:'2026-11-13',source:'cls',totalCount:38,fetchedCount:38,uniqueCount:38,scope:'provider-up-pool-including-st',
 items:Array.from({length:38},(_,i)=>({code:String(600000+i),name:i===37?'*ST样本':'样本'+i,isST:i===37,price:11,pct:null,src:'cls',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',receivedAt:now,
  sourceEventAt:now-86400000*2,rawEventTime:'2026-11-13 10:00:00',quoteAt:null,sector:'甲板块',sectorTags:[{name:'甲板块'},{name:'乙板块'}],plates:[{code:'p1',name:'甲板块'},{code:'p2',name:'乙板块'}],
  reason:'源原因'+i,reasonTradeDate:'2026-11-13',reasonSource:'cls',reasonDateStatus:'matched'}))};
 return {eastmoneyRows:emRows,eastmoneyMeta:{totalCount:37,receivedAt:now},cls,tradeDate:'2026-11-13',...policies};
}
test('readonly full pool retains delisting/ST rows with exclusion flags while strategy inputs stay untouched',()=>{
 const input=[{code:'600000',name:'退市样本',src:'em',tradeDate:'2026-11-13',canTrade:true},{code:'600001',name:'*ST样本',src:'em',tradeDate:'2026-11-13',canTrade:true}];
 const before=structuredClone(input),full=buildLimitReviewPool(input,{tradeDate:'2026-11-13',providerMeta:{totalCount:2},...policies});
 assert.equal(full.rows.length,2);assert.equal(full.rows[0].strategyExcluded,true);assert.equal(full.rows[1].recommendationExcluded,true);assert.equal(full.rows[1].strategyExcluded,false);
 assert.equal(full.rows[0].canTrade,false);assert.equal(full.rows[0].canNotify,false);assert.deepEqual(input,before);
});
test('37 EM and 38 CLS source records form a 38-stock readonly union with ST and all source reasons',()=>{
 const input=sources(),before=structuredClone(input.eastmoneyRows),full=mergeLimitReviewPools(input);
 assert.equal(full.rows.length,38);assert.equal(full.meta.sources[0].totalCount,37);assert.equal(full.meta.sources[1].totalCount,38);
 assert.equal(full.meta.intersectionCount,37);assert.equal(full.meta.eastmoneyOnlyCount,0);assert.equal(full.meta.clsOnlyCount,1);assert.equal(full.meta.missingReasonCount,0);assert.equal(full.meta.totalCount,null);assert.equal(full.meta.wholeMarketCertified,false);
 assert.equal(full.rows[37].isST,true);assert.equal(full.rows[37].recommendationExcluded,true);assert.deepEqual(full.rows[0].sectorTags,['源行业','甲板块','乙板块']);
 assert.equal(full.rows[0].price,10);assert.equal(full.rows[0].clsObservation.price,11);assert.equal(full.rows[0].quoteAt,undefined);assert.equal(full.rows[37].quoteAt,null);assert.equal(full.rows[0].reasonSource,'cls');assert.deepEqual(input.eastmoneyRows,before);
});
test('different source dates never mix rows; unavailable source keeps previous same-day contribution',()=>{
 const input=sources(),first=mergeLimitReviewPools(input);
 const cls={...input.cls,status:'date-mismatch',tradeDate:'2026-11-12'};
 const fresh=mergeLimitReviewPools({...input,cls});assert.equal(fresh.rows.length,37);assert.equal(fresh.meta.sources[1].tradeDate,'2026-11-12');assert.equal(fresh.meta.partial,true);
 const held=mergeLimitReviewPools({...input,cls,previousRows:first.rows,previousMeta:first.meta});assert.equal(held.rows.length,38);assert.equal(held.meta.sources[1].status,'retained');assert.equal(held.meta.sources[1].tradeDate,'2026-11-13');assert.equal(held.meta.sources[1].lastAttempt.tradeDate,'2026-11-12');
});
test('complete CLS-only evidence remains usable for review while all-source failure retains prior pool date',()=>{
 const input=sources(),first=mergeLimitReviewPools({...input,eastmoneyRows:[],eastmoneyMeta:null});assert.equal(first.rows.length,38);assert.equal(first.meta.source,'cls');assert.equal(first.meta.partial,true);
 const held=mergeLimitReviewPools({tradeDate:'2026-11-16',cls:{status:'unavailable'},previousRows:first.rows,previousMeta:first.meta});assert.equal(held.rows.length,first.rows.length);assert.equal(held.rows[0].receivedAt,first.rows[0].receivedAt);assert.equal(held.meta.tradeDate,'2026-11-13');assert.equal(held.meta.lastAttempt.requestedDate,'2026-11-16');
});
test('invalid requested trade day never accepts undated EM or CLS records as confirmed',()=>{
 const emRows=[{code:'600111',name:'日期未知',src:'em',tradeDate:null,sourceTradeDate:null,receivedAt:now}];
 const cls={status:'available',complete:true,tradeDate:null,totalCount:1,fetchedCount:1,uniqueCount:1,
  items:[{code:'600112',name:'日期未知',src:'cls',tradeDate:null,sourceTradeDate:null,receivedAt:now}]};
 for(const tradeDate of [null,undefined,'2026-02-30']){
  const result=mergeLimitReviewPools({eastmoneyRows:emRows,eastmoneyMeta:{totalCount:1,receivedAt:now},cls,tradeDate});
  assert.deepEqual(result.rows,[]);
  assert.equal(result.meta.tradeDate,null);
  assert.equal(result.meta.providerComplete,false);
  assert.equal(result.meta.status,'unavailable');
  assert.ok(result.meta.sources.every(source=>source.status!=='available'));
 }
 const previous=mergeLimitReviewPools(sources());
 const retained=mergeLimitReviewPools({tradeDate:null,eastmoneyRows:emRows,eastmoneyMeta:{totalCount:1},
  cls,previousRows:previous.rows,previousMeta:previous.meta});
 assert.equal(retained.meta.status,'retained');
 assert.equal(retained.meta.tradeDate,'2026-11-13');
 assert.ok(retained.rows.every(row=>row.heldRecord===true&&row.currentSourceConfirmed===false&&
  row.canTrade===false&&row.canNotify===false));
});

test('readonly display carries its own actual day without relabeling the frozen strategy snapshot',()=>{
 const first=mergeLimitReviewPools(sources()),current={ztReviewPool:first.rows,ztReviewPoolMeta:first.meta};
 const display={ztDay:'20261112',ztPool:[{code:'600001'}]};const selected=selectLimitReviewDisplay(current,display);assert.equal(selected.ztDay,'20261112');assert.equal(selected.ztReviewPoolMeta.tradeDate,'2026-11-13');
 const newer={...current,ztReviewPoolMeta:{...first.meta,tradeDate:'2026-11-16'}};assert.equal(selectLimitReviewDisplay(current,newer),newer);
});

test('a failed CLS source retains its ST-only record as held evidence without refreshing its original receipt',()=>{
 const input=sources(),first=mergeLimitReviewPools(input),old=first.rows.find(row=>row.code==='600037');
 const held=mergeLimitReviewPools({...input,cls:{status:'unavailable'},previousRows:first.rows,previousMeta:first.meta});
 const st=held.rows.find(row=>row.code==='600037');assert.ok(st);assert.equal(st.heldRecord,true);assert.equal(st.currentSourceConfirmed,false);assert.deepEqual(st.heldSources,['cls']);
 assert.equal(st.receivedAt,old.receivedAt);assert.equal(st.reasonReceivedAt,old.reasonReceivedAt);assert.equal(st.sourceEventAt,old.sourceEventAt);assert.equal(held.meta.heldRecordCount,1);assert.deepEqual(held.meta.retainedSources,['cls']);
 const both=held.rows.find(row=>row.code==='600000');assert.equal(both.currentSourceConfirmed,true);assert.equal(both.heldRecord,false);assert.equal(both.sourceStatuses.cls,'retained');
 const tomorrow={...input,tradeDate:'2026-11-16',eastmoneyRows:input.eastmoneyRows.map(row=>({...row,tradeDate:'2026-11-16',sourceTradeDate:'2026-11-16'})),cls:{status:'unavailable'},previousRows:first.rows,previousMeta:first.meta};
 assert.equal(mergeLimitReviewPools(tomorrow).rows.some(row=>row.code==='600037'),false);
});
test('a complete successful CLS response may remove its old unique record',()=>{
 const input=sources(),first=mergeLimitReviewPools(input),items=input.cls.items.slice(0,37);
 const next=mergeLimitReviewPools({...input,cls:{...input.cls,items,totalCount:37,fetchedCount:37,uniqueCount:37},previousRows:first.rows,previousMeta:first.meta});
 assert.equal(next.rows.length,37);assert.equal(next.meta.heldRecordCount,0);assert.deepEqual(next.meta.retainedSources,[]);
});

test('a partial EM response keeps newly observed same-day stocks alongside a complete CLS subset',()=>{
 const input=sources(),firstEm=input.eastmoneyRows.slice(0,1),cls={...input.cls,items:input.cls.items.slice(0,1),totalCount:1,fetchedCount:1,uniqueCount:1};
 const prior=mergeLimitReviewPools({...input,eastmoneyRows:firstEm,eastmoneyMeta:{totalCount:1,receivedAt:now-1000},cls});
 const incoming=[{...firstEm[0],price:15,receivedAt:now+1000},{...input.eastmoneyRows[1],receivedAt:now+1000}];
 const next=mergeLimitReviewPools({...input,eastmoneyRows:incoming,eastmoneyMeta:{totalCount:3,receivedAt:now+1000},cls,previousRows:prior.rows,previousMeta:prior.meta});
 assert.deepEqual(next.rows.map(row=>row.code),['600000','600001']);assert.equal(next.rows[0].price,15);assert.equal(next.rows[1].receivedAt,now+1000);
 assert.equal(next.meta.sources[0].providerComplete,false);assert.equal(next.meta.partial,true);assert.equal(next.rows[1].heldRecord,false);
});
test('all-source incompleteness merges valid new EM rows and holds only the missing old complement',()=>{
 const input=sources(),oldRows=[input.eastmoneyRows[0],input.eastmoneyRows[2]],cls={...input.cls,items:input.cls.items.slice(0,1),totalCount:1,fetchedCount:1,uniqueCount:1};
 const prior=mergeLimitReviewPools({...input,eastmoneyRows:oldRows,eastmoneyMeta:{totalCount:2,receivedAt:now},cls});
 const incoming=[{...input.eastmoneyRows[0],receivedAt:now+1000},{...input.eastmoneyRows[1],receivedAt:now+1000}];
 const next=mergeLimitReviewPools({...input,eastmoneyRows:incoming,eastmoneyMeta:{totalCount:3,receivedAt:now+1000},cls:{status:'unavailable'},previousRows:prior.rows,previousMeta:prior.meta});
 assert.deepEqual(next.rows.map(row=>row.code),['600000','600001','600002']);const added=next.rows.find(row=>row.code==='600001'),held=next.rows.find(row=>row.code==='600002');
 assert.equal(added.currentSourceConfirmed,true);assert.equal(added.heldRecord,false);assert.equal(added.receivedAt,now+1000);
 assert.equal(held.heldRecord,true);assert.equal(held.receivedAt,now);assert.deepEqual(held.heldSources,['eastmoney']);
 assert.equal(next.meta.sources[0].providerComplete,false);assert.equal(next.meta.sources[0].fetchedCount,2);assert.equal(next.meta.sources[0].totalCount,3);assert.equal(next.meta.providerComplete,false);
 const repeated=mergeLimitReviewPools({...input,eastmoneyRows:incoming.slice(0,1),eastmoneyMeta:{totalCount:3,receivedAt:now+2000},cls:{status:'unavailable'},previousRows:next.rows,previousMeta:next.meta});
 assert.equal(repeated.rows.length,3);assert.equal(repeated.rows.find(row=>row.code==='600002').receivedAt,now);assert.equal(repeated.meta.sources[0].providerComplete,false);
});
