'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public/nova'),url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const evidence=()=>import(url(fs.readFileSync(path.join(root,'market-evidence.js'),'utf8')));
const fixture=()=>({ztDay:'20261113',ztDayProbed:true,ztPool:Array.from({length:97},(_,i)=>({code:String(600000+i),name:'样本'+i,sector:i%2?'甲板块':'乙板块',limitUpCount:i%3+1,src:'em',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',reason:'完整真实原因'+i,reasonTradeDate:'2026-11-13',reasonDateStatus:'matched',reasonSource:'合成已核对来源'})),review:{date:'20261113',items:[{code:'600000',reasonRaw:'同日归档原因',reasonTradeDate:'2026-11-13',reasonDateStatus:'matched',reasonSource:'归档来源',role:'leader'}]}});
test('daily review includes the complete deduplicated pool and all coded sector links',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.ztPool.push({...state.ztPool[0]});const result=dailyReviewEvidence(state);
 assert.equal(result.rows.length,97);assert.equal(result.sectors.reduce((n,x)=>n+x.count,0),97);assert.equal(result.rows[0].peers.length,48);assert.equal(result.rows[0].reason,'完整真实原因0');assert.equal(result.rows[0].role,'leader');assert.equal(result.day,'2026-11-13');
});
test('unknown and mismatched source days do not borrow raw reasons, roles or linked rows',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.review.date='20261112';state.ztPool[0].reasonTradeDate='2026-11-12';state.ztPool[1].reasonDateStatus='unknown';state.ztPool[2].sourceTradeDate='2026-11-12';
 const result=dailyReviewEvidence(state);assert.equal(result.rows[0].reason,null);assert.equal(result.rows[0].role,null);assert.equal(result.rows[1].reason,null);assert.equal(result.rows.length,97);assert.equal(result.rows[2].dateMatched,false);assert.equal(result.rows[2].peers.length,0);assert.equal(result.reviewMatched,false);
 const absent=dailyReviewEvidence({ztPool:[{code:'600001',reason:'无日期原因'}],review:{items:[{code:'600001',reasonRaw:'未知归档'}]}});assert.equal(absent.rows[0].reason,null);assert.equal(absent.day,null);
});
test('same-day archived evidence requires its own matched reason day and keeps every returned linkage without guessing codes',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();delete state.ztPool[0].reason;
 state.review.items[0].peers=Array.from({length:9},(_,i)=>({n:'关联'+i,lb:0,role:'mid',strong:true}));
 let row=dailyReviewEvidence(state).rows[0];assert.equal(row.reason,'同日归档原因');assert.equal(row.linkedRecords.length,9);assert.equal(row.linkedRecords[8].code,null);
 state.review.items[0].reasonDateStatus='unknown';row=dailyReviewEvidence(state).rows[0];assert.equal(row.reason,null);
});
test('readonly union includes ST and exposes independent 37 versus 38 source scopes and dates',async()=>{
 const {dailyReviewEvidence}=await evidence(),legacy=fixture(),rows=legacy.ztPool.slice(0,38);rows[37]={...rows[37],name:'ST合成样本',sectorTags:['甲板块','补充板块'],sources:['cls']};rows[0]={...rows[0],sectorTags:['乙板块','补充板块'],sources:['eastmoney','cls']};
 const meta={tradeDate:'2026-11-13',status:'ready',source:'eastmoney+cls',uniqueCount:38,intersectionCount:37,clsOnlyCount:1,eastmoneyOnlyCount:0,wholeMarketCertified:false,sources:[{source:'eastmoney',tradeDate:'2026-11-13',totalCount:37,fetchedCount:37,providerComplete:true,completenessScope:'provider-response-only',includesST:false},{source:'cls',tradeDate:'2026-11-13',totalCount:38,fetchedCount:38,providerComplete:true,completenessScope:'provider-response-only',includesST:true}]};
 const result=dailyReviewEvidence({...legacy,ztReviewPool:rows,ztReviewPoolMeta:meta});assert.equal(result.rows.length,38);assert.equal(result.rows[37].name,'ST合成样本');assert.equal(result.sourceEvidence.sources[0].totalCount,37);assert.equal(result.sourceEvidence.sources[1].totalCount,38);assert.equal(result.sectors.find(x=>x.name==='补充板块').count,2);assert.ok(result.rows[0].peers.some(x=>x.code===rows[37].code));assert.deepEqual(result.rows[0].sectorTags,['乙板块','补充板块']);
});
test('new readonly pool dates are independent of strategy dates, including missing meta, explicit empty and retained history',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();const row=state.ztPool[0];
 assert.equal(dailyReviewEvidence({...state,ztReviewPool:[row]}).day,null,'missing readonly metadata never borrows strategy day');
 assert.equal(dailyReviewEvidence({...state,ztReviewPool:[]}).rows.length,0,'explicit readonly empty does not silently resurrect strategy pool');
 const mixed=dailyReviewEvidence({...state,ztDay:'20261112',ztReviewPool:[row,{...state.ztPool[1],sourceTradeDate:'2026-11-12'}],ztReviewPoolMeta:{tradeDate:'2026-11-13',sources:[{source:'eastmoney',tradeDate:'2026-11-12',totalCount:37}]}});assert.equal(mixed.day,'2026-11-13');assert.equal(mixed.rows.length,1);assert.equal(mixed.excludedDateRows,1);assert.equal(mixed.sourceEvidence.sources[0].tradeDate,'2026-11-12');
 const retained=dailyReviewEvidence({...state,ztDay:'20261116',ztReviewPool:[row],ztReviewPoolMeta:{tradeDate:'2026-11-13',status:'retained',lastAttempt:{tradeDate:'2026-11-16'}}});assert.equal(retained.day,'2026-11-13');assert.equal(retained.rows[0].reasonDay,'2026-11-13');assert.equal(retained.sourceEvidence.status,'retained');assert.equal(dailyReviewEvidence(state).rows.length,97,'old services still use strategy pool');
});
test('held ST records preserve original reception/source fields and cannot look currently confirmed',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.ztReviewPool=[{...state.ztPool[0],name:'ST保留样本',heldRecord:true,currentSourceConfirmed:false,heldSources:['cls'],sourceStatuses:{cls:'retained'},reasonSourceStatus:'retained',receivedAt:12345,sourceEventAt:12000}];state.ztReviewPoolMeta={tradeDate:'2026-11-13',retainedSources:['cls'],heldRecordCount:1};
 const row=dailyReviewEvidence(state).rows[0];assert.equal(row.heldRecord,true);assert.equal(row.currentSourceConfirmed,false);assert.deepEqual(row.heldSources,['cls']);assert.deepEqual(row.sourceStatuses,{cls:'retained'});assert.equal(row.reasonSourceStatus,'retained');assert.equal(row.receivedAt,12345);assert.equal(row.sourceEventAt,12000);
});

