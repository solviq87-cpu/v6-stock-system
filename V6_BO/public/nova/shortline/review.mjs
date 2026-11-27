import { emotion, marketAsOf } from './market.mjs';
import { signals, similarCases } from './backtest.mjs';
import { stats } from './learning.mjs';
import {isTestSample,sampleEvidenceTime,evidenceVisibleAt,settlementObservation,uniqueEvidenceRows} from './sample-quality.mjs';
import { selectedSample,qualityOptions,setOptions,flatLines,recordSource,sampleLabel } from './journal-data.mjs';
import {reviewFactorReferences,presentReference} from './model-context.mjs';
import { icon } from './icons.mjs';

const list = v => Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
const labels = v => list(v).map(x => String(typeof x === 'object' ? x.name ?? x.label ?? '' : x)).filter(Boolean);
const number = v => v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null;
const pct = v => number(v) == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
const value = (v, unit = '') => v == null || v === '' ? '未录入' : String(v) + unit;
const day = v => String(v ?? '').slice(0, 10);
const distinct = vs => [...new Set(vs.filter(Boolean))];
const tradeEnd=t=>{
  const at=sampleEvidenceTime(t?.exitTimestamp??t?.exitTime??t?.sellTime??t?.exitDate,{dateAtClose:true});
  return at===null?'':new Date(at+28800000).toISOString().slice(0,10);
};
const idText = t => [t.name, t.code].filter(Boolean).join(' ') || '未命名标的';
const periods = { day: '日复盘', week: '周复盘', month: '月复盘' };
const kinds = { brief: '简短复盘', deep: '深度复盘', annotation: '人工批注', mistake: '错题记录' };
const guardRules = ['仓位纪律','止损纪律','空仓纪律'];
const formEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;

function bounds(date, period) {
  if (!vDate(date) || !Object.hasOwn(periods, period)) throw Error('请选择有效的复盘日期和周期');
  const start = new Date(date + 'T00:00:00Z');
  if (period === 'month') start.setUTCDate(1);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
  return [start.toISOString().slice(0,10), date];
}
function countLabels(rows, fn) {
  const counts = new Map();
  for (const row of rows) for (const key of distinct(labels(fn(row)))) counts.set(key,(counts.get(key)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'zh-CN'));
}
function grouped(rows, fn) {
  const groups = new Map();
  for (const r of rows) for (const key of distinct(labels(fn(r)))) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}
