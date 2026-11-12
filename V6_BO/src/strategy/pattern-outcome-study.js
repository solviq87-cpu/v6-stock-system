'use strict';
// Historical conditional frequencies only. No weights, production scores or orders.
const {detectPatterns}=require('./a-share-patterns');
const {validateHistoricalBars}=require('./feed-quality');
const MAX_BARS=500,MAX_PREFIX=60; // detectPatterns currently needs at most 50 bars.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const stamp=x=>{const t=typeof x==='number'?x:typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&day(x.slice(0,10))&&+x.slice(11,13)<24&&+x.slice(14,16)<60&&+x.slice(17,19)<60?Date.parse(x):NaN;return Number.isSafeInteger(t)&&t>0&&t<8640000000000000?t:NaN;};
const at=(date,time)=>Date.parse(date+'T'+time+'+08:00');
function interval(wins,n){
 if(!n)return null;
 const z=1.95996398454,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [Math.max(0,c-r),Math.min(1,c+r)];
}
function summarize(samples,minSamples,direction=false){
 const n=samples.length,wins=samples.filter(s=>s.y===1).length,ready=n>=minSamples;
 return {status:ready?'historical-association':'insufficient-samples',probability:ready?wins/n:null,
  samples:n,wins,confidenceInterval:ready?interval(wins,n):null,confidenceLevel:.95,
  ...(direction?{losses:samples.filter(s=>s.change<0).length,flat:samples.filter(s=>s.change===0).length,
   downProbability:ready?samples.filter(s=>s.change<0).length/n:null}:{}),
  firstSignalDate:samples[0]?.signalDate||null,lastSignalDate:samples.at(-1)?.signalDate||null,
  trainedThrough:samples.at(-1)?.targetDate||null,method:'historical-conditional-frequency',prospective:false};
}
function limitLabel(bar,previous,basis){
 const known=stamp(bar.limitKnownAt),open=at(bar.date,'09:30:00');
 if(basis!=='unadjusted'||bar.noPriceLimit!==false||!finite(known)||known>open||
  !finite(bar.limitUpPrice)||!finite(bar.limitReferencePrice)||bar.limitReferencePrice<=0||
  bar.limitUpPrice<=bar.limitReferencePrice||bar.limitUpPrice/bar.limitReferencePrice>1.5||
  Math.abs(previous.close-bar.limitReferencePrice)>.011||bar.high>bar.limitUpPrice+.011)return null;
 return Math.round(bar.close*100)===Math.round(bar.limitUpPrice*100)?1:0;
}
function historicalBoard(window,basis){
 // Never copy current stock.market/isST into an older formation. This special
 // pattern is available only with explicit pre-open metadata on all three bars.
 const rows=window.slice(-3);
 if(basis!=='unadjusted'||rows.length!==3||rows.some(b=>b.market!=='main'||b.limitPct!==10||
  b.isST!==false||b.noPriceLimit!==false||b.ipoNoLimit!==false||
  !finite(stamp(b.statusKnownAt))||stamp(b.statusKnownAt)>at(b.date,'09:30:00')||
  !finite(stamp(b.limitKnownAt))||stamp(b.limitKnownAt)>at(b.date,'09:30:00')||
  !finite(b.limitUpPrice)||!finite(b.limitReferencePrice)))return {};
 return {market:'main',limitPct:10,isST:false,noPriceLimit:false,ipoNoLimit:false};
}

