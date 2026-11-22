import test from 'node:test';
import assert from 'node:assert/strict';
import {labelHistory,analyzeFactors,applyCorrections} from '../public/nova/kline-factor-engine.js';
import {syncedDataset} from '../public/nova/kline-synced-history.js';
import {renderKlineLearning} from '../public/nova/kline-learning-view.js';
import {selectBook} from '../public/nova/shortline/book-session.mjs';
import {sampleFor} from '../public/nova/shortline/context.mjs';
const days=['2025-01-02','2025-01-03','2025-01-06','2025-01-07','2025-01-08','2025-01-09','2025-01-10','2025-01-13','2025-01-14','2025-01-15','2025-01-16','2025-01-17'];
function data(){
  const stock=days.map((date,i)=>({date,source:'原始研究样本',asOf:date+'T15:02:00+08:00',code:'600000',sector:'银行',period:'日K',open:10,high:12,low:9,close:11,volume:1e5,limitUp:11,blackSwan:false,repeatable:true}));
  const market=days.map(date=>({date,source:'市场证据',asOf:date+'T15:01:00+08:00',close:120,code:'ALL_A',marketTrend:'多头'}));
  const sector=days.map(date=>({date,source:'板块证据',asOf:date+'T15:01:00+08:00',close:100,code:'银行',sectorStage:'发酵'}));
  return {stock,market,sector};
}
test('same-day sector/index revisions after stock signal and late preceding OHLC never enter native features',()=>{
  const d=data();d.market[5].asOf=days[5]+'T15:02:01+08:00';d.sector[5].asOf=days[5]+'T15:30:00+08:00';
  d.stock[3].asOf=days[5]+'T15:03:00+08:00';d.stock[3].close=500;d.stock[3].high=550;
  const s=labelHistory(d.stock,d.sector,d.market)[5];
  assert.equal(s.market,null);assert.equal(s.sector,null);assert.equal(s.labels.marketTrend,null);assert.equal(s.quality,'pending-review');
  assert.ok(!s.history.some(b=>b.date===days[3]));
  assert.equal(s.signalAvailableAt,new Date(days[5]+'T15:02:00+08:00').toISOString());
});
test('native candidate window retains first and independently matures returns; late changes do not consume a slot',()=>{
  const d=data(),obs=labelHistory(d.stock,d.sector,d.market),fires=obs.filter(r=>r.signals.some(s=>s.name==='连板接力'));
  assert.deepEqual(fires.map(s=>s.date),days.filter((_,i)=>i>=2&&(i-2)%3===0));
  assert.ok(fires[0].observed[0]);const brief=labelHistory(d.stock.slice(0,3),d.sector.slice(0,3),d.market.slice(0,3));
  assert.deepEqual(brief.at(-1).signals,fires[0].signals);assert.equal(brief.at(-1).observed[0],null);
  assert.ok(obs[3].suppressedStrategies.some(s=>s.strategy==='连板接力'&&s.first===days[2]));
  d.stock[4].blackSwan=true;
  const withShock=labelHistory(d.stock,d.sector,d.market);
  assert.equal(withShock[2].observed.find(o=>o?.horizon===3).containsShock,true);
  assert.deepEqual(withShock[2].signals,fires[0].signals);
  const split={trainingEnd:days[10],holdoutStart:days[11],embargoTradingDates:0};
  assert.ok(analyzeFactors(withShock,{horizon:3,minimum:1,split}).training.total<analyzeFactors(obs,{horizon:3,minimum:1,split}).training.total);
  const edited=applyCorrections(obs,[{id:obs[0].id,strategy:'龙头战法',reason:'事后核对',action:'add'}]);
  assert.ok(analyzeFactors(edited,{horizon:3,split}).trainingUsesRetrospectiveAnnotations);
});
test('both declared release and receipt gate the native archive price',()=>{
  const date=days[0];const b={...data().stock[0],role:'stock',source:'V6/t',priceBasis:'unadjusted',volumeUnit:'shares',knownAt:Date.parse(date+'T15:00:00+08:00'),availableAt:date+' 16:00'};
  assert.equal(syncedDataset({bars:[b]},Date.parse(date+'T15:59:00+08:00')).stocks.size,0);
  assert.equal(syncedDataset({bars:[b]},Date.parse(date+'T16:00:00+08:00')).stocks.size,1);
});
class El{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.value='';this.style={};this.files=[];}
  set textContent(v){this.text=String(v);this.children=[];}get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join('');}
  append(...items){for(const el of items){this.children.push(el);el.parentNode=this;}}
  replaceChildren(...items){this.children=[];this.text='';this.append(...items);}
  addEventListener(event,fn){(this.events[event]||=[]).push(fn);}
  setAttribute(k,v){this.attrs[k]=v;}
  async fire(event){for(const cb of this.events[event]||[])await cb({target:this});}
}
const find=(el,p)=>p(el)?el:el.children.map(c=>find(c,p)).find(Boolean);
test('GET and native-to-formal handoff use the research book and filters; a prior book response is discarded',async t=>{
  const previous={document:globalThis.document,Node:globalThis.Node};
  globalThis.Node=El;globalThis.document={createElement:k=>new El(k),createElementNS:(_,k)=>new El(k),createTextNode:v=>{const e=new El('text');e.textContent=v;return e;}};
  t.after(()=>{Object.assign(globalThis,previous);selectBook('main');});
  const book='book-0123456789abcdef';selectBook(book);sampleFor(book,'excludeBlackSwan');
  const requests=[],routes=[],callbacks=[],defers=[];
  const ctx={role:'edit',stock:'600000',signal:new AbortController().signal,onState:f=>callbacks.push(f),
    api:(p,o)=>{requests.push({p,o});return new Promise(r=>defers.push(r));},navigate:(...args)=>routes.push(args)};
  const page=renderKlineLearning(ctx);assert.equal(requests[0].o.headers['X-V6-Research-Book'],book);
  const cfg=find(page,e=>e.attrs['aria-label']==='按信号日期筛选');cfg.value=days[0];
  await find(page,e=>e.tag==='button'&&e.textContent==='打开当前账户正式回测').fire('click');
  assert.equal(routes[0][0],'lab');const [target,query]=routes[0][1].split('?');assert.equal(target,'shortline-backtest');
  const q=new URLSearchParams(query);assert.equal(q.get('date'),days[0]);assert.equal(q.get('sample'),'excludeBlackSwan');assert.equal(q.get('code'),'600000');
  selectBook('demo');callbacks.forEach(f=>f());assert.equal(requests[1].o.headers['X-V6-Research-Book'],'demo');
  const secret={...data().stock[0],name:'上个账户的样本',role:'stock',source:'V6/test',priceBasis:'unadjusted',volumeUnit:'shares',knownAt:Date.parse(days[0]+'T15:01+08:00')};
  defers[0]({ok:true,state:{book:{id:book},permissions:{role:'edit'},bars:[secret]}});
  defers[1]({ok:true,state:{book:{id:'main'},permissions:{role:'edit'},bars:[secret]}});
  await new Promise(r=>setImmediate(r));assert.doesNotMatch(page.textContent,/上个账户的样本/);assert.match(page.textContent,/无法读取私有档案/);
});
