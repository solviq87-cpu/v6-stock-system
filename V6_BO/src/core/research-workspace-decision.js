'use strict';
const {digest,FLAGS}=require('./research-workspace-store');
const fs=require('node:fs'),path=require('node:path');
const {compareRuleSystems}=require('../strategy/rule-comparison');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
const {normalizeMarketLinkageEvidence}=require('./market-sector-stock-linkage');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&x<=8e15;
const own=(o,k)=>o!=null&&Object.prototype.hasOwnProperty.call(o,k);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const dayValid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(Date.parse(d+'T00:00:00Z')).toISOString().slice(0,10)===d;
const valuePresent=x=>x!=null&&(typeof x!=='number'||finite(x))&&(typeof x!=='string'||x.trim()!=='');
function evidenceProblem(proof,symbol,at){
 if(!proof||typeof proof!=='object'||Array.isArray(proof))return '缺少证据对象';
 for(const key of ['symbol','code'])if(own(proof,key)&&proof[key]!=null&&proof[key]!==symbol)
  return '证据证券身份不一致';
 const keys=['sourceTimestamp','observedAt','knownAt','availableAt','receivedAt','recordedAt'];
 for(const key of keys)if(own(proof,key)&&proof[key]!=null&&!known(proof[key],at))
  return '证据时点无效或晚于研究判断: '+key;
 const observation=proof.observedAt??proof.sourceTimestamp;
 if(observation!=null&&['knownAt','availableAt','receivedAt','recordedAt'].some(k=>proof[k]!=null&&proof[k]<observation))
  return '证据可知时点早于原始观察';
 if(proof.availableAt!=null&&proof.recordedAt!=null&&proof.availableAt>proof.recordedAt)
  return '证据记录早于可得时点';
 return null;
}
// A parent receipt cannot attest a child observation known only later.
function nativeReceiptVisible(row,symbol,date,cutoff){
 if(!row||typeof row!=='object'||Array.isArray(row)||![Object.prototype,null].includes(Object.getPrototypeOf(row)))return false;
 if(evidenceProblem(row,symbol,cutoff))return false;
 for(const k of ['symbol','code'])if(own(row,k)&&row[k]!==symbol)return false;
 for(const k of ['date','tradeDate','observedThrough'])if(own(row,k)&&row[k]!==date)return false;
 for(const k of ['sourceTimestamp','observedAt','knownAt','availableAt','receivedAt','recordedAt'])
  if(own(row,k)&&!known(row[k],cutoff))return false;
 return true;
}
// Match the existing public-funds projection: incomplete daily totals are
// display-only, not three-day funds evidence for the native eight-word rule.
function closedWorkspaceFundDays(flow,symbol,bars,at){
 const flags=['simulated','synthetic','mock','fixture','testSample','retracted','fundsConflict','fundsSourceConflict'];
 const receiptClocks=['sourceTimestamp','firstObservedAt','retrievedAt','observedAt','knownAt','receivedAt','availableAt','recordedAt','fundsRetrievedAt','fundsSourceTimestamp'];
 const validMetadata=row=>row&&typeof row==='object'&&!Array.isArray(row)&&
  !flags.some(k=>[true,1,'true','1','是'].includes(row[k]))&&
  !['unknown','unavailable','not-requested','retracted','simulated','conflict','partial-evidence'].includes(row.status)&&
  row.partial!==true&&row.closed!==false&&row.isClosed!==false&&row.dailyResearchEligible!==false&&
  ['symbol','code'].every(k=>row[k]==null||row[k]===symbol)&&
  ['source','provider','upstream','fundsSource'].every(k=>row[k]==null||row[k]==='eastmoney')&&
  ['unit','fundsUnit','amountUnit','currency'].every(k=>row[k]==null||row[k]==='CNY')&&
  (row.fundsMethod==null||row.fundsMethod==='vendor-order-size-estimate');
 if(!validMetadata(flow)||flow.symbol!==symbol||!known(flow.retrievedAt,at)||evidenceProblem(flow,symbol,at)||
   !Array.isArray(flow.records)||flow.records.length>120||bars.length<3)return [];
 const dates=bars.slice(-3).map(b=>b.date);
 // Keep the exact latest three sessions; never skip a missing/unfinished
 // session and silently replace it with an older favorable observation.
 const selected=flow.records.filter(row=>dates.includes(row?.tradeDate));
 if(selected.length!==3||new Set(selected.map(row=>row.tradeDate)).size!==3)return [];
 const out=[];
 for(const date of dates){
  const row=selected.find(r=>r.tradeDate===date),end=Date.parse(date+'T15:10:00+08:00');
  if(!validMetadata(row)||!finite(row.mainNetInflow)||flow.retrievedAt<end||evidenceProblem(row,symbol,flow.retrievedAt)||
    row.fundsTradeDate!=null&&row.fundsTradeDate!==date)return [];
  // Never let receipt of a later batch certify an explicitly pre-close
  // observation. Legacy absent clocks remain unverified as before.
  if([flow,row].some(x=>receiptClocks.some(k=>x[k]!=null&&(!known(x[k],flow.retrievedAt)||x[k]<end))))return [];
  const aliases=['mainNetInflow','mainInflow','mainInflowYuan','netInflowYuan'].filter(k=>row[k]!=null);
  if(aliases.some(k=>!finite(row[k])||row[k]!==row.mainNetInflow))return [];
  out.push({date,main:row.mainNetInflow});
 }
 return out;
}
const SYSTEMS=['fourteen','bazi','gpt','python'];
function assessResearchAlignment(groups,{linked=false,marketRegime='unknown'}={}){
 const list=array(groups),rows=SYSTEMS.map(id=>{
  const matching=list.filter(x=>x?.id===id);
  if(matching.length!==1)return {system:id,verdict:'unknown',reason:matching.length?'体系身份重复':'体系未评估'};
  const row=matching[0],verdict=['pass','fail','watch','unknown'].includes(row.verdict)?row.verdict:'unknown';
  const complete=Number.isSafeInteger(row.total)&&row.total>0&&row.known===row.total&&
   Array.isArray(row.missing)&&row.missing.length===0;
  return {system:id,verdict,evidenceComplete:complete,
   reason:verdict==='unknown'?'原条件或必要证据未充分核对':verdict==='watch'?'原体系给出观察结论':!complete?'存在未核对条件':null};
 });
 const support=rows.filter(x=>x.verdict==='pass').map(x=>x.system);
 const opposition=rows.filter(x=>x.verdict==='fail').map(x=>x.system);
 const unresolved=rows.filter(x=>x.verdict==='unknown'||x.verdict==='watch'||!x.evidenceComplete).map(x=>x.system);
 const conflict=support.length>0&&opposition.length>0;
 const validRegime=['index-up','index-down','index-flat'].includes(marketRegime);
 const blockers=[...(linked!==true?['原归档证据未绑定']:[]),...(!validRegime?['同期市场环境未知']:[]),
  ...(unresolved.length?['四体系存在未完成证据或观察结论']:[]),...(opposition.length?['存在原生体系反对或未满足条件']:[])];
 const status=conflict?'strategy-disagreement':opposition.length?'opposition-present':
  blockers.length?'insufficient-evidence':support.length===SYSTEMS.length?'aligned-research-only':'insufficient-evidence';
 return {schemaVersion:1,status,action:status==='aligned-research-only'?'observe':'defer',systems:rows,
  support,opposition,unresolved,blockers,marketRegime:validRegime?marketRegime:'unknown',agreementIsIndependent:false,probability:null,combinedScore:null,
  researchOnly:true,canTrade:false,canNotify:false,productionWeightsChanged:false,
  note:'仅比较原生体系结论，不将相关条件相加为独立票数；分歧、反对、未知均需复核，不授予交易资格'};
}
const array=x=>Array.isArray(x)?x:[];
const known=(x,at)=>time(x)&&x<=at;
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
function sourceLink(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;u.search='';u.hash='';return u.href;}catch{return null;}}
function strategyVersions(){
 const files={fourteen:['../../myrules.js','../../analysis.js'],bazi:['../../bazi.js','../../analysis.js'],gpt:['multi-strategy-engine.js','strategy-engine.js','market-regime.js','../../strategies/a-share-strategy-pack.json'],python:['python-three-round-evidence.js']};
 return Object.fromEntries(Object.entries(files).map(([id,names])=>[id,id+'/'+digest(names.map(f=>fs.readFileSync(path.join(__dirname,f),'utf8'))).slice(0,16)]));
}
function buildWorkspaceDecision(result,{pythonEvidence,gptEvidence,fourteenEvidence,benchmarkEvidence,marketLinkageEvidence}={},{publicHistory=false}={}){
 const r=result||{},stock=r.stock,at=r.asOf,bundle=r.evidenceBundle;
 if(!stock||!/^\d{6}$/.test(stock.symbol)||!time(at)||!known(stock.observedAt,at)||
  !Array.isArray(stock.bars)||stock.bars.length>500||!(['eastmoney','tencent'].includes(stock.provider)||publicHistory&&stock.provider==='sina')||stock.source!==stock.provider||stock.priceBasis!=='unadjusted')throw Error('需要带身份和时点的已归档股票');
 if(at>Date.now()||stock.bars.some((b,i)=>!b||!dayValid(b.date)||i&&stock.bars[i-1].date>=b.date||
  !['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||!finite(b.volume)||b.volume<0))throw Error('归档K线顺序、价格或成交量无效');
 const bars=stock.bars.filter(b=>known(b.knownAt,at)&&b.date<=day(at)&&Date.parse(b.date+'T15:10:00+08:00')<=at&&b.knownAt>=Date.parse(b.date+'T15:10:00+08:00'));
 const last=bars.at(-1);if(!last)throw Error('没有截止研究时点的闭合日K');
 const marketLinkage=marketLinkageEvidence===undefined?null:normalizeMarketLinkageEvidence(marketLinkageEvidence,{asOf:at,tradeDate:last.date,provider:stock.provider,symbol:stock.symbol});
 let benchmarkSeries=null;
 if(benchmarkEvidence!==undefined){
  const b=benchmarkEvidence;
  if(b?.provider!==stock.provider||b.priceBasis!=='unadjusted'||b.frequency!=='1d'||typeof b.symbol!=='string'||!/^\d{6}$/.test(b.symbol)||
   typeof b.source!=='string'||!b.source.trim()||!Array.isArray(b.bars)||b.bars.length>500||b.bars.some((x,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||!Number.isFinite(Date.parse(x.date))||new Date(x.date).toISOString().slice(0,10)!==x.date||x.date>day(at)||i&&b.bars[i-1].date>=x.date||!finite(x.open)||x.open<=0||!known(x.knownAt,at)||x.knownAt<Date.parse(x.date+'T09:30:00+08:00')))throw Error('基准必须提供同来源、同未复权口径的已知开盘价序列');
  benchmarkSeries={provider:b.provider,symbol:b.symbol,source:b.source,priceBasis:b.priceBasis,frequency:b.frequency,bars:b.bars.map(x=>({date:x.date,open:x.open,knownAt:x.knownAt}))};
 }
 const linked=hash(bundle?.hash)&&hash(r.observation?.observationHash)&&
  bundle.symbol===stock.symbol&&bundle.provider===stock.provider&&bundle.priceBasis===stock.priceBasis&&bundle.observationHash===r.observation.observationHash&&
  known(bundle.decisionAt,at)&&known(bundle.recordedAt,Date.now())&&bundle.recordedAt>=bundle.decisionAt;
 const versions=strategyVersions();if(pythonEvidence?.evaluatorVersion)versions.python+=':'+pythonEvidence.evaluatorVersion;
 const bundleHash=linked?bundle.hash:null;
 const sourceRefs=linked?array(bundle.sourceRefs).filter(s=>s&&hash(s.sha256)&&known(s.receivedAt,at)&&typeof s.source==='string'&&s.source.trim())
  .map(s=>({source:s.source,hash:s.sha256,receivedAt:s.receivedAt,url:sourceLink(s.url)})):[];
 const nodes=[],rules=[];
 const add=(field,value,proof={},status)=>{
  const received=proof.recordedAt??proof.receivedAt??proof.availableAt??proof.knownAt??null;
  const available=proof.availableAt??proof.knownAt??received;
  const problem=evidenceProblem(proof,stock.symbol,at);
  const valid=status!=='unknown'&&valuePresent(value)&&!problem&&known(available,at)&&known(received,at);
  const data={symbol:stock.symbol,field,value:valid?value:null,source:proof.source||stock.source,
   sourceTimestamp:known(proof.sourceTimestamp,at)?proof.sourceTimestamp:null,
   periodEnd:known(proof.observedAt,at)?proof.observedAt:null,availableAt:known(available,at)?available:null,
   receivedAt:known(received,at)?received:null,evidenceRef:proof.evidenceId||bundleHash,
   bundleHash,status:!valid?'unknown':status||'observed-unverified',
   missingReason:valid?null:problem||'字段缺失、条件未知或缺少当时可得证据'};
  const id=digest(data);if(!nodes.some(n=>n.id===id))nodes.push({id,...data});return id;
 };
 const rowTime=last.knownAt;
 for(const field of ['open','high','low','close','volume','amount'])add(field,last[field],{source:stock.source,recordedAt:rowTime,observedAt:Date.parse(last.date+'T15:00:00+08:00'),evidenceId:r.observation?.observationHash});
 const statusRows=r.stockStatus?.securities||[];
 const actual={code:stock.symbol,name:stock.name,price:last.close};
 const flow=r.marketContext?.funds?.stock;
 const fundDays=closedWorkspaceFundDays(flow,stock.symbol,bars,at);
 const nativeRows=bars.map((b,i)=>({...b,pct:i?100*(b.close/bars[i-1].close-1):null}));
 let fourteen={stock:actual,rows:nativeRows};
 if(fourteenEvidence!==undefined){
  const e=fourteenEvidence,allowed=['symbol','date','knownAt','source','stock','sector','auction','aucTicks','lhb','profitRatio'];
  if(!e||Object.keys(e).some(k=>!allowed.includes(k))||e.symbol!==stock.symbol||e.date!==last.date||!known(e.knownAt,at)||typeof e.source!=='string'||!/^\w[\w./:-]{2,159}$/.test(e.source)||e.source.includes('://'))throw Error('十四条原生证据身份或时点无效');
  if(own(e.stock,'limitUpCount')&&e.knownAt<Date.parse(last.date+'T15:00:00+08:00'))throw Error('十四条连板证据早于当日收盘');
  const fields={stock:['floatCap','limitUpCount','breakCount','sealAmount','amount','preClose'],sector:['name','ztCount','pct'],auction:['auctionAmount','auctionPct'],lhb:['whale','whaleNet','netBuy','why']};
  for(const [group,keys]of Object.entries(fields))if(e[group]!==undefined){const v=e[group];if(!v||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||Object.entries(v).some(([k,x])=>['name','why'].includes(k)?typeof x!=='string'||x.length>500:k==='whale'?typeof x!=='boolean':!finite(x)))throw Error('十四条原生字段无效');}
  if(e.stock&&Object.values(e.stock).some(x=>x<0)||['limitUpCount','breakCount'].some(k=>e.stock?.[k]!==undefined&&!Number.isSafeInteger(e.stock[k]))||e.profitRatio!==undefined&&(!finite(e.profitRatio)||e.profitRatio<0||e.profitRatio>100))throw Error('十四条数值口径无效');
  if(e.aucTicks!==undefined){const t=e.aucTicks;if(!t||Object.keys(t).some(k=>!['preClose','bars'].includes(k))||!finite(t.preClose)||t.preClose<=0||!Array.isArray(t.bars)||t.bars.length>11||t.bars.some((b,i)=>Object.keys(b).some(k=>!['t','price','volume'].includes(k))||!/^09:(?:1[5-9]|2[0-5])$/.test(b.t)||i&&t.bars[i-1].t>=b.t||!finite(b.price)||b.price<=0||!finite(b.volume)||b.volume<0))throw Error('竞价分时证据无效');}
  fourteen={stock:{...e.stock,...actual},rows:nativeRows,...Object.fromEntries(['sector','auction','aucTicks','lhb','profitRatio'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))};
 }
 let scores={},gptMarket=null;
 if(gptEvidence!==undefined){
  if(gptEvidence?.symbol!==stock.symbol||gptEvidence.date!==last.date||!known(gptEvidence.knownAt,at)||typeof gptEvidence.source!=='string'||!/^\w[\w./:-]{2,159}$/.test(gptEvidence.source)||gptEvidence.source.includes('://'))throw Error('GPT因子证据必须匹配股票、日期和已知时间');
  if(!nativeReceiptVisible(gptEvidence,stock.symbol,last.date,at)||
     gptEvidence.scores!=null&&!nativeReceiptVisible(gptEvidence.scores,stock.symbol,last.date,gptEvidence.knownAt)||
     gptEvidence.market!=null&&!nativeReceiptVisible(gptEvidence.market,stock.symbol,last.date,gptEvidence.knownAt))
   throw Error('GPT子证据身份或可知时点无效');
  scores=Object.fromEntries(Object.entries(gptEvidence.scores||{}).filter(([,v])=>finite(v)&&v>=0&&v<=100));
  const fields=['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
  if(fields.every(k=>own(gptEvidence.market,k)&&finite(gptEvidence.market?.[k])&&gptEvidence.market[k]>=0&&gptEvidence.market[k]<=100))gptMarket=Object.fromEntries(fields.map(k=>[k,gptEvidence.market[k]]));
 }
 let pythonResult;
 if(pythonEvidence!==undefined){
  if(!known(pythonEvidence.knownAt,at))throw Error('Python证据已知时点无效');
  const p=evaluatePythonEvidence(pythonEvidence,{symbol:stock.symbol,date:last.date});
  if(!nativeReceiptVisible(pythonEvidence,stock.symbol,last.date,at)||!pythonEvidence.rounds.every(row=>nativeReceiptVisible(row,stock.symbol,last.date,pythonEvidence.knownAt)))
   throw Error('Python轮次证据身份或可知时点无效');
  pythonResult={provenance:p.provenance,date:last.date,rules:p.rounds.map(x=>({id:'round-'+x.round,label:'第'+x.round+'轮',observed:x.verdict,status:x.verdict,reason:x.reason}))};
 }
 const comparison=compareRuleSystems({scores,myrulesInput:fourteen,
  baziInput:{code:stock.symbol,name:stock.name,price:last.close,rows:nativeRows,fundDays},pythonResult});
 const systems=comparison.systems;
 // The legacy engine defaults missing limit-up/seal inputs to zero. The research
 // projection must not present those defaults as observed evidence.
 for(const r of systems.fourteen.rules)if(r.id===11&&!finite(fourteen.stock.limitUpCount)||r.id===9&&!['limitUpCount','breakCount','sealAmount','amount'].every(k=>finite(fourteen.stock[k])))Object.assign(r,{status:'unknown',observed:null,reason:'封板、连板及证券状态原始证据不足；不采用默认零值'});
 let gptVerdict='unknown';
 const pack=require('../../strategies/a-share-strategy-pack.json');
 if(gptMarket&&[...new Set(pack.strategies.flatMap(s=>s.rules.map(r=>r.field)))].every(f=>finite(scores[f])))
  gptVerdict=require('./multi-strategy-engine').evaluateMultiStrategy({snapshot:scores,market:gptMarket,strategies:pack.strategies}).pass?'pass':'fail';
 const addRule=(system,rule,coverageOnly=false)=>{
  const proof={source:system==='python'?pythonResult?.provenance:system==='gpt'?gptEvidence?.source:system==='fourteen'&&fourteenEvidence?fourteenEvidence.source:'v6-native/'+system,
   availableAt:system==='python'?pythonEvidence?.knownAt:system==='gpt'?gptEvidence?.knownAt:system==='fourteen'&&fourteenEvidence?fourteenEvidence.knownAt:at,recordedAt:at,evidenceId:bundleHash};
  const node=add(system+':'+(rule.field||rule.id||rule.label),rule.observed??rule.score??rule.value??null,proof,
   ['pass','fail'].includes(rule.status)?'derived-unverified':'unknown');
  const admitted=nodes.find(n=>n.id===node);
  const state=admitted.status!=='unknown'&&['pass','fail'].includes(rule.status)?rule.status:'unknown';
  rules.push({id:system+':'+(rule.id||rule.label),system,name:rule.label||rule.id,
   field:String(rule.field??rule.id??rule.label),value:state==='unknown'?null:admitted.value,op:rule.op||null,threshold:rule.threshold??null,
   status:state,coverageOnly,evidenceIds:[node],
   reason:state==='unknown'?(rule.reason||admitted.missingReason):(rule.reason||null),invalidation:'原条件或其来源证据不再成立时复查',version:versions[system]});
 };
 array(systems.fourteen.rules).forEach(x=>addRule('fourteen',x));
 array(systems.bazi.dimensions).forEach(x=>addRule('bazi',x,true));
 array(systems.gpt).forEach((s,i)=>array(s.rules).forEach(x=>addRule('gpt',{...x,id:i+':'+x.id,label:s.name+' · '+x.label})));
 if(!gptMarket)addRule('gpt',{id:'market-context',label:'原生市场环境输入',status:'unknown',reason:'缺少同一时点六项市场评分，不采用默认中性值'});
 array(systems.python.rules).forEach(x=>addRule('python',x));
 if(!systems.python.available)addRule('python',{id:'native-three-rounds',label:'原生三轮结果',status:'unknown',reason:systems.python.reason});
 const research36=r.research36;
 const research36Visible=research36?.code===stock.symbol&&(!own(research36,'asOf')||known(research36.asOf,at));
 for(const rule of array(research36Visible?research36.evaluations:[]))for(const c of array(rule.checks)){
  const id=add(c.field,c.value,c.evidence||{},c.missing||c.pass!==true&&c.pass!==false?'unknown':undefined);
  const admitted=nodes.find(n=>n.id===id),missing=c.missing||admitted.missingReason;
  rules.push({id:rule.id+':'+c.field,system:'research36',name:rule.name,field:c.field,value:missing?null:admitted.value,
   op:c.op||null,threshold:c.threshold??null,status:missing||c.pass!==true&&c.pass!==false?'unknown':c.pass?'pass':'fail',
   coverageOnly:false,evidenceIds:[id],reason:missing||null,invalidation:rule.invalidation||null,version:typeof r.research36?.version==='string'?r.research36.version:digest(r.research36?.version||'research36')});
 }
 const conditionGroups=['fourteen','bazi','gpt','python'].map(id=>{
  const rows=rules.filter(x=>x.system===id),missing=rows.filter(x=>x.status==='unknown');
  const coverageOnly=id==='bazi';
  let verdict=missing.length||!rows.length?'unknown':coverageOnly?'coverage-only':rows.some(x=>x.status==='fail')?'fail':'pass';
 if(id==='fourteen'){
  const exclusion=rows.find(x=>x.id==='fourteen:11'),required=systems.fourteen.requiredHits;
  const hits=rows.filter(x=>x.status==='pass').length;
  verdict=exclusion?.status==='fail'?'fail':exclusion?.status!=='pass'||!Number.isSafeInteger(required)||required<1||required>rows.length?'unknown':
   hits>=required?'pass':hits+missing.length<required?'fail':'unknown';
 }
 if(id==='gpt')verdict=missing.length||!rows.length?'unknown':gptVerdict;
 if(id==='bazi'){
  const native=systems.bazi.raw;
  verdict=missing.length||!rows.length||native?.insufficient?.length||native?.coverage?.criticalMissing?.length?'unknown':
   native?.verdict==='可介入'?'pass':native?.verdict==='观察'?'watch':native?.verdict==='回避'?'fail':'unknown';
 }
  return {id,label:{fourteen:'十四条',bazi:'八字口诀',gpt:'GPT五策略',python:'Python三轮'}[id],verdict,coverageOnly,
   support:coverageOnly?[]:rows.filter(x=>x.status==='pass'),opposition:coverageOnly?[]:rows.filter(x=>x.status==='fail'),missing,
   known:rows.length-missing.length,total:rows.length,version:versions[id],nativeVerdict:id==='bazi'?systems.bazi.raw?.verdict:null};
 });
 const index=linked&&r.linkage?.sameMarketTradeDate===true&&r.linkage.tradeDate===last.date&&r.linkage.marketTradeDate===last.date?r.linkage.indices:null;
 const regime=finite(index?.shanghaiChangePct)?index.shanghaiChangePct>0?'index-up':index.shanghaiChangePct<0?'index-down':'index-flat':'unknown';
 const decisionAssessment=assessResearchAlignment(conditionGroups,{linked:linked&&known(bundle.recordedAt,at)&&sourceRefs.length>0,marketRegime:regime});
 return {schemaVersion:1,...FLAGS,asOf:at,symbol:stock.symbol,name:stock.name||'',provider:stock.provider,tradeDate:last.date,
  priceBasis:stock.priceBasis,observationHash:r.observation?.observationHash||null,bundleHash,sourceRefs,
  inputCoverage:{providedBars:stock.bars.length,admittedClosedBars:bars.length,excludedBars:stock.bars.length-bars.length},
  conditions:rules,evidence:nodes,systems:conditionGroups,decisionAssessment,regime,regimeMeaning:'同日上证涨跌方向分组，不是行情因果或生产市场择时',
  nativeInputs:{fourteen:fourteenEvidence||null,gpt:gptEvidence?{symbol:stock.symbol,date:last.date,knownAt:gptEvidence.knownAt,source:gptEvidence.source,scores,market:gptMarket}:null,python:pythonEvidence||null},
  context:{linkage:linked?r.linkage||null:null,sectorContext:linked?bundle.sectorContext:null,financials:linked?bundle.marketContext?.financials:null,
   indices:linked?bundle.marketContext?.indices:null,marketLinkageEvidence:marketLinkage},
  bars:bars.map(b=>Object.fromEntries(['date','open','high','low','close','volume','amount','knownAt','statusKnownAt','suspended','tradable','isST','corporateAction','corporateActionKnownAt','limitUpPrice','limitReferencePrice','limitPct','noPriceLimit','limitKnownAt'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]))),
  tradeDates:array(r.analysis?.tradeDates),calendarEvidence:r.calendar?.metadata||null,benchmarkSeries,targetDate:r.calendar?.nextTradeDate||null,dueAt:r.priceEventResearch?.currentHypothesis?.dueAt||null,
  originalResearch:r.decisionReview||null,sourceStatus:r.history?.status||'unknown',statusEvidence:statusRows.length,
  diagnostics:array(r.decisionReview?.diagnostics),
  limitations:['四体系条件独立，不相加为买卖票数','八字维度pass仅表示评分证据存在','研究观察不认证供应商真实性或可成交性']};
}
// Compare semantic fields, not node IDs that also hash capture time and bundle.
function evidenceMeaning(nodes,row){
 return [...new Set(array(row.evidenceIds).map(id=>{
  const n=nodes.get(id);
  return n?JSON.stringify(['symbol','field','value','source','sourceTimestamp','periodEnd','status','missingReason'].map(k=>n[k]??null)):JSON.stringify(['unresolved-reference']);
 }))].sort();
}
// Overall alignment may change even if every rule and verdict is unchanged.
function assessmentMeaning(run){
 const v=run?.decisionAssessment;
 const text=k=>typeof v?.[k]==='string'?v[k]:null;
 const set=k=>Array.isArray(v?.[k])&&v[k].every(x=>typeof x==='string')?[...new Set(v[k])].sort():null;
 return {status:text('status'),action:text('action'),marketRegime:text('marketRegime'),
  support:set('support'),opposition:set('opposition'),unresolved:set('unresolved'),blockers:set('blockers')};
}
function conditionChanges(current,previous){
 if(!previous)return {status:'first-observation',changes:[],systemChanges:[],assessmentChanges:[]};
 if(current.symbol!==previous.symbol||current.provider!==previous.provider||current.priceBasis!==previous.priceBasis)throw Error('不同身份不能直接比较判断');
 const old=new Map(array(previous.conditions).map(r=>[r.id,r])),changes=[];
 const currentNodes=new Map(array(current.evidence).map(n=>[n.id,n])),previousNodes=new Map(array(previous.evidence).map(n=>[n.id,n]));
 for(const r of array(current.conditions)){
  const p=old.get(r.id);if(!p){changes.push({condition:r.id,name:r.name,kind:'added',after:r.status});continue;}
  const changed=['status','value','threshold','op','version','field','coverageOnly','reason','invalidation'].filter(k=>JSON.stringify(r[k])!==JSON.stringify(p[k]));
  if(JSON.stringify(evidenceMeaning(currentNodes,r))!==JSON.stringify(evidenceMeaning(previousNodes,p)))changed.push('evidence');
  if(changed.length)changes.push({condition:r.id,name:r.name,kind:r.version!==p.version?'rule-version-changed':
   current.tradeDate===previous.tradeDate&&(current.observationHash!==previous.observationHash||current.bundleHash!==previous.bundleHash)?'data-revision':'observed-change',
   fields:changed,before:{status:p.status,value:p.value,threshold:p.threshold},after:{status:r.status,value:r.value,threshold:r.threshold},
   previousEvidence:p.evidenceIds,currentEvidence:r.evidenceIds});
  old.delete(r.id);
 }
 for(const p of old.values())changes.push({condition:p.id,name:p.name,kind:'removed',before:p.status});
 const before=assessmentMeaning(previous),after=assessmentMeaning(current);
 const assessmentChanges=Object.keys(after).filter(field=>JSON.stringify(before[field])!==JSON.stringify(after[field]))
  .map(field=>({field,before:before[field],after:after[field]}));
 return {status:'compared',sameTarget:current.targetDate===previous.targetDate,previousAsOf:previous.asOf,assessmentChanges,
  meaning:'字段和证据变化，不推断股票涨跌原因；不同目标日不作相同预测比较',changes,
  systemChanges:array(current.systems).filter(s=>previous.systems?.find(p=>p.id===s.id)?.verdict!==s.verdict).map(s=>({system:s.id,before:previous.systems?.find(p=>p.id===s.id)?.verdict??'unknown',after:s.verdict,version:s.version}))};
}
function screeningRecord(result,{provenance='provided-unverified',asOf=Date.now()}={}){
 const items=array(result?.items);if(items.length>2000)throw Error('筛选输入超过2000只');
 const seen=new Set();
 const rows=items.map((r,i)=>{
  const symbol=r.symbol||r.code;if(!/^\d{6}$/.test(symbol||'')||seen.has(symbol))throw Error('筛选证券无效或重复');seen.add(symbol);
  const checks=[['quality',r.quality?.usable,array(r.quality?.errors).join('；')],['risk',typeof r.blockedBySafety==='boolean'?!r.blockedBySafety:null,array(r.strategy?.riskFilter?.reasons).join('；')],
   ['strategy',r.strategy?.pass,null],['eligibility',r.tradable,null]];
  const rejected=checks.filter(([,p])=>p!==true);
  return {symbol,name:r.name||'',rank:i+1,score:finite(r.score)?r.score:null,status:!rejected.length?'selected':rejected[0][1]===false?'rejected':'unknown',
   firstReason:rejected[0]?.[0]||null,reasons:rejected.map(([stage,p,reason])=>({stage,status:p===false?'failed':'unknown',reason:reason||({quality:'来源或数据证据不足',risk:'风险过滤未通过或未知',strategy:'原策略条件未满足或未知',eligibility:'候选资格或时效未满足'}[stage])})),
   stages:checks.map(([stage,p])=>({stage,status:p===true?'pass':p===false?'fail':'unknown'})),conditions:r.strategy?.topDrivers||[],provenance};
 });
 return {asOf,provenance,total:rows.length,rows,funnel:result.screeningFunnel||require('./research-decision-review').buildScreeningFunnel(items),...FLAGS};
}
module.exports={buildWorkspaceDecision,conditionChanges,screeningRecord,sourceLink,strategyVersions,assessResearchAlignment};
