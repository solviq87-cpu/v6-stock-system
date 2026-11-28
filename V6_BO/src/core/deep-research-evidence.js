'use strict';

// Server-side, read-only evidence projections. Inputs come from the existing
// private archives/data centre; this module neither fetches nor writes a ledger.
const {createHash} = require('node:crypto');
const {quoteObservationView} = require('./quote-observation-view');
const {aShareCalendarDate} = require('./a-share-calendar');
const {evaluateAuctionEvidence} = require('../strategy/auction-evidence-rules');
const {classifyTitle} = require('../strategy/issuer-event-linkage');
const {scorecards} = require('./research-workspace-analytics');
const {validatePlan} = require('./paper-decision-plan');
const {SYSTEMS} = require('./independent-strategy-attribution');
const {createTradingCalendar} = require('./trading-calendar');
const {preEventComparison,eventRegimeOverlay} = require('./event-prewindow-research');
const {projectEventReview} = require('./event-path-review');
const {expectationBasis,eventWindowLifecycle,frozenIndustryReaction}=require('./catalyst-window-review');
const {trackEventCandidates}=require('./event-candidate-tracking');
const {levelOneReview,microstructureReview,summarizeMicrostructureSessions} = require('./microstructure-evidence-review');

const LIMIT = 10000;
const FLAGS = Object.freeze({researchOnly:true, canTrade:false, canNotify:false,
  accountWrites:false, productionWeightsChanged:false, autoPromotion:false, verifiedLive:false});
const EVENT_TYPES = new Set(['buyback','merger','contract','reduction','earnings','policy','other']);
const SESSIONS = Object.freeze([
  {id:'premarket',label:'盘前'}, {id:'auction',label:'集合竞价'}, {id:'opening',label:'开盘'},
  {id:'morning',label:'上午'}, {id:'afternoon',label:'午后'}, {id:'closing',label:'尾盘'}, {id:'overnight',label:'隔夜'}
]);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const time = x => Number.isSafeInteger(x) && x > 0 && x < 8e15;
const text = (x, n=180) => typeof x === 'string' && x.trim().length > 0 && x.length <= n && !/[\x00-\x1f\x7f]/.test(x);
const symbol = x => typeof x === 'string' && /^\d{6}$/.test(x);
const date = x => typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const round = x => finite(x) ? Number(x.toFixed(6)) : null;
const mean = xs => xs.length ? xs.reduce((s,x) => s+x,0)/xs.length : null;
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ?
  Object.fromEntries(Object.keys(x).sort().map(k => [k,canonical(x[k])])) : x;
