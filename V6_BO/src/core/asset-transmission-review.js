'use strict';
// Existing private research journal only. Source/licence declarations are not
// independently certified. No fetching, trading, notifications or account writes.
const {sessionMinute,PRIOR_DAYS}=require('./index-window-research').sameMinuteResearchPolicy;
const {reviewConditionalMarkets}=require('./conditional-market-research');
const {reviewFoundationReadiness}=require('./conditional-model-research');
const MIN=60000,MAX=500,WIDTH=5;
const flags={researchOnly:true,canTrade:false,canNotify:false,independentlyVerified:false,independentValueVerified:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x),pos=x=>finite(x)&&x>0;
const time=x=>Number.isSafeInteger(x)&&x>=946684800000&&x<4102444800000;
const id=x=>typeof x==='string'&&/^[\w.:-]{1,120}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const round=x=>finite(x)?+x.toFixed(8):null;
const fake=x=>/(?:^|[-_:/\.\s])(?:mock|synthetic|fixture|test|demo|simulated)(?:$|[-_:/\.\s])/i.test(String(x?.source??''))||['synthetic','fixture','simulated','mock','conflict','sourceConflict','quoteSourceConflict'].some(k=>x?.[k]===true)||['test','demo','synthetic'].includes(x?.sampleSet);
const evidence=r=>({id:r.id,source:r.source,revision:r.revision,archiveHash:r.archiveHash,recordedAt:r.recordedAt});
const key=(...a)=>JSON.stringify(a);
const median=a=>{const b=[...a].sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length%2?b[i]:b[i-1]/2+b[i]/2;};
function visible(records,asOf){
 const rows=new Map(),bad=new Set();
 for(const r of records){if(time(r?.recordedAt)&&r.recordedAt>asOf)continue;
  if(!id(r?.id)||!id(r?.source))continue;const k=key(r.source,r.id);
  if(!id(r.kind)||!Number.isSafeInteger(r.revision)||r.revision<1||r.inputOrigin!=='explicit-private-import'||r.independentlyVerified!==false||!hash(r.archiveHash)||!time(r.publishedAt)||!time(r.recordedAt)||r.firstKnownAt!==r.recordedAt||r.publishedAt>r.recordedAt||fake(r)){bad.add(k);continue;}
  const old=rows.get(k);if(old&&(r.revision===old.revision||r.revision>old.revision&&r.recordedAt<old.recordedAt||r.revision<old.revision&&r.recordedAt>old.recordedAt)){bad.add(k);continue;}
  if(!old||r.revision>old.revision)rows.set(k,r);
 }
 return [...rows].filter(([k,r])=>!bad.has(k)&&r.retracted!==true).map(([,r])=>r);
}
function interval(r,a,b){return time(a)&&time(b)&&a<b&&r.publishedAt<=r.recordedAt&&b<=r.recordedAt&&r.recordedAt-b<=15000&&r.publishedAt>=b&&r.publishedAt<=r.recordedAt;}
function metadata(rows,r,kind,a,b){
 const found=rows.filter(m=>m.kind===kind&&m.id===r.profileId&&m.source===r.profileSource&&m.recordedAt<=a&&time(m.validFrom)&&time(m.validUntil)&&m.validFrom<=a&&m.validUntil>=b);
 return found.length===1?found[0]:null;
}
function licensed(r,a,b,scope){const g=r.authorization;return g?.status==='granted'&&g.provider===r.source&&g.scope===scope&&id(g.evidenceId)&&time(g.validFrom)&&time(g.validUntil)&&g.validFrom<=a&&g.validUntil>=b;}
function quote(q,identity,at,ccy,source){return q&&q.code===identity&&q.source===source&&q.currency===ccy&&q.quoteAt===at&&time(q.receivedAt)&&q.receivedAt>=at&&q.receivedAt-at<=15000&&q.suspended===false&&q.sessionOpen===true&&q.priceBasis==='unadjusted'&&q.corporateAction===false&&!fake(q)&&pos(q.price);}
function pair(s,identity,a,b,ccy,source,recordedAt){if(!s||!quote(s.start,identity,a,ccy,source)||!quote(s.end,identity,b,ccy,source)||s.start.receivedAt>recordedAt||s.end.receivedAt>recordedAt)return null;const change=100*(s.end.price/s.start.price-1);return finite(change)?change:null;}
function calendarAt(cal,a){return cal?.status==='available'&&hash(cal.metadata?.sha256)&&time(Date.parse(cal.metadata.knowledgeAvailableAt))&&Date.parse(cal.metadata.knowledgeAvailableAt)<=a&&['SSE','SZSE'].every(x=>cal.metadata.supportedExchanges?.includes(x))&&Array.isArray(cal.tradeDates)&&cal.tradeDates.length<=1000&&cal.tradeDates.every((d,i)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&(!i||d>cal.tradeDates[i-1]));}
function fundWindow(r,rows){
 const p=r.points;if(!Array.isArray(p)||p.length!==WIDTH+1)return null;
 const a=p[0]?.quoteAt,b=p.at(-1)?.quoteAt;if(!interval(r,a,b)||!licensed(r,a,b,'etf-minute')||day(a)!==day(b)||r.unit!=='CNY'||r.amountBasis!=='cumulative-traded-amount'||typeof r.rebalanceDay!=='boolean')return null;
 const m=metadata(rows,r,'fund-profile',a,b),slot=sessionMinute(a);
 if(!m||!id(m.fund)||m.fund!==r.fund||!['broad','industry'].includes(m.class)||!id(m.exchange)||!['SSE','SZSE'].includes(m.exchange)||slot===null)return null;
 for(let i=0;i<p.length;i++){const q=p[i];if(!q||!time(q.quoteAt)||q.quoteAt!==a+i*MIN||q.quoteAt%MIN>=10000||sessionMinute(q.quoteAt)!==slot+i||q.source!==r.source||q.code!==m.fund||q.currency!=='CNY'||q.suspended!==false||q.sessionOpen!==true||fake(q)||!time(q.receivedAt)||q.receivedAt<q.quoteAt||q.receivedAt-q.quoteAt>15000||q.receivedAt>r.recordedAt||!finite(q.amount)||q.amount<0||i&&q.amount<p[i-1].amount)return null;}
 return {r,m,a,b,slot,date:day(a),amount:p.at(-1).amount-p[0].amount,excluded:r.rebalanceDay||slot<585||slot>=780&&slot<785||slot+WIDTH>=885};
}
function commodity(r,rows){
 const {startAt:a,endAt:b}=r,m=metadata(rows,r,'commodity-profile',a,b);
 if(!interval(r,a,b)||!licensed(r,a,b,'commodity-contract')||!m||!id(m.contract)||!id(m.company)||!id(m.commodity)||!id(m.unit)||!pos(m.multiplier)||!['USD','CNY'].includes(m.currency)||!time(m.expiryAt)||b>=m.expiryAt||m.rollState!=='unchanged-contract'||!finite(m.costExposureFraction)||m.costExposureFraction<=0||m.costExposureFraction>1||!['cost-input','output-revenue'].includes(m.exposureKind)||!id(m.exposureEvidenceId)||r.contract!==m.contract||r.unit!==m.unit||r.multiplier!==m.multiplier)return null;
 const c=pair(r.contractPrices,m.contract,a,b,m.currency,r.source,r.recordedAt),s=pair(r.companyPrices,m.company,a,b,'CNY',r.source,r.recordedAt);
 if(c===null||s===null)return null;
 return {commodity:m.commodity,contract:m.contract,unit:m.unit,multiplier:m.multiplier,company:m.company,contractCurrency:m.currency,currencyConversionVerified:false,exposureKind:m.exposureKind,costExposureFraction:m.costExposureFraction,commodityReturnPct:round(c),companyReturnPct:round(s),directionAgreement:c===0||s===0?null:Math.sign(c)*(m.exposureKind==='cost-input'?-1:1)===Math.sign(s),causalityVerified:false,evidence:[evidence(m),evidence(r)]};
}
function ah(r,rows){
 const a=r.at,m=metadata(rows,r,'ah-profile',a,a+1);
 if(!time(a)||r.publishedAt<a||r.recordedAt-a>15000||!licensed(r,a,a,'ah-synchronized')||!m||!id(m.issuer)||!/^\d{6}$/.test(m.aCode)||!/^\d{5}$/.test(m.hCode)||m.sameShareRights!==true||m.aSharesPerHShare!==1||sessionMinute(a)===null||r.hkSessionOpen!==true||r.cnSessionOpen!==true)return null;
 const A=r.aQuote,H=r.hQuote,F=r.fx;
 if(!quote(A,m.aCode,a,'CNY',r.source)||!quote(H,m.hCode,a,'HKD',r.source)||!F||F.base!=='HKD'||F.quote!=='CNY'||F.quoteAt!==a||F.precision!=='instant'||F.source!==r.source||!time(F.receivedAt)||F.receivedAt<a||F.receivedAt-a>15000||!pos(F.rate)||fake(F)||[A,H,F].some(q=>q.receivedAt>r.recordedAt))return null;
 const hCny=H.price*F.rate,premium=(A.price/hCny-1)*100;if(!pos(hCny)||!finite(premium))return null;
 return {issuer:m.issuer,aCode:m.aCode,hCode:m.hCode,quoteAt:a,aPriceCny:A.price,hPriceHkd:H.price,hkdToCny:F.rate,hPriceCny:round(hCny),aPremiumPct:round(premium),arbitrageVerified:false,evidence:[evidence(m),evidence(r)]};
}
function industry(r,rows){
 const {startAt:a,endAt:b}=r,m=metadata(rows,r,'industry-profile',a,b);
 if(!interval(r,a,b)||!licensed(r,a,b,'industry-etf')||!m||!id(m.fund)||!id(m.index)||m.basketComplete!==true||!Array.isArray(m.weights)||!m.weights.length||m.weights.length>500||!m.weights.every(w=>id(w?.code)&&pos(w.weight)&&w.weight<=1)||new Set(m.weights.map(w=>w.code)).size!==m.weights.length||Math.abs(m.weights.reduce((n,w)=>n+w.weight,0)-1)>1e-8||!Array.isArray(r.components)||r.components.length!==m.weights.length||new Set(r.components.map(x=>x?.code)).size!==r.components.length)return null;
 const fund=pair(r.fundPrices,m.fund,a,b,'CNY',r.source,r.recordedAt),index=pair(r.indexPrices,m.index,a,b,'CNY',r.source,r.recordedAt);if(fund===null||index===null)return null;
 const byCode=new Map(r.components.map(x=>[x.code,x.prices]));let basket=0;
 for(const w of m.weights){const change=pair(byCode.get(w.code),w.code,a,b,'CNY',r.source,r.recordedAt);if(change===null)return null;basket+=w.weight*change;}
 if(![basket,fund-index,basket-index].every(finite))return null;
 return {fund:m.fund,industryIndex:m.index,memberCount:m.weights.length,weightSum:1,fundReturnPct:round(fund),weightedPriceReturnPct:round(basket),indexReturnPct:round(index),fundMinusIndexPct:round(fund-index),basketMinusIndexPct:round(basket-index),trackingErrorVerified:false,evidence:[evidence(m),evidence(r)]};
}
function reviewAssetTransmission(records,{asOf,calendar,background,forecastEvaluation}={}){
 const report=(task,title)=>({task,title,status:'unknown',attempted:0,computed:0,rows:[],rejected:0,...flags});
 const reports={F022:report('F02.2','ETF同分钟成交异常'),F083:report('F08.3','商品合约与企业敞口'),F085:report('F08.5','A/H同步相对价格'),F171:report('F17.1','行业ETF与冻结权重'),F172:report('F17.2','宽基与行业ETF成交分化')};
 const result={mode:'existing-private-asset-transmission-v1',...flags,reports,officialEtfBackground:Array.isArray(background?.rows)&&background.rows.some(r=>r?.provider==='szse-fund'&&r.status==='verified-latest-receipt')?'monthly-receipt-only':'not-observed',monthlyOrDailySubstitutesForMinutes:false,sourcePermissionCertified:false};
 if(!time(asOf)||!Array.isArray(records)||records.length>MAX)return {...result,status:'unavailable-input-budget-or-clock'};
 const rows=visible(records,asOf),windows=new Map();
 result.conditionalMarkets=reviewConditionalMarkets(rows,{asOf,calendar});
 result.foundationModel=reviewFoundationReadiness(rows,{asOf,forecastEvaluation});
 for(const r of rows){if(r.kind==='etf-window'){const w=fundWindow(r,rows);const a=r.points?.[0]?.quoteAt;const k=time(a)&&id(r.fund)&&sessionMinute(a)!==null?key(r.fund,day(a),sessionMinute(a)):null;reports.F022.attempted++;if(!k){reports.F022.rejected++;continue;}windows.set(k,windows.has(k)?null:w);continue;}
  const defs={ 'commodity-window':['F083',commodity], 'ah-snapshot':['F085',ah], 'industry-window':['F171',industry]};if(!Object.hasOwn(defs,r.kind))continue;const def=defs[r.kind];
  const a=r.kind==='ah-snapshot'?r.at:r.startAt,b=r.kind==='ah-snapshot'?r.at:r.endAt;
  const out=reports[def[0]];out.attempted++;const eligible=time(a)&&time(b)&&day(a)===day(b)&&sessionMinute(a)!==null&&sessionMinute(b)!==null&&(sessionMinute(a)<690)===(sessionMinute(b)<690)&&calendarAt(calendar,a)&&calendar.tradeDates.includes(day(a));
  const v=eligible?def[1](r,rows):null;if(v)out.rows.push(v);else out.rejected++;
 }
 const valid=[...windows.values()].filter(Boolean);for(const w of windows.values()){
  const out=reports.F022;if(!w){continue;}
  const base={fund:w.m.fund,date:w.date,minute:w.slot,amountCny:w.amount,referenceDays:0,baselineMedian:null,abnormal:null,evidence:evidence(w.r)};
  if(w.excluded){out.rows.push({...base,status:'excluded-open-close-or-rebalance'});continue;}
  const idx=calendarAt(calendar,w.a)?calendar.tradeDates.indexOf(w.date):-1,dates=idx>=PRIOR_DAYS?calendar.tradeDates.slice(idx-PRIOR_DAYS,idx):[];
  const refs=dates.map(d=>windows.get(key(w.m.fund,d,w.slot))).filter(x=>x&&!x.excluded&&x.r.source===w.r.source&&x.m.archiveHash===w.m.archiveHash&&x.a%MIN===w.a%MIN&&x.r.recordedAt<w.a);
  const med=refs.length===PRIOR_DAYS?median(refs.map(x=>x.amount)):null;
  out.rows.push({...base,referenceDays:refs.length,baselineMedian:med,status:pos(med)?'descriptive-same-minute':'insufficient-comparable-history',abnormal:pos(med)?w.amount>3*med&&w.amount>Math.max(...refs.map(x=>x.amount)):null,referenceEvidence:refs.map(x=>evidence(x.r)),netSubscription:null});
 }
 const cohorts=new Map();for(const w of valid){if(w.excluded||!calendarAt(calendar,w.a)||!calendar.tradeDates.includes(w.date))continue;const k=key(w.r.source,w.a,w.b),g=cohorts.get(k)||[];g.push(w);cohorts.set(k,g);}
 for(const g of cohorts.values()){
  const out=reports.F172;out.attempted++;const broad=g.filter(x=>x.m.class==='broad'),ind=g.filter(x=>x.m.class==='industry');
  if(!broad.length||!ind.length){out.rejected++;continue;}
  const totals=a=>a.reduce((n,x)=>n+x.amount,0),b=totals(broad),i=totals(ind);if(!finite(b)||!finite(i)||!pos(b+i)){out.rejected++;continue;}
  // Count and amount are descriptive only: the samples need not cover all ETFs.
  const shares=g.map(w=>{const idx=calendar.tradeDates.indexOf(w.date),prior=calendar.tradeDates[idx-1];const find=d=>rows.filter(r=>r.kind==='fund-shares'&&r.fund===w.m.fund&&r.source===w.r.source&&r.effectiveDate===d&&r.unit==='fund-shares'&&r.recordedAt<=w.b&&r.publishedAt<=w.b&&Number.isSafeInteger(r.shares)&&r.shares>0&&licensed(r,r.publishedAt,r.recordedAt,'fund-shares'));const a=prior?find(prior):[],z=find(w.date);return {fund:w.m.fund,shareChange:a.length===1&&z.length===1&&z[0].recordedAt>=Date.parse(w.date+'T00:00:00+08:00')&&a[0].recordedAt>=Date.parse(prior+'T00:00:00+08:00')?z[0].shares-a[0].shares:null,netSubscription:null};});
  out.rows.push({source:g[0].r.source,startAt:g[0].a,endAt:g[0].b,broadFunds:broad.length,industryFunds:ind.length,broadAmountCny:b,industryAmountCny:i,industryAmountShare:round(i/(b+i)),shares,fullFundUniverseVerified:false,netSubscription:null,evidence:g.map(w=>evidence(w.r))});
 }
 reports.F022.rejected=reports.F022.attempted-reports.F022.rows.length;
 for(const out of Object.values(reports)){out.computed=out.rows.filter(r=>out.task!=='F02.2'||r.status==='descriptive-same-minute').length;out.status=out.computed?'observed-research':'unknown';out.truncated=out.rows.length>30;out.rows.sort((a,b)=>(b.endAt??b.quoteAt??b.evidence?.recordedAt??0)-(a.endAt??a.quoteAt??a.evidence?.recordedAt??0));out.rows=out.rows.slice(0,30);}
 return {...result,status:'read-only-research'};
}
module.exports={reviewAssetTransmission};