function themesOf(m) {
  const themes = m?.themes?.length ? m.themes : list(m?.theme);
  return themes.map(x=>typeof x==='string'?{name:x,type:m.themeType,days:m.themeDays,
    ladder:m.tier,leader:m.themeLeader,assists:m.assistCount,catchup:m.followers,
    strength:number(m.assistCount)==null?null:Math.min(100,m.assistCount*10)+' / 100（每只助攻记 10 分）',
    persistence:number(m.themeDays)==null?null:Math.min(100,m.themeDays*10)+' / 100（每个延续日记 10 分）'}:x).filter(x=>x?.name);
}
const localMinute=at=>new Date(at+28800000).toISOString().slice(0,16).replace('T',' ');
function reviewCutoff(date,asOf){
  if(!vDate(date))throw Error('请选择有效的复盘日期');
  const requested=asOf===undefined?Date.now():sampleEvidenceTime(asOf);
  if(requested===null)throw Error('复盘观察时点无效');
  return Math.min(requested,Date.now(),Date.parse(date+'T23:59:59.999+08:00'));
}
const recordedCheck=(r,at)=>[r.createdAt,r.recordedAt].some(v=>sampleEvidenceTime(v)!==null)&&evidenceVisibleAt(r,at);
const decisionClock=r=>sampleEvidenceTime(r?.decisionAt??r?.date,{dateAtClose:true});
function periodRows(s,date,period,visible,at,quality,set){
  const [start,end]=bounds(date,period),within=d=>vDate(day(d))&&day(d)>=start&&day(d)<=end;
  const market=visible.filter(r=>within(r.date));
  const rawChecks=list(s.checks).filter(r=>r&&within(r.date)&&selectedSample(r,quality,set));
  const rawTrades=list(s.trades).filter(r=>r&&within(tradeEnd(r))&&selectedSample(r,quality,set));
  const checks=uniqueEvidenceRows(rawChecks.filter(r=>evidenceVisibleAt(r,at)));
  const trades=uniqueEvidenceRows(rawTrades.filter(r=>settlementObservation(r,at)!==null),{settlements:true});
  const evidenceScope={asOf:at,checkConflicts:checks.conflicts,tradeConflicts:trades.conflicts,
    duplicateChecks:checks.duplicates,duplicateTrades:trades.duplicates,
    withheldChecks:rawChecks.length-checks.rows.length-checks.duplicates-checks.conflicts,
    withheldTrades:rawTrades.length-trades.rows.length-trades.duplicates-trades.conflicts,
    legacyUnclockedTrades:trades.rows.filter(r=>settlementObservation(r,at)?.receipt===null).length,
    canTrade:false};
  return {start,end,market,checks:checks.rows,trades:trades.rows,evidenceScope};
}
function nameTags(t) {
  return distinct([...labels(t.strategies),...labels(t.strategy),...labels(t.trend),...labels(t.knownRiskFactors),...labels(t.attribution),...labels(t.violations),t.theme,t.name,t.code]);
}
function signalRows(state,date,at=reviewCutoff(date)){
  return list(state.bars).length?signals(state,localMinute(at)).filter(r=>day(r.date)<=date&&decisionClock(r)!==null&&decisionClock(r)<=at):[];
}
function reviewContext(s,date,period,deep,quality,set,asOf){
  const cutoff=reviewCutoff(date,asOf);
  const declared=s.v6Observation?.latestClosed===true&&s.v6Observation.day===date?
    (s.v6Observation.observedAtMs||s.v6Observation.observedAt):
    s.marketResearchAsOf?.day===date?s.marketResearchAsOf.knownAt:undefined;
  const declaredAt=sampleEvidenceTime(declared);
  const at=Math.min(cutoff,declaredAt??Date.parse(date+'T15:00:00+08:00'));
  const visible=marketAsOf(s,date,at),base=periodRows(s,date,period,visible,cutoff,quality,set);
  const mood=emotion(visible,date,at),exact=base.market.find(x=>x.date===date);
  const allSignals=signalRows(s,date,cutoff).filter(r=>selectedSample(r,quality,set)),sigs=allSignals.filter(r=>day(r.date)>=base.start);
  const recent=sigs.slice().sort((a,b)=>decisionClock(b)-decisionClock(a)||String(a.id).localeCompare(String(b.id)))[0];
  const peers=deep&&recent?similarCases(s,recent,localMinute(decisionClock(recent))):null;
  return {...base,mood,exact,sigs,allSignals,recent,peers,cutoff};
}
function themeLine(t) {
  const attrs=[t.role||t.type,t.days!=null?'启动 '+t.days+' 天':'',t.ladder,t.leader?'龙头 '+t.leader:'',t.assists!=null?'助攻 '+t.assists+' 只':'',t.catchup?'补涨 '+t.catchup:'',t.strength!=null?'强度 '+t.strength:'',t.persistence!=null?'持续性 '+t.persistence:''].filter(Boolean);
  return t.name+(attrs.length?' · '+attrs.join('，'):' · 题材属性与梯队待补充');
}
function statsLine(key,rows) {
  const a=stats(rows);
  return key+' ｜ '+a.n+' 笔，胜率 '+(a.winRate?.toFixed(1)??'—')+'%，盈亏比 '+(a.payoff?.toFixed(2)??'—')+'，样本序列最大回撤 '+(a.maxDrawdown?.toFixed(2)??'—')+'%';
}
function tradeLines(state,t,deep,allSignals,historyCache,cutoff) {
  const observation=settlementObservation(t,cutoff),entry=observation?.entry;
  const plans=list(state.plans).filter(p=>p?.id===t.planId&&t.planId&&p.code===t.code&&entry!=null&&
    sampleEvidenceTime(p.frozenAt)!==null&&sampleEvidenceTime(p.frozenAt)<=entry&&evidenceVisibleAt(p,entry));
  const plan=uniqueEvidenceRows(plans).rows.length===1?uniqueEvidenceRows(plans).rows[0]:null;
  const checks=plan?list(state.checks).filter(c=>c?.id===plan.checkId&&plan.checkId&&c.code===t.code&&
    recordedCheck(c,sampleEvidenceTime(plan.frozenAt))):[];
  const check=uniqueEvidenceRows(checks).rows.length===1?uniqueEvidenceRows(checks).rows[0]:null;
  const result=t.pnl>0?'盈利样本':t.pnl<0?'亏损样本':'持平样本';
  const lines=[idText(t)+' ｜ '+(t.strategy||'战法未录')+' ｜ '+result+' '+pct(t.pnl)+' ｜ '+(labels(t.violations).join('、')||(t.reviewable?'已核记录未见违规':'纪律证据待核'))];
  if(observation?.receipt===null)lines.push('历史结算记录未注明入库时点，仅描述性复盘，不作为可知经验。');
  if (!deep) return lines;
  lines.push(plan?'冻结计划 '+value(plan.frozenAt)+'，逻辑 '+value(plan.logic)+'，计划上限价 '+value(plan.entryMax)+'，仓位上限 '+value(plan.maxPosition,'%')+'，止损 '+value(plan.stop)+'，止盈 '+value(plan.target)+'，预期盈亏比 '+value(plan.expectedRR):'开仓计划未关联，计划内执行情况待核。');
  if(check) lines.push('开仓校验 '+check.status+'，模拟仓位上限 '+value(check.position,'%')+'，识别因子 '+(labels(check.factors||check.selected).join('、')||'无')+'，命中风险 '+(labels(check.risks).join('、')||'无'));
  lines.push('实际入场 '+value(t.entryTime)+'，离场 '+value(t.exitTime)+'，执行仓位 '+value(t.position,'%')+'，离场原因 '+value(t.exitReason));
  for (const f of list(t.disciplineFacts)) lines.push('执行证据 · '+[f.rule,f.status,f.evidence].filter(Boolean).join(' ｜ '));
  const point=entry!=null?localMinute(entry):'';
  const signal=entry!=null&&allSignals.filter(r=>r.code===t.code&&!r.edit&&decisionClock(r)!==null&&decisionClock(r)<=entry)
    .sort((a,b)=>decisionClock(b)-decisionClock(a)||String(a.id).localeCompare(String(b.id)))[0];
  if(signal){
    const key=JSON.stringify([signal.id,decisionClock(signal)]);
    if(!historyCache.has(key))historyCache.set(key,similarCases(state,signal,localMinute(decisionClock(signal))).distributions?.[5]);
    const peers=historyCache.get(key);
    lines.push('入场前最近信号 '+signal.date+' '+signal.strategy+'，同期可见 T+5 同类例数 '+(peers?.n||0)+'，中位收益 '+pct(peers?.median));
  }else lines.push('入场前暂无可对照的同标的历史信号。');
  const exitPoint=observation?localMinute(observation.exit):'';
  const observations=point&&exitPoint?marketAsOf(state,day(exitPoint),exitPoint)
    .filter(r=>r.date+' 15:00'>point && r.date+' 15:00'<=exitPoint)
    .map(r=>marketAsOf(state,r.date).find(v=>v.date===r.date)).filter(Boolean) : [];
  if(observations.length)lines.push('持仓期间收盘观察 · '+observations.map(r=>r.date+' 全 A '+value(r.trend)+' / '+value(r.theme)+' / '+value(r.resonance)).join('；'));
  else lines.push('持仓期间缺少已收盘的指数、题材变化记录。');
  if(t.attribution?.length) lines.push('样本归因标签 · '+labels(t.attribution).join('、'));
  else if(t.knownRiskFactors?.length) lines.push('同现风险（待人工归因） · '+labels(t.knownRiskFactors).join('、'));
  for(const n of list(state.explanations).filter(n=>n.tradeId===t.id))
    lines.push((evidenceVisibleAt(n,cutoff)&&sampleEvidenceTime(n.createdAt)!==null?'人工解释（主观）':'事后或时点待核人工解释')+' · '+n.text);
  return lines;
}
export function mistakeSummary(state,date='9999-12-31',quality='all',set='all') {
  const cutoff=reviewCutoff(date);
  const trades=uniqueEvidenceRows(list(state.trades).filter(t=>tradeEnd(t)&&tradeEnd(t)<=date&&selectedSample(t,quality,set)&&
    settlementObservation(t,cutoff)!==null),{settlements:true}).rows;
  const since=new Date(date==='9999-12-31'?(trades.map(tradeEnd).sort().at(-1)||'2000-01-01'):date);
  if(Number.isFinite(+since)) since.setUTCDate(since.getUTCDate()-29);
  const start=Number.isFinite(+since)?since.toISOString().slice(0,10):'';
  const sample=trades.filter(t=>tradeEnd(t)>=start);
  return countLabels(sample,t=>[...labels(t.violations),...(Number(t.pnl)<0?labels(t.knownRiskFactors):[])]).map(([label,count])=>({label,count}));
}
export function buildReview(state,{date,period='day',depth='brief',quality='all',set='all',asOf}={}) {
  if(!Object.hasOwn(qualityOptions,quality)||!Object.hasOwn(setOptions,set))throw Error('样本筛选无效');
  if (!['brief','deep'].includes(depth)) throw Error('请选择复盘深度');
  const {start,end,market,checks,trades,mood,exact:m,sigs,allSignals,recent,peers,cutoff,evidenceScope}=reviewContext(state,date,period,depth==='deep'||period!=='day',quality,set,asOf);
  const deep=depth==='deep', groups=[], add=(title,lines)=>groups.push({title,lines:lines.filter(Boolean)});
  const tags=distinct([...market.flatMap(x=>themesOf(x).map(t=>t.name)),...(mood.stage==='未判定'?[]:[mood.stage]),...trades.flatMap(nameTags),...checks.flatMap(x=>[x.strategy,x.name,x.code,...labels(x.risks)])]).map(String);
  add('盘面与指数',m?[
    '全 A '+value(m.trend)+'，上证 '+value(m.sh)+'，创业板 '+value(m.cy)+'。上涨 '+value(m.adv,' 家')+'，下跌 '+value(m.dec,' 家')+'。',
    '成交额 '+value(m.amount,' 亿元')+'，涨停 '+value(m.upLimit,' 家')+'，跌停 '+value(m.downLimit,' 家')+'，炸板率 '+value(m.breakRate,'%')+'，昨日涨停溢价 '+value(m.premium,'%')+'。',
    (m.resonance||m.volume)?'量能 '+value(m.volume)+'，题材指数关系 '+value(m.resonance):''
  ]:['所选日期暂无盘面记录。']);
  add('市场情绪',[(mood.stage||'未判定')+' ｜ 规则判定分 '+value(mood.confidence)+' / 100（非胜率）',...labels(mood.evidence),'缺失数据 · '+(labels(mood.missing).join('、')||'无')]);
  add('题材与重点标的',[...(themesOf(m).length?themesOf(m).map(themeLine):['当日尚无题材记录。']),
    ...checks.map(c=>idText(c)+' ｜ '+value(c.role||c.strategy)+' ｜ '+value(c.status)+' ｜ '+(labels(c.risks).join('、')||'未记录风险')),
    ...sigs.slice(-8).map(r=>idText(r)+' ｜ '+value(r.strategy)+' ｜ '+value(r.type))]);
  const receipts=list(state.importedLimitPools).filter(b=>b.tradeDate>=start&&b.tradeDate<=end&&Number.isFinite(b.knownAt)&&b.knownAt<=cutoff);
  const stockLinks={};
  const nThemes=Math.max(1,themesOf(m).length);
  checks.forEach((r,i)=>{stockLinks[nThemes+i]={page:'structure',code:r.code,date:r.date,strategy:r.strategy,ref:r.id};});
  sigs.slice(-8).forEach((r,i)=>{stockLinks[nThemes+checks.length+i]={page:'backtest',code:r.code,date:day(r.date),strategy:r.strategy,ref:r.id};});
  groups.at(-1).links=stockLinks;
  const references=reviewFactorReferences(checks,state.catalog,cutoff).slice(0,deep?18:6);
  if(references.length){
    add('因子代号复核',references.map(presentReference));
    groups.at(-1).links=Object.fromEntries(references.map((r,i)=>[i,{page:'dictionary',date:end,factor:r.code,ref:r.code}]));
  }
  if(receipts.length)add('涨停列表原始资料',receipts.map(b=>b.tradeDate+' · '+b.source+' · '+b.scope+' · 已列 '+b.rows.length+' 只 · 原题材 '+(distinct(b.rows.map(r=>r.theme)).slice(0,20).join('、')||'未提供')+' · 取得 '+b.availableAt+(b.knownAt>Date.parse(b.tradeDate+'T15:00:00+08:00')?' · 收盘后补录资料。':' · 收盘时已取得。')+'覆盖范围限导入清单。'));
  const flats=list(state.flatRecords).filter(r=>r.end>=start&&r.end<=end&&selectedSample(r,quality,set)&&evidenceVisibleAt(r,cutoff));
  if(flats.length)add('空仓手记与区间基准',flats.flatMap(r=>flatLines({...state,trades},r,cutoff)));
  if(quality!=='all'||set!=='all')add('样本筛选',['本期校验、交易与信号按 '+qualityOptions[quality]+' / '+setOptions[set]+' 统计。相似历史分布沿用信号发生时的规则样本库。']);
  if(period!=='day') {
    let lastStage=null,lastTheme=null;
    const events=[];
    for (const row of market) {
      const daily=marketAsOf(state,row.date);
      const stage=emotion(daily,row.date).stage;
      const theme=themesOf(daily.find(v=>v.date===row.date)).map(t=>t.name).join('、')||'未录入';
      if(stage!==lastStage||theme!==lastTheme)events.push(row.date+' ｜ '+stage+' ｜ '+theme);
      lastStage=stage;lastTheme=theme;
    }
    add('情绪与主线时间轴',events.length?events:['本周期没有盘面记录。']);
  }
  const historyCache=new Map();
  const lines=[],links={};
  for(const t of trades){links[lines.length]={page:'trades',code:t.code,date:tradeEnd(t),strategy:t.strategy,ref:t.id};lines.push(...tradeLines(state,t,deep,allSignals,historyCache,cutoff));}
  add('个人交易复盘',lines.length?lines:['本周期暂无已结算交易。']);groups.at(-1).links=links;
  if(deep||period!=='day') {
    const eligible=trades.filter(t=>t.repeatable!==false&&settlementObservation(t,cutoff,{requireReceipt:true})!==null);
    add('战法绩效与环境适配',eligible.length?
      [...grouped(eligible,t=>t.strategies?.length?t.strategies:t.strategy||'未标注战法')].map(([k,rows])=>statsLine(k,rows)).concat(
        [...grouped(eligible,t=>String(t.trend||'环境未录')+' / '+String(t.strategy||'战法未录'))].map(([k,rows])=>statsLine(k,rows)),
        '胜率按已结算、可重复样本统计。回撤按离场顺序和实际仓位复利计算，重叠持仓未合并为账户净值。'):['可重复的已结算样本不足。']);
    const losses=eligible.filter(t=>t.pnl<0);
    const freq=countLabels(losses,t=>[...labels(t.knownRiskFactors),...labels(t.violations)]);
    add('高频亏损与体系优化',freq.length?freq.map(([k,n])=>k+' · 在 '+n+' 笔亏损样本中出现，列入下次开仓前核对。'):['暂无重复出现的风险记录，保留样本继续观察。']);
    add('历史信号与相似案例',recent?[
      '检索锚点 '+recent.date+' '+idText(recent)+'，按信号当时可见的形态、量能、换手、指数趋势和题材周期比较。',
      '成功侧 · '+(list(peers?.success).slice(0,3).map(r=>day(r.date)+' '+idText(r)).join('；')||'暂无已成熟样本'),
      '失败侧 · '+(list(peers?.failure).slice(0,3).map(r=>day(r.date)+' '+idText(r)).join('；')||'暂无已成熟样本'),
      ...[1,3,5,10].map(n=>{const d=peers?.distributions?.[n];return d?.n?'T+'+n+'（'+d.n+'例） 收盘收益中位 '+pct(d.median)+'，四分位区间 '+pct(d.p25)+' 至 '+pct(d.p75)+'，范围 '+pct(d.min)+' 至 '+pct(d.max):'T+'+n+' · 无已成熟样本';}),
      peers?.missing?.length?'缺失维度 · '+labels(peers.missing).join('、'):''
    ]:['本期暂无历史 K 线信号，可导入同期行情后生成对照。']);
  }
  const today=checks.filter(c=>c.date===date&&recordedCheck(c,cutoff)&&
    (state.scope==='demo'||!isTestSample(c))&&typeof c.position==='number'&&Number.isFinite(c.position)&&c.position>=0&&c.position<=100);
  const cap=!m||mood.stage==='未判定'?0:Math.max(0,...today.map(c=>number(c.position)||0));
  const noEntry=cap===0;
  const passed=new Set(today.filter(c=>number(c.position)>0).flatMap(c=>labels(c.eligible||c.strategy)));
  const blocked=distinct(today.filter(c=>number(c.position)===0).flatMap(c=>labels(c.matches||c.strategy))).filter(s=>s!=='未匹配'&&!passed.has(s));
  add('下一交易日预案',[
    '当日已通过校验标的的最高模拟仓位上限 '+cap+'%。次日须用新盘面重新校验。',
    noEntry?'暂缓新开仓，先复核情绪证据、指数与风险项。':'逐项复核量能、题材助攻和承接，再按冻结计划观察。',
    blocked.length?'暂停战法 · '+distinct(blocked).join('、'):(noEntry?'暂停战法 · 所有开仓模式':'暂停未通过当日校验的战法。'),
    ...(today.length?today.map(c=>'观察 '+idText(c)+' · '+(labels(c.risks).length?'跟踪风险 '+labels(c.risks).join('、')+' 的变化':'观察题材和指数是否共振，重新核验 '+value(c.strategy))):['观察清单暂无标的，可从战法校验模块记录候选。'])]);
  // Ordinary archive browsing and auto-refresh must still show later
  // registered transactions. They are retrospective, never used above for
  // counts, tags, risk frequency, similarities or next-session position.
  if(asOf===undefined){
    const viewAt=Date.now();
    const within=d=>vDate(day(d))&&day(d)>=start&&day(d)<=end;
    const laterTrades=uniqueEvidenceRows(list(state.trades).filter(t=>t&&within(tradeEnd(t))&&
      selectedSample(t,quality,set)&&settlementObservation(t,viewAt,{requireReceipt:true})!==null),{settlements:true}).rows
      .filter(t=>!settlementObservation(t,cutoff));
    const laterChecks=uniqueEvidenceRows(list(state.checks).filter(c=>c&&within(c.date)&&
      selectedSample(c,quality,set)&&recordedCheck(c,viewAt))).rows.filter(c=>!evidenceVisibleAt(c,cutoff));
    const additions=[...laterTrades.map(t=>idText(t)+' ｜ 事后登记成交 '+value(t.exitTime||t.exitDate)+' ｜ '+pct(t.pnl)+
      ' ｜ 登记 '+value(t.createdAt||t.recordedAt)),
      ...laterChecks.map(c=>idText(c)+' ｜ 事后登记校验 '+value(c.date)+' ｜ 登记 '+value(c.createdAt||c.recordedAt))];
    if(additions.length)add('事后补录（仅归档，不参与当时判断或绩效）',additions);
  }
  const annotations=list(state.notes).filter(n=>['annotation','mistake'].includes(n.kind)&&n.date>=start&&n.date<=end);
  if(annotations.length)add('人工批注',annotations.map(n=>n.date+
    (evidenceVisibleAt(n,cutoff)&&sampleEvidenceTime(n.createdAt)!==null?' · 主观批注 · ':' · 事后或时点待核批注 · ')+n.text));
  if(evidenceScope.withheldChecks||evidenceScope.withheldTrades||evidenceScope.checkConflicts||evidenceScope.tradeConflicts||
     evidenceScope.duplicateChecks||evidenceScope.duplicateTrades||evidenceScope.legacyUnclockedTrades)
    add('复盘证据边界',['晚到/未结算或无效证据：校验 '+evidenceScope.withheldChecks+'、交易 '+evidenceScope.withheldTrades+
      '；冲突记录 '+(evidenceScope.checkConflicts+evidenceScope.tradeConflicts)+'；重复记录 '+(evidenceScope.duplicateChecks+evidenceScope.duplicateTrades)+
      '；未注明入库时点的历史交易 '+evidenceScope.legacyUnclockedTrades+'。不将补录或重复记录当作事前经验。']);
  const title=periods[period]+' · '+kinds[depth];
  const text='# '+title+'\n\n'+start+(end===start?'':' 至 '+end)+'\n\n'+groups.map(g=>'## '+g.title+'\n\n'+g.lines.map(l=>'- '+l).join('\n')).join('\n\n');
  return {title,start,end,date,period,depth,groups,tags:distinct([periods[period],kinds[depth],...tags]),text,evidenceScope,totals:{checks:checks.length,trades:trades.length,signals:sigs.length,stage:mood.stage}};
}
function cleanString(v,max=4000) {return String(v??'').trim().slice(0,max);}
const newId=()=>globalThis.crypto.randomUUID();
export function reviewAction(state,action,payload={}) {
  if(!vDate(payload.date))throw Error('复盘日期无效');
  const date=payload.date, createdAt=new Date().toISOString();
  state.notes??=[];state.checkins??=[];
  if(action==='review:generate'){
    const r=buildReview(state,{date,period:payload.period,depth:payload.depth,quality:payload.quality,set:payload.set});
    const n={id:newId(),date,kind:r.depth,period:r.period,qualityFilter:payload.quality||'all',sampleSetFilter:payload.set||'all',text:r.text,title:r.title,tags:r.tags,createdAt};
    state.notes.push(n);return n;
  }
  if(action==='review:checkin'){
    const rules={};
    for(const r of guardRules){if(!['遵守','违反','不适用'].includes(payload.rules?.[r]))throw Error('请完成三项纪律打卡');rules[r]=payload.rules[r];}
    const old=state.checkins.find(x=>x.date===date);
    const item={id:old?.id||newId(),date,rules,text:cleanString(payload.text,2000),createdAt};
    if(old)Object.assign(old,item);else state.checkins.push(item);
    return item;
  }
  if(action==='review:note'){
    if(!['annotation','mistake'].includes(payload.kind))throw Error('批注类型无效');
    const text=cleanString(payload.text);if(!text)throw Error('请填写复盘内容');
    const trade=payload.tradeId&&list(state.trades).find(x=>String(x.id)===String(payload.tradeId));
    if(payload.tradeId&&(!trade||!tradeEnd(trade)||tradeEnd(trade)>date||!settlementObservation(trade,Date.now())))throw Error('只能关联复盘日已结算的交易');
    const tags=distinct([...cleanString(payload.tags,400).split(/[，,、\s]+/).filter(Boolean),...(trade?nameTags(trade):[])]).slice(0,60);
    const n={id:newId(),date,createdAt,kind:payload.kind,text,tags,tradeId:trade?.id||null,factor:cleanString(payload.factor,80)};
    state.notes.push(n);return n;
  }
  throw Error('未知的复盘操作');
}

