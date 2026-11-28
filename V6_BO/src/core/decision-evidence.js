'use strict';
// Descriptive evidence only: these scores never certify a feed, resize an order,
// change the account's stops or promote a learned parameter.
const {financialFeatures}=require('./public-stock-financials');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const time=v=>Number.isSafeInteger(v)&&v>0&&v<8e15;
const dayOf=at=>new Date(at+28800000).toISOString().slice(0,10);
const codeOK=v=>typeof v==='string'&&/^\d{6}$/.test(v);
const real=value=>value&& !['simulated','synthetic','mock','fixture','retracted','readOnlyBackup','imported'].some(k=>value[k]===true)&&
 !/synthetic|fixture|mock|demo|simulated/i.test(String(value.source||value.quoteSource||''));
const round=v=>Math.round(v*100)/100;
const clamp=v=>Math.max(0,Math.min(100,v));
const VERSION='decision-evidence-v1';
const flags={researchOnly:true,canTrade:false,canNotify:false,calibrationCertified:false};
const financialFields=['roePct','roePriorYearPct','earningsGrowthPct','revenueGrowthPct'];
const MAX_RAW_BYTES=2*1024*1024;
const rawError=message=>Object.assign(Error(message),{code:'FAYO_FINANCIAL_RAW_INVALID'});

// Read the original stock-observation archive without creating directories,
// restoring files or following links. The bytes, not merely the bundle's hash
// reference, must still be present and match the recorded receipt exactly.
function verifyFinancialRaw(observationRoot,reference){
 let fd;
 try{
  if(typeof observationRoot!=='string'||!path.isAbsolute(observationRoot)||observationRoot.includes('\0'))throw rawError('原始财报响应目录未配置或无效');
  const root=path.resolve(observationRoot),dir=path.join(root,'source-responses');
  if(root===path.parse(root).root||root.split(path.sep).some(part=>part.toLowerCase()==='public'))throw rawError('原始财报响应目录必须位于私有存储');
  if(!/^[a-f0-9]{64}$/.test(reference?.sha256||'')||!Number.isSafeInteger(reference?.byteLength)||reference.byteLength<=0||reference.byteLength>MAX_RAW_BYTES)throw rawError('原始财报响应的哈希或尺寸回执无效');
  let current=path.parse(dir).root;
  for(const part of dir.slice(current.length).split(path.sep).filter(Boolean)){
   current=path.join(current,part);const st=fs.lstatSync(current);
   if(st.isSymbolicLink()||!st.isDirectory())throw rawError('原始财报响应路径含软链接或非目录');
   if((current===root||current===dir)&&(st.mode&0o077)!==0)throw rawError('原始财报响应目录权限不是私有权限');
  }
  const file=path.join(dir,reference.sha256+'.json'),before=fs.lstatSync(file);
  if(before.isSymbolicLink()||!before.isFile())throw rawError('原始财报响应文件不是独立普通文件或含软链接');
  if((before.mode&0o077)!==0)throw rawError('原始财报响应文件权限不是私有权限');
  if(before.size!==reference.byteLength)throw rawError('原始财报响应尺寸与封存回执不一致');
  if(!Number.isSafeInteger(fs.constants.O_NOFOLLOW)||!fs.constants.O_NOFOLLOW)throw rawError('当前环境无法安全校验原始财报响应');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|(fs.constants.O_NONBLOCK||0));
  const opened=fs.fstatSync(fd);
  if(!opened.isFile()||(opened.mode&0o077)!==0||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==reference.byteLength)throw rawError('原始财报响应在读取前已变化');
  const bytes=Buffer.alloc(reference.byteLength+1);let length=0,read;
  while(length<bytes.length&&(read=fs.readSync(fd,bytes,length,bytes.length-length,null))>0)length+=read;
  const after=fs.fstatSync(fd);
  if(length!==reference.byteLength||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||(after.mode&0o077)!==0)throw rawError('原始财报响应在读取期间已变化');
  if(crypto.createHash('sha256').update(bytes.subarray(0,length)).digest('hex')!==reference.sha256)throw rawError('原始财报响应内容与封存 SHA256 不一致');
  return true;
 }catch(error){
  if(error.code==='FAYO_FINANCIAL_RAW_INVALID')throw error;
  if(error.code==='ENOENT')throw rawError('原始财报响应文件或私有目录缺失');
  if(error.code==='ELOOP')throw rawError('原始财报响应路径含软链接');
  throw rawError('原始财报响应无法安全读取，未通过完整性校验');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}

