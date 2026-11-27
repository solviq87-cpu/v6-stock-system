// Projection shared by desktop and mobile research workbenches.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const count=value=>Number.isSafeInteger(value)&&value>=0?String(value):'未知';
const number=value=>finite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:3}):'未知';
const time=value=>finite(value)&&value>0&&Number.isFinite(new Date(value).getTime())
 ?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
const reasons={
 'baseline-required':'等待第二次合格采样','baseline-reset':'市场日期、来源、时段、覆盖口径或间隔变化，重新积累基线',
 'sample-changed':'证券样本发生变化，不能直接比较','interval-too-short':'采样间隔不足30秒',
 'overlapping-capture':'两次采样区间重叠','quotes-not-advanced':'原始报价时间未全部推进',
 'out-of-order':'晚到或倒序采样','repeated-completion':'重复采样时点','disputed-quote':'原始报价时点或数值冲突',
 'invalid-snapshot':'采样时间、原始报价或样本覆盖不足','invalid-coverage-policy':'覆盖阈值无效'
};
export function marketExpansionView(value){
 if(!value||value.mode!=='adjacent-same-sample-expansion-v1')return null;
 const warning='同源样本研究，非交易所认证全市场指标，不生成交易指令。';
 const valid=value.status==='observed-unverified'&&[value.upShareDeltaPctPoints,value.upShareDeltaPctPointsPerMinute,
  value.previousUpShare,value.currentUpShare,value.sampleElapsedMs].every(finite)&&value.sampleElapsedMs>=30000&&value.sampleElapsedMs<=300000&&
  value.previousUpShare>=0&&value.previousUpShare<=1&&value.currentUpShare>=0&&value.currentUpShare<=1;
 if(!valid)return {title:'市场扩散速度待证据',description:(reasons[value.status]||'缺少合格对照')+'。'+warning,metrics:[]};
 const sign=value.upShareDeltaPctPoints>0?'上涨范围扩大':value.upShareDeltaPctPoints<0?'上涨范围收缩':'上涨占比持平';
 return {title:'同样本市场扩散速度',description:sign+' · '+count(value.observed)+' / '+count(value.universeSize)+' 只 · '+
  (typeof value.source==='string'?value.source:'来源未知')+' · '+time(value.baselineAt)+' 至 '+time(value.asOf)+'。'+warning,
  metrics:[['上涨占比（前 / 后）',number(value.previousUpShare*100)+'% / '+number(value.currentUpShare*100)+'%'],
   ['上涨占比变化',number(value.upShareDeltaPctPoints)+' 个百分点'],
   ['每分钟变化（按采样完成时间）',number(value.upShareDeltaPctPointsPerMinute)+' 个百分点/分钟'],
   ['转为上涨 / 退出上涨',count(value.enteredUp)+' / '+count(value.leftUp)],['采样间隔',number(value.sampleElapsedMs/1000)+' 秒']]};
}
