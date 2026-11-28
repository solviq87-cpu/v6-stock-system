'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../public/assets/market-linkage-card');
const {enrichMarketLinkageHistory}=require('../src/core/market-linkage-history');
const {buildMarketSectorStockLinkage}=require('../src/core/market-sector-stock-linkage');
function fixture(){
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.hidden=false;this.ownText='';this.ownerDocument=doc;this.classList={add(){}};}
  append(e){this.children.push(e);}
  replaceChildren(){this.children=[];this.ownText='';}
  set textContent(x){this.ownText=x;this.children=[];}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
  setAttribute(k,v){this.attributes[k]=v;}
 }
 const doc={createElement:tag=>new Element(tag)},host=new Element('section');
 const all=(tag,parent=host)=>parent.children.flatMap(x=>[...(x.tagName===tag?[x]:[]),...all(tag,x)]);
 return {host,all,click:b=>b.dispatchEvent(new Event('click')),choose:b=>{const s=all('select')[0];s.value=b.value;s.dispatchEvent(new Event('change'));}};
}
const dates=['2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'],close=d=>Date.parse(d+'T15:00:00+08:00');
const symbols=['600000','600001','600002','600003','600004'],other=['600010','600011','600012','600013','600014'];
function archive(){
 const events=dates.slice(1).map((tradeDate,i)=>{
  const start=close(dates[i]),end=close(tradeDate),asOf=end+1000;
  const board=(code,name,members)=>({code,name,category:'industry',members:[...members],membersKnownAt:start,membersEffectiveAt:start,return:.01,knownAt:asOf});
  const evidence={provider:'eastmoney',symbol:symbols[0],tradeDate,knownAt:asOf,window:{start,end},returnBasis:'price',benchmark:{provider:'eastmoney',code:'000001',name:'指数',methodologyVersion:'v1',return:.005,knownAt:asOf},classification:{provider:'eastmoney',version:'v1',knownAt:start,effectiveAt:start},methodology:{noCorporateActions:true},boards:[board('A','行业甲',symbols),board('B','行业乙',other)],stocks:[...symbols,...other].map((symbol,j)=>({symbol,return:j===0?(i===4?-.01:.04):j===1&&i===4?.05:.02,knownAt:asOf}))};
  return {kind:'analysis',sequence:i+1,hash:'fixture-'+i,recordedAt:asOf+1000,data:{asOf,tradeDate,tradeDates:dates.slice(0,i+2),provider:'eastmoney',priceBasis:'unadjusted',symbol:symbols[0],context:{marketLinkageEvidence:evidence}}};
 });
 const selectedEvent=events.at(-1),asOf=selectedEvent.recordedAt;
 const project=()=>enrichMarketLinkageHistory(buildMarketSectorStockLinkage(events,{selectedEvent,asOf}),events,{selectedEvent,asOf});
 return {events,project};
}
test('original card consumes actual backend five-day comparison and migration projection',()=>{
 const f=fixture(),v=archive().project();C.render(f.host,v);
 assert.match(f.host.textContent,/同一封存快照行业比较/);assert.match(f.host.textContent,/可比行业 2 \/ 2/);
 assert.match(f.host.textContent,/第 1 名 · 行业甲/);assert.match(f.host.textContent,/第 1 名 · 行业乙/);
 assert.match(f.host.textContent,/广泛相对强势/);assert.match(f.host.textContent,/共同有效成员 5 \/ 5/);
 assert.match(f.host.textContent,/前排迁移：保留 0 · 新进入 1 · 离开 1/);
 assert.match(f.host.textContent,/非事前信号，不构成买卖建议/);
});
test('sector selection redraws only corresponding five-day evidence and does not call inspect',()=>{
 const f=fixture(),calls=[],v=archive().project();C.render(f.host,v,{onInspect:s=>calls.push(s)});
 f.choose(f.all('option').find(o=>o.textContent.startsWith('行业乙')));
 assert.match(f.host.textContent,/前排迁移：保留 5 · 新进入 0 · 离开 0/);assert.doesNotMatch(f.host.textContent,/前排迁移：保留 0/);assert.deepEqual(calls,[]);
});
test('insufficient common coverage and late prior archive are explicit unknown, not zero or a winner',()=>{
 const f=fixture(),a=archive();a.events[0].data.context.marketLinkageEvidence.stocks[0].return=null;C.render(f.host,a.project());
 assert.match(f.host.textContent,/共同样本覆盖不足/);assert.match(f.host.textContent,/可比行业不足，不排名/);assert.doesNotMatch(f.host.textContent,/前排迁移：保留/);
 const b=archive();b.events[3].recordedAt=Date.parse('2026-11-13T10:00:00+08:00');C.render(f.host,b.project());assert.match(f.host.textContent,/前排迁移证据不足/);
});
test('unknown or malformed comparison and unsafe permissions cannot render research as valid',()=>{
 for(const mutate of [v=>v.mainlineComparison.canTrade=true,v=>v.mainlineComparison.rows[0].rank=99,v=>v.mainlineComparison.rows[0].code='not-a-board',v=>v.mainlineComparison.dates.pop(),v=>v.mainlineComparison.rows[1]=null]){
  const f=fixture(),v=archive().project();mutate(v);C.render(f.host,v);assert.doesNotMatch(f.host.textContent,/第 1 名 · 行业/);assert.match(f.host.textContent,/五日行业比较证据不足/);
 }
 for(const mutate of [s=>s.canTrade=true,s=>s.daily.pop(),s=>s.commonObserved=6,s=>s.daily[0].up=99]){
  const f=fixture(),v=archive().project();mutate(v.boards[0].trend.structure);C.render(f.host,v);assert.doesNotMatch(f.host.textContent,/前排迁移：保留/);assert.match(f.host.textContent,/共同样本覆盖不足/);
 }
});
test('old projection and cleared host retain unknown, never reuse previous comparison',()=>{
 const f=fixture(),v=archive().project();C.render(f.host,v);C.clear(f.host,true);assert.equal(f.host.textContent,'');
 delete v.mainlineComparison;v.boards.forEach(b=>delete b.trend.structure);C.render(f.host,v);assert.match(f.host.textContent,/五日行业比较证据不足/);assert.doesNotMatch(f.host.textContent,/前排迁移：保留/);
});
test('F05.4 existing relative strength and observed turnover roles remain independent in the card',()=>{
 const f=fixture(),a=archive();const q=a.events.at(-1).data.context.marketLinkageEvidence;
 q.stocks.forEach((r,i)=>r.turnover=i===0?100:1);
 const v=a.project(),board=v.boards[0];assert.equal(board.members[0].role,'relative-back');assert.equal(board.members[0].turnoverRole,'turnover-core');assert.equal(board.members[1].role,'relative-front');assert.equal(board.members[1].turnoverRole,'unknown');
 C.render(f.host,v);assert.match(f.host.textContent,/600000 · 当期相对后排/);assert.match(f.host.textContent,/成交角色：成交核心观察/);
 f.click(f.all('button').find(b=>b.dataset.linkageSymbol==='600001'));assert.match(f.host.textContent,/600001 · 当期相对前排/);assert.match(f.host.textContent,/成交角色：成交证据不足/);assert.doesNotMatch(f.host.textContent,/涨停概率/);
});

