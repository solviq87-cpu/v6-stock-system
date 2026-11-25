import { kLearningRows } from './backtest.mjs';
import { emotion,marketAsOf } from './market.mjs';
import { settingsAt } from './settings.mjs';
import { pressureLearningTags } from './pressure.mjs';
import { isTestSample,sampleMatches } from './sample-quality.mjs';
import { stats,weightedQuartile,groupedPerformance,decayAlerts,attributionCloud,renderLearningSnapshot } from './factor-performance.mjs';
import {dictionaryVersion,factorDictionary} from './factor-dictionary.mjs';
import {MODEL,readNumericCheck,fitNumericModel,numericScore,projectNumeric,validModel,fingerprint,stable} from './numeric-factors.mjs';
export {stats,renderLearningSnapshot};

const MINUTE = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const stages = ['训练集验证','时间外验证','样本外测试','成本压力校验','风险检查'];
const round = x => Number.isFinite(x) ? +x.toFixed(2) : null;
const now = () => new Date().toISOString();
const localTime = (when = Date.now()) => new Date(when + 8 * 3600000).toISOString().slice(0,16);
const asDate = x => String(x || '').slice(0,10);
const unique = xs => [...new Set(xs.filter(Boolean))];
const words = x => unique((Array.isArray(x) ? x : String(x || '').split(/[,，、\n]/)).map(t => String(t).trim().slice(0,100))).slice(0,64);
const id = prefix => prefix + '-' + crypto.randomUUID();
const avg = xs => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : null;
const lastVersion = state => [...(state.versions || [])].reverse().find(v => v.approvedAt && v.weights&&(state.scope==='demo'||v.sampleScope!=='demo')) || null;
function required(s,label,max=200) {
  const v = String(s ?? '').trim();
  if (!v || v.length > max) throw Error('请填写有效的' + label);
  return v;
}
function num(s,label,min,max) {
  const v = Number(s);
  if (s == null || String(s).trim() === '' || !Number.isFinite(v) || v < min || v > max) throw Error(label+'须在 '+min+' 至 '+max+' 之间');
  return v;
}
function stamp(t,label) {
  const s=required(t,label);
  if (!MINUTE.test(s) || !Number.isFinite(Date.parse(s+'Z')) || new Date(s+'Z').toISOString().slice(0,16)!==s) throw Error(label+'格式无效');
  return s;
}
function symbol(s) {
  if (typeof s!=='string'||!/^\d{6}$/.test(s)) throw Error('股票代码须为六位数字');
  return s;
}
function ordered(rows) {
  return [...rows].filter(t => t.pnl!=null && Number.isFinite(+t.pnl)).sort((a,b) => String(a.exitTime || a.exitDate || a.date).localeCompare(String(b.exitTime || b.exitDate || b.date)));
}
function strategyList(r) {return words(r.strategies?.length ? r.strategies : r.strategy);}
const dictionaryCode=k=>/^[A-Z]{2,6}-\d{2,4}$/.test(k);
function evidenceCodes(check,at){return check&&Number.isFinite(Date.parse(check.createdAt))&&Date.parse(check.createdAt)<=at&&(!check.asOf||instant(check.asOf)<=at)?words(check.factorCodes).filter(dictionaryCode):[];}
function known(r) {return unique([...words(r.factors),...words(r.knownRiskFactors),...words(r.customTags).map(t=>'自定义·'+t)]);}
function cutAt(input=Date.now()){
  if(typeof input==='number'||typeof input==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/i.test(input)){
    const ms=typeof input==='number'?input:Date.parse(input);
    return Number.isFinite(ms)?localTime(ms):'';
  }
  const s=String(input||'').replace(' ','T');
  const minute=/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T00:00':s.slice(0,16);
  return MINUTE.test(minute)&&Number.isFinite(Date.parse(minute+'Z'))&&new Date(minute+'Z').toISOString().slice(0,16)===minute?minute:'';
}
function instant(s){
  if(typeof s==='number')return s;
  if(typeof s==='string'&&/(?:Z|[+-]\d\d:\d\d)$/i.test(s))return Date.parse(s);
  const point=cutAt(s);return point?Date.parse(point+':00+08:00'):NaN;
}
function policyAt(state,asOf){
  const s=settingsAt(state,asOf);
  return {decayEnabled:s.decayEnabled===true,decayHalfLifeDays:s.decayHalfLifeDays||120,settingsVersion:s.version,asOf};
}
function settlementNumeric(state,row,check){
  const entry=instant(row.entryTimestamp??row.entryTime),exit=instant(row.exitTimestamp??row.exitTime),recorded=instant(row.createdAt);
  const plan=(state.plans||[]).find(item=>item.id===row.planId),frozen=instant(plan?.frozenAt);
  const synthetic=item=>!item||isTestSample(item)||item.synthetic===true||item.mock===true||
    /(?:^|[-_: /])(fixture|simulated|synthetic|mock|demo)(?:$|[-_: /])/i.test(String(item.source||''));
  if(synthetic(row)||synthetic(plan)||synthetic(check)||!row.snapshotVerified||!plan||plan.code!==row.code||!check||check.code!==row.code||
      !Number.isFinite(entry)||!Number.isFinite(exit)||!Number.isFinite(recorded)||!Number.isFinite(frozen)||
      frozen>entry||exit<=entry||exit>recorded||asDate(localTime(exit))<=asDate(localTime(entry))||
      ![row.entryPrice,row.exitPrice,row.shares,row.cost,row.pnl].every(Number.isFinite)||
      row.entryPrice<=0||row.exitPrice<=0||!Number.isSafeInteger(row.shares)||row.shares<=0||row.cost<0)return null;
  const amount=(row.exitPrice-row.entryPrice)*row.shares-row.cost,grossBasis=row.entryPrice*row.shares;
  let returnBasis=grossBasis;
  if(row.paperSettlement){
    const proof=row.paperSettlement;
    if(proof.symbol!==row.code||![proof.costBasisCents,proof.realizedCents,proof.exitGrossCents,proof.exitFeeCents].every(Number.isSafeInteger)||
        !Number.isFinite(row.costBasis)||Math.abs(row.costBasis*100-proof.costBasisCents)>.001||
        proof.costBasisCents<Math.round(grossBasis*100)||proof.costBasisCents<=0||
        proof.exitGrossCents-proof.exitFeeCents-proof.costBasisCents!==proof.realizedCents||
        Math.abs(amount*100-proof.realizedCents)>1||Math.abs(row.cost-(row.costBasis-grossBasis+proof.exitFeeCents/100))>.011)return null;
    returnBasis=proof.costBasisCents/100;
  }
  const net=amount/returnBasis*100;
  if(Math.abs(row.pnl-net)>.011||Number.isFinite(row.pnlAmount)&&Math.abs(row.pnlAmount-amount)>.011)return null;
  let vector=readNumericCheck(check,state.catalog||[],entry);
  const dictionary=factorDictionary(state.catalog||[]);
  for(const id of Object.keys(vector.values))if(!dictionary.byCode.has(id)){
    delete vector.values[id];delete vector.definitions[id];delete vector.evidence[id];
  }
  if(plan.decisionAuthority==='fayo-decision-center'){
    // A workbench plan learns only from the exact observations frozen by its
    // native preparation job. An old plan without this reference stays unknown;
    // replacing the contents of a check with the same id cannot backfill it.
    const ref=plan.researchFactorReference,point=instant(ref?.decisionAt),ids=ref?.factorIds;
    if(ref?.schema!=='fayo-plan-factor-reference-v1'||ref.status!=='linked'||ref.code!==row.code||
      ref.checkId!==check.id||ref.checkId!==plan.checkId||ref.checkId!==row.checkId||ref.signalDay!==check.date||
      ref.targetDay!==plan.intendedDate||ref.decisionId!==plan.decisionId||ref.frozenAt!==plan.frozenAt||
      ref.checkCreatedAt!==check.createdAt||ref.checkAsOf!==check.asOf||ref.dictionaryVersion!==dictionaryVersion||
      !Number.isFinite(point)||point>frozen||instant(check.createdAt)>point||
      plan.decisionEvidence?.calculatedAt!==ref.decisionAt||ref.checkFingerprint!==fingerprint(check)||
      !Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||!ref.numericFactors||
      !ref.calendarEvidence||ref.calendarEvidence.from!==check.date||ref.calendarEvidence.to!==plan.intendedDate||
      ref.calendarEvidenceFingerprint!==fingerprint(ref.calendarEvidence)||
      ids.some(id=>!Number.isFinite(vector.values[id])||!vector.definitions[id]||!vector.evidence[id]))return null;
    const values=Object.fromEntries(ids.map(id=>[id,vector.values[id]]));
    const definitions=Object.fromEntries(ids.map(id=>[id,vector.definitions[id]]));
    const evidence=Object.fromEntries(ids.map(id=>[id,vector.evidence[id]]));
    if(ref.factorDefinitionFingerprint!==fingerprint(definitions)||
      ref.observationFingerprint!==fingerprint({values,definitions,evidence})||
      stable(ref.numericFactors)!==stable({values,definitions}))return null;
    vector={values,definitions,evidence};
  }
  return Object.keys(vector.values).length?{values:vector.values,definitions:vector.definitions,evidence:vector.evidence,
    checkId:check.id,knownAt:check.createdAt,signalDay:check.date,settlementKnownAt:Math.max(exit,recorded),
    returnBasis:row.paperSettlement?'original-fee-inclusive-cost-basis':'recorded-entry-gross',
    settlementFingerprint:fingerprint({entryPrice:row.entryPrice,exitPrice:row.exitPrice,shares:row.shares,cost:row.cost,pnl:row.pnl,
      pnlAmount:row.pnlAmount,returnBasis,originalSettlement:row.paperSettlement||null})}:null;
}
function rowsFor(state,asOf=Date.now(),strict=false,{selection='standard',includeTest=false}={}) {
  const cut=cutAt(asOf),end=instant(asOf);
  if(!cut||!Number.isFinite(end))return [];
  const allowTests=state.scope==='demo'||includeTest===true;
  const accept=r=>sampleMatches(r,selection)&&(allowTests||!isTestSample(r));
  const manual=[],checks=new Map((state.checks||[]).map(c=>[c.id,c])),numericSignals=new Set();
  for(const r of state.trades||[]){
    if(!accept(r)||strict&&r.snapshotVerified!==true)continue;
    const exit=cutAt(r.exitTime||(r.exitDate||r.date)+'T15:00');
    const original=r.createdAt??r.recordedAt??'',captured=cutAt(original);
    if(!exit||!captured||instant(exit)>end||instant(original)>end)continue;
    const check=checks.get(r.checkId);
    const codes=check?.code===r.code?evidenceCodes(check,instant(r.entryTime)):[];
    const signalKey=check?.code+'/'+check?.id;
    const numericFactors=numericSignals.has(signalKey)?null:settlementNumeric(state,r,check);
    if(numericFactors)numericSignals.add(signalKey);
    manual.push({...r,numericFactors,factors:unique([...words(r.factors),...codes,...pressureLearningTags(state,r,r.entryTime)]),labelKnownAt:exit>captured?exit:captured,...(strict?{strategies:[r.strategy],labels:r.frozenLabels||{}}:{})});
  }
  const kr=kLearningRows(state,cut.replace('T',' '),{includeTests:allowTests,quality:selection});
  const k=kr.filter(r=>accept(r)&&cutAt(r.exitTime||r.exitDate+'T15:00')&&cutAt(r.exitTime||r.exitDate+'T15:00')<cut).map(r=>({...r,
    labelKnownAt:cutAt(r.exitTime||r.exitDate+'T15:00'),trend:r.trend||r.indexTrend||r.environment,factors:unique([...words(r.factors),...pressureLearningTags(state,r,r.decisionAt)])}));
  return [...manual,...k];
}
function factorSet(r) {
  const labelNames={cycle:'情绪',volume:'指数量能',indexPosition:'指数位置',breadth:'广度',resonance:'共振',theme:'题材',ladder:'梯队',identity:'辨识度',stockPosition:'个股位置',turnover:'换手',stockVolume:'个股量能',support:'承接',shape:'K线形态',structure:'平台结构',maState:'均线排列',volumeRun:'连续量能',relation:'量价关系',themeCycle:'题材周期',chipExchange:'筹码交换'};
  const tags=Object.entries(labelNames).filter(([k])=>r.labels?.[k]&&!['未记录','未判定','缺失','—'].includes(r.labels[k])).map(([k,l])=>l+'·'+r.labels[k]);
  return unique([...known(r),...tags,...strategyList(r).map(x=>'战法·'+x),...(r.trend?['环境·'+r.trend]:[])]);
}
function weightedScore(weights,factors) {
  const vals=unique(factors).filter(f=>Object.hasOwn(weights||{},f)).map(f=>weights[f]);
  return vals.length?round(vals.reduce((a,b)=>a+b,0)/Math.sqrt(vals.length)):0;
}
export function predict(state,input={}) {
  const asOf=input.asOf||Date.now(),cut=cutAt(asOf), factors=words(input.factors), scope=strategyList(input);
  const v=[...(state.versions||[])].reverse().find(v=>(state.scope==='demo'||v.sampleScope!=='demo')&&v.approvedAt && v.weights && Date.parse(v.approvedAt)<=instant(asOf));
  const rows=rowsFor(state,asOf,true).filter(r=>(!input.trend||input.trend===r.trend)&&(!scope.length||strategyList(r).some(s=>scope.includes(s)))&&factors.every(f=>known(r).includes(f)));
  const gate=v?.strategyThresholds?.[scope[0]]??v?.threshold??-Infinity;
  const s=stats(rows,policyAt(state,cut));
  const numericResult=v?.numericModel?numericScore(v.numericModel,input.numericFactors):null;
  const modelValid=!v?.numericModel||v.numericModel.dictionaryVersion===dictionaryVersion&&validModel(v.numericModel)&&
    stable(v.weights)===stable(v.numericModel.weights)&&v.scoringFingerprint===fingerprint(scoringState(v));
  const score=numericResult?(modelValid&&Number.isFinite(numericResult.score)?round(numericResult.score):null):weightedScore(v?.weights||{},factorSet(input));
  const support=v?.minSupport||6;
  return {...s,score,version:v?.number||0,factorSchema:v?.numericModel?.schema||'legacy-presence-weights',
    ...(numericResult?{modelFingerprint:v.numericModel.fingerprint,numericMissing:modelValid?numericResult.missing:['获批模型/词典/评分指纹不一致']}:{}),
    risk:numericResult&&score===null?'已审批数值模型缺少同定义的当时观察':s.n<support?'同类样本不足':s.lossRate>=60?'同类组合亏损频率偏高':score<=gate?'低于已审批候选评分阈值':'历史样本可供参考'};
}
const scoringState=value=>({weights:value.weights,threshold:value.threshold,strategyThresholds:value.strategyThresholds,minSupport:value.minSupport,numericModel:value.numericModel||null});
const validationState=value=>({...scoringState(value),baseVersion:value.baseVersion,sourceIds:value.sourceIds,
  start:value.start,trainEnd:value.trainEnd,validationEnd:value.validationEnd,end:value.end,steps:value.steps});
