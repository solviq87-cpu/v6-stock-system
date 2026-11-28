'use strict';
// Read-only research over existing private import receipts and news revisions.
// A structured mapping is a declaration, not authenticated numeric extraction.
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const at=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const str=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=120;
const id=x=>str(x)&&/^[A-Za-z0-9_.:-]+$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e15;
const list=x=>Array.isArray(x)?x:[];
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=x=>typeof x==='number'&&Number.isFinite(x)?Number(x.toFixed(8)):null;
const MAX_DECLARATIONS=500,MAX_HYPOTHESES=10,MAX_SURPRISES=50;
const flags={researchOnly:true,canTrade:false,canTrain:false,canNotify:false,productionWeightsChanged:false,verifiedExternal:false};
const metrics=['economic-growth','credit-growth','margin-balance','credit-yield','funding-yield'];
const stages=['consultation','announced','effective-reported','disbursement-reported','effect-reported','issuer-retrospective','delayed','withdrawn'];
const close=d=>Date.parse(d+'T23:59:59.999+08:00');
const dateKey=d=>Date.parse(d+'T00:00:00Z');
const fields=(r,keys)=>Object.keys(r).every(k=>keys.includes(k));
const validGroup=g=>Array.isArray(g)&&g.length>=5&&g.length<=50&&g.every(code)&&new Set(g).size===g.length;
function validateDeclaration(type,r){
 const base=['id','revision','source','kind','newsRef'];
 if(!r||typeof r!=='object'||Array.isArray(r)||!id(r.id)||!Number.isSafeInteger(r.revision)||r.revision<1||r.revision>1000000||!id(r.source)||!hash(r.newsRef))throw Error('需要稳定研究ID、修订、来源和原新闻指纹');
 if(type==='macroEvidence'){
  if(!fields(r,[...base,'metric','series','scope','periodStart','periodEnd','methodVersion','unit','value','maturityMonths','currency','rightsBasis'])||
     !['actual','expectation'].includes(r.kind)||!metrics.includes(r.metric)||!id(r.series)||!id(r.scope)||!day(r.periodStart)||!day(r.periodEnd)||r.periodStart>r.periodEnd||
     !id(r.methodVersion)||!num(r.value)||!['pct','CNY'].includes(r.unit)||
     (r.metric==='margin-balance'?(r.unit!=='CNY'||r.value<0||r.kind!=='actual'):r.unit!=='pct'))throw Error('宏观或融资字段、期间及数值口径无效');
  if(['credit-yield','funding-yield'].includes(r.metric)){
   if(r.kind!=='actual'||r.currency!=='CNY'||r.periodStart!==r.periodEnd||!Number.isSafeInteger(r.maturityMonths)||r.maturityMonths<1||r.maturityMonths>360||r.rightsBasis!=='public-disclosure-declared')throw Error('信用与资金收益率需要同币种期限、观察日及公开披露声明');
  }else if(['currency','maturityMonths','rightsBasis'].some(k=>Object.hasOwn(r,k)))throw Error('非收益率字段不得混入期限或权限声明');
  return r;
 }
 if(type!=='policyEvidence'||!id(r.policyId))throw Error('需要政策研究身份');
 if(r.kind==='stage'){
  if(!fields(r,[...base,'policyId','stage','effectiveDate'])||!stages.includes(r.stage)||r.effectiveDate!==null&&!day(r.effectiveDate))throw Error('政策阶段及日期无效');
 }else if(r.kind==='hypothesis'){
  if(!fields(r,[...base,'policyId','metric','unit','methodVersion','prePeriods','targetPeriod','windowStart','deadlineAt','direction','minEffect','maxPreTrendGap','treated','control'])||
     !id(r.metric)||!str(r.unit)||!id(r.methodVersion)||!Array.isArray(r.prePeriods)||r.prePeriods.length!==2||!r.prePeriods.every(day)||
     !day(r.targetPeriod)||!day(r.windowStart)||!(r.prePeriods[0]<r.prePeriods[1]&&r.prePeriods[1]<r.windowStart&&r.windowStart<=r.targetPeriod)||
     !at(r.deadlineAt)||r.deadlineAt<=close(r.targetPeriod)||!['positive','negative'].includes(r.direction)||!num(r.minEffect)||r.minEffect<=0||!num(r.maxPreTrendGap)||r.maxPreTrendGap<0||
     !validGroup(r.treated)||!validGroup(r.control)||r.treated.some(c=>r.control.includes(c))||r.revision!==1)throw Error('事前假设需要固定指标、两段基线、期限、互斥样本和否证门槛；重登记须新ID');
 }else if(r.kind==='measurement'){
  if(!fields(r,[...base,'policyId','symbol','metric','unit','methodVersion','periodEnd','value'])||!code(r.symbol)||!id(r.metric)||!str(r.unit)||!id(r.methodVersion)||!day(r.periodEnd)||!num(r.value))throw Error('经营指标测量身份、期间或口径无效');
 }else if(r.kind==='shock'){
  if(!fields(r,[...base,'policyId','observedDate','scope'])||!day(r.observedDate)||!['common','treated-only','control-only','unknown'].includes(r.scope))throw Error('共同冲击声明无效');
 }else throw Error('未知政策证据种类');
 return r;
}
function newsIndex(rows,cutoff){
 const all=new Map(),latest=new Map();
 for(const row of list(rows).filter(r=>at(r?.recordedAt)&&r.recordedAt<=cutoff&&hash(r.eventHash)&&r.evidence).sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence)){
  all.set(row.eventHash,row);latest.set(JSON.stringify([row.evidence.source,row.evidence.eventId]),row);
 }
 return {all,latest};
}
function receipt(row,news,cutoff,precise){
 if(row.inputOrigin!=='explicit-private-import'||!hash(row.archiveHash)||!at(row.recordedAt)||row.recordedAt>cutoff)return null;
 const doc=news.all.get(row.newsRef),e=doc?.evidence;
 if(!e||e.source!==row.source||!e.url||!e.body||e.kind==='retracted'||doc.recordedAt>row.recordedAt||
    news.latest.get(JSON.stringify([e.source,e.eventId]))?.eventHash!==row.newsRef||!at(e.receivedAt)||e.receivedAt>doc.recordedAt)return null;
 const published=e.kind==='original'?e.publishedAt:e.revisedAt;
 if(precise&&(!at(published)||published>e.receivedAt))return null;
 return {newsRef:row.newsRef,archiveHash:row.archiveHash,source:e.source,url:e.url,bodyScope:e.bodyScope??null,
  sourcePublishedAt:at(published)?published:null,originalPublishedAt:at(e.publishedAt)?e.publishedAt:null,sourceReceivedAt:e.receivedAt,
  newsRecordedAt:doc.recordedAt,recordedAt:row.recordedAt,sourceRevisionId:e.sourceRevisionId??null,securities:list(e.securities)};
}
function cleanRows(input,type,cutoff,history=false){
 const groups=new Map();
 for(const r of list(input)){
  if(!at(r?.recordedAt)||r.recordedAt>cutoff||!id(r.id)||!id(r.source)||r.inputOrigin!=='explicit-private-import'||!hash(r.archiveHash))continue;
  const k=JSON.stringify([r.source,r.id]),g=groups.get(k)||[];g.push(r);groups.set(k,g);
 }
 const out=[];
 const raw=r=>Object.fromEntries(Object.keys(r).sort().filter(k=>!['recordedAt','firstKnownAt','declaredFirstKnownAt','declaredRecordedAt','inputOrigin','independentlyVerified','archiveHash','evidenceId'].includes(k)).map(k=>[k,r[k]]));
 const identityFor=r=>type==='macroEvidence'?['kind','metric','series','scope','methodVersion','unit','periodStart','periodEnd','maturityMonths','currency']:
  r.kind==='measurement'?['kind','policyId','symbol','metric','unit','methodVersion','periodEnd']:['kind','policyId'];
 for(const g of groups.values()){
  g.sort((a,b)=>a.revision-b.revision||a.recordedAt-b.recordedAt);
  const first=g[0],byRevision=new Map();let bad=false,previous=null;
  for(const r of g){
   try{validateDeclaration(type,raw(r));}catch{bad=true;break;}
   if(!identityFor(first).every(k=>Object.is(first[k],r[k]))){bad=true;break;}
   const old=byRevision.get(r.revision);
   if(old){if(JSON.stringify(raw(old))!==JSON.stringify(raw(r)))bad=true;continue;}
   if(previous&&r.recordedAt<previous.recordedAt){bad=true;break;}
   byRevision.set(r.revision,r);previous=r;
  }
  if(!bad){const ordered=[...byRevision.values()];out.push(...(history?ordered:ordered.slice(-1)));}
 }
 return out.sort((a,b)=>a.recordedAt-b.recordedAt||a.id.localeCompare(b.id)||a.revision-b.revision);
}
function select(input,type,news,cutoff,{precise=true}={}){
 const ix=newsIndex(news,cutoff);
 return cleanRows(input,type,cutoff).map(row=>({row,proof:receipt(row,ix,cutoff,precise)})).filter(x=>x.proof);
}
function unique(a){return a.length===1?a[0]:null;}
const same=(a,b,keys)=>keys.every(k=>a[k]===b[k]);
const identity=['metric','series','scope','methodVersion','unit'];
const monthIndex=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7))-1;
const wholeMonths=r=>r.periodStart.slice(8)==='01'&&new Date(dateKey(r.periodEnd)+86400000).getUTCDate()===1?monthIndex(r.periodEnd)-monthIndex(r.periodStart)+1:null;
function adjacentPeriods(a,b){
 if(dateKey(a.periodStart)-dateKey(b.periodEnd)!==86400000)return false;
 const m=wholeMonths(a),n=wholeMonths(b);
 return m!==null||n!==null?m!==null&&n!==null&&m===n:dateKey(a.periodEnd)-dateKey(a.periodStart)===dateKey(b.periodEnd)-dateKey(b.periodStart);
}
const actualAfterPeriod=(x,period=x.row.periodEnd)=>x.proof.sourcePublishedAt>=
 (['margin-balance','credit-yield','funding-yield'].includes(x.row.metric)?Date.parse(period+'T15:00:00+08:00'):close(period));
