'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {updateLifecycle}=require('../src/strategy/signal-pool-lifecycle');
const {holdingEvidence,asHoldingsAct}=require('../src/strategy/holding-signal-evidence');
const ts=date=>Date.parse(date+'T07:00:00Z');
const baseDate='2026-02-04';
function pattern(id='red_three_soldiers',side='bullish'){
 return {id,side,label:id,pool:side==='bullish'?'K线看涨池':'形态风险池',status:'matched'};
}
function row(date='2026-02-04',matched=[pattern()],extras={}){
 return {symbol:'600001',name:'测试股',patternDate:date,quality:{usable:true,fresh:true,simulated:false},
  blockedBySafety:false,patterns:{usable:true,positiveCount:matched.filter(x=>x.side==='bullish').length,
   riskCount:matched.filter(x=>x.side==='bearish').length,matched},
  ...extras};
}
test('one complete strategy enters observe; a second day confirms focus without changing original rank',()=>{
 const first=updateLifecycle({items:[row('2026-02-03')],now:ts(baseDate)});
 assert.equal(first.states[0].stage,'observe');
 assert.equal(first.pools['新发现观察池'].length,1);
 const next=updateLifecycle({items:[row()],previous:first.states,now:ts(baseDate)});
 assert.equal(next.states[0].stage,'focus');
 assert.equal(next.states[0].streak,2);
 assert.equal(next.pools['持续确认重点池'].length,1);
 assert.equal(next.canTrade,false);
 assert.equal(next.canNotify,false);
 const again=updateLifecycle({items:[row()],previous:next.states,now:ts(baseDate)});
 assert.equal(again.states[0].streak,2,'no duplicate confirmations same day');
});
test('a risk flag overrides any number of bullish matches without rewriting trade authority',()=>{
 const r=row(baseDate,[pattern('one'),pattern('two'),pattern('three'),pattern('three_black_crows','bearish')]);
 const q=updateLifecycle({items:[r],now:ts(baseDate)});
 assert.equal(q.states[0].stage,'risk-review');
 assert.equal(q.pools['风险核对池'].length,1);
 assert.equal(q.pools['持续确认重点池'].length,0);
 const blocked=updateLifecycle({items:[row(baseDate,[pattern()],{blockedBySafety:true})],now:ts(baseDate)});
 assert.equal(blocked.states[0].stage,'risk-review');
});
test('stale, simulated and missing data never promote a stock or wipe confirmed older state',()=>{
 const old=updateLifecycle({items:[row('2026-02-03')],now:ts(baseDate)}).states;
 for(const m of [
  row('2026-01-01'),row(baseDate,[pattern()],{quality:{usable:true,fresh:true,simulated:true}}),
  row('2026-02-31'),row(baseDate,[pattern()],{quality:{usable:false,fresh:false,simulated:false}})
 ]){
  const a=updateLifecycle({items:[m],previous:old,now:ts(baseDate)});
  assert.equal(a.states[0].dataStatus,'unavailable');
  assert.equal(a.pools['持续确认重点池'].length,0);
 }
});
test('loss of a signal downgrades, then archives after consecutive valid sessions',()=>{
 const s1=updateLifecycle({items:[row('2026-02-01')],now:ts(baseDate)}).states;
 const r2=updateLifecycle({items:[row('2026-02-02',[])],previous:s1,now:ts(baseDate)});
 assert.equal(r2.states[0].stage,'weakening');
 const r3=updateLifecycle({items:[row('2026-02-03',[])],previous:r2.states,now:ts(baseDate)});
 const r4=updateLifecycle({items:[row(baseDate,[])],previous:r3.states,now:ts(baseDate)});
 assert.equal(r4.states[0].stage,'archived');
});
function bars(n=35,lastDay='2026-02-04'){
 const last=Date.parse(lastDay+'T00:00:00Z');
 return Array.from({length:n},(_,i)=>{
  const date=new Date(last-(n-1-i)*86400000).toISOString().slice(0,10);
  return {date,open:10,high:10.2,low:9.8,close:10,volume:1000000,amount:110000000};
 });
}
test('bearish historical evidence needs same-day K and explicitly timed fresh quote to be mobile-alert eligible',()=>{
 const b=bars();
 b.splice(-3,3,
  {...b.at(-3),open:10.2,close:9.9,low:9.85,high:10.25},
  {...b.at(-2),open:10,close:9.7,low:9.65,high:10.05},
  {...b.at(-1),open:9.8,close:9.5,low:9.45,high:9.85});
 const now=ts(baseDate);
 const quote={quoteAt:now-10000,quoteSource:'eastmoney',price:9.5,suspended:false};
 const valid=holdingEvidence({code:'600001',bars:b,quote,now});
 assert.ok(valid.risks.some(x=>x.id==='three_black_crows'));
 assert.equal(valid.notifyEligible,true);
 const act=asHoldingsAct(valid,{locked:true});
 assert.equal(act.type,'形态风险');
 assert.equal(act.once,true);
 assert.match(act.why,/已锁仓/);
 assert.ok(!JSON.stringify(act).includes('成本'));
 for(const bad of [
  {...quote,quoteAt:now-120000}, {...quote,quoteAt:now+30000},
  {...quote,proxy:true},{...quote,quoteSource:'simulated'}, {...quote,quoteSource:''}
 ]){
  const e=holdingEvidence({code:'600001',bars:b,quote:bad,now});
  assert.equal(e.notifyEligible,false);
  assert.equal(asHoldingsAct(e),null);
 }
 const older=holdingEvidence({code:'600001',bars:bars(35,'2026-02-03'),quote,now});
 assert.equal(older.notifyEligible,false);
});
test('issuer announcements stay unverified even if combined with a current bearish K-line',()=>{
 const now=ts(baseDate),a=bars();
 const e=holdingEvidence({code:'600001',bars:a,now,announcements:[
 {code:'600001',title:'收到立案调查通知书',source:'巨潮资讯',
  publishedAt:'2026-02-04T05:00:00Z',url:'https://static.cninfo.com.cn/finalpage/2026-02-04/100.pdf'}
 ]});
 assert.equal(e.issuerRisks.length,1);
 assert.equal(e.issuerRisks[0].verified,false);
 assert.equal(e.notifyEligible,false);
});
