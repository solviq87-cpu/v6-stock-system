// Pure presentation projections. All classifications come from existing sealed
// server facts, never from price reconstruction, headlines or language models.
const array=v=>Array.isArray(v)?v:[];
const time=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;
const text=v=>typeof v==='string'&&v.trim()?v:null;
const code=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const questions=Object.freeze([
 ['support','为什么入选？'],['opposition','最强的反对理由是什么？'],['missing','缺哪些证据？'],
 ['invalidation','哪些变化会使判断失效？'],['history','同类历史样本后来怎样？']
]);
export function sealedResearchConditions(r){
 if(!code(r?.symbol)||!time(r.asOf,Date.now())||!Array.isArray(r.conditions)||!Array.isArray(r.evidence))return [];
 const evidence=new Map(),duplicate=new Set();
 for(const e of r.evidence){
   if(!text(e?.id))continue;
   if(evidence.has(e.id))duplicate.add(e.id);
   evidence.set(e.id,e);
 }
 const counts=new Map();for(const c of r.conditions)if(text(c?.id))counts.set(c.id,(counts.get(c.id)||0)+1);
 return r.conditions.filter(c=>c&&text(c.id)).map(c=>{
   const ids=array(c.evidenceIds),refs=[...new Set(ids)].flatMap(id=>{
     const e=evidence.get(id);
     // A reference lacking either availability or receipt cannot prove a
     // point-in-time observation. Do not borrow a timestamp from the run.
     return e&&!duplicate.has(id)&&e.symbol===r.symbol&&text(e.source)&&
       time(e.availableAt,r.asOf)&&time(e.receivedAt,r.asOf)&&
       [e.sourceTimestamp,e.periodEnd].every(v=>v==null||time(v,r.asOf))&&
       e.status!=='unknown'&&!e.missingReason&&text(e.evidenceRef)?
       [{id,source:e.source,field:e.field??null,value:e.value??null,sourceTimestamp:e.sourceTimestamp??null,periodEnd:e.periodEnd??null,availableAt:e.availableAt,receivedAt:e.receivedAt,evidenceRef:e.evidenceRef}]:[];
   });
   const backed=ids.length>0&&refs.length===ids.length&&counts.get(c.id)===1&&text(c.version)&&c.coverageOnly!==true;
   return {id:c.id,name:c.name||c.field||c.id,system:c.system,version:c.version??null,
     status:backed&&['pass','fail'].includes(c.status)?c.status:'unknown',archivedStatus:c.status,
     field:c.field??null,op:c.op??null,threshold:c.threshold??null,value:c.value??null,coverageOnly:c.coverageOnly===true,
     reason:c.reason??null,invalidation:c.invalidation??null,evidence:refs,
     currentValidity:'unknown',refs:[...(text(r.id)?['research:'+r.id]:[]),'condition:'+c.id,...refs.map(e=>e.evidenceRef)],
     missing:backed&&['pass','fail'].includes(c.status)?null:'原规则版本、有效证据引用、时点或独立判定不完整'};
 });
}
export function explainSealedResearch(view,question){
 const r=view?.selectedRun,cut=view?.asOf;
 const unavailable=reason=>({status:'unknown',kind:'规则解释',modelCalled:false,canTrade:false,reason,rows:[]});
 if(!questions.some(([key])=>key===question)||!code(r?.symbol)||!text(r?.id)||!time(cut,Date.now())||
   !time(r.recordedAt,cut)||!time(r.asOf,r.recordedAt)||!Array.isArray(r.conditions)||!Array.isArray(r.evidence))
   return unavailable('未取得匹配研究版本或有效历史截点');
 const scope={symbol:r.symbol,tradeDate:r.tradeDate,runId:r.id,asOf:cut,recordedAt:r.recordedAt,decisionAt:r.asOf};
 const rules=sealedResearchConditions(r);
 let rows=[],reason='';
 if(question==='support'){
   rows=rules.filter(c=>c.status==='pass');
   reason='以下仅为该封存版本有证据支持的已通过条件。不能由此认定原后台实际入选；原筛选批次与执行资格另行核对。';
 }else if(question==='opposition'){
   rows=rules.filter(c=>c.status==='fail');
   reason='列出有依据的反对条件。原档案未提供可比重要性排名，不能虚构最强一项。';
 }else if(question==='missing'){
   rows=rules.filter(c=>c.status==='unknown');
   reason='原条件为未知、仅覆盖评分或缺少可核对引用的项目；未知不视作不通过或通过。';
 }else if(question==='invalidation'){
   rows=rules.filter(c=>text(c.invalidation));
   reason='仅转述原封存条件的失效描述。当前是否已失效需由原后台重新核验。';
 }else{
   // The original scorecard is aggregate by system/version/regime, not
   // proof of a matched historical cohort for this security.
   return {...unavailable('正在核对原前向评测的同版本、同条件历史分组；它不等于五维相似样本或个股预测。'),...scope};
 }
 return {status:rows.length?'observed':'unknown',kind:'规则解释',modelCalled:false,canTrade:false,...scope,reason,rows};
}
export function projectDiscipline(saved){
 const none=reason=>({status:'unknown',rows:[],reason,canTrade:false});
 const report=saved?.report;
 if(saved?.status!=='observed'||report?.protocol!=='paper-execution-daily-report-v1'||
   !hash(saved.reportHash)||!Number.isSafeInteger(saved.reportVersion)||saved.reportVersion<1||
   !time(saved.recordedAt,Date.now())||report.day!==saved.day||report.score?.closed!==true||
   report.score.day!==report.day||report.checklist?.day!==report.day||
   !Array.isArray(report.checklist.items)||!Array.isArray(report.score.rows))
   return none('缺少通过原展示核验的持久日报及计划清单');
 const rows=[],index=new Map(),dup=new Set();
 for(const item of report.checklist.items){if(!text(item?.planId))continue;if(index.has(item.planId))dup.add(item.planId);index.set(item.planId,item);}
 const rules={'按计划买入':'下次按原冻结区间与可用买入窗口核对，并确认关联成交或原门禁原因',
              '按计划止损':'下次按冻结止损、可用卖出窗口及关联批次离场回执核对'};
 const seen=new Set();
 for(const row of report.score.rows){
   const plan=index.get(row?.planId);
   if(!plan||dup.has(row.planId)||seen.has(row.planId)||!code(row.code)||row.code!==plan.code||
     row.day!==report.day||plan.day!==report.day||!text(row.planVersion)||row.planVersion!==plan.planVersion)continue;
   seen.add(row.planId);
   for(const fact of array(row.facts)){
     if(!Object.hasOwn(rules,fact?.rule)||!['符合','触发','不适用','资料不足'].includes(fact.status)||!text(fact.evidence))continue;
     const refs=[...array(fact.eventIds),fact.eventId,...array(fact.observations).map(o=>o?.id)].filter(v=>text(v));
     rows.push({code:row.code,name:row.name,planId:row.planId,planVersion:row.planVersion,
       reportVersion:saved.reportVersion,reportHash:saved.reportHash,rule:fact.rule,
       status:fact.status,classification:fact.status==='触发'?'原执行纪律核验触发':fact.status==='符合'?'原纪律核验符合':
         fact.status==='不适用'?'原规则不适用（原因见原事实）':'未知',
       evidence:fact.evidence,refs:[...new Set(refs)],nextCheck:fact.status==='符合'?null:rules[fact.rule],
       followup:'未核验；尚未接入跨日报改进事项追踪'});
   }
 }
 return {status:rows.length?'observed':'unknown',rows,canTrade:false,
   reason:'只转述原持久日报的纪律事实；未归因策略成败，追高、重复交易、提前退出及后续落实缺独立对应证据，保持未知。'};
}