const hash = x => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const nativeHash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isHash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fake = x => /(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(x || ''));
const array = (value, name, max=LIMIT) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw Error(name+' 超出有界研究输入范围');
  return value;
};
function clock(options={}) {
  const at = options.asOf ?? options.now ?? Date.now();
  if (!time(at)) throw Error('深度研究时点无效');
  return at;
}
function url(value) {
  try { const u = new URL(value); return text(value,2048) && ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
function provenance(row, asOf) {
  if (!row || typeof row !== 'object' || !text(row.id) || !text(row.source,160) || fake(row.source) ||
      row.synthetic === true || row.fixture === true || ['test','demo','synthetic'].includes(row.sampleSet) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 1000000 ||
      ![row.publishedAt,row.firstKnownAt,row.recordedAt].every(time) ||
      row.publishedAt > row.firstKnownAt || row.firstKnownAt > row.recordedAt || row.recordedAt > asOf ||
      !(url(row.sourceUrl) || text(row.evidenceId,256))) return null;
  return {id:row.id,revision:row.revision,source:row.source,sourceUrl:url(row.sourceUrl),
    evidenceId:text(row.evidenceId,256)?row.evidenceId:null,publishedAt:row.publishedAt,
    firstKnownAt:row.firstKnownAt,recordedAt:row.recordedAt,sourceCertification:'declared-unverified'};
}
// Future revisions are invisible, including their rejection counters. A conflict
// in one visible revision quarantines that identity instead of picking input order.
function versions(input, asOf, name, max=LIMIT) {
  const selected = new Map(), revisions = new Map(), blocked = new Set(), rejected = [];
  for (const row of array(input,name,max)) {
    if (time(row?.recordedAt) && row.recordedAt > asOf) continue;
    const proof = provenance(row,asOf);
    if (!proof) {
      rejected.push({id:text(row?.id)?row.id:null,reason:'missing-or-invalid-source-time'});
      // A visible correction/retraction with unknown source timing must not
      // silently resurrect the superseded original as the current evidence.
      if(text(row?.id)&&text(row?.source,160))blocked.add(row.source+'\n'+row.id);
      continue;
    }
    const key = row.source+'\n'+row.id, versionKey = key+'\n'+row.revision;
    const prior = revisions.get(versionKey);
    if (prior && hash(prior) !== hash(row)) { blocked.add(key); rejected.push({id:row.id,reason:'conflicting-revision'}); continue; }
    revisions.set(versionKey,row);
  }
  const grouped = new Map();
  for (const row of revisions.values()) {
    const key=row.source+'\n'+row.id, group=grouped.get(key)||[];
    group.push(row); grouped.set(key,group);
  }
  for (const [key,group] of grouped) {
    if (blocked.has(key)) continue;
    group.sort((a,b)=>a.revision-b.revision);
    if (group.some((r,i)=>i && (r.firstKnownAt<group[i-1].firstKnownAt || r.recordedAt<group[i-1].recordedAt))) {
      rejected.push({id:group[0].id,reason:'revision-clock-reversal'}); continue;
    }
    selected.set(key,group.at(-1));
  }
  return {rows:[...selected.values()].sort((a,b)=>a.recordedAt-b.recordedAt || a.source.localeCompare(b.source) || a.id.localeCompare(b.id)),rejected};
}
function result(task, rows, missing=[], extra={}) {
  return {task,status:rows.length?'observed-research':'unknown',rows,missing:[...new Set(missing)],riskObservations:[],...extra,...FLAGS};
}
function risk(kind, target, evidence, trigger, release, asOf, level=1) {
  return {id:hash([kind,target,evidence]).slice(0,24),kind,target,level,
    stage:['','风险苗头','风险积累','风险触发','紧急防御'][level],observedAt:asOf,
    evidence,triggerCondition:trigger,releaseCondition:release,
    currentRestriction:'研究观察；执行资格及限制仍由原后台风控决定',isTradeInstruction:false,...FLAGS};
}
function priceOutcome(row, asOf) {
  const proof=provenance(row,asOf), s=row?.stock, b=row?.benchmark;
  if (!proof || !symbol(row.symbol) || !Number.isSafeInteger(row.horizonSessions) || row.horizonSessions<1 || row.horizonSessions>250 ||
      !time(row.startAt) || !time(row.endAt) || row.endAt<=row.startAt || row.endAt>row.firstKnownAt ||
      !s || ![s.startPrice,s.endPrice].every(x=>finite(x)&&x>0) || s.currency!=='CNY' ||
      s.priceBasis!=='unadjusted' || s.corporateAction!==false) return null;
  const gross=100*(s.endPrice/s.startPrice-1);
  if (!finite(gross)) return null;
  const matched=!!b && text(b.symbol) && text(b.source,160) && !fake(b.source) &&
    b.startAt===row.startAt && b.endAt===row.endAt && b.currency===s.currency && b.priceBasis===s.priceBasis &&
    time(b.knownAt)&&b.knownAt>=row.endAt&&b.knownAt<=row.firstKnownAt&&
    [b.startPrice,b.endPrice].every(x=>finite(x)&&x>0)&&finite(100*(b.endPrice/b.startPrice-1));
  const benchmark=matched?100*(b.endPrice/b.startPrice-1):null;
  return {proof,stockReturnPct:round(gross),benchmarkReturnPct:round(benchmark),
    excessReturnPct:benchmark===null?null:round(gross-benchmark),benchmarkStatus:matched?'matched-interval':'unknown',
    benchmark:matched?{symbol:b.symbol,source:b.source,startAt:b.startAt,endAt:b.endAt,knownAt:b.knownAt,
      startPrice:b.startPrice,endPrice:b.endPrice,currency:b.currency,priceBasis:b.priceBasis,
      evidence:row.inputOrigin==='read-only-archive-projection'?b.evidence:null}:null};
}

const EVENT_HORIZONS=Object.freeze([1,5,20,60]);
// This consumes the existing raw daily archive and its received all-A index
// bundles. It never infers a session calendar from the observed price rows.
// Daily outcomes are endpoint price studies, not executable intraday returns.
function deriveEventOutcomes({events=[],archive={},calendar,workspaceEvents=[]}={}, options={}) {
  const asOf=clock(options),visible=versions(events,asOf,'事件').rows.filter(e=>symbol(e.symbol)&&e.retracted!==true);
  const selected=visible.slice(-100),pending=[],eventOutcomes=[];
  let windowLifecycle=selected.map(event=>eventWindowLifecycle({event,asOf}));
  const policy={version:'event-next-open-fixed-horizons-v1',horizons:EVENT_HORIZONS,
    entry:'first-calendar-session-open-after-event-recorded',exit:'horizon-session-close',
    scope:'latest-100-known-event-versions',executableReturn:false};
  const fail=(e,horizon,reason,source=null)=>pending.push({eventId:e.id,eventRevision:e.revision,symbol:e.symbol,horizonSessions:horizon,source,status:'pending',reason});
  if(!selected.length)return {eventOutcomes,pending,policy,windowLifecycle,status:'pending',truncatedEvents:0};
  if(!archive||archive.scope==='demo'||archive.synthetic===true||archive.fixture===true||['test','demo','synthetic'].includes(archive.sampleSet)){
    for(const e of selected)for(const h of EVENT_HORIZONS)fail(e,h,'原真实短线档案不可用');
    return {eventOutcomes,pending,policy,windowLifecycle,status:'pending',truncatedEvents:Math.max(0,visible.length-selected.length)};
  }
  let dates=null,calendarAt=null,calendarHash=null,calendarExchanges=[];
  try{
    const c=calendar||archive.tradingCalendar;
    if(c?.status!=='available'||!c.calendar||!text(c.metadata?.source,300)||!isHash(c.metadata?.sha256))throw Error();
    createTradingCalendar(c.calendar);
    calendarAt=typeof c.metadata.knowledgeAvailableAt==='string'?Date.parse(c.metadata.knowledgeAvailableAt):null;
    if(!time(calendarAt)||calendarAt>asOf)throw Error();
    dates=c.calendar.sessions.filter(s=>s.open).map(s=>s.date).sort();
    if(!Array.isArray(c.tradeDates)||hash(dates)!==hash(c.tradeDates)||c.calendar.source!==c.metadata.source)throw Error();
    calendarHash=c.metadata.sha256;
    calendarExchanges=Array.isArray(c.metadata.supportedExchanges)?c.metadata.supportedExchanges:[c.calendar.exchange];
  }catch{dates=null;}
  if(!dates){
    for(const e of selected)for(const h of EVENT_HORIZONS)fail(e,h,'缺少带首次观察时点的完整原交易日历');
    return {eventOutcomes,pending,policy,windowLifecycle,status:'pending',truncatedEvents:Math.max(0,visible.length-selected.length)};
  }
  const exchangeOf=s=>/^(4|8|92)/.test(s)?'BSE':/^[569]/.test(s)?'SSE':/^[023]/.test(s)?'SZSE':null;
  windowLifecycle=selected.map(event=>eventWindowLifecycle({event,asOf,...(calendarExchanges.includes(exchangeOf(event.symbol))?{dates,calendarKnownAt:calendarAt,calendarHash}:{})}));
  const closeOf=d=>Date.parse(d+'T15:00:00+08:00'),openOf=d=>Date.parse(d+'T09:30:00+08:00');
  const prices=new Map(),indices=new Map(),conflicts=new Set(),industryWorkBudget={remaining:100000};
  function retain(map,key,b){
    const prior=map.get(key);
    if(prior&&prior.knownAt===b.knownAt&&hash(prior)!==hash(b)){conflicts.add(key);return;}
    if(!prior||b.knownAt>prior.knownAt)map.set(key,b);
  }
  for(const b of array(archive.bars,'原日线档案',100000)){
    if(b?.role!=='stock'||!symbol(b.code)||!date(b.date)||!['日K','1d'].includes(b.period)||b.priceBasis!=='unadjusted'||
      !text(b.source,160)||fake(b.source)||b.synthetic===true||b.fixture===true||['test','demo','synthetic'].includes(b.sampleSet)||
      !time(b.knownAt)||b.knownAt>asOf||b.knownAt<closeOf(b.date)||
      !['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.low,b.close)||b.low>Math.min(b.open,b.close))continue;
    retain(prices,['stock',b.code,b.source,b.date].join('|'),b);
  }
  for(const m of [...array(archive.marketHistory,'原盘面版本',10000),...array(archive.market,'原盘面档案',10000)]){
    const e=m?.indexEvidence;
    if(!e||e.name!=='中证全指'||!text(e.source,160)||fake(e.source)||!time(e.receivedAt)||e.receivedAt>asOf||
      e.priceBasis!==undefined&&e.priceBasis!=='unadjusted'||m.synthetic===true||m.fixture===true||e.synthetic===true||e.fixture===true||
      ['test','demo','synthetic'].includes(m.sampleSet)||['test','demo','synthetic'].includes(e.sampleSet))continue;
    for(const b of array(e.rows,'原全A指数日线',2000)){
      // A bundle receipt is the actual first archive availability of its rows,
      // not today's query time or a backfilled date-only publication guess.
      const knownAt=b?.knownAt===undefined?e.receivedAt:b.knownAt;
      if(!date(b?.date)||b.synthetic===true||b.fixture===true||['test','demo','synthetic'].includes(b.sampleSet)||
        !time(knownAt)||knownAt>e.receivedAt||knownAt<closeOf(b.date)||
        !finite(b.open)||b.open<=0||!finite(b.close)||b.close<=0)continue;
      retain(indices,['index',e.source,b.date].join('|'),{date:b.date,open:b.open,close:b.close,source:e.source,knownAt,receivedAt:e.receivedAt});
    }
  }
  for(const key of conflicts){prices.delete(key);indices.delete(key);}
  const stockSources=new Map();for(const b of prices.values()){const sources=stockSources.get(b.code)||new Set();sources.add(b.source);stockSources.set(b.code,sources);}
  const indexSources=[...new Set([...indices.values()].map(b=>b.source))].sort();
  for(const e of selected){
    const start=dates.findIndex(d=>openOf(d)>e.recordedAt),sources=[...(stockSources.get(e.symbol)||[])].sort().slice(0,4);
    // The original calendar reader's six-digit exchange families. A bundled
    // SSE/SZSE calendar supplies no evidence for a BSE event window.
    const exchange=exchangeOf(e.symbol);
    if(!exchange||!calendarExchanges.includes(exchange)){for(const h of EVENT_HORIZONS)fail(e,h,'原交易日历未证实覆盖该证券交易所');continue;}
    if(calendarAt>e.recordedAt){for(const h of EVENT_HORIZONS)fail(e,h,'交易日历在事件之后才可知，不倒填事前窗口');continue;}
    if(start<0){for(const h of EVENT_HORIZONS)fail(e,h,'事件之后的交易日历覆盖不足');continue;}
    if(!sources.length){for(const h of EVENT_HORIZONS)fail(e,h,'缺少带原来源及实际knownAt的未复权股票日线');continue;}
    for(const source of sources)for(const h of EVENT_HORIZONS){
      const end=start+h-1,window=dates.slice(start,end+1),startDate=dates[start],endDate=dates[end];
      if(!endDate||window.length!==h||closeOf(endDate)>asOf){fail(e,h,'固定观察窗口尚未成熟或日历覆盖不足',source);continue;}
      const bars=window.map(d=>prices.get(['stock',e.symbol,source,d].join('|')));
      if(bars.some(b=>!b)){fail(e,h,'同源股票窗口缺日、来源冲突或结果尚未实际取得',source);continue;}
      if(bars.some(b=>b.corporateAction!==false||b.corporateActionKnownAt!==undefined&&
          (!time(b.corporateActionKnownAt)||b.corporateActionKnownAt>asOf))){
        fail(e,h,'窗口内公司行为状态缺失或存在除权分红，不能用未复权端点冒充收益',source);continue;
      }
      const first=bars[0],last=bars.at(-1),startAt=openOf(startDate),endAt=closeOf(endDate);
      let benchmark=null;
      for(const indexSource of indexSources){
        const bi=indices.get(['index',indexSource,startDate].join('|')),be=indices.get(['index',indexSource,endDate].join('|'));
        if(!bi||!be)continue;
        benchmark={symbol:'000985',source:indexSource,startAt,endAt,startPrice:bi.open,endPrice:be.close,
          currency:'CNY',priceBasis:'unadjusted',knownAt:Math.max(bi.knownAt,be.knownAt),
          evidence:{start:bi,end:be,meaning:'原中证全指同区间开盘到收盘'}};break;
      }
      const priceEvidence=bars.map(b=>({date:b.date,source:b.source,knownAt:b.knownAt,open:b.open,close:b.close,
        corporateAction:b.corporateAction,corporateActionKnownAt:b.corporateActionKnownAt??b.knownAt}));
      const preEventStudy=preEventComparison({event:e,dates,horizon:h,stockSource:source,indexSource:benchmark?.source??null,calendarKnownAt:calendarAt,calendarHash,
        readStock:d=>prices.get(['stock',e.symbol,source,d].join('|')),readIndex:d=>indices.get(['index',benchmark?.source,d].join('|'))});
      const regimeOverlay=h===1?eventRegimeOverlay({event:e,dates,indexSource:benchmark?.source??null,calendarKnownAt:calendarAt,calendarHash,asOf,
        readIndex:d=>indices.get(['index',benchmark?.source,d].join('|'))}):null;
      const industryReaction=frozenIndustryReaction({event:e,dates,horizon:h,stockSource:source,indexSource:benchmark?.source??null,calendarKnownAt:calendarAt,calendarHash,asOf,workspaceEvents,workBudget:industryWorkBudget,
        readStock:(symbol,d)=>prices.get(['stock',symbol,source,d].join('|')),readIndex:d=>indices.get(['index',benchmark?.source,d].join('|'))});
      const id=hash({event:[e.source,e.id,e.revision],source,h,priceEvidence,benchmark,calendarHash});
      eventOutcomes.push({id:'archive-'+id,revision:1,source:'v6-private-archive-event-study',evidenceId:id,
        // This is a newly produced read projection. Original source receipts
        // live in priceEvidence/benchmark and are never replaced with asOf.
        publishedAt:asOf,firstKnownAt:asOf,recordedAt:asOf,inputOrigin:'read-only-archive-projection',
        eventId:e.id,eventSource:e.source,eventRevision:e.revision,symbol:e.symbol,horizonSessions:h,startAt,endAt,
        stock:{source,startPrice:first.open,endPrice:last.close,currency:'CNY',priceBasis:'unadjusted',corporateAction:false},
        benchmark,priceEvidence,calendarEvidence:{hash:calendarHash,knownAt:calendarAt},policyVersion:policy.version,preEventStudy,regimeOverlay,industryReaction});
      if(!benchmark)fail(e,h,'股票端点已成熟，但缺少同区间实际接收的全A指数，超额收益保持未知',source);
    }
  }
  return {eventOutcomes,pending,policy,windowLifecycle,status:eventOutcomes.length?'derived-research':'pending',truncatedEvents:Math.max(0,visible.length-selected.length)};
}

function buildEventImpactStudy(input={}, options={}) {
  const asOf=clock(options), ev=versions(input.events,asOf,'事件'), outcomes=versions(input.eventOutcomes,asOf,'事件结果');
  const events=ev.rows.map(e=>({...provenance(e,asOf),symbol:symbol(e.symbol)?e.symbol:null,
    eventType:EVENT_TYPES.has(e.eventType)?e.eventType:'other',title:text(e.title,1000)?e.title:null,
    titleClue:classifyTitle(String(e.title||'')),eventTypeStatus:e.eventTypeStatus||'source-declared',
    bodyScope:e.bodyScope||'unknown',retracted:e.retracted===true}));
  const rows=[], rejected=[...ev.rejected,...outcomes.rejected], missing=[];
  const eventIndex=new Map();
  for(const e of events){const key=[e.id,e.revision,e.symbol].join('|'),list=eventIndex.get(key)||[];list.push(e);eventIndex.set(key,list);}
  for (const o of outcomes.rows) {
    const matches=(eventIndex.get([o.eventId,o.eventRevision,o.symbol].join('|'))||[]).filter(e=>!o.eventSource||o.eventSource===e.source);
    const e=matches.length===1?matches[0]:null, computed=priceOutcome(o,asOf);
    if (!e || e.retracted || !computed || o.startAt<e.recordedAt) {
      rejected.push({id:o.id,reason:!e?'event-version-unavailable':e.retracted?'event-retracted':!computed?'invalid-or-immature-outcome':'entry-before-event-known'}); continue;
    }
    const derived=options.derivedOutcomes instanceof Map?options.derivedOutcomes.get(o.id):null;
    const bound=derived===o?derived:null;
    if (computed.benchmarkReturnPct===null) missing.push('同区间、币种和价格口径的市场基准缺失，超额收益保持未知');
    rows.push({id:o.id,eventId:e.id,eventRevision:e.revision,symbol:o.symbol,eventType:e.eventType,
      horizonSessions:o.horizonSessions,startAt:o.startAt,endAt:o.endAt,regime:text(o.regime,80)?o.regime:'unknown',
      ...computed,failure:computed.excessReturnPct===null?null:computed.excessReturnPct<=0,
      priceSource:text(o.stock.source,160)?o.stock.source:o.source,
      evidence:[e,computed.proof],priceEvidence:o.inputOrigin==='read-only-archive-projection'?o.priceEvidence:null,
      calendarEvidence:o.inputOrigin==='read-only-archive-projection'?o.calendarEvidence:null,
      preEventStudy:bound?.preEventStudy??null,regimeOverlay:bound?.regimeOverlay??null,industryReaction:bound?.industryReaction??null,drawdownPct:null});
  }
  rows.sort((a,b)=>a.startAt-b.startAt||a.eventId.localeCompare(b.eventId)||a.horizonSessions-b.horizonSessions||
    a.priceSource.localeCompare(b.priceSource)||a.id.localeCompare(b.id));
  const groups=new Map();
  for (const row of rows) {
    const key=[row.eventType,row.regime,row.horizonSessions,row.priceSource].join('|'), g=groups.get(key)||[];g.push(row);groups.set(key,g);
  }
  const summaries=[...groups.values()].map(g=>({eventType:g[0].eventType,regime:g[0].regime,horizonSessions:g[0].horizonSessions,priceSource:g[0].priceSource,
    samples:g.length,independentEvents:new Set(g.map(x=>x.eventId+'|'+x.eventRevision)).size,
    independentDates:new Set(g.map(x=>aShareCalendarDate(x.startAt))).size,
    averagePriceReturnPct:round(mean(g.map(x=>x.stockReturnPct))),benchmarkMatched:g.filter(x=>x.excessReturnPct!==null).length,
    averageExcessReturnPct:round(mean(g.map(x=>x.excessReturnPct).filter(finite))),
    failureCases:g.filter(x=>x.failure===true).map(x=>({id:x.id,symbol:x.symbol,excessReturnPct:x.excessReturnPct,evidence:x.evidence})),
    worstExcessReturnPct:g.some(x=>finite(x.excessReturnPct))?Math.min(...g.map(x=>x.excessReturnPct).filter(finite)):null,
    status:new Set(g.map(x=>x.eventId+'|'+x.eventRevision)).size>=30&&new Set(g.map(x=>aShareCalendarDate(x.startAt))).size>=10?
      'descriptive-only':'insufficient-independent-samples',minimumIndependentEvents:30,minimumIndependentDates:10,inferenceCertified:false}));
  if (!events.length) missing.push('缺少带真实来源、首次可知时间和修订版本的事件');
  if (!rows.length) missing.push('缺少已成熟、与事件可知时点对应的价格结果');
  return result(67,rows,missing,{events,groups:summaries,rejected,
    durationProfile:summaries.map(g=>({eventType:g.eventType,regime:g.regime,horizonSessions:g.horizonSessions,samples:g.samples,averageExcessReturnPct:g.averageExcessReturnPct})),
    limitations:['市场调整差额只作描述，不能单独证明事件的因果贡献','各观察周期全部保留；不按事后最佳收益挑选影响持续期','端点收益不能证明期间最大回撤或可成交净收益','事前固定窗口仅为未独立验证的全市场调整伪事件对照，不是预注册试验或行业匹配；净异常收益及置信区间未知']});
}

// Keep the first disclosed financial value separate from a restatement. The
// existing declaration reader supplies identity and chronology checks. A later
// revision, or a same-code event without the exact first-revision reference,
// cannot supply the first disclosure's historical outcome.
function firstDisclosureReview(a,raw,events,derived,asOf){
  const base={status:'unknown',first:null,latest:provenance(a,asOf),latestValue:a.value,mediumTerm:[],canTrade:false,canNotify:false,actualExecutionVerified:false};
  const matches=raw.filter(r=>r?.source===a.source&&r.id===a.id&&r.revision===1&&provenance(r,asOf));
  const originals=[...new Map(matches.map(r=>[hash(r),r])).values()],f=originals[0];
  if(originals.length!==1||f.retracted===true||f.publishedAt!==a.announcementAt||!finite(f.value)||!['symbol','period','metric','unit','announcementAt'].every(k=>f[k]===a[k]))return base;
  const first={...provenance(f,asOf),value:f.value,announcementAt:f.announcementAt};
  const event=f.eventRef,key=event&&JSON.stringify([event.source,event.id,event.revision,f.symbol]),e=key?events.get(key):null;
  const bound=e&&e.retracted!==true&&e.eventType==='earnings'&&e.publishedAt===f.announcementAt&&e.recordedAt<=f.recordedAt&&e.revision===1;
  const mediumTerm=bound?derived.filter(o=>o.eventSource===e.source&&o.eventId===e.id&&o.eventRevision===e.revision&&o.symbol===f.symbol&&[20,60].includes(o.horizonSessions)&&o.startAt>f.recordedAt&&priceOutcome(o,asOf)).map(o=>{
    const r=priceOutcome(o,asOf);return {id:o.id,horizonSessions:o.horizonSessions,startAt:o.startAt,endAt:o.endAt,priceSource:o.stock.source,stockReturnPct:r.stockReturnPct,benchmarkReturnPct:r.benchmarkReturnPct,excessReturnPct:r.excessReturnPct,evidence:r.proof};
  }):[];
  return {...base,status:'declared-first-disclosure',first,restated:a.revision!==f.revision,mediumTerm,mediumTermStatus:mediumTerm.length?'descriptive-unverified':'unknown-first-event-or-mature-window',firstEvent:bound?provenance(e,asOf):null};
}
function buildExpectationStudy(input={}, options={}) {
  const asOf=clock(options), actuals=versions(input.actuals,asOf,'业绩实际值',500), rows=[], missing=[], rejected=[...actuals.rejected];
  const rawActuals=array(input.actuals,'业绩实际值',500);
  const firstEventIndex=new Map(versions(input.events,asOf,'财报关联事件').rows.map(e=>[JSON.stringify([e.source,e.id,e.revision,e.symbol]),e]));
  const derived=Array.isArray(options.derivedOutcomes)?options.derivedOutcomes:[];
  for (const a of actuals.rows) {
    if(a.retracted===true)continue;
    if (!symbol(a.symbol) || !text(a.period,80) || !text(a.metric,80) || !text(a.unit,60) || !finite(a.value) ||
        !time(a.announcementAt) || a.announcementAt>a.publishedAt) { rejected.push({id:a.id,reason:'actual-definition-or-announcement-time-missing'}); continue; }
    if(rawActuals.some(r=>r?.source===a.source&&r.id===a.id&&provenance(r,asOf)&&
      ['symbol','period','metric','unit','announcementAt'].some(k=>r[k]!==a[k]))){
      rejected.push({id:a.id,reason:'actual-identity-or-original-announcement-rewritten'});continue;
    }
    const firstDisclosure=firstDisclosureReview(a,rawActuals,firstEventIndex,derived,asOf);
    // Freeze the expectation strictly before the ORIGINAL announcement, even
    // when the actual financial result has subsequently been revised.
    const selected=versions(input.expectations,a.announcementAt-1,'事前预期',2000);
    const expectations=selected.rows.filter(e=>e.symbol===a.symbol&&e.period===a.period&&e.metric===a.metric&&e.unit===a.unit&&
      e.retracted!==true&&['consensus','company-guidance','analyst-estimate'].includes(e.expectationKind)&&finite(e.value)&&
      (e.expectationKind!=='consensus'||Number.isSafeInteger(e.sampleSize)&&e.sampleSize>=1));
    if (!expectations.length) {
      rows.push({id:a.id,symbol:a.symbol,period:a.period,metric:a.metric,unit:a.unit,actual:a.value,
        expected:null,surprise:null,surprisePct:null,classification:'unknown',priceReaction:null,firstDisclosure,expectationBasis:expectationBasis(a,null),
        evidence:[provenance(a,asOf)],missing:['没有真实且严格早于原始公告的同口径预期']});continue;
    }
    for (const e of expectations) {
      const delta=a.value-e.value, sign=typeof a.higherIsBetter==='boolean'?Math.sign(delta)*(a.higherIsBetter?1:-1):null;
      const reaction=a.priceReaction, rp=provenance(reaction,asOf);
      const validReaction=rp&&reaction.symbol===a.symbol&&reaction.retracted!==true&&time(reaction.startAt)&&time(reaction.endAt)&&reaction.startAt>=a.announcementAt&&
        reaction.endAt>reaction.startAt&&reaction.endAt<=reaction.firstKnownAt&&
        [reaction.startPrice,reaction.endPrice].every(x=>finite(x)&&x>0)&&finite(100*(reaction.endPrice/reaction.startPrice-1))&&reaction.priceBasis==='unadjusted'&&reaction.corporateAction===false;
      const priceReaction=validReaction?{returnPct:round(100*(reaction.endPrice/reaction.startPrice-1)),startAt:reaction.startAt,endAt:reaction.endAt,evidence:rp}:null;
      rows.push({id:a.id+'|'+e.source+'|'+e.id,symbol:a.symbol,period:a.period,metric:a.metric,unit:a.unit,
        expectationKind:e.expectationKind,actual:a.value,expected:e.value,surprise:round(delta),firstDisclosure,expectationBasis:expectationBasis(a,e),
        surprisePct:e.value===0?null:round(delta/Math.abs(e.value)*100),
        classification:sign===null?'direction-unknown':sign>0?'above-expectation':sign<0?'below-expectation':'in-line',
        priceReaction,priceResponseCase:!priceReaction||sign===null?'unknown':sign>0&&priceReaction.returnPct<0?'positive-surprise-negative-response':
          sign<0&&priceReaction.returnPct>0?'negative-surprise-positive-response':'other-observed-response',
        evidence:[provenance(e,a.announcementAt-1),provenance(a,asOf)],
        missing:[...(e.value===0?['预期值为零，不计算百分比预期差']:[]),...(!priceReaction?['缺少同事件成熟价格反应']:[])]});
    }
  }
  if (!rows.length) missing.push('缺少具备来源、原始公告时点和数值口径的实际业绩');
  if (rows.some(x=>x.expected===null)) missing.push('部分实际业绩没有可信事前预期，保持未知');
  return result(68,rows,missing,{rejected,limitations:['不同来源预期分别展示，不自动拼接为市场共识','价格反应与预期差的组合是研究分类，不证明利好兑现或利空出尽的因果关系']});
}

function accountProjection(account, asOf) {
  const empty={status:'unknown',accountId:null,positions:[],totalMarketValue:null,equity:null,missing:['缺少原权威账户快照']};
  if (!account || account.source!=='v6-authoritative-ledger' || !text(account.accountId,120) || !time(account.sourceAt) ||
      account.sourceAt>asOf || asOf-account.sourceAt>15000 || !Array.isArray(account.positions) || account.positions.length>1000) return empty;
  const seen=new Set(), positions=[];
  for (const p of account.positions) {
    if (!symbol(p?.symbol)||seen.has(p.symbol)||!Number.isSafeInteger(p.shares)||p.shares<=0) return {...empty,missing:['原账户持仓身份或数量无效']};
    seen.add(p.symbol);
    const q=quoteObservationView(p.quote,asOf), valid=q.quoteStatus==='recent-unverified'&&q.missingReason===null&&
      aShareCalendarDate(q.quoteAt)===aShareCalendarDate(asOf)&&!fake(p.quote?.quoteSource)&&
      !['synthetic','fixture','simulated','mock'].some(k=>p.quote?.[k]===true);
    positions.push({symbol:p.symbol,shares:p.shares,marketValue:valid?round(p.shares*p.quote.price):null,quote:q});
  }
  const complete=positions.every(p=>p.marketValue!==null), total=complete?positions.reduce((s,p)=>s+p.marketValue,0):null;
  const equity=finite(account.equity)&&account.equity>0&&total!==null&&account.equity>=total?account.equity:null;
  return {status:complete?'observed-account':'incomplete-valuation',accountId:account.accountId,positions,
    sourceAt:account.sourceAt,totalMarketValue:round(total),equity,
    missing:complete?[]:['部分原持仓缺少15秒内同日真实报价，全部比例保持未知']};
}
function exposure(symbols, account) {
  const held=account.positions.filter(p=>symbols.includes(p.symbol)), known=account.totalMarketValue!==null;
  const value=known?held.reduce((s,p)=>s+p.marketValue,0):null;
  return {accountId:account.accountId,symbols:held.map(p=>p.symbol),marketValue:round(value),
    weightOfHoldingsPct:known&&account.totalMarketValue>0?round(value/account.totalMarketValue*100):null,
    weightOfAccountPct:known&&account.equity>0?round(value/account.equity*100):null};
}
function buildRelationshipGraph(input={}, options={}) {
  const asOf=clock(options), selected=versions(input.relations,asOf,'关系证据',2000), rows=[], rejected=[...selected.rejected];
  for (const r of selected.rows) {
    if (r.retracted===true) continue;
    if (!text(r.from)||!text(r.to)||r.from===r.to||!text(r.relation,80)||!['business','indirect','concept'].includes(r.relationClass)||
        !time(r.validFrom)||(r.validUntil!==null&&r.validUntil!==undefined&&(!time(r.validUntil)||r.validUntil<=r.validFrom))) {
      rejected.push({id:r.id,reason:'invalid-relation-or-effective-interval'});continue;
    }
    if (r.validFrom>asOf || time(r.validUntil)&&r.validUntil<=asOf) continue;
    if (r.relationClass==='business'&&r.bodyScope!=='declared-body') {rejected.push({id:r.id,reason:'business-relation-needs-public-document-body'});continue;}
    rows.push({id:r.id,from:r.from,to:r.to,relation:r.relation,relationClass:r.relationClass,
      validFrom:r.validFrom,validUntil:r.validUntil??null,evidence:provenance(r,asOf)});
  }
  const nodes=[...new Set(rows.flatMap(r=>[r.from,r.to]))].sort().map(id=>({id,type:symbol(id)?'security':'entity'}));
  const account=accountProjection(input.account,asOf), shared=new Map();
  for (const r of rows) for (const [stock,entity] of [[r.from,r.to],[r.to,r.from]]) if (symbol(stock)) {
    const key=r.relationClass+'|'+entity, group=shared.get(key)||{entity,relationClass:r.relationClass,symbols:new Set(),evidence:[]};
    group.symbols.add(stock);group.evidence.push(r.evidence);shared.set(key,group);
  }
  const commonExposures=[...shared.values()].filter(g=>g.symbols.size>=2).map(g=>({...g,symbols:[...g.symbols].sort(),
    holdingExposure:exposure([...g.symbols],account)}));
  const eventExposure=[];
  for (const e of versions(input.events,asOf,'事件').rows) {
    if (e.retracted===true) continue;
    for (const entity of array(e.entityIds,'事件实体',100)) {
      if (!text(entity)) continue;
      const paths=rows.filter(r=>(r.from===entity||r.to===entity)&&r.evidence.recordedAt<=e.recordedAt&&
        r.validFrom<=e.recordedAt&&(!time(r.validUntil)||r.validUntil>e.recordedAt)).map(r=>({symbol:symbol(r.from)?r.from:symbol(r.to)?r.to:null,
        relationClass:r.relationClass,relationId:r.id,evidence:r.evidence})).filter(r=>r.symbol);
      if (paths.length) eventExposure.push({eventId:e.id,entity,paths,eventEvidence:provenance(e,asOf),impactDirection:'unknown'});
    }
  }
  return result(69,rows,rows.length?[]:['缺少带有效期和原始来源的关系；旧概念映射不作为业务关系'],
    {nodes,commonExposures,eventExposure,account,rejected,
      limitations:['业务、间接和概念关系分开保留；相同题材不证明真实业务','共同关联只表示潜在共同风险暴露，不推断价格方向','持仓主题交叉，比例不可直接相加']});
}

// This is a declared research entitlement, not external authentication. A
// catalogue entry or a plain quote adapter cannot establish Level-2 access.
function depthRouteAllowsResearch(row) {
  try {
    const {sourceLineage,validateRegistry}=require('./data-source-lineage');
    validateRegistry();
    const route=sourceLineage(row.source.trim().toLowerCase());
    if (!route) return false;
    if (!route.known) return true; // legacy operator-imported evidence; still unverified
    return !route.upstreamAmbiguous&&['CN','GLOBAL'].includes(route.market)&&
      // Only catalogue classes that can describe authorized securities depth or
      // execution/tick data are eligible for a declared research entitlement.
      // A macro, news or reference-data route cannot impersonate an order book.
      ['cn-multi-asset','cn-quote-execution','global-tick'].includes(route.dataClass)&&
      !['public-quote-probe','itick-stock-quote.js','six-photo-sources.py','optional-research-sources.py'].includes(route.adapter);
  } catch { return false; }
}
function withinAuthorization(row,at) {
  const a=row.authorization;
  return time(at)&&a.validFrom<=at&&at<a.validUntil&&
    (a.revokedAt===undefined||at<a.revokedAt);
}
function authorization(row) {
  const a=row.authorization;
  return !!(a&&a.status==='granted'&&a.provider===row.source&&text(a.evidenceId,256)&&
    Array.isArray(a.scope)&&a.scope.length>0&&a.scope.length<=16&&Array.from(a.scope).every(x=>text(x,80))&&
    new Set(a.scope).size===a.scope.length&&a.scope.includes(row.granularity)&&
    time(a.validFrom)&&time(a.validUntil)&&a.validFrom<a.validUntil&&time(a.knownAt)&&
    time(row.receivedAt)&&a.knownAt<=row.receivedAt&&a.knownAt<=row.firstKnownAt&&
    (a.revokedAt===undefined||time(a.revokedAt))&&
    (a.market===undefined||a.market==='CN')&&
    (a.symbol===undefined||a.symbol===row.symbol)&&
    (a.symbols===undefined||Array.isArray(a.symbols)&&a.symbols.length>0&&a.symbols.length<=10000&&
      Array.from(a.symbols).every(symbol)&&new Set(a.symbols).size===a.symbols.length&&a.symbols.includes(row.symbol))&&
    withinAuthorization(row,row.quoteAt)&&withinAuthorization(row,row.receivedAt)&&depthRouteAllowsResearch(row));
}
function matchingDepthIdentity(child,row,eventAt) {
  return child&&typeof child==='object'&&!Array.isArray(child)&&['code','symbol'].every(k=>child[k]===undefined||child[k]===row.symbol)&&
    ['source','quoteSource','provider'].every(k=>child[k]===undefined||child[k]===row.source)&&
    (child.currency===undefined||child.currency==='CNY')&&
    (child.priceBasis===undefined||child.priceBasis==='unadjusted')&&
    (child.volumeUnit===undefined||child.volumeUnit==='shares')&&
    !['synthetic','fixture','simulated','mock','testSample','sourceConflict','quoteSourceConflict','conflict'].some(k=>child[k]===true)&&
    (child.receivedAt===undefined||time(child.receivedAt)&&child.receivedAt>=eventAt&&child.receivedAt<=row.receivedAt)&&
    (child.knownAt===undefined||time(child.knownAt)&&child.knownAt>=(child.receivedAt??eventAt)&&child.knownAt<=row.firstKnownAt);
}
function depthMetrics(row) {
  const bids=row.bids, asks=row.asks;
  if (row.volumeUnit!=='shares'||!Array.isArray(bids)||!Array.isArray(asks)||!bids.length||!asks.length||bids.length>50||asks.length>50) return null;
  const valid=(side,dir)=>Array.from(side).every((p,i)=>matchingDepthIdentity(p,row,row.quoteAt)&&
    (p.quoteAt===undefined||p.quoteAt===row.quoteAt)&&finite(p.price)&&p.price>0&&
    Number.isSafeInteger(p.quantity)&&p.quantity>0&&(!i||dir*(p.price-side[i-1].price)>0));
  if (!valid(bids,-1)||!valid(asks,1)||bids[0].price>=asks[0].price) return null;
  const buy=bids.reduce((s,p)=>s+p.quantity,0),sell=asks.reduce((s,p)=>s+p.quantity,0);
  const spread=asks[0].price-bids[0].price, midpoint=asks[0].price/2+bids[0].price/2,
    spreadBps=spread/midpoint*10000;
  if (!Number.isSafeInteger(buy+sell)||!finite(spread)||spread<=0||!finite(spreadBps)) return null;
  return {bestBid:bids[0].price,bestAsk:asks[0].price,spread:round(spread),
    spreadBps:round(spreadBps),bidQuantity:buy,askQuantity:sell,bookImbalance:round((buy-sell)/(buy+sell)),
    measuredLevels:{bid:bids.length,ask:asks.length},tradeImbalance:null,completeOrderBook:false};
}
function tickMetrics(row) {
  const ticks=row.trades;
  if (!Array.isArray(ticks)||ticks.length<1||ticks.length>500||row.volumeUnit!=='shares') return null;
  const seen=new Set(),miniqmt=row.source.trim().toLowerCase()==='miniqmt';
  let total=0,signed=0,quantity=0,allKnown=true,previous=0;
  for(const t of ticks){
    if(!text(t?.id)||seen.has(t.id)||!time(t.at)||t.at<previous||t.at>row.quoteAt||
       !withinAuthorization(row,t.at)||aShareCalendarDate(t.at)!==aShareCalendarDate(row.quoteAt)||
       !matchingDepthIdentity(t,row,t.at)||(t.quoteAt!==undefined&&t.quoteAt!==t.at)||
       ['canceled','cancelled','isCancellation'].some(k=>t[k]===true)||t.executed===false||
       (t.eventKind!==undefined&&!['trade','execution'].includes(t.eventKind))||
       (miniqmt&&t.tradeFlag!==undefined&&![0,1,2,'0','1','2'].includes(t.tradeFlag))||
       !finite(t.price)||t.price<=0||!Number.isSafeInteger(t.quantity)||t.quantity<=0||
       !['buy','sell','unknown'].includes(t.aggressor)) return null;
    seen.add(t.id);previous=t.at;
    const cash=t.price*t.quantity;quantity+=t.quantity;total+=cash;
    // The native Shenzhen tradeFlag does not establish active direction.
    // Do not derive direction from cancellation/unknown flags or price.
    const directionKnown=t.aggressor!=='unknown'&&!(miniqmt&&t.tradeFlag!==undefined&&
      (/^(?:00|30)/.test(row.symbol)||Number(t.tradeFlag)===0||
       t.aggressor!==(Number(t.tradeFlag)===1?'buy':'sell')));
    allKnown=allKnown&&directionKnown;
    if(directionKnown)signed+=(t.aggressor==='buy'?1:-1)*cash;
    if(!finite(cash)||cash<=0||!Number.isSafeInteger(quantity)||
       !finite(total)||!Number.isSafeInteger(Math.round(total*100))||!finite(signed))return null;
  }
  return {trades:ticks.length,turnover:round(total),tradeImbalance:allKnown?round(signed/total):null,
    bookImbalance:null,firstTradeAt:ticks[0].at,lastTradeAt:ticks.at(-1).at,
    measuredShares:quantity,completeMarketTape:false};
}
function buildDepthResearch(input={}, options={}) {
  const asOf=clock(options), selected=versions(input.depth,asOf,'盘口证据',500), rows=[], rejected=[...selected.rejected], risks=[];
  for (const r of selected.rows) {
    if (r.retracted===true) continue;
    const base={id:r.id,symbol:symbol(r.symbol)?r.symbol:null,granularity:r.granularity||'unknown',evidence:provenance(r,asOf),
      metrics:null,auction:null,queuePosition:null,principalIntent:null,missing:[],authorizationIndependentlyVerified:false,current:false};
    if (!symbol(r.symbol)||!['depth-snapshot','trade-ticks','auction-indicative','quote-snapshot'].includes(r.granularity)) {
      rejected.push({id:r.id,reason:'identity-or-granularity-missing'});continue;
    }
    if (r.granularity==='quote-snapshot'&&r.levelOne!==true) {rows.push({...base,status:'unsupported-granularity',missing:['普通报价快照不包含逐笔、队列或可靠盘口深度']});continue;}
    if (!authorization(r)) {rows.push({...base,status:'authorization-unavailable',missing:['缺少涵盖本源、本粒度、证券范围与原始时点的授权证据']});continue;}
    const wire={...r,price:r.price,quoteAt:r.quoteAt,receivedAt:r.receivedAt,quoteSource:r.source};
    const freshness=quoteObservationView(wire,asOf), receipt=quoteObservationView(wire,r.recordedAt);
    if (!matchingDepthIdentity(r,r,r.quoteAt)||receipt.quoteStatus!=='recent-unverified'||receipt.missingReason!==null||
        aShareCalendarDate(r.quoteAt)!==aShareCalendarDate(r.recordedAt)||r.receivedAt>r.firstKnownAt) {
      rows.push({...base,status:'source-time-unusable',freshness,missing:['原始报价、首次接收或15秒采集门禁未通过']});continue;
    }
    let metrics=null,auction=null,missing=[];
    if (r.granularity==='quote-snapshot') {
      metrics=Array.isArray(r.bids)&&Array.isArray(r.asks)&&[...r.bids,...r.asks].every(p=>matchingDepthIdentity(p,r,r.quoteAt))?levelOneReview(r,receipt):null;
      if(!metrics)missing.push('缺少经原授权和时点门禁的同一证券双边L1股数、价格与来源');
    } else if (r.granularity==='depth-snapshot') {
      metrics=depthMetrics(r);if(!metrics)missing.push('盘口档位、证券身份、股数单位、顺序或价差无效');
    } else if (r.granularity==='trade-ticks') {
      metrics=tickMetrics(r);
      if(!metrics)missing.push('逐笔成交身份、授权、时点、成交标志、数值或股数单位无效');
      else if(metrics.tradeImbalance===null)missing.push('部分逐笔缺少可核对的主动买卖方向，成交失衡保持未知');
    } else if (r.stock?.code===r.symbol&&r.stock?.source===r.source&&Array.isArray(r.stock.snapshots)&&
      r.stock.snapshots.length>0&&r.stock.snapshots.length<=250&&r.stock.snapshots.every(t=>
        time(t?.quoteAt)&&time(t.receivedAt)&&t.quoteAt<=r.quoteAt&&t.receivedAt<=r.receivedAt&&
        withinAuthorization(r,t.quoteAt)&&withinAuthorization(r,t.receivedAt))) {
      auction=evaluateAuctionEvidence(r.stock,{asOf:r.receivedAt,tradeDate:aShareCalendarDate(r.quoteAt)});
      if (auction.status==='insufficient_data') missing.push(auction.reason);
    } else missing.push('缺少与证券、供应商、授权及原接收时点一致的原始竞价序列');
    const usable=!!metrics||!!auction&&auction.status!=='insufficient_data';
    // Original receipt entitlement proves historical context only. Once that
    // grant expires or is revoked, no current risk signal may reuse the book.
    const entitlementCurrent=withinAuthorization(r,asOf);
    if(usable&&!entitlementCurrent)missing.push('当前授权已到期或撤销；保留原历史证据，不生成当前盘口预警');
    const current=usable&&entitlementCurrent&&freshness.quoteStatus==='recent-unverified'&&freshness.missingReason===null&&
      aShareCalendarDate(r.quoteAt)===aShareCalendarDate(asOf)&&
      (r.granularity!=='trade-ticks'||asOf-metrics.lastTradeAt<=15000);
    rows.push({...base,status:!usable?'insufficient-data':current?'observed-research':'historical-only',freshness,current,metrics,auction,missing,
      microstructure:metrics?microstructureReview(r,metrics,sessionOf(r.quoteAt)):null});
    if (current&&r.granularity==='depth-snapshot'&&metrics?.spreadBps>=100) risks.push(risk('liquidity-spread',r.symbol,[base.evidence],
      '同源真实买卖价差达到100个基点，仅覆盖所提供档位','同源新鲜盘口价差低于阈值并经原风险中心重新核验',asOf));
  }
  return result(70,rows,rows.length?[]:['尚无合法授权且带真实粒度的盘口或竞价数据'],{rejected,riskObservations:risks,microstructureSessions:summarizeMicrostructureSessions(rows),
    limitations:['买卖挂单失衡不是成交失衡；均不代表主力意图','盘口深度仅覆盖提供档位，不估算排队位置','逐笔样本不等于完整市场成交带','授权仅为声明的研究证据，未独立认证','历史记录可供研究；15秒外数据不生成当前盘口预警']});
}

function sessionOf(at) {
  if (!time(at)) return 'unknown';
  const d=new Date(at+28800000),m=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;
  if(m<480||m>=900)return 'overnight';
  if(m<555)return 'premarket';if(m<570)return 'auction';if(m<600)return 'opening';
  if(m<690)return 'morning';if(m<780)return 'break';if(m<870)return 'afternoon';return 'closing';
}
function settlementSample(trade, plans, asOf) {
  const p=trade?.paperSettlement,createdAt=Date.parse(trade?.createdAt),legs=p?.entryFills;
  if (trade?.source!=='V6 模拟成交'||['test','demo','synthetic'].includes(trade.sampleSet)||trade.scope==='demo'||
      !p||!isHash(trade.sourceFingerprint)||nativeHash(p)!==trade.sourceFingerprint||
      !time(createdAt)||createdAt>asOf||!time(p.exitTimestamp)||p.exitTimestamp>createdAt||!symbol(p.symbol)||
      trade.code!==p.symbol||!text(p.accountId,120)||!text(p.exitEventId)||!text(p.exitOrderId)||
      trade.id!=='paper-'+nativeHash([p.accountId,p.exitEventId])||
      !Array.isArray(legs)||!legs.length||legs.length>1000||
      !['exitQuantity','exitGrossCents','exitFeeCents','costBasisCents','realizedCents'].every(k=>Number.isSafeInteger(p[k]))||
      p.exitQuantity<=0||p.exitGrossCents<=0||p.exitFeeCents<0||p.costBasisCents<=0||
      p.realizedCents!==p.exitGrossCents-p.exitFeeCents-p.costBasisCents||
      !finite(p.exitPrice)||p.exitPrice<=0||Math.round(p.exitPrice*p.exitQuantity*100)!==p.exitGrossCents) return null;
  const ids=new Set();
  if (legs.some(l=>!text(l?.eventId)||ids.has(l.eventId)||!ids.add(l.eventId)||!text(l.orderId)||!time(l.time)||
      l.time>=p.exitTimestamp||aShareCalendarDate(l.time)>=aShareCalendarDate(p.exitTimestamp)||
      !Number.isSafeInteger(l.quantity)||l.quantity<=0||!Number.isSafeInteger(l.grossCents)||l.grossCents<=0||
      !Number.isSafeInteger(l.costCents)||l.costCents<l.grossCents)) return null;
  const basis=legs.reduce((s,l)=>s+l.costCents,0),gross=legs.reduce((s,l)=>s+l.grossCents,0),quantity=legs.reduce((s,l)=>s+l.quantity,0);
  if (basis!==p.costBasisCents||quantity!==p.exitQuantity) return null;
  const entryAt=Math.min(...legs.map(l=>l.time)), candidates=plans.filter(x=>x.id===trade.planId);
  let decisionAt=null,planEvidence=null;
  if (candidates.length===1&&trade.planVerified===true&&trade.snapshotVerified===true&&time(trade.decisionLink?.knownAt)&&trade.decisionLink.knownAt<=asOf) {
    const plan=candidates[0];
    try {
      validatePlan(plan,asOf);
      const at=Date.parse(plan.frozenAt);
      if (at<=entryAt&&plan.code===p.symbol&&trade.decisionLink?.planFingerprint===nativeHash(plan)&&
          Array.isArray(trade.decisionLink.entryEventIds)&&hash([...trade.decisionLink.entryEventIds].sort())===hash([...ids].sort())) {
        decisionAt=at;planEvidence={id:plan.id,frozenAt:at,fingerprint:trade.decisionLink.planFingerprint};
      }
    } catch { /* Preserve the settlement, but do not invent a decision clock. */ }
  }
  const strategies=[...new Set(legs.map(l=>l.strategy))],system=strategies.length===1&&SYSTEMS.includes(strategies[0])?strategies[0]:'unattributed';
  return {id:trade.id,origin:'original-paper-settlement',accountId:p.accountId,symbol:p.symbol,system,decisionAt,entryAt,exitAt:p.exitTimestamp,
    recordedAt:createdAt,netReturnPct:round(p.realizedCents/p.costBasisCents*100),costCents:basis-gross+p.exitFeeCents,
    costBasisCents:basis,realizedCents:p.realizedCents,executionWindow:sessionOf(entryAt),signalWindow:sessionOf(decisionAt),
    evidence:{source:trade.source,sourceFingerprint:trade.sourceFingerprint,accountId:p.accountId,exitEventId:p.exitEventId,
      entryEventIds:[...ids],recordedAt:createdAt,plan:planEvidence},
    constraintEvidence:{tPlusOne:true,matchedOriginalSettlement:true,slippageMeaning:'成交价格已由原模拟引擎生成，不再重复扣模拟滑点'},
    // Revalidation at consumption prevents a caller from changing only a net return.
    originalTrade:trade};
}
function extractDeepArchiveInputs(archive={}, options={}) {
  const asOf=clock(options),sessionSamples=[],missing=[];
  if (archive.scope==='demo'||archive.sampleSet==='test') return {sessionSamples,missing:['演示或测试档案不进入真实研究样本']};
  const plans=array(archive.plans,'计划'),trades=array(archive.trades,'成交');
  for (const trade of trades) {
    if (time(Date.parse(trade?.createdAt))&&Date.parse(trade.createdAt)>asOf)continue;
    const sample=settlementSample(trade,plans,asOf);
    if (sample) sessionSamples.push(sample);
    else if (trade?.paperSettlement) missing.push('部分原模拟结算的指纹、时间、成本或T+1证据不完整');
  }
  if (!sessionSamples.length) missing.push('没有可核对的成熟原模拟结算；不使用理想K线收益代替');
  if (sessionSamples.some(s=>s.system==='unattributed')) missing.push('部分成交缺少原四套策略身份，保留未归属，不按后补标签分配');
  if (sessionSamples.some(s=>s.decisionAt===null)) missing.push('部分成交缺少事前冻结决策时点，不用成交时点反推信号时段');
  return {sessionSamples,plans,missing:[...new Set(missing)]};
}
function stats(rows) {
  const returns=rows.map(r=>r.netReturnPct).filter(finite);
  return {samples:returns.length,independentDays:new Set(rows.map(r=>aShareCalendarDate(r.decisionAt||r.entryAt))).size,
    meanNetReturnPct:round(mean(returns)),worstNetReturnPct:returns.length?Math.min(...returns):null,
    positiveFractionPct:returns.length?round(100*returns.filter(x=>x>0).length/returns.length):null,
    averageCostCents:round(mean(rows.map(r=>r.costCents).filter(finite))),maxDrawdownPct:null};
}
function buildSessionEffectiveness(input={}, options={}) {
  const asOf=clock(options), rows=[],rejected=[],missing=[],plans=array(input.plans,'计划');
  const supplied=input.archive?extractDeepArchiveInputs(input.archive,{asOf}):{sessionSamples:array(input.sessionSamples,'时段结算'),plans,missing:[]};
  missing.push(...supplied.missing);const seen=new Set();
  for (const row of supplied.sessionSamples) {
    const verified=settlementSample(row?.originalTrade,supplied.plans,asOf);
    if (!verified) {rejected.push({id:row?.id||null,reason:'original-settlement-evidence-unavailable'});continue;}
    if (seen.has(verified.id)) continue;seen.add(verified.id);
    const {originalTrade,...publicRow}=verified; rows.push(publicRow);
  }
  let workspace=null;
  const events=array(input.workspaceEvents,'原四策略研究档案',2000).filter(e=>time(e?.recordedAt)&&e.recordedAt<=asOf&&
    e.kind==='analysis'&&isHash(e.hash)&&time(e.data?.asOf)&&e.data.asOf<=e.recordedAt&&e.data.researchOnly===true&&
    !['test','demo','synthetic'].includes(e.data.sampleSet)&&e.scope!=='demo'&&
    Array.isArray(e.data.systems)&&Array.isArray(e.data.bars)&&Array.isArray(e.data.tradeDates));
  if (events.length) {
    workspace=scorecards(events,{asOf,...(options.costs||{})});
    const byId=new Map(events.map(e=>[e.hash,e]));
    for (const o of workspace.observations) {
      const event=byId.get(o.runId);
      rows.push({id:[o.runId,o.system,o.horizon].join('|'),origin:'existing-workspace-estimate',symbol:o.symbol,system:o.system,
        decisionAt:event.data.asOf,entryAt:Date.parse(o.entryDate+'T09:30:00+08:00'),exitAt:Date.parse(o.exitDate+'T09:30:00+08:00'),
        signalWindow:sessionOf(event.data.asOf),executionWindow:'opening',horizonSessions:o.horizon,status:o.status,
        netReturnPct:o.status==='paper-estimate'?o.netReturnPct:null,costCents:null,
        evidence:{runId:o.runId,recordedAt:event.recordedAt,entryOutcomeRunId:o.entryOutcomeRunId,exitOutcomeRunId:o.exitOutcomeRunId},
        constraintEvidence:{upstream:'research-workspace-analytics.scorecards',status:o.status,assumptions:workspace.assumptions}});
    }
  }
  const groups=SYSTEMS.flatMap(system=>SESSIONS.map(session=>{
    const selected=rows.filter(r=>r.system===system&&r.signalWindow===session.id);
    const estimates=[...new Set(selected.filter(r=>r.origin==='existing-workspace-estimate').map(r=>r.horizonSessions))].sort((a,b)=>a-b)
      .map(h=>({horizonSessions:h,...stats(selected.filter(r=>r.origin==='existing-workspace-estimate'&&r.horizonSessions===h&&finite(r.netReturnPct)))}));
    const settled=selected.filter(r=>r.origin==='original-paper-settlement'),accounts=[...new Set(settled.map(r=>r.accountId))];
    return {system,session:session.id,label:session.label,settlements:stats(accounts.length<=1?settled:[]),
      settlementsByAccount:accounts.map(accountId=>({accountId,...stats(settled.filter(r=>r.accountId===accountId))})),
      settlementScope:accounts.length>1?'separate-authoritative-accounts':'single-authoritative-account',
      modeled:estimates,blockedOrMissing:selected.filter(r=>r.origin==='existing-workspace-estimate'&&!finite(r.netReturnPct)).length};
  }));
  if (!rows.length)missing.push('缺少成熟成本后结算或通过原可成交性检查的四策略样本');
  return result(71,rows,missing,{groups,sessions:SESSIONS,systems:SYSTEMS,rejected,
    unassigned:rows.filter(r=>r.system==='unattributed'||!SESSIONS.some(s=>s.id===r.signalWindow)).map(r=>r.id),
    upstreamCoverage:workspace?.groups||[],limitations:['真实模拟结算与纸面成本估计分栏，不混合计算收益','时间窗口按北京时间固定；午间休市不并入上午或午后','样本重叠时不拼接成账户净值，不虚构组合最大回撤','未归属策略和缺信号时点的样本保留，但不进入四策略时段均值']});
}

function buildThemeCrowding(input={}, options={}) {
  const asOf=clock(options), selected=versions(input.themes,asOf,'题材统计',100),rows=[],rejected=[...selected.rejected],risks=[],account=accountProjection(input.account,asOf);
  for (const t of selected.rows) {
    if (t.retracted===true) continue;
    if (!text(t.name,120)||!Array.isArray(t.members)||!t.members.length||t.members.length>10000||
        t.members.some(s=>!symbol(s))||new Set(t.members).size!==t.members.length||t.membershipComplete!==true||
        !time(t.snapshotAt)||t.snapshotAt>t.firstKnownAt) {rejected.push({id:t.id,reason:'dated-complete-membership-missing'});continue;}
    const stocks=array(t.stocks,'题材成员',10000),seen=new Set(),valid=[],members=new Set(t.members);
    if(new Set(stocks.map(s=>s?.symbol)).size!==stocks.length){rejected.push({id:t.id,reason:'duplicate-theme-member-observation'});continue;}
    for (const s of stocks) {
      // Explicit member receipt clocks must agree with the enclosing evidence.
      // Legacy members without these optional clocks retain their research-only
      // parent provenance; never substitute receipt time for quoteAt.
      const memberClocks=['receivedAt','knownAt','firstKnownAt','recordedAt'];
      const badClock=s && memberClocks.some(k=>Object.hasOwn(s,k)&&
        (!time(s[k])||s[k]<s.quoteAt||s[k]>(k==='recordedAt'?t.recordedAt:t.firstKnownAt)));
      if (badClock||!symbol(s?.symbol)||!members.has(s.symbol)||seen.has(s.symbol)||!time(s.quoteAt)||s.quoteAt>t.snapshotAt||
          aShareCalendarDate(s.quoteAt)!==aShareCalendarDate(t.snapshotAt)||!text(s.source,160)||fake(s.source)||
          s.retracted===true||['synthetic','fixture','simulated','mock'].some(k=>s[k]===true)||['test','demo','synthetic'].includes(s.sampleSet)) continue;
      seen.add(s.symbol);valid.push(s);
    }
    const complete=valid.length===t.members.length;
    const values=key=>complete&&valid.every(s=>finite(s[key])&&(key==='changePct'||s[key]>=0))?valid.map(s=>s[key]):[];
    const amounts=values('amount'),turnovers=values('turnoverPct'),changes=values('changePct'),total=amounts.length?amounts.reduce((s,n)=>s+n,0):null;
    const metrics={turnoverConcentrationTop3Pct:total>0?round(amounts.slice().sort((a,b)=>b-a).slice(0,3).reduce((s,n)=>s+n,0)/total*100):null,
      amount:round(total),meanTurnoverPct:round(mean(turnovers)),meanChangePct:round(mean(changes)),
      advanceFractionPct:changes.length?round(100*changes.filter(n=>n>0).length/changes.length):null,
      limitUpFractionPct:complete&&valid.every(s=>typeof s.limitUp==='boolean')?round(100*valid.filter(s=>s.limitUp).length/valid.length):null};
    const conditions=[['成交额集中',t.members.length>=5&&metrics.turnoverConcentrationTop3Pct>=70&&metrics.turnoverConcentrationTop3Pct!==null],
      ['换手较高',metrics.meanTurnoverPct!==null&&metrics.meanTurnoverPct>=10],
      ['涨停扩散',metrics.limitUpFractionPct!==null&&metrics.limitUpFractionPct>=30],
      ['价格快速上涨',metrics.meanChangePct!==null&&metrics.meanChangePct>=5]].filter(([,yes])=>yes).map(([name])=>name);
    const known=Object.values(metrics).every(v=>v!==null),current=complete&&asOf-t.snapshotAt<=15000&&valid.every(s=>asOf-s.quoteAt<=15000)&&
      aShareCalendarDate(t.snapshotAt)===aShareCalendarDate(asOf);
    const row={id:t.id,name:t.name,snapshotAt:t.snapshotAt,evidence:provenance(t,asOf),members:t.members,
      memberCount:t.members.length,observedMembers:valid.length,coveragePct:round(valid.length/t.members.length*100),metrics,
      status:!known?'partial-data':conditions.length>=2?'crowding-observation':'observed-research',matchedConditions:conditions,
      thresholdVersion:'theme-descriptive-v1',current,holdingExposure:exposure(t.members,account),
      memberEvidence:valid.map(s=>({symbol:s.symbol,source:s.source,quoteAt:s.quoteAt})),
      missing:Object.entries(metrics).filter(([,v])=>v===null).map(([k])=>k+' 缺少全成员同日真实字段')};
    rows.push(row);
    if (current&&known&&conditions.length>=2) risks.push(risk('theme-crowding',t.name,[row.evidence],
      '固定统计观察条件命中：'+conditions.join('、'),'同口径完整题材统计不再同时命中两项，并经原风险中心复核',asOf,2));
  }
  return result(72,rows,rows.length?[]:['缺少真实完整成员及同日成交、换手、涨停和价格字段'],{account,rejected,riskObservations:risks,
    limitations:['拥挤统计不代表主力真实持仓或真实资金去向','完整成员缺字段保持未知，不以已取到的股票作为全板块分母','持仓暴露来自原账户；各题材可能重叠，不能直接相加']});
}

function extractNewsJournalEvents(journalRows, options={}) {
  const asOf=clock(options),knownSecurities=new Map(),events=[];
  for (const row of array(journalRows,'新闻档案').slice().sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence)) {
    if (!time(row?.recordedAt)||row.recordedAt>asOf||!row.evidence||!isHash(row.eventHash)||!Number.isSafeInteger(row.sequence)||row.sequence<1)continue;
    const e=row.evidence,key=e.source+'|'+e.eventId;
    const securities=new Set((Array.isArray(e.securities)?e.securities:[]).filter(symbol)),prior=knownSecurities.get(key)||new Set();
    knownSecurities.set(key,securities);
    for (const code of new Set([...prior,...securities])) {
      const title=String(e.title||''),types=[['buyback',/回购/],['merger',/并购|重组|收购/],['contract',/中标|合同/],['reduction',/减持/],['earnings',/业绩|盈利|净利/],['policy',/政策|办法|监管/]];
      const hits=types.filter(([,r])=>r.test(title));
      events.push({id:e.eventId+'|'+code,revision:row.sequence,source:e.source,sourceUrl:e.url,evidenceId:row.eventHash,sourceRevisionId:e.sourceRevisionId||null,
        publishedAt:e.kind==='original'?e.publishedAt:e.revisedAt,firstKnownAt:e.receivedAt,recordedAt:row.recordedAt,
        originalPublishedAt:e.publishedAt,symbol:code,eventType:hits.length===1?hits[0][0]:'other',
        eventTypeStatus:'headline-classification-only',title,bodyScope:e.bodyScope,retracted:e.kind==='retracted'||!securities.has(code),associationRemoved:!securities.has(code),
        missing:e.kind!=='original'&&!time(e.revisedAt)?['修订源时点未知，不借首版发布时间替代']:[]});
    }
  }
  return events;
}

function buildDeepResearchEvidence(input={}, options={}) {
  const asOf=clock(options), effective={...input};
  if (input.newsJournalRows!==undefined) effective.events=[...array(input.events,'事件'),...extractNewsJournalEvents(input.newsJournalRows,{asOf})];
  const derived=deriveEventOutcomes({events:effective.events,archive:input.archive,calendar:input.eventCalendar,workspaceEvents:input.workspaceEvents},{asOf});
  effective.eventOutcomes=[...array(input.eventOutcomes,'事件结果'),...derived.eventOutcomes];
  const modules={67:buildEventImpactStudy(effective,{asOf,derivedOutcomes:new Map(derived.eventOutcomes.map(o=>[o.id,o]))}),68:buildExpectationStudy(effective,{asOf,derivedOutcomes:derived.eventOutcomes}),
    69:buildRelationshipGraph(effective,{asOf}),70:buildDepthResearch(effective,{asOf}),
    71:buildSessionEffectiveness(effective,{asOf,costs:options.costs}),72:buildThemeCrowding(effective,{asOf})};
  modules[67].archiveDerivation={...derived,eventOutcomes:derived.eventOutcomes.map(o=>({id:o.id,eventId:o.eventId,horizonSessions:o.horizonSessions}))};
  // Existing version reader and original account projection remain authoritative.
  modules[67].eventReview=projectEventReview({events:versions(effective.events,asOf,'事件').rows,relations:versions(effective.relations,asOf,'关系证据',2000).rows,
    journalRows:input.newsJournalRows??[],account:modules[69].account,asOf});
  modules[67].eventTracking=trackEventCandidates({journalRows:input.newsJournalRows??[],workspaceEvents:input.workspaceEvents??[],asOf});
  // Operating evidence and observed share-price leadership are independent.
  // A peer cohort is not certified event-free without a complete news receipt.
  // Match the exact event revision, never the symbol alone.
  const outcomeIndex=new Map();
  for(const o of derived.eventOutcomes){const key=JSON.stringify([o.eventSource,o.eventId,o.eventRevision,o.symbol]),group=outcomeIndex.get(key)||[];group.push(o);outcomeIndex.set(key,group);}
  const trackedIndex=new Map((modules[67].eventTracking.rows||[]).filter(t=>t.current?.eventHash).map(t=>[JSON.stringify([t.source,t.current.eventHash,t.current.sequence]),t]));
  modules[67].businessResearch={mode:'original-event-business-and-peer-review-v1',canTrade:false,canNotify:false,causalInferenceVerified:false,rows:modules[67].eventReview.rows.filter(r=>r.industry.businessPaths.length||r.policy.paths.length||r.overseas.paths.length).map(r=>{
    const key=JSON.stringify([r.event.source,r.event.id,r.event.revision,r.symbol]),linked=outcomeIndex.get(key)||[];
    const track=trackedIndex.get(JSON.stringify([r.event.source,r.event.evidenceId,r.event.revision]));
    const screen=track?.candidates.find(c=>c.symbol===r.symbol)||null;
    const peers=linked.filter(o=>o.industryReaction?.status==='descriptive-unverified').map(o=>({id:o.id,horizonSessions:o.horizonSessions,priceSource:o.stock.source,industry:o.industryReaction.industry,post:o.industryReaction.post,relativePriceLeading:o.industryReaction.post.peerExcessPct>0}));
    return {event:r.event,symbol:r.symbol,businessPaths:r.industry.businessPaths,policyPaths:r.policy.paths,overseasPaths:r.overseas.paths,
      operatingOrders:r.industry.businessPaths.filter(p=>p.orderEvidence!==null).map(p=>({entityId:p.entityId,productId:p.productId,evidence:p.evidence,order:p.orderEvidence})),
      priceLeadership:peers,screenAssociation:screen,noEventMatchedControl:null,causalInferenceVerified:false,currentCandidateCertified:false,canTrade:false,canNotify:false};
  })};
  modules[67].missing=[...new Set([...modules[67].missing,...derived.pending.map(r=>r.reason)])];
  return {schemaVersion:1,asOf,modules,riskObservations:Object.values(modules).flatMap(m=>m.riskObservations),
    missing:Object.values(modules).flatMap(m=>m.missing.map(reason=>({task:m.task,reason}))),...FLAGS};
}

module.exports={buildDeepResearchEvidence,buildEventImpactStudy,buildExpectationStudy,buildRelationshipGraph,
  buildDepthResearch,buildSessionEffectiveness,buildThemeCrowding,extractDeepArchiveInputs,extractNewsJournalEvents,
  deriveEventOutcomes,EVENT_HORIZONS,sessionOf,SESSIONS,FLAGS};
