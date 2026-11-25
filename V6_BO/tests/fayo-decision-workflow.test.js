'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const selectionApi=import('../public/nova/decision-workflow.js');
const battleApi=import('../public/nova/battle-home.js');
const target='2026-11-25',now=Date.parse(target+'T16:00:00+08:00');
const candidate=(extra={})=>({code:'600001',name:'甲',day:target,entry:[10,10.2],themes:['芯片'],
 row:{code:'600001',name:'甲',poolDay:target,sector:'芯片',quoteAt:now-1000,provenance:{source:'tencent'}},...extra});
const candle=(date,close=10)=>({date,open:10,high:Math.max(11,close),low:9,close,volume:100});
const history=rows=>({ok:true,code:'600001',rows,dataQuality:{source:'tencent',receivedAt:now-1000}});

test('selection keeps one dated identity across notifications without rewriting its input',async()=>{
 const {createDecisionSelection,workflowDay}=await selectionApi;
 const state=createDecisionSelection(),input=candidate(),before=JSON.stringify(input),events=[];
 const remove=state.subscribe(value=>events.push(value&&value.code+':'+value.day));
 const first=state.select(input),second=state.select(candidate({code:'600002',row:{code:'600002',poolDay:target},day:'20261125'}));
 assert.equal(first.code,'600001');assert.equal(second.row.workflowDay,target);assert.ok(second.revision>first.revision);
 assert.equal(JSON.stringify(input),before);assert.deepEqual(events,['600001:'+target,'600002:'+target]);
 remove();state.clear();assert.equal(state.value,null);assert.equal(events.length,2);
 for(const value of ['2026-02-30','2026-13-01',new Date(),{},'',null])assert.equal(workflowDay(value),null);
});

test('selection refuses a different stock or trade date hidden inside the selected evidence row',async()=>{
 const {createDecisionSelection}=await selectionApi;
 const mutations=[value=>value.row.code='600002',value=>value.row.poolDay='2026-11-24',
  value=>value.row.tradeDate='2026-11-24',value=>value.row.workflowDay='2026-11-24'];
 for(const change of mutations){const state=createDecisionSelection(),value=candidate();change(value);assert.equal(state.select(value),null);assert.equal(state.value,null);}
});

test('a selected plan remains a snapshot when the source arrays or nested evidence later change',async()=>{
 const {createDecisionSelection}=await selectionApi,state=createDecisionSelection(),value=candidate(),selected=state.select(value);
 value.entry[0]=99;value.themes.push('银行');value.row.provenance.source='changed';value.row.price=88;
 assert.deepEqual(selected.entry,[10,10.2]);assert.deepEqual(selected.themes,['芯片']);
 assert.equal(selected.row.provenance.source,'tencent');assert.equal(selected.row.price,undefined);
 assert.ok(Object.isFrozen(selected.entry));assert.ok(Object.isFrozen(selected.row));
});

test('selection subscriptions respect both an existing abort and a later route teardown',async()=>{
 const {createDecisionSelection}=await selectionApi,state=createDecisionSelection(),gone=new AbortController(),live=new AbortController();
 let old=0,current=0;gone.abort();state.subscribe(()=>old++,gone.signal);state.subscribe(()=>current++,live.signal);
 state.select(candidate());live.abort();state.select(candidate({code:'600002',row:{code:'600002',poolDay:target}}));state.clear();
 assert.equal(old,0);assert.equal(current,1);
});

test('sector linkage requires matching session evidence and explicit numeric yuan amounts',async()=>{
 const {selectedSectorEvidence}=await selectionApi,selected={code:'600001',day:target,sector:'芯片',themes:['半导体']};
 const state={snapshotFieldDays:{sectors:target},sectors:[{name:'芯片',mainInflowYuan:0,source:'eastmoney'},
  {name:'半导体',netInflowYuan:-30,day:target},{name:'银行',mainInflowYuan:100},
  {name:'芯片',mainInflowYuan:99,tradeDate:'2026-11-24'}]};
 const proof=selectedSectorEvidence(state,selected);assert.equal(proof.status,'available');assert.deepEqual(proof.rows.map(r=>r.value),[0,-30]);
 assert.equal(selectedSectorEvidence({...state,snapshotFieldDays:{sectors:'2026-11-24'}},selected).rows.length,0);
 assert.equal(selectedSectorEvidence({sectors:state.sectors},selected).status,'missing');
 const unknown=selectedSectorEvidence({...state,sectors:[{name:'芯片',mainInflow:'100亿'},{name:'半导体',mainInflowYuan:'100'}]},selected);
 assert.equal(unknown.status,'missing');assert.ok(unknown.rows.every(row=>row.value===null));
});

test('malformed sector collections and entries stay missing rather than breaking all linked panels',async()=>{
 const {selectedSectorEvidence}=await selectionApi,selected={code:'600001',day:target,sector:'芯片',themes:[]};
 for(const sectors of [{items:{}},{items:'bad'},[null,42,'芯片'],null]){
  const result=selectedSectorEvidence({snapshotFieldDays:{sectors:target},sectors},selected);
  assert.equal(result.status,'missing');assert.deepEqual(result.rows,[]);
 }
});

test('mini K retains only twenty valid bars through the selected day without creating missing values',async t=>{
 t.mock.method(Date,'now',()=>now);const {miniCandles}=await battleApi;
 const rows=Array.from({length:25},(_,i)=>candle('2026-11-'+String(i+1).padStart(2,'0')));
 const payload=history([...rows,candle('2026-11-26'),{...candle('2026-11-20'),high:2}]);
 const before=JSON.stringify(payload),result=miniCandles(payload,'600001','2026-11-24');
 assert.equal(result.length,20);assert.equal(result[0].date,'2026-11-05');assert.equal(result.at(-1).date,'2026-11-24');
 assert.equal(new Set(result.map(r=>r.date)).size,20);assert.equal(JSON.stringify(payload),before);
 const unknownVolume=miniCandles(history([{...candle(target),volume:null}]),'600001',target);
 assert.equal(unknownVolume[0].volume,null);
});

test('mini K refuses unknown identity, failed reads, invalid reference dates and future provenance',async t=>{
 t.mock.method(Date,'now',()=>now);const {miniCandles}=await battleApi;
 const changes=[p=>delete p.code,p=>p.code='600002',p=>p.ok=false,p=>p.dataQuality.source='',
  p=>p.dataQuality.receivedAt=now+1,p=>p.dataQuality.receivedAt='not-a-time',p=>p.dataQuality.missingReason='source-missing'];
 for(const change of changes){const payload=history([candle(target)]);change(payload);assert.deepEqual(miniCandles(payload,'600001',target),[]);}
 for(const date of ['2026-02-30','2026-11-26','not-a-day',undefined])assert.deepEqual(miniCandles(history([candle(target)]),'600001',date),[]);
});
