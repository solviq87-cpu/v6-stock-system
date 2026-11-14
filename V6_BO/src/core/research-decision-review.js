'use strict';
// Presentation projections only. No fetching, journal writes, trading or score mutation.
const flags = {researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false};
const arr = x => Array.isArray(x) ? x : [];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const text = (x, max=300) => typeof x === 'string' ? x.slice(0,max) : '';
const instant = x => Number.isSafeInteger(x) && x > 0 && x < 8640000000000000;
const known = (x, at) => instant(x) && x <= at;
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x) ? x : null;
const day = x => typeof x === 'string' && /^\d{4}-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
const dateAt = x => new Date(x + 8*3600000).toISOString().slice(0,10);
const safeDate = (x, at) => day(x) && x <= dateAt(at) ? x : null;

function buildHypothesisTimeline(state, asOf) {
  if (!instant(asOf)) throw Error('研究时间线需要明确时点');
  const hypotheses = arr(state?.hypotheses);
  if (hypotheses.length > 500 || arr(state?.outcomes).length > 500 || arr(state?.corrections).length > 1000) throw Error('研究时间线超限');
  const visible = hypotheses.filter(h => hash(h?.hypothesisHash) && known(h.decisionAt,asOf) && known(h.recordedAt,asOf));
  const ids = new Set();
  if (visible.some(h => ids.has(h.hypothesisHash) || !ids.add(h.hypothesisHash))) throw Error('研究时间线身份重复');
  visible.sort((a,b) => a.decisionAt-b.decisionAt || a.recordedAt-b.recordedAt || a.hypothesisHash.localeCompare(b.hypothesisHash));
  const outcomes = arr(state?.outcomes).filter(o => known(o?.knownAt,asOf) && known(o.recordedAt,asOf));
  const rows = visible.map((h,i) => {
    const outcome = outcomes.find(o => o.hypothesisHash === h.hypothesisHash && o.targetDate === h.targetDate);
    const previous = visible[i-1], before = new Set(arr(previous?.matchedPatternIds)), after = new Set(arr(h.matchedPatternIds));
    const changes = [];
    for (const key of ['prediction','state']) if (previous && previous[key] !== h[key]) changes.push({field:key,before:text(previous[key]),after:text(h[key])});
    return {id:h.hypothesisHash,targetDate:day(h.targetDate)?h.targetDate:null,signalDate:day(h.signalDate)?h.signalDate:null,
      decisionAt:h.decisionAt,recordedAt:h.recordedAt,dueAt:instant(h.dueAt)?h.dueAt:null,
      status:outcome?'evaluated':instant(h.dueAt)&&h.dueAt<=asOf?'awaiting-evidence':'pending',
      prediction:text(h.prediction),state:text(h.state),ruleVersion:text(h.ruleVersion),evidenceBundleHash:hash(h.evidenceBundleHash),
      observationHash:hash(h.observationHash),previousId:previous?.hypothesisHash||null,changes,
      addedPatterns:[...after].filter(x=>!before.has(x)).map(x=>text(x,90)),removedPatterns:[...before].filter(x=>!after.has(x)).map(x=>text(x,90)),
      outcome:outcome?{direction:text(outcome.outcome),matched:typeof outcome.matched==='boolean'?outcome.matched:null,knownAt:outcome.knownAt,recordedAt:outcome.recordedAt,evidenceBundleHash:hash(outcome.evidenceBundleHash)}:null,
      corrections:arr(state?.corrections).filter(c=>c.hypothesisHash===h.hypothesisHash&&known(c.knownAt,asOf)&&known(c.recordedAt,asOf)).length};
  });
  return {total:rows.length,limit:50,truncated:rows.length>50,rows:rows.slice(-50),...flags,
    meaning:'冻结研究判断的变化记录；不同目标日的差异不等于因果解释，结果修订不重写首次评价'};
}

function summarizeConditions(evaluations) {
  const rows = arr(evaluations).slice(0,100).map(r => {
    const checks = arr(r.checks), support=checks.filter(c=>c.pass===true&&!c.missing), opposition=checks.filter(c=>c.pass===false&&!c.missing), missing=checks.filter(c=>c.missing||c.pass!==true&&c.pass!==false);
    const describe=c=>({field:text(c.field,90),value:c.missing?null:c.value??null,op:text(c.op,20),threshold:c.threshold??null,
      reason:text(c.missing),source:text(c.evidence?.source,160),evidenceId:text(c.evidence?.evidenceId,200)});
    const status=r.status==='disabled'?'disabled':!checks.length||missing.length?'insufficient_data':opposition.length?'not_matched':'research_candidate';
    return {id:text(r.id,90),name:text(r.name,100),family:text(r.family,100),status,support:support.map(describe),opposition:opposition.map(describe),missing:missing.map(describe),invalidation:text(r.invalidation,500)};
  });
  const counts=Object.fromEntries(['disabled','insufficient_data','not_matched','research_candidate'].map(k=>[k,rows.filter(r=>r.status===k).length]));
  const needs=new Map();
  for(const r of rows.filter(r=>r.status!=='disabled'))for(const c of r.missing){if(!needs.has(c.field))needs.set(c.field,new Set());needs.get(c.field).add(r.id);}
  return {total:rows.length,counts,rows,missingFields:[...needs].map(([field,ids])=>({field,strategies:[...ids]})),
    mixedConditions:rows.some(r=>r.status==='research_candidate')&&rows.some(r=>r.status==='not_matched'),
    meaning:'同一股票的规则覆盖分布；不是全市场选股淘汰数量，不将相关策略重复计为独立票数'};
}

