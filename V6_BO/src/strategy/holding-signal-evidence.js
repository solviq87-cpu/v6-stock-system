'use strict';
const {detectPatterns}=require('./a-share-patterns');
const {linkIssuerEvents}=require('./issuer-event-linkage');
const CODE=/^\d{6}$/;
const important=new Set(['three_black_crows','bearish_engulfing','breakdown20_volume','heavy_distribution','ma5_ma20_death_cross']);
function holdingEvidence({code,bars=[],quote={},announcements=[],now=Date.now()}={}){
 const base={mode:'research-only',code:String(code||''),status:'unknown',sourceDate:null,
  risks:[],issuerRisks:[],notifyEligible:false,canTrade:false,reason:'K线或行情来源缺乏可核验证据'};
 if(!CODE.test(base.code)||!Number.isFinite(now)||now<=0)return base;
 if(!Array.isArray(bars)||bars.length<21)return {...base,status:'insufficient-history'};
 const last=bars.at(-1),today=new Date(now+8*3600000).toISOString().slice(0,10);
 if(typeof last?.date!=='string'||!Number.isFinite(Date.parse(last.date+'T00:00:00Z'))||
   new Date(Date.parse(last.date+'T00:00:00Z')).toISOString().slice(0,10)!==last.date||
   last.date>today)return {...base,status:'invalid-date'};
 const p=detectPatterns({symbol:code,bars});
 if(!p.usable)return {...base,status:'invalid-history',reason:p.reason};
 const risks=p.matched.filter(r=>r.side==='bearish'&&important.has(r.id))
   .map(r=>({id:r.id,label:r.label,detail:r.detail,date:last.date,source:'历史日K'}));
 const issuer=linkIssuerEvents({symbol:code,announcements,now,maxAgeDays:30});
 const issuerRisks=[...issuer.riskClues,...issuer.conflicts].map(r=>({
  id:r.id,label:'公告风险标题待核对',detail:r.title,publishedAt:r.publishedAt,url:r.url,verified:false}));
 const quoteAt=Number.isSafeInteger(quote?.quoteAt)?quote.quoteAt:
   Number.isSafeInteger(quote?.timestamp)?quote.timestamp:null;
 const quoteSource=typeof quote?.quoteSource==='string'?quote.quoteSource:
   typeof quote?.source==='string'?quote.source:'';
 const quoteFresh=quoteAt!==null&&quoteAt<=now&&now-quoteAt<=60000&&
   typeof quote?.price==='number'&&Number.isFinite(quote.price)&&quote.price>0&&
   Boolean(quoteSource.trim())&&!/simulat|import|test|mock/i.test(quoteSource)&&!quote.proxy&&
   !quote.suspended&&quote.tradable!==false;
 const sameSession=last.date===today;
 // A historical alert is not evidence for a same-day real-time mobile push.
 // Only source-dated same-session patterns with a fresh quote can be considered
 // by the existing user-private, mute-aware push channel.
 return {...base,sourceDate:last.date,status:'historical-research',
  risks,issuerRisks,quoteStatus:quoteFresh?'recent-unverified':'unknown-or-stale',
  notifyEligible:quoteFresh&&sameSession&&risks.length>0,
  reason:quoteFresh&&sameSession?'当前日期K线与近期报价齐全，但仍未验证实际行情供应商':
    '仅供面板显示：缺少同交易日且时效有效的行情，不触发自动推送'};
}
function asHoldingsAct(evidence,{locked=false}={}){
 if(!evidence?.notifyEligible||!Array.isArray(evidence.risks)||!evidence.risks.length)return null;
 const names=evidence.risks.map(x=>x.label).slice(0,4);
 return {type:'形态风险',urgent:true,once:true,color:'warn',
   text:'⚠️ 检测到 '+names.join('、')+'；请检查行情与公司公告',
   why:'同日K线 '+evidence.sourceDate+'，历史形态：'+names.join('、')+'。该项只提示风险，不直接建议下单'+
     (locked?'；该股已锁仓，忽略任何卖出操作建议':''),
   evidenceIds:evidence.risks.map(x=>x.id)};
}
module.exports={holdingEvidence,asHoldingsAct};
