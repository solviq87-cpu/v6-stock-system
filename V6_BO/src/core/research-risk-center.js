'use strict';
// A snapshot of existing research evidence. No collectors, account readers or actions.
const path=require('node:path');
const {riskEvidenceView}=require('./risk-evidence-view');
const {readManualHoldingWatchFile}=require('./manual-holding-risk-watch');
const {readAgentStatus}=require('./factor-research-agent');
const text=(v,max=240)=>typeof v==='string'?v.slice(0,max):null;
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const timestamp=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15?v:null;
function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function readResearchRiskCenter({state={},now=Date.now(),holdingWatchFile=null,agentDir=null,
 newsRoot=path.resolve(__dirname,'../../data/news-evidence'),readNews}={}){
 if(!Number.isSafeInteger(now)||now<=0||now>8e15)throw Error('研究风险中心时钟无效');
 const supports=[],contra=[],missing=[];
 const add=(list,domain,code,message,reference=null)=>list.push({domain,code,message,reference});
 let market;
 try{
  const view=riskEvidenceView(state,now),q=view.marketQuotes;
  market={status:'observed-unverified',quotes:{...q},receivedAt:view.marketReceivedAt,
   tradeDate:view.tradeDate,sectors:view.sectors,sectorObservedAt:view.sectorObservedAt,
   sectorTradeDate:view.sectorTradeDate,optionalStatus:view.optionalStatus,
   sources:view.optionalSources,verifiedLive:false};
  if(q.total===0)add(missing,'market','NO_PER_SYMBOL_QUOTES','没有可评估的逐票报价，不能判断当前市场风险');
  if(q.stale||q.future||q.unknown)add(supports,'market','QUOTE_QUALITY_GAPS','存在过期、未来或未知时点的逐票报价');
  if(!q.total||q.recent!==q.total)add(missing,'market','INCOMPLETE_CURRENT_QUOTES','逐票原始报价时点覆盖不完整');
  for(const reason of view.reasons)add(missing,'market','MARKET_EVIDENCE_GAP',reason);
  add(contra,'market','SOURCES_NOT_CERTIFIED','近期报价及可选来源均未完成独立认证，近期不等于安全');
 }catch{
  market={status:'unavailable',quotes:null,receivedAt:null,tradeDate:null,sectors:[],sources:[],verifiedLive:false};
  add(missing,'market','MARKET_VIEW_UNAVAILABLE','市场快照或其只读证据未通过校验');
 }
 let manualHoldings;
 try{manualHoldings=readManualHoldingWatchFile(holdingWatchFile,{now});}
 catch{manualHoldings={status:'unavailable',positions:[],alerts:[],canTrade:false,canNotify:false};}
 if(manualHoldings.status!=='evaluated'){
  add(missing,'manual-holdings','MANUAL_HOLDINGS_'+(manualHoldings.status==='unconfigured'?'UNCONFIGURED':'UNAVAILABLE'),
   manualHoldings.status==='unconfigured'?'未配置手工持仓观察资料，持仓浮亏与集中度未知':'手工持仓观察资料不可读或校验失败，持仓风险未知');
 }else{
  for(const alert of manualHoldings.alerts){
   const list=alert.severity==='unknown'?contra:supports;
   add(list,'manual-holdings',alert.code,alert.message,alert.symbol);
  }
  if(manualHoldings.counts.missingOrUnusableQuotes)add(missing,'manual-holdings','CURRENT_HOLDING_QUOTES_MISSING','部分手工持仓缺少可用逐票报价，不能计算最新浮亏');
  if(manualHoldings.positions.some(p=>p.weightPct===null))add(missing,'manual-holdings','DECLARED_WEIGHTS_MISSING','部分手工持仓没有申报仓位，集中度未知');
  if(!manualHoldings.positions.length)add(missing,'manual-holdings','EMPTY_MANUAL_HOLDINGS','观察文件没有持仓记录，不能据此确认实际账户为空');
  add(contra,'manual-holdings','MANUAL_INPUTS_NOT_ACCOUNT_ATTESTATION','成本与权重来自手工申报，未读取或认证实际账户持仓');
 }
 let news;
 try{
  const query=readNews||require('./news-evidence-journal').query;
  const result=query(newsRoot,{symbol:null,limit:50,now});
  const summary=result.summary,summaryKeys=['totalRevisions','currentEvents','retractedEvents','eligibleForResearchSupport','unknownEvents'];
  if(result.mode!=='news-evidence-readonly'||!Array.isArray(result.rows)||result.rows.length>50||
    result.canTrade!==false||result.canNotify!==false||!summary||
    !summaryKeys.every(k=>count(summary[k])!==null))throw Error('news-shape');
  const rows=result.rows.map(row=>{
   const e=row.evidence;
   if(!e||!['original','revised','retracted'].includes(e.kind)||
     !['superseded','retracted','unknown','source-declared-unverified'].includes(row.supportStatus)||typeof row.current!=='boolean')throw Error('news-row');
   return {eventHash:text(row.eventHash,64),source:text(e.source,120),title:text(e.title,1000),kind:e.kind,
    current:row.current,supportStatus:row.supportStatus,
    eligibleForResearchSupport:row.current&&e.kind!=='retracted'&&row.supportStatus==='source-declared-unverified'&&row.eligibleForResearchSupport===true,
    securities:Array.isArray(e.securities)?e.securities.filter(s=>typeof s==='string'&&/^\d{6}$/.test(s)):[],
    publishedAt:timestamp(e.publishedAt),receivedAt:timestamp(e.receivedAt),revisedAt:timestamp(e.revisedAt),url:safeUrl(e.url)};
  });
  news={status:summary.totalRevisions?'observed-unverified':'empty',summary:Object.fromEntries(summaryKeys.map(k=>[k,summary[k]])),rows,
   visibleRevisedEvents:rows.filter(r=>r.current&&r.kind==='revised').length,
   independentlyVerified:false,headlineSentimentUsed:false};
  if(!summary.currentEvents)add(missing,'news','NO_CURRENT_NEWS_EVIDENCE','没有已归档的当前新闻证据，不能据此判断没有消息风险');
  if(summary.retractedEvents)add(supports,'news','RETRACTED_NEWS','新闻档案存在撤稿，撤稿内容不能作为支持依据');
  if(news.visibleRevisedEvents)add(supports,'news','REVISED_NEWS_IN_VISIBLE_WINDOW','最近50条档案中存在当前修订版本，应核对原始版本变化');
  if(summary.unknownEvents)add(missing,'news','UNKNOWN_NEWS_EVIDENCE','部分新闻缺少原始时间、链接或正文，证据为未知');
  add(contra,'news','DECLARED_NEWS_NOT_CONFIRMED','来源声明、标题词与历史利好利空分类不等于已确认消息或风险方向');
 }catch{
  news={status:'unavailable',summary:null,rows:[],visibleRevisedEvents:null,independentlyVerified:false,headlineSentimentUsed:false};
  add(missing,'news','NEWS_EVIDENCE_UNAVAILABLE','新闻模块、档案或证据链不可用，新闻风险未知');
 }
 let researchAgent;
 try{researchAgent=readAgentStatus(agentDir);}
 catch{researchAgent={status:'blocked-invalid-agent-journal',canTrade:false,productionWeightsChanged:false};}
 if(researchAgent.status==='unconfigured')add(missing,'research-agent','AGENT_UNCONFIGURED','研究代理尚未配置证据');
 else if(['blocked-invalid-agent-journal','failed-stop-and-audit-before-retry'].includes(researchAgent.status))add(missing,'research-agent','AGENT_EVIDENCE_INVALID','研究代理档案校验失败或流程已暂停，不能据此判断策略有效');
 else add(contra,'research-agent','RESEARCH_PROCESS_NOT_RETURN_CERTIFICATION','研究流程状态不代表收益或策略有效性认证');
 const strategyDecay={status:'unknown',estimate:null,reason:'没有足够的独立成熟样本及经校验的衰减检验，不能推断策略有效或失效'};
 add(missing,'strategy-decay','DECAY_NOT_ESTABLISHED',strategyDecay.reason);
 return {schemaVersion:1,mode:'research-risk-center-readonly',generatedAt:now,
  status:supports.length?'observed-concerns-unverified':'unknown',riskScore:null,
  researchOnly:true,canTrade:false,canNotify:false,writesAccount:false,productionWeightsChanged:false,
  evidenceMeaning:{supports:'已有证据支持的观察事项，非交易建议',contra:'限制结论或表明证据冲突的事项',missing:'缺失、未认证或无法校验的证据'},
  supports,contra,missing,market,manualHoldings,news,researchAgent,strategyDecay};
}
module.exports={readResearchRiskCenter};
