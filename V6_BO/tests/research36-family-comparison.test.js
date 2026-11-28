'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderedWindowRoles,summarizeLedger,compareResearchFamilies}=require('../src/strategy/research36-family-comparison');
const defs=[{id:'ma_trend',family:'trend',rules:[{field:'closeOver20'}]},{id:'sector_resonance',family:'flow',rules:[{field:'closeOver20'}]}];
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10));
const input={strategyIds:defs.map(d=>d.id),stocks:[{symbol:'600000',bars:dates.map(date=>({date}))}],evidenceByDate:{},options:{start:27,end:30,initialCash:100,topN:1,holdDays:1,tradingDates:dates}};
function report(strategyId,slippageBps){
 const trend=strategyId==='ma_trend',endValue=trend?90:100;
 const equity=Array.from({length:4},(_,i)=>({day:27+i,cash:i===1&&trend?0:endValue,value:endValue,openPositions:i===1&&trend?1:0,unpriced:[]}));
 return {researchOnly:true,canTrade:false,executionModel:'position-ledger',metrics:{initialCash:100,returnPct:trend?-10:0,maxDrawdownPct:trend?10:0},equity,orders:trend?[{side:'buy',symbol:'600000',status:'filled'},{side:'buy',symbol:'600000',status:'blocked'},{side:'sell',status:'blocked'}]:[],trades:trend?[{symbol:'600000',buyDay:28,sellDay:29,netPnl:-10,costBasis:100}]:[],openPositions:[],research36:{strategyId,configHash:'a'.repeat(64),signals:[{code:'600000',day:27,status:trend?'research_candidate':'insufficient_data'},{code:'600000',day:28,status:trend?'not_matched':'disabled'}]},benchmark:{canTrade:false,metrics:{initialCash:100},equity:equity.map(e=>({...e,cash:100,value:100,openPositions:0})),slippageBps}};
}
test('original experiment window roles cannot train after validation or test',()=>{
 const r=roles=>orderedWindowRoles(roles.map(role=>({role})));
 assert.equal(r(['train','train','validation','test','test']),true);
 for(const x of [['test','train','validation'],['train','test','validation'],['train','validation','train','test'],['train','train','test'],['train','validation','other','test']])assert.equal(r(x),false);
});
test('comparison runs the same original ledger protocol for every preselected strategy and cost stress',()=>{
 const calls=[],r=compareResearchFamilies(input,defs,x=>{calls.push(x);return report(x.strategyId,x.options.slippageBps);});
 assert.equal(r.status,'descriptive-only');assert.equal(calls.length,4);assert.deepEqual(calls.map(x=>x.options.slippageBps),[10,10,30,30]);assert.ok(calls.every(x=>x.options.topN===1&&x.options.holdDays===1&&x.options.tradingDates===dates&&x.stocks===input.stocks));
 assert.equal(r.rows.length,4);assert.equal(Object.keys(r.benchmarks).length,2);assert.deepEqual(r.sharedFields,[{a:'ma_trend',b:'sector_resonance',fields:['closeOver20']}]);assert.equal(r.preregistered,false);assert.equal(r.canTrade,false);
});
test('losing filled samples, blocked orders, disabled unknown and cash are separate from fabricated return',()=>{
 const r=compareResearchFamilies(input,defs,x=>report(x.strategyId,x.options.slippageBps)),s=r.rows[0].summary,u=r.rows[1].summary;
 assert.equal(s.markedReturnPct,-10);assert.equal(s.realized.negativeCount,1);assert.equal(s.realized.tailMeanPct,-10);assert.equal(s.blockedBuys,1);assert.equal(s.blockedSells,1);assert.equal(s.coverage.notEvaluated,1);assert.equal(u.coverage.unknown,1);assert.equal(u.coverage.disabled,1);assert.equal(u.cashSessions,4);assert.equal(u.markedReturnPct,null);assert.equal(r.cashBaseline.returnPct,0);
});
test('failed attempts and changed benchmark prevent a complete comparison, preserving earlier full result',()=>{
 for(const mutate of [x=>{throw Error('ledger refused')},x=>({...report(x.strategyId,x.options.slippageBps),benchmark:{...report(x.strategyId,x.options.slippageBps).benchmark,changed:true}})]){
  let i=0;const r=compareResearchFamilies(input,defs,x=>++i===2?mutate(x):report(x.strategyId,x.options.slippageBps));assert.equal(r.status,'incomplete-original-ledger-comparison');assert.equal(r.comparisonAvailable,false);assert.equal(r.rows.length,1);assert.equal(r.attempts.at(-1).status,'failed');
 }
});
test('duplicate strategies, missing exact calendar and excessive work are refused before any ledger invocation',()=>{
 for(const bad of [{...input,strategyIds:['ma_trend','ma_trend']},{...input,options:{...input.options,tradingDates:null}},{...input,options:{...input.options,end:99}},{...input,stocks:Array.from({length:200},()=>({bars:Array(1000).fill({})})),options:{...input.options,end:999,tradingDates:Array(1000).fill('2026-11-01')}}])assert.throws(()=>compareResearchFamilies(bad,defs,()=>assert.fail('must not execute')));
});
test('unsettled or untraceable trade samples do not claim mature net return and tail loss',()=>{
 const opts={start:27,end:30,initialCash:100,strategyId:'ma_trend',universeSize:1},r=report('ma_trend',10);r.trades[0].sellDay=r.trades[0].buyDay;let s=summarizeLedger(r,opts);assert.equal(s.realized.unresolvedTrades,1);assert.equal(s.realized.worstPct,null);assert.equal(s.settledReturnPct,null);
 r.research36.signals.push({...r.research36.signals[0]});assert.throws(()=>summarizeLedger(r,opts),/duplicate/);
});
const {nativeReversalSignal}=require('../src/strategy/research36-family-comparison');
function reversal(){
 const bars=[];for(let i=0;bars.length<55;i++){const d=new Date(Date.UTC(2026,0,5+i));if([0,6].includes(d.getUTCDay()))continue;const date=d.toISOString().slice(0,10),ix=bars.length,close=ix===54?10.3:ix===53?9.75:10,at=Date.parse(date+'T15:00:00+08:00');bars.push({date,open:close,close,low:9.7,high:ix===54?10.6:10.5,volume:ix===54?2000:1000,source:'declared-daily',priceBasis:'unadjusted',final:true,observedAt:at,availableAt:at,recordedAt:at});}
 return {symbol:'600000',bars};
}
test('original RSV reversal evaluator is reused, with no tuned replacement and failed reversal retained',()=>{
 const s=reversal(),at=s.bars.at(-1).recordedAt,r=nativeReversalSignal(s,at);assert.equal(r.status,'research_candidate');assert.equal(r.nativeEvidence.id,'rsv14_reversal_confirmation');assert.equal(r.nativeEvidence.status,'candidate');s.bars.at(-1).volume=900;assert.equal(nativeReversalSignal(s,at).status,'not_matched');
});
test('late, unfinished, mixed-basis or mismatched prefix cannot qualify as a native reversal at the original cutoff',()=>{
 for(const mutate of [s=>s.bars.at(-1).recordedAt++,s=>s.bars.at(-1).observedAt--,s=>s.bars[3].priceBasis='qfq',s=>s.bars[4].source='other',s=>s.bars[5].symbol='600001',s=>s.bars[6].final=false]){const s=reversal(),at=s.bars.at(-1).recordedAt;mutate(s);assert.equal(nativeReversalSignal(s,at).status,'insufficient_data');}
});
