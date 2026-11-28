'use strict';
// Compare local archive observations only, not a full-market or social feed.
const {projectNewsAttention}=require('./fayo-news-attention');
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=(x,end)=>Number.isSafeInteger(x)&&x>0&&x<=end;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const list=x=>Array.isArray(x)?x:[];
const day=x=>new Date(x+28800000).toISOString().slice(0,10);
const flags={researchOnly:true,canTrade:false,canTrain:false,canNotify:false,capitalFlow:null,marketWide:false,independentConfirmationVerified:false};
function privacyStatus(){return {status:'deferred-no-authorized-aggregate',privateSocialCollection:false,personalIdentifiersCollected:false,rawPrivatePostsCollected:false,
 aggregateLicenseVerified:false,samplingBiasAudited:false,botTreatmentVerified:false,canEnable:false,missing:['聚合数据许可','样本代表性及偏差验证','机器人识别和统计影响证据'],...flags};}
function projectMatchedAttention(events,news,{selected,asOf}={}){
 const base={status:'unknown',sampleScope:'local-same-day-frozen-analysis',asOf,tradeDate:null,provider:null,expectedSecurities:null,validSecurities:0,pairedSecurities:0,rows:[],turnoverHHI:null,attentionHHI:null,counterexamples:[],privacy:privacyStatus(),...flags};
 const d=selected?.data;
 if(!d||!hash(selected.hash)||!['tencent','eastmoney'].includes(d.provider)||d.priceBasis!=='unadjusted'||!/^\d{4}-\d{2}-\d{2}$/.test(d.tradeDate||'')||!time(selected.recordedAt,asOf))return base;
 const cutoff=selected.recordedAt,start=Date.parse(d.tradeDate+'T00:00:00+08:00'),end=Date.parse(d.tradeDate+'T15:00:00+08:00');
 const out={...base,tradeDate:d.tradeDate,provider:d.provider,cutoff};
 if(!Number.isFinite(start)||!Number.isFinite(end)||day(end)!==d.tradeDate||cutoff<end)return out;
 const grouped=new Map();
 for(const e of list(events)){
  const x=e.data;if(e.kind!=='analysis'||!hash(e.hash)||!time(e.recordedAt,cutoff)||!time(x?.asOf,e.recordedAt)||x.tradeDate!==d.tradeDate||x.provider!==d.provider||x.priceBasis!==d.priceBasis||!code(x.symbol))continue;
  const a=grouped.get(x.symbol)||[];a.push(e);grouped.set(x.symbol,a);
 }
 if(grouped.size>100)return {...out,status:'sample-budget-exceeded',expectedSecurities:grouped.size};
 const expected=grouped.size,prices=[];
 for(const [symbol,g] of grouped){
  const candidate=g.sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence).at(-1);
  const valid=e=>{const x=e.data,b=list(x.bars).at(-1);return b&&b.date===d.tradeDate&&time(b.knownAt,x.asOf)&&b.knownAt>=end&&b.corporateAction===false&&b.suspended===false&&b.tradable===true&&finite(b.amount)&&b.amount>=0&&finite(b.close)&&b.close>0&&x.researchOnly===true&&x.canTrade===false&&x.simulated!==true&&x.fixture!==true;};
  if(!valid(candidate))continue;
  const b=candidate.data.bars.at(-1);
  if(g.some(e=>!valid(e)||e.data.bars.at(-1).amount!==b.amount||e.data.bars.at(-1).close!==b.close))continue;
  prices.push({symbol,amount:b.amount,close:b.close,knownAt:b.knownAt,runId:candidate.hash});
 }
 const scoped={...out,expectedSecurities:expected,validSecurities:prices.length};
 if(expected<5||prices.length!==expected)return {...scoped,status:'insufficient-complete-local-cohort'};
 if(!Array.isArray(news)||news.length>10000)return {...scoped,status:'news-unavailable'};
 const atClose=news.filter(e=>time(e?.recordedAt,end)),sameDay=atClose.filter(e=>e.recordedAt>=start);
 const rows=prices.map(p=>{
  const n=projectNewsAttention(atClose,{asOf:end,symbol:p.symbol});
  const supported=n.omittedGroups===0&&n.ungroupedRecords===0&&n.rows.every(g=>!g.withdrawalConflict);
  const groups=supported?n.rows.filter(g=>g.firstArchivedAt>=start&&g.firstArchivedAt<=end):[];
  return {...p,attentionCount:supported?groups.length:null,attentionRefs:groups.flatMap(g=>g.refs).slice(0,30),attentionKnownAt:end};
 });
 const total=rows.reduce((n,r)=>n+r.amount,0),hits=rows.every(r=>r.attentionCount!==null)?rows.reduce((n,r)=>n+r.attentionCount,0):null;
 if(!finite(total)||total<=0||hits===null||hits===0||!sameDay.length)return {...scoped,status:'insufficient-local-attention-or-turnover',pairedSecurities:rows.filter(r=>r.attentionCount!==null).length};
 const top=Math.floor(rows.length/3),rank=(r,key,desc)=>{
  const best=1+rows.filter(x=>desc?x[key]>r[key]:x[key]<r[key]).length;
  return {best,worst:best+rows.filter(x=>x[key]===r[key]).length-1};
 };
 const compared=rows.map(r=>{const a=rank(r,'attentionCount',true),v=rank(r,'amount',false);return {...r,attentionShare:r.attentionCount/hits,turnoverShare:r.amount/total,attentionHighRank:a,turnoverLowRank:v,
  highAttentionLowTurnover:r.attentionCount>0&&a.worst<=top&&v.worst<=top};});
 return {...scoped,status:'paired-local-observations',pairedSecurities:rows.length,rows:compared,turnoverHHI:compared.reduce((n,r)=>n+r.turnoverShare**2,0),attentionHHI:compared.reduce((n,r)=>n+r.attentionShare**2,0),
  counterexamples:compared.filter(r=>r.highAttentionLowTurnover).map(r=>r.symbol),rankThreshold:'top-third attention and bottom-third turnover, ties conservatively excluded',
  amountUnit:'original-frozen-provider-amount-unverified',note:'同一交易日收盘前本地新闻同文组与完整本地封存股票池收盘累计成交额；非市场热度或资金流，未独立证实新闻与金额来源，不作为策略信号。'};
}
module.exports={privacyStatus,projectMatchedAttention};
