'use strict';
const {createAdaptiveMonitor}=require('../core/adaptive-research-monitor');
// A configured provider name is an operator preference, not a supplier signature.
function readLatestAdaptiveReport({outputRoot,providers=[],maxAgeDays=7,now=Date.now()}={}){
 const base={canTrade:false,verifiedLive:false,brokerConnected:false};
 if(!outputRoot)return {ok:true,status:'unconfigured',...base};
 if(!Number.isInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>365||!Array.isArray(providers)||!Number.isFinite(now))return {ok:false,status:'invalid',error:'研究查看配置无效',...base};
 try{
  const snapshot=createAdaptiveMonitor({outputRoot,readOnly:true}).latest(),r=snapshot.result;
  const day=new Date(now+8*3600000).toISOString().slice(0,10);
  const timestamp=Date.parse(r.asOf+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==r.asOf||r.asOf>day||typeof r.provider!=='string'||!r.provider.trim())throw Error('invalid metadata');
  const ageDays=Math.round((Date.parse(day)-timestamp)/86400000);
  const sourceStatus=r.source==='simulated'?'simulated':r.source==='imported'&&providers.includes(r.provider)?'configured':'unknown';
  return {ok:true,status:'verified',...base,revision:snapshot.revision,reportFingerprint:snapshot.reportFingerprint,asOf:r.asOf,ageDays,maxAgeDays,stale:ageDays>maxAgeDays,sourceStatus,result:r};
 }catch{return {ok:false,status:'invalid',error:'研究报告不可用：索引、历史或报告校验失败，请离线核验',...base};}
}
module.exports={readLatestAdaptiveReport};
