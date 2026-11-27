'use strict';
// Read-only research over the existing advanced portfolio report, never a
// second account, a source of execution permissions, or a policy installer.
const {validateEntryPolicy}=require('./common-entry-risk');
const VERSION='fayo-portfolio-defense-research-v1';
const FLAGS=Object.freeze({researchOnly:true,canTrade:false,canNotify:false,writesAccount:false,canAuthorize:false,guaranteedFill:false});
const num=x=>typeof x==='number'&&Number.isFinite(x);
const qty=x=>Number.isSafeInteger(x)&&x>=0;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const label=x=>typeof x==='string'&&x.trim().length>0&&x.length<=240;
const arr=x=>Array.isArray(x)?x:[];
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const cents=x=>num(x)&&x>=0&&Number.isSafeInteger(Math.round(x*100))&&Math.abs(x*100-Math.round(x*100))<=0.011?Math.round(x*100):null;
const money=x=>Number.isSafeInteger(x)?x/100:null;
const round=x=>num(x)?Number(x.toFixed(8)):null;
function sum(xs){let n=0;for(const x of xs){if(!qty(x)||!qty(n+x))return null;n+=x;}return n;}
function bound({book,diagnostic,snapshot,account,day:date,now}){
 if(!['pool','pre'].includes(account)||!day(date)||!time(now)||new Date(now+28800000).toISOString().slice(0,10)!==date||
    !book||book.paperOnly!==true||book.brokerConnected!==false||!hash(book.fingerprint)||!qty(book.revision)||book.revision<1||
    diagnostic?.account!==account||diagnostic.revision!==book.revision||diagnostic.checkedAt!==now||diagnostic.day!==date||
    diagnostic.originalReadValidation!==true||diagnostic.status!=='observed-unverified'||diagnostic.canTrade!==false||diagnostic.writesAccount!==false||
    snapshot?.evidenceRef!==book.fingerprint||!plain(book.account?.positions)||!Array.isArray(snapshot.positions)||
    !Array.isArray(diagnostic.positions)||snapshot.positions.length!==diagnostic.positions.length||snapshot.positions.length>220)return null;
 const cash=cents(snapshot.cash),free=cents(snapshot.availableCash),eq=cents(snapshot.equity),reserved=cents(diagnostic.reservedCash);
 if([cash,free,eq,reserved].includes(null)||eq<=0||free>cash||cash-free!==reserved||cash!==cents(book.account.cash)||
    free!==cents(diagnostic.availableCash)||eq!==cents(diagnostic.equity))return null;
 const rows=[],seen=new Set();
 for(const p of snapshot.positions){
  const actual=book.account.positions[p?.symbol],d=diagnostic.positions.find(x=>x?.symbol===p?.symbol),v=cents(p?.marketValue);
  if(!code(p?.symbol)||seen.has(p.symbol)||!d||!qty(actual?.quantity)||actual.quantity===0||d.quantity!==actual.quantity||
     v===null||v===0||!time(d.quoteAt)||d.quoteAt>now||now-d.quoteAt>15000||d.quoteStatus!=='recent-unverified')return null;
  seen.add(p.symbol);
  rows.push({symbol:p.symbol,quantity:d.quantity,value:v,mark:v/100/d.quantity,mature:qty(d.matureUnreserved)&&d.matureUnreserved<=d.quantity?d.matureUnreserved:null,
   theme:label(p.theme)&&label(p.classificationSource)&&label(p.classificationVersion)&&time(p.classificationKnownAt)&&p.classificationKnownAt<=now?p.theme:null,
   industry:label(p.industry)&&label(p.classificationSource)&&label(p.classificationVersion)&&time(p.classificationKnownAt)&&p.classificationKnownAt<=now?p.industry:null,
   lots:actual.lots});
 }
 if(Object.entries(book.account.positions).some(([s,p])=>!code(s)||!qty(p?.quantity)||p.quantity>0&&!seen.has(s)))return null;
 const held=sum(rows.map(x=>x.value));if(held===null||sum([cash,held])!==eq)return null;
 return {cash,free,eq,reserved,held,rows};
}
function pending(book,h){
 if(!plain(book.orders)||Object.keys(book.orders).length>50000)return null;
 const seen=new Set(),rows=[];
 for(const item of Object.values(book.orders)){
  const o=item?.order,s=item?.state;
  if(!o||!s||typeof s.terminal!=='boolean'||!['buy','sell'].includes(o.side)||!code(o.symbol)||!qty(s.remainingQuantity))return null;
  if(s.terminal)continue;
  if(!label(o.orderId)||seen.has(o.orderId)||s.remainingQuantity===0)return null;
  seen.add(o.orderId);
  if(o.side==='sell')continue;
  const value=cents(s.remainingQuantity*o.limitPrice);
  if(!num(o.limitPrice)||o.limitPrice<=0||value===null||value===0)return null;
  rows.push({symbol:o.symbol,value,quantity:s.remainingQuantity,orderId:o.orderId});
 }
 const notional=sum(rows.map(x=>x.value));
 if(notional===null||notional>h.reserved||!rows.length&&h.reserved!==0)return null;
 return {rows,notional,fees:h.reserved-notional};
}
// When one name stays unchanged and all OTHER exposures decline, a previously
// compliant concentration can reach the existing limit. Touch is not the
// original strict-greater-than gate; no future loss probability is inferred.
function reverseConcentration(values,equity,limit){
 const total=sum([...values.values()]);if(total===null||!qty(equity)||equity===0||!num(limit)||limit<=0||limit>100)return null;
 const out=[];
 for(const [symbol,v] of values){
  const other=total-v,atLimit=v/(limit/100),loss=Math.max(0,equity-atLimit),currentPct=100*v/equity;
  const reachable=currentPct>=limit||other>0&&loss<=other+1e-6;
  out.push({symbol,unchangedExposure:money(v),otherExposure:money(other),currentPct:round(currentPct),
   alreadyAboveLimit:currentPct>limit+1e-9,touchReachable:reachable,
   lossToTouch:reachable?round(loss/100):null,otherDeclineToTouchPct:reachable&&other>0?round(100*loss/other):null,
   canExceedWithinScenario:currentPct>limit+1e-9||other>0&&loss<other-1e-6&&limit<100});
 }
 return out.sort((a,b)=>(a.lossToTouch??Infinity)-(b.lossToTouch??Infinity)||a.symbol.localeCompare(b.symbol));
}
function reverse(h,p,policy){
 try{validateEntryPolicy(policy);}catch{return {status:'unknown',reason:'ORIGINAL_POLICY_INVALID',...FLAGS};}
 const limit=policy?.maxPositionPct??null;
 const held=new Map(h.rows.map(x=>[x.symbol,x.value])),filled=new Map(held);
 if(p)for(const x of p.rows){const value=sum([filled.get(x.symbol)||0,x.value]);if(value===null)return {status:'unknown',reason:'EXPOSURE_OVERFLOW',...FLAGS};filled.set(x.symbol,value);}
 const original=limit===null?null:reverseConcentration(held,h.eq,limit);
 const allFilled=p&&limit!==null&&h.eq>p.fees?reverseConcentration(filled,h.eq-p.fees,limit):null;
 return {status:original===null?'unknown':allFilled===null?'partial':'estimated-unverified',
  policyVersion:policy?.version??null,singlePositionLimitPct:limit,heldOnly:original,allPendingFill:allFilled,
  earliestHeldOnly:original?.find(x=>x.touchReachable)??null,earliestAllPendingFill:allFilled?.find(x=>x.touchReachable)??null,
  maxDailyLossPausePct:policy?.maxDailyLossPausePct??null,maxDrawdownPausePct:policy?.maxDrawdownPausePct??null,
  lossPauseRemainingYuan:null,lossPauseReason:'原前收权益/峰值与交易日历回执未在本高级组合读链提供；不得以当前权益替代',
  note:'某证券价格不变、其他证券共同下跌时的集中度触线条件；触线不等于原严格超限，冻结买单全成是假设。统一下跌可能降低仓位比例，不将其伪称为超限。',...FLAGS};
}
function additionRows(h,previews,book,now){
 return arr(previews).slice(0,20).map(p=>{
  const a=h.rows.find(x=>x.symbol===p?.symbol);
  const out={planId:p?.planId??null,symbol:p?.symbol??null,status:'unknown',beforeAverageCost:null,afterAverageCost:null,
   existingShares:a?.quantity??0,newShares:null,conditionalNewLockedShares:null,lossPerOnePctBefore:null,lossPerOnePctAfter:null,
   additionalLossPerOnePct:null,averageCostFalls:null,exposureIncreases:null,canAdd:false,...FLAGS};
  if(!a){out.status='not-existing-holding';return out;}
  if(p.status!=='estimated-unverified'||p.originalGateStatus!=='allowed'||p.previewBlocked!==false||p.accountRevision!==book.revision||
     p.accountEvidenceRef!==book.fingerprint||!label(p.gateEvidenceRef)||!qty(p.quantity)||p.quantity===0||!time(p.quoteAt)||p.quoteAt>now||
     now-p.quoteAt>15000||!num(p.price)||Math.abs(p.price-a.mark)>0.0001)return out;
  const gross=cents(p.quantity*p.price),fee=cents(p.estimatedFee),after=sum([a.value,gross]),shares=sum([a.quantity,p.quantity]);
  if(gross===null||fee===null||after===null||shares===null||sum([gross,fee])===null||gross+fee>h.free||fee>=h.eq)return out;
  Object.assign(out,{status:'exposure-only',newShares:p.quantity,conditionalNewLockedShares:p.quantity,
   lossPerOnePctBefore:round(a.value/10000),lossPerOnePctAfter:round(after/10000),
   additionalLossPerOnePct:round(gross/10000),exposureIncreases:after>a.value,
   beforeWeightPct:round(100*a.value/h.eq),afterFeeWeightPct:round(100*after/(h.eq-fee))});
  // Cost basis comes from retained authority lots, not the current mark or
  // strategy display average; unknown basis does not erase known exposure.
  if(!Array.isArray(a.lots)||!a.lots.length||a.lots.some(l=>!qty(l?.quantity)||cents(l.cost)===null)||
     sum(a.lots.map(l=>l.quantity))!==a.quantity)return out;
  const basis=sum(a.lots.map(l=>cents(l.cost))),next=sum([basis,gross,fee]);
  if(basis===null||next===null)return out;
  Object.assign(out,{status:'estimated-unverified',beforeAverageCost:round(basis/100/a.quantity),afterAverageCost:round(next/100/shares),
   averageCostFalls:next/shares<basis/a.quantity,
   beforeUnrealizedPnl:money(a.value-basis),afterUnrealizedPnlAtSameMark:money(after-next)});
  return out;
 });
}
// Same-mark capacity envelopes. A residual holding can become more
// concentrated when only liquid assets can hypothetically leave.
function liquidity(h,exits){
 if(!Array.isArray(exits)||exits.length!==h.rows.length||new Set(exits.map(x=>x?.symbol)).size!==exits.length)return null;
 const cases=[];
 for(const fraction of [1,.5,0]){
  const rows=h.rows.map(a=>{
   const e=exits.find(x=>x?.symbol===a.symbol);
   let cap=null,removed=null;
   if(fraction===0||a.mature===0){cap=0;removed=0;}
   else if(a.mature!==null&&e?.exitEstimateQuantity===a.mature&&qty(e.historicalDailyShares)&&
      num(e.conditionalSellableSessions)&&e.conditionalSellableSessions>=1){
    cap=Math.floor(e.historicalDailyShares*fraction);removed=Math.min(a.mature,cap);
   }
   const remaining=removed===null?null:Math.round(a.value*(a.quantity-removed)/a.quantity);
   return {symbol:a.symbol,theme:a.theme,quantity:a.quantity,matureUnreserved:a.mature,capacityShares:cap,
    hypotheticalRemovedShares:removed,residualShares:removed===null?null:a.quantity-removed,
    residualExposure:money(remaining),residualCents:remaining};
  });
  const residual=sum(rows.map(x=>x.residualCents)),known=sum(rows.filter(x=>x.residualCents!==null).map(x=>x.residualCents));
  const groups=new Map();let completeTheme=residual!==null&&rows.every(x=>x.residualCents===0||x.theme!==null);
  if(completeTheme)for(const r of rows)if(r.residualCents>0)groups.set(r.theme,(groups.get(r.theme)||0)+r.residualCents);
  cases.push({historicalCapacityFraction:fraction,status:residual===null?'partial':'estimated-unverified',
   residualHoldingExposure:money(residual),knownResidualExposure:money(known),unknownPositions:rows.filter(x=>x.residualCents===null).length,
   largestResidualWeightPct:residual>0?round(100*Math.max(...rows.map(x=>x.residualCents))/residual):null,
   largestThemeResidualWeightPct:completeTheme&&residual>0?round(100*Math.max(0,...groups.values())/residual):null,
   actualProceeds:null,actualExecutionCost:null,rows:rows.map(({residualCents,...r})=>r)});
 }
 return {status:'research-scenarios',cases,note:'以历史容量的100%/50%/0%和当前已核可卖批次作单段理论剩余敞口；不推定成交、申报单位、收益或实际可卖时点。剩余持仓权重以剩余持仓市值为分母，不是账户权益仓位。',...FLAGS};
}
function coLoss(h,observations,tail,now){
 const out={status:'unknown',alignedDays:null,tailDays:null,pairs:[],styleExposure:null,styleReason:'尚无B组当时有效的风格篮子或因子载荷；共跌不等于同一风格',independenceCertified:false,...FLAGS};
 if(h.rows.length<2||h.rows.length>20||tail?.status!=='estimated-unverified'||tail.returnBasis!=='adjusted-price'||
    !Array.isArray(observations)||observations.length<60||observations.length>3000||tail.sampleCount!==observations.length)return out;
 let last='';
 const rows=[];
 for(const o of observations){
  if(!day(o?.date)||o.date<=last||!time(o.availableAt)||o.availableAt>now||Date.parse(o.date+'T15:00:00+08:00')>o.availableAt||
     o.evidenceKind!=='historical'||o.returnBasis!=='adjusted-price'||!label(o.source)||!label(o.dataVersion)||
     h.rows.some(a=>!num(o.returns?.[a.symbol])||o.returns[a.symbol]<-1||o.returns[a.symbol]>100))return out;
  last=o.date;
  rows.push({date:o.date,returns:o.returns,portfolio:h.rows.reduce((s,a)=>s+a.value/h.eq*o.returns[a.symbol],0)});
 }
 if(tail.start!==rows[0].date||tail.end!==last)return out;
 // Fixed worst decile diagnostic, not calibrated or inferred crisis states.
 const k=Math.ceil(rows.length*.1-1e-9),sorted=rows.slice().sort((a,b)=>a.portfolio-b.portfolio||a.date.localeCompare(b.date));
 const worst=k>=10?sorted.slice(0,k):null;
 for(let i=0;i<h.rows.length;i++)for(let j=i+1;j<h.rows.length;j++){
  const a=h.rows[i],b=h.rows[j],both=r=>r.returns[a.symbol]<0&&r.returns[b.symbol]<0;
  out.pairs.push({symbols:[a.symbol,b.symbol],classificationComparison:a.theme&&b.theme?(a.theme===b.theme?'same-declared-theme':'different-declared-themes'):'unknown',
   allDays:rows.length,coLossDays:rows.filter(both).length,coLossFraction:round(rows.filter(both).length/rows.length),
   worstDecileDays:worst?.length??null,worstDecileCoLossDays:worst?worst.filter(both).length:null,
   worstDecileCoLossFraction:worst?round(worst.filter(both).length/worst.length):null});
 }
 return {...out,status:worst?'descriptive-unverified':'partial',alignedDays:rows.length,tailDays:worst?.length??null,
  note:'使用原完整同源对齐后复权收益与当前固定权重；最差十分位是事后描述，不是独立危机标签、共同因子归因或概率。'};
}
function buildPortfolioDefense(input={}){
 const h=bound(input);
 const out={version:VERSION,status:'unknown',reason:'ORIGINAL_BOUND_ACCOUNT_UNAVAILABLE',account:input.account??null,
  accountRevision:null,accountEvidenceRef:null,checkedAt:input.now??null,reverseStress:null,additions:[],liquidityStress:null,
  jointLoss:null,pending:null,...FLAGS};
 if(!h)return out;
 const {book,now}=input,p=pending(book,h);
 return {...out,status:p?'observed-research':'partial',reason:p?null:'ORIGINAL_PENDING_ORDER_EVIDENCE_UNAVAILABLE',
  accountRevision:book.revision,accountEvidenceRef:book.fingerprint,
  pending:p?{orderCount:p.rows.length,remainingNotional:money(p.notional),estimatedReservedFees:money(p.fees),includesFilledHoldingsOnce:true}:null,
  reverseStress:reverse(h,p,book.riskPolicy??null),additions:additionRows(h,input.previews,book,now),
  liquidityStress:liquidity(h,input.exits),jointLoss:coLoss(h,input.observations,input.tail,now)};
}
module.exports={buildPortfolioDefense,VERSION};