const reviewStyles = `<style>
.rev{--rv-ink:#272b3e;--rv-mute:#637086;--rv-line:#e6e8ee;color:var(--rv-ink);display:grid;gap:18px}.rev *{box-sizing:border-box}
.rev .panel{padding:22px}.rev h2,.rev h3,.rev p{margin:0}.rev h2{font-size:18px}.rev h3{font-size:15px}
.rv-row,.rv-title,.rv-actions,.rv-chips,.rv-tabs{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.rv-title{justify-content:space-between;margin-bottom:18px}
.rv-flag{color:#6c54ce}.rv-tools{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:space-between}
.rv-tabs{padding:3px;background:#f0f1f6;border-radius:7px;gap:2px}.rv-tab{background:transparent;color:#586175;cursor:pointer;border:0;border-radius:5px;padding:7px 13px;font:inherit;font-size:14px}.rv-tab[aria-pressed=true]{background:white;color:#6652c8;box-shadow:0 1px 4px #29335618}
.rev input,.rev select{font:inherit;font-size:14px;background:white;color:var(--rv-ink);border:1px solid #dfe2eb;padding:8px 10px;border-radius:7px}.rv-search{width:min(320px,100%)}
.rv-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.rv-metric{border:1px solid var(--rv-line);background:#fff;padding:15px 18px;border-radius:10px}.rv-metric span,.rv-sub{font-size:13px;color:var(--rv-mute)}.rv-metric strong{display:block;margin-top:5px;font-size:22px}
.rv-doc{display:grid;gap:0}.rv-doc section{padding:16px 0;border-bottom:1px solid var(--rv-line)}.rv-doc section:last-child{border:0;padding-bottom:0}.rv-doc ul{margin:9px 0 0;padding-left:20px;line-height:1.85;font-size:14px;color:#4f596b}.rv-doc h3{display:flex;align-items:center;gap:8px}.rv-doc h3 svg{color:#7b68d2}
.rv-note{border-top:1px solid var(--rv-line);padding:13px 0}.rv-note:last-child{padding-bottom:0}.rv-note summary{cursor:pointer;line-height:1.6}.rv-note pre{white-space:pre-wrap;font:inherit;font-size:14px;line-height:1.8;color:#515d70;background:#f7f8fc;padding:14px;border-radius:8px;max-height:480px;overflow:auto}
.rv-tag{display:inline-block;background:#f1eefb;color:#6e57be;border-radius:5px;font-size:12px;padding:3px 8px;margin:2px}.rv-empty{padding:20px 0;color:var(--rv-mute);font-size:14px}.rv-table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:14px}.rv-table th,.rv-table td{padding:12px 10px;text-align:left;border-bottom:1px solid var(--rv-line)}.rv-table th{font-weight:500;color:var(--rv-mute);background:#f8f9fc}.rv-table small{display:block;color:#758096}.rv-neg{color:#218b69}.rv-pos{color:#c44e5b}
@media(max-width:690px){.rv-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.rev .panel{padding:15px}.rv-title{align-items:flex-start}.rv-tabs{overflow:auto;flex-wrap:nowrap;max-width:100%}.rv-tab{white-space:nowrap;padding:7px 9px}}
</style>`;
const field=(label,body)=>'<label class="field">'+formEsc(label)+body+'</label>';
const button=(act,title,primary=false,ico='')=>'<button type="button" class="btn'+(primary?' primary':'')+'" data-review="'+act+'">'+(ico?icon(ico,16):'')+formEsc(title)+'</button>';
const empty=text=>'<div class="rv-empty">'+formEsc(text)+'</div>';
const opt=(v,label,sel)=>'<option value="'+formEsc(v)+'"'+(sel?' selected':'')+'>'+formEsc(label)+'</option>';
function table(head,rows) {return '<div class="table-wrap"><table class="rv-table"><thead><tr>'+head.map(h=>'<th>'+formEsc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function tabset(key,options,cur) {return '<div class="rv-tabs">'+Object.entries(options).map(([v,l])=>'<button type="button" class="rv-tab" data-'+key+'="'+v+'" aria-pressed="'+(cur===v)+'">'+formEsc(l)+'</button>').join('')+'</div>';}
function downloadCsv(ui,name,rows) {
  const csv=rows.map(row=>row.map(v=>{
    let s=String(v??'');
    if(/^[\s]*[=+@-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  ui.download(name,'\uFEFF'+csv,'text/csv;charset=utf-8');
}
function reportPng(report) {
  const width=1100,padding=55,lineHeight=29;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('当前浏览器不支持图片导出');
  const lines=[],font='18px system-ui, sans-serif';
  function wrap(text,heading=false) {
    ctx.font=heading?'bold 22px system-ui, sans-serif':font;
    let line='';
    for(const c of String(text)){
      if(c==='\n'||(line&&ctx.measureText(line+c).width>width-2*padding)){
        lines.push({line,heading});line='';
      }
      if(c!=='\n')line+=c;
    }
    if(line)lines.push({line,heading});
  }
  report.groups.forEach(g=>{lines.push({line:''});wrap(g.title,true);g.lines.forEach(t=>wrap('· '+t));});
  const perPage=190;
  for(let offset=0;offset<lines.length;offset+=perPage) {
    const page=lines.slice(offset,offset+perPage);
    canvas.width=width;canvas.height=145+page.length*lineHeight+44;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);
    ctx.fillStyle='#6553ce';ctx.fillRect(0,0,width,9);
    ctx.fillStyle='#242438';ctx.font='bold 32px system-ui,sans-serif';ctx.fillText(report.title,padding,62);
    ctx.fillStyle='#647084';ctx.font=font;ctx.fillText('天枢智策 V6  /  '+report.start+' 至 '+report.end,padding,100);
    page.forEach(({line,heading},i)=>{ctx.fillStyle=heading?'#5746aa':'#404655';ctx.font=heading?'bold 22px system-ui,sans-serif':font;ctx.fillText(line,padding,133+i*lineHeight);});
    const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='复盘-'+report.end+(lines.length>perPage?'-'+(Math.floor(offset/perPage)+1):'')+'.png';a.click();
  }
}
function archiveMarkup(notes,query,ref) {
  const q=query.trim().toLocaleLowerCase(),filtered=notes.filter(n=>[n.id,n.tradeId,n.text,n.title,n.date,kinds[n.kind],...labels(n.tags)].join(' ').toLocaleLowerCase().includes(q));
  if(!filtered.length)return empty(q?'没有匹配的复盘记录。':'暂无归档，可生成复盘或添加人工批注。');
  return filtered.map(n=>'<details class="rv-note"'+(n.id===ref?' open':'')+'><summary><b>'+formEsc(n.title||kinds[n.kind]||'复盘笔记')+'</b> <span class="rv-sub">'+formEsc(n.date)+'</span> '+labels(n.tags).slice(0,4).map(t=>'<span class="rv-tag">'+formEsc(t)+'</span>').join('')+'</summary><pre>'+formEsc(n.text)+'</pre></details>').join('');
}
function checkStats(rows) {
  const rules=rows.flatMap(r=>Object.values(r.rules||{})).filter(x=>['遵守','违反'].includes(x));
  return {total:rules.length,pass:rules.filter(x=>x==='遵守').length,rate:rules.length?Math.round(100*rules.filter(x=>x==='遵守').length/rules.length)+'%':'—'};
}
function openAnnotation(ui,date,mistake,done) {
  const trades=list(ui.state.trades).filter(t=>tradeEnd(t)<=date).sort((a,b)=>tradeEnd(b).localeCompare(tradeEnd(a)));
  ui.modal(mistake?'记录错题':'添加复盘批注',
    '<div class="grid2">'+field('复盘日期','<input type="date" name="date" value="'+date+'" required>')+field('关联交易','<select name="tradeId">'+opt('','独立笔记',true)+trades.map(t=>opt(t.id,tradeEnd(t)+' '+idText(t),false)).join('')+'</select>')+'</div>'+
    field('复盘内容','<textarea name="text" rows="5" required maxlength="4000" placeholder="记录当时观察、原因和下一次的核对条件"></textarea>')+
    field('检索标签','<input name="tags" maxlength="400" placeholder="战法、题材、标的或亏损原因，以逗号分隔">')+
    field('待验证因子（选填）','<input name="factor" maxlength="80" placeholder="例如，板块助攻不足">'),
    async fd=>{await ui.save('review:note',{...Object.fromEntries(fd),kind:mistake?'mistake':'annotation'});done();});
}
function openCheckin(ui,date,done) {
  const prev=list(ui.state.checkins).find(r=>r.date===date);
  ui.modal(date+' · 交易纪律打卡',guardRules.map((r,i)=>field(r,'<select required name="rule'+i+'"><option value="">请选择</option>'+['遵守','违反','不适用'].map(v=>opt(v,v,prev?.rules?.[r]===v)).join('')+'</select>')).join('')+
    field('执行说明（选填）','<textarea name="text" maxlength="2000" rows="3">'+formEsc(prev?.text||'')+'</textarea>'),
    async fd=>{await ui.save('review:checkin',{date,rules:Object.fromEntries(guardRules.map((r,i)=>[r,fd.get('rule'+i)])),text:fd.get('text')});done();});
}
function detailedCases(s,cutoff,side,quality,set) {
  const isLoss=side==='failure';
  const trades=list(s.trades).filter(t=>selectedSample(t,quality,set)&&tradeEnd(t)<=cutoff && number(t.pnl)!=null && (isLoss?t.pnl<=-5:t.pnl>=5));
  let rows=trades.map(t=>({date:tradeEnd(t),code:t.code,ref:t.id,route:'trades',name:idText(t),strategy:t.strategy,source:recordSource(t),sampleSet:sampleLabel(t),ret:t.pnl,features:distinct([...labels(t.knownRiskFactors),...labels(t.factors)]),discipline:labels(t.violations).join('、')||'未记录违规'}));
  for(const sig of signalRows(s,cutoff)) {
    const o=sig.outcomes?.[5],ret=number(o?.close);
    if(!selectedSample({...sig,blackSwan:sig.blackSwan||o?.blackSwan,extreme:sig.extreme||o?.extreme,sampleSet:o?.sampleSet||sig.sampleSet},quality,set)||ret==null||day(o.end)>cutoff||!(isLoss?ret<=-5:ret>=5))continue;
    rows.push({date:sig.date,code:sig.code,ref:sig.id,route:'backtest',name:idText(sig),strategy:sig.strategy,source:'K 线 T+5 · '+(sig.sampleSource||'回测规则'),sampleSet:sampleLabel(sig),ret,features:distinct([...labels(sig.risks),...labels(sig.features?.shape),...labels(sig.features?.volume)]),discipline:'—'});
  }
  return rows.sort((a,b)=>b.date.localeCompare(a.date));
}
export function renderReview(ui,mode='review') {
  const isMistakes=mode==='mistakes',s=ui.state;
  let date=day(ui.date||[...list(s.market).map(t=>t.date),...list(s.trades).map(tradeEnd),...list(s.checks).map(t=>t.date)].filter(vDate).sort().at(-1)||new Date().toISOString());
  let period='day',depth='brief',quality=Object.hasOwn(qualityOptions,ui.sampleFilter)?ui.sampleFilter:'all',set='all',caseSide='failure',archiveQuery=ui.ref||ui.factor||ui.strategy||'',page=0,caseQuery=ui.factor||ui.strategy||ui.stock||'';
  function draw() {
    const s=ui.state, ro=ui.root;
    let report,cases;
    if(!isMistakes) report=buildReview(s,{date,period,depth,quality,set});
    const notes=list(s.notes).slice().reverse().filter(n=>isMistakes?n.kind==='mistake'&&n.date<=date:n.date<=date);
    const ck=list(s.checkins).filter(r=>r.date<=date),cc=checkStats(ck);
    const chooseDate='<label class="rv-row rv-sub">截至日期 <input aria-label="复盘截止日期" value="'+date+'" type="date" data-rdate required></label>';
    const picker=(label,key,choices,current)=>'<label class="rv-row rv-sub">'+label+' <select data-review-filter="'+key+'">'+Object.entries(choices).map(([v,l])=>opt(v,l,current===v)).join('')+'</select></label>';
    const sampleFilters=picker('样本质量','quality',qualityOptions,quality)+picker('样本集','set',setOptions,set);
    let body;
    if(!isMistakes){
      const metrics=[['市场情绪',report.totals.stage],['校验记录',report.totals.checks+' 条'],['已结算交易',report.totals.trades+' 笔'],['历史信号',report.totals.signals+' 个']];
      body='<section class="panel rv-tools"><div class="rv-row">'+tabset('period',periods,period)+chooseDate+sampleFilters+'</div><div class="rv-actions">'+button('brief','生成简短复盘',false,'file')+button('deep','生成深度复盘',true,'activity')+'</div></section>'+
        '<div class="rv-metrics">'+metrics.map(([k,v])=>'<div class="rv-metric"><span>'+k+'</span><strong>'+formEsc(v)+'</strong></div>').join('')+'</div>'+
        '<section class="panel"><div class="rv-title"><div><h2>'+formEsc(report.title)+'</h2><span class="rv-sub">'+report.start+(report.end!==report.start?' 至 '+report.end:'')+'</span></div><div class="rv-actions">'+button('zip','当日 ZIP',false,'download')+button('md','Markdown',false,'download')+button('png','图片',false,'download')+button('csv','CSV',false,'download')+'</div></div><div class="rv-doc">'+
        report.groups.map((g,gi)=>'<section><h3>'+icon('file',16)+formEsc(g.title)+'</h3><ul>'+g.lines.map((l,i)=>'<li>'+formEsc(l)+(g.links?.[i]?.code?' <button class="btn" type="button" data-review-link="'+gi+'-'+i+'">'+({backtest:'回看信号',trades:'查看交易',structure:'同期题材'}[g.links[i].page])+'</button>':'')+'</li>').join('')+'</ul></section>').join('')+'</div></section>';
    }else{
      const top=mistakeSummary(s,date,quality,set);
      cases=detailedCases(s,date,caseSide,quality,set);
      const common=countLabels(cases,c=>c.features).filter(x=>x[1]>=2);
      body='<section class="panel rv-tools">'+chooseDate+sampleFilters+'<div class="rv-actions">'+button('mistake','记录错题',true,'plus')+'</div></section>'+
        '<section class="panel"><div class="rv-title"><h2>近 30 日高频坑点</h2><span class="rv-sub">执行偏离与亏损样本中的风险</span></div>' + (top.length?'<div class="rv-chips">'+top.slice(0,12).map(({label,count})=>'<span class="rv-tag">'+formEsc(label)+' · '+count+' 次</span>').join('')+'</div>':empty('此时间段暂无已记录的纪律偏离或亏损风险标签。'))+'</section>';
      body+='<section class="panel"><div class="rv-title"><h2>历史案例库</h2>'+tabset('caseside',{failure:'大亏样本',success:'高盈利样本'},caseSide)+'</div><div class="rv-tools"><input class="rv-search" data-casequery aria-label="检索案例" placeholder="检索标的、战法或因子" value="'+formEsc(caseQuery)+'"><span class="rv-sub">'+(caseSide==='failure'?'收益 ≤ −5%':'收益 ≥ +5%')+' · 人工交易与 T+5 收盘收益</span></div><div data-caselist></div><div class="rv-chips"><span class="rv-sub">重复出现的因子</span>'+ (common.length?common.slice(0,8).map(([k,n])=>'<span class="rv-tag">'+formEsc(k)+' × '+n+'</span>').join(''):'<span class="rv-sub">样本不足</span>')+'</div></section>';
    }
    body+='<section class="panel"><div class="rv-title"><h2>交易纪律打卡</h2>'+button('checkin','填写打卡',false,'check')+'</div><div class="rv-row"><strong>'+cc.rate+'</strong><span class="rv-sub">历史执行率 · 已遵守 '+cc.pass+' / '+cc.total+' 项</span></div>'+
      (ck.some(r=>r.date===date)?'<div class="rv-chips">'+Object.entries(ck.find(r=>r.date===date).rules).map(([k,v])=>'<span class="rv-tag">'+formEsc(k)+' · '+formEsc(v)+'</span>').join('')+'</div>':'<p class="rv-sub">所选日期尚未打卡</p>')+'</section>'+
      '<section class="panel"><div class="rv-title"><h2>'+(isMistakes?'错题记录':'复盘归档')+'</h2>'+button('note',isMistakes?'增加记录':'添加批注',false,'plus')+'</div><input class="rv-search" data-query placeholder="搜索战法、周期、题材、标的或原因" aria-label="检索复盘笔记" value="'+formEsc(archiveQuery)+'"><div data-notes>'+archiveMarkup(notes,archiveQuery,ui.ref)+'</div></section>';
    ro.innerHTML=reviewStyles+'<div class="rev">'+body+'</div>';
    const find=q=>ro.querySelector(q);
    find('[data-rdate]').onchange=e=>{if(vDate(e.target.value)){date=e.target.value;page=0;draw();}};
    find('[data-query]').oninput=e=>{archiveQuery=e.target.value;find('[data-notes]').innerHTML=archiveMarkup(notes,archiveQuery,ui.ref);};
    if(isMistakes){
      function caseTable(){
        const q=caseQuery.trim().toLowerCase(), rows=cases.filter(r=>[r.name,r.strategy,...r.features].join(' ').toLowerCase().includes(q)),max=Math.max(1,Math.ceil(rows.length/20));
        page=Math.min(page,max-1);
        find('[data-caselist]').innerHTML=rows.length?table(['标的 / 日期','来源','战法','收益','纪律记录'],rows.slice(page*20,(page+1)*20).map((r,i)=>['<button class="btn" data-case-open="'+(page*20+i)+'">'+formEsc(r.name)+'</button><small>'+formEsc(r.date)+'</small>',formEsc(r.source),formEsc(r.strategy),'<b class="'+(r.ret>0?'rv-pos':'rv-neg')+'">'+pct(r.ret)+'</b>',formEsc(r.discipline)]))+'<div class="rv-row" style="margin:12px 0">'+(page>0?button('prev','上一页'):'')+'<span class="rv-sub">'+(page+1)+' / '+max+' 页 · '+rows.length+' 条</span>'+(page+1<max?button('next','下一页'):'')+button('casescsv','导出案例',false,'download')+'</div>':empty('暂无符合条件的已结算案例。');
        for(const b of ro.querySelectorAll('[data-case-open]'))b.onclick=()=>{const r=rows[Number(b.dataset.caseOpen)];ui.open(r.route,{code:r.code,date:day(r.date),sample:quality,strategy:r.strategy||'',factor:ui.factor||'',ref:r.ref});};
        const bind=(a,fn)=>{const b=find('[data-review="'+a+'"]');if(b)b.onclick=fn;};
        bind('prev',()=>{page--;caseTable();});bind('next',()=>{page++;caseTable();});
        bind('casescsv',()=>downloadCsv(ui,(caseSide==='failure'?'大亏':'盈利')+'案例.csv',[['日期','标的','战法','来源','样本集','收益(%)','同现因子','纪律偏离'],...rows.map(r=>[r.date,r.name,r.strategy,r.source,r.sampleSet,r.ret,r.features.join('、'),r.discipline])]));
      }
      caseTable();
      find('[data-casequery]').oninput=e=>{caseQuery=e.target.value;page=0;caseTable();};
    }
    ro.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{period=b.dataset.period;draw();});
    ro.querySelectorAll('[data-caseside]').forEach(b=>b.onclick=()=>{caseSide=b.dataset.caseside;page=0;draw();});
    for(const b of ro.querySelectorAll('[data-review-link]'))b.onclick=()=>{const [gi,i]=b.dataset.reviewLink.split('-');const d=report.groups[gi]?.links?.[i];if(d)ui.open(d.page,{code:d.code,date:d.date,sample:quality,strategy:d.strategy||ui.strategy||'',factor:d.factor||ui.factor||'',ref:d.ref||''});};
    ro.querySelectorAll('[data-review-filter]').forEach(b=>b.onchange=()=>{if(b.dataset.reviewFilter==='quality'){quality=b.value;ui.setSample?.(quality);}else set=b.value;page=0;draw();});
    const actions={
      zip:async()=>{const {dailyExport}=await import('./journal.mjs');ui.download('V6-复盘-'+date+'.zip',dailyExport(s,date,{quality,set}),'application/zip');},
      note:()=>openAnnotation(ui,date,isMistakes,draw),mistake:()=>openAnnotation(ui,date,true,draw),checkin:()=>openCheckin(ui,date,draw),
      md:()=>ui.download('复盘-'+date+'.md',report.text,'text/markdown;charset=utf-8'),png:()=>reportPng(report),
      csv:()=>downloadCsv(ui,'复盘-'+date+'.csv',[['起始日期','截止日期','复盘栏目','内容'],...report.groups.flatMap(g=>g.lines.map(l=>[report.start,report.end,g.title,l]))])
    };
    for(const k of ['brief','deep'])actions[k]=async()=>{await ui.save('review:generate',{date,period,depth:k,quality,set});depth=k;draw();ui.toast('复盘已生成并归档');};
    ro.querySelectorAll('[data-review]').forEach(b=>{const fn=actions[b.dataset.review];if(fn)b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){ui.toast(e.message);}finally{b.disabled=false;}};});
  }
  draw();
}
