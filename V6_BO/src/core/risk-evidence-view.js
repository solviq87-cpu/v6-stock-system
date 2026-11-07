'use strict';
// Read-only view of legacy evidence; legacy sources are not authenticated feeds.
const {quoteObservationView}=require('./quote-observation-view');
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const txt=v=>typeof v==='string'?v.slice(0,240):'';
const day=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function riskEvidenceView(state,now=Date.now()){
 if(!Number.isFinite(now)||now<=0)throw Error('风险视图时钟无效');
 const age=at=>num(at)!==null&&at>0&&at<=now?now-at:null;
 const at=num(state.stocksAt),marketAge=age(at),sectorAge=age(state.sectorsAt);
 const marketQuotes={total:0,recent:0,stale:0,future:0,unknown:0,verifiedLive:false};
 for(const row of Array.isArray(state.stocks)?state.stocks:[]){
  if(!row||typeof row.code!=='string'||!/^\d{6}$/.test(row.code))continue;
  const observation=quoteObservationView(row,now);
  marketQuotes.total++;marketQuotes[observation.quoteStatus==='recent-unverified'?'recent':observation.quoteStatus]++;
 }
 const sectorDay=String(state.sectorsDay||'').replace(/-/g,'');
 const sectorFresh=sectorAge!==null&&sectorAge<=180000&&sectorDay===day(now).replace(/-/g,'');
 const reasons=['行情来源尚未完成核验','人民币汇率证据未接通','跨市场会话与交易日历尚未完成联合核验'];
 if(marketAge===null||marketAge>180000)reasons.push('A股行情缺失、未来时点或已过期');
 if(!marketQuotes.total||marketQuotes.recent<marketQuotes.total)reasons.push('A股逐票原时点不完整、位于未来或已过期，列表接收时间不代表报价新鲜');
 if(!sectorFresh)reasons.push('板块资金证据缺失、跨日或已过期');
 const sectors=(Array.isArray(state.sectors)?state.sectors:[]).filter(x=>x&&txt(x.name)).slice(0,100).map(x=>({name:txt(x.name),netInflowYuan:num(x.mainInflow),pct:num(x.pct),status:sectorFresh?'observed-unverified':'stale-or-unknown'}));
 const optional=require('./optional-research-view').optionalResearchView(process.env.V6_OPTIONAL_RESEARCH_FILE,now);
 const news=[...optional.announcements];for(const [key,direction] of [['goodAll','利好'],['badAll','利空'],['neutralAll','中性']])for(const x of (Array.isArray(state.news?.[key])?state.news[key]:[]).slice(0,30)){
 if(!x||!txt(x.title))continue;news.push({title:txt(x.title),direction,reason:txt(x.why),publishedAt:txt(x.t),source:txt(x.source||x.from),codes:Array.isArray(x.codes)?x.codes.filter(c=>typeof c==='string'&&/^\d{6}$/.test(c)).slice(0,20):[],verified:false});}
 const unique=new Map();for(const n of news){const key=n.direction+'|'+n.title+'|'+n.publishedAt;if(!unique.has(key))unique.set(key,n);}
 return {marketQuotes,marketReceivedAt:at,optionalCatalog:optional.catalog,optionalSources:optional.sources,optionalStatus:optional.status,schemaVersion:1,policyVersion:'risk-display-ay-1',generatedAt:now,validUntil:now+180000,tradeDate:day(now),status:'observe',label:'今日观望',canTrade:false,verifiedLive:false,reasons,positionAction:'未读取个人持仓，不生成加减仓或离场结论',probabilityLabel:'概率尚未验证',sectorAdvice:'暂无可靠板块建议',sectors,sectorObservedAt:num(state.sectorsAt),sectorTradeDate:sectorDay||null,global:(Array.isArray(state.global)?state.global:[]).filter(Boolean).slice(0,12).map(x=>({name:txt(x.name),pct:num(x.pct),price:num(x.price),verified:false})),news:[...unique.values()].slice(0,30),newsStatus:'现有新闻分类未经独立核验，不代表已接通实时新闻',source:'现有后端快照，未认证'};
}
module.exports={riskEvidenceView};