test('F15.3 original card shows paired lag and contemporaneous control without claiming a leading signal',()=>{
 const f=fixture(),a=archive();for(let i=0;i<a.events.length;i++){const e=a.events[i].data.context.marketLinkageEvidence,dir=i%2?-1:1;e.stocks.forEach(s=>s.return=dir*.02);e.benchmark.return=dir*.01;}
 const v=a.project();C.render(f.host,v);assert.match(f.host.textContent,/有效配对 4 \/ 4/);assert.match(f.host.textContent,/滞后 0 \/ 4；同期 4 \/ 4/);assert.match(f.host.textContent,/同期冲击不等于领先/);
 for(const mutate of [lag=>lag.leadingConfirmed=true,lag=>lag.lagMatches=99,lag=>lag.pairs[0].signalRecordedAt=Date.parse('2026-11-10T12:00:00+08:00'),lag=>lag.pairs[1].lagMatch=true]){
  const bad=structuredClone(v);mutate(bad.boards[0].trend.structure.leadLag);C.render(f.host,bad);assert.doesNotMatch(f.host.textContent,/配对方向一致次数/);assert.match(f.host.textContent,/配对证据不足或未知/);
 }
});

test('F18.1 original card reports bounded first observation and excludes forged confirmation',()=>{
 const f=fixture(),a=archive();const first=a.events[0].data.context.marketLinkageEvidence;first.boards[0].return=-.01;first.stocks.slice(0,5).forEach(s=>s.return=-.01);
 const v=a.project();C.render(f.host,v);assert.match(f.host.textContent,/五日内首次符合观察：2026-11-10/);assert.match(f.host.textContent,/相邻交易日确认：2026-11-11/);assert.match(f.host.textContent,/未认证真实催化与前向收益/);
 for(const mutate of [e=>e.canTrade=true,e=>e.confirmedDate=e.firstDate,e=>e.firstObservedAt=Date.parse('2026-11-10T10:00:00+08:00'),e=>e.confirmationDelayMs=1]){
  const bad=structuredClone(v);mutate(bad.boards[0].trend.structure.earlyObservation);C.render(f.host,bad);assert.doesNotMatch(f.host.textContent,/相邻交易日确认：/);assert.match(f.host.textContent,/五日首次观察证据不足/);
 }
});
