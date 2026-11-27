'use strict';

// This adapter never changes sizing, exits, cash or positions. A confirmed plan
// can only call the existing paperBuy path, then report its committed fill.
const {aShareCalendarDate} = require('./a-share-calendar');
const {executionTimeOf} = require('./paper-fill-evidence');
const {digest}=require('./research-workspace-store');
const PLAN_PREFIX = '作战台计划[';
const planIdOk = value => typeof value === 'string' && /^plan-[0-9a-f-]{36}$/.test(value);
const reasonOf = plan => `${PLAN_PREFIX}${plan.id}] ${plan.code} · 原账户风控`;
const planIdOf = reason => typeof reason === 'string' ? /^作战台计划\[(plan-[0-9a-f-]{36})\]/.exec(reason)?.[1] || null : null;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dateOk = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

function validatePlan(plan, now) {
  if (!plan || !planIdOk(plan.id) || !/^\d{6}$/.test(plan.code || '') || plan.sampleSet !== 'real' ||
      plan.strategy !== '作战台条件计划' || !dateOk(plan.intendedDate) ||
      plan.decisionAuthority !== 'fayo-decision-center' || !/^[a-f0-9]{64}$/.test(plan.decisionId || '') ||
      !authoritativePlanMatches(plan,plan.decisionEvidence) ||
      !Number.isFinite(Date.parse(plan.frozenAt)) || Date.parse(plan.frozenAt) > now ||
      ![plan.entryMin,plan.entryMax,plan.stop,plan.target,plan.maxPosition].every(finite) ||
      !(plan.stop > 0 && plan.stop < plan.entryMin && plan.entryMin <= plan.entryMax && plan.entryMax < plan.target) ||
      !(plan.maxPosition > 0 && plan.maxPosition <= 100)) throw Error('条件计划缺少有效的事前冻结价格、日期或仓位');
  return plan;
}

function decisionPlanPayload(card) {
  if(card?.authority!=='fayo-decision-center'||!/^[a-f0-9]{64}$/.test(card.decisionId||''))
    throw Error('后端决策依据无效，请刷新今日作战台');
  const p=card.plan||{};
  return {code:card.code,name:card.row?.name||card.name||card.code,intendedDate:card.day,
    strategy:'作战台条件计划',entryMin:p.buyLow,entryMax:p.buyHigh,stop:p.stop,target:p.target,
    maxPosition:p.positionPct,trend:'未判定',
    logic:String(card.reason||card.row?.selectionWhy||card.row?.reason||'后端今日作战台同日候选条件').slice(0,1800)+'；按原模拟账户规则退出'};
}

function authoritativePlanMatches(plan,card) {
  if(!card||card.authority!=='fayo-decision-center'||card.decisionId!==plan?.decisionId||
     card.code!==plan.code||card.day!==plan.intendedDate)return false;
  const p=card.plan||{};
  return plan.decisionAuthority===card.authority&&plan.entryMin===p.buyLow&&plan.entryMax===p.buyHigh&&
    plan.stop===p.stop&&plan.target===p.target&&plan.maxPosition===p.positionPct;
}

function bindAuthoritativePlan(plan,card) {
  const p=decisionPlanPayload(card);
  if(plan.code!==p.code||plan.intendedDate!==p.intendedDate||plan.entryMin!==p.entryMin||
    plan.entryMax!==p.entryMax||plan.stop!==p.stop||plan.target!==p.target||plan.maxPosition!==p.maxPosition)
    throw Error('冻结计划与服务器决策不一致');
  plan.decisionAuthority=card.authority;plan.decisionId=card.decisionId;
  plan.decisionEvidence={authority:card.authority,decisionId:card.decisionId,code:card.code,day:card.day,
    calculatedAt:card.calculatedAt,strategyAt:card.strategyAt,quoteBasis:card.quoteBasis,strategyBasis:card.strategyBasis,
    plan:{...card.plan}};
  return plan;
}