function attribution(t) {
  const keys=known(t);
  const choices=t.pnl>0 ? ['共振','发酵','辨识度','换手','承接'] : ['错配','利空','兑现','杀跌','流动性','退潮'];
  return keys.filter(f=>choices.some(k=>f.includes(k))).join('、') || '待人工复核';
}
function archivePlan(state,p) {
  const checked=p.checkId ? (state.checks||[]).find(c=>c.id===p.checkId) : null;
  if(p.checkId && !checked) throw Error('校验记录不存在');
  const code=symbol(p.code),strategy=required(p.strategy,'计划战法');
  if(checked && checked.code!==code)throw Error('关联的校验记录与计划标的不一致');
  const entryMax=num(p.entryMax,'开仓价格上限',0.001,100000);
  const entryMin=p.entryMin==null||p.entryMin===''?null:num(p.entryMin,'开仓价格下限',0.001,100000);
  const stop=num(p.stop,'止损价格',0.001,100000), target=num(p.target,'止盈价格',0.001,100000);
  if(!(stop<entryMax && target>entryMax))throw Error('价格应满足止损位 < 入场上限 < 止盈位');
  if(entryMin!==null && !(stop<entryMin && entryMin<=entryMax))throw Error('价格应满足止损位 < 入场下限 ≤ 入场上限');
  const frozenAt=now(), holdUntil=p.holdUntil?stamp(p.holdUntil,'最早计划离场时间'):'';
  if(holdUntil && holdUntil<=localTime(Date.parse(frozenAt)))throw Error('计划离场时间应晚于冻结时间');
  const tradingTime=localTime(Date.parse(frozenAt)),tradeDay=asDate(tradingTime);
  if(checked?.date>tradeDay||checked?.createdAt>frozenAt)throw Error('校验记录晚于计划冻结时点');
  const visible=marketAsOf(state,tradeDay,tradingTime),close=visible.at(-1);
  const labels=close?{cycle:emotion(visible,close.date).stage,volume:close.volume,indexPosition:close.indexPosition,resonance:close.resonance,theme:close.themeType}:{cycle:'未判定'};
  const intendedDate=p.intendedDate?asDate(stamp(p.intendedDate+'T09:30','计划执行日期')):null;
  if(intendedDate && intendedDate<tradeDay)throw Error('计划执行日期早于冻结时间');
  const expectedAuctionGap=p.expectedAuctionGap!=null&&p.expectedAuctionGap!==''?num(p.expectedAuctionGap,'预期竞价涨幅',-100,100):null;
  const allowedTags=settingsAt(state,frozenAt).customTags||[];
  const customTags=words(p.customTags);
  if(customTags.some(t=>!allowedTags.includes(t)))throw Error('自定义标签须在计划冻结时已经启用');
  const plan={id:id('plan'),customTags,sampleSet:state.scope==='demo'||isTestSample(p)||isTestSample(checked)?'test':'real',labels,frozenAt,code,intendedDate,expectedAuctionGap,name:required(p.name,'标的名称',40),strategy,entryMax,maxPosition:num(p.maxPosition,'仓位上限',0.01,100),stop,target,holdUntil,logic:required(p.logic,'开仓逻辑',2000),expectedRR:round((target-entryMax)/(entryMax-stop)),checkId:checked?.id||null,trend:required(p.trend,'指数趋势',20),factors:unique([...words(p.factors).filter(k=>!dictionaryCode(k)),...words(checked?.factors),...evidenceCodes(checked,Date.parse(frozenAt))]),knownRiskFactors:unique([...words(p.knownRiskFactors),...words(checked?.risks)])};
  if(entryMin!==null)plan.entryMin=entryMin;
  if(p.decisionId!=null||p.decisionAuthority!=null){
    throw Error('权威决策计划须通过服务端准备入口生成');
  }
  state.plans.push(plan); return plan;
}
export function auditTrade(plan,t) {
  const list=[];
  function record(rule,status,evidence){list.push({rule,status,evidence});}
  const verified=plan && Date.parse(plan.frozenAt)<=Date.parse(t.entryTime+':00+08:00');
  if (!verified) {
    record('计划外交易',t.planStatus==='无开仓计划'?'触发':'资料不足',t.planStatus==='无开仓计划'?'执行记录确认开仓时无计划':'缺少成交前冻结的计划，保留历史补录标记');
    for(const rule of ['追高','超仓','违反止损','过早离场'])record(rule,'资料不足','缺少事前冻结基准');
    return list;
  }
  record('计划外交易',plan.code!==t.code?'触发':t.strategy==='未判定'?'资料不足':(t.strategies||[t.strategy]).includes(plan.strategy)?'符合':'触发','计划 '+plan.code+' / '+plan.strategy+'；执行 '+t.code+' / '+t.strategy);
  if(plan.code!==t.code) {
    for(const rule of ['追高','超仓','违反止损','过早离场'])record(rule,'资料不足','实际标的与冻结计划不同，缺少该标的对应基准');
    return list;
  }
  record('追高',t.entryPrice>plan.entryMax?'触发':'符合','买入 '+t.entryPrice+' 元，计划上限 '+plan.entryMax+' 元');
  record('超仓',t.position>plan.maxPosition?'触发':'符合','执行 '+t.position+'%，计划上限 '+plan.maxPosition+'%');
  if(t.stopAction==='可成交后继续持有')record('违反止损','触发','执行事实记录为触及止损后存在可成交窗口，仍继续持仓');
  else if(t.stopAction==='触发并执行'||t.stopAction==='未触发'&&t.exitPrice>plan.stop)record('违反止损','符合',t.stopAction+'，计划止损价 '+plan.stop);
  else record('违反止损','资料不足','计划止损 '+plan.stop+' 元，离场 '+t.exitPrice+' 元，缺少可成交窗口或触发记录');
  if(!plan.holdUntil)record('过早离场','不适用','计划未限制最早离场时间');
  else if(t.exitTime>=plan.holdUntil)record('过早离场','符合','离场时间达到计划要求');
  else if(t.exitPrice>=plan.target||t.stopAction==='触发并执行')record('过早离场','符合','提前离场满足计划止盈或止损条件');
  else if(t.stopAction==='缺少记录')record('过早离场','资料不足','已提前离场，缺少是否满足止损豁免的记录');
  else record('过早离场','触发','实际 '+t.exitTime+'，计划最早 '+plan.holdUntil);
  return list;
}
function dayGap(a,b){return (Date.parse(b)-Date.parse(a))/86400000;}
function closeTrade(state,p){
  const entryTime=stamp(p.entryTime,'买入时间'),exitTime=stamp(p.exitTime,'卖出时间');
  const at=Date.parse(entryTime+':00+08:00'),day=asDate(entryTime),code=symbol(p.code);
  const practice=state.scope==='demo'||p.sampleSet==='test';
  const matchingPlans=(state.plans||[]).filter(v=>(practice||!isTestSample(v))&&v.code===code&&Date.parse(v.frozenAt)<=at&&(v.intendedDate||asDate(localTime(Date.parse(v.frozenAt))))===day);
  const plan=p.planId?(state.plans||[]).find(v=>v.id===p.planId):matchingPlans.length===1?matchingPlans[0]:null;
  if(p.planId&&!plan)throw Error('关联计划不存在');
  const visible=marketAsOf(state,day,entryTime),last=visible.at(-1);
  const lastSession=last?.date||day;
  const check=(state.checks||[]).filter(c=>(practice||isTestSample(plan)||!isTestSample(c))&&c.code===code&&Date.parse(c.createdAt)<=at&&c.date<=day&&dayGap(c.date,day)<=7&&
    (!c.asOf||c.asOf.replace(' ','T')<=entryTime)&&(c.date===lastSession||c.date===day||plan?.checkId===c.id))
    .sort((a,b)=>b.date.localeCompare(a.date)||Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
  const strategies=check?.matches||[];
  const detected=strategies[0]||'未判定',feature=check?.capture?.features||{};
  if(exitTime<=entryTime || exitTime>localTime())throw Error('卖出时间须晚于买入，且不得晚于当前时间');
  if(plan && Date.parse(plan.frozenAt)>Date.parse(entryTime+':00+08:00'))throw Error('只能关联买入之前已冻结的计划');
  const entryPrice=num(p.entryPrice,'买入均价',0.001,100000),exitPrice=num(p.exitPrice,'卖出均价',0.001,100000);
  const shares=num(p.shares,'数量',1,1e10),cost=num(p.cost??0,'总费用',0,1e10);
  if(!Number.isSafeInteger(shares))throw Error('成交数量应为整数股');
  const pnlAmount=round((exitPrice-entryPrice)*shares-cost), pnl=round(pnlAmount/(entryPrice*shares)*100);
  const matches=(state.trades||[]).some(t=>t.code===code&&t.entryTime===entryTime&&t.exitTime===exitTime&&t.entryPrice===entryPrice&&t.exitPrice===exitPrice&&t.shares===shares&&t.cost===cost&&isTestSample(t)===(practice||isTestSample(plan)||isTestSample(check)));
  if(matches)throw Error('相同成交记录已存在');
  const labels=Object.fromEntries(Object.entries({volume:last?.volume,indexPosition:last?.indexPosition,breadth:last?.breadth,
    resonance:feature.resonance,breakRate:last?.breakRate,downLimit:last?.downLimit,premium:last?.premium,height:last?.height,
    theme:last?.themeType,ladder:feature.ladder,themeDays:feature.themeAge,assist:feature.sectorAssists,stockPosition:feature.position,
    turnover:feature.turnover,stockVolume:feature.volume,chip:feature.chipPeak,overhang:feature.lockedRatio,
    shape:feature.shape,structure:feature.structure,maState:feature.maState,volumeRun:feature.volumeRun,
    relation:feature.relation,themeCycle:feature.themeCycle,chipExchange:feature.chipExchange,leader:feature.sectorLeader}).filter(([,v])=>v!=null&&v!=='缺失'));
  const heldBars=(state.bars||[]).filter(b=>(practice||isTestSample(plan)||!isTestSample(b))&&(b.role||'stock')==='stock'&&b.code===code&&b.date.slice(0,10)>=day&&b.date.slice(0,10)<=asDate(exitTime));
  const shock=heldBars.some(b=>sampleMatches(b,'blackSwan'));
  if(p.sampleSet!=null&&!['test','real'].includes(p.sampleSet))throw Error('样本用途须为正式或测试');
  const extreme=p.quality==='不可复制极端行情'||heldBars.some(b=>sampleMatches(b,'extreme'));
  const quality=shock||p.quality==='黑天鹅'?'黑天鹅':extreme?'不可复制极端行情':'可重复样本';
  const sampleSet=state.scope==='demo'||p.sampleSet==='test'||isTestSample(plan)||isTestSample(check)||heldBars.some(isTestSample)?'test':'real';
  const t={id:id('trade'),customTags:words(plan?.customTags),sampleSet,extreme,createdAt:now(),planId:plan?.id||null,planStatus:plan?'已冻结':(p.planStatus==='无开仓计划'?p.planStatus:'历史补录'),code,name:required(p.name,'股票名称',40),entryTime,exitTime,date:asDate(entryTime),exitDate:asDate(exitTime),entryPrice,exitPrice,shares,cost,position:num(p.position,'实际仓位',0.01,100),holdDays:Math.floor((Date.parse(asDate(exitTime))-Date.parse(asDate(entryTime)))/86400000),pnl,pnlAmount,repeatable:!['黑天鹅','不可复制极端行情'].includes(quality),blackSwan:quality==='黑天鹅',quality,exitReason:required(p.exitReason,'离场类型'),strategy:detected,strategies,checkId:check?.id||null,factors:unique([...words(check?.factors||plan?.factors),...evidenceCodes(check,at),...pressureLearningTags(state,{code,date:day},entryTime)]),knownRiskFactors:check?.risks||plan?.knownRiskFactors||[],trend:check?.market?.trend||last?.trend||plan?.trend||'未记录',stopAction:p.stopAction||'缺少记录',labels,snapshotVerified:Boolean(check&&strategies.length)};
  t.labels.cycle=check?.emotion?.stage||plan?.labels?.cycle||(last?emotion(visible,last.date,entryTime).stage:'未判定');
  t.labels.overnight=t.date!==t.exitDate?'是':'否';
  t.frozenLabels={...(plan?.labels||{}),...labels,cycle:t.labels.cycle};
  t.disciplineFacts=auditTrade(plan,t);
  t.violations=t.disciplineFacts.filter(r=>r.status==='触发').map(r=>r.rule);
  t.reviewable=t.disciplineFacts.some(r=>r.status==='触发'||r.status==='符合');
  t.attribution=attribution(t);
  const explanation=p.explanation?{id:id('note'),tradeId:t.id,text:required(p.explanation,'主观解释',3000),createdAt:now()}:null;
  state.trades.push(t);
  if(explanation)state.explanations.push(explanation);
  return t;
}
function groupStats(rows,getKeys,policy={}){
  const m=new Map();
  for(const r of rows)for(const k of unique(getKeys(r))) {
    if(!m.has(k))m.set(k,[]);m.get(k).push(r);
  }
  return [...m].map(([key,values])=>({key,...stats(values,policy)})).sort((a,b)=>b.n-a.n||b.expectedReturn-a.expectedReturn);
}
export function study(rows,policy={},options={}){
  const active=rows.filter(r=>sampleMatches(r,options.selection||'standard')&&(options.includeTest===true||!isTestSample(r)));
  const single=groupStats(active,factorSet,policy);
  const leaders=new Set(single.slice(0,14).map(s=>s.key));
  const combinations=groupStats(active,r=>{
    const fs=factorSet(r).filter(x=>leaders.has(x)).sort(),keys=[];
    for(let i=0;i<fs.length;i++)for(let j=i+1;j<fs.length;j++){
      keys.push(fs[i]+' + '+fs[j]);for(let k=j+1;k<fs.length;k++)keys.push(fs[i]+' + '+fs[j]+' + '+fs[k]);
    }return keys;
  },policy);
  const byTrend=groupStats(active,r=>strategyList(r).map(s=>s+' / '+(r.trend||'未记录')) ,policy);
  const risk=groupStats(active,r=>[String(words(r.knownRiskFactors).length)+' 项风险叠加'],policy);
  const frequent=[...single,...combinations].filter(x=>x.n>=6);
  const best=frequent.filter(x=>x.expectedReturn>0&&x.winRate>=60).sort((a,b)=>b.expectedReturn-a.expectedReturn);
  const danger=frequent.filter(x=>x.expectedReturn<0&&x.lossRate>=60).sort((a,b)=>a.expectedReturn-b.expectedReturn);
  return {single,combinations,byTrend,risk,best,danger};
}
function closedAt(r){return cutAt(r.exitTime || (r.exitDate || r.date)+'T15:00');}
const performanceFactors=r=>factorSet(r).filter(f=>!f.startsWith('战法·')&&!f.startsWith('环境·'));
export function learningSnapshot(state,options={}){
  const moment=options.asOf??Date.now(),asOf=cutAt(moment);
  if(!asOf)throw Error('无效的绩效观察时间');
  const policy=policyAt(state,asOf),rows=rowsFor(state,moment,false,options);
  return {asOf,decay:policy,totals:stats(rows,policy),factorByTrend:groupedPerformance(rows,performanceFactors,'factor',policy),
    strategyByTrend:groupedPerformance(rows,strategyList,'strategy',policy),alerts:decayAlerts(rows,performanceFactors,asOf,t=>policyAt(state,t)),
    attribution:attributionCloud(rows)};
}
function buildCandidate(state,automatic=false,centerProposal=null){
  const clock=centerProposal?.now??Date.now();
  const all=rowsFor(state,clock,true).map(r=>r.snapshotVerified?{...r,strategies:[r.strategy]}:r);
  const previous=state.candidates?.at(-1);
  // A tested holdout is never reused for a new parameter-search attempt.
  const ranges=centerProposal?.ranges;
  const allowedTradeIds=centerProposal?new Set(centerProposal.matureTradeIds):null;
  if(ranges&&previous?.end&&ranges.train.start<=previous.end)throw Error('中心提案包含已经测试过的留出时段，请等待新的独立窗口');
  const raw=all.filter(r=>(!previous?.end || r.date>previous.end)&&(!ranges||r.date>=ranges.train.start&&r.date<=ranges.test.end&&allowedTradeIds.has(r.id)));
  const days=unique(raw.map(r=>r.date)).sort();
  function unavailable(msg){if(automatic)return null;throw Error(msg);}
  if(days.length<15||raw.length<36)return unavailable('需至少 36 条已成熟的时点样本，覆盖 15 个独立信号日。重复使用过的验证时段已排除。');
  const a=ranges?.validation.start||days[Math.floor(days.length*0.55)], b=ranges?.test.start||days[Math.floor(days.length*0.78)];
  if(centerProposal&&(instant(centerProposal.baselineApprovedAt)>=instant(a)||!Number.isFinite(centerProposal.maxTrainingLabelKnownAt)||centerProposal.maxTrainingLabelKnownAt>=instant(a)))
    throw Error('中心拟合或获批基线晚于首个留出日，不能把后来可知的权重用于该验证窗口');
  const availableBefore=(r,boundary)=>asDate(closedAt(r))<boundary&&(!r.createdAt||localTime(Date.parse(r.createdAt))<boundary);
  const inRange=(r,phase)=>!ranges||r.date>=ranges[phase].start&&r.date<=ranges[phase].end;
  const train=raw.filter(r=>r.date<a&&inRange(r,'train')&&availableBefore(r,a));
  const validation=raw.filter(r=>r.date>=a&&r.date<b&&inRange(r,'validation')&&availableBefore(r,b));
  const test=raw.filter(r=>r.date>=b&&inRange(r,'test'));
  if(train.length<12||validation.length<6||test.length<6)return unavailable('清除跨分界持仓后样本不足，训练 / 时间外 / 样本外至少需要 12 / 6 / 6 条。');
  // The time weighting policy and the fit are frozen before the first holdout.
  const trainCut=new Date(Date.parse(a+'T00:00:00Z')-60000).toISOString().slice(0,16);
  const policy=policyAt(state,trainCut);
  const groups=groupStats(train,factorSet,policy).filter(g=>g.n>=4), baseline=stats(train,policy);
  // A numeric model is fitted only to actual, reconciled net settlements whose
  // frozen check was already known at entry. K-line return labels never enter it.
  const numericModel=centerProposal?.numericModel?structuredClone(centerProposal.numericModel):!centerProposal&&state.scope!=='demo'?
    fitNumericModel(train,{dictionaryVersion,trainCutoff:a+'T00:00:00+08:00'}):null;
  if(numericModel&&(!validModel(numericModel)||numericModel.dictionaryVersion!==dictionaryVersion))throw Error('数值模型定义或冻结指纹无效');
  if(!centerProposal&&lastVersion(state)?.numericModel&&!numericModel)return unavailable('数值模型缺少足够的同定义成熟成交，当前获批版本保持不变。');
  if(numericModel){
    const eligible=[train,validation,test].map(rows=>rows.filter(row=>row.numericFactors));
    if(eligible.flat().length<36||unique(eligible.flat().map(row=>row.date)).length<15||eligible.some((rows,i)=>rows.length<(i===0?12:6)))
      return unavailable('数值模型需至少36条已核对净费用的成熟成交、15个信号日及12/6/6独立样本；行情收益标签不计入。');
  }
  // Priors shrink sparse factors back toward the training mean.
  const weights=centerProposal?{...centerProposal.weights}:numericModel?{...numericModel.weights}:Object.fromEntries(groups.map(g=>[g.key,round(Math.max(-3,Math.min(3,(g.expectedReturn-baseline.expectedReturn)*g.effectiveN/(g.effectiveN+8))))]));
  if(numericModel&&stable(weights)!==stable(numericModel.weights))throw Error('验证权重与数值模型权重不一致');
  if(centerProposal&&centerProposal.changedFactorIds.some(key=>numericModel?!train.some(row=>Number.isFinite(row.numericFactors?.values[key])):!groups.some(group=>group.key===key)))throw Error('中心调整因子缺少原训练集中的同名已观察特征，禁止猜测映射');
  const reviewRefs=centerProposal||numericModel?[]:(state.notes||[]).filter(n=>n.factor&&Object.hasOwn(weights,n.factor)&&n.tradeId&&n.createdAt&&localTime(Date.parse(n.createdAt))<a&&train.some(r=>r.id===n.tradeId&&factorSet(r).includes(n.factor)));
  // Review hypotheses count only if already recorded and backed by an actual training feature.
  for(const f of unique(reviewRefs.map(n=>n.factor))) {
    const linked=new Set(reviewRefs.filter(n=>n.factor===f).map(n=>n.tradeId));
    if(linked.size>=3) {
      const score=stats(train.filter(t=>linked.has(t.id)),policy).expectedReturn;
      weights[f]=round(weights[f]+Math.max(-0.25,Math.min(0.25,(score-baseline.expectedReturn)/10)));
    }
  }
  const scoreCache=new WeakMap();
  const score=r=>{
    if(!numericModel)return weightedScore(weights,factorSet(r));
    if(scoreCache.has(r))return scoreCache.get(r);
    const projected=projectNumeric(r.numericFactors?.values,numericModel,r.numericFactors?.definitions||{}),ids=numericModel.parameters.map(p=>p.factorId);
    const value=ids.every(id=>Number.isFinite(projected[id]))?ids.reduce((sum,id)=>sum+projected[id]*weights[id],0)/Math.sqrt(ids.length):null;
    scoreCache.set(r,value);return value;
  };
  const scorable=rows=>numericModel?rows.filter(row=>Number.isFinite(score(row))):rows;
  const threshold=Math.max(0,weightedQuartile(scorable(train),score,policy)),minSupport=6;
  const strategyThresholds=Object.create(null);
  for (const strat of unique(train.flatMap(strategyList))) {
    const group=scorable(train.filter(r=>strategyList(r).includes(strat)));
    if(group.length>=12)strategyThresholds[strat]=Math.max(threshold,weightedQuartile(group,score,policy));
  }
  const passRows=rows=>rows.filter(r=>Number.isFinite(score(r))&&score(r)>(strategyThresholds[r.strategy]??threshold));
  const steps=[];
  function gate(i,pass,evidence){
    steps.push({name:stages[i],status:pass?'通过':'未通过',evidence});
    return pass;
  }
  let chosen=[];
  for(const [i,origin] of [train,validation,test].entries()){
    chosen=passRows(origin);
    const evaluation={...policy,asOf:i===0?trainCut:i===1?b:localTime(clock)};
    const s=stats(chosen,evaluation),base=stats(numericModel?origin.filter(row=>row.numericFactors):origin,evaluation),dates=unique(chosen.map(r=>r.date));
    const pass=s.n>=minSupport&&dates.length>=3&&s.expectedReturn>0&&s.expectedReturn>=base.expectedReturn&&(i!==0||Object.values(weights).some(x=>x>0));
    if(!gate(i,pass,'选中 '+s.n+' / '+base.n+' 条，'+dates.length+' 个信号日，均值 '+val(s.expectedReturn,'%')+'，同期基准 '+val(base.expectedReturn,'%')+'。要求至少 6 条、3 日且均值为正并达到基准。'))break;
  }
  if(steps.length===3&&steps.at(-1).status==='通过'){
    const stressed=stats(chosen.map(r=>({...r,pnl:r.pnl-0.6})),{...policy,asOf:localTime(clock)});
    gate(3,stressed.expectedReturn>0,'样本外每次加扣 0.60 个百分点，净均值 '+val(stressed.expectedReturn,'%')+'，须大于零。');
  }
  if(steps.length===4&&steps.at(-1).status==='通过'){
    const tail=stats(chosen.map(r=>({...r,position:100})));
    const concentration=Math.max(...groupStats(chosen,r=>[r.code||'未知']).map(g=>g.n))/chosen.length;
    gate(4,tail.maxDrawdown<=20&&tail.worst>=-10&&concentration<=0.5,'单位仓位回撤 '+val(tail.maxDrawdown,'%')+'（≤20%），最差单笔 '+val(tail.worst,'%')+'（≥−10%），单标的占比 '+val(round(concentration*100),'%')+'（≤50%）。');
  }
  while(steps.length<stages.length)steps.push({name:stages[steps.length],status:'未运行',evidence:'等待前置环节通过'});
  const candidate={id:id('candidate'),sampleScope:state.scope==='demo'?'demo':'live',decay:policy,createdAt:now(),baseVersion:lastVersion(state)?.number||0,start:days[0],trainEnd:a,validationEnd:b,end:raw.map(r=>asDate(closedAt(r))).sort().at(-1),weights,threshold,strategyThresholds,minSupport,steps,status:steps.every(s=>s.status==='通过')?'待人工审批':'验证未通过',counts:[train.length,validation.length,test.length],sourceIds:[...train,...validation,...test].map(r=>r.id),reviewRefs:reviewRefs.map(n=>n.id)};
  candidate.factorSchema=numericModel?MODEL:'legacy-presence-weights';
  candidate.numericModel=numericModel;
  candidate.numericCoverage={status:numericModel?'evaluated-by-same-five-gates':'missing-eligible-numeric-training-evidence',
    scorableCounts:[train,validation,test].map(rows=>rows.filter(row=>numericModel?Number.isFinite(score(row)):row.numericFactors&&Object.keys(row.numericFactors.values).length).length),
    klineLabelsUsed:false};
  if(centerProposal)candidate.centerFeedback={proposalFingerprint:centerProposal.proposalFingerprint,sourceFold:centerProposal.sourceFold,
    dictionaryVersion:centerProposal.dictionaryVersion,baselineFingerprint:centerProposal.baselineFingerprint,
    trainingFingerprint:centerProposal.trainingFingerprint,inputEvidenceFingerprint:centerProposal.inputEvidenceFingerprint,
    calendarEvidenceFingerprint:centerProposal.calendarEvidenceFingerprint,
    ranges:structuredClone(ranges),changedFactorIds:[...centerProposal.changedFactorIds],sameProposedWeights:true};
  candidate.validationFingerprint=fingerprint(validationState(candidate));
  state.candidates.push(candidate);return candidate;
}

// Server-only bridge callers reconstruct this object from the locked archive.
// No learningAction accepts client weights or this internal proposal argument.
export function validateCenterCandidate(state,proposal){
  if(!proposal||state.scope==='demo'||!proposal.weights||!proposal.ranges||!Array.isArray(proposal.matureTradeIds)||
      !Array.isArray(proposal.changedFactorIds)||!proposal.changedFactorIds.length||
      !/^[a-f0-9]{64}$/.test(proposal.proposalFingerprint)||proposal.baselineVersion!==lastVersion(state)?.number)
    throw Error('中心提案的服务端来源或获批基线无效');
  for(const phase of ['train','validation','test']){
    const range=proposal.ranges[phase];
    if(!range||!/^\d{4}-\d{2}-\d{2}$/.test(range.start)||!/^\d{4}-\d{2}-\d{2}$/.test(range.end)||range.start>range.end)
      throw Error('中心提案的验证时段无效');
  }
  if(!(proposal.ranges.train.end<proposal.ranges.validation.start&&proposal.ranges.validation.end<proposal.ranges.test.start)||
      Object.values(proposal.weights).some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('中心提案的权重或隔离窗口无效');
  if(proposal.numericModel&&(proposal.factorSchema!==MODEL||!validModel(proposal.numericModel)||
      stable(proposal.numericModel.weights)!==stable(proposal.weights)))throw Error('中心数值提案模型、定义或权重指纹不一致');
  for(const key of ['candidates','versions'])state[key]||=[];
  return buildCandidate(state,false,proposal);
}
export function learningAction(state,action,p={}){
  if(!p||typeof p!=='object')throw Error('输入格式无效');
  for(const key of ['plans','trades','explanations','candidates','versions'])state[key]||=[];
  if(action==='learn:plan')return archivePlan(state,p);
  if(action==='learn:trade'){
    const t=closeTrade(state,p);buildCandidate(state,true);return t;
  }
  if(action==='learn:note'){
    const target=p.planId&&!p.tradeId?{planId:p.planId}:{tradeId:p.tradeId};
    if(target.tradeId?!state.trades.some(t=>t.id===p.tradeId):!state.plans.some(t=>t.id===p.planId))throw Error('对应的冻结计划或成交不存在');
    const record={id:id('note'),...target,text:required(p.text,'主观解释',3000),createdAt:now()};state.explanations.push(record);return record;
  }
  if(action==='learn:candidate')return buildCandidate(state);
  if(action==='learn:auto-candidate')return buildCandidate(state,true);
  if(action==='learn:decision'){
    const c=state.candidates.find(x=>x.id===p.id);
    if(!c || c.status!=='待人工审批'||c.steps.length!==5||!c.steps.every((s,i)=>s.name===stages[i]&&s.status==='通过'))throw Error('仅允许审批五项验证均已通过的候选');
    if((c.validationFingerprint||c.numericModel)&&c.validationFingerprint!==fingerprint(validationState(c)))throw Error('候选模型、定义、权重或验证记录已变化，必须重新验证');
    const reviewer=required(p.reviewer,'审批人',50),reason=required(p.reason,'审批意见',2000);
    if(!['approve','reject'].includes(p.decision))throw Error('请选择审批结论');
    if(p.decision==='approve'&&state.scope!=='demo'&&(c.sampleScope==='demo'||state.trades.some(r=>isTestSample(r)&&c.sourceIds?.includes(r.id))))throw Error('含测试样本的候选仅用于演示档案');
    const prev=lastVersion(state)?.number||0;
    if(p.decision==='approve' && c.baseVersion!==prev)throw Error('基线版本已变更，请基于当前版本重新验证');
    c.decision={reviewer,reason,at:now()};
    if(p.decision==='reject'){c.status='人工驳回';return c;}
    const ver={id:id('version'),sampleScope:c.sampleScope||'live',decay:c.decay,number:prev+1,candidateId:c.id,approvedAt:c.decision.at,reviewer,reason,weights:{...c.weights},strategyThresholds:{...c.strategyThresholds},minSupport:c.minSupport,threshold:c.threshold};
    if(c.numericModel){ver.numericModel=structuredClone(c.numericModel);ver.factorSchema=MODEL;ver.validationFingerprint=c.validationFingerprint;ver.scoringFingerprint=fingerprint(scoringState(ver));}
    state.versions.push(ver);c.status='已晋级';return ver;
  }
  throw Error('未知学习操作');
}
const val=(n,suffix='')=>n==null||!Number.isFinite(+n)?'—':n+suffix;
const escaped=x=>String(x??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v]));
const E=escaped;
const button=(act,title,primary=false)=>'<button type="button" class="btn '+(primary?'primary':'')+'" data-learnaction="'+E(act)+'">'+E(title)+'</button>';
const opts=xs=>xs.map(x=>'<option value="'+E(x)+'">'+E(x)+'</option>').join('');
function field(name,label,input){return '<label class="field"><span>'+label+'</span>'+input+'</label>';}
function input(k,l,v='',type='text',required=false,more=''){return field(k,l,'<input name="'+k+'" type="'+type+'" value="'+E(v)+'" '+(required?'required ':'')+more+'>');}
function sel(k,l,values){return field(k,l,'<select name="'+k+'">'+opts(values)+'</select>');}
const textArea=(k,l,v='')=>field(k,l,'<textarea name="'+k+'" rows="2">'+E(v)+'</textarea>');
const grid=html=>'<div class="grid2 learn-form">'+html+'</div>';
const fold=(label,html)=>'<details class="learn-fold"><summary>'+E(label)+'</summary>'+html+'</details>';
const labelGroups=[
 ['大盘与情绪标签',[['volume','全A量能',['放量上涨','缩量上涨','放量下跌','缩量阴跌']],['indexPosition','指数位置',['低位企稳','中间震荡','高位承压']],['breadth','涨跌家数结构',['普涨','分化','普跌','赚指数不赚钱']],['resonance','共振状态',['题材指数共振','题材独立背离']],['breakRate','炸板率（%）'],['downLimit','跌停数量'],['premium','昨日涨停溢价（%）'],['height','连板高度'],['leader','高标状态',['健康','滞涨','核按钮']]]],
 ['题材、量价与筹码',[['theme','题材属性',['主线','支线','轮动题材','消息一日游']],['ladder','题材梯队'],['themeDays','启动天数'],['assist','板块助攻数量'],['duration','题材持续性'],['identity','龙头辨识度'],['stockPosition','个股位置',['低位','中位','高位']],['turnover','换手状态',['低换手','健康换手','巨量换手']],['stockVolume','量能结构',['缩量','温和放量','爆量']],['chip','筹码峰位置'],['overhang','套牢盘占比（%）'],['support','分时承接'],['auction','竞价高低开 / 量比 / 抢筹']]],
 ['行为与归因标注',[['inModel','模式内交易',['是','否']],['emotional','情绪化交易',['是','否']],['anticipation','提前预判',['是','否']],['overstay','格局超时',['是','否']],['reviewReason','人工结果归因'],['sourceSet','样本集名称']]]
];
function planForm(s,current){
 const context=current?'<input type="hidden" name="checkId" value="'+E(current.id)+'">':'';
 const custom=settingsAt(s).customTags||[];
 const strategy=current?.eligible?.[0]||current?.matches?.[0]||'未判定';
 const tags=custom.length?field('customTags','计划标签（可多选）','<select name="customTags" multiple>'+opts(custom)+'</select>'):'';
 return context+tags+grid(input('name','标的名称',current?.name,'text',true)+input('code','股票代码',current?.code,'text',true,'pattern="[0-9]{6}" maxlength="6"')+
   input('strategy','校验识别战法',strategy,'text',true,'readonly')+input('trend','全A环境',current?.market?.trend||'未记录','text',true,'readonly')+
   input('entryMax','开仓价格上限（元）','','number',true,'step="0.001" min="0.001"')+input('maxPosition','单标的仓位上限（%）',current?.position||'','number',true,'step=".01" min=".01" max="100"')+
   input('stop','计划止损（元）','','number',true,'step=".001" min=".001"')+input('target','计划止盈（元）','','number',true,'step=".001" min=".001"')+
   input('intendedDate','计划执行日期（可选）','','date')+input('expectedAuctionGap','预期竞价涨幅（可选，%）','','number',false,'step=".01" min="-100" max="100"')+
   input('holdUntil','最早计划离场（可选）','','datetime-local'))+textArea('logic','开仓逻辑（必填）')+'<p class="learn-hint">系统保存冻结时间和当时的校验依据。</p>';
}
function tradeForm(s,plan){
 const start=plan?localTime(Math.max(Date.parse(plan.frozenAt)+60000,Date.now()-2*86400000)):localTime(Date.now()-86400000);
 return (plan?'<input type="hidden" name="planId" value="'+E(plan.id)+'"><p class="learn-hint">已关联冻结计划 · '+E(plan.name)+'</p>':'')+
   grid(input('name','标的名称',plan?.name,'text',true)+input('code','股票代码',plan?.code,'text',true,'pattern="[0-9]{6}" maxlength="6"')+
   input('entryTime','买入时间（北京时间）',start,'datetime-local',true)+input('exitTime','卖出时间（北京时间）',localTime(),'datetime-local',true)+
   input('entryPrice','买入均价（元）','','number',true,'step=".001" min=".001"')+input('exitPrice','卖出均价（元）','','number',true,'step=".001" min=".001"')+
   input('shares','成交股数','','number',true,'step="1" min="1"')+input('cost','合计交易费用（元）',0,'number',true,'step=".01" min="0"')+
   input('position','实际仓位（%）','','number',true,'step=".01" min=".01" max="100"')+
   field('sampleSet','样本用途','<select name="sampleSet">'+(s.scope==='demo'?'<option value="test">演示练习</option>':'<option value="real">正式样本</option><option value="test">测试样本</option>')+'</select>')+
   sel('quality','样本质量',['可重复样本','黑天鹅','不可复制极端行情'])+
   sel('exitReason','离场记录',['未记录','计划止盈','计划止损','主动离场','被动割肉','到期离场'])+
   sel('stopAction','可核验的止损执行',['缺少记录','未触发','触发并执行','可成交后继续持有','封死无法成交']))+
   '<p class="learn-hint">系统按买入时已归档的校验记录识别战法、环境和风险。多笔计划无法唯一对应时保留待核实。</p>'+textArea('explanation','人工主观解释（可选）');
}
function csv(rows,cols){const quote=v=>{const s=Array.isArray(v)?v.join(' / '):String(v??'');return '"'+(/^[=+@\t\r]/.test(s) || /^-[^\d]/.test(s)?"'":'')+s.replace(/"/g,'""')+'"'};return '\uFEFF'+[cols.map(([k,l])=>quote(l)).join(','),...rows.map(r=>cols.map(([k])=>quote(r[k])).join(','))].join('\r\n');}
function table(headers,rows,empty='暂无样本记录'){return '<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+E(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+headers.length+'" class="learn-empty">'+E(empty)+'</td></tr>')+'</tbody></table></div>';}
const panel=(label,action,body)=>'<section class="panel learn-panel"><div class="learn-heading"><h3>'+label+'</h3><div class="learn-actions">'+action+'</div></div>'+body+'</section>';
const style='<style>.learn-shell{display:grid;gap:18px}.learn-panel{padding:20px;min-width:0}.learn-heading,.learn-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.learn-heading{margin-bottom:16px}.learn-heading h3{margin:0;font-size:17px}.learn-actions{justify-content:flex-end}.learn-shell table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}.learn-shell th,.learn-shell td{padding:12px 10px;font-size:14px;border-bottom:1px solid #e6e9ed}.learn-shell th{color:#64748b;font-weight:500}.learn-shell .table-wrap{overflow:auto}.learn-empty,.learn-hint{color:#697386}.learn-empty{text-align:center;padding:30px!important}.learn-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.learn-metric{padding:16px}.learn-metric small{color:#667085;font-size:13px}.learn-metric b{font-family:Arial,sans-serif;display:block;font-size:25px;margin:6px 0}.learn-fold{padding:10px 0;border-bottom:1px solid #e4e9ed}.learn-fold summary{cursor:pointer;font-size:14px;font-weight:600}.learn-shell .tag{white-space:nowrap}.learn-form{gap:12px}.learn-tabs{display:flex;gap:6px;flex-wrap:wrap}.learn-shell .active-tab{background:var(--primary);color:white}.learn-cell-link{border:none;background:none;color:var(--primary);cursor:pointer;padding:0;font:inherit}.learn-small{font-size:13px;color:#697386}.learn-stage{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 0;border-bottom:1px solid #dae4df}.learn-stage p{grid-column:1/-1;margin:0;color:#62716c;font-size:14px}.learn-shell input,.learn-shell select{max-width:100%}@media(max-width:720px){.learn-metrics{grid-template-columns:repeat(2,1fr)}.learn-panel{padding:14px}}</style>';
const metricsBar=xs=>'<div class="learn-metrics">'+xs.map(([k,v])=>'<div class="panel learn-metric"><small>'+E(k)+'</small><b>'+E(v)+'</b></div>').join('')+'</div>';
const link=(key,label)=>'<button type="button" class="learn-cell-link" data-learnaction="'+E(key)+'">'+E(label)+'</button>';
function sampleTable(rows){return table(['成交日期','标的','战法 / 环境','仓位','净收益','纪律触发','样本质量'],rows.map(t=>[E(t.date),link('view:'+t.id,t.name)+'<br><small>'+E(t.code)+'</small>',E(t.strategy)+'<br><small>'+E(t.trend)+'</small>',val(t.position,'%'),'<b style="color:'+(t.pnl>0?'var(--red)':t.pnl<0?'var(--green)':'inherit')+'">'+val(t.pnl,'%')+'</b>',E((t.violations||[]).join('、') || (t.reviewable?'无已证实违规':'待核验')),E((isTestSample(t)?'测试 · ':'')+(t.quality||'未标注'))]));}
function viewStats(groups){return table(['因子 / 条件','样本数','历史胜率','历史亏损率','盈亏比','平均净收益','已实现回撤'],groups.map(g=>[E(g.key),val(g.n),val(g.winRate,'%'),val(g.lossRate,'%'),val(g.payoff),val(g.expectedReturn,'%'),val(g.maxDrawdown,'%')]));}
const exportTradeCols=[['sampleSet','样本用途'],['date','入场日'],['name','名称'],['code','股票代码'],['strategy','战法'],['trend','指数趋势'],['entryTime','入场时刻'],['exitTime','退出时刻'],['holdDays','持有自然日'],['position','仓位%'],['pnl','净盈亏%'],['pnlAmount','净盈亏金额'],['factors','因子'],['violations','触发纪律'],['quality','样本质量']];
function formTradeValues(s,p) {
  const out={...p,overnight:asDate(p.entryTime)!==asDate(p.exitTime)?'是':'否'};
  return out;
}
export function renderLearning(ui,mode='trades'){
  let s=ui.state;const root=ui.root;
  let tab=mode==='versions'?'versions':'ledger',filter='全部样本',q=ui.strategy||ui.factor||'',group='single',groupPage=0,ledgerPage=0;
  let trades,plans,candidates,versions,performance=null;
  let includeTest=false,selection=ui.sampleFilter||'standard',perfFactor=ui.factor||'',perfStrategy=ui.strategy||'',perfTrend='';
  const perfFilter=(field,values,chosen)=>'<select id="learn-perf-'+field+'" aria-label="'+({factor:'选择因子',strategy:'选择战法',trend:'选择环境'})[field]+'"><option value="">'+({factor:'所有因子',strategy:'所有战法',trend:'所有环境'})[field]+'</option>'+values.map(v=>'<option '+(chosen===v?'selected ':'')+'value="'+E(v)+'">'+E(v)+'</option>').join('')+'</select>';
  const qualityOptions={all:'全部质量',standard:'标准样本',blackSwan:'仅黑天鹅',extreme:'仅极端行情',excludeBlackSwan:'排除黑天鹅',excludeExtreme:'排除极端行情'};
  const controls=()=>'<div class="learn-actions" style="justify-content:flex-start">'+(s.scope==='demo'?'<span class="tag">演示档案 · 练习统计</span>':'<label><input type="checkbox" id="learn-tests" '+(includeTest?'checked':'')+'> 统计包含测试样本</label>')+
    '<label>样本质量 <select id="learn-quality">'+Object.entries(qualityOptions).map(([k,v])=>'<option value="'+k+'" '+(selection===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div>';
  const perf=()=>performance||=learningSnapshot(s,{includeTest,selection});
  const current=()=>[...(s.checks||[])].reverse().find(r=>r.code===ui.stock&&(!ui.date||r.date===ui.date));
  function snapshot(){
    s=ui.state;performance=null;
    trades=ordered(s.trades||[]).reverse();plans=[...(s.plans||[])].reverse();
    candidates=[...(s.candidates||[])].reverse();versions=[...(s.versions||[])].filter(v=>v.approvedAt).reverse();
  }
  snapshot();
  let reportRows=null, report=null;
  function analysis(){
    if(!report){reportRows=rowsFor(s,Date.now(),false,{includeTest,selection});report=study(reportRows,policyAt(s,localTime()),{includeTest:includeTest||s.scope==='demo',selection});}
    return report;
  }
  const selected=()=>trades.filter(t=>(s.scope==='demo'||includeTest||!isTestSample(t))&&sampleMatches(t,selection)&&(!q||[t.code,t.name,t.strategy,...(t.factors||[])].join(' ').includes(q)) && (filter==='全部样本'||filter==='大亏案例'&&t.pnl<=-5||filter==='违规样本'&&t.violations?.length||filter==='质量隔离'&&(t.repeatable===false||t.blackSwan)||filter==='标准样本'&&t.repeatable!==false&&!t.blackSwan));
  function main(){
    const visible=trades.filter(r=>(s.scope==='demo'||includeTest||!isTestSample(r))&&sampleMatches(r,selection));
    const total=stats(visible,policyAt(s,localTime())),ss=visible.filter(t=>t.reviewable);
    const count=total.n;
    const mainTabs='<div class="learn-tabs">'+[['ledger','交易台账'],['plans','冻结计划'],['study','因子统计'],['performance','绩效预览'],['forecast','同类样本预估']].map(([k,l])=>'<button type="button" class="btn '+(tab===k?'active-tab':'')+'" data-learnaction="tab:'+k+'">'+l+'</button>').join('')+'</div>';
    let html=controls();
    if(mode==='versions'){
      const ver=versions[0],latest=candidates[0];
      html+=metricsBar([['运行版本',ver?'V'+ver.number:'基础规则'],['候选方案',candidates.length],['待人工审批',candidates.filter(c=>c.status==='待人工审批').length],['已晋级版本',versions.length]]);
      html+=panel('候选参数',button('candidate','生成并验证候选',true),table(['生成日期','训练 / 时间外 / 样本外','评分模型','权重数量','状态','验证记录'],candidates.map(c=>[E(asDate(c.createdAt)),E(c.counts?.join(' / ')),c.numericModel?'正交数值':'原标签',Object.keys(c.weights||{}).length,E(c.status),link('candidate:'+c.id,'查看验证')]),'尚无可验证候选。需累积时点可核验的已成熟样本。'));
      html+=panel('验证与审批顺序','',stages.map((l,i)=>'<div class="learn-stage"><b>'+E(l)+'</b><span class="tag">'+E(latest?.steps?.[i]?.status||'等待样本')+'</span><p>'+E(latest?.steps?.[i]?.evidence||['仅从训练段学习因子权重，冻结选样阈值和训练参数。','验证较晚时段的收益，清除跨越分界的未平仓样本。','在独立留出时段检验已冻结的候选参数。','逐笔增加双边成本与滑点，检验净收益。','检查单笔尾部损失、曲线回撤和标的集中度。'][i])+'</p></div>').join('')+'<p class="learn-hint">五项通过后进入人工审批。审批将保存操作人、意见和版本生效时间。</p>');
      html+=renderLearningSnapshot(perf());
      html+=panel('版本记录','',table(['版本','生效时间','审批人','审批意见'],versions.map(v=>['V'+E(v.number),E(localTime(Date.parse(v.approvedAt)).replace('T',' ')),E(v.reviewer),E(v.reason)]),'当前使用基础规则'));
    }else{
      html+=metricsBar([['已结算样本',count],['样本胜率',val(total.winRate,'%')],['平均盈亏比',val(total.payoff)],['可核验样本纪律达标率',ss.length?val(round(100*ss.filter(t=>!t.violations?.length).length/ss.length),'%'):'—']])+ mainTabs;
      if(tab==='ledger'){
        const rows=selected(),begin=ledgerPage*30;
        html+=panel('交易样本',button('export','导出 CSV')+button('trade','录入已结算交易',true),'<div class="learn-actions" style="justify-content:flex-start;margin-bottom:10px"><input id="learn-search" aria-label="搜索样本" placeholder="搜索标的、代码、因子" value="'+E(q)+'"><select id="learn-filter" aria-label="筛选交易">'+['全部样本','标准样本','大亏案例','违规样本','质量隔离'].map(x=>'<option '+(filter===x?'selected':'')+'>'+x+'</option>').join('')+'</select><span class="learn-small">大亏阈值 ≤ −5%</span></div>'+sampleTable(rows.slice(begin,begin+30))+pager(begin,rows.length,30,'ledger'));
        const sourceLinks=(s.manualLoopLinks||[]).filter(r=>!q||[r.code,r.name].some(v=>String(v||'').includes(q)));
        if(sourceLinks.length){
          const statuses={frozen:'计划已冻结',holding:'持仓中','needs-reconciliation':'待对账',reconciled:'对账一致',reviewed:'已复盘','not-executed':'未执行'};
          html+=panel('V6 人工执行账本','',table(['标的','执行状态','成交笔数','样本归档'],
            sourceLinks.slice(0,100).map(r=>[E(r.name)+' · '+E(r.code),E(statuses[r.status]||r.status),val(r.fillCount),
            r.tradeId?link('view:'+r.tradeId,'查看已结算样本'):E((r.missing||[]).join('、')||'等待成交与对账')])));
        }
      }else if(tab==='plans'){
        html+=panel('冻结的开仓计划',button('plan','新建并冻结计划',true),table(['冻结时间（北京时间）','标的','战法','开仓上限','仓位上限','止损 / 止盈','执行记录'],plans.map(p=>[E(localTime(Date.parse(p.frozenAt)).replace('T',' ')),link('planinfo:'+p.id,p.name)+'<br><small>'+E(p.code)+'</small>',E(p.strategy),val(p.entryMax),val(p.maxPosition,'%'),E(p.stop+' / '+p.target),link('execute:'+p.id,'登记成交')]),'尚无冻结计划。开仓前记录价格、仓位和离场条件。'));
      }else if(tab==='performance'){
        const view=perf(),groups={...view,factorByTrend:view.factorByTrend.filter(r=>(!perfTrend||r.trend===perfTrend)&&(!perfFactor||r.factor===perfFactor)),
          strategyByTrend:view.strategyByTrend.filter(r=>(!perfTrend||r.trend===perfTrend)&&(!perfStrategy||r.strategy===perfStrategy))};
        html+='<div class="learn-actions">'+perfFilter('factor',unique(view.factorByTrend.map(r=>r.factor)),perfFactor)+perfFilter('strategy',unique(view.strategyByTrend.map(r=>r.strategy)),perfStrategy)+perfFilter('trend',['多头','震荡','空头'],perfTrend)+'</div>';
        html+=renderLearningSnapshot(groups,{compact:false})||panel('因子与战法绩效','','<p>当前过滤条件下尚无已收录的成熟样本。</p>');
      }else if(tab==='study'){
        const r=analysis(),groups={single:'单因子',combinations:'双 / 多因子组合',byTrend:'环境适配',risk:'风险叠加',best:'高收益组合',danger:'负向组合'},rows=r[group]||[];
        html+=panel('样本因子统计',button('exportStudy','导出组合')+button('exportCases','导出关联案例'),'<div class="learn-actions" style="justify-content:flex-start;margin-bottom:8px"><select id="learn-group" aria-label="统计维度">'+Object.entries(groups).map(([k,l])=>'<option value="'+k+'" '+(group===k?'selected':'')+'>'+l+'</option>').join('')+'</select><small>纳入 '+reportRows.length+' 条已成熟交易或五日K线样本</small></div>'+viewStats(rows.slice(groupPage*30,groupPage*30+30))+pager(groupPage*30,rows.length,30,'group')+'<p class="learn-hint">组合统计取出现最多的 14 项因子。高收益 / 负向组合至少 6 例，对应胜率 / 亏损率达到 60%。回撤按离场顺序和记录仓位计算归一化曲线。</p>');
      }else{
        const record=current(), p=record?.prediction;
        html+=panel('同类样本预估','',p?'<p>'+E(record.name)+' · '+E(record.strategy)+' · '+E(record.asOf||record.date)+'</p>'+metricsBar([['已成熟样本',val(p.n)],['历史胜率',val(p.winRate,'%')],['历史盈亏比',val(p.payoff)],['均值收益',val(p.expectedReturn,'%')]])+'<p class="learn-hint">'+E(p.risk)+'</p>':'<p class="learn-hint">当前标的暂无可见校验，取得同期证据后自动更新。</p>');
      }
    }
    root.innerHTML=style+'<div class="learn-shell">'+html+'</div>';
    bind();
  }
  function pager(start,count,size,kind){
    if(count<=size)return '';
    return '<div class="learn-actions" style="margin-top:10px">'+(start?button(kind+'prev','上一页'):'')+'<small>'+Math.floor(start/size+1)+' / '+Math.ceil(count/size)+'</small>'+(start+size<count?button(kind+'next','下一页'):'')+'</div>';
  }
  function showInfo(title,body){
    ui.modal(title,body,null);
  }
  function form(title,body,action,transform=x=>x){
    ui.modal(title,body,async fd=>{
      const payload=Object.fromEntries(fd);if(fd.has('customTags'))payload.customTags=fd.getAll('customTags');
      await ui.save(action,transform(payload));
      if(action==='learn:trade')tab='ledger';
      snapshot();report=null;reportRows=null;main();ui.toast('已保存记录');
    });
  }
  function candidateInfo(c){
    const audit=c.steps.map(step=>'<div class="learn-stage"><b>'+E(step.name)+'</b><span>'+E(step.status)+'</span><p>'+E(step.evidence)+'</p></div>').join('');
    const numericDetail=c.numericModel?'<p>正交数值模型 · '+E(c.numericModel.trainingRows)+' 条已核对净费用的训练成交。上方五项验证使用本模型评分；批准后用于研究预测，原交易门禁保持。</p>'+fold('数值定义与冻结基底',
      table(['因子','数值含义 / 单位','训练均值','训练尺度','正交残差尺度'],c.numericModel.parameters.map(p=>[E(p.factorId),E(c.numericModel.definitions[p.factorId].semanticVersion)+' / '+E(c.numericModel.definitions[p.factorId].unit),val(round(p.center)),val(round(p.scale)),val(round(p.residualScale))]))+
      '<p class="learn-small">模型指纹 '+E(c.numericModel.fingerprint)+'；训练截止 '+E(c.numericModel.trainCutoff)+'。</p>'):'<p class="learn-small">原标签出现模型；未建立数值因子获批基线。</p>';
    const body='<p>'+E(c.decay?.decayEnabled?'训练半衰期 '+c.decay.decayHalfLifeDays+' 天':'训练样本等权')+' · '+E(c.sampleScope==='demo'?'演示档案':'正式档案')+'</p><p>'+E(c.start)+' 至 '+E(c.end)+' · 基线 V'+E(c.baseVersion)+'</p><p class="learn-small">时间外起点 '+E(c.trainEnd)+'，样本外起点 '+E(c.validationEnd)+'</p>'+numericDetail+audit+fold('候选因子权重与阈值',table(['因子','候选权重'],Object.entries(c.weights).map(([k,v])=>[E(k),val(v)]))+table(['战法','专属评分门槛'],Object.entries(c.strategyThresholds||{}).map(([k,v])=>[E(k),val(v)]),'采用共用评分阈值')+'<p>选样要求评分大于 '+val(c.threshold)+'，最少 '+val(c.minSupport)+' 条。</p>')+(c.decision?'<p>审批记录 · '+E(c.decision.reviewer)+' · '+E(c.decision.reason)+'</p>':'');
    if(c.status!=='待人工审批')return showInfo('候选验证记录',body);
    form('审核候选参数',body+grid(input('reviewer','审批人','','text',true)+sel('decision','人工决定',['驳回候选','批准晋级']))+textArea('reason','审批意见（必填）'),'learn:decision',p=>({...p,id:c.id,decision:p.decision==='批准晋级'?'approve':'reject'}));
  }
  function bind(){
    root.querySelectorAll('[data-learnaction]').forEach(el=>el.onclick=async()=>{
      const [key,arg]=el.dataset.learnaction.split(':');
      try{
        if(key==='tab'){tab=arg;main();return;}
        if(key.startsWith('ledger')||key.startsWith('group')){if(key.startsWith('ledger'))ledgerPage+=key.endsWith('next')?1:-1;else groupPage+=key.endsWith('next')?1:-1;main();return;}
        if(key==='plan')return form('冻结开仓计划',planForm(s,current()),'learn:plan');
        if(key==='planinfo'){const p=plans.find(t=>t.id===arg);const ns=(s.explanations||[]).filter(n=>n.planId===arg);return form('开仓计划 · '+p.name,table(['字段','存档内容'],[['标的',E(p.code+' / '+p.name)],['计划战法',E(p.strategy)],['开仓逻辑',E(p.logic)],['预期盈亏比',val(p.expectedRR)],['最早计划离场',E(p.holdUntil||'未限制')],['开仓因子',E(p.factors?.join('、'))],['风险标签',E(p.knownRiskFactors?.join('、'))],['校验存档',E(p.checkId||'无关联')],['冻结标签',E((p.customTags||[]).join('、')||'无')]])+fold('追加备注（'+ns.length+'）',ns.map(n=>'<p>'+E(n.text)+'</p>').join(''))+textArea('text','补充备注'),'learn:note',data=>({...data,planId:p.id}));}
        if(key==='trade'||key==='execute')return form(key==='trade'?'录入交易样本':'登记计划执行',tradeForm(s,key==='execute'?plans.find(t=>t.id===arg):null),'learn:trade',p=>formTradeValues(s,p));
        if(key==='view'){
          const t=trades.find(t=>t.id===arg);
          const notes=[...(s.explanations||[]),...(s.notes||[])].filter(n=>n.tradeId===t.id);
          return form(t.name+' · 逐笔纪律复核','<p>'+E(t.entryTime)+' 至 '+E(t.exitTime)+' · '+E(t.exitReason||'未记录')+'</p>'+table(['客观核验项','结论','证据'],(t.disciplineFacts||[]).map(d=>[E(d.rule),E(d.status),E(d.evidence)]))+'<p class="learn-hint">净盈亏 '+val(t.pnlAmount,' 元')+'。因子归因线索为 '+E(t.attribution||'待复核')+'。</p>'+fold('交易标注',table(['标签','取值'],[['系统情绪',E(t.labels?.cycle||'未判定')],...labelGroups.flatMap(([,f])=>f.filter(([k])=>t.labels?.[k]).map(([k,l])=>[E(l),E(t.labels[k])])),['持仓自然日',val(t.holdDays)],['匹配战法',E(strategyList(t).join('、'))],['因子',E(known(t).join('、'))]]))+fold('已存人工批注（'+notes.length+'）',notes.length?notes.map(n=>'<p>'+E(n.text)+'</p>').join(''):'<p>暂无批注</p>')+textArea('text','追加人工解释（与客观证据分开保存）'),'learn:note',p=>({...p,tradeId:t.id}));
        }
        if(key==='candidate'&&arg)return candidateInfo(candidates.find(c=>c.id===arg));
        if(key==='candidate'){await ui.save('learn:candidate',{});snapshot();main();ui.toast('候选验证已完成');return;}
        if(key==='export')return ui.download('交易样本.csv',csv(selected(),exportTradeCols),'text/csv;charset=utf-8');
        if(key==='exportStudy'||key==='exportCases'){
          const groups=analysis()[group]||[];
          if(key==='exportStudy')return ui.download('因子组合.csv',csv(groups,[['key','条件'],['n','样本数'],['winRate','胜率%'],['lossRate','亏损率%'],['payoff','盈亏比'],['expectedReturn','平均收益%'],['maxDrawdown','回撤%']]),'text/csv;charset=utf-8');
          const match=(r,k)=>group==='byTrend'?strategyList(r).some(s=>k===s+' / '+(r.trend||'未记录')):group==='risk'?k===words(r.knownRiskFactors).length+' 项风险叠加':k.split(' + ').every(f=>factorSet(r).includes(f));
          const cases=reportRows.filter(r=>groups.some(g=>match(r,g.key)));
          return ui.download('关联案例.csv',csv(cases,exportTradeCols),'text/csv;charset=utf-8');
        }
      }catch(e){ui.toast(e.message);}
    });
    const search=root.querySelector('#learn-search');
    if(search)search.oninput=()=>{q=search.value;ledgerPage=0;const pos=search.selectionStart;main();const next=root.querySelector('#learn-search');next.focus();next.setSelectionRange(pos,pos);};
    const filterEl=root.querySelector('#learn-filter');if(filterEl)filterEl.onchange=()=>{filter=filterEl.value;if(filter==='质量隔离')selection='all';if(filter==='标准样本')selection='standard';ui.setSample?.(selection);ledgerPage=0;reportRows=report=performance=null;main();};
    const resetStudy=()=>{groupPage=ledgerPage=0;reportRows=report=performance=null;main();};
    const testToggle=root.querySelector('#learn-tests');if(testToggle)testToggle.onchange=()=>{includeTest=testToggle.checked;resetStudy();};
    for(const k of ['factor','strategy','trend']){
      const el=root.querySelector('#learn-perf-'+k);if(el)el.onchange=()=>{if(k==='factor')perfFactor=el.value;else if(k==='strategy')perfStrategy=el.value;else perfTrend=el.value;main();};
    }
    const quality=root.querySelector('#learn-quality');if(quality)quality.onchange=()=>{selection=quality.value;ui.setSample?.(selection);filter='全部样本';resetStudy();};
    const g=root.querySelector('#learn-group');if(g)g.onchange=()=>{group=g.value;groupPage=0;main();};

  }
  main();
}
