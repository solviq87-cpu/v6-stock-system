'use strict';

// This adapter never changes sizing, exits, cash or positions. A confirmed plan
// can only call the existing paperBuy path, then report its committed fill.
const {aShareCalendarDate} = require('./a-share-calendar');
const {executionTimeOf} = require('./paper-fill-evidence');
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
  return card?.authority==='fayo-decision-center'&&/^[a-f0-9]{64}$/.test(card.decisionId||'')&&
    card.code===plan.code&&card.day===plan.intendedDate&&card.strategyAt===plan.decisionEvidence.strategyAt&&
    card.quoteBasis?.source===plan.decisionEvidence.quoteBasis?.source&&finite(card.plan?.positionPct)&&card.plan.positionPct>0;
}

function planFill(book, planId) {
  // The account service verifies these event hashes before returning the book.
  for (const period of [...(book?.archives || []), book].filter(Boolean)) {
    const event = (period.account?.events || []).find(e => e.side === 'buy' && planIdOf(e.reason) === planId);
    if (event) return event;
  }
  return null;
}

function executeDecisionPlan({input, plan, now=Date.now(), day=aShareCalendarDate(now), replica,
  continuous, candidate, eligiblePick, systemPickDay, poolDay, newsBlocked,
  account, policy, equity, quote, authoritative, readBook, buy}) {
  if (replica) throw Error('当前为副本，请在原主实例确认模拟计划');
  if (!input || input.account !== 'pool' || !planIdOk(input.planId) || input.planId !== plan?.id ||
      Object.keys(input).some(k => !['action','account','planId','token'].includes(k))) throw Error('模拟计划请求无效');
  validatePlan(plan, now);
  const previous = planFill(readBook(), plan.id);
  if (previous) return {ok:true,status:'already-executed',planId:plan.id,code:plan.code,
    eventId:previous.eventId,price:previous.price,shares:previous.quantity,msg:'该计划已有持久成交流水，未重复买入'};
  if (plan.intendedDate !== day || aShareCalendarDate(Date.parse(plan.frozenAt)) !== day)
    throw Error('计划日期已失效，请回到今日作战台重新核对');
  if(!currentDecisionAllows(plan,authoritative))throw Error('后端权威候选、策略批次或来源已变化，请刷新作战台；未按客户端价格成交');
  if (!continuous) throw Error('仅在原连续竞价时段确认模拟买入，当前没有排入待成交队列');
  if (!candidate || candidate.code !== plan.code || !eligiblePick(candidate) ||
      systemPickDay(candidate,poolDay,now) !== day || newsBlocked) throw Error('该股当前已不符合原候选条件');
  if (!account || account.enabled !== true) throw Error('原模拟跟踪账户尚未启用');
  if (account.positions?.[plan.code]) throw Error('原账户已有该股持仓，本次未追加买入');
  if (!quote || !finite(quote.price) || quote.price < plan.entryMin || quote.price > plan.entryMax)
    throw Error('最新原始报价未进入计划买入区间；没有成交或后台挂单');
  const quoteAt = quote.quoteAt ?? quote.timestamp;
  if (!Number.isSafeInteger(quoteAt) || quoteAt <= 0 || quoteAt > now || now-quoteAt > 15000 ||
      aShareCalendarDate(quoteAt) !== day) throw Error('原始报价过期、缺失或日期不一致');
  if (!finite(equity) || equity <= 0 || !finite(account.cash) || account.cash < 0 ||
      !Number.isSafeInteger(policy?.maxPos) || policy.maxPos < 1) throw Error('原账户预算尚未完成核对');
  const allocationPct = Math.min(account.cash,equity/policy.maxPos*.98)/equity*100;
  if (allocationPct > Math.min(plan.maxPosition,authoritative.plan.positionPct)+1e-7)
    throw Error('原账户等权预算超出冻结计划或当前风险仓位，请重新核对；未修改账户分仓规则');
  buy(candidate,reasonOf(plan));
  const committed = planFill(readBook(),plan.id);
  if (!committed) throw Error('原模拟门禁未产生持久成交，请核对报价、涨停、持仓上限、资金或账本回执');
  return {ok:true,status:'executed',planId:plan.id,code:plan.code,eventId:committed.eventId,
    price:committed.price,shares:committed.quantity,msg:'已通过原模拟门禁并核对持久成交；退出仍按原账户止损规则'};
}