function currentDecisionAllows(plan,card) {
  const p=card?.plan;
  // A negative risk assessment on the current server authority card is a
  // one-way veto only. Absence or a favorable opinion never grants authority
  // and cannot bypass the existing candidate, quote or account gates.
  if(card?.riskAssessment?.status==='blocked'||card?.riskAssessment?.canOpenRisk===false)return false;
  // A current authority card cannot silently revise frozen protection.
  // Legacy internal receipts without optional completeness metadata remain
  // readable; explicit negative or inconsistent evidence cannot open risk.
  return card?.authority==='fayo-decision-center'&&/^[a-f0-9]{64}$/.test(card.decisionId||'')&&
    card.code===plan.code&&card.day===plan.intendedDate&&card.strategyAt===plan.decisionEvidence.strategyAt&&
    card.quoteBasis?.source===plan.decisionEvidence.quoteBasis?.source&&
    p&&typeof p==='object'&&!Array.isArray(p)&&
    (!Object.hasOwn(p,'complete')||p.complete===true)&&
    (!Object.hasOwn(p,'missing')||Array.isArray(p.missing)&&p.missing.length===0)&&
    [p.buyLow,p.buyHigh,p.stop,p.target,p.positionPct].every(finite)&&
    p.stop>0&&p.stop<p.buyLow&&p.buyLow<=p.buyHigh&&p.buyHigh<p.target&&
    p.positionPct>0&&p.positionPct<=100&&p.stop===plan.stop&&p.target===plan.target&&
    Math.max(p.buyLow,plan.entryMin)<=Math.min(p.buyHigh,plan.entryMax)&&
    (!Object.hasOwn(p,'riskReward')||p.riskReward?.status==='meets-gross-discipline');
}

// A direct user confirmation may reuse the exact original observation that
// formed the frozen decision, if the current server decision still binds it.
// This is not a post-freeze trigger. Conditional monitoring keeps its separate
// post-freeze sampling gate; no quote timestamp is refreshed or synthesized.
function matchesFrozenConfirmationQuote(plan,card,quote,quoteAt,now){
  const frozen=plan.decisionEvidence,mode=quote.mode??quote.quoteMode,receivedAt=quote.receivedAt;
  const matches=basis=>basis?.code===plan.code&&basis.price===quote.price&&
    basis.quoteAt===quoteAt&&basis.receivedAt===receivedAt&&basis.source===quote.quoteSource&&basis.mode===mode;
  return quote.symbol===plan.code&&typeof quote.quoteSource==='string'&&quote.quoteSource.trim()!==''&&
    typeof mode==='string'&&mode.trim()!==''&&Number.isSafeInteger(receivedAt)&&
    receivedAt>=quoteAt&&receivedAt<=Date.parse(plan.frozenAt)&&
    Number.isSafeInteger(frozen.calculatedAt)&&frozen.calculatedAt>=receivedAt&&frozen.calculatedAt<=Date.parse(plan.frozenAt)&&
    Number.isSafeInteger(card.calculatedAt)&&card.calculatedAt>=receivedAt&&card.calculatedAt<=now&&
    matches(frozen.quoteBasis)&&matches(card.quoteBasis);
}

function planFill(book, planId, {plan=null, now=Date.now()}={}) {
  // Read the original validated account; neither absence of an account
  // period nor the first of several matching fills is an idempotency receipt.
  if(!book||!Array.isArray(book.account?.events)||
     book.archives!=null&&!Array.isArray(book.archives))
    throw Error('原持久账本缺少完整成交流水，停止执行');
  let found=null;
  for (const period of [...(book.archives || []), book]) {
    if(!Array.isArray(period?.account?.events))
      throw Error('原持久账本缺少完整账户期次，停止执行');
    for(const event of period.account.events){
      if(event?.side!=='buy'||planIdOf(event.reason)!==planId)continue;
      if(found)throw Error('计划与原持久成交冲突：存在多个同计划买入事件，停止执行');
      found=event;
    }
  }
  if(found&&plan){
    const at=executionTimeOf(found);
    if(plan.id!==planId||String(found.symbol)!==plan.code||found.tradeDate!==plan.intendedDate||
       typeof found.eventId!=='string'||!found.eventId.trim()||
       !finite(found.price)||found.price<=0||!Number.isSafeInteger(found.quantity)||found.quantity<=0||
       !Number.isSafeInteger(at)||at<Date.parse(plan.frozenAt)||at>now)
      throw Error('计划与原持久成交冲突：证券、交易日、冻结时点或成交身份不一致，停止执行');
  }
  return found;
}

