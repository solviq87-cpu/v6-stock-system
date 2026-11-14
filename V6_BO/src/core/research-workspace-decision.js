'use strict';
const {digest,FLAGS}=require('./research-workspace-store');
const fs=require('node:fs'),path=require('node:path');
const {compareRuleSystems}=require('../strategy/rule-comparison');
const {evaluatePythonEvidence}=require('./python-three-round-evidence');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const array=x=>Array.isArray(x)?x:[];
const known=(x,at)=>time(x)&&x<=at;
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
function sourceLink(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;u.search='';u.hash='';return u.href;}catch{return null;}}
function strategyVersions(){
 const files={fourteen:['../../myrules.js','../../analysis.js'],bazi:['../../bazi.js','../../analysis.js'],gpt:['multi-strategy-engine.js','strategy-engine.js','market-regime.js','../../strategies/a-share-strategy-pack.json'],python:['python-three-round-evidence.js']};
 return Object.fromEntries(Object.entries(files).map(([id,names])=>[id,id+'/'+digest(names.map(f=>fs.readFileSync(path.join(__dirname,f),'utf8'))).slice(0,16)]));
}
function buildWorkspaceDecision(result,{pythonEvidence,gptEvidence,fourteenEvidence,benchmarkEvidence}={}){
 const r=result||{},stock=r.stock,at=r.asOf,bundle=r.evidenceBundle;
 if(!stock||!/^\d{6}$/.test(stock.symbol)||!time(at)||!known(stock.observedAt,at)||
  !Array.isArray(stock.bars)||stock.bars.length>500||!['eastmoney','tencent'].includes(stock.provider)||stock.source!==stock.provider||stock.priceBasis!=='unadjusted')throw Error('需要带身份和时点的已归档股票');
 if(at>Date.now()||stock.bars.some((b,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||i&&stock.bars[i-1].date>=b.date||
  !['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||!finite(b.volume)||b.volume<0))throw Error('归档K线顺序、价格或成交量无效');
 const bars=stock.bars.filter(b=>known(b.knownAt,at)&&b.date<=day(at)&&Date.parse(b.date+'T15:10:00+08:00')<=at&&b.knownAt>=Date.parse(b.date+'T15:10:00+08:00'));
 const last=bars.at(-1);if(!last)throw Error('没有截止研究时点的闭合日K');
 let benchmarkSeries=null;
 if(benchmarkEvidence!==undefined){
  const b=benchmarkEvidence;
  if(b?.provider!==stock.provider||b.priceBasis!=='unadjusted'||b.frequency!=='1d'||typeof b.symbol!=='string'||!/^\d{6}$/.test(b.symbol)||
   typeof b.source!=='string'||!b.source.trim()||!Array.isArray(b.bars)||b.bars.length>500||b.bars.some((x,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||i&&b.bars[i-1].date>=x.date||!finite(x.open)||x.open<=0||!known(x.knownAt,at)))throw Error('基准必须提供同来源、同未复权口径的已知开盘价序列');
  benchmarkSeries={provider:b.provider,symbol:b.symbol,source:b.source,priceBasis:b.priceBasis,frequency:b.frequency,bars:b.bars.map(x=>({date:x.date,open:x.open,knownAt:x.knownAt}))};
 }
 const linked=bundle?.symbol===stock.symbol&&bundle.provider===stock.provider&&bundle.priceBasis===stock.priceBasis&&bundle.observationHash===r.observation?.observationHash&&known(bundle.decisionAt,at)&&known(bundle.recordedAt,Date.now());
 const versions=strategyVersions();if(pythonEvidence?.evaluatorVersion)versions.python+=':'+pythonEvidence.evaluatorVersion;
 const bundleHash=linked?bundle.hash:null;
 const sourceRefs=linked?array(bundle.sourceRefs).map(s=>({source:s.source||null,hash:s.sha256||null,receivedAt:known(s.receivedAt,at)?s.receivedAt:null,url:sourceLink(s.url)})):[];
 const nodes=[],rules=[];
 const add=(field,value,proof={},status)=>{
  const received=proof.recordedAt??proof.availableAt??proof.receivedAt??null;
  const available=proof.availableAt??received;
  const valid=(value!==undefined&&value!==null)&&known(available,at)&&known(received,at);
  const data={symbol:stock.symbol,field,value:valid?value:null,source:proof.source||stock.source,
   sourceTimestamp:known(proof.sourceTimestamp,at)?proof.sourceTimestamp:null,
   periodEnd:known(proof.observedAt,at)?proof.observedAt:null,availableAt:known(available,at)?available:null,
   receivedAt:known(received,at)?received:null,evidenceRef:proof.evidenceId||bundleHash,
   bundleHash,status:!valid?'unknown':status||'observed-unverified',
   missingReason:valid?null:'字段缺失或缺少当时可得证据'};
  const id=digest(data);if(!nodes.some(n=>n.id===id))nodes.push({id,...data});return id;
 };
 const rowTime=last.knownAt;
 for(const field of ['open','high','low','close','volume','amount'])add(field,last[field],{source:stock.source,recordedAt:rowTime,observedAt:Date.parse(last.date+'T15:00:00+08:00'),evidenceId:r.observation?.observationHash});
 const statusRows=r.stockStatus?.securities||[];
 const actual={code:stock.symbol,name:stock.name,price:last.close};
 const flow=r.marketContext?.funds?.stock;
 const fundDays=flow?.symbol===stock.symbol&&known(flow.retrievedAt,at)?array(flow.records).filter(f=>f.tradeDate<=last.date).map(f=>({date:f.tradeDate,main:finite(f.mainNetInflow)?f.mainNetInflow:null})):[];
 const nativeRows=bars.map((b,i)=>({...b,pct:i?100*(b.close/bars[i-1].close-1):null}));
 let fourteen={stock:actual,rows:nativeRows};
 if(fourteenEvidence!==undefined){
  const e=fourteenEvidence,allowed=['symbol','date','knownAt','source','stock','sector','auction','aucTicks','lhb','profitRatio'];
  if(!e||Object.keys(e).some(k=>!allowed.includes(k))||e.symbol!==stock.symbol||e.date!==last.date||!known(e.knownAt,at)||typeof e.source!=='string'||!/^\w[\w./:-]{2,159}$/.test(e.source)||e.source.includes('://'))throw Error('十四条原生证据身份或时点无效');
  const fields={stock:['floatCap','limitUpCount','breakCount','sealAmount','amount','preClose'],sector:['name','ztCount','pct'],auction:['auctionAmount','auctionPct'],lhb:['whale','whaleNet','netBuy','why']};
  for(const [group,keys]of Object.entries(fields))if(e[group]!==undefined){const v=e[group];if(!v||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||Object.entries(v).some(([k,x])=>['name','why'].includes(k)?typeof x!=='string'||x.length>500:k==='whale'?typeof x!=='boolean':!finite(x)))throw Error('十四条原生字段无效');}
  if(e.stock&&Object.values(e.stock).some(x=>x<0)||['limitUpCount','breakCount'].some(k=>e.stock?.[k]!==undefined&&!Number.isSafeInteger(e.stock[k]))||e.profitRatio!==undefined&&(!finite(e.profitRatio)||e.profitRatio<0||e.profitRatio>100))throw Error('十四条数值口径无效');
  if(e.aucTicks!==undefined){const t=e.aucTicks;if(!t||Object.keys(t).some(k=>!['preClose','bars'].includes(k))||!finite(t.preClose)||t.preClose<=0||!Array.isArray(t.bars)||t.bars.length>11||t.bars.some((b,i)=>Object.keys(b).some(k=>!['t','price','volume'].includes(k))||!/^09:(?:1[5-9]|2[0-5])$/.test(b.t)||i&&t.bars[i-1].t>=b.t||!finite(b.price)||b.price<=0||!finite(b.volume)||b.volume<0))throw Error('竞价分时证据无效');}
  fourteen={stock:{...e.stock,...actual},rows:nativeRows,...Object.fromEntries(['sector','auction','aucTicks','lhb','profitRatio'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))};
 }
 let scores={},gptMarket=null;
 if(gptEvidence!==undefined){
  if(gptEvidence?.symbol!==stock.symbol||gptEvidence.date!==last.date||!known(gptEvidence.knownAt,at)||typeof gptEvidence.source!=='string'||!/^\w[\w./:-]{2,159}$/.test(gptEvidence.source)||gptEvidence.source.includes('://'))throw Error('GPT因子证据必须匹配股票、日期和已知时间');
  scores=Object.fromEntries(Object.entries(gptEvidence.scores||{}).filter(([,v])=>finite(v)&&v>=0&&v<=100));
  const fields=['breadthScore','indexTrendScore','marketVolumeScore','riskScore','volatilityScore','sentimentScore'];
  if(fields.every(k=>finite(gptEvidence.market?.[k])&&gptEvidence.market[k]>=0&&gptEvidence.market[k]<=100))gptMarket=Object.fromEntries(fields.map(k=>[k,gptEvidence.market[k]]));
 }
 let pythonResult;
 if(pythonEvidence!==undefined){
  if(!known(pythonEvidence.knownAt,at))throw Error('Python证据已知时点无效');
  const p=evaluatePythonEvidence(pythonEvidence,{symbol:stock.symbol,date:last.date});
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
   rule.status==='unknown'?'unknown':'derived-unverified');
  rules.push({id:system+':'+(rule.id||rule.label),system,name:rule.label||rule.id,
   field:String(rule.field??rule.id??rule.label),value:rule.observed??rule.score??rule.value??null,op:rule.op||null,threshold:rule.threshold??null,
   status:['pass','fail'].includes(rule.status)?rule.status:'unknown',coverageOnly,evidenceIds:[node],
   reason:rule.reason||null,invalidation:'原条件或其来源证据不再成立时复查',version:versions[system]});
 };
 array(systems.fourteen.rules).forEach(x=>addRule('fourteen',x));
 array(systems.bazi.dimensions).forEach(x=>addRule('bazi',x,true));
 array(systems.gpt).forEach((s,i)=>array(s.rules).forEach(x=>addRule('gpt',{...x,id:i+':'+x.id,label:s.name+' · '+x.label})));
 if(!gptMarket)addRule('gpt',{id:'market-context',label:'原生市场环境输入',status:'unknown',reason:'缺少同一时点六项市场评分，不采用默认中性值'});
 array(systems.python.rules).forEach(x=>addRule('python',x));
 if(!systems.python.available)addRule('python',{id:'native-three-rounds',label:'原生三轮结果',status:'unknown',reason:systems.python.reason});
 for(const rule of array(r.research36?.code===stock.symbol?r.research36.evaluations:[]))for(const c of array(rule.checks)){
  const id=add(c.field,c.value,c.evidence||{},c.missing?'unknown':undefined);
  const missing=c.missing||nodes.find(n=>n.id===id).missingReason;
  rules.push({id:rule.id+':'+c.field,system:'research36',name:rule.name,field:c.field,value:missing?null:c.value??null,
   op:c.op||null,threshold:c.threshold??null,status:missing||c.pass!==true&&c.pass!==false?'unknown':c.pass?'pass':'fail',
   coverageOnly:false,evidenceIds:[id],reason:missing||null,invalidation:rule.invalidation||null,version:typeof r.research36?.version==='string'?r.research36.version:digest(r.research36?.version||'research36')});
 }
 const conditionGroups=['fourteen','bazi','gpt','python'].map(id=>{
  const rows=rules.filter(x=>x.system===id),missing=rows.filter(x=>x.status==='unknown');
  const coverageOnly=id==='bazi';
  let verdict=missing.length||!rows.length?'unknown':coverageOnly?'coverage-only':rows.some(x=>x.status==='fail')?'fail':'pass';
 if(id==='fourteen')verdict=rows.find(x=>x.id==='fourteen:11')?.status==='unknown'?'unknown':rows.find(x=>x.id==='fourteen:11')?.status==='fail'?'fail':systems.fourteen.pass?'pass':rows.filter(x=>x.status!=='fail').length<6?'fail':'unknown';
  if(id==='gpt')verdict=gptVerdict;
 if(id==='bazi')verdict=systems.bazi.raw?.insufficient?.length?'unknown':systems.bazi.raw?.verdict==='可介入'?'pass':systems.bazi.raw?.verdict==='观察'?'watch':'fail';
  return {id,label:{fourteen:'十四条',bazi:'八字口诀',gpt:'GPT五策略',python:'Python三轮'}[id],verdict,coverageOnly,
   support:coverageOnly?[]:rows.filter(x=>x.status==='pass'),opposition:coverageOnly?[]:rows.filter(x=>x.status==='fail'),missing,
   known:rows.length-missing.length,total:rows.length,version:versions[id],nativeVerdict:id==='bazi'?systems.bazi.raw?.verdict:null};
 });
 const index=linked&&r.linkage?.sameMarketTradeDate?r.linkage.indices:null;
 const regime=finite(index?.shanghaiChangePct)?index.shanghaiChangePct>0?'index-up':index.shanghaiChangePct<0?'index-down':'index-flat':'unknown';
 return {schemaVersion:1,...FLAGS,asOf:at,symbol:stock.symbol,name:stock.name||'',provider:stock.provider,tradeDate:last.date,
  priceBasis:stock.priceBasis,observationHash:r.observation?.observationHash||null,bundleHash,sourceRefs,
  inputCoverage:{providedBars:stock.bars.length,admittedClosedBars:bars.length,excludedBars:stock.bars.length-bars.length},
  conditions:rules,evidence:nodes,systems:conditionGroups,regime,regimeMeaning:'同日上证涨跌方向分组，不是行情因果或生产市场择时',
  nativeInputs:{fourteen:fourteenEvidence||null,gpt:gptEvidence?{symbol:stock.symbol,date:last.date,knownAt:gptEvidence.knownAt,source:gptEvidence.source,scores,market:gptMarket}:null,python:pythonEvidence||null},
  context:{linkage:linked?r.linkage||null:null,sectorContext:linked?bundle.sectorContext:null,financials:linked?bundle.marketContext?.financials:null,
   indices:linked?bundle.marketContext?.indices:null},
  bars:bars.map(b=>Object.fromEntries(['date','open','high','low','close','volume','amount','knownAt','statusKnownAt','suspended','tradable','isST','corporateAction','corporateActionKnownAt','limitUpPrice','limitReferencePrice','limitPct','noPriceLimit','limitKnownAt'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]))),
  tradeDates:array(r.analysis?.tradeDates),calendarEvidence:r.calendar?.metadata||null,benchmarkSeries,targetDate:r.calendar?.nextTradeDate||null,dueAt:r.priceEventResearch?.currentHypothesis?.dueAt||null,
  originalResearch:r.decisionReview||null,sourceStatus:r.history?.status||'unknown',statusEvidence:statusRows.length,
  diagnostics:array(r.decisionReview?.diagnostics),
  limitations:['四体系条件独立，不相加为买卖票数','八字维度pass仅表示评分证据存在','研究观察不认证供应商真实性或可成交性']};
}
function conditionChanges(current,previous){
 if(!previous)return {status:'first-observation',changes:[],systemChanges:[]};
 if(current.symbol!==previous.symbol||current.provider!==previous.provider||current.priceBasis!==previous.priceBasis)throw Error('不同身份不能直接比较判断');
 const old=new Map(array(previous.conditions).map(r=>[r.id,r])),changes=[];
 for(const r of array(current.conditions)){
  const p=old.get(r.id);if(!p){changes.push({condition:r.id,name:r.name,kind:'added',after:r.status});continue;}
  const changed=['status','value','threshold','op','version'].filter(k=>JSON.stringify(r[k])!==JSON.stringify(p[k]));
  if(changed.length)changes.push({condition:r.id,name:r.name,kind:r.version!==p.version?'rule-version-changed':
   current.tradeDate===previous.tradeDate&&(current.observationHash!==previous.observationHash||current.bundleHash!==previous.bundleHash)?'data-revision':'observed-change',
   fields:changed,before:{status:p.status,value:p.value,threshold:p.threshold},after:{status:r.status,value:r.value,threshold:r.threshold},
   previousEvidence:p.evidenceIds,currentEvidence:r.evidenceIds});
  old.delete(r.id);
 }
 for(const p of old.values())changes.push({condition:p.id,name:p.name,kind:'removed',before:p.status});
 return {status:'compared',sameTarget:current.targetDate===previous.targetDate,previousAsOf:previous.asOf,
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
module.exports={buildWorkspaceDecision,conditionChanges,screeningRecord,sourceLink,strategyVersions};