// F19.1 supplementary research evidence: never a new scoring rule or trade gate.
function seasonalCashEvidence(features,{code,day,now}){
 const empty={status:'unknown',current:null,prior:null,differenceCnyPerShare:null,knownAt:null,
  unit:'CNY/share',industryComparison:null,orderEvidence:null,initialDisclosureVerified:false,
  basis:'same-report-period; latest received revision, not initial disclosure',researchOnly:true,canTrade:false,canTrain:false,canNotify:false};
 const valid=v=>v&&v.code===code&&v.source==='eastmoney-financials'&&v.unit==='CNY/share'&&
  v.periodKind==='period'&&finite(v.value)&&time(v.availableAt)&&v.availableAt<=now&&
  time(v.recordedAt)&&v.recordedAt===v.availableAt&&typeof v.evidenceId==='string'&&/^[a-f0-9]{64}:/.test(v.evidenceId);
 const current=features.operatingCashPerShare,prior=features.operatingCashPerSharePriorYear;
 if(!time(now)||day!==dayOf(now)||!valid(current)||!valid(prior))return empty;
 const age=Date.parse(day+'T00:00:00+08:00')-Date.parse(current.reportDate+'T00:00:00+08:00');
 if(!finite(age)||age<0||age>220*86400000||prior.reportDate!==String(Number(current.reportDate.slice(0,4))-1)+current.reportDate.slice(4)||
  current.availableAt!==prior.availableAt||current.evidenceId.split(':')[0]!==prior.evidenceId.split(':')[0])return empty;
 const difference=current.value-prior.value;
 if(!finite(difference))return empty;
 return {...empty,status:'observed-unverified',current,prior,differenceCnyPerShare:difference,knownAt:current.availableAt};
}

