'use strict';
// Display-only projection of existing observed state. No orders, ranking changes or invented scores.
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const {quoteObservationView}=require('./quote-observation-view');
const text=v=>typeof v==='string'?v.slice(0,200):'';
function dashboardView(state,mood=null,now=Date.now()){
 const riskEvidence=require('./risk-evidence-view').riskEvidenceView(state,now);
 const pool=Array.isArray(state.candidatePool)?state.candidatePool.filter(Boolean):[];
 const observed=Number.isFinite(state.stocksAt)&&state.stocksAt>0;
 const fourteenCodes=new Set((state.myrules?.items||[]).filter(Boolean).map(x=>x.code));
 const rows=pool.slice(0,50).map(c=>({...quoteObservationView(c,now),code:text(c.code),name:text(c.name),price:number(c.price),pct:number(c.pct),score:number(c.score),
   fourteen:fourteenCodes.has(c.code),focused:c.focused===true||c.focused===1,signals:Array.isArray(c.paths)?c.paths.filter(x=>typeof x==='string').slice(0,5):[],
   explanation:Array.isArray(c.pathWhy)?c.pathWhy.filter(x=>typeof x==='string').slice(0,5):typeof c.pathWhy==='string'?[c.pathWhy]:[],
   news:riskEvidence.news.filter(n=>n.codes.includes(c.code)).slice(0,6),probabilityLabel:riskEvidence.probabilityLabel,bad:!!state.news?.badCodes?.has?.(c.code),bazi:c.bazi?{score:number(c.bazi.total),verdict:text(c.bazi.verdict),line:text(c.bazi.line)}:null}));
 const up=number(mood?.upN),down=number(mood?.downN),flat=number(mood?.flatN);
 const total=up!==null&&down!==null?up+down+(flat??0):0;
 const rules=state.myrules;
 return {sixPhotoBackups:require('./six-photo-backups').readSixPhotoBank(process.env.V6_SIX_PHOTO_FILE),publicQuoteProbe:require('./public-quote-probe').readPublicQuoteProbe(process.env.V6_PUBLIC_QUOTE_PROBE_FILE),parallelMarket:require('./parallel-market').readParallelMarket(process.env.V6_PARALLEL_MARKET_FILE),riskEvidence,schemaVersion:1,observedAt:observed?state.stocksAt:null,indexObservedAt:number(state.idxRt?.at),
   source:'现有行情快照 · 未完成供应商认证',verifiedLive:false,
   indices:(state.idxRt?.items||[]).filter(Boolean).slice(0,4).map(x=>({code:text(x.code),name:text(x.name),price:number(x.price),pct:number(x.pct)})),
   mood:{label:text(mood?.mood),advice:text(mood?.advice),note:text(mood?.why||mood?.note),upRatio:observed&&total?Math.round(up/total*100):null},
   counts:{candidates:observed?pool.length:null,focused:observed?rows.filter(x=>x.focused).length:null,signals:observed&&Array.isArray(state.signals)?state.signals.length:null,risk:observed?rows.filter(x=>x.bad).length:null},
   strategies:[{id:'fourteen',label:'十四条选股',count:rules?.date?number(rules.count):null,note:rules?.date?text(rules.date):'尚无独立证据'},
    {id:'bazi',label:'八字口诀',count:observed?rows.filter(x=>x.bazi).length:null,note:'候选池已评估数'},
    {id:'gpt',label:'GPT 五策略',count:null,note:'请在研究台独立验证'},
    {id:'python',label:'Python 三轮',count:null,note:'需原生执行证据'}],rows};
}
module.exports={dashboardView};
