// Optional CSV measurements. Percentage fields use percentage points, currency
// fields use CNY, and time fields represent the original observation clock.
export const riskNumericFields=[
  'bid1','ask1','debtToAssetsPct','cashToShortDebtPct','pledgedSharesPct',
  'goodwillToNetAssetsPct','marginBalanceToFloatPct','top10FloatHolderPct',
  'sectorAdvancingCount','sectorObservedCount','sectorTotalCount'
];
export const riskTextFields=[
  'tradingStatus','quoteSource','quoteAt','quoteReceivedAt','issuerIndustry','volumeUnit',
  'fundamentalSource','fundamentalPublishedAt','fundamentalKnownAt','financialPeriodEnd',
  'sectorRole','sectorBreadthSource','sectorBreadthAt','sectorBreadthReceivedAt'
];

const finite=Number.isFinite;
const validCode=s=>typeof s==='string'&&/^\d{6}$/.test(s);
const positive=n=>finite(n)&&n>0;
const fraction=n=>finite(n)&&n>=0&&n<=100;
const nonnegative=n=>finite(n)&&n>=0;
const known=s=>typeof s==='string'&&s.trim().length>0&&!['缺失','未知','未判定'].includes(s);
const fmt=n=>finite(n)?String(+n.toFixed(2)):'缺失';
const dayOf=s=>String(s||'').slice(0,10);
function time(x) {
  if(Number.isSafeInteger(x)&&x>0&&x<8e15)return x;
  if(typeof x!=='string')return NaN;
  const s=x.replace(' ','T');
  if(validDay(s))return Date.parse(s+'T15:00:00+08:00');
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
  if(!m||!validDay(m[1])||+m[2]>23||+m[3]>59||(m[4]!==undefined&&+m[4]>59))return NaN;
  const at=Date.parse(m[5]?s:s+'+08:00');
  return Number.isSafeInteger(at)&&at>0&&at<8e15?at:NaN;
}
const cnDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
function visible(row,cutoff){
  if(!row||!known(row.date)||!validDay(row.date.slice(0,10)))return false;
  const observed=time(row.date);
  if(!finite(observed)||observed>cutoff)return false;
  // Legacy absent clocks remain descriptive; explicit unknown or reversed clocks do not.
  return ['knownAt','availableAt'].every(k=>{
    if(!Object.hasOwn(row,k))return true;
    const v=row[k];
    // Date-only daily availableAt is a declared availability day, not a receipt.
    // Preserve the original CSV day-close convention; knownAt stays precise.
    const at=k==='availableAt'&&validDay(row.date)&&validDay(v)?time(v):planClock(v);
    return (typeof v!=='string'||validDay(v.slice(0,10)))&&finite(at)&&at>=observed&&at<=cutoff;
  });
}
function seen(source,observed,received,cutoff){
  const o=planClock(observed),r=planClock(received);
  return known(source)&&finite(o)&&finite(r)&&r>=o&&r<=cutoff;
}
const sameSymbol=(b,r)=>r?.code===b.code&&(!r.role||r.role==='stock');
const conflictFields=['sourceConflict','conflict','evidenceStatus','quoteStatus','retracted','withdrawn'];
const rowConflict=r=>r?.sourceConflict===true||r?.conflict===true||r?.evidenceStatus==='conflict'||r?.quoteStatus==='conflict'||r?.retracted===true||r?.withdrawn===true;
const priceUsable=r=>!rowConflict(r)&&r?.suspended!==true&&r?.tradingStatus!=='停牌'&&(r?.priceBasis==null||r.priceBasis==='unadjusted');
const comparableGap=r=>priceUsable(r)&&r?.noPriceLimit!==true&&r?.ipoNoLimit!==true&&
  (r?.corporateAction==null||r.corporateAction===false)&&r?.referencePriceConflict!==true;
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&finite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
// An already-visible contradictory observation is a gap, not a choice based on
// array order. Exact agreement on the consumed fields is safe to deduplicate.
function unambiguousAt(rows,fields,key=r=>r.date){
  const byKey=new Map();
  for(const row of rows){
    const k=key(row);
    if(!byKey.has(k)){byKey.set(k,row);continue;}
    const prior=byKey.get(k);
    if(prior&&!fields.every(field=>Object.is(prior[field],row[field])))byKey.set(k,null);
  }
  return [...byKey.values()].filter(Boolean);
}
function precedingDay(row){
  if(!validDay(row?.date))return null;
  if(row.previousDay!=null&&row.previousDay!=='')return validDay(row.previousDay)&&row.previousDay<row.date?row.previousDay:null;
  const d=new Date(row.date+'T12:00:00Z');
  do{d.setUTCDate(d.getUTCDate()-1);}while([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
const locked=b=>positive(b?.limitUp)&&b.high===b.limitUp&&b.low===b.limitUp&&b.close===b.limitUp;
const sealed=b=>positive(b?.limitUp)&&b.close===b.limitUp;

// A date-only value is not a frozen decision or an actual receipt time.
// Preserve legacy records that omit redundant clocks, but do not repair an
// explicit unknown, malformed or later receipt with the original frozenAt.
function planClock(x){
  if(typeof x==='string'&&(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(x)||!validDay(x.slice(0,10))))return NaN;
  const at=time(x);
  return Number.isSafeInteger(at)&&at>0&&at<8e15?at:NaN;
}
function frozenRiskPlanTime(plan,code,cutoff,day){
  const frozen=planClock(plan?.frozenAt);
  if(!plan||rowConflict(plan)||plan.code!==code||!finite(cutoff)||!finite(frozen)||frozen>cutoff||
      day&&plan.intendedDate!=null&&plan.intendedDate!==day)return null;
  for(const key of ['firstKnownAt','knownAt','availableAt','receivedAt','recordedAt']){
    if(!Object.hasOwn(plan,key))continue;
    const at=planClock(plan[key]);
    if(!finite(at)||at<frozen||at>cutoff)return null;
  }
  return frozen;
}
export function selectFrozenRiskPlan(plans,code,day,cutoff){
  if(!Array.isArray(plans)||!validDay(day))return null;
  const eligible=plans.filter(p=>typeof p?.frozenAt==='string')
    .map(p=>({p,at:frozenRiskPlanTime(p,code,cutoff,day)}))
    .filter(({p,at})=>at!==null&&(p.intendedDate||cnDay(at))===day);
  if(eligible.length!==1)return null;
  const {p}=eligible[0];
  return {code,strategy:p.strategy,holdUntil:p.holdUntil,entryPrice:p.entryMax,stopPrice:p.stop,targetPrice:p.target,expectedAuctionGap:p.expectedAuctionGap,frozenAt:p.frozenAt};
}


// One definition for individual and benchmark position measurements.
function positionMetrics(sequence){
  const b=sequence[0],day=b.date,clean=n=>finite(n)?n:null;
  const historicalCount=sequence.length-1;
  const returnPct=(newer,older)=>positive(newer)&&positive(older)?clean(100*(newer/older-1)):null;
  // Use an average of scaled prices to avoid overflowing a finite sum.
  const mean=values=>{
    const maximum=Math.max(...values);
    if(!finite(maximum)||maximum<0||!values.length)return null;
    return maximum===0?0:clean(maximum*(values.reduce((sum,value)=>sum+value/maximum,0)/values.length));
  };
  const returns=[1,5,10,20].map(sessions=>{
    const value=historicalCount>=sessions?returnPct(b.close,sequence[sessions].close):null;
    const sample=historicalCount>=sessions+20?Array.from({length:20},(_,i)=>
      returnPct(sequence[i+1].close,sequence[i+1+sessions].close)):[];
    const complete=sample.length===20&&sample.every(finite)&&value!==null;
    const rank=complete?100*(sample.filter(n=>n<value).length+sample.filter(n=>n===value).length/2)/20:null;
    return {sessions,returnPct:value,from:value!==null?sequence[sessions].date:null,to:day,
      historicalEndpointCount:complete?20:0,requiredHistoricalEndpointCount:20,
      historicalRankPct:rank,historyFrom:complete?sequence[20].date:null,historyTo:complete?sequence[1].date:null};
  });
  const movingAverages=[5,10,20].map(sessions=>{
    const average=sequence.length>=sessions?mean(sequence.slice(0,sessions).map(r=>r.close)):null;
    return {sessions,average,deviationPct:returnPct(b.close,average),
      from:average!==null?sequence[sessions-1].date:null,to:day};
  });
  const trueRanges=historicalCount>=14?sequence.slice(0,14).map((r,i)=>{
    const previousClose=sequence[i+1].close;
    return Math.max(r.high-r.low,Math.abs(r.high-previousClose),Math.abs(r.low-previousClose));
  }):[];
  const atr=trueRanges.length===14?mean(trueRanges):null,ma20=movingAverages[2].average;
  return {source:b.source,priceBasis:'unadjusted',referenceClose:b.close,day,
    contiguousPriorBars:historicalCount,returns,movingAverages,
    atr14:atr===null?null:{value:atr,pctOfClose:clean(100*(atr/b.close)),
      distanceFromMa20:positive(atr)&&positive(ma20)?clean((b.close-ma20)/atr):null,
      from:sequence[13].date,to:day,basis:'simple-average-of-14-true-ranges-including-gap-not-Wilder'},
    openingGapPct:historicalCount?returnPct(b.open,sequence[1].close):null,
    basis:'same-declared-source-and-sample-family-historical-research-only',
    continuity:'declared-previous-day-or-weekday-chain-not-calendar-certified',
    historicalPercentileBasis:'20-prior-overlapping-return-endpoints-midrank-not-probability',
    canTrade:false};
}

// Descriptive close-based structure review. Reconstruct a fixed preceding
// 20-bar range at a visible endpoint; never reinterpret it using later highs.
function structureReview(sequence,cutoff,volumeByDay){
  if(sequence.length<21)return null;
  const b=sequence[0],day=b.date,clean=n=>finite(n)?n:null;
  const rangeAt=i=>{
    const prior=sequence.slice(i+1,i+21);
    if(prior.length!==20)return null;
    const at=i===0?cutoff:time(sequence[i].date);
    if(!visible(sequence[i],at)||!prior.every(r=>visible(r,at)))return null;
    return {from:prior.at(-1).date,to:prior[0].date,high:Math.max(...prior.map(r=>r.high)),low:Math.min(...prior.map(r=>r.low))};
  };
  const range=rangeAt(0);
  if(!range)return null;
  const current={range,referenceClose:b.close,
    closeVsCeilingPct:clean(100*(b.close/range.high-1)),closeVsFloorPct:clean(100*(b.close/range.low-1)),
    closeAboveCeiling:b.close>range.high,closeAtCeiling:b.close===range.high,
    touchedBeyondCeiling:b.high>range.high,
    attemptedBreakoutReturnedBelow:b.high>range.high&&b.close<range.high,
    attemptedBreakoutClosedAtBoundary:b.high>range.high&&b.close===range.high,
    closeBelowFloor:b.close<range.low,lowBelowFloor:b.low<range.low};
  const result={day,current,anchorStatus:'unknown',anchor:null,path:null,canTrade:false,
    basis:'visible-original-daily-ohlc-structure-not-confirmed-breakout-or-execution',
    continuity:'declared-previous-day-or-weekday-chain-not-calendar-certified'};
  // Fixed five-endpoint search. All five prior ranges must be known at
  // their respective endpoints. An incomplete search cannot prove no anchor.
  if(sequence.length<25)return result;
  const ranges=Array.from({length:5},(_,i)=>rangeAt(i));
  if(ranges.some(r=>!r))return result;
  let anchorIndex=null;
  for(let i=4;i>=0;i--)if(sequence[i].close>ranges[i].high){anchorIndex=i;break;}
  if(anchorIndex===null){result.anchorStatus='no-close-breakout-in-five-endpoints';return result;}
  const anchorBar=sequence[anchorIndex],frozen=ranges[anchorIndex],level=frozen.high;
  const post=sequence.slice(0,anchorIndex).reverse();
  // All earlier daily path observations must have been visible at their own
  // close, and current observation at the requested cutoff.
  if(post.some(r=>!visible(r,r===b?cutoff:time(r.date))))return result;
  result.anchorStatus='earliest-observed-close-breakout-in-five-endpoints';
  result.anchor={date:anchorBar.date,referenceFrom:frozen.from,referenceTo:frozen.to,
    resistance:level,rangeFloor:frozen.low,breakoutClose:anchorBar.close,
    basis:'reconstructed-prior-window-not-a-persisted-registered-plan'};
  let breached=false,reclaimed=false,firstBreachDay=null,firstReclaimDay=null,firstRebreakDay=null,rebreakCount=0,retestDays=0;
  const observations=post.map(r=>{
    const below=r.close<level,above=r.close>level,atLevel=r.close===level;
    const regained=above&&breached,retouched=r.low<=level&&!below;
    if(below&&!breached)firstBreachDay=r.date;
    if(below&&reclaimed){rebreakCount++;firstRebreakDay??=r.date;reclaimed=false;}
    if(below)breached=true;
    if(regained){firstReclaimDay??=r.date;reclaimed=true;}
    if(retouched)retestDays++;
    return {date:r.date,close:r.close,low:r.low,high:r.high,below,above,atLevel,retouched,
      touchedLevelButClosedBelow:r.high>=level&&below};
  });
  const last=observations.at(-1),prev=sequence[1];
  let volumeReview=null;
  const v=volumeByDay.get(day),av=volumeByDay.get(anchorBar.date),pv=volumeByDay.get(prev?.date);
  const validVolume=r=>r&&positive(r.volume)&&['shares','lots','手','股'].includes(r.volumeUnit);
  if(last?.retouched&&validVolume(v)&&validVolume(av)&&validVolume(pv)&&
      v.volumeUnit===av.volumeUnit&&v.volumeUnit===pv.volumeUnit){
    const versusAnchor=clean(v.volume/av.volume),versusPrevious=clean(v.volume/pv.volume);
    if(versusAnchor!==null&&versusPrevious!==null)volumeReview={unit:v.volumeUnit,volume:v.volume,
      anchorVolume:av.volume,previousVolume:pv.volume,versusAnchor,versusPrevious,
      contractedAgainstBoth:versusAnchor<1&&versusPrevious<1};
  }
  // A close back above the frozen level is not a release of risk. Recovery
  // after an earlier breach is kept distinct from a clean retest.
  let status='breakout-close-observed';
  if(last){
    if(last.below)status=rebreakCount>0?'reclaim-failed-close-below':'close-below-frozen-level';
    else if(breached)status=last.above?'close-reclaimed-after-breach':'boundary-after-breach';
    else if(last.retouched)status=last.atLevel?'retest-closed-at-boundary':
      volumeReview?.contractedAgainstBoth===true?'contracting-retest-close-held':
      volumeReview?'retest-close-held-no-confirmed-contraction':'retest-close-held-volume-unknown';
    else status='post-breakout-close-above';
  }
  result.path={status,observedSessions:post.length,observations,retestDays,
    firstBreachDay,firstReclaimDay,firstRebreakDay,rebreakCount,
    currentCloseBelowFrozenLevel:b.close<level,currentCloseBelowFrozenRangeFloor:b.close<frozen.low,
    volumeReview,actualHealthyPullback:null,actualFalseBreakout:null,actualRecoveryConfirmed:null,
    canTrade:false,basis:'daily-close-and-range-only-no-intraday-order-or-causal-proof'};
  return result;
}

/** Read-only point-in-time diagnostics, not verified vendor evidence or order permission. */
export function buildChaseRiskResearch({b,history=[],market={},sector={},asOf,plan=b?.frozenPlan,leaderRows=[],currentRows,sectorRows=[],indexRows=[]}={}){
  const out={basis:'historical-research-only',canTrade:false,priceRange:null,
    relativeStrength:null,activeBuy:null,reversal:null,grossPayoff:null,
    themeDeterioration:null,leaderCoDecline:null,relayFailure:null,flowPersistence:null,holdingExitReview:null,positionRisk:null,
    sectorPositionRisk:null,multiWindowRelativeStrength:null,themePersistence:null,structureReview:null};
  const cutoff=time(asOf??b?.date);
  const daily=r=>validDay(r?.date)&&(!r.period||['日K','日线','1d','daily'].includes(r.period));
  const price=r=>daily(r)&&priceUsable(r)&&r.priceBasis==='unadjusted'&&comparableGap(r)&&
    [r.open,r.high,r.low,r.close].every(positive)&&r.low<=Math.min(r.open,r.close)&&
    r.high>=Math.max(r.open,r.close)&&r.low<=r.high;
  if(!b||!validCode(b.code)||!sameSymbol(b,b)||!finite(cutoff)||!visible(b,cutoff)||!price(b))return out;
  const day=b.date, clean=n=>finite(n)?n:null;
  const priceFields=['previousDay','period','open','high','low','close','priceBasis','corporateAction','noPriceLimit','ipoNoLimit','referencePriceConflict',
    'amount','netActiveBuy','source','suspended','tradingStatus',...conflictFields];
  const themeFields=['sector','sectorRole','sectorLeader','sectorAssists','sectorAdvancingCount','sectorObservedCount','sectorTotalCount',
    'sectorBreadthSource','sectorBreadthAt','sectorBreadthReceivedAt'];
  const limitFields=['streak','limitUp','limitDown'];
  // The original check can pick the first same-day bar. Do not present the
  // new research projection if the actually visible current rows disagree.
  if(currentRows!==undefined){
    if(!Array.isArray(currentRows))return out;
    const observed=currentRows.filter(r=>sameSymbol(b,r)&&daily(r)&&r.date===day&&visible(r,cutoff));
    const unique=unambiguousAt(observed,[...priceFields,...themeFields,...limitFields]);
    if(unique.length!==1||!price(unique[0]))return out;
    // Enrichment of fields absent from the original bar is descriptive, but
    // an explicitly different original observation is not interchangeable.
    if([...priceFields,...themeFields,...limitFields].some(k=>Object.hasOwn(unique[0],k)&&
        Object.hasOwn(b,k)&&!Object.is(unique[0][k],b[k])))return out;
  }
  const visibleHistory=(Array.isArray(history)?history:[]).filter(r=>sameSymbol(b,r)&&daily(r)&&r.date<day&&visible(r,cutoff));
  const rows=unambiguousAt(visibleHistory,priceFields);
  function past(day,fields){
    const r=unambiguousAt(visibleHistory.filter(r=>r.date===day),[...priceFields,...fields])[0];
    return price(r)?r:null;
  }
  const byDay=new Map(rows.map(r=>[r.date,r])),prior=[];
  let target=precedingDay(b);
  while(target&&prior.length<20){
    const r=byDay.get(target);
    if(!price(r))break;
    prior.push(r);target=precedingDay(r);
  }
  const prev=prior[0];
  // Fixed descriptive windows, never a fitted high-position threshold.
  // The historical percentile compares 20 earlier endpoints, excludes today,
  // and keeps the same declared source/sample family and unadjusted continuity.
  // A 20-session return plus its 20 historical endpoints needs 40 prior bars.
  let positionSequence=null;
  if(known(b.source)){
    const positionFields=[...priceFields,'sampleSet','sampleSource'];
    const current= currentRows===undefined ? b :
      unambiguousAt(currentRows.filter(r=>sameSymbol(b,r)&&daily(r)&&r.date===day&&visible(r,cutoff)),positionFields)[0];
    const comparable=r=>price(r)&&r.source===b.source&&r.sampleSet===b.sampleSet&&r.sampleSource===b.sampleSource;
    if(comparable(current)&&positionFields.every(k=>!Object.hasOwn(current,k)||Object.is(current[k],b[k]))){
      const positionsByDay=new Map(unambiguousAt(visibleHistory,positionFields).map(r=>[r.date,r]));
      const sequence=[b];
      while(sequence.length<=40){
        const priorDay=precedingDay(sequence.at(-1)),r=positionsByDay.get(priorDay);
        if(!comparable(r))break;
        sequence.push(r);
      }
      positionSequence=sequence;
      out.positionRisk=positionMetrics(sequence);
      // A price-identical duplicate may disagree on volume. Suppress only
      // the volume comparison instead of losing otherwise valid price facts.
      const originals=currentRows===undefined?[b]:currentRows.filter(r=>sameSymbol(b,r)&&daily(r)&&r.date===day&&visible(r,cutoff));
      const volumeRows=unambiguousAt([...visibleHistory,...originals],[...positionFields,'volume','volumeUnit']);
      const volumes=new Map(volumeRows.map(r=>[r.date,r]));
      if(currentRows!==undefined&&(!Object.is(volumes.get(day)?.volume,b.volume)||!Object.is(volumes.get(day)?.volumeUnit,b.volumeUnit)))volumes.delete(day);
      out.structureReview=structureReview(sequence,cutoff,volumes);
    }
  }
  // The benchmark must be an actual original series, not the derived daily
  // market/sector change or an inferred index. Multiple codes for one theme
  // or conflicting versions interrupt comparability rather than choosing one.
  const benchmarkFields=[...priceFields,'code','role','sector','sampleSet','sampleSource'];
  const benchmarkPrice=r=>daily(r)&&priceUsable(r)&&r.priceBasis==='unadjusted'&&
    (r.corporateAction==null||r.corporateAction===false)&&r.referencePriceConflict!==true&&
    [r.open,r.high,r.low,r.close].every(positive)&&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)&&r.low<=r.high;
  function benchmarkSequence(input,role,identity){
    if(!known(identity)||!Array.isArray(input))return null;
    const label=r=>r.sector||r.code;
    const visibleRows=input.filter(r=>r?.role===role&&daily(r)&&r.date<=day&&visible(r,cutoff));
    const matching=visibleRows.filter(r=>role==='sector'?label(r)===identity:r.code===identity);
    const codes=[...new Set(matching.filter(r=>r.date===day).map(r=>r.code))];
    if(codes.length!==1||!known(codes[0]))return null;
    const code=codes[0],relevant=visibleRows.filter(r=>r.code===code||role==='sector'&&label(r)===identity);
    const byDate=new Map(unambiguousAt(relevant,benchmarkFields).map(r=>[r.date,r]));
    const current=byDate.get(day);
    if(!benchmarkPrice(current)||current.code!==code||!known(current.source)||
        role==='sector'&&label(current)!==identity)return null;
    // The two families may have different price vendors, but their declared
    // sample class must agree. Each benchmark's own source stays fixed.
    if((current.sampleSet??null)!==(b.sampleSet??null))return null;
    const comparable=r=>benchmarkPrice(r)&&r.code===code&&r.source===current.source&&
      r.sampleSet===current.sampleSet&&r.sampleSource===current.sampleSource&&
      (role!=='sector'||label(r)===identity);
    const sequence=[current];
    while(sequence.length<=40){
      const r=byDate.get(precedingDay(sequence.at(-1)));
      if(!comparable(r))break;
      sequence.push(r);
    }
    return sequence;
  }
  const sectorSequence=benchmarkSequence(sectorRows,'sector',b.sector);
  const indexSequence=benchmarkSequence(indexRows,'index',b.indexCode);
  if(sectorSequence)out.sectorPositionRisk={sector:b.sector,code:sectorSequence[0].code,...positionMetrics(sectorSequence)};
  if(positionSequence&&(sectorSequence||indexSequence)){
    const rawCurrent=currentRows===undefined?[b]:currentRows.filter(r=>sameSymbol(b,r)&&daily(r)&&r.date===day&&visible(r,cutoff));
    // A valid price duplicate can still disagree on benchmark identity.
    // Check the consumed identity independently for each comparison window.
    const identities=field=>new Map(unambiguousAt([...visibleHistory,...rawCurrent],
      [...priceFields,'sampleSet','sampleSource',field]).map(r=>[r.date,r]));
    const sectorIdentity=identities('sector'),indexIdentity=identities('indexCode');
    function aligned(benchmark,sessions,role){
      if(!benchmark||positionSequence.length<=sessions||benchmark.length<=sessions)return null;
      for(let i=0;i<=sessions;i++){
        const s=positionSequence[i],r=benchmark[i];
        const original=(role==='sector'?sectorIdentity:indexIdentity).get(s.date);
        if(!original||s.date!==r.date||role==='sector'&&(s.sector!==b.sector||original.sector!==b.sector)||
            role==='index'&&(s.indexCode!=null&&s.indexCode!==b.indexCode||
              original.indexCode!=null&&original.indexCode!==b.indexCode))return null;
      }
      const stock=clean(100*(b.close/positionSequence[sessions].close-1));
      const reference=clean(100*(benchmark[0].close/benchmark[sessions].close-1));
      if(stock===null||reference===null)return null;
      return {from:positionSequence[sessions].date,to:day,stockReturnPct:stock,benchmarkReturnPct:reference,
        excessPctPoints:clean(stock-reference),stockAbsoluteDown:stock<0,benchmarkAbsoluteDown:reference<0};
    }
    const windows=[1,5,10,20].map(sessions=>({sessions,
      sector:aligned(sectorSequence,sessions,'sector'),index:aligned(indexSequence,sessions,'index')}));
    // Compare percentage-point differences, not levels across unequal windows
    // as a probability, timing trigger, or proof of future underperformance.
    const near=windows.find(w=>w.sessions===5),long=windows.find(w=>w.sessions===20);
    const weakening=role=>near[role]&&long[role]&&near[role].excessPctPoints!==null&&long[role].excessPctPoints!==null?
      near[role].excessPctPoints<long[role].excessPctPoints:null;
    out.multiWindowRelativeStrength={sector:sectorSequence?{code:sectorSequence[0].code,source:sectorSequence[0].source}:null,
      index:indexSequence?{code:indexSequence[0].code,source:indexSequence[0].source}:null,
      windows,shorterExcessBelowLonger:{sector:weakening('sector'),index:weakening('index')},
      basis:'same-daily-window-return-difference-not-beta-or-predictive-decay',canTrade:false};
  }
  // Breadth counts and seal assists are separate observations. Neither a full
  // declared denominator nor stable totals certifies a frozen member universe.
  if(positionSequence&&known(b.sector)){
    const fields=[...priceFields,...themeFields,'sampleSet','sampleSource'];
    const current=currentRows===undefined?b:unambiguousAt(currentRows.filter(r=>
      sameSymbol(b,r)&&daily(r)&&r.date===day&&visible(r,cutoff)),fields)[0];
    if(current&&fields.every(k=>!Object.hasOwn(current,k)||Object.is(current[k],b[k]))){
      const historyByDay=new Map(unambiguousAt(visibleHistory,fields).map(r=>[r.date,r]));
      const seq=[b];
      for(const prior of positionSequence.slice(1,5)){
        const r=historyByDay.get(prior.date);
        if(!r||r.sector!==b.sector||r.source!==b.source||r.sampleSet!==b.sampleSet||r.sampleSource!==b.sampleSource)break;
        seq.push(r);
      }
      const validBreadth=r=>seen(r.sectorBreadthSource,r.sectorBreadthAt,r.sectorBreadthReceivedAt,cutoff)&&
        planClock(r.sectorBreadthAt)===time(r.date)&&Number.isSafeInteger(r.sectorTotalCount)&&r.sectorTotalCount>=10&&
        r.sectorObservedCount===r.sectorTotalCount&&Number.isSafeInteger(r.sectorAdvancingCount)&&
        r.sectorAdvancingCount>=0&&r.sectorAdvancingCount<=r.sectorTotalCount;
      const measure=(n,field)=>{
        if(seq.length<n)return null;
        const rows=seq.slice(0,n).reverse();
        if(field==='breadth'&&!rows.every(r=>validBreadth(r)&&r.sectorBreadthSource===b.sectorBreadthSource&&r.sectorTotalCount===b.sectorTotalCount))return null;
        if(field==='assists'&&!rows.every(r=>Number.isSafeInteger(r.sectorAssists)&&r.sectorAssists>=0))return null;
        const days=rows.map(r=>({date:r.date,value:field==='breadth'?100*(r.sectorAdvancingCount/r.sectorTotalCount):r.sectorAssists}));
        const values=days.map(r=>r.value),changes=values.slice(1).map((v,i)=>v-values[i]);
        return {source:field==='breadth'?b.sectorBreadthSource:b.source,
          declaredTotal:field==='breadth'?b.sectorTotalCount:null,days,
          delta:values.at(-1)-values[0],decliningTransitions:changes.filter(v=>v<0).length,
          risingTransitions:changes.filter(v=>v>0).length,unchangedTransitions:changes.filter(v=>v===0).length,
          strictlyDeclining:changes.every(v=>v<0),strictlyRising:changes.every(v=>v>0),
          basis:field==='breadth'?'same-declared-full-count-not-frozen-membership':'declared-seal-assists-not-full-breadth'};
      };
      const windows=[3,5].map(days=>({days,breadth:measure(days,'breadth'),sealAssists:measure(days,'assists')}));
      if(windows.some(w=>w.breadth||w.sealAssists))out.themePersistence={sector:b.sector,windows,
        basis:'descriptive-daily-persistence-not-intraday-warning-or-collapse-classifier',canTrade:false};
    }
  }
  if(prior.length===20){
    const high=Math.max(...prior.map(r=>r.high)),low=Math.min(...prior.map(r=>r.low));
    const less=prior.filter(r=>r.close<b.close).length,equal=prior.filter(r=>r.close===b.close).length;
    out.priceRange={count:20,from:prior.at(-1).date,to:prev.date,high,low,
      closeRankPct:100*(less+equal/2)/20,rangePositionPct:high>low?clean(100*(b.close-low)/(high-low)):null,
      aboveRange:b.close>high,belowRange:b.close<low,
      continuity:'declared-previous-day-or-weekday-chain-not-calendar-certified'};
  }
  if(prev){
    const stockChange=clean(100*(b.close/prev.close-1));
    const sameWindow=r=>r?.date===day&&r.previousDay===prev.date&&visible(r,cutoff)&&!rowConflict(r);
    const validChange=n=>finite(n)&&n>=-100;
    const indexChange=sameWindow(market)&&validChange(market.indexChange)?market.indexChange:null;
    const sectorChange=known(b.sector)&&sameWindow(sector)&&(sector.sector||sector.code)===b.sector&&
      (!sector.role||sector.role==='sector')&&validChange(sector.change)?sector.change:null;
    if(stockChange!==null&&(indexChange!==null||sectorChange!==null)){
      out.relativeStrength={from:prev.date,to:day,stockChange,indexChange,sectorChange,
        versusIndexPctPoints:indexChange===null?null:clean(stockChange-indexChange),
        versusSectorPctPoints:sectorChange===null?null:clean(stockChange-sectorChange),
        basis:'same-declared-daily-window-not-source-certified'};
    }
    const active=r=>known(r.source)&&positive(r.amount)&&finite(r.netActiveBuy)&&Math.abs(r.netActiveBuy)<=r.amount;
    if(active(b)&&active(prev)&&b.source===prev.source){
      const now=100*(b.netActiveBuy/b.amount),before=100*(prev.netActiveBuy/prev.amount);
      out.activeBuy={from:prev.date,to:day,source:b.source,currentNetCny:b.netActiveBuy,priorNetCny:prev.netActiveBuy,
        currentSharePct:now,priorSharePct:before,deltaPctPoints:now-before,turnedNegative:prev.netActiveBuy>0&&b.netActiveBuy<0,
        basis:'declared-net-active-buy-not-independent-fund-flow-verification'};
    }
  }
  // Theme deterioration: coverage and declared seal assists are different
  // measurements; never fill absent breadth with a limit-up count.
  if(prev&&known(b.sector)){
    const old=past(prev.date,themeFields);
    const breadth=r=>r&&seen(r.sectorBreadthSource,r.sectorBreadthAt,r.sectorBreadthReceivedAt,cutoff)&&
      planClock(r.sectorBreadthAt)===time(r.date)&&Number.isSafeInteger(r.sectorTotalCount)&&r.sectorTotalCount>=10&&
      r.sectorObservedCount===r.sectorTotalCount&&Number.isSafeInteger(r.sectorAdvancingCount)&&
      r.sectorAdvancingCount>=0&&r.sectorAdvancingCount<=r.sectorTotalCount;
    if(old&&old.sector===b.sector){
      let fullBreadth=null,sealAssists=null;
      if(breadth(b)&&breadth(old)&&b.sectorBreadthSource===old.sectorBreadthSource&&b.sectorTotalCount===old.sectorTotalCount){
        const currentPct=100*b.sectorAdvancingCount/b.sectorTotalCount,priorPct=100*old.sectorAdvancingCount/old.sectorTotalCount;
        fullBreadth={source:b.sectorBreadthSource,declaredTotal:b.sectorTotalCount,currentAdvancing:b.sectorAdvancingCount,
          priorAdvancing:old.sectorAdvancingCount,currentPct,priorPct,deltaPctPoints:currentPct-priorPct,
          basis:'same-declared-full-count-not-frozen-membership'};
      }
      const count=n=>Number.isSafeInteger(n)&&n>=0;
      if(known(b.source)&&b.source===old.source&&count(b.sectorAssists)&&count(old.sectorAssists)){
        sealAssists={source:b.source,current:b.sectorAssists,prior:old.sectorAssists,delta:b.sectorAssists-old.sectorAssists,
          basis:'declared-seal-assists-not-full-breadth'};
      }
      if(fullBreadth||sealAssists)out.themeDeterioration={from:prev.date,to:day,sector:b.sector,fullBreadth,sealAssists};
      // Compare two original daily rows for the same explicitly identified
      // leader, not a guessed leader or a same-name member quotation.
      const lead=b.sectorLeader;
      if(b.sectorRole==='跟风'&&old.sectorRole==='跟风'&&validCode(lead)&&lead!==b.code&&old.sectorLeader===lead){
        const peer=unambiguousAt((Array.isArray(leaderRows)?leaderRows:[]).filter(r=>
          r?.code===lead&&sameSymbol({code:lead},r)&&daily(r)&&(r.date===day||r.date===prev.date)&&visible(r,cutoff)),
          [...priceFields,'sector']);
        const now=peer.find(r=>r.date===day),before=peer.find(r=>r.date===prev.date);
        if(price(now)&&price(before)&&now.sector===b.sector&&before.sector===b.sector&&precedingDay(now)===prev.date){
          const leaderChange=clean(100*(now.close/before.close-1)),stockChange=clean(100*(b.close/prev.close-1));
          if(leaderChange!==null&&stockChange!==null)out.leaderCoDecline={from:prev.date,to:day,sector:b.sector,leaderCode:lead,
            leaderChange,stockChange,stockMinusLeaderPctPoints:clean(stockChange-leaderChange),bothDown:leaderChange<0&&stockChange<0,
            basis:'two-declared-daily-returns-not-causal-transmission'};
        }
      }
    }
  }
  // Prior high-board state and today's actual daily limit-price evidence.
  if(prev){
    const old=past(prev.date,limitFields);
    const limit=r=>r&&positive(r.limitUp)&&r.high<=r.limitUp&&
      (!Object.hasOwn(r,'limitDown')||positive(r.limitDown)&&r.limitDown<r.limitUp&&r.low>=r.limitDown);
    if(limit(old)&&limit(b)&&old.high===old.limitUp&&old.close===old.limitUp&&Number.isSafeInteger(old.streak)&&old.streak>=3&&
        (!Object.hasOwn(b,'streak')||Number.isSafeInteger(b.streak)&&(b.close===b.limitUp?b.streak===old.streak+1:b.streak===0))){
      const touched=b.high===b.limitUp,closed=b.close===b.limitUp;
      out.relayFailure={priorDay:prev.date,day,priorStreak:old.streak,priorLimitUp:old.limitUp,currentLimitUp:b.limitUp,
        touchedLimit:touched,closedAtLimit:closed,failedAfterTouch:touched&&!closed,failedToContinue:!closed,
        touchToClosePct:touched?clean(100*(b.limitUp-b.close)/b.limitUp):null,
        basis:'prior-sealed-high-board-and-daily-limit-evidence-not-fill'};
    }
  }
  // Three consecutive daily measurements from one declared source. Zero is
  // an observation, not negative flow; missing or conflicting days stay null.
  if(prior.length>=2){
    const flowRows=[prior[1],prior[0],b];
    const active=r=>known(r.source)&&positive(r.amount)&&finite(r.netActiveBuy)&&Math.abs(r.netActiveBuy)<=r.amount;
    if(flowRows.every(r=>active(r)&&r.source===b.source)){
      const days=flowRows.map(r=>({date:r.date,netCny:r.netActiveBuy,sharePct:100*(r.netActiveBuy/r.amount)}));
      const totalAmount=flowRows.reduce((sum,r)=>sum+r.amount,0),totalNet=flowRows.reduce((sum,r)=>sum+r.netActiveBuy,0);
      const negativeDays=days.filter(r=>r.netCny<0).length;
      out.flowPersistence={source:b.source,days,negativeDays,allNegative:negativeDays===3,
        strictlyWeakeningShares:days[0].sharePct>days[1].sharePct&&days[1].sharePct>days[2].sharePct,
        totalNetCny:clean(totalNet),turnoverWeightedSharePct:finite(totalAmount)&&finite(totalNet)?clean(100*(totalNet/totalAmount)):null,
        basis:'three-declared-net-active-buy-days-not-verified-main-force-outflow'};
    }
  }
  // Holding evidence is a declared snapshot, not the authoritative current
  // account. A trigger or a declared sellable count never authorizes an exit.
  const holding=b.holdingSnapshot;
  if(holding?.code===b.code&&!rowConflict(holding)&&Number.isSafeInteger(holding.shares)&&holding.shares>0&&positive(holding.avgCost)&&
      seen(holding.source,holding.observedAt,holding.knownAt,cutoff)&&cnDay(planClock(holding.observedAt))===day){
    const knownPlan=frozenRiskPlanTime(plan,b.code,cutoff,day)!==null;
    const levels=knownPlan&&positive(plan.stopPrice)&&positive(plan.targetPrice)&&plan.stopPrice<plan.targetPrice;
    const stopReached=levels?b.close<=plan.stopPrice:null,targetReached=levels?b.close>=plan.targetPrice:null;
    const declaredSellable=Number.isSafeInteger(holding.sellableShares)&&holding.sellableShares>=0&&holding.sellableShares<=holding.shares?
      holding.sellableShares:null;
    const floatingReturnPct=clean(100*(b.close/holding.avgCost-1));
    const breadth=out.themeDeterioration?.fullBreadth,assists=out.themeDeterioration?.sealAssists;
    const weakness=breadth?.deltaPctPoints<0||assists?.delta<0||out.leaderCoDecline?.bothDown===true||
      out.relayFailure?.failedAfterTouch===true||out.flowPersistence?.allNegative===true;
    const reviewLevel=stopReached===true?'frozen-stop-review':targetReached===true?'frozen-target-review':
      weakness?'weakness-review':levels?'no-frozen-price-trigger-observed':'unassessed';
    out.holdingExitReview={snapshotSource:holding.source,observedAt:holding.observedAt,knownAt:holding.knownAt,
      declaredShares:holding.shares,declaredSellableShares:declaredSellable,averageCost:holding.avgCost,referenceClose:b.close,
      floatingReturnPct,stopReached,targetReached,reviewLevel,canExecuteExit:null,
      basis:'historical-holding-review-not-authoritative-account-or-sellability'};
  }
  const range=b.high-b.low;
  out.reversal={high:b.high,close:b.close,drawdownFromHighPct:clean(100*((b.high-b.close)/b.high)),
    upperWickPctOfRange:range>0?clean(100*((b.high-Math.max(b.open,b.close))/range)):null,
    closePositionPctOfRange:range>0?clean(100*((b.close-b.low)/range)):null,
    basis:'daily-ohlc-not-intraday-path'};
  if(frozenRiskPlanTime(plan,b.code,cutoff,day)!==null&&
      [plan.entryPrice,plan.stopPrice,plan.targetPrice].every(positive)&&
      plan.stopPrice<b.close&&b.close<plan.targetPrice&&b.close<=plan.entryPrice){
    const reward=plan.targetPrice-b.close,loss=b.close-plan.stopPrice,ratio=clean(reward/loss);
    if(ratio!==null)out.grossPayoff={assumedEntry:b.close,entryCap:plan.entryPrice,stop:plan.stopPrice,target:plan.targetPrice,
      grossRewardRisk:ratio,breakEvenWinRatePct:clean(100/(1+ratio)),basis:'frozen-plan-price-only-no-fees-slippage-fill-or-probability'};
  }
  return out;
}

function priceRisks(b,h,f,m,sector,stage,add){
  const prev=h.at(-1),older=h.at(-2);
  const highMark=Number.isInteger(prev?.streak)&&prev.streak>=3;
  const stalled=finite(f.change)&&Math.abs(f.change)<=1;
  const declining=prev&&older&&[older.volume,prev.volume,b.volume].every(positive)&&older.volume>prev.volume&&prev.volume>b.volume;
  const accelerating=declining&&sealed(older)&&sealed(prev)&&sealed(b)&&Number.isInteger(b.streak)&&b.streak>=3;
  if(highMark&&finite(f.ratio)&&finite(f.change)){
    add('11:0',f.ratio>=1.5&&stalled,'昨日 '+prev.streak+' 连板，今日量比 '+fmt(f.ratio)+'，收盘涨幅 '+fmt(f.change)+'%（量比≥1.5且涨跌幅在±1%）');
  }
  if(highMark&&comparableGap(b)&&finite(b.auctionGap)){
    add('30:0',b.auctionGap<=-5,'昨日 '+prev.streak+' 连板，竞价涨幅 '+fmt(b.auctionGap)+'%（≤−5%）');
    if(b.auctionGap<=-5&&declining)add('30:3',true,'高标显著低开且连续三日成交量递减');
  }
  if(highMark&&stalled&&older&&[older.amount,prev.amount,b.amount].every(positive)){
    const shrinking=older.amount>prev.amount&&prev.amount>b.amount&&b.amount<=older.amount*.75;
    add('11:3',shrinking,'高标滞涨，近三日成交额 '+[older.amount,prev.amount,b.amount].map(n=>fmt(n/1e8)).join(' / ')+' 亿元（两日累计收缩≥25%）');
  }
  if(accelerating){
    add('40:0',true,'连续三次封板且三日成交量递减，当前 '+b.streak+' 连板');
    if(fraction(b.turnover))add('20:2',b.turnover<=1,'连续缩量板日换手 '+fmt(b.turnover)+'%（≤1%）');
    if(fraction(b.sealRatio))add('40:2',b.sealRatio<=1,'连续缩量板的收盘封单占当日成交额 '+fmt(b.sealRatio)+'%（≤1%）');
    if(Number.isSafeInteger(b.sectorAssists)&&b.sectorAssists>=0&&Number.isSafeInteger(prev.sectorAssists)&&prev.sectorAssists>=2&&b.sector===prev.sector&&known(b.sector)){
      add('40:1',b.sectorAssists<prev.sectorAssists,'同题材封板助攻由 '+prev.sectorAssists+' 减至 '+b.sectorAssists+' 只');
      add('20:1',b.sectorAssists===0,'连续缩量高板的题材封板助攻由 '+prev.sectorAssists+' 只降至 '+b.sectorAssists+' 只');
    }
    if(['分歧','退潮'].includes(stage)&&fraction(m.breakRate)&&m.breakRate>=40){
      add('20:3 40:3',true,'个股已连续缩量封板；市场阶段 '+stage+'，炸板率 '+fmt(m.breakRate)+'%');
    }
  }
  if(locked(prev)&&positive(b.limitUp)&&finite(f.change)&&finite(f.ratio)&&finite(b.low)&&finite(b.close)){
    add('46:3',b.low<b.limitUp&&b.close<b.limitUp&&f.ratio>=2&&f.change<=-4,
      '前日一字涨停，今日量比 '+fmt(f.ratio)+'、收盘涨跌 '+fmt(f.change)+'%，以开板放量、跌幅≥4%核对');
  }
  const lead=f.sectorLeader??b.sectorLeader;
  if(b.sectorRole==='跟风'&&known(b.sector)&&known(lead)&&lead!==b.code&&lead!==b.name){
    if(f.position==='高位'&&finite(f.ratio))add('37:1',f.ratio>=1.5,'同题材跟风标的 '+b.code+' 处于20日区间高位，量比 '+fmt(f.ratio));
    const leaderRows=(sector.memberQuotes||[]).filter(q=>(validCode(lead)?q.code===lead:q.name===lead)&&q.date===b.date&&q.sector===b.sector);
    if(leaderRows.length===1&&!rowConflict(leaderRows[0])&&validCode(leaderRows[0].code)&&sameSymbol({code:leaderRows[0].code},leaderRows[0])&&leaderRows[0].code!==b.code&&finite(leaderRows[0].change)&&finite(leaderRows[0].ratio)&&f.position==='高位'&&finite(f.ratio)&&f.ratio>=1.5){
      const leader=leaderRows[0];add('37:0',Math.abs(leader.change)<=1&&leader.ratio>=1.5,'同题材龙头 '+leader.code+' 涨幅 '+fmt(leader.change)+'%、量比 '+fmt(leader.ratio)+'，跟风票高位放量');
    }
  }
}

function executionRisks(b,cutoff,sector,stage,add){
  const plan=b.frozenPlan,planKnown=frozenRiskPlanTime(plan,b.code,cutoff,dayOf(b.date))!==null;
  const holding=b.holdingSnapshot;
  const holds=!rowConflict(holding)&&holding?.code===b.code&&Number.isSafeInteger(holding.shares)&&holding.shares>0&&positive(holding.avgCost)&&
    seen(holding.source,holding.observedAt,holding.knownAt,cutoff)&&cnDay(time(holding.observedAt))===dayOf(b.date);
  if(holds&&priceUsable(b)&&positive(b.close)){
    const gain=b.close>holding.avgCost;
    add('64:0',gain,'持仓成本 '+fmt(holding.avgCost)+' 元、现价 '+fmt(b.close)+' 元，原始持仓时点 '+holding.observedAt);
    if(gain&&finite(sector.change))add('64:2',sector.change<=-2,'持仓仍有浮盈，所属板块当日涨跌 '+fmt(sector.change)+'%（≤−2%）');
    if(planKnown&&positive(plan.stopPrice)){
      add('52:0',b.close<=plan.stopPrice,'持仓收盘 '+fmt(b.close)+' 元，冻结止损价 '+fmt(plan.stopPrice)+' 元');
      if(positive(plan.supportPrice))add('52:1',b.close<plan.supportPrice,'持仓收盘 '+fmt(b.close)+' 元，冻结结构支撑 '+fmt(plan.supportPrice)+' 元');
    }
    if(planKnown&&positive(plan.targetPrice)&&gain)add('53:1',b.close>=plan.targetPrice,'持仓收盘 '+fmt(b.close)+' 元，事前目标价 '+fmt(plan.targetPrice)+' 元');
    if(gain&&stage==='分歧'&&finite(sector.change)&&sector.change<=-3)add('53:2',true,'持仓浮盈，情绪分歧且板块下跌 '+fmt(-sector.change)+'%');
  }
  // Motivation is only admissible as the trader's own time-stamped statement
  // linked to this specific decision. No price-series inference supplies intent.
  const record=b.traderRecord;
  if(!rowConflict(record)&&record?.code===b.code&&record.source==='本人交易日志'&&known(record.decisionId)&&
      seen(record.source,record.decisionAt,record.recordedAt,cutoff)&&cnDay(time(record.decisionAt))===dayOf(b.date)){
    const keys={'报复性交易':'55:2','亏损后急于回本':'55:3','凭感觉':'59:1','听消息':'59:2',
      '跟风别人标的':'59:3','提前埋伏赌消息':'70:0','赌回流':'70:1','赌修复':'70:2'};
    const key=Object.hasOwn(keys,record.motive)?keys[record.motive]:null;
    if(key)add(key,true,'本人交易日志 '+record.decisionId+' 明确记录「'+record.motive+'」，登记 '+record.recordedAt);
  }
}

function balanceSheetRisks(b,cutoff,add){
  if(!seen(b.fundamentalSource,b.fundamentalPublishedAt,b.fundamentalKnownAt,cutoff))return;
  const published=time(b.fundamentalPublishedAt),period=time(b.financialPeriodEnd);
  if(!finite(period)||period>published||cutoff-period>400*86400000)return;
  const where='；'+b.fundamentalSource+'，数据期末 '+b.financialPeriodEnd+'，可知 '+b.fundamentalKnownAt;
  if(nonnegative(b.goodwillToNetAssetsPct))add('56:5',b.goodwillToNetAssetsPct>=30,'商誉占净资产 '+fmt(b.goodwillToNetAssetsPct)+'%（≥30%）'+where);
  if(fraction(b.pledgedSharesPct))add('69:1',b.pledgedSharesPct>=50,'全公司质押股份占总股本 '+fmt(b.pledgedSharesPct)+'%（≥50%）'+where);
  if(nonnegative(b.marginBalanceToFloatPct)&&cutoff-period<=10*86400000)add('69:0',b.marginBalanceToFloatPct>=15,
    '融资余额占流通市值 '+fmt(b.marginBalanceToFloatPct)+'%（≥15%，十日内数据）'+where);
  if(known(b.issuerIndustry)&&!/银行|保险|证券|金融|信托/.test(b.issuerIndustry)&&nonnegative(b.debtToAssetsPct)&&nonnegative(b.cashToShortDebtPct)){
    add('69:2',b.debtToAssetsPct>=80&&b.cashToShortDebtPct<=50,'非金融企业 '+b.issuerIndustry+' 的资产负债率 '+fmt(b.debtToAssetsPct)+'%、现金短债比 '+fmt(b.cashToShortDebtPct)+'%（≥80%且≤50%）'+where);
  }
  if(fraction(b.top10FloatHolderPct))add('65:2',b.top10FloatHolderPct>=80,'前十大流通股东合计占流通股 '+fmt(b.top10FloatHolderPct)+'%（≥80%）'+where);
}

function liquidityRisks(b,h,cutoff,add){
  if(b.tradingStatus==='停牌')add('57:1',true,'同日个股交易状态为停牌');
  const quoteConflict=rowConflict(b);
  if(b.tradingStatus!=='停牌'&&b.suspended!==true&&!quoteConflict&&positive(b.bid1)&&positive(b.ask1)&&b.ask1>=b.bid1&&seen(b.quoteSource,b.quoteAt,b.quoteReceivedAt,cutoff)&&
      cnDay(time(b.quoteAt))===dayOf(b.date)&&cutoff-time(b.quoteAt)<=180000){
    const spread=200*(b.ask1-b.bid1)/(b.ask1+b.bid1);
    add('57:1',spread>=1,'盘口买一 '+fmt(b.bid1)+'、卖一 '+fmt(b.ask1)+'，相对价差 '+fmt(spread)+'%（≥1%）；来源 '+b.quoteSource+' '+b.quoteAt);
  }
  const lastTen=h.slice(-9).concat(b);
  if(lastTen.length===10&&lastTen.every(r=>priceUsable(r)&&nonnegative(r.amount)&&fraction(r.turnover))){
    add('57:3',lastTen.every(r=>r.amount<1e7&&r.turnover<.5),'连续10个可见日成交额均低于1000万元且换手率均低于0.5%的检验');
  }
  if(known(b.sector)&&seen(b.sectorBreadthSource,b.sectorBreadthAt,b.sectorBreadthReceivedAt,cutoff)&&
      cnDay(time(b.sectorBreadthAt))===dayOf(b.date)&&Number.isSafeInteger(b.sectorTotalCount)&&b.sectorTotalCount>=10&&
      b.sectorTotalCount===b.sectorObservedCount&&Number.isInteger(b.sectorAdvancingCount)&&b.sectorAdvancingCount>=0&&b.sectorAdvancingCount<=b.sectorTotalCount){
    const lead=b.sectorLeader;
    if((lead===b.code||known(b.name)&&lead===b.name)&&finite(b.changePct)&&b.changePct>0){
      add('68:0 68:1',b.sectorAdvancingCount===1,'已核对 '+b.sector+' 全部 '+b.sectorTotalCount+' 只成分，当日上涨 '+b.sectorAdvancingCount+' 只，标的为上涨龙头；'+b.sectorBreadthSource);
    }
  }
}

// Select latest visible original same-event/source observation. Do not infer
// that an unrelated correction title cancels a different announcement.
function abnormalNoticeDays(b,cutoff){
  const groups=new Map();
  for(const a of Array.isArray(b.announcements)?b.announcements:[]){
    if(!a||(a.code??a.symbol)!==b.code||a.code!=null&&a.symbol!=null&&a.code!==a.symbol||!known(a.source)||!known(a.eventId))continue;
    const received=Object.hasOwn(a,'knownAt')?a.knownAt:a.receivedAt,at=planClock(received);
    if(finite(at)&&at>cutoff)continue;
    const key=JSON.stringify([a.source,a.eventId]),g=groups.get(key)||[];
    g.push({a,at,received});groups.set(key,g);
  }
  const events=new Map();
  for(const g of groups.values()){
    if(g.some(x=>!finite(x.at)))continue;
    const latest=Math.max(...g.map(x=>x.at)),rows=g.filter(x=>x.at===latest),{a,received}=rows[0];
    const fields=['code','symbol','eventId','source','title','publishedAt','type','verified',...conflictFields];
    if(rows.some(x=>!fields.every(k=>Object.is(x.a[k],a[k]))))continue;
    if(rowConflict(a)||a.verified!==true||!known(a.title)||!seen(a.source,a.publishedAt,received,cutoff)||
       typeof a.publishedAt==='string'&&!validDay(a.publishedAt.slice(0,10))||
       typeof received==='string'&&!validDay(received.slice(0,10))||
       !['股价异常波动公告','股票交易异常波动公告'].includes(a.type)||/更正|撤销|澄清|回复/.test(a.title))continue;
    const age=cutoff-time(a.publishedAt);
    if(age<0||age>10*86400000)continue;
    const day=cnDay(time(a.publishedAt));
    if(!events.has(a.eventId))events.set(a.eventId,day);
    else if(events.get(a.eventId)!==day)events.set(a.eventId,null);
  }
  return [...new Set([...events.values()].filter(Boolean))].sort();
}
function otherRisks(b,f,m,stage,series,minutes,cutoff,add){
  const day=dayOf(b.date);
  if(['严重异常波动','连续异常波动'].includes(b.regulationStatus))add('49:1 56:4',true,'个股同期监管状态明确记载为 '+b.regulationStatus);
  const noticeDays=abnormalNoticeDays(b,cutoff);
  if(noticeDays.length>=3)add('49:1',true,'近10个自然日有至少3个不同披露日的已核对交易异常波动公告：'+noticeDays.join('、'));
  const prev=series.filter(r=>r.date<day).at(-1);
  if(prev&&comparableGap(b)&&m.previousDay===prev.date&&known(b.sector)&&positive(b.limitDown)&&b.open===b.limitDown){
    const groups=(Array.isArray(prev.themes)?prev.themes:[]).filter(t=>t?.name===b.sector);
    const g=groups.length===1?groups[0]:null;
    if(g&&!rowConflict(g)&&Number.isSafeInteger(g.count)&&g.count>=2&&Array.isArray(g.members)&&g.members.length===g.count&&
        g.members.every(r=>r&&!rowConflict(r)&&validCode(r.code)&&Number.isSafeInteger(r.level)&&r.level>=1)&&
        new Set(g.members.map(r=>r.code)).size===g.count){
      const first=g.members.filter(r=>r.level===1);
      const times=first.map(r=>String(r.firstSealTime||'').replace(/:/g,''));
      if(times.length>=2&&times.every(t=>/^\d{6}$/.test(t)&&t>='092500'&&t<='150000'&&+t.slice(2,4)<60&&+t.slice(4)<60)){
        const earliest=[...times].sort()[0],list=first.filter((r,i)=>times[i]===earliest);
        if(list.length===1&&list[0].code===b.code)add('30:1',true,'前一交易日同题材首板中最早封板 '+earliest+'，今日直接以跌停价 '+b.limitDown+' 开盘');
      }
    }
  }
  if(known(m.calendarSource)&&finite(planClock(m.calendarKnownAt))&&planClock(m.calendarKnownAt)<=cutoff&&
      validDay(m.nextTradingDay)){
    const gap=(time(m.nextTradingDay)-time(day))/86400000;
    if(gap>=1&&gap<=18)add('58:0',gap>=6,'已发布交易日历 '+m.calendarSource+' 的下一个交易日 '+m.nextTradingDay+'，间隔 '+gap+' 个自然日');
  }
  const plan=b.frozenPlan;
  if(frozenRiskPlanTime(plan,b.code,cutoff,day)!==null){
    if(['退潮','高潮','冰点'].includes(stage)&&known(plan.strategy)){
      if(stage==='退潮'&&['连板接力战法','放量加速战法'].includes(plan.strategy))
        add('67:0',true,'冻结战法 '+plan.strategy+' 与退潮环境错配');
      if(stage==='高潮'&&['分歧低吸战法','恐慌低吸战法','赛道趋势低吸战法'].includes(plan.strategy))
        add('67:1',true,'冻结战法 '+plan.strategy+' 与高潮环境错配');
      if(stage==='冰点'&&positive(plan.plannedPosition)&&plan.plannedPosition>5)
        add('67:2',true,'冰点期拟开仓 '+fmt(plan.plannedPosition)+'%，高于冰点单标的5%上限');
    }
    if((plan.overnight===true||dayOf(plan.holdUntil)>day)&&
       ['SPX','NDX','HSI'].includes(m.externalIndexSymbol)&&finite(m.externalIndexChangePct)&&
       seen(m.externalIndexSource,m.externalIndexAt,m.externalIndexReceivedAt,cutoff)&&cutoff-time(m.externalIndexAt)<=36*3600000){
      add('63:1',m.externalIndexChangePct<=-3,'冻结隔夜计划；'+m.externalIndexSymbol+' 最近36小时已收悉的指数涨跌 '+fmt(m.externalIndexChangePct)+'%（≤−3%）');
    }
  }
  // A continuous minute series is required. Gaps, lunch breaks and one-off
  // spikes cannot be counted as repeated plunges.
  const sessionMinute=r=>{
    if(typeof r?.date!=='string'||!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(r.date))return false;
    const hour=Number(r.date.slice(11,13)),minute=Number(r.date.slice(14,16)),at=60*hour+minute;
    return hour<24&&minute<60&&(at>=570&&at<=690||at>=780&&at<=900);
  };
  const rows=unambiguousAt(minutes.filter(r=>sameSymbol(b,r)&&dayOf(r.date)===day&&sessionMinute(r)&&['1m','1min','1分钟','1分钟K','分钟K','分时'].includes(r.period)&&visible(r,cutoff)),['close','volume','priceBasis','suspended','tradingStatus',...conflictFields],r=>time(r.date))
    .filter(r=>priceUsable(r)&&positive(r.close)&&positive(r.volume)).sort((x,y)=>time(x.date)-time(y.date));
  let state=0;
  for(let i=1;i<rows.length;i++){
    if(time(rows[i].date)-time(rows[i-1].date)!==60000){state=0;continue;}
    const move=100*(rows[i].close/rows[i-1].close-1);
    if(state===2&&move<=-3){add('60:1',true,'逐分钟成交收盘出现两次至少3%急跌，中间出现至少2%反弹，第二次时刻 '+rows[i].date);break;}
    if(move<=-3)state=1;
    else if(state===1&&move>=2)state=2;
  }
}

export function addStockRiskEvidence({b,f={},market={},sector={},stage,history=[],marketSeries=[],intraday=[],asOf},facts){
  if(!b||!validCode(b.code)||!sameSymbol(b,b)||!validDay(b.date)||!facts)return facts;
  const cutoff=time(asOf??b.decisionAt??b.date);
  if(!finite(cutoff)||!visible(b,cutoff))return facts;
  const day=dayOf(b.date), priorRows=unambiguousAt(history.filter(r=>sameSymbol(b,r)&&validDay(r.date)&&r.date<day&&visible(r,cutoff)),
    ['previousDay','volume','amount','turnover','high','low','close','limitUp','streak','sector','sectorAssists','priceBasis','suspended','tradingStatus',...conflictFields]).filter(priceUsable).sort((a,z)=>a.date.localeCompare(z.date));
  const hist=[];
  let target=precedingDay(b);
  for(let i=priorRows.length-1;i>=0&&priorRows[i].date===target;i--){
    hist.unshift(priorRows[i]);target=precedingDay(priorRows[i]);
  }
  const marketDay=market?.date===day&&visible(market,cutoff)&&!rowConflict(market)?market:{};
  // Invalid explicit market evidence cannot support stage-dependent facts.
  // Legacy stage-only callers remain descriptive, not authenticated.
  const stageForEvidence=market&&(rowConflict(market)||Object.hasOwn(market,'date')&&marketDay!==market)?undefined:stage;
  const sectorOK=sector&&!rowConflict(sector)&&(!sector.date||dayOf(sector.date)===day&&visible(sector,cutoff))&&
    (!known(sector.sector)||sector.sector===b.sector)&&
    (sector.role!=='sector'||!known(sector.code)||sector.code===b.sector||sector.sector===b.sector);
  const sectorDay=sectorOK?{...sector,memberQuotes:(Array.isArray(sector.memberQuotes)?sector.memberQuotes:[])
    .filter(q=>visible(q,cutoff))}:{};
  function add(keys,pass,source){
    for(const key of keys.split(' ')){
      // An independent, verified adverse observation takes priority; preserve
      // earlier source evidence if it already confirms the same trigger.
      if(!facts.has(key)||pass&&!facts.get(key).pass)facts.set(key,{pass,source});
    }
  }
  if(priceUsable(b))priceRisks(b,hist,f,marketDay,sectorDay,stageForEvidence,add);
  liquidityRisks({...b,changePct:f.change??b.changePct,sectorLeader:f.sectorLeader??b.sectorLeader},hist,cutoff,add);
  balanceSheetRisks(b,cutoff,add);
  executionRisks(b,cutoff,sectorDay,stageForEvidence,add);
  const marketRows=marketSeries.filter(r=>validDay(r?.date)&&visible(r,cutoff)&&r.date<=day).map(r=>({...r,themeSignature:JSON.stringify(r.themes??null)}));
  const knownMarkets=unambiguousAt(marketRows,['previousDay','indexChange','volume','themeSignature',...conflictFields])
    .filter(r=>!rowConflict(r)).sort((a,z)=>a.date.localeCompare(z.date));
  otherRisks(b,f,marketDay,stageForEvidence,knownMarkets,intraday,cutoff,add);
  const marketDays=knownMarkets.slice(-3);
  if(marketDays.length===3&&marketDays.every((r,i)=>i===0||marketDays[i-1].date===precedingDay(r))&&marketDays.at(-1).date===day&&
      marketDays.every(r=>finite(r.indexChange))&&marketDay.volume==='放量下跌'&&
      (marketDay.indexChange==null||marketDay.indexChange===marketDays.at(-1).indexChange)){
    add('62:0',marketDays.every(r=>r.indexChange<0)&&marketDays.at(-1).indexChange<=-2,
      '全A近三日涨跌 '+marketDays.map(r=>fmt(r.indexChange)+'%').join(' / ')+'，当日放量下跌（当日≤−2%）');
  }
  // Do not count multiple wordings of the same dated disclosure twice.
  const groups=[
    ['减持',['56:0']],['立案或监管',['49:0','49:2','56:1','56:2','56:4']],
    ['盈利或偿债',['56:3','69:2']],['高位缩量',['20:0','40:0']],['流动性',['57:0','57:1','57:3']]
  ];
  const hits=groups.filter(([,keys])=>keys.some(key=>facts.get(key)?.pass===true));
  if(hits.length>=2)add('61:0',true,'独立负面证据叠加：'+hits.map(([label,keys])=>label+'（'+facts.get(keys.find(k=>facts.get(k)?.pass)).source+'）').join('；'));
  return facts;
}