// F19.2-4: preserve same-period company operational evidence without
// treating turnover days as industry demand or guessing a peer valuation.
function operatingResearch(features,{code,day,now}){
 const valid=(v,unit)=>v&&v.code===code&&v.source==='eastmoney-financials'&&v.periodKind==='period'&&
  v.unit===unit&&finite(v.value)&&time(v.availableAt)&&v.availableAt<=now&&v.recordedAt===v.availableAt&&
  typeof v.evidenceId==='string'&&/^[a-f0-9]{64}:/.test(v.evidenceId);
 const rows=[['grossMarginPct','percent'],['netMarginPct','percent'],['receivableDays','days'],['inventoryDays','days']].map(([field,unit])=>{
  const current=features[field],prior=features[field+'PriorYear'];
  const empty={field,unit,status:'unknown',current:null,prior:null,delta:null};
  if(!time(now)||day!==dayOf(now)||!valid(current,unit)||!valid(prior,unit)||
   unit==='days'&&(current.value<0||prior.value<0))return empty;
  const age=Date.parse(day+'T00:00:00+08:00')-Date.parse(current.reportDate+'T00:00:00+08:00');
  if(!finite(age)||age<0||age>220*86400000||prior.reportDate!==String(Number(current.reportDate.slice(0,4))-1)+current.reportDate.slice(4)||
   current.availableAt!==prior.availableAt||current.evidenceId.split(':')[0]!==prior.evidenceId.split(':')[0]||
   !finite(current.value-prior.value))return empty;
  return {...empty,status:'observed-unverified',current,prior,delta:current.value-prior.value,
   direction:unit==='days'?'turnover-days-change-only':current.value<prior.value?'lower-than-prior-report-period':'not-lower-than-prior-report-period'};
 });
 const margins=rows.filter(r=>r.unit==='percent'),lower=margins.every(r=>r.status==='observed-unverified'&&r.delta<0);
 return {status:rows.some(r=>r.status==='observed-unverified')?'company-observations-only':'unknown',rows,
  industryDemand:{status:'unknown',value:null,reason:'无带时点、单位和历史修订的同行业供需原始材料'},
  earningsGuidance:{status:'unknown',companyGuidanceRevision:null,consensusExpectation:null,reason:'无可核对的原公司指引修订及独立一致预期；与F07原公告链联动待验'},
  valuationDivergence:{status:'unknown',peerValuation:null,priceDivergence:null,persistentDeterioration:null,
   samePeriodMarginsBothLower:margins.every(r=>r.status==='observed-unverified')?lower:null,
   reason:'同报告期毛利率和净利率下降仅是公司经营反证；没有同行估值、原价格基准和连续修订，不能判定背离或低估'},
  initialDisclosureVerified:false,researchOnly:true,canTrade:false,canNotify:false,canTrain:false};
}
function fundamentalEvidence(financials,{code,day,now=Date.now()}={}){
 const missing=[];
 let features={};
 try{if(real(financials)&&Object.values(financials.datasets||{}).every(real))features=financialFeatures(financials,{code,asOf:now});}catch{ /* Invalid receipts remain absent. */ }
 const valid=field=>{
  const v=features[field];
  return v&&v.code===code&&v.source==='eastmoney-financials'&&v.unit==='percent'&&finite(v.value)&&
   time(v.availableAt)&&v.availableAt<=now&&time(v.recordedAt)&&v.recordedAt<=now&&
   typeof v.evidenceId==='string'&&/^[a-f0-9]{64}:/.test(v.evidenceId);
 };
 for(const field of financialFields)if(!valid(field))missing.push(({roePct:'累计 ROE',roePriorYearPct:'上年同报告期 ROE',
  earningsGrowthPct:'单季度净利润同比',revenueGrowthPct:'单季度营收同比'})[field]);
 const period=features.roePct?.reportDate;
 if(!missing.length){
  if(features.earningsGrowthPct.reportDate!==period||features.revenueGrowthPct.reportDate!==period||
   features.roePriorYearPct.reportDate!==String(Number(period.slice(0,4))-1)+period.slice(4))missing.push('一致报告期与上年同期');
  // This is a current report assessment, never a fabricated historical release.
  if(Date.parse(day+'T00:00:00+08:00')-Date.parse(period+'T00:00:00+08:00')>220*86400000)missing.push('220日内的报告期');
 }
 const inputs=financialFields.filter(valid).map(field=>({field,...features[field]}));
 const sourceTimes=inputs.map(v=>({source:v.source,sourceAt:v.availableAt,knownAt:v.availableAt,
  reportDate:v.reportDate,publicationDate:v.publicationDate,updatedDate:v.updatedDate,evidenceId:v.evidenceId}));
 const rules=missing.length?[]:[
  {id:'positive-roe',label:'累计 ROE 为正',value:features.roePct.value,operator:'>',threshold:0,pass:features.roePct.value>0},
  {id:'roe-not-lower',label:'ROE 不低于上年同期',value:features.roePct.value,operator:'>=',threshold:features.roePriorYearPct.value,pass:features.roePct.value>=features.roePriorYearPct.value},
  {id:'profit-growth',label:'单季净利润同比非负',value:features.earningsGrowthPct.value,operator:'>=',threshold:0,pass:features.earningsGrowthPct.value>=0},
  {id:'revenue-growth',label:'单季营收同比非负',value:features.revenueGrowthPct.value,operator:'>=',threshold:0,pass:features.revenueGrowthPct.value>=0}
 ];
 const hits=rules.filter(rule=>rule.pass).length;
 return {code,day,score:rules.length?hits/4*100:null,value:rules.length?hits/4*100:null,
  source:inputs.length?'eastmoney-financials':null,knownAt:inputs.length?Math.max(...inputs.map(v=>v.availableAt)):null,
  sourceAt:inputs.length?Math.max(...inputs.map(v=>v.availableAt)):null,reportDate:period||null,
  reason:rules.length?period+' 财报：累计 ROE '+features.roePct.value+'%，上年同期 '+features.roePriorYearPct.value+
   '%；单季利润同比 '+features.earningsGrowthPct.value+'%，营收同比 '+features.revenueGrowthPct.value+'%；四项规则满足 '+hits+'/4。':
   '缺少'+(missing.join('、')||'可核验财报原始回执'),
  formula:'100 × 满足的四项财务规则 / 4；四项输入全部可核验才评分，不是估值或盈利概率',
  ruleVersion:VERSION,inputs,rules,sourceTimes,missing,seasonalCash:seasonalCashEvidence(features,{code,day,now}),operatingResearch:operatingResearch(features,{code,day,now}),...flags};
}

