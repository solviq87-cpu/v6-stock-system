'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evidence = import('../public/nova/market-evidence.js');
const overview = import('../public/nova/shortline/overview.mjs');
const at = (d, time='15:00') => Date.parse(d+'T'+time+':00+08:00');
const referenceDay = '2026-11-20', priorDay = '2026-11-19', now = at(referenceDay, '16:00');
const point = (value, date=priorDay) => ({value, date, source:'原始池', knownAt:at(date,'15:02')});

test('dated observations preserve a genuine zero and reject blank, impossible, unclassified or future observations', async () => {
  const {recoveredMetric} = await evidence;
  const recovery = {referenceDay, metrics:{upLimit:point(0),breakRate:point(101),dec:{...point(1),source:' '},adv:{...point(10),knownAt:now+1}},emotion:point('未判定')};
  assert.deepEqual(recoveredMetric(recovery,'upLimit',referenceDay,now),{...point(0),historical:true});
  for(const key of ['breakRate','dec','adv','emotion','height'])assert.equal(recoveredMetric(recovery,key,referenceDay,now),null);
  recovery.emotion={...point('分歧'),confidence:78};
  assert.equal(recoveredMetric(recovery,'emotion',referenceDay,now).date,priorDay);
  assert.equal(recoveredMetric(recovery,'upLimit','2026-11-18',now),null);
  assert.equal(recoveredMetric(recovery,'upLimit',priorDay,at(priorDay)),null);
});

test('partial observations remain scoped to their specific exchange and distinguish an unknown denominator from full coverage', async () => {
  const {observedCoverage,coverageValues,coverageCount} = await evidence;
  const valid={kind:'exchange',scope:'上交所主板',source:'交易所批次',day:priorDay,knownAt:at(priorDay,'16:00'),observed:7,adv:3,dec:0,flat:4,amountCny:123000000};
  const recovery={referenceDay,coverage:[valid,{...valid,day:'2026-11-18',observed:2,adv:1,flat:1},{...valid,scope:'无效数量',total:6},{...valid,scope:'无效统计',adv:6},{...valid,scope:'未来取得',knownAt:now+1}]};
  const rows=observedCoverage(recovery,referenceDay,now);
  assert.equal(rows.length,1); assert.equal(rows[0].scope,'上交所主板');
  assert.equal(rows[0].complete,false); assert.equal(coverageCount(rows[0]),'已核 7 只');
  assert.match(coverageValues(rows[0]),/上涨 3 家.*下跌 0 家.*1.23 亿元/);
  const full=observedCoverage({...recovery,coverage:[{...valid,total:7,complete:true}]},referenceDay,now);
  assert.equal(full[0].complete,true); assert.equal(coverageCount(full[0]),'已核 7 / 7 只');
});

test('one sector index return and the equally weighted member return have distinct meanings and sourced turnover labels',async()=>{
  const {observedCoverage,coverageValues,turnoverLabel}=await evidence;
  const common={source:'原始日K',day:priorDay,knownAt:now,complete:true,kind:'sector'};
  const index={...common,scope:'行业指数',observed:1,total:1,change:3.456,meanChange:88};
  const basket={...common,scope:'同日个股样本',observed:4,total:8,adv:2,dec:2,change:77,meanChange:-1.23};
  const rows=observedCoverage({referenceDay,coverage:[index,basket]},referenceDay,now);
  const rendered=Object.fromEntries(rows.map(r=>[r.scope,coverageValues(r)]));
  assert.match(rendered['行业指数'],/板块指数涨跌幅 \+3.46%/);assert.doesNotMatch(rendered['行业指数'],/均涨跌幅|88/);
  assert.match(rendered['同日个股样本'],/已核个股等权平均涨跌幅 -1.23%/);assert.doesNotMatch(rendered['同日个股样本'],/指数涨跌幅|77/);
  assert.equal(turnoverLabel({source:'市场收盘汇总'}),'成交额');assert.equal(turnoverLabel({source:'上海证券交易所'}),'成交额');
  assert.equal(turnoverLabel({scope:'沪深两市成交额',source:'原始来源'}),'沪深两市成交额');
  assert.equal(turnoverLabel({source:'分市场日统计（沪深两市）'}),'沪深两市成交额');
});