function executeDecisionPlan({input, plan, now=Date.now(), day=aShareCalendarDate(now), replica,
  continuous, candidate, eligiblePick, systemPickDay, poolDay, newsBlocked,
  account, policy, equity, quote, authoritative, readBook, buy, clock=()=>Date.now(), requireEntryBinding=false}) {
  if (replica) throw Error('当前为副本，请在原主实例确认模拟计划');
  if (!input || input.account !== 'pool' || !planIdOk(input.planId) || input.planId !== plan?.id ||
      Object.keys(input).some(k => !['action','account','planId','token'].includes(k))) throw Error('模拟计划请求无效');
  validatePlan(plan, now);
  const checkedBook=readBook();
  const previous = planFill(checkedBook, plan.id, {plan,now});
  if (previous) return {ok:true,status:'already-executed',planId:plan.id,code:plan.code,
    eventId:previous.eventId,price:previous.price,shares:previous.quantity,msg:'该计划已有持久成交流水，未重复买入'};
  if (plan.intendedDate !== day || aShareCalendarDate(Date.parse(plan.frozenAt)) !== day)
    throw Error('计划日期已失效，请回到今日作战台重新核对');
  if(!currentDecisionAllows(plan,authoritative))throw Error('后端权威候选、策略批次或来源已变化，请刷新作战台；未按客户端价格成交');
  // Share the existing plan observer's continuous-auction windows. A caller
  // flag alone cannot certify an exchange-local clock or a fresh quote from
  // the same window. The already-committed retry above remains read-only.
  const windows=require('./paper-plan-observer').sessions(day);
  const window=windows.find(([start,end])=>now>=start&&now<end);
  if (continuous!==true || aShareCalendarDate(now)!==day || !window)
    throw Error('仅在原连续竞价时段确认模拟买入，当前没有排入待成交队列');
  if (!candidate || candidate.code !== plan.code || !eligiblePick(candidate) ||
      systemPickDay(candidate,poolDay,now) !== day || newsBlocked) throw Error('该股当前已不符合原候选条件');
  if (!account || account.enabled !== true) throw Error('原模拟跟踪账户尚未启用');
  if (account.positions?.[plan.code]) throw Error('原账户已有该股持仓，本次未追加买入');
  if (!quote || !finite(quote.price) || quote.price < plan.entryMin || quote.price > plan.entryMax ||
      quote.price < authoritative.plan.buyLow || quote.price > authoritative.plan.buyHigh)
    throw Error('最新原始报价未进入计划买入区间或当前权威区间；没有成交或后台挂单');
  const quoteAt = quote.quoteAt ?? quote.timestamp;
  if (!Number.isSafeInteger(quoteAt) || quoteAt <= 0 || quoteAt > now || now-quoteAt > 15000 ||
      aShareCalendarDate(quoteAt) !== day || quoteAt < window[0] ||
      quoteAt < Date.parse(plan.frozenAt)&&!matchesFrozenConfirmationQuote(plan,authoritative,quote,quoteAt,now))
    throw Error('原始报价过期、缺失、早于冻结计划或不在当前连续竞价时段');
  const quoteView=require('./quote-observation-view');
  // Apply the original receipt view to the exact post-freeze row as well.
  // A fresh timestamp alone must not admit another security or source.
  if (quote.symbol!==plan.code || quote.quoteSource!==authoritative.quoteBasis?.source ||
      quoteView.quoteUseEligibility({...quote,quoteAt},now).canTrade!==true ||
      quote.provider!=null&&quote.quoteSource!=null&&quote.provider!==quote.quoteSource ||
      quote.timestamp!=null&&quote.timestamp!==quoteAt)
    throw Error('原始报价只读、来源冲突或时点不一致');
  if (!finite(equity) || equity <= 0 || !finite(account.cash) || account.cash < 0 ||
      !Number.isSafeInteger(policy?.maxPos) || policy.maxPos < 1) throw Error('原账户预算尚未完成核对');
  const allocationPct = Math.min(account.cash,equity/policy.maxPos*.98)/equity*100;
  if (allocationPct > Math.min(plan.maxPosition,authoritative.plan.positionPct)+1e-7)
    throw Error('原账户等权预算超出冻结计划或当前风险仓位，请重新核对；未修改账户分仓规则');
  // Bind the exact original account and quote on the real server plan path.
  // Legacy read-only observers continue to use their existing callback.
  if(requireEntryBinding===true){
    const binding=require('./paper-plan-entry-binding').createPlanEntryBinding({plan,card:authoritative,book:checkedBook,quote,now});
    buy(candidate,reasonOf(plan),binding);
  }else buy(candidate,reasonOf(plan));
  // The original synchronous callback may commit a few milliseconds after
  // the entry check. Use the completion clock without changing quote provenance.
  const bookAfter=readBook(),finishedAt=clock();
  if(!Number.isSafeInteger(finishedAt)||finishedAt<now)throw Error('原模拟成交确认时钟倒退，停止执行');
  const committed = planFill(bookAfter,plan.id,{plan,now:finishedAt});
  if (!committed) throw Error('原模拟门禁未产生持久成交，请核对报价、涨停、持仓上限、资金或账本回执');
  return {ok:true,status:'executed',planId:plan.id,code:plan.code,eventId:committed.eventId,
    price:committed.price,shares:committed.quantity,msg:'已通过原模拟门禁并核对持久成交；退出仍按原账户止损规则'};
}