function quoted(row,day,now){
 return real(row)&&codeOK(row.code)&&typeof row.quoteSource==='string'&&!!row.quoteSource&&
  time(row.quoteAt)&&row.quoteAt<=now&&dayOf(row.quoteAt)===day&&time(row.receivedAt)&&row.receivedAt>=row.quoteAt&&row.receivedAt<=now&&
  [row.poolDay,row.tradeDate,row.sourceTradeDate].filter(Boolean).every(v=>String(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')===day);
}
function liquidityEvidence(row,{day,now=Date.now()}={}){
 // Only the normalized, existing mainland quote adapters have this documented
 // yuan contract. A new provider must explicitly identify its amount unit.
 const normalized=/^(?:eastmoney|tencent|sina)$/.test(row.quoteSource||'')&&row.quoteMode==='public-live-unverified';
 const unit=row.amountUnit||row.quoteUnits?.amount||(normalized?'CNY':null);
 const valid=quoted(row,day,now)&&unit==='CNY'&&finite(row.amount)&&row.amount>=0;
 const reason=valid?'截至原报价时点累计成交额 '+row.amount+' 元；按固定对数尺度映射，盘初与收盘读数不可直接比较。':
  !quoted(row,day,now)?'缺少同股、同日原始报价与接收时点':unit!=='CNY'?'成交额的人民币单位未核实':'累计成交额缺失，未用成交量猜金额';
 return {code:row.code,day,value:valid?round(clamp(100*Math.log10(1+row.amount/1000000)/3)):null,
  source:valid?row.quoteSource:null,knownAt:valid?row.receivedAt:null,sourceAt:valid?row.quoteAt:null,
  sourceTimes:valid?[{source:row.quoteSource,sourceAt:row.quoteAt,knownAt:row.receivedAt}]:[],
  reason,formula:'min(100, 100 × log10(1 + 当日累计成交额元 / 1000000) / 3)',
  inputs:valid?{amountYuan:row.amount,quoteAt:row.quoteAt,receivedAt:row.receivedAt,unitBasis:normalized?'原 em.js 标准报价字段':'显式 amountUnit'}:null,
  missing:valid?[]:[reason],ruleVersion:VERSION,...flags};
}
function riskEvidence(row,{day,now=Date.now(),account,accountEvidence}={}){
 const level=row.levelsEvidence,policy=account?.executionPolicy||{},allocation=finite(policy.allocationPct)?policy.allocationPct:
  Number.isSafeInteger(policy.maxPositions)&&policy.maxPositions>0?98/policy.maxPositions:null;
 const budget=finite(allocation)&&allocation>0&&allocation<=100&&finite(account?.equity)&&account.equity>0&&finite(account?.cash)&&account.cash>=0?
  Math.min(allocation,account.cash/account.equity*100):null;
 const valid=quoted(row,day,now)&&finite(row.price)&&row.price>0&&finite(row.levels?.stop)&&row.levels.stop>0&&row.levels.stop<row.price&&
  level&&typeof level.source==='string'&&level.source&&time(level.sourceAt)&&level.sourceAt<=now&&level.quoteAt===row.quoteAt&&
  budget!==null&&accountEvidence?.kind==='server-account-snapshot'&&typeof accountEvidence.source==='string'&&accountEvidence.source&&
  time(accountEvidence.sourceAt)&&accountEvidence.sourceAt<=now&&now-accountEvidence.sourceAt<=15000;
 const lossPct=valid?(row.price-row.levels.stop)/row.price*budget:null;
 const reason=valid?'按计划止损价成交的假设下，单票亏损约占账户 '+round(lossPct)+'%；跳空、滑点、费用与 T+1 可能扩大损失，不是亏损上限。':
  '缺少同日报价、归因止损位或15秒内的原账户预算，无法核算计划风险';
 return {code:row.code,day,value:valid?round(clamp(100-lossPct*25)):null,source:valid?'原报价、K线计划与模拟账户':null,
  knownAt:valid?Math.max(row.receivedAt,level.sourceAt,accountEvidence.sourceAt):null,
  sourceTimes:valid?[{source:row.quoteSource,sourceAt:row.quoteAt,knownAt:row.receivedAt},
   {source:level.source,sourceAt:level.sourceAt},{source:accountEvidence.source,sourceAt:accountEvidence.sourceAt}]:[],
  reason,formula:'max(0, 100 − 25 × ((原价 − 计划止损) / 原价 × 计划仓位百分比))',
  inputs:valid?{price:row.price,stop:row.levels.stop,positionPct:budget,accountLossPct:round(lossPct)}:null,
  missing:valid?[]:[reason],ruleVersion:VERSION,...flags};
}
function enrichDecisionEvidence(row,{financials,financialMissing,day,now=Date.now(),account,accountEvidence}={}){
 const fundamental=fundamentalEvidence(financials,{code:row.code,day,now});
 if(financialMissing&&!financials)fundamental.reason=financialMissing+'；'+fundamental.reason;
 const liquidity=liquidityEvidence(row,{day,now}),risk=riskEvidence(row,{day,now,account,accountEvidence});
 return {...row,fundamentalEvidence:fundamental,factorScores:{...row.factorScores,fundamental,liquidity,risk}};
}

function createDecisionFinancialReader({evidenceRoot,observationRoot,clock=Date.now,ttlMs=30000,readBundle,readRaw}={}){
 const reader=readBundle||require('./research-evidence-bundle').readResearchFinancialEvidenceBundle,
  checkRaw=readRaw||verifyFinancialRaw,cache=new Map();
 function read(codes,{now=clock()}={}){
  const byCode={},missingByCode={};
  for(const code of [...new Set(Array.isArray(codes)?codes:[])].filter(codeOK).slice(0,50)){
   let item=cache.get(code);
   if(!item||now<item.checkedAt||now-item.checkedAt>=ttlMs){
    const candidates=[],checkedRaw=new Set();let invalid=false,rawFailure=null;
    for(const provider of ['eastmoney','tencent']){
     try{
      const bundle=reader(evidenceRoot,{symbol:code,provider,asOf:now}),data=bundle?.marketContext?.financials;
      if(!data)continue;
      if(bundle.symbol!==code||!time(bundle.decisionAt)||bundle.decisionAt>now||!real(data)||data.symbol!==code)throw Error('invalid financial identity');
      const sets=Object.values(data.datasets||{});
      if(!sets.length)throw Error('financial receipt not archived');
      for(const set of sets){
       const refs=Array.isArray(bundle.sourceRefs)?bundle.sourceRefs.filter(ref=>ref.sha256===set.rawHash&&ref.source==='eastmoney-financials'&&ref.receivedAt===set.receivedAt):[];
       if(!real(set)||!time(set.receivedAt)||set.receivedAt>now||!refs.length||refs.some(ref=>!Number.isSafeInteger(ref.byteLength)||ref.byteLength<=0||ref.byteLength>MAX_RAW_BYTES)||
        new Set(refs.map(ref=>ref.byteLength)).size!==1)throw Error('financial receipt not archived');
       const rawKey=refs[0].sha256+':'+refs[0].byteLength;
       if(!checkedRaw.has(rawKey)){
        if(checkRaw(observationRoot,refs[0])!==true)throw rawError('原始财报响应未通过完整性校验');
        checkedRaw.add(rawKey);
       }
      }
      candidates.push({data,knownAt:Math.max(...sets.map(set=>set.receivedAt))});
     }catch(error){invalid=true;if(error.code==='FAYO_FINANCIAL_RAW_INVALID')rawFailure=error.message;}
    }
    candidates.sort((a,b)=>b.knownAt-a.knownAt);
    const ambiguous=candidates.length>1&&candidates[0].knownAt===candidates[1].knownAt&&
     JSON.stringify(candidates[0].data.datasets)!==JSON.stringify(candidates[1].data.datasets);
    item={checkedAt:now,data:!invalid&&!ambiguous?candidates[0]?.data||null:null,
     missing:invalid?rawFailure||'原财报档案完整性或来源回执校验未通过':ambiguous?'相同时点的财报档案冲突':'尚无已封存的原始财报回执'};
    cache.set(code,item);while(cache.size>60)cache.delete(cache.keys().next().value);
   }
   if(item.data)byCode[code]=item.data;else missingByCode[code]=item.missing;
  }
  return {byCode,missingByCode,checkedAt:now,...flags};
 }
 return {read,invalidate:code=>cache.delete(code)};
}
module.exports={fundamentalEvidence,liquidityEvidence,riskEvidence,enrichDecisionEvidence,createDecisionFinancialReader,VERSION};