test('overview uses only dated field evidence and shows historical classification separately from the present hard rule',async()=>{
  const {overviewEvidence}=await overview;
  const state={market:[
    {date:priorDay,knownAt:at(priorDay,'14:55'),availableAt:priorDay+' 14:55',source:'当时原始源',upLimit:21},
    {date:referenceDay,source:'无接收记录',breakRate:99},
  ],marketRecovery:{referenceDay,metrics:{upLimit:point(22),amount:point(1234.56),cy:point('多头')},emotion:{...point('高潮'),confidence:82}}};
  const out=overviewEvidence(state,referenceDay,now);
  assert.equal(out.rule.stage,'未判定'); assert.equal(out.stage.value,'高潮'); assert.equal(out.stage.date,priorDay);
  assert.equal(out.metrics.upLimit.value,22); assert.equal(out.metrics.upLimit.historical,true);
  assert.equal(out.metrics.amount.source,'原始池');assert.equal(out.metrics.cy.value,'多头'); assert.equal(out.metrics.breakRate,undefined);
  const cutoff=overviewEvidence(state,priorDay,now);
  assert.equal(cutoff.metrics.upLimit.value,21);assert.equal(cutoff.metrics.upLimit.source,'当时原始源');
  assert.equal(cutoff.stage,null);assert.equal(cutoff.metrics.amount,undefined);
  const root={innerHTML:'',querySelector:s=>s==='[data-all]'?{}:null,querySelectorAll:()=>[]};
  const {renderOverview}=await overview;
  renderOverview({state:{market:[],checks:[],trades:[],notes:[],checkins:[]},date:referenceDay,root,esc:String});
  assert.doesNotMatch(root.innerHTML,/未判定|待判定|缺数据|市场炸板率|涨停家数|class="gauge"/);
});

test('drawer archived close only accepts a sourced, received daily bar for the selected stock',async()=>{
  const {archivedStockQuote}=await evidence;
  const bar={code:'600010',role:'stock',period:'日K',date:priorDay,source:'原日K供应商',knownAt:at(priorDay,'16:00'),close:9.11};
  const bars=[bar,{...bar,date:referenceDay,knownAt:now+1,close:20},{...bar,date:referenceDay,role:'index'},{...bar,code:'600011',close:3},{...bar,knownAt:null,close:8},{...bar,source:'',close:3},{...bar,date:referenceDay,period:'5分钟'}];
  assert.deepEqual(archivedStockQuote(bars,'600010',referenceDay,now),{value:9.11,date:priorDay,knownAt:bar.knownAt,source:'原日K供应商'});
  assert.equal(archivedStockQuote(bars,'600010',priorDay,at(priorDay)),null);
});

test('public market shows one collection entry with source outcomes and dated scoped values, even for read-only sessions',async()=>{
  const {renderPulse}=await import('../public/nova/market.js');
  class Element {
    constructor(tag){this.tag=tag;this.children=[];}
    get textContent(){return this.children.map(x=>x instanceof Element?x.textContent:x).join(' ');}
    append(...values){this.children.push(...values);}
    setAttribute(k,v){this[k]=v;}
    addEventListener(){}
  }
  const prevDocument=global.document, prevNode=global.Node, clock=Date.now;
  Date.now=()=>now;
  global.Node=Element;global.document={createElement:t=>new Element(t),createTextNode:s=>s};
  try{
    const route={sub:'market-overview'};
    const read=state=>renderPulse(route,{state,canEdit:false}).textContent;
    const empty=read({});
    assert.equal(empty.match(/行情来源与补采状态/g)?.length,1);
    assert.doesNotMatch(empty,/未判定|炸板率|价时点待核验|涨停家数/);
    const recovery={referenceDay,phase:'partial',lastAttemptAt:now,sources:[{name:'原始池',status:'available'},{name:'交易所批次',status:'retrying'}],
      metrics:{upLimit:point(13)}, coverage:[{scope:'深交所主板',source:'交易所批次',day:priorDay,observed:12,total:48,adv:4,dec:8,knownAt:now}]};
    const shown=read({marketRecovery:recovery});
    assert.match(shown,/上次有效 · 2026-11-19 · 原始池/);assert.match(shown,/深交所主板 · 已覆盖部分/);
    assert.match(shown,/上涨 4 家 · 下跌 8 家/);assert.match(shown,/已核 12 \/ 48 只 · 2026-11-19 · 交易所批次/);
    assert.match(shown,/最近尝试/);assert.match(shown,/交易所批次 · 等待重试/);assert.doesNotMatch(shown,/未判定/);
  }finally{global.Node=prevNode;global.document=prevDocument;Date.now=clock;}
});
