'use strict';
// Public observations flow into isolated research archives, never the quote or order cache.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchPublicStockHistory}=require('./public-stock-history');
const {fetchPublicContext}=require('./public-market-context');
const {retainStockObservation,readObservedStock}=require('./stock-observation-store');
const {analyzeStockHistory,appendSnapshot,readStockMemory}=require('./stock-intelligence-memory');
const {studyPatternOutcomes}=require('../strategy/pattern-outcome-study');
const {detectPatterns}=require('../strategy/a-share-patterns');
const {publicContextView}=require('./linked-market-intelligence');
const {readResearchCalendar}=require('./research-calendar-source');
const flags={researchOnly:true,canTrade:false,canNotify:false,verifiedLive:false,productionWeightsChanged:false,autoPromotion:false};
const symbolOK=s=>typeof s==='string'&&/^(?:(?:600|601|603|605|688|000|001|002|003|300|301)\d{3}|(?:43|83|87|88|92)\d{4})$/.test(s);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function privateDirectory(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir)||dir.includes('\0'))throw Error('需要私有绝对存储路径');
 const full=path.resolve(dir);if(full===path.parse(full).root||full.split(path.sep).some(p=>p.toLowerCase()==='public'))throw Error('禁止公开存储');
 let part=path.parse(full).root;for(const p of full.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,p);try{if(fs.lstatSync(part).isSymbolicLink())throw Error('禁止符号链接存储');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 fs.mkdirSync(full,{recursive:true,mode:0o700});if(fs.statSync(full).mode&0o077)throw Error('需要私有0700目录');return full;
}
function archiveRawEvidence(root,evidence){
 if(!evidence||evidence.encoding!=='base64'||typeof evidence.data!=='string'||evidence.data.length>3*1024*1024||!/^[a-f0-9]{64}$/.test(evidence.sha256||''))throw Error('缺少有界原始响应证据');
 const raw=Buffer.from(evidence.data,'base64');
 if(raw.length>2*1024*1024||raw.length!==evidence.byteLength||hash(raw)!==evidence.sha256)throw Error('原始响应哈希或大小不一致');
 const dir=privateDirectory(path.join(privateDirectory(root),'source-responses')),file=path.join(dir,evidence.sha256+'.json');
 const verify=()=>{const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const st=fs.fstatSync(fd);if(!st.isFile()||st.mode&0o077||st.size!==raw.length||!fs.readFileSync(fd).equals(raw))throw Error('已有原始响应证据不一致');}finally{fs.closeSync(fd);}};
 if(fs.existsSync(file)){verify();return {sha256:evidence.sha256,byteLength:raw.length,reused:true};}
 const files=fs.readdirSync(dir).filter(n=>!/^\.[a-f0-9]{64}\.[a-f0-9]{16}\.tmp$/.test(n));let bytes=0;
 if(files.length>=2000||files.some(n=>! /^[a-f0-9]{64}\.json$/.test(n)))throw Error('原始响应档案达到上限或目录损坏');
 for(const name of files){const st=fs.lstatSync(path.join(dir,name));if(!st.isFile()||st.isSymbolicLink())throw Error('原始响应文件类型无效');bytes+=st.size;}
 if(bytes+raw.length>128*1024*1024)throw Error('原始响应档案超过128MiB，需要人工归档');
 const temp=path.join(dir,'.'+evidence.sha256+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;verify();}
  const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch{}}
 return {sha256:evidence.sha256,byteLength:raw.length,reused:false};
}
function historySummary(history){
 return Object.fromEntries(['status','source','provider','priceBasis','retrievedAt','sourceTimestamp','rawHash','units','errors','attempts','metadataAvailability','finality','completeness'].map(k=>[k,history[k]??null]));
}
function priceFormation(stock,asOf){
 const bars=stock.bars.filter(b=>b.knownAt<=asOf&&Date.parse(b.date+'T15:10:00+08:00')<=asOf);
 return {status:'price-only-unverified',date:bars.at(-1)?.date||null,availableAt:bars.length?Math.max(...bars.map(b=>b.knownAt)):null,
  historicalEligible:false,calendarContinuityVerified:false,patterns:detectPatterns({...stock,bars}),...flags};
}
function sectorCaptureResearch({captureRoot,calendarFile,asOf,sectorIds}={}){
 if(!captureRoot)return {status:'unconfigured',reason:'尚未配置同时冻结的板块成员和行情档案',...flags};
 try{
  const input=require('./sector-relations-capture-bridge').readSectorRelationsCaptureInput({captureRoot,
   calendarFile:calendarFile||path.resolve(__dirname,'../../config/research-calendar-2026.json'),asOf,sectorIds});
  const report=require('../strategy/sector-relations').analyzeSectorRelations({asOf,tradeDates:input.tradeDates,history:input.sectorHistory,current:input.sectorCurrent});
  return {status:input.status,report,provenance:input.provenance,limitations:input.limitations,...flags};
 }catch{return {status:'unavailable',reason:'冻结板块档案、日历或明确成员选择未通过校验',...flags};}
}
function buildObservationResearch({stock,history,observation,asOf,context=null,saveMemory=false},{memoryRoot,calendarFile,readCalendar=readResearchCalendar,sectorCaptureRoot,sectorIds}={}){
 const cal=readCalendar({asOf,symbol:stock.symbol,calendarFile}),blockers=[];
 const result={schemaVersion:1,status:'captured',asOf,stock,history:{...history,tradeDate:stock.bars.at(-1)?.date||null},observation,
  calendar:{status:cal.status,source:cal.metadata?.source||null,from:cal.metadata?.from||null,to:cal.metadata?.to||null,
   nextTradeDate:cal.tradeDates?.find(d=>d>stock.bars.at(-1)?.date)||null,nextSessionAfterAsOfDate:cal.nextTradeDate||null,
   metadata:cal.metadata||null,reason:cal.reason||null},analysis:null,patternStudy:null,currentFormation:priceFormation(stock,asOf),
  marketContext:publicContextView(context,asOf),sectorRelations:null,memory:{status:'not-requested'},...flags,
  limitations:['原始响应接收时间不是供应商历史发布时间；初次下载的旧K线不会变成过去已知的样本',
   '当前价格形态与严格历史概率分开；状态、公司行为和涨停价证据缺失不会补造',
   '重复同版数据复用原档案，来源或价格口径不同的记录独立留存']};
 if(cal.status!=='available')blockers.push(cal.reason||'缺少明确交易日历');
 else{
  const dates=new Set(cal.tradeDates),from=cal.calendar.from,to=cal.calendar.to;
  const contradictory=stock.bars.some(b=>b.date>=from&&b.date<=to&&!dates.has(b.date));
  if(contradictory)blockers.push('供应商K线日期与明确交易日历冲突');
  else{
   const bars=stock.bars.filter(b=>dates.has(b.date)),study={...stock,bars};
   result.coverage={providedBars:stock.bars.length,calendarMatchedBars:bars.length,excludedOutsideCalendar:stock.bars.length-bars.length};
   try{
    result.analysis=analyzeStockHistory(study,{asOf,tradeDates:cal.tradeDates});
    result.patternStudy=studyPatternOutcomes(study,{asOf,tradeDates:cal.tradeDates});
    result.currentFormation=result.analysis.currentFormation;
    if(!result.analysis.coverage.latestFormationUsable)blockers.push('交易状态或公司行为的原始可得时点证据不足');
    if(result.analysis.direction.probability===null)blockers.push('严格历史条件样本不足20个');
    if(saveMemory&&memoryRoot){
     try{
      const {asOf:forecastTime,...forecastEvidence}=result.analysis;
      const researchKey=hash(JSON.stringify({observationHash:observation.observationHash,forecastEvidence,calendarHash:cal.metadata?.sha256||null}));
      const prior=readStockMemory(memoryRoot,stock.symbol,{asOf,limit:500}).revisions.find(e=>e.context?.researchKey===researchKey);
      result.memory=prior?{status:'saved',revision:prior.revision,eventHash:prior.eventHash,reused:true}: {status:'saved',...appendSnapshot(memoryRoot,{stock:study,forecast:result.analysis,decisionAt:asOf,
       context:{researchKey,observationHash:observation.observationHash,sourceRawHash:history.rawHash||null,calendarHash:cal.metadata?.sha256||null}})};
     }catch{result.memory={status:'failed',reason:'研究预测档案未完成，原有不可变档案保留'};blockers.push('研究预测封存尚未成功，可以重试；原始行情观察已保留');}
    }
   }catch{blockers.push('逐日来源、数据口径或研究证据不满足严格协议');}
  }
 }
 result.sectorCapture=sectorCaptureResearch({captureRoot:sectorCaptureRoot,calendarFile,asOf,sectorIds});
 result.sectorRelations=result.sectorCapture.report||null;
 result.readiness={blockers};return result;
}
function validateOptions(options){
 if(!options||!symbolOK(options.symbol)||!['auto','eastmoney','tencent'].includes(options.provider||'auto')||
  !Number.isSafeInteger(options.historyDays??120)||(options.historyDays??120)<1||(options.historyDays??120)>500||
  options.includeContext!==undefined&&typeof options.includeContext!=='boolean'||options.sectorCode!==undefined&&!/^BK\d{4}$/.test(options.sectorCode))throw Error('股票、来源、历史长度或板块参数无效');
}
async function observeStock(options,dependencies={}){
 validateOptions(options);
 const {observationRoot,memoryRoot,calendarFile,sectorCaptureRoot,sectorIds,fetchHistory=fetchPublicStockHistory,fetchContext=fetchPublicContext,readCalendar=readResearchCalendar,now=Date.now}=dependencies;
 const clock=typeof now==='function'?now:()=>now;
 const outcomes=await Promise.allSettled([fetchHistory({symbol:options.symbol,provider:options.provider||'auto',historyDays:options.historyDays??120},{now:clock}),
  options.includeContext?fetchContext({symbol:options.symbol,sectorCode:options.sectorCode},{now:clock}):Promise.resolve(null)]);
 const history=outcomes[0].status==='fulfilled'?outcomes[0].value:null;
 const asOf=clock();if(!Number.isSafeInteger(asOf)||asOf<=0||asOf>Date.now())throw Error('研究观察时点无效');
 const context=outcomes[1].status==='fulfilled'?outcomes[1].value:null;
 const rawEvidence=history?.rawEvidence?archiveRawEvidence(observationRoot,history.rawEvidence):null;
 if(!history||history.status!=='observed-unverified'||!history.stock?.bars?.length)return {schemaVersion:1,status:'unavailable',asOf,
  history:history?historySummary(history):{status:'unknown',errors:[{code:'history-source-unavailable'}]},stock:null,analysis:null,currentFormation:null,
  sourceEvidence:rawEvidence,calendar:{status:'unavailable'},observation:null,memory:{status:'not-requested'},readiness:{blockers:['没有取得可归档的日K']},...flags};
 if(!rawEvidence)throw Error('可用历史缺少原始响应档案');
 if(history.rawHash!==rawEvidence.sha256||history.stock.symbol!==options.symbol||history.stock.source!==history.source||
  history.stock.provider!==history.provider||history.stock.priceBasis!=='unadjusted'||history.stock.observedAt!==history.retrievedAt||
  !['eastmoney','tencent'].includes(history.provider)||history.retrievedAt>asOf||history.units?.volume!=='shares')throw Error('历史来源、证券身份、单位或可得时点不一致');
 const stock={...history.stock,name:typeof history.stock.name==='string'?history.stock.name.slice(0,64):''};
 const observation=retainStockObservation(observationRoot,{stock,observedAt:history.retrievedAt,
  context:{sourceEvidence:history.provenance,units:history.units,rawEvidence,trigger:options.trigger||'manual-research'}});
 const {stock:merged,...receipt}=observation;
 return buildObservationResearch({stock:merged,history:historySummary(history),observation:receipt,asOf,context,saveMemory:true},
  {memoryRoot,calendarFile,readCalendar,sectorCaptureRoot,sectorIds});
}
function readStockObservationResearch({symbol,provider},dependencies={}){
 if(!symbolOK(symbol)||!['eastmoney','tencent'].includes(provider))throw Error('读取档案需要明确股票与来源');
 const {observationRoot,memoryRoot,calendarFile,sectorCaptureRoot,sectorIds,now=Date.now,readCalendar=readResearchCalendar}=dependencies;
 const asOf=typeof now==='function'?now():now,stored=readObservedStock(observationRoot,symbol,{provider,priceBasis:'unadjusted',asOf});
 if(!stored.stock)return {schemaVersion:1,status:'empty',asOf,stock:null,observation:{revision:0},calendar:{status:'unavailable'},analysis:null,
  currentFormation:null,memory:{status:'not-requested'},readiness:{blockers:['该来源尚无股票观察档案']},...flags};
 const latest=stored.observations.at(-1);
 return buildObservationResearch({stock:stored.stock,observation:{revision:stored.revision,changed:false,observationHash:latest.observationHash,observationCount:stored.observationCount},asOf,
  history:{status:'stored-observation',source:stored.stock.source,provider,priceBasis:'unadjusted',retrievedAt:stored.stock.observedAt,sourceTimestamp:null,errors:[],archiveReadOnly:true}},
  {memoryRoot,calendarFile,readCalendar,sectorCaptureRoot,sectorIds});
}
module.exports={observeStock,readStockObservationResearch,buildObservationResearch,archiveRawEvidence,sectorCaptureResearch};
