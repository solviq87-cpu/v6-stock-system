(function () {
'use strict';
const arr=x=>Array.isArray(x)?x:[];
const val=x=>x===null||x===undefined||x===''?'未知':typeof x==='object'?JSON.stringify(x):String(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&Number.isFinite(new Date(x).getTime())?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
const fieldNames={"cashflow":"现金流","announcementVerified":"公告原文核验","auctionFinal":"竞价最终快照","auctionReturnPct":"竞价涨跌幅","auctionTurnoverRatio":"竞价成交额比例","bandWidthRatio":"波动带宽比例","chipResistanceBroken":"筹码压力突破","closeLocation":"收盘位置","closeOver10":"收盘价/10日均线","closeOver20":"收盘价/20日均线","closeOverPrior20High":"收盘价/前20日高点","closeOverPrior5High":"收盘价/前5日高点","closeOverPrior60High":"收盘价/前60日高点","closeOverPriorHigh":"收盘价/前日高点","closeOverUpperBand":"收盘价/波动上轨","dailyReturnPct":"当日涨跌幅","daysSinceFirstBoard":"距首板交易日","debtAssetsPct":"资产负债率","divergenceSupportHeld":"背离支撑保持","dividendYieldPct":"股息率","drawdown20Pct":"20日回撤","earningsGrowthAccelerationPct":"利润增长加速度","earningsGrowthPct":"利润增长率","earningsSurprisePct":"业绩预期差","ensembleScore":"研究组合评分","etfFlow5":"ETF五日资金流","etfRelativeReturn20Pct":"ETF二十日相对收益","firstBoardLowHeld":"首板低点保持","flowCoverageDays":"资金覆盖交易日","freeCashflow":"自由现金流","industryGrowthPct":"行业增长率","industryRevenueRank":"行业营收排名","leaderRank":"板块地位排名","lhbInstitutionNetBuy":"龙虎榜机构净买入","lhbNetBuy":"龙虎榜净买入","limitStreak":"连续涨停数","ma10Over20":"10日/20日均线","ma5Over10":"5日/10日均线","macdHist":"MACD柱值","membershipVerified":"板块成员核验","minutesToClose":"距收盘分钟数","momentumPercentile":"动量分位","netFlow5":"五日净流入","newsOriginalVerified":"新闻原文核验","newsPolarity":"新闻方向","newsRetracted":"新闻是否撤回","openSupportConfirmed":"开盘支撑确认","operatingCashToProfit":"经营现金流/利润","payoutPct":"分红比例","pe":"市盈率","peg":"市盈率相对增长率","positiveFlowDays":"资金连续流入日数","priorBreakoutRetestHeld":"前次突破回踩保持","priorDailyReturnPct":"前日涨跌幅","priorLimitStreak":"此前连板数","priorMacdHist":"前日MACD柱值","priorWeakClose":"前日收盘偏弱","qualityPercentile":"质量分位","regimeAgreement":"市场状态一致性","regimeEvidenceComplete":"市场状态证据完整性","relativeReturn20Pct":"20日相对收益","relativeReturn60Pct":"60日相对收益","repurchaseExecutedPct":"回购执行比例","repurchasePlanActive":"回购计划有效","revenueGrowthPct":"营收增长率","roePct":"净资产收益率","roePriorYearPct":"上年净资产收益率","rsi14":"14日RSI","sealTurnoverRatio":"封单/成交额","sealedAtClose":"收盘封板","sectorBreadthPct":"板块上涨覆盖率","sectorRelativeReturn20Pct":"板块20日相对收益","sectorStrengthChange":"板块强度变化","turnoverPct":"换手率","valuationPercentile":"估值分位","volatilityPercentile":"波动分位","volumeRatio":"量比"};
const pretty=x=>String(x).replace(/\b[A-Za-z][A-Za-z0-9]+\b/g,k=>fieldNames[k]||k);
const names={linked:'引用已匹配',saved:'已封存',failed:'未完成',scheduled:'已安排',blocked:'安排受阻',unavailable:'不可用',empty:'暂无档案','not-requested':'本轮未请求','stored-observation':'已存观察','stored-research':'已存研究','research-observation-recorded':'已记录研究',unchanged:'档案未变化','no-eligible-prospective-hypothesis':'尚无可冻结的前瞻假设',pending:'等待目标日', 'awaiting-evidence':'已到复访时间，等待结果证据',evaluated:'已有首次评价',
  'observed-unverified':'已观察，未外部认证',unknown:'未知',research_candidate:'满足研究条件',not_matched:'条件未满足',insufficient_data:'证据不足',disabled:'未启用',
  up:'收盘高于开盘',down:'收盘低于开盘',flat:'收盘等于开盘',bullish:'正向形态较多',bearish:'风险形态较多',balanced:'形态均衡'};
const label=x=>names[x]||val(x);
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function line(p,k,v){p.append(node('p',k+'：'+val(v)));}
function section(host,title,kind){const n=node('section');n.className='review-card '+(kind||'');n.append(node('h4',title));host.append(n);return n;}
function disclosure(host,title){const d=node('details');d.append(node('summary',title));host.append(d);return d;}
function summaryText(r){
 const c=r.conditions||{},counts=c.counts||{},current=r.current||{};
 return ['股票：'+val(r.symbol)+' / '+val(r.provider),'数据日期：'+val(r.tradeDate),'研究时点：'+time(r.asOf),
  '观察版本：'+val(r.observationRevision)+'；证据引用：'+val(r.evidenceBundleHash),
  '限制：仅研究观察，不下单、不通知；历史频率不代表收益或涨停概率。',
  '研究条件：满足 '+val(counts.research_candidate)+'；未满足 '+val(counts.not_matched)+'；缺证据 '+val(counts.insufficient_data),
  '冻结判断：'+label(current.prediction)+'；目标日 '+val(current.targetDate)+'；状态 '+label(current.status),
  '下次检查：'+time(r.action?.nextCheckAt),
  '未决事项：'+arr(r.action?.nextChecks).map(pretty).join('；'),
  '原始历史保留在服务端，摘要不补充新行情或推断交易许可。'].join('\n').slice(0,4000);
}
function render(host,r){
 host.replaceChildren();if(!r){host.append(node('p','研究详情尚未生成；继续保留原始证据展示。'));return;}
 host.className='research-review';host.append(node('h3','个股判断与证据'));
 line(host,'股票 / 截止日',val(r.symbol)+' / '+val(r.tradeDate));
 const grid=node('div');grid.className='review-grid';host.append(grid);
 const action=section(grid,'观察与复访','review-action');
 line(action,'当前状态',label(r.current?.status));line(action,'研究判断',label(r.current?.prediction));
 line(action,'目标日',r.current?.targetDate);line(action,'下一次检查（北京时间）',time(r.action?.nextCheckAt));
 if(r.current?.status==='awaiting-evidence')line(action,'已到期时间',time(r.action?.dueAt));
 for(const item of arr(r.action?.nextChecks).slice(0,8))action.append(node('p',pretty(item)));
 for(const item of arr(r.action?.prohibited))action.append(node('p',item));
 const evidence=section(grid,'证据来源与缺口','review-evidence');
 for(const e of arr(r.evidence)){
  const d=disclosure(evidence,e.label+' · '+label(e.status));
  line(d,'来源',e.source);line(d,'来源原始时间',time(e.sourceTimestamp));line(d,'接收 / 已知时间',time(e.receivedAt));line(d,'说明',e.reason);
 }
 const sources=disclosure(evidence,'封存引用 · '+arr(r.sourceRefs).length+' 条');
 for(const e of arr(r.sourceRefs)){line(sources,'来源',e.source);line(sources,'接收时间',time(e.receivedAt));line(sources,'内容哈希',e.sha256);}
 const conditions=r.conditions||{},counts=conditions.counts||{};
 const rules=section(grid,'条件分歧与未入选原因','review-conditions');
 line(rules,'满足 / 未满足 / 缺证据 / 未启用',[counts.research_candidate,counts.not_matched,counts.insufficient_data,counts.disabled].map(val).join(' / '));
 rules.append(node('p',conditions.mixedConditions?'存在条件分歧；不同策略分别查看，不合成买卖票数。':'暂无已知条件分歧；缺数据不表示一致认可。'));
 rules.append(node('p',conditions.meaning||'等待规则条件'));
 for(const row of arr(conditions.rows)){
  const d=disclosure(rules,row.name+' · '+label(row.status));
  for(const [key,title]of [['support','已满足'],['opposition','未满足'],['missing','待补证据']]){
   for(const c of arr(row[key]))line(d,title,val(fieldNames[c.field]||c.field)+' · '+(key==='missing'?val(c.reason):val(c.value)+' '+val(c.op)+' '+val(c.threshold))+' · 来源 '+val(c.source));
  }
  line(d,'失效 / 复查条件',row.invalidation);
 }
 const market=section(grid,'板块位置','review-market');
 for(const b of arr(r.marketPosition?.boards)){
  line(market,b.name||b.code,'日期 '+val(b.quoteDate)+' · 涨跌幅 '+val(b.changePct)+'% · 主力净流入 '+val(b.mainNetInflow)+' 元');
 }
 if(!arr(r.marketPosition?.boards).length)line(market,'所属板块','证据不足');
 line(market,'个股角色 / 题材阶段',label(r.marketPosition?.role)+' / '+label(r.marketPosition?.phase));
 market.append(node('p',r.marketPosition?.reason||'等待证据'));
 const card=r.scorecard||{},score=section(grid,'冻结研究成绩单','review-score');
 line(score,'已评价 / 独立目标日',val(card.evaluated)+' / '+val(card.independentTargetDays));
 line(score,'最少独立目标日',card.minIndependentDays);
 line(score,'方向匹配频率',typeof card.matchFrequency==='number'?(card.matchFrequency*100).toFixed(1)+'%':'样本不足或未知');
 line(score,'Brier',card.brier);score.append(node('p',card.meaning||'等待冻结结果'));
 const diagnostics=section(grid,'本次分析状态','review-diagnostics');
 for(const d of arr(r.diagnostics))line(diagnostics,d.stage,label(d.status));
 const history=disclosure(host,'判断变化时间线 · '+val(r.timeline?.total)+' 条');
 if(r.timeline?.truncated)history.append(node('p','仅展示最近50条；完整档案未删除。'));
 history.append(node('p',r.timeline?.meaning||'暂无冻结判断；不生成示例历史。'));
 for(const row of arr(r.timeline?.rows).slice().reverse()){
  const d=disclosure(history,val(row.targetDate)+' · '+label(row.prediction)+' · '+label(row.status));
  line(d,'判断 / 封存时间',time(row.decisionAt)+' / '+time(row.recordedAt));line(d,'判断引用',row.id);line(d,'证据引用',row.evidenceBundleHash);
  line(d,'规则版本',row.ruleVersion);
  for(const c of arr(row.changes))line(d,c.field==='prediction'?'判断变化':'形态变化',label(c.before)+' → '+label(c.after));
  line(d,'新增形态',arr(row.addedPatterns).join('、')||'无');line(d,'不再命中',arr(row.removedPatterns).join('、')||'无');
  if(row.outcome){line(d,'首次结果',label(row.outcome.direction));line(d,'是否匹配',row.outcome.matched===true?'是':row.outcome.matched===false?'否':'未知');line(d,'结果已知时间',time(row.outcome.knownAt));}
  line(d,'后续数据修订次数',row.corrections);if(row.corrections)d.append(node('p','保留首次评价，后续修订不改写旧判断。'));
 }
 const memory=disclosure(host,'研究续接摘要');
 const button=node('button','生成本次摘要');button.type='button';const output=node('textarea');output.readOnly=true;output.setAttribute('aria-label','研究续接摘要');
 button.addEventListener('click',()=>{output.value=summaryText(r);});memory.append(button,output);
}
function renderDisagreement(host,data){
 if(!data)return;
 const box=node('section');box.className='review-card review-conditions';box.append(node('h4','四体系条件分歧'));box.append(node('p',data.note));
 for(const r of arr(data.rows)){
  const d=disclosure(box,r.label+' · '+(r.available?'已有条件':'证据不足'));
  line(d,'说明',r.reason);line(d,'已满足',arr(r.support).join('、')||'暂无');line(d,'未满足',arr(r.opposition).join('、')||'暂无');line(d,'未知条件',arr(r.missing).join('、')||'暂无');
 }
 host.append(box);
}
function renderFunnel(host,data){
 if(!data)return;
 const box=node('section');box.className='review-card';box.append(node('h4','筛选过程与淘汰原因'));box.append(node('p',data.meaning));
 for(const s of arr(data.steps)){
  const d=disclosure(box,s.label+'：'+s.before+' → '+s.after+' · 本步移出 '+s.removed+' · 判定未知 '+s.unknown);
  for(const row of arr(s.samples))line(d,val(row.name)+' '+val(row.symbol),row.reason);
 }
 host.append(box);
}
globalThis.V6DecisionReview={render,renderDisagreement,renderFunnel,summaryText};
})();
