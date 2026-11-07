'use strict';
/** Read-only evidence gate. No orders, no rewriting legacy scores. */
const codeOf=x=>String(x?.code??x?.symbol??'');
function assessCandidateEvidence(snapshot, breadth, regime, candidates=[], intersection={}) {
 const matched=new Set((Array.isArray(intersection?.items)?intersection.items:[]).filter(x=>x&&/^\d{6}$/.test(String(x.code||''))).map(x=>String(x.code)));
 const seen=new Set(),items=[];
 for(const c of (Array.isArray(candidates)?candidates:[])) {
  if(items.length>=50)break;
  if(!c||typeof c!=='object')continue;
  const code=codeOf(c);if(!/^\d{6}$/.test(code)||seen.has(code))continue;seen.add(code);
  const reasons=[];
  const knownRisk=c.isST===true||c.suspended===true||c.tradable===false||
   (typeof c.riskScore==='number'&&Number.isFinite(c.riskScore)&&c.riskScore>=85);
  if(knownRisk)reasons.push('已有候选标记为高风险或不可交易');
  if(!breadth?.usable)reasons.push('市场宽度覆盖不足');
  if(!matched.has(code))reasons.push('未匹配到公开行情');
  if(!regime?.usable)reasons.push('缺少独立且同日期的市场环境评分');
  if(!Number.isFinite(c.finalScore))reasons.push('原候选评分未知');
  if(knownRisk)reasons.push('风险拦截优先于研究证据完整性');
  const evidenceReady=Boolean(!knownRisk&&breadth?.usable&&matched.has(code)&&regime?.usable&&Number.isFinite(c.finalScore));
  items.push({code,name:String(c.name||code).slice(0,64),originalScore:Number.isFinite(c.finalScore)?c.finalScore:null,
   riskStatus:knownRisk?'blocked':evidenceReady?'research-only':'unknown',
   evidenceReady,canTrade:false,reason:reasons.length?reasons.join('；'):'仅研究候选；尚未验证可交易性、K线与实时性'});
 }
 return {mode:'read-only',rankingModified:false,canTrade:false,items,
  counts:{total:items.length,blocked:items.filter(x=>x.riskStatus==='blocked').length,
   unknown:items.filter(x=>x.riskStatus==='unknown').length,evidenceReady:items.filter(x=>x.evidenceReady).length},
  warning:'研究门禁仅根据明确字段判定；未知不等于通过；未执行交易前完整风控或回测，不生成买入指令'};
}
module.exports={assessCandidateEvidence};
