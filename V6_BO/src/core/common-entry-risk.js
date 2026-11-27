'use strict';
const {evaluatePreviousCloseRisk}=require('./portfolio-risk-gate');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const label=x=>typeof x==='string'&&x.length>0&&x.length<=80;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const symbolKnown=x=>label(x)&&x.trim()===x||Number.isSafeInteger(x)&&x>=0;
const own=(map,key)=>record(map)&&Object.hasOwn(map,key)?map[key]:undefined;
function validateEntryPolicy(p){
 if(p==null)return;if(!label(p.version))throw Error('风控版本无效');
 for(const k of ['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct','maxDrawdownPausePct','maxDailyLossPausePct'])if(p[k]!=null&&(!finite(p[k])||p[k]<=0||p[k]>100))throw Error('风控参数无效');
 if(p.maxConsecutiveLosses!=null&&(!Number.isSafeInteger(p.maxConsecutiveLosses)||p.maxConsecutiveLosses<1||p.maxConsecutiveLosses>1000))throw Error('连续亏损参数无效');
}
function consecutiveLosses(events){
 if(!Array.isArray(events))return null;
 let count=0;
 // Only an explicitly known buy can be skipped. Missing or unknown rows
 // after the last non-loss exit could conceal a realized loss or reset.
 for(let i=events.length-1;i>=0;i--){
  if(!Object.hasOwn(events,i))return null;
  const e=events[i],side=own(e,'side');
  if(side==='buy')continue;
  if(side!=='sell')return null;
  const pnl=own(e,'realizedPnl');
  if(!finite(pnl))return null;
  if(pnl>=0)break;
  count++;
 }
 return count;
}
function evaluateEntryRisk({policy=null,side='buy',symbol,strategyId,quantity,price,cash,positions=[],pending=[],marks={},sectors={},lossStreak=null,previousClose=null}={}){
 validateEntryPolicy(policy);if(!policy||side==='sell')return {allowed:true,reasonCodes:[],policyVersion:policy?.version||null};const reasons=[];const fail=code=>{if(!reasons.includes(code))reasons.push(code);};
 const needsExposure=['maxPositionPct','maxGrossExposurePct','maxSectorPct','maxStrategyPct'].some(k=>policy[k]!=null);
 const validInput=finite(cash)&&cash>=0&&finite(quantity)&&quantity>0&&finite(price)&&price>0&&finite(quantity*price)&&(!needsExposure||symbolKnown(symbol));
 if(!validInput)fail('INVALID_ACCOUNT_INPUT');
 const exposure={equity:null,gross:null,single:null,sector:null,strategy:null};
 if(needsExposure&&validInput){
  // Missing positions, identity or pending buy evidence must not become zero
  // exposure through JS coercion. Fractional research allocations remain valid.
  let gross=0,unknown=!Array.isArray(positions)||!Array.isArray(pending);const values=[];
  for(const p of Array.isArray(positions)?positions:[]){
   if(!record(p)||!symbolKnown(p.symbol)||!finite(p.quantity)||p.quantity<0){unknown=true;continue;}
   const mark=own(marks,p.symbol);
   if(!finite(mark)||mark<=0){unknown=true;continue;}
   const value=p.quantity*mark;if(!finite(value)){unknown=true;continue;}
   gross+=value;values.push({...p,value});
  }
  for(const p of Array.isArray(pending)?pending:[]){
   if(!record(p)||!symbolKnown(p.symbol)||!finite(p.quantity)||p.quantity<0||!finite(p.price)||p.price<=0){unknown=true;continue;}
   const value=p.quantity*p.price;if(!finite(value)){unknown=true;continue;}values.push({...p,value});
  }
  const equity=cash+gross,addition=quantity*price;
  const sum=fn=>values.filter(fn).reduce((n,p)=>n+p.value,0);
  const projectedGross=sum(()=>true)+addition;
  if(unknown||!finite(equity)||equity<=0||!finite(projectedGross))fail('MISSING_POSITION_MARKS');else{
   // Order reducers accept numeric six-digit codes; comparison must share the
   // string-keyed holdings identity without rewriting the original evidence.
   exposure.equity=equity;exposure.gross=projectedGross;exposure.single=sum(p=>String(p.symbol)===String(symbol))+addition;
   if(policy.maxPositionPct!=null&&exposure.single/equity*100>policy.maxPositionPct+1e-9)fail('SINGLE_POSITION_LIMIT');
   if(policy.maxGrossExposurePct!=null&&exposure.gross/equity*100>policy.maxGrossExposurePct+1e-9)fail('GROSS_EXPOSURE_LIMIT');
   if(policy.maxSectorPct!=null){if(!label(own(sectors,symbol))||values.some(p=>!label(own(sectors,p.symbol))))fail('MISSING_SECTOR_CLASSIFICATION');else{exposure.sector=sum(p=>own(sectors,p.symbol)===own(sectors,symbol))+addition;if(exposure.sector/equity*100>policy.maxSectorPct+1e-9)fail('SECTOR_EXPOSURE_LIMIT');}}
   if(policy.maxStrategyPct!=null){if(!label(strategyId)||values.some(p=>!label(p.strategyId)))fail('MISSING_STRATEGY_ATTRIBUTION');else{exposure.strategy=sum(p=>p.strategyId===strategyId)+addition;if(exposure.strategy/equity*100>policy.maxStrategyPct+1e-9)fail('STRATEGY_EXPOSURE_LIMIT');}}
  }
 }
 if(policy.maxConsecutiveLosses!=null){if(!Number.isSafeInteger(lossStreak)||lossStreak<0)fail('MISSING_LOSS_STREAK');else if(lossStreak>=policy.maxConsecutiveLosses)fail('CONSECUTIVE_LOSS_LIMIT');}
 if(policy.maxDrawdownPausePct!=null||policy.maxDailyLossPausePct!=null){if(!previousClose)fail('MISSING_PRIOR_CLOSE_EVIDENCE');else{try{const r=evaluatePreviousCloseRisk({...previousClose,maxDrawdownPausePct:policy.maxDrawdownPausePct,maxDailyLossPausePct:policy.maxDailyLossPausePct});if(r.paused)fail('PREVIOUS_CLOSE_LOSS_LIMIT');}catch{fail('INVALID_PRIOR_CLOSE_EVIDENCE');}}}
 return {allowed:reasons.length===0,reasonCodes:reasons,policyVersion:policy.version,exposure,lossStreak};
}
module.exports={validateEntryPolicy,evaluateEntryRisk,consecutiveLosses};