function summarizeRuleDisagreement(systems) {
  const rows=[];
  function add(id,label,s,coverageOnly=false){
    const rules=arr(s?.rules||s?.dimensions), available=s?.available!==false && rules.length>0;
    const counts={pass:0,fail:0,unknown:0};
    for(const r of rules)counts[['pass','fail'].includes(r.status)?r.status:'unknown']++;
    rows.push({id,label,available,coverageOnly,counts,
      support:coverageOnly?[]:rules.filter(r=>r.status==='pass').map(r=>text(r.label||r.id,100)),
      opposition:coverageOnly?[]:rules.filter(r=>r.status==='fail').map(r=>text(r.label||r.id,100)),
      missing:rules.filter(r=>!['pass','fail'].includes(r.status)).map(r=>text(r.label||r.id,100)),
      reason:!available?text(s?.reason)||'未提供可核对条件':coverageOnly?'八字维度的pass表示有评分证据，不自动解释为看多':'条件命中与未命中分别保留'});
  }
  add('fourteen','十四条',systems?.fourteen);add('bazi','八字口诀',systems?.bazi,true);
  arr(systems?.gpt).forEach((s,i)=>add('gpt-'+i,'GPT · '+text(s.name,80),s));add('python','Python 三轮',systems?.python);
  return {rows,mixedConditions:rows.some(r=>r.support.length)&&rows.some(r=>r.opposition.length),
    rankingModified:false,combinedScore:null,probability:null,
    note:'显示条件分歧，不把不同门槛当作买卖投票；缺失保持未知，四体系评分不相加'};
}

function buildScreeningFunnel(items) {
  let remaining=arr(items).slice();
  const steps=[];
  for(const [id,label,test,reason]of [
    ['quality','来源与数据质量',x=>x.quality?.usable,x=>arr(x.quality?.errors).join('；')||'来源或数据证据不足'],
    ['risk','原有风险过滤',x=>typeof x.blockedBySafety==='boolean'?!x.blockedBySafety:null,x=>arr(x.strategy?.riskFilter?.reasons).join('；')||'原有安全条件未通过'],
    ['strategy','原有策略条件',x=>x.strategy?.pass,()=> '原有策略条件未通过或缺少评估'],
    ['eligibility','原有候选资格',x=>x.tradable,x=>x.quality?.fresh===false?'数据不满足原有时效要求':'候选资格未通过或未知']
  ]){
    const before=remaining.length,rejected=remaining.filter(x=>test(x)!==true);
    remaining=remaining.filter(x=>test(x)===true);
    steps.push({id,label,before,after:remaining.length,removed:rejected.length,unknown:rejected.filter(x=>test(x)!==false).length,
      samples:rejected.slice(0,5).map(x=>({symbol:text(x.symbol,20),name:text(x.name,100),reason:text(reason(x),500)}))});
  }
  return {total:arr(items).length,remaining:remaining.length,steps,rankingModified:false,
    meaning:'本次输入池按现有判定顺序对账；每只股票只在首次淘汰步骤计数，不扩张为全市场覆盖，不授予交易许可'};
}

