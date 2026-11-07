'use strict';
/** Import independently executed Python three-round results; never execute arbitrary code. */
const crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function evaluatePythonEvidence(entry,{symbol,date}){
 if(entry===undefined)return {verdict:'unknown',reason:'缺少原生Python三轮执行证据'};
 if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('Python证据结构无效');
 if(entry.symbol!==symbol||entry.date!==date||entry.observedThrough!==date)throw Error('Python证据股票或观察日期不一致');
 if(typeof entry.evaluatorVersion!=='string'||!/^python-native\/[\w.-]{1,64}$/.test(entry.evaluatorVersion))throw Error('Python评估器版本无效');
 if(typeof entry.provenance!=='string'||!/^python-runtime:[\w./:-]{8,160}$/.test(entry.provenance))throw Error('Python运行来源无效');
 if(!Array.isArray(entry.rounds)||entry.rounds.length!==3)throw Error('Python必须提供三轮独立结果');
 const rounds=entry.rounds.map((r,i)=>{
  if(!r||r.round!==i+1||!['pass','fail','unknown'].includes(r.verdict)||r.observedThrough!==date)throw Error('Python三轮结果或观察日期无效');
  if(typeof r.reason!=='string'||!r.reason.trim())throw Error('Python每轮必须提供判断依据');
  return {round:r.round,verdict:r.verdict,reason:r.reason};
 });
 const verdict=rounds.some(r=>r.verdict==='unknown')?'unknown':rounds.every(r=>r.verdict==='pass')?'pass':'fail';
 return {verdict,rounds,provenance:entry.provenance,evaluatorVersion:entry.evaluatorVersion,evidenceFingerprint:digest(entry)};
}
module.exports={evaluatePythonEvidence};