function paperExecutionScore({book,plans=[],day,now=Date.now()}) {
  if (!dateOk(day)) throw Error('执行评分日期无效');
  const closed = now >= Date.parse(day+'T15:00:00+08:00');
  const rows=[], index=new Map(plans.filter(p=>{
    try{validatePlan(p,now);return p.intendedDate<=day;}catch{return false;}
  }).map(p=>[p.id,p]));
  const events=[...(book?.archives||[]),book].filter(Boolean).flatMap(p=>p.account?.events||[]);
  const seen=new Set();
  for(const e of events){
    if(!e.eventId||seen.has(e.eventId))throw Error('成交流水缺少唯一事件编号');
    seen.add(e.eventId);
  }
  for(const plan of index.values()){
    const entries=events.filter(e=>e.side==='buy'&&planIdOf(e.reason)===plan.id&&e.symbol===plan.code);
    const entry=entries[0],at=entry?executionTimeOf(entry):null;
    if(plan.intendedDate!==day && (!entry||entry.tradeDate>day))continue;
    // An older position only belongs to this day's review while still held or
    // if it has a sale on this day. Never attach a later round trip by code.
    const sells=entry?events.filter(e=>e.side==='sell'&&e.symbol===plan.code&&
      executionTimeOf(e)>at&&e.tradeDate<=day).sort((a,b)=>executionTimeOf(a)-executionTimeOf(b)):[];
    const sell=sells[0];
    if(plan.intendedDate!==day&&sell?.tradeDate<day)continue;
    const facts=[];
    if(!entry)facts.push({rule:'按计划买入',status:'资料不足',evidence:'尚无关联的持久买入成交；缺少全天区间触发证据，不能判定漏买'});
    else if(entries.length!==1||!at||at<Date.parse(plan.frozenAt)||entry.tradeDate!==plan.intendedDate||
      !finite(entry.price))facts.push({rule:'按计划买入',status:'资料不足',evidence:'成交与事前冻结计划的时点关联未完成核对'});
    else facts.push({rule:'按计划买入',status:entry.price>=plan.entryMin&&entry.price<=plan.entryMax?'符合':'触发',
      evidence:`原账本成交 ${entry.price} 元；冻结区间 ${plan.entryMin}–${plan.entryMax} 元`,eventId:entry.eventId});
    if(!entry)facts.push({rule:'按计划止损',status:'不适用',evidence:'该计划没有买入成交'});
    else if(entry.tradeDate===day)facts.push({rule:'按计划止损',status:'不适用',evidence:'当日开仓受原 A 股 T+1 限制，不要求当日卖出'});
    else facts.push({rule:'按计划止损',status:'资料不足',evidence:sell?
      `原账户已于 ${sell.tradeDate} 以 ${sell.price} 元卖出；缺少计划止损触发及可成交窗口证据，不能推断执行及时性`:
      '仍按原账户 ATR / 移动止损巡检；缺少计划止损触发及可成交窗口证据'});
    rows.push({planId:plan.id,code:plan.code,name:plan.name,day,entryDay:entry?.tradeDate||null,facts});
  }
  const facts=rows.flatMap(r=>r.facts),assessed=facts.filter(f=>['符合','触发'].includes(f.status));
  const unknown=facts.filter(f=>f.status==='资料不足').length,passed=assessed.filter(f=>f.status==='符合').length;
  return {day,closed,score:closed&&assessed.length&&!unknown?Math.round(passed/assessed.length*100):null,
    assessed:assessed.length,passed,unknown,notApplicable:facts.filter(f=>f.status==='不适用').length,
    status:!closed?'待收盘':!rows.length?'无冻结计划':unknown?'证据待补齐':'已核验',rows,
    note:'评分只核对事前冻结计划与原账户持久成交；缺失的触发和可成交窗口不计为通过。'};
}

module.exports={executeDecisionPlan,paperExecutionScore,validatePlan,planFill,planIdOf,decisionPlanPayload,authoritativePlanMatches,bindAuthoritativePlan};