// Conditional intents retain only actual trigger windows, not full-session
// samples. Preserve that evidence without treating it as sampling coverage.
function conditionalStopEvidence({plan,context,conditionalOrders,day,now}){
  const {entry}=context,at=executionTimeOf(entry),points=[],seen=new Set();
  for(const order of conditionalOrders||[]){
    if(order.planId!==plan.id||order.code!==plan.code||order.fill?.eventId!==entry.eventId)continue;
    for(const observation of order.observations||[]){
      const {fingerprint,...payload}=observation;
      if(fingerprint!==digest(payload)||payload.kind!=='stop'||payload.planId!==plan.id||payload.code!==plan.code||
        payload.entryEventId!==entry.eventId||payload.day!==day||payload.originalFreshGate!==true||payload.continuous!==true||
        payload.sellable!==true||!Number.isSafeInteger(payload.observedAt)||payload.observedAt<at||payload.observedAt>now||
        !Number.isSafeInteger(payload.quoteAt)||!Number.isSafeInteger(at)||payload.quoteAt<at||payload.quoteAt<Date.parse(plan.frozenAt)||payload.quoteAt>payload.observedAt||payload.observedAt-payload.quoteAt>15000||
        !Number.isSafeInteger(payload.receivedAt)||payload.receivedAt<payload.quoteAt||payload.receivedAt>payload.observedAt||
        aShareCalendarDate(payload.quoteAt)!==day||!finite(payload.price)||payload.price>plan.stop||
        !finite(payload.lowerLimit)||!finite(payload.upperLimit)||payload.price<=payload.lowerLimit||payload.price>=payload.upperLimit||
        typeof payload.source!=='string'||!payload.source||/mock|synthetic|fixture|demo/i.test(payload.source))continue;
      const key=[plan.id,entry.eventId,day,payload.source,payload.quoteAt,payload.price].join('/');
      if(seen.has(key))continue;seen.add(key);
      points.push({...payload,fingerprint});
    }
  }
  points.sort((a,b)=>a.observedAt-b.observedAt);
  const first=points[0],sells=context.sells||[],{fillEvidenceOf}=require('./paper-fill-evidence');
  let timely=false,remaining=null;
  if(first&&!context.ambiguous){
    remaining=entry.quantity-sells.filter(s=>executionTimeOf(s)<=first.observedAt).reduce((sum,s)=>sum+s.quantity,0);
    timely=remaining>0&&context.remaining===0&&context.closedAt>=first.observedAt&&
      context.closedAt-first.observedAt<=15000&&aShareCalendarDate(context.closedAt)===day&&
      sells.filter(s=>executionTimeOf(s)>first.observedAt&&fillEvidenceOf(s)).reduce((sum,s)=>sum+s.quantity,0)===remaining;
  }
  return {points,timely,remaining,first};
}