function buildDecisionReview(result, {viewAt=result?.asOf}={}) {
  const r=result||{}, at=r.asOf;
  if(!instant(at)||!instant(viewAt)||viewAt<at)throw Error('研究详情缺少明确时点');
  const s=r.stock||{}, b=r.evidenceBundle||{}, h=r.history||{}, f=r.currentFormation||{};
  const validBundle=hash(b.hash)&&b.symbol===s.symbol&&b.provider===s.provider&&b.priceBasis===s.priceBasis&&
    b.observationHash===r.observation?.observationHash&&known(b.decisionAt,at)&&known(b.recordedAt,viewAt);
  const refs=validBundle?arr(b.sourceRefs).slice(0,200).map(x=>({source:text(x.source,160),sha256:hash(x.sha256),receivedAt:known(x.receivedAt,at)?x.receivedAt:null})):[];
  const evidence=[];
  function item(id,label,observed,source,publishedAt,receivedAt,reason,extra={}){
    evidence.push({id,label,status:observed?'observed-unverified':'unknown',source:text(source,160)||null,
      sourceTimestamp:known(publishedAt,at)?publishedAt:null,receivedAt:known(receivedAt,at)?receivedAt:null,reason,...extra});
  }
  item('daily','日K',arr(s.bars).length>0&&known(s.observedAt,at),h.source||s.source,h.sourceTimestamp,h.retrievedAt,
    '日K是历史观察；接收时间不代表供应商发布时间或实时可交易报价',{tradeDate:safeDate(h.tradeDate,at)});
  item('formation','当前价格形态',f.patterns?.usable===true&&known(f.availableAt,at),s.source,null,f.availableAt,'仅价格形态，交易资格及公司行为另验');
  item('calendar','交易日历',r.calendar?.status==='available',r.calendar?.source,null,null,text(r.calendar?.reason)||'下一交易日只取明确日历');
  item('context','市场与板块快照',!!validBundle&&b.marketContext?.status==='observed-unverified',b.marketContext?.source,b.marketContext?.sourceTimestamp,b.marketContext?.retrievedAt,
    validBundle?'与本次观察绑定的冻结上下文；各字段仍需核对日期':'封存引用与当前股票、来源、观察版本或时点不一致');
  const hypothesis=r.priceEventResearch?.currentHypothesis, frozen=r.hypothesisEvidence;
  const frozenOK=!!hash(hypothesis?.evidenceBundleHash)&&frozen?.hash===hypothesis.evidenceBundleHash&&frozen.symbol===s.symbol&&frozen.provider===s.provider&&
    known(frozen.decisionAt,hypothesis.decisionAt)&&known(frozen.recordedAt,hypothesis.recordedAt)&&known(hypothesis.recordedAt,viewAt);
  item('frozen','原判断封存证据',frozenOK,frozen?.provider,null,frozen?.recordedAt,frozenOK?'原判断单独保留，不用新上下文替换':'原判断封存证据缺失或引用不一致');
  const ruleOK=r.research36?.code===s.symbol&&known(r.research36?.asOf,at);
  const conditions=summarizeConditions(ruleOK?r.research36.evaluations:[]);
  const linkage=r.linkage||{}, linkOK=linkage.tradeDate===h.tradeDate&&safeDate(h.tradeDate,at);
  const boards=linkOK?arr(linkage.memberBoards).slice(0,6).map(x=>{
    const dated=x.sameQuoteDate===true&&x.quoteDate===h.tradeDate&&known(x.membersObservedAt,at)&&known(x.quoteAt,at);
    return {code:text(x.code,30),name:text(x.name,100),category:text(x.category,30),quoteDate:safeDate(x.quoteDate,at),
      status:dated?'same-date-observation':'date-or-time-unknown',changePct:dated&&finite(x.changePct)?x.changePct:null,
      mainNetInflow:dated&&finite(x.mainNetInflow)?x.mainNetInflow:null,role:'unknown',phase:'unknown'};
  }):[];
  const event=r.priceEventResearch||{}, timeline=event.timeline||{total:0,limit:50,truncated:false,rows:[]};
  const current=arr(timeline.rows).find(x=>x.id===hypothesis?.hypothesisHash)||null;
  const blockers=arr(r.readiness?.blockers).map(x=>text(x)).filter(Boolean);
  const nextChecks=[...new Set([...blockers,...conditions.missingFields.map(x=>'补齐 '+x.field),...(!frozenOK&&hypothesis?['核对原判断封存证据']:[])])].slice(0,50);
  const validation=event.forwardValidation||{};
  const diagnostics=[{stage:'行情观察',status:text(h.status)||'unknown'},{stage:'归档证据',status:validBundle?'linked':'unknown'},
    {stage:'研究记忆',status:text(r.memory?.status)||'unknown'},{stage:'冻结判断',status:text(event.status)||'unknown'},
    {stage:'复访安排',status:text(r.researchFollowups?.status)||'unknown'}];
  return {schemaVersion:1,mode:'research-decision-review',...flags,symbol:text(s.symbol,6),provider:text(s.provider,160),asOf:at,viewAt,
    observationRevision:r.observation?.revision??null,evidenceBundleHash:validBundle?b.hash:null,tradeDate:safeDate(h.tradeDate,at),
    evidence,sourceRefs:refs,conditions,timeline,current,
    action:{label:'仅研究观察',currentState:current?.status||'unknown',nextCheckAt:current?.status==='pending'?current.dueAt:null,
      dueAt:current?.dueAt||null,nextChecks,prohibited:['旧行情不能作为实时入场依据','条件分与历史匹配频率不能替代涨停概率','研究结果不触发下单或外部通知']},
    marketPosition:{boards,role:'unknown',phase:'unknown',reason:'板块归属与同日数据可解释背景；缺少角色及阶段证据时不推断龙头或主线'},
    scorecard:{objective:text(event.objective),evaluated:Number.isSafeInteger(validation.evaluated)?validation.evaluated:null,
      independentTargetDays:Number.isSafeInteger(validation.independentTargetDays)?validation.independentTargetDays:null,
      matchFrequency:finite(validation.rawCandleMatchFrequency)?validation.rawCandleMatchFrequency:null,
      brier:finite(validation.brier)?validation.brier:null,minIndependentDays:validation.minIndependentDays??null,
      meaning:'原始日K收盘相对开盘的冻结研究结果；不是账户收益、涨停概率或四体系收益排名'},
    diagnostics};
}
module.exports={buildDecisionReview,buildHypothesisTimeline,summarizeConditions,summarizeRuleDisagreement,buildScreeningFunnel};