test('contradictory dates are isolated and a matching complete duplicate is selected without grafting',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture(),valid=state.ztPool[0];
 const meta={tradeDate:'2026-11-13'};
 const conflict={...valid,tradeDate:'2026-11-12'};
 const unknown={...valid,sourceTradeDate:undefined,tradeDate:undefined,reason:'旧的未知日期原因',price:99};
 const result=dailyReviewEvidence({...state,ztReviewPool:[conflict,unknown,valid],ztReviewPoolMeta:meta});
 assert.equal(result.excludedDateRows,1);assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].dateMatched,true);assert.equal(result.rows[0].reason,valid.reason);
 assert.equal(result.rows[0].stock.price,valid.price,'does not borrow the unknown record price');
 const legacy=dailyReviewEvidence({...state,ztPool:[unknown,valid]});assert.equal(legacy.rows[0].reason,valid.reason);
});

test('explicitly dated foreign linkage cannot be presented as a matching day record',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();
 state.review.items[0].peers=[{n:'无代码原记录',lb:0},{n:'同日记录',code:'600001',tradeDate:'2026-11-13'},{n:'异日记录',code:'600002',tradeDate:'2026-11-12'},{n:'矛盾日期',code:'600003',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-12'}];
 const rows=dailyReviewEvidence(state).rows[0].linkedRecords;
 assert.equal(rows.length,2);assert.equal(rows[0].code,null);assert.equal(rows[1].code,'600001');
});