function studyPatternOutcomes(stock,{asOf=Date.now(),tradeDates,minSamples=20}={}){
 if(!Number.isSafeInteger(asOf)||asOf<=0||asOf>Date.now()||!Number.isSafeInteger(minSamples)||minSamples<20||minSamples>200)throw Error('研究时点或样本门槛无效');
 if(!stock||!/^\d{6}$/.test(String(stock.symbol||stock.code||''))||!Array.isArray(stock.bars)||stock.bars.length>MAX_BARS)throw Error('股票代码或历史数量无效');
 if(!Array.isArray(tradeDates)||tradeDates.length<2||tradeDates.length>1000||tradeDates.some((d,i)=>!day(d)||(i>0&&d<=tradeDates[i-1])))throw Error('需要明确递增且无重复的交易日历');
 const indices=new Map(tradeDates.map((d,i)=>[d,i])),bars=stock.bars;
 if(bars.length&&(!validateHistoricalBars(bars,{requireDates:true}).usable||bars.some(b=>!indices.has(b.date))))throw Error('历史OHLCV或日期无效');
 if(bars.some(b=>b.priceBasis!==undefined&&b.priceBasis!==stock.priceBasis||b.source!==undefined&&b.source!==stock.source||b.provider!==undefined&&b.provider!==(stock.provider||stock.source)))throw Error('历史价格口径或来源不一致');
 const observedAt=stamp(stock.observedAt),hasSource=typeof stock.source==='string'&&stock.source.trim(),hasBasis=typeof stock.priceBasis==='string'&&stock.priceBasis.trim();
 const usableProvenance=!!hasSource&&!!hasBasis&&finite(observedAt)&&observedAt<=asOf;
 const metadata=bars.map(b=>({knownAt:stamp(b.knownAt),closeAt:at(b.date,'15:00:00'),
  statusAt:stamp(b.statusKnownAt),index:indices.get(b.date)}));
 const available=(i,cut)=>{
  const b=bars[i],m=metadata[i];
  return usableProvenance&&m.closeAt<=cut&&finite(m.knownAt)&&m.knownAt>=m.closeAt&&m.knownAt<=Math.min(cut,observedAt)&&
   finite(m.statusAt)&&m.statusAt<=m.closeAt&&b.suspended===false&&b.tradable===true&&b.isST===false&&b.corporateAction===false&&b.volume>0;
 };
 const patterns=new Map(),detected=new Map();
 let usableFormations=0,closedKnown=0,lastClosed=-1;
 for(let i=0;i<bars.length;i++){
  const m=metadata[i];
  if(m.closeAt<=asOf&&finite(m.knownAt)&&m.knownAt>=m.closeAt&&m.knownAt<=asOf){lastClosed=i;closedKnown++;}
  const cut=Math.min(asOf,at(bars[i].date,'23:59:59.999'));
  if(!available(i,cut))continue;
  let start=i;
  while(start>0&&i-start+1<MAX_PREFIX&&metadata[start-1].index===metadata[start].index-1&&available(start-1,cut))start--;
  const window=bars.slice(start,i+1);
  if(window.length<3)continue;
  const result=detectPatterns({symbol:String(stock.symbol||stock.code),bars:window,...historicalBoard(window,stock.priceBasis)});
  if(!result.usable)continue;
  detected.set(i,result);usableFormations++;
  for(const check of result.checks){
   if(check.requiredBars>MAX_PREFIX)continue;
   const row=patterns.get(check.id)||{id:check.id,label:check.label,side:check.side,requiredBars:check.requiredBars,
    directionSamples:[],limitSamples:[],matchedFormations:0};
   patterns.set(check.id,row);
   if(check.status!=='matched')continue;
   row.matchedFormations++;
   const next=bars[i+1];
   if(!next||metadata[i+1].index!==m.index+1||!available(i+1,asOf))continue;
   const sample={signalDate:bars[i].date,targetDate:next.date,knownAt:metadata[i+1].knownAt,change:next.close-bars[i].close};
   row.directionSamples.push({...sample,y:sample.change>0?1:0});
   const y=limitLabel(next,bars[i],stock.priceBasis);
   if(y!==null)row.limitSamples.push({...sample,y});
  }
 }
 const current=detected.get(lastClosed),currentChecks=new Map((current?.checks||[]).map(c=>[c.id,c]));
 const rows=[...patterns.values()].map(row=>{
  const check=currentChecks.get(row.id);
  return {id:row.id,label:row.label,side:row.side,requiredBars:row.requiredBars,
   currentlyMatched:!check||check.status==='insufficient_data'?null:check.status==='matched',
   currentStatus:check?.status||'insufficient_data',matchedFormations:row.matchedFormations,
   direction:summarize(row.directionSamples,minSamples,true),limitUp:summarize(row.limitSamples,minSamples),
   canTrade:false,prospective:false};
 });
 return {schemaVersion:1,status:rows.some(p=>p.direction.samples>=minSamples||p.limitUp.samples>=minSamples)?'historical-association':'insufficient-evidence',
  symbol:String(stock.symbol||stock.code),asOf,source:hasSource?stock.source:null,priceBasis:hasBasis?stock.priceBasis:null,
  currentDate:lastClosed>=0?bars[lastClosed].date:null,minSamples,patterns:rows,
  coverage:{provided:bars.length,closedKnown,usableFormations,causalSourceAvailable:usableProvenance,maxPrefixBars:MAX_PREFIX},
  canTrade:false,canNotify:false,verifiedLive:false,prospective:false,weightsChanged:false,
  limitations:['同股已确认形态与下一明确交易日结果的历史条件关联，不证明因果、收益或实盘预测能力',
   '同股和重叠形态样本相关；Wilson区间未作多重比较或独立样本认证',
   'direction.probability是收盘上涨频率；下跌和平盘另列，不是看跌形态的成功率',
   '涨停标签须未复权价格、预先已知涨停价及参考价；无涨跌幅限制或缺少元数据时保持未知',
   '当前股票分类、市场情绪与资金不回填旧样本；主板专属形态需要逐日预开盘分类证据',
   '仅纳入明确可交易、非ST、无公司行动且完整可得的连续窗口；不改变正式策略评分或权重']};
}
module.exports={studyPatternOutcomes};
