'use strict';
const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false};
const list=v=>Array.isArray(v)?v:[];
const day=v=>new Date(v+28800000).toISOString().slice(0,10);
const time=(v,cut)=>Number.isSafeInteger(v)&&v>0&&v<=cut;
function nextEvidence(rows,origin){
 const later=rows.filter(x=>x.code===origin.code&&x.rule===origin.rule&&x.day>origin.day&&x.planId!==origin.planId).sort((a,b)=>a.day.localeCompare(b.day));
 if(!later.length)return {status:'unknown',reason:'尚无下一次同标的同纪律的封存回执'};
 const x=later[0];
 return {status:x.status==='符合'?'observed-followed':x.status==='触发'?'observed-deviation':'unknown',day:x.day,planId:x.planId,reportHash:x.reportHash,statusLabel:x.status,refs:x.refs,reason:'后续原日报的独立计划核对；不推断未记录的交易'};
}
function manualFacts(plans){
 return list(plans).flatMap(p=>{
  const rows=list(p.fills),buy=rows.filter(x=>x.side==='buy'),over=buy.filter(x=>x.priceUnits>p.limitPriceUnits);
  let cumulative=0;const extra=[];for(const f of rows){cumulative+=f.side==='buy'?f.quantity:-f.quantity;if(f.side==='buy'&&cumulative>p.shares)extra.push(f);}
  const fact=(rule,status,evidence,refs=[])=>({rule,status,evidence,refs});
  const facts=[fact('追高',over.length?'触发':buy.length?'符合':'资料不足',over.length?'手工成交买价高于原冻结上限':'按原人工冻结上限核对',over.length?over.map(f=>f.id):buy.map(f=>f.id)),
   fact('重复/超量交易',extra.length?'触发':'资料不足',extra.length?'实际记录累计持仓超过冻结数量；不将正常分批成交认作重复违规':'没有明确重复违规依据，分笔成交本身不是违规',extra.map(f=>f.id)),
   fact('提前退出','资料不足','原人工计划未封存最早离场时刻及风险豁免，不能推断提前退出'),
   fact('未执行原因',p.notExecuted?'已记录（未验证）':'资料不足',p.notExecuted?.reason||'未提供原未执行理由'),
   fact('策略失误','资料不足','成交或盈亏不能单独证明策略失误；需要策略组独立结果')];
  return [{planId:p.id,symbol:p.symbol,frozenAt:p.frozenAt,reviewId:p.review?.id||null,reconciliationId:p.reconciliation?.matched?p.reconciliation.id:null,source:'原人工执行日志（非券商验证）',facts,...flags}];
 });
}
async function review(p,q){
 const store=require('./paper-execution-report-store').createPaperExecutionReportStore({root:p.reportRoot});
 const dates=store.days().filter(d=>d<=day(q.asOf)).slice(-40),date=q.date||dates.at(-1)||day(q.asOf);
 const {projectDiscipline}=await import('../../public/nova/research-review.mjs');
 const all=[],missing=[];
 for(const d of [...new Set([...dates,date])]){
  try{const report=store.read({day:d,asOf:q.asOf});if(report.status==='observed')all.push(...projectDiscipline(report).rows.map(x=>({...x,day:d})));}catch{missing.push(d+' 执行日报无法核验');}
 }
 const paper=all.filter(x=>x.day===date).map(x=>({...x,followupEvidence:x.nextCheck?nextEvidence(all,x):null}));
 let manual=[],settlements=[];
 if(!q.historical){
  try{const v=require('./manual-decision-loop').view(p.manualRoot,{workspaceRoot:p.root});manual=manualFacts(v.plans).filter(x=>time(x.frozenAt,q.asOf)&&day(x.frozenAt)<=date).slice(0,40);}catch{missing.push('人工执行记录未就绪');}
  try{const r=await (await import('../research/shortline/store.mjs')).shortlineJob({root:p.shortlineRoot,book:'main',replica:p.replica});if(r.ok)
   settlements=list(r.state?.trades).filter(t=>t.source==='V6 模拟成交'&&t.paperSettlement?.accountId==='pool'&&t.exitDate===date&&time(t.paperSettlement.exitTimestamp,q.asOf)&&t.planVerified===true&&t.decisionLink?.planId===t.planId&&time(t.decisionLink.knownAt,q.asOf)).slice(0,100).map(t=>({symbol:t.code,planId:t.planId,sourceFingerprint:t.sourceFingerprint,entryEventIds:t.decisionLink.entryEventIds,exitEventId:t.paperSettlement.exitEventId,facts:list(t.disciplineFacts)}));
  }catch{missing.push('原已对账模拟结算记录未就绪');}
 }else missing.push('历史模式仅展示已封存的原日报，不借用当前可变人工日志或结算投影');
 return {status:paper.length||manual.length||settlements.length?'observed':'unknown',day:date,asOf:q.asOf,paper,manual,settlements,missing,reason:'按原计划、原成交流水、原人工记录核对；不适用和资料不足不归责。后续落实仅引用下一份独立同类原日报，范围最近40个日报日。',...flags};
}
module.exports={review,nextEvidence,manualFacts};
