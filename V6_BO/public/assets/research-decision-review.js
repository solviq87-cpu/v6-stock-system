(function () {
'use strict';
const arr=x=>Array.isArray(x)?x:[];
const val=x=>x===null||x===undefined||x===''?'未知':typeof x==='object'?JSON.stringify(x):String(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&Number.isFinite(new Date(x).getTime())?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
const names={pending:'等待目标日', 'awaiting-evidence':'已到复访时间，等待结果证据',evaluated:'已有首次评价',
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
  '未决事项：'+arr(r.action?.nextChecks).join('；'),
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
 for(const item of arr(r.action?.nextChecks).slice(0,8))action.append(node('p',item));
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
   for(const c of arr(row[key]))line(d,title,val(c.field)+' · '+(key==='missing'?val(c.reason):val(c.value)+' '+val(c.op)+' '+val(c.threshold))+' · 来源 '+val(c.source));
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
 for(const d of arr(r.diagnostics))line(diagnostics,d.stage,d.status);
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
