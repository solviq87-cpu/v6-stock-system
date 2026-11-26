'use strict';
// Product evidence review only. This is neither a market score nor an account
// permission provider. Definitions remain in the denominator when evidence is absent.
const crypto=require('node:crypto');
const DIMENSIONS=Object.freeze({intelligence:'智能度',authenticity:'真实性',precision:'精准度',safety:'安全性',usability:'易用性',stability:'稳定性',growth:'成长性'});
const define=(id,dimension,label,kind='rate',unit='ratio',statistic=null,critical=false)=>Object.freeze({id,dimension,label,kind,unit,statistic,critical});
const METRICS=Object.freeze([
 define('task-completion','intelligence','约定任务正确完成率'),
 define('constraint-consistency','intelligence','建议与已知约束一致率'),
 define('answer-coverage','intelligence','有效回答覆盖率'),
 define('source-time-lineage','authenticity','来源与原始时点可追溯率'),
 define('required-field-coverage','authenticity','必要字段有效覆盖率'),
 define('honest-unknown-conflicts','authenticity','缺失与冲突正确呈现率'),
 define('oos-net-return','precision','冻结样本成本后收益分布','samples','return-ratio','mean'),
 define('oos-drawdown','precision','同窗口最大回撤分布','samples','ratio','max'),
 define('alert-review-coverage','precision','约定事件范围复核覆盖率'),
 define('alert-false-positive','precision','已复核提醒误报比例'),
 define('alert-missed-event','precision','完整事件复核范围漏报比例'),
 define('probability-brier','precision','独立样本概率Brier损失','samples','ratio','mean'),
 define('permission-rejection','safety','越权请求拒绝率','rate','ratio',null,true),
 define('stale-quote-rejection','safety','不合格原时点报价拒绝率','rate','ratio',null,true),
 define('fill-idempotency','safety','重复成交幂等正确率','rate','ratio',null,true),
 define('ledger-reconciliation','safety','应完成对账的一致回执率','rate','ratio',null,true),
 define('point-in-time-isolation','safety','未来信息隔离正确率','rate','ratio',null,true),
 define('dual-device-completion','usability','双端关键任务完成率'),
 define('operation-duration','usability','关键任务实际耗时','samples','ms','p95'),
 define('misoperation-rate','usability','误操作率'),
 define('failure-recovery','usability','失败后任务恢复率'),
 define('scheduled-availability','stability','约定服务时段可用率'),
 define('valid-data-coverage','stability','约定对象有效数据覆盖率'),
 define('operation-failure','stability','应执行操作失败率'),
 define('pipeline-latency','stability','实际端到端延迟','samples','ms','p95'),
 define('recovery-duration','stability','故障恢复耗时','samples','ms','p95'),
 define('heldout-improvement','growth','固定基线独立样本净改善','samples','return-ratio','mean'),
 define('regression-preservation','growth','已约定原功能不退化率'),
 define('issue-recurrence','growth','已关闭问题复发率'),
 define('rollback-verification','growth','约定恢复演练通过率')
]);
// The metric definition, not a caller-selected comparator, establishes whether
// higher or lower values are desirable. Critical gates retain their exact threshold.
const LOWER_IS_BETTER=new Set(["oos-drawdown","alert-false-positive","alert-missed-event","probability-brier","operation-duration","misoperation-rate","operation-failure","pipeline-latency","recovery-duration","issue-recurrence"]);
const byId=new Map(METRICS.map(x=>[x.id,x])),plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const text=(x,max=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const time=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().replace('.000Z','Z')===x.replace('.000Z','Z');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scopeKinds=['isolated-test','historical-replay','real-market-paper'];
const percentile=(values,p)=>values[Math.max(0,Math.ceil(values.length*p)-1)];
function summarize(samples){
 const values=[...samples].sort((a,b)=>a-b);
 if(!values.length)return null;
 // Scaling and compensated summation avoid overflowing a finite mean when
 // individually finite samples are near Number.MAX_VALUE or have opposite signs.
 const scale=Math.max(Math.abs(values[0]),Math.abs(values.at(-1)));let sum=0,correction=0;
 if(scale)for(const value of values){const adjusted=value/scale-correction,next=sum+adjusted;correction=(next-sum)-adjusted;sum=next;}
 const direct=values.reduce((total,value)=>total+value,0);
 const mean=Number.isFinite(direct)?direct/values.length:scale?scale*Math.max(-1,Math.min(1,sum/values.length)):0;
 return {count:values.length,min:values[0],max:values.at(-1),mean,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99)};
}
function evaluateProductQuality({revision,asOf,window=null,scope,plan=null,observations=[]}={}){
 if(!/^[a-f0-9]{40}$/.test(revision||'')||!time(asOf)||!plain(scope)||!scopeKinds.includes(scope.kind)||!text(scope.population))throw Error('质量评价必须绑定精确版本、核查时间、环境与统计范围');
 if(window!==null&&(!plain(window)||!time(window.start)||!time(window.end)||Date.parse(window.end)<=Date.parse(window.start)))throw Error('评价窗口无效');
 if(!Array.isArray(observations)||observations.length>METRICS.length)throw Error('评价记录数量无效');
 if(plan!==null&&(!plain(plan)||!text(plan.version,80)||!time(plan.registeredAt)||!plain(plan.criteria)))throw Error('评价计划无效');
 const criteria=plan?.criteria||{},seen=new Set();
 for(const [id,c] of Object.entries(criteria)){
  const metric=byId.get(id);
  if(!metric||!plain(c))throw Error('未知评价定义');
  if(c.notApplicable!==undefined){
   if(metric.critical||!plain(c.notApplicable)||!text(c.notApplicable.reason)||!text(c.notApplicable.reviewedBy,80))throw Error('不适用必须预登记理由和复核人，关键安全项不可排除');
  }else if(c.operator!==(LOWER_IS_BETTER.has(id)?'lte':'gte')||!finite(c.threshold)||!count(c.minimumSamples)||c.minimumSamples<1||c.minimumSamples>10000000||metric.unit==='ratio'&&(c.threshold<0||c.threshold>1)||metric.unit==='ms'&&c.threshold<0||metric.critical&&(c.operator!=='gte'||c.threshold!==1))throw Error('评价方向或阈值无效，或试图放宽关键安全标准');
 }
 for(const o of observations){
  if(!plain(o)||!byId.has(o.metricId)||seen.has(o.metricId))throw Error('未知或重复评价记录');
  seen.add(o.metricId);
 }
 const registered=!!(window&&plan&&Date.parse(plan.registeredAt)<=Date.parse(window.start)&&Date.parse(plan.registeredAt)<=Date.parse(asOf));
 const closed=!!(window&&Date.parse(window.end)<=Date.parse(asOf));
 const observationMap=new Map(observations.map(o=>[o.metricId,o]));
 const rows=METRICS.map(metric=>{
  const c=criteria[metric.id],o=observationMap.get(metric.id);
  const row={...metric,status:'unknown',reason:null,value:null,numerator:null,denominator:null,sampleCount:null,missingCount:null,distribution:null,rateBounds:null,valueBasis:null,evidenceRefs:[],evidenceVerification:'not-independently-certified'};
  const unknown=reason=>({...row,reason});
  if(!window)return unknown('未登记评价窗口');
  if(Date.parse(asOf)<Date.parse(window.start))return unknown('观察窗口尚未开始，不能计入未来证据');
  if(!metric.critical){
   if(!c)return unknown('未预登记本项阈值或不适用条件');
   if(!registered)return unknown('计划未在观察窗口开始前登记');
   if(c.notApplicable)return {...row,status:'not-applicable',reason:c.notApplicable.reason,reviewedBy:c.notApplicable.reviewedBy};
  }
  if(!o)return unknown('没有该项证据；仍保留在评价分母');
  if(o.revision!==revision||!plain(o.window)||o.window.start!==window.start||o.window.end!==window.end||o.scopeKind!==scope.kind||o.population!==scope.population)return unknown('版本、窗口、环境或统计范围不一致，不能混算');
  if(o.unit!==metric.unit||!Array.isArray(o.evidenceRefs)||!o.evidenceRefs.length||o.evidenceRefs.length>20||o.evidenceRefs.some(r=>!plain(r)||!text(r.id,120)||!/^[a-f0-9]{64}$/.test(r.sha256||'')))return unknown('缺少同口径单位或有哈希的证据引用');
  const refs=new Map();
  for(const {id,sha256} of o.evidenceRefs){
   if(refs.has(id)&&refs.get(id)!==sha256)return unknown('同一证据标识对应不同哈希，不能判定');
   refs.set(id,sha256);
  }
  row.evidenceRefs=[...refs].map(([id,sha256])=>({id,sha256}));
  if(metric.kind==='rate'){
   if(!count(o.numerator)||!count(o.denominator)||!count(o.sampleCount)||o.numerator>o.sampleCount||o.sampleCount>o.denominator)return unknown('分子、全量分母或有效样本数量无效；未知不能填零');
   Object.assign(row,{numerator:o.numerator,denominator:o.denominator,sampleCount:o.sampleCount,missingCount:o.denominator-o.sampleCount});
   if(!o.denominator)return unknown('分母为零，未产生可评价样本');
   if(!o.sampleCount)return unknown('尚无有效样本；未知不填零');
   row.value=o.numerator/o.denominator;
   // Preserve the original full-denominator projection, but a partial failure
   // rate of zero is only a lower bound, not proof of zero actual failures.
   row.rateBounds={min:row.value,max:(o.numerator+(o.denominator-o.sampleCount))/o.denominator};
   row.valueBasis=row.missingCount?'observed-numerator-over-expected-denominator-lower-bound':'complete-rate';
  }else{
   if(!Array.isArray(o.samples)||o.samples.length>10000||Array.from(o.samples).some(x=>!finite(x)||metric.unit==='ms'&&x<0||metric.unit==='ratio'&&(x<0||x>1))||!count(o.expectedCount)||o.expectedCount<o.samples.length)return unknown('分布样本或应取得样本分母无效');
   Object.assign(row,{denominator:o.expectedCount,sampleCount:o.samples.length,missingCount:o.expectedCount-o.samples.length,distribution:summarize(o.samples)});
   row.value=row.distribution?.[metric.statistic]??null;
   if(row.value!==null)row.valueBasis=row.missingCount?'partial-sample-statistic':'complete-sample-statistic';
  }
  // A known safety failure already blocks review, even if more samples are
  // missing or the observation window has not yet ended.
  if(metric.critical&&row.numerator<row.sampleCount)return {...row,status:'fail',reason:'已有关键安全失败；缺样本或未结束窗口不能掩盖失败'};
  if(!c)return unknown('未预登记本项阈值或不适用条件');
  if(!registered)return unknown('计划未在观察窗口开始前登记');
  if(o.planVersion!==plan.version||o.planFingerprint!==sha(plan))return unknown('证据未绑定当前冻结计划指纹，不能复用旧阈值结果');
  if(row.value!==null&&!finite(row.value)||row.distribution&&Object.values(row.distribution).some(x=>!finite(x)))return unknown('派生统计不是有限值');
  if(!closed)return unknown('观察窗口尚未结束');
  if(row.missingCount>0)return unknown('存在应取得但缺失的样本；不能只对已有结果归一');
  if(row.sampleCount<c.minimumSamples||row.value===null)return unknown('有效样本未达到预登记门槛');
  if(['oos-net-return','oos-drawdown','heldout-improvement'].includes(metric.id)&&o.costBasis!=='net-after-fees-slippage')return unknown('没有同窗口费用、滑点及执行约束口径');
  if(['alert-missed-event','alert-false-positive'].includes(metric.id)&&o.completeReviewUniverse!==true)return unknown('事件复核范围不完整，不能声称无误报或零漏报');
  if(metric.id==='probability-brier'&&o.independentCalibrationSample!==true)return unknown('未证明使用独立校准评价样本');
  const pass=c.operator==='gte'?row.value>=c.threshold:row.value<=c.threshold;
  return {...row,status:pass?'pass':'fail',reason:pass?'达到预登记条件；证据真实性仍需独立复核':'未达到预登记条件',criterion:{operator:c.operator,threshold:c.threshold,minimumSamples:c.minimumSamples}};
 });
 const summarizeRows=rs=>({total:rs.length,evaluated:rs.filter(x=>['pass','fail'].includes(x.status)).length,passed:rs.filter(x=>x.status==='pass').length,failed:rs.filter(x=>x.status==='fail').length,unknown:rs.filter(x=>x.status==='unknown').length,notApplicable:rs.filter(x=>x.status==='not-applicable').length});
 const coverage=summarizeRows(rows);coverage.ratio=coverage.evaluated/coverage.total;
 const gates=rows.filter(x=>x.critical),failed=gates.filter(x=>x.status==='fail').map(x=>x.id),unverified=gates.filter(x=>x.status!=='pass'&&x.status!=='fail').map(x=>x.id);
 return {schemaVersion:1,mode:'product-quality-evidence-review',revision,asOf,window,scope:{kind:scope.kind,population:scope.population},planVersion:plan?.version??null,planFingerprint:plan?sha(plan):null,preregistrationVerification:'input-declared-not-independently-certified',coverage,dimensions:Object.entries(DIMENSIONS).map(([id,label])=>({id,label,coverage:summarizeRows(rows.filter(x=>x.dimension===id)),metrics:rows.filter(x=>x.dimension===id)})),criticalReview:{state:failed.length?'blocked':unverified.length?'unverified':'eligible-for-independent-review',failed,unverified},overallScore:null,probability:null,canTrade:false,canDeploy:false,authorizesExecution:false,continuousOperationCertified:false};
}
module.exports={DIMENSIONS,METRICS,evaluateProductQuality,summarize,fingerprintPlan:sha};
