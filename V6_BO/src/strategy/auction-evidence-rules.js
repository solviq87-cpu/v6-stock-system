'use strict';
/*
 * Auditable A-share auction research. NO network calls, orders, notifications,
 * portfolio writes or automatic changes to existing V6 strategy weights.
 * An arrival timestamp is never substituted for an upstream quote timestamp.
 */
const MAX_ROWS=250, CN_OFFSET=8*3600000;
const validCode=x=>typeof x==='string'&&/^(?:60|68|00|30)\d{4}$/.test(x);
const validDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dayOf=t=>new Date(t+CN_OFFSET).toISOString().slice(0,10);
const minuteOf=t=>{const d=new Date(t+CN_OFFSET);return d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;};
const round=x=>finite(x)?Number(x.toFixed(3)):null;
const BASE=Object.freeze({mode:'auction-evidence-research',historicalOnly:true,
  certifiedLive:false,canTrade:false,canNotify:false,weightsChanged:false,
  providerLicensed:false,exchangeVerified:false});
const RULES=Object.freeze([
 {id:'noncancel-volume-hold',name:'9:20后虚拟匹配量承接',family:'auction-stability',phase:'preliminary'},
 {id:'open-amount-confirmation',name:'9:25开盘量价确认',family:'auction-confirmation',phase:'final'},
 {id:'first-to-second-sector',name:'首板次日竞价板块共振',family:'limit-ladder',phase:'final'}
]);
function evaluateAuctionEvidence(stock={}, {asOf,tradeDate}={}){
 const base={...BASE,code:stock?.code||null,tradeDate:tradeDate||null,asOf,
  status:'insufficient_data',reason:'缺少可核对的竞价原始时点',factors:{},
  risks:[],rules:[],matchedRuleCount:0,independentFamilyCount:0};
 const unavailable=why=>({...base,reason:why,rules:RULES.map(r=>({...r,
  status:'insufficient_data',evidence:[],reason:why}))});
 if(!validCode(stock?.code)||!validDay(tradeDate)||!Number.isSafeInteger(asOf)||
    asOf<=0||dayOf(asOf)!==tradeDate) return unavailable('证券、交易日或评估时刻无效');
 const input=stock.snapshots;
 if(!Array.isArray(input)||input.length<1||input.length>MAX_ROWS)
  return unavailable('需提供不超过250条同日竞价快照');
 const source=stock.source;
 if(typeof source!=='string'||!source.trim()||source.length>120||
    /^(?:mock|synthetic|fixture|simulated)$/i.test(source.trim()))
  return unavailable('缺少真实来源标识；模拟/测试源不可冒充公开行情');
 if(!finite(stock.previousClose)||stock.previousClose<=0)
  return unavailable('缺少独立核验的前收盘价');
 const ticks=[],times=new Set();
 for(const t of input){
  const at=t?.quoteAt,received=t?.receivedAt,price=t?.indicativePrice,
    volume=t?.indicativeMatchedVolume;
  if(!Number.isSafeInteger(at)||!Number.isSafeInteger(received)||
     at<=0||received<at||received>asOf||at>asOf||received-at>60000||
     dayOf(at)!==tradeDate||!finite(price)||price<=0||
     !Number.isSafeInteger(volume)||volume<0||
     !finite(minuteOf(at))||minuteOf(at)<555||minuteOf(at)>=566||
     times.has(at)||t?.source!==source||t?.code!==stock.code)
   return unavailable('竞价报价原始时点/采集时点、证券、来源或量价序列不可信');
  if(t?.executedAmount!==undefined&&
     (!finite(t.executedAmount)||t.executedAmount<0))return unavailable('开盘实际成交额格式错误');
  if(t?.executed===true&&!(minuteOf(at)>=565&&minuteOf(at)<566))
   return unavailable('实际撮合标识只能来自9:25后原始时点');
  times.add(at);ticks.push(t);
 }
 ticks.sort((a,b)=>a.quoteAt-b.quoteAt);
 const pre=ticks.filter(t=>minuteOf(t.quoteAt)<560),
       noncancel=ticks.filter(t=>minuteOf(t.quoteAt)>=560&&minuteOf(t.quoteAt)<565);
 const final=ticks.filter(t=>minuteOf(t.quoteAt)>=565&&t.executed===true).at(-1)||null;
 // An indicative 9:24 price is not a certified final opening price.
 const gap=final?100*(final.indicativePrice/stock.previousClose-1):null;
 const validAmount=finite(stock.dailyAverageAmount20)&&stock.dailyAverageAmount20>0;
 const amountRatio=final&&validAmount&&finite(final.executedAmount)
  ?final.executedAmount/stock.dailyAverageAmount20:null;
 const first=noncancel[0],last=noncancel.at(-1);
 const stable=noncancel.length>=2&&
  last.quoteAt-first.quoteAt>=60000&&first.indicativeMatchedVolume>0;
 const volumeGrowth=stable?last.indicativeMatchedVolume/first.indicativeMatchedVolume:null;
 const priceRetreat=stable?100*(last.indicativePrice/first.indicativePrice-1):null;
 const risks=[];
 if(stock.isST===true||stock.suspended===true||stock.isDelisting===true||
    stock.noPriceLimit===true||stock.tradable===false||stock.ipoNoLimit===true)
  risks.push('ST、停牌、退市风险、无涨跌幅限制或不可交易状态，禁止生成看涨研究命中');
 const earlyPeak=pre.length?Math.max(...pre.map(t=>100*(t.indicativePrice/stock.previousClose-1))):null;
 const laterGap=final?gap:last?100*(last.indicativePrice/stock.previousClose-1):null;
 const suspiciousFade=earlyPeak!==null&&earlyPeak>=6&&laterGap!==null&&laterGap<1;
 if(suspiciousFade)
  risks.push('9:20前高幅虚拟报价随后明显回落；可能存在撤单/报价诱导风险，不能推定主力资金行为');
 const atLimit=!!final&&finite(stock.limitPct)&&stock.limitPct>0&&gap>=stock.limitPct*.9;
 if(atLimit)risks.push('高开接近涨幅上限，无法据此证明9:30后可成交或有流动性');
 if(final&&gap>=8)risks.push('大幅高开：追高回撤及开盘后承接不足风险');
 // Severe fade / near-limit opening overrides bullish research matches.
 const riskBlocked=risks.length>0&&(stock.isST===true||stock.suspended===true||
  stock.isDelisting===true||stock.noPriceLimit===true||stock.tradable===false||
  stock.ipoNoLimit===true||suspiciousFade||atLimit);
 const evaluate=(rule,inputs,pass,evidence)=>({
  ...rule,status:riskBlocked?'risk_blocked':!inputs?'insufficient_data':
    pass?'candidate':'not_matched',
  evidence:inputs?evidence:[],reason:riskBlocked?risks[0]:inputs?
   (pass?'完整研究条件命中，尚无样本外收益证明':'部分必要条件未通过'):'缺少该战法必需的原始竞价证据'
 });
 const rules=[
  evaluate(RULES[0],stable,
   stable&&priceRetreat>=-1&&volumeGrowth>=1.1&&
    last.indicativePrice/stock.previousClose>=1.005&&last.indicativePrice/stock.previousClose<=1.06,
   stable?['不可撤单时段至少两次报价，间隔≥60秒',
    '虚拟匹配量后/前='+round(volumeGrowth)+'（非真实成交量）',
    '虚拟价格变化='+round(priceRetreat)+'%，前收涨幅='+round(100*(last.indicativePrice/stock.previousClose-1))+'%']:[]),
  evaluate(RULES[1],!!final&&validAmount&&finite(final.executedAmount),
   !!final&&validAmount&&final.executedAmount>=3000000&&amountRatio>=.03&&gap>=.5&&gap<=3,
   final?['9:25撮合标记已提供','高开='+round(gap)+'%',
     '实际开盘成交额/前20日均成交额='+round(amountRatio)+'（阈值为研究假设）']:[]),
  evaluate(RULES[2],!!final&&finite(final.executedAmount)&&
     (stock.previousFirstBoardVerified===true||stock.previousFirstBoardVerified===false)&&
     Number.isSafeInteger(stock.sectorRank)&&stock.sectorRank>=1,
   !!final&&stock.previousFirstBoardVerified===true&&
    stock.sectorRank<=5&&gap>=1&&gap<=6&&final.executedAmount>=5000000,
   final?['前一日首板由独立证据确认='+String(stock.previousFirstBoardVerified===true),
     '板块相对名次='+String(stock.sectorRank??'缺失'),
     '9:25开盘成交额='+String(final.executedAmount??'缺失')]:[])
 ];
 const matched=rules.filter(x=>x.status==='candidate');
 return {...base,status:riskBlocked?'risk_blocked':
  matched.length?'research_candidates':rules.every(x=>x.status==='insufficient_data')?
  'insufficient_data':'observed_no_candidate',
  reason:riskBlocked?'风险过滤覆盖所有看涨研究条件':matched.length?
   '研究条件命中，不构成收益、可成交性或实时验证':'尚无足够证据支持或未命中',
  provider:source,sourceCertification:'declared-unverified',
  factors:{earlyIndicativePeakPct:round(earlyPeak),openGapPct:round(gap),
   matchedVolumeGrowth:round(volumeGrowth),indicativePriceChangePct:round(priceRetreat),
   executedAuctionAmount:final?.executedAmount??null,
   openingAmountRatio20:round(amountRatio),sectorRank:stock.sectorRank??null,
   finalQuoteAt:final?.quoteAt??null,
   prelimQuoteAt:last?.quoteAt??null},
  risks,rules,matchedRuleCount:matched.length,
  independentFamilyCount:new Set(matched.map(x=>x.family)).size};
}
function evaluateAuctionBatch(input={}){
 if(!validDay(input.tradeDate)||!Number.isSafeInteger(input.asOf)||
  !Array.isArray(input.stocks)||input.stocks.length>100||input.stocks.length<1)
  throw Error('竞价研究批次需要日期、评估时点和1-100只股票');
 const seen=new Set(),rows=[];
 for(const stock of input.stocks){
  if(seen.has(stock?.code))throw Error('同一交易日不得重复证券');
  seen.add(stock?.code);
  rows.push(evaluateAuctionEvidence(stock,{asOf:input.asOf,tradeDate:input.tradeDate}));
 }
 const candidates=rows.filter(x=>x.matchedRuleCount>0&&x.status==='research_candidates');
 return {...BASE,schemaVersion:1,tradeDate:input.tradeDate,asOf:input.asOf,
  total:rows.length,matchedStocks:candidates.length,items:rows,
  researchWatchlist:candidates.map(x=>({code:x.code,matchedRuleCount:x.matchedRuleCount,
   families:x.rules.filter(r=>r.status==='candidate').map(r=>r.family),
   risks:x.risks,finalQuoteAt:x.factors.finalQuoteAt})),
  note:'与原V6正式策略分离；本报告只评价显式提供的原始时点竞价证据，不自动联网或模拟成交'};
}
module.exports={RULES,evaluateAuctionEvidence,evaluateAuctionBatch};