function visibleCount(input,cutoff){return list(input).filter(r=>at(r?.recordedAt)&&r.recordedAt<=cutoff).length;}
function macroStudy(input=[],news=[],{asOf,background}={}){
 const count=visibleCount(input,asOf);
 if(count>MAX_DECLARATIONS)return {status:'research-budget-exceeded',asOf,visibleDeclarations:count,limit:MAX_DECLARATIONS,changes:[],surprises:[],creditEconomicState:{status:'unknown',economicStateCertified:false},margin:{status:'unknown',rows:[],actualForcedLiquidationQuantity:null},creditSpread:{status:'unknown',rows:[],dataLicenseVerified:false},note:'原档案保留；超出本次有界研究范围，暂停整体比较，不以截断样本冒充完整数据。',...flags};
 const all=select(input,'macroEvidence',news,asOf);
 const data=all.filter(x=>x.row.kind==='actual'&&actualAfterPeriod(x));
 const comparable=data.filter(x=>['economic-growth','credit-growth','margin-balance'].includes(x.row.metric));
 const series=new Map();
 for(const x of comparable){const k=JSON.stringify([x.row.source,...identity.map(k=>x.row[k])]);const a=series.get(k)||[];a.push(x);series.set(k,a);}
 const changes=[...series.values()].map(g=>{
  const ends=[...new Set(g.map(x=>x.row.periodEnd))].sort(),last=unique(g.filter(x=>x.row.periodEnd===ends.at(-1))),prev=unique(g.filter(x=>x.row.periodEnd===ends.at(-2)));
  const compatible=!!last&&!!prev&&adjacentPeriods(last.row,prev.row);
  const delta=compatible?round(last.row.value-prev.row.value):null;
  return {metric:g[0].row.metric,series:g[0].row.series,scope:g[0].row.scope,source:g[0].row.source,methodVersion:g[0].row.methodVersion,unit:g[0].row.unit,
   currentPeriod:last?.row.periodEnd??ends.at(-1),previousPeriod:prev?.row.periodEnd??null,currentPeriodStart:last?.row.periodStart??null,
   currentValue:last?.row.value??null,previousValue:compatible?prev.row.value:null,delta,direction:delta===null?'unknown':delta>0?'increase':delta<0?'decrease':'unchanged',
   currentEvidence:last?.proof??null,previousEvidence:compatible?prev.proof:null,actualForcedLiquidationQuantity:null,externalValueVerified:false};
 });
 const pairs=[];
 for(const e of changes.filter(x=>x.metric==='economic-growth'))for(const c of changes.filter(x=>x.metric==='credit-growth')){
  if(e.scope!==c.scope||e.currentPeriod!==c.currentPeriod||e.previousPeriod!==c.previousPeriod||e.currentPeriodStart!==c.currentPeriodStart||e.direction==='unknown'||c.direction==='unknown')continue;
  pairs.push({scope:e.scope,currentPeriod:e.currentPeriod,economicDirection:e.direction,creditDirection:c.direction,classification:e.direction===c.direction?'same-direction-observations':'conflicting-directions',sources:[e.source,c.source]});
 }
 const scopeStates=new Set(pairs.map(x=>JSON.stringify([x.scope,x.currentPeriod,x.economicDirection,x.creditDirection])));
 const state={status:pairs.length===0?'unknown':scopeStates.size===1?'descriptive-joined-directions':'multiple-or-conflicting-observations',pairs: pairs.slice(0,100),
  economicStateCertified:false,regimePrediction:null,baseline:'adjacent-comparable-period-value-difference'};
 // Latest revisions are useful for descriptive series, never a substitute
 // for the original release's value in a pre-release surprise calculation.
 const history=cleanRows(input,'macroEvidence',asOf,true),newsNow=newsIndex(news,asOf),eligibleSurprises=data.filter(x=>['economic-growth','credit-growth'].includes(x.row.metric));
 const surprises=eligibleSurprises.slice(-MAX_SURPRISES).map(x=>{
  const first=x.proof.originalPublishedAt,cutoff=at(first)?first-1:null;
  const original=unique(history.filter(r=>r.kind==='actual'&&same(r,x.row,['source',...identity,'periodStart','periodEnd'])&&newsNow.all.get(r.newsRef)?.evidence.kind==='original').map(row=>{
   const proof=receipt(row,newsIndex(news,row.recordedAt),row.recordedAt,true);return {row,proof};
  }).filter(y=>y.proof&&y.proof.sourcePublishedAt===first&&actualAfterPeriod(y)));
  const e=cutoff===null?[]:select(input,'macroEvidence',news,cutoff).filter(y=>y.row.kind==='expectation'&&same(x.row,y.row,[...identity,'periodStart','periodEnd'])&&y.proof.sourcePublishedAt<first);
  const expectation=unique(e);
  const simultaneous=data.filter(y=>y!==x&&y.row.scope===x.row.scope&&y.proof.originalPublishedAt===first).map(y=>({metric:y.row.metric,series:y.row.series,newsRef:y.proof.newsRef}));
  return {metric:x.row.metric,series:x.row.series,scope:x.row.scope,periodEnd:x.row.periodEnd,actual:original?.row.value??null,unit:x.row.unit,actualEvidence:original?.proof??null,
   latestActualValue:x.row.value,latestActualEvidence:x.proof,originalReleaseAt:first??null,expectation:expectation?.row.value??null,expectationEvidence:expectation?.proof??null,
   surprise:expectation&&original?round(original.row.value-expectation.row.value):null,expectationStatus:!original?'missing-or-ambiguous-initial-release':expectation?'archived-declaration-unverified':e.length?'ambiguous':'missing-pre-release-evidence',
   jointlyReleased:simultaneous.slice(0,20),otherConcurrentShocks:null,causalAttribution:null,sourceValuesIndependentlyVerified:false};
 });
 // Do not merge unequal tenor, dates, currency or credit instrument definitions.
 const yields=data.filter(x=>['credit-yield','funding-yield'].includes(x.row.metric));
 const spreadGroups=new Map();
 for(const x of yields){
  const r=x.row,k=JSON.stringify([r.scope,r.maturityMonths,r.currency,r.methodVersion,r.periodEnd]);const g=spreadGroups.get(k)||[];g.push(x);spreadGroups.set(k,g);
 }
 const spreads=[];
 for(const g of spreadGroups.values()){
  const a=unique(g.filter(x=>x.row.metric==='credit-yield')),b=unique(g.filter(x=>x.row.metric==='funding-yield'));
  if(!a||!b)continue;
  const r=a.row;
  spreads.push({scope:r.scope,date:r.periodEnd,maturityMonths:r.maturityMonths,currency:r.currency,methodVersion:r.methodVersion,creditSeries:r.series,fundingSeries:b.row.series,
   creditSource:r.source,fundingSource:b.row.source,spreadBps:round((r.value-b.row.value)*100),creditYieldPct:r.value,fundingYieldPct:b.row.value,evidence:[a.proof,b.proof],licenseIndependentlyVerified:false});
 }
 const spreadSeries=new Map();
 for(const s of spreads){const k=JSON.stringify([s.scope,s.maturityMonths,s.currency,s.methodVersion,s.creditSeries,s.fundingSeries,s.creditSource,s.fundingSource]);const g=spreadSeries.get(k)||[];g.push(s);spreadSeries.set(k,g);}
 const stability=[...spreadSeries.values()].map(g=>{g.sort((a,b)=>a.date.localeCompare(b.date));const last=g.slice(-3),moves=last.slice(1).map((x,i)=>Math.sign(x.spreadBps-last[i].spreadBps));return {scope:g[0].scope,maturityMonths:g[0].maturityMonths,dates:last.map(x=>x.date),direction:last.length<3?null:moves.every(v=>v>0)?'widening':moves.every(v=>v<0)?'narrowing':moves.every(v=>v===0)?'unchanged':'mixed',consecutiveSessionsVerified:false};});
 return {status:all.length?'declared-source-linked':'unknown',asOf,visibleDeclarations:count,visibleBoundRecords:all.length,changes:changes.slice(0,100),changeTotal:changes.length,creditEconomicState:state,
  surprises,surpriseTotal:eligibleSurprises.length,surpriseOmitted:Math.max(0,eligibleSurprises.length-surprises.length),margin:{status:changes.some(x=>x.metric==='margin-balance')?'disclosed-balance-research':'unknown',rows:changes.filter(x=>x.metric==='margin-balance'),actualForcedLiquidationQuantity:null},
  creditSpread:{status:spreads.length?'declared-paired-yields':'awaiting-lawful-compatible-samples',rows:spreads.slice(-100),stability:stability.slice(0,100),dataLicenseVerified:false,actualFundingStress:null},
  annualBackground:{source:'original-background-overview',status:background?.status??'unknown',worldBankReceipts:list(background?.rows).filter(r=>r.provider==='worldbank').map(r=>({archiveHash:r.archiveHash,scope:r.scope,availableAt:r.availableAt,sourcePublishedAt:null,pointInTimeReady:false}))},
  note:'仅使用原私有存证与明确引用的公开披露声明；数字映射、数据许可及独立真实性尚未认证。World Bank年度观察不补作事前发布、实时融资或信用数据。',...flags};
}
function policyStudy(input=[],news=[],eventStudy,{asOf}={}){
 const count=visibleCount(input,asOf);
 if(count>MAX_DECLARATIONS)return {status:'research-budget-exceeded',asOf,visibleDeclarations:count,limit:MAX_DECLARATIONS,stages:[],hypotheses:[],strategyPriceStudies:[],strategyNetValue:null,causalEffect:null,missing:['原档案保留；本次研究预算不足，不以截断样本冒充完整对照'],...flags};
 const current=select(input,'policyEvidence',news,asOf,{precise:false}),stageRows=current.filter(x=>x.row.kind==='stage');
 const stagesView=cleanRows(input,'policyEvidence',asOf,true).filter(r=>r.kind==='stage').map(r=>{
  const original=newsIndex(news,r.recordedAt),then=receipt(r,original,r.recordedAt,false),active=stageRows.find(x=>x.row===r||x.row.archiveHash===r.archiveHash&&x.row.id===r.id);
  return {policyId:r.policyId,id:r.id,stage:r.stage,effectiveDate:r.effectiveDate,declaredAt:r.recordedAt,evidence:then,status:active?'current-declaration':then?'superseded-or-withdrawn-source':'unbound',actualDisbursement:null,actualEconomicEffect:null};
 });
 // Hypotheses are immutable per source/id. Require the exact source document
 // and an original declared policy stage already visible before registration.
 const hypotheses=cleanRows(input,'policyEvidence',asOf).filter(r=>r.kind==='hypothesis');
 const rows=hypotheses.slice(-MAX_HYPOTHESES).map(h=>{
  const before=select(input,'policyEvidence',news,h.recordedAt,{precise:false}),anchor=before.find(x=>x.row.kind==='stage'&&x.row.policyId===h.policyId&&x.row.newsRef===h.newsRef&&['announced','effective-reported'].includes(x.row.stage));
  const base={id:h.id,policyId:h.policyId,metric:h.metric,unit:h.unit,methodVersion:h.methodVersion,registeredAt:h.recordedAt,registrationRef:h.archiveHash,windowStart:h.windowStart,targetPeriod:h.targetPeriod,deadlineAt:h.deadlineAt,
   stageAnchor:anchor?.proof??null,treated:h.treated,control:h.control,prePeriods:h.prePeriods,expectedDirection:h.direction,minEffect:h.minEffect,maxPreTrendGap:h.maxPreTrendGap,
   status:'pending',missing:[],operatingOutcome:null,preTrendDiagnostic:null,stability:null,commonShockEvidence:[],causalEffect:null,realizedTradingNetReturn:null};
  const delayed=stageRows.some(x=>x.row.policyId===h.policyId&&['delayed','withdrawn'].includes(x.row.stage)&&x.proof.recordedAt>=h.recordedAt);
  if(!anchor||delayed||h.recordedAt>=Date.parse(h.windowStart+'T00:00:00+08:00')||!current.some(x=>x.row.kind==='stage'&&x.row.policyId===h.policyId&&x.row.newsRef===h.newsRef)){
   return {...base,status:'invalid-or-withdrawn-anchor',missing:['事前窗口或原政策存证缺失、已撤回或无法复核']};
  }
  const cutoff=Math.min(asOf,h.deadlineAt);
  const measurementsAt=t=>select(input,'policyEvidence',news,t).filter(x=>x.row.kind==='measurement'&&x.row.policyId===h.policyId&&same(x.row,h,['metric','unit','methodVersion'])&&x.proof.securities.includes(x.row.symbol)&&x.proof.sourcePublishedAt>=close(x.row.periodEnd));
  const pre=measurementsAt(h.recordedAt),post=measurementsAt(cutoff);
  const currentMeasurements=measurementsAt(asOf);
  const symbols=[...h.treated,...h.control],observations=symbols.map(symbol=>{
   const entries=[...h.prePeriods,h.targetPeriod].map((period,i)=>unique((i<2?pre:post).filter(x=>x.row.symbol===symbol&&x.row.periodEnd===period)));
   // Later source withdrawal or conflicting revision does not silently preserve
   // an apparently complete current result. Earlier as-of reads stay unchanged.
   const consistent=entries.every(x=>x&&currentMeasurements.some(y=>y.proof.newsRef===x.proof.newsRef&&y.row.symbol===x.row.symbol&&y.row.periodEnd===x.row.periodEnd&&y.row.value===x.row.value));
   return {symbol,group:h.treated.includes(symbol)?'treated':'control',complete:consistent,values:consistent?entries.map(x=>x.row.value):null,proof:consistent?entries.map(x=>x.proof):[]};
  });
  const shocks=current.filter(x=>x.row.kind==='shock'&&x.row.policyId===h.policyId&&x.row.observedDate>=h.windowStart&&x.row.observedDate<=h.targetPeriod).map(x=>({date:x.row.observedDate,scope:x.row.scope,evidence:x.proof}));
  const report={...base,observations,completeSymbols:observations.filter(x=>x.complete).length,expectedSymbols:symbols.length,commonShockEvidence:shocks,commonShocksExhaustiveVerified:false};
  if(asOf<close(h.targetPeriod)||observations.some(x=>!x.complete))return {...report,status:asOf>h.deadlineAt?'expired-incomplete':'pending',missing:['原固定观察窗未成熟或经营样本/版本覆盖不全']};
  const t=observations.filter(x=>x.group==='treated'),c=observations.filter(x=>x.group==='control');
  const diff=(a,b,from,to)=>mean(a.map(x=>x.values[to]-x.values[from]))-mean(b.map(x=>x.values[to]-x.values[from]));
  const preTrend=diff(t,c,0,1),effect=diff(t,c,1,2),sign=h.direction==='positive'?1:-1;
  const leave=[...t.map((_,i)=>diff(t.filter((__,j)=>i!==j),c,1,2)),...c.map((_,i)=>diff(t,c.filter((__,j)=>i!==j),1,2))];
  const stable=leave.every(v=>v*sign>=h.minEffect),prePass=Math.abs(preTrend)<=h.maxPreTrendGap;
  return {...report,status:'descriptive-matured',operatingOutcome:{differenceInDifferences:round(effect),directionThresholdMet:effect*sign>=h.minEffect,unit:h.unit,registeredTargetPeriod:h.targetPeriod},
   preTrendDiagnostic:{difference:round(preTrend),threshold:h.maxPreTrendGap,withinDeclaredTolerance:prePass,parallelTrendsCertified:false},
   stability:{leaveOneOutCount:leave.length,min:round(Math.min(...leave)),max:round(Math.max(...leave)),allMeetDeclaredEffect:stable},
   interpretation:!prePass?'pre-trend-diagnostic-failed':effect*sign<h.minEffect?'registered-effect-not-observed':!stable?'sensitive-to-sample':shocks.length?'concurrent-shock-confounding':'descriptive-only',causalEffect:null};
 });
 const eventRows=list(eventStudy?.rows).flatMap(r=>{const matched=stageRows.filter(x=>r.evidence?.[0]?.evidenceId===x.row.newsRef);return matched.map(x=>({policyId:x.row.policyId,newsRef:x.row.newsRef,symbol:r.symbol,horizonSessions:r.horizonSessions,startAt:r.startAt,endAt:r.endAt,grossPriceReturnPct:r.stockReturnPct,benchmarkExcessPct:r.excessReturnPct,netExecutableReturnPct:null,actualExecutionVerified:false}));});
 return {status:current.length?'declared-source-linked':'unknown',asOf,visibleDeclarations:count,stages:stagesView.slice(-100),stageHistoryTotal:stagesView.length,hypotheses:rows,hypothesisTotal:hypotheses.length,hypothesisOmitted:Math.max(0,hypotheses.length-rows.length),
  strategyPriceStudies:eventRows.slice(-100),strategyNetValue:null,causalEffect:null,missing:['实际拨付、经营传导及可成交成本后策略价值必须由各自原成熟证据独立核验；本报告不填补缺失数据'],...flags};
}
module.exports={validateDeclaration,macroStudy,policyStudy};