function paperExecutionScore({book,plans=[],observations=[],conditionalOrders=[],day,now=Date.now()}) {
  if (!dateOk(day)) throw Error('执行评分日期无效');
  const observer=require('./paper-plan-observer');
  const {fillEvidenceOf}=require('./paper-fill-evidence');
  if (!Array.isArray(observations)||observations.length>observer.MAX_RECORDS) throw Error('执行评分观察数量无效');
  if(!Array.isArray(conditionalOrders)||conditionalOrders.length>2000)throw Error('执行评分条件记录数量无效');
  const validObservations=[],knownObservations=new Set();
  for(const record of observations){
    observer.validateObservation(record,{now});
    if(record.day===day&&!knownObservations.has(record.fingerprint)){
      knownObservations.add(record.fingerprint);validObservations.push(record);
    }
  }
  const closed = now >= Date.parse(day+'T15:00:00+08:00');
  const cutoff=Math.min(now,Date.parse(day+'T15:00:00+08:00'));
  const rows=[], index=new Map(plans.filter(p=>{
    try{validatePlan(p,now);return p.intendedDate<=day;}catch{return false;}
  }).map(p=>[p.id,p]));
  const events=observer.ledgerEvents(book,cutoff);
  const reference=record=>({id:record.fingerprint,source:record.source,quoteAt:record.quoteAt,
    receivedAt:record.receivedAt,observedAt:record.observedAt,price:record.price});
  for(const plan of index.values()){
    const context=observer.planLedgerContext(book,plan,cutoff,events);
    const {entry}=context,at=entry?executionTimeOf(entry):null;
    if(plan.intendedDate!==day && (!entry||entry.tradeDate>day))continue;
    if(context.closedAt&&aShareCalendarDate(context.closedAt)<day)continue;
    const samples=validObservations.filter(r=>r.planId===plan.id).sort((a,b)=>a.observedAt-b.observedAt||a.quoteAt-b.quoteAt);
    for(const record of samples){
      observer.validateObservation(record,{now,day,plan});
      observer.assertObservationLedger(record,context);
    }
    const facts=[];
    const begin=Math.max(Date.parse(plan.frozenAt),observer.sessions(day)[0][0]);
    const end=Math.min(cutoff,observer.sessions(day).at(-1)[1],context.closedAt||Infinity);
    const coverage=end>begin?observer.observationCoverage(samples,{day,from:begin,to:end,now}):
      {status:'insufficient',complete:false,samples:0,gapCount:1,gaps:[],scope:observer.SCOPE,note:'有效观察时段尚未开始'};
    if(!entry){
      const touches=samples.filter(r=>r.price>=plan.entryMin&&r.price<=plan.entryMax);
      const window=observer.hasObservedWindow(samples,r=>r.price>=plan.entryMin&&r.price<=plan.entryMax&&r.entry.allowed===true);
      if(!closed||!coverage.complete)facts.push({rule:'按计划买入',status:'资料不足',evidence:
        !closed?'待收盘核对冻结计划及采样覆盖':'尚无关联的持久买入成交；采样覆盖不足，不能判定漏买'});
      else if(window)facts.push({rule:'按计划买入',status:'触发',evidence:'连续两次原始报价进入冻结区间且原模拟买入预检允许；收盘原账本没有关联成交',observations:window.map(reference)});
      else if(!touches.length)facts.push({rule:'按计划买入',status:'符合',evidence:'冻结后的有效时段采样已覆盖，已观察报价均未进入买入区间；未买入符合计划'});
      else if(touches.every(r=>r.entry.allowed===false))facts.push({rule:'按计划买入',status:'不适用',evidence:'已观察的区间触发均被原门禁拦截：'+touches.at(-1).entry.reason,observations:[reference(touches.at(-1))]});
      else facts.push({rule:'按计划买入',status:'资料不足',evidence:'已观察到区间触及，但缺少连续可用窗口或完整原买入预检；不能判定漏买',observations:[reference(touches.at(-1))]});
    }
    else if(context.ambiguous||context.entries.length!==1||!at||at<Date.parse(plan.frozenAt)||entry.tradeDate!==plan.intendedDate||
      !finite(entry.price))facts.push({rule:'按计划买入',status:'资料不足',evidence:'成交与事前冻结计划的时点关联未完成核对'});
    else facts.push({rule:'按计划买入',status:entry.price>=plan.entryMin&&entry.price<=plan.entryMax?'符合':'触发',
      evidence:`原账本成交 ${entry.price} 元；冻结区间 ${plan.entryMin}–${plan.entryMax} 元`,eventId:entry.eventId});
    if(!entry)facts.push({rule:'按计划止损',status:'不适用',evidence:'该计划没有买入成交'});
    else if(!at)facts.push({rule:'按计划止损',status:'资料不足',evidence:'原账本买入成交时点未知，待核对该截点的持仓及退出约束'});
    else if(entry.tradeDate===day)facts.push({rule:'按计划止损',status:'不适用',evidence:'当日开仓受原 A 股 T+1 限制，不要求当日卖出'});
    else {
      const active=samples.filter(r=>r.entryEventId===entry.eventId&&r.remainingQuantity>0);
      const touches=active.filter(r=>r.price<=plan.stop);
      const window=observer.hasObservedWindow(active,r=>r.price<=plan.stop&&r.exit.allowed===true);
      const closingSells=context.closedAt?context.sells.filter(s=>executionTimeOf(s)<=context.closedAt):[];
      const conditional=conditionalStopEvidence({plan,context,conditionalOrders,day,now:cutoff});
      const sampledFirst=touches.find(r=>r.exit.allowed===true);
      const firstAvailable=[sampledFirst,conditional.first].filter(Boolean).sort((a,b)=>a.observedAt-b.observedAt)[0];
      // A later repeated quote cannot erase an earlier missed stop window.
      const timely=firstAvailable&&context.closedAt>=firstAvailable.observedAt&&
        context.closedAt-firstAvailable.observedAt<=observer.MAX_GAP_MS&&closingSells.filter(s=>executionTimeOf(s)>firstAvailable.observedAt)
          .reduce((sum,s)=>sum+(fillEvidenceOf(s)?s.quantity:0),0)===
          (firstAvailable.remainingQuantity??conditional.remaining)?firstAvailable:null;
      const stopFills=context.sells.filter(s=>s.price<=plan.stop&&fillEvidenceOf(s));
      // Old intent records can prove a specific prompt, complete exit. They
      // cannot repair a gap in the full observer or prove an unobserved day.
      if(!samples.length&&closed&&conditional.timely){
        const sell=context.sells.at(-1),point=conditional.first;
        facts.push({rule:'按计划止损',status:'符合',eventId:sell.eventId,eventIds:context.sells.map(s=>s.eventId),
          evidence:`原报价 ${point.price} 元触及冻结止损，关联原买入批次在 ${context.closedAt-point.observedAt} 毫秒内已全部卖出；仅核验该已记录窗口，不代表全天采样完整`,
          observationScope:'recorded-trigger-window',sessionCoverageComplete:false,
          trigger:{source:point.source,quoteAt:point.quoteAt,observedAt:point.observedAt,price:point.price}});
      }
      else if(context.ambiguous||!coverage.complete||!closed)facts.push({rule:'按计划止损',status:'资料不足',evidence:
        context.ambiguous||(!closed?'待收盘核对实际离场和计划观察':'缺少完整采样覆盖或可成交窗口证据，不能判断漏止损；原账户退出规则保持')});
      else if(timely)facts.push({rule:'按计划止损',status:'符合',evidence:'观察到止损触及及原模拟可用窗口，关联批次在15秒采样窗口内已全部卖出',
        observations:[reference(timely)],eventIds:closingSells.map(s=>s.eventId)});
      else if(window)facts.push({rule:'按计划止损',status:'触发',evidence:context.remaining>0?
        '连续两次止损触及且原模拟约束允许卖出，收盘仍有本计划剩余持仓':
        '连续两次止损触及且原模拟约束允许卖出，关联批次未在该采样窗口内全部退出',observations:window.map(reference),
        remainingQuantity:context.remaining,eventIds:context.sells.map(s=>s.eventId)});
      else if(!touches.length&&!conditional.points.length&&!stopFills.length)facts.push({rule:'按计划止损',status:'符合',evidence:'持仓有效时段采样已覆盖，已观察报价均未触及冻结止损位'});
      else if(!touches.length&&!conditional.points.length&&stopFills.length&&context.closedAt&&context.closedAt-executionTimeOf(stopFills[0])<=observer.MAX_GAP_MS)
        facts.push({rule:'按计划止损',status:'符合',evidence:'原账本保留止损价成交证据并在同一15秒采样窗口清仓；此前已覆盖采样未见更早止损触及',eventIds:closingSells.map(s=>s.eventId)});
      else if(!conditional.points.length&&touches.length&&touches.every(r=>r.exit.allowed===false))facts.push({rule:'按计划止损',status:'不适用',
        evidence:'已观察的止损触及均被原模拟约束拦截：'+touches.at(-1).exit.reason,observations:[reference(touches.at(-1))]});
      else facts.push({rule:'按计划止损',status:'资料不足',evidence:'已出现止损价触及或部分卖出，但可用窗口、完整离场或时点证据不足；不推断漏止损',
        observations:touches.slice(-1).map(reference),eventIds:context.sells.map(s=>s.eventId)});
    }
    rows.push({planId:plan.id,planVersion:observer.planVersion(plan),code:plan.code,name:plan.name,day,entryDay:at?entry.tradeDate:null,
      remainingQuantity:context.remaining,coverage,facts});
  }
  const facts=rows.flatMap(r=>r.facts),assessed=facts.filter(f=>['符合','触发'].includes(f.status));
  const unknown=facts.filter(f=>f.status==='资料不足').length,passed=assessed.filter(f=>f.status==='符合').length;
  return {day,closed,score:closed&&assessed.length&&!unknown?Math.round(passed/assessed.length*100):null,
    assessed:assessed.length,passed,unknown,notApplicable:facts.filter(f=>f.status==='不适用').length,
    status:!closed?'待收盘':!rows.length?'无冻结计划':unknown?'证据待补齐':'已核验',rows,
    observation:{records:validObservations.length,plans:rows.length,coveredPlans:rows.filter(r=>r.coverage.complete).length,
      scope:observer.SCOPE,note:'5秒巡检、15秒最大采样间隔；仅核对原模拟约束，不保证真实盘口成交或采样之间走势'},
    note:'评分核对事前冻结计划、原账户持久成交及独立报价观察；采样缺口不归责漏买或漏止损，原交易规则保持。'};
}

module.exports={executeDecisionPlan,paperExecutionScore,validatePlan,planFill,planIdOf,decisionPlanPayload,authoritativePlanMatches,bindAuthoritativePlan};
