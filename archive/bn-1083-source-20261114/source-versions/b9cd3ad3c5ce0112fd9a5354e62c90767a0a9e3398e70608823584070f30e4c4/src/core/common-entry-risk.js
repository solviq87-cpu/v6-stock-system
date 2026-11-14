'use strict';
const {evaluatePreviousCloseRisk}=require('./portfolio-risk-gate');
function validateEntryPolicy(p){if(p==null)return;if(typeof p.version!=='string'||!p.version)throw Error('风控版本无效');for(const k of ['maxPositionPct','maxGrossExposurePct','maxDrawdownPausePct','maxDailyLossPausePct'])if(p[k]!=null&&(!Number.isFinite(p[k])||p[k]<=0||p[k]>100))throw Error('风控参数无效');}
function evaluateEntryRisk({policy=null,side='buy',symbol,quantity,price,cash,positions=[],pending=[],marks={},previousClose=null}={}){
 validateEntryPolicy(policy);if(!policy||side==='sell')return {allowed:true,reasonCodes:[],policyVersion:policy?.version||null};const reasons=[];
 const fail=code=>reasons.push(code);
 if(!Number.isFinite(cash)||cash<0||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<=0)fail('INVALID_ACCOUNT_INPUT');
 if(policy.maxPositionPct!=null||policy.maxGrossExposurePct!=null){let gross=0,single=0,unknown=false;
  for(const p of positions){const mark=marks[p.symbol];if(!Number.isFinite(mark)||mark<=0){unknown=true;continue;}const v=p.quantity*mark;gross+=v;if(p.symbol===symbol)single+=v;}
  let reserved=0,singleReserved=0;for(const p of pending){const value=p.quantity*p.price;if(!Number.isFinite(value)||value<0){unknown=true;continue;}reserved+=value;if(p.symbol===symbol)singleReserved+=value;}
  const equity=cash+gross,addition=quantity*price;if(unknown||!Number.isFinite(equity)||equity<=0)fail('MISSING_POSITION_MARKS');else{
   if(policy.maxPositionPct!=null&&(single+singleReserved+addition)/equity*100>policy.maxPositionPct+1e-9)fail('SINGLE_POSITION_LIMIT');
   if(policy.maxGrossExposurePct!=null&&(gross+reserved+addition)/equity*100>policy.maxGrossExposurePct+1e-9)fail('GROSS_EXPOSURE_LIMIT');
  }
 }
 if(policy.maxDrawdownPausePct!=null||policy.maxDailyLossPausePct!=null){if(!previousClose)fail('MISSING_PRIOR_CLOSE_EVIDENCE');else{try{const r=evaluatePreviousCloseRisk({...previousClose,maxDrawdownPausePct:policy.maxDrawdownPausePct,maxDailyLossPausePct:policy.maxDailyLossPausePct});if(r.paused)fail('PREVIOUS_CLOSE_LOSS_LIMIT');}catch{fail('INVALID_PRIOR_CLOSE_EVIDENCE');}}}
 return {allowed:reasons.length===0,reasonCodes:reasons,policyVersion:policy.version};
}
module.exports={validateEntryPolicy,evaluateEntryRisk};
