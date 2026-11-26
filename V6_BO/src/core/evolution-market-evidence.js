'use strict';
// Pure projections over the existing archive. Receipt time, source identity and
// closed periods are retained; these views cannot approve or execute an order.
const {createHash}=require('node:crypto');
const {financialFeatures}=require('./public-stock-financials');
const {performanceStatistics}=require('./performance-statistics');
const {quoteObservationView,quoteSourceAllowsUse}=require('./quote-observation-view');
const {confirmedFact}=require('../../public/nova/shortline/pressure.mjs');
const {isTestSample}=require('../../public/nova/shortline/sample-quality.mjs');
const VERSION='fayo-market-evidence-1';
const TIMEFRAME_VERSION=VERSION+'-timeframe';
const flags={researchOnly:true,canTrade:false,canNotify:false,weightsChanged:false,verifiedLive:false};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const list=x=>Array.isArray(x)?x:[];
const round=x=>finite(x)?+x.toFixed(6):null;
const DAY=86400000,MINUTE=60000;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dayOK=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function instant(x,end=false){
 if(Number.isSafeInteger(x)&&x>0&&x<8e15)return x;
 if(typeof x!=='string')return null;
 if(dayOK(x))return Date.parse(x+(end?'T23:59:59.999':'T15:00:00')+'+08:00');
 if(/^\d{4}-\d\d-\d\d[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(x)&&dayOK(x.slice(0,10))){
  const n=Date.parse(x.replace(' ','T')+'+08:00');return Number.isFinite(n)?n:null;
 }
 if(/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(x)&&dayOK(x.slice(0,10))){const n=Date.parse(x);return Number.isFinite(n)?n:null;}
 return null;
}
const dateAt=x=>new Date(x+8*3600000).toISOString().slice(0,10);
const source=x=>typeof(x?.source||x?.sampleSource||x?.provider)==='string'?String(x.source||x.sampleSource||x.provider).trim():'';
function receipt(x){
 const values=['knownAt','receivedAt','recordedAt'].filter(k=>x?.[k]!=null).map(k=>instant(x[k]));
 return values.length&&values.every(v=>v!==null)?Math.max(...values):null;
}
const isTest=x=>isTestSample(x)||x?.simulated===true||['source','sampleSource','provider'].some(k=>/synthetic|fixture|mock|demo|simulated|教学|测试/i.test(String(x?.[k]||'')));
function visible(row,asOf){
 const known=receipt(row),available=instant(row?.availableAt??row?.closedAt??row?.barEndAt??row?.date),ended=instant(row?.closedAt??row?.barEndAt??row?.date);
 return !!row&&source(row)&&!isTest(row)&&row.retracted!==true&&known!==null&&available!==null&&ended!==null&&ended<=asOf&&ended<=known&&ended<=available&&known<=asOf&&available<=asOf;
}
const period=x=>({daily:'day','日K':'day','日线':'day','D':'day',weekly:'week','周K':'week','周线':'week','W':'week',monthly:'month','月K':'month','月线':'month','M':'month',intraday:'minute','分时':'minute','1分钟':'minute','1m':'minute','5分钟':'minute','5m':'minute','15分钟':'minute','15m':'minute','30分钟':'minute','30m':'minute','60分钟':'minute','60m':'minute'})[x]||x;
function cleanSeries(rows,asOf,{code,kind='day'}={}){
 const byDate=new Map(),conflicts=new Set(),rejected=[];
 for(const row of list(rows).slice(0,50000)){
  if(!row||code&&String(row.code||row.symbol)!==code||period(row.period||(String(row.date).length>10?'分时':'日K'))!==kind)continue;
  const badPrices=['open','high','low'].some(k=>row[k]!==undefined&&(!finite(row[k])||row[k]<=0))||finite(row.high)&&row.high<Math.max(row.close,row.open||row.close)||finite(row.low)&&row.low>Math.min(row.close,row.open||row.close)||row.volume!==undefined&&(!finite(row.volume)||row.volume<0);
  if(typeof row.date!=='string'||!dayOK(row.date.slice(0,10))||!visible(row,asOf)||!finite(row.close)||row.close<=0||row.closed===false||badPrices){rejected.push(row.date||null);continue;}
  const old=byDate.get(row.date),at=receipt(row);
  if(old){
   if(receipt(old)===at&&hash([old.open,old.high,old.low,old.close,old.volume,source(old),old.priceBasis,old.closedAt,old.barEndAt])!==hash([row.open,row.high,row.low,row.close,row.volume,source(row),row.priceBasis,row.closedAt,row.barEndAt]))conflicts.add(row.date);
   else if(at>receipt(old)&&row.revisionId)byDate.set(row.date,row);
   else if(at!==receipt(old)&&hash([old.open,old.high,old.low,old.close,old.volume,old.priceBasis])!==hash([row.open,row.high,row.low,row.close,row.volume,row.priceBasis]))conflicts.add(row.date);
  }else byDate.set(row.date,row);
 }
 return {rows:[...byDate].filter(([date])=>!conflicts.has(date)).map(([,r])=>r).sort((a,b)=>a.date.localeCompare(b.date)),conflicts:[...conflicts].sort(),rejected};
}
const reference=r=>({date:r.date,source:source(r),knownAt:receipt(r),availableAt:instant(r.availableAt??r.closedAt??r.barEndAt??r.date),revisionId:r.revisionId||null,priceBasis:r.priceBasis||null,
 values:Object.fromEntries(['open','high','low','close','volume','amount'].filter(k=>finite(r[k])).map(k=>[k,r[k]]))});
const kindName={market:'大盘',industry:'行业',sector:'板块',theme:'题材'};
function relativeClassification(stockReturn,benchmarkReturn,excess,peakRet,drawdown,kind){
 const tags=[];
 if(stockReturn>0&&benchmarkReturn<0)tags.push('逆势走强');
 if(excess<-1)tags.push('个股相对走弱');
 if(['industry','sector','theme'].includes(kind)){
  if(stockReturn>0&&benchmarkReturn>0&&Math.abs(excess)<=1)tags.push('跟随板块上涨');
  if(benchmarkReturn>0&&stockReturn<=0)tags.push('板块强而个股弱');
  if(benchmarkReturn<0&&stockReturn>0)tags.push('板块弱而个股强');
 }
 if(stockReturn>0&&benchmarkReturn<=0.5&&excess>1)tags.push('独立走强');
 if(Math.abs(excess)<=1&&stockReturn*benchmarkReturn>=0)tags.push('跟随');
 if(stockReturn*benchmarkReturn<0||Math.abs(excess)>3)tags.push('分化');
 if(peakRet>=3&&drawdown<=-3)tags.push('冲高回落');
 if(!tags.length)tags.push(excess>0?'相对占优':'相对偏弱');
 return tags;
}
function evaluateMarketFactorGain({samples=[],asOf,factorVersion=VERSION,minSamples=20}={}){
 const at=instant(asOf,true),accepted=[],excluded=[],seen=new Map();
 const no={version:VERSION,factorVersion,status:'not-evaluated',n:0,baseline:null,enhanced:null,difference:null,...flags,autoPromotion:false};
 if(at===null||!Array.isArray(samples)||samples.length>20000||!Number.isInteger(minSamples)||minSamples<5||minSamples>10000)return {...no,reason:'时点、样本规模或最小样本门槛无效',excluded:[]};
 for(const row of samples){
  const id=String(row?.id||''),decision=instant(row?.decisionAt),entry=instant(row?.entryAt),exit=instant(row?.exitAt),known=instant(row?.knownAt),trained=instant(row?.trainingEnd),testStart=instant(row?.testStart),frozen=instant(row?.frozenAt);
  const reason=!id?'缺少配对样本身份':isTest(row)?'测试样本不证明实际增益':row?.factorVersion!==factorVersion?'因子版本不一致':
   !source(row)||!/^[a-f0-9]{64}$/.test(row?.evidenceHash||'')?'缺少可追溯证据':
   [decision,entry,exit,known,trained,testStart,frozen].some(v=>v===null)||!(frozen<=decision&&trained<testStart&&testStart<=decision&&decision<entry&&entry<exit&&exit<=known&&known<=at)?'冻结、训练隔离或结算时点不合法':
   !finite(row.baselineNetReturnPct)||!finite(row.enhancedNetReturnPct)||row.baselineNetReturnPct<=-100||row.enhancedNetReturnPct<=-100?'配对净收益无效':
   row.costIncluded!==true||!finite(row.feeBps)||row.feeBps<0||!finite(row.slippageBps)||row.slippageBps<0?'缺少同口径成本与滑点':null;
  if(reason){excluded.push({id,reason});continue;}
  const normalized={id,entry,exit,known,decision,baselineNetReturnPct:row.baselineNetReturnPct,enhancedNetReturnPct:row.enhancedNetReturnPct,feeBps:row.feeBps,slippageBps:row.slippageBps,evidenceHash:row.evidenceHash};
  const prior=seen.get(id);
  if(prior){if(hash(prior)!==hash(normalized)){seen.set(id,null);excluded.push({id,reason:'同一样本身份发生冲突'});}else excluded.push({id,reason:'重复样本'});}
  else if(seen.has(id))excluded.push({id,reason:'同一样本身份已冲突'});
  else seen.set(id,normalized);
 }
 let until=0;
 for(const row of [...seen.values()].filter(Boolean).sort((a,b)=>a.entry-b.entry||a.id.localeCompare(b.id))){
  if(row.entry<until){excluded.push({id:row.id,reason:'持有窗口重叠，不能按独立结算样本比较'});continue;}
  accepted.push(row);until=row.exit;
 }
 if(!accepted.length)return {...no,reason:'无成熟且训练隔离、成本一致的配对样本',excluded};
 const summarize=field=>{const values=accepted.map(r=>r[field]);let equity=1;const points=values.map(v=>({value:equity*=1+v/100}));const statistics=performanceStatistics(points,{initialCash:1,trades:values.map(v=>({netPnl:v}))});return {meanNetReturnPct:round(values.reduce((a,b)=>a+b,0)/values.length),winRatePct:round(statistics.winRatePct),settledMaxDrawdownPct:round(statistics.maxDrawdownPct),compoundedReturnPct:round(statistics.returnPct)};};
 const baseline=summarize('baselineNetReturnPct'),enhanced=summarize('enhancedNetReturnPct'),days=new Set(accepted.map(r=>dateAt(r.entry))).size;
 return {...no,status:accepted.length>=minSamples&&days>=Math.min(10,minSamples)?'evaluated':'insufficient-sample',n:accepted.length,distinctEntryDays:days,minimumSamples:minSamples,baseline,enhanced,
  difference:{meanNetReturnPct:round(enhanced.meanNetReturnPct-baseline.meanNetReturnPct),winRatePct:round(enhanced.winRatePct-baseline.winRatePct),settledMaxDrawdownPct:round(enhanced.settledMaxDrawdownPct-baseline.settledMaxDrawdownPct)},
  sampleIds:accepted.map(r=>r.id),excluded,evidenceHash:hash(accepted),conclusion:'配对样本外描述性差值；统计显著性与试验预算须经原验证门禁',autoPromotion:false};
}
function buildRelativeStrengthEvidence({archive={},code,asOf,benchmarks,windows=[1,5,20],gainSamples}={}){
 const at=instant(asOf,true),missing=[],factorRows=[],comparisons=[];
 if(at===null||!/^\d{6}$/.test(String(code||'')))return {version:VERSION,status:'unknown',missing:['有效观察时点及六位标的代码'],comparisons:[],factors:[],...flags};
 const raw=list(archive.bars),stock=cleanSeries(raw.filter(r=>!r.role||r.role==='stock'),at,{code:code&&String(code)});
 const stockRows=stock.rows,last=stockRows.at(-1),windowSizes=[...new Set(list(windows))].filter(n=>Number.isInteger(n)&&n>=1&&n<=252).slice(0,8);
 if(!last)missing.push('带来源和取得时间的个股闭合日K');
 if(stock.conflicts.length)missing.push('个股同一时点行情冲突：'+stock.conflicts.join('、'));
 let specs=list(benchmarks).slice(0,30);
 if(!specs.length&&last){
  const associations={market:last.indexCode,industry:last.industryCode||last.industry,sector:last.sector,theme:last.theme||last.themeCode};
  for(const kind of Object.keys(kindName)){
   const possible=raw.filter(r=>visible(r,at)&&(kind==='market'?r.role==='index':r.role===kind||r.role==='sector'&&(r.benchmarkKind||'sector')===kind));
   const groups=new Map();for(const row of possible){const id=String(row.code||row.sector||row.theme||'');if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
   const chosen=[...groups].filter(([id,rows])=>associations[kind]?id===associations[kind]||rows.some(r=>r.sector===associations[kind]||r.theme===associations[kind]||r.industry===associations[kind]):kind==='market'&&groups.size===1);
   for(const [id,bars] of chosen)specs.push({kind,id,bars,membershipKnownAt:receipt(last),source:source(last)});
  }
 }
 for(const kind of Object.keys(kindName)){
  const selected=specs.filter(b=>b&&b.kind===kind);
  if(!selected.length)missing.push(kindName[kind]+'同窗基准');
  for(const spec of selected){
   const membership=instant(spec.membershipKnownAt),usableMembership=kind==='market'||membership!==null&&membership<=at;
   const series=usableMembership?cleanSeries(spec.bars,at):{rows:[],conflicts:[]};
   for(const n of windowSizes){
    const rows=stockRows.slice(-n-1),entry=rows[0],end=rows.at(-1),dates=rows.map(r=>r.date),byDate=new Map(series.rows.map(r=>[r.date,r]));
    const aligned=dates.map(d=>byDate.get(d)),why=[];
    if(!usableMembership)why.push('缺少当时已知的归属版本');
    if(rows.length!==n+1)why.push('个股历史不足');
    if(aligned.some(x=>!x)||!aligned.length)why.push('基准日期不完整或与个股不一致');
    if(series.conflicts.length)why.push('基准同一时点数据冲突');
    const bases=new Set([...rows,...aligned.filter(Boolean)].map(r=>r.priceBasis).filter(Boolean));
    if(bases.size!==1||rows.some(r=>!r.priceBasis)||aligned.some(r=>r&&!r.priceBasis))why.push('价格口径缺失或不一致');
    if(new Set(rows.map(source)).size>1||new Set(aligned.filter(Boolean).map(source)).size>1)why.push('窗口内来源不一致');
    const row={kind,label:kindName[kind],id:String(spec.id||kind).slice(0,80),window:n,from:entry?.date||null,to:end?.date||null,status:why.length?'unknown':'observed-research-only',missing:why,stockReturnPct:null,benchmarkReturnPct:null,excessPct:null,tags:[],evidence:[]};
    if(!why.length){
     const own=(end.close/entry.close-1)*100,bench=(aligned.at(-1).close/aligned[0].close-1)*100,excess=own-bench;
     const highs=rows.slice(1).map(r=>r.high),peak=highs.every(finite)?Math.max(...highs):null;
     const peakRet=peak===null?null:(peak/entry.close-1)*100,drawdown=peak===null?null:(end.close/peak-1)*100;
     Object.assign(row,{stockReturnPct:round(own),benchmarkReturnPct:round(bench),excessPct:round(excess),peakReturnPct:round(peakRet),drawdownFromPeakPct:round(drawdown),tags:relativeClassification(own,bench,excess,peakRet,drawdown,kind),evidence:[...rows.map(reference),...aligned.map(reference)]});
     factorRows.push({code:'EV31_REL_'+kind.toUpperCase()+'_'+n,version:VERSION,value:row.excessPct,unit:'percentage-points',subjectCode:String(code||last?.code||''),observedAt:instant(end.date),knownAt:Math.max(...row.evidence.map(e=>e.knownAt)),windowFrom:entry.date,windowTo:end.date,evidenceHash:hash(row.evidence)});
    }
    comparisons.push(row);
   }
  }
 }
 const observed=comparisons.filter(c=>c.status==='observed-research-only').length;
 return {version:VERSION,asOf:at,code:String(code||last?.code||''),status:observed?(missing.length||observed<comparisons.length?'partial':'observed-research-only'):'unknown',missing:[...new Set(missing)],comparisons,factors:factorRows,
  independentGain:{...evaluateMarketFactorGain({samples:gainSamples||archive.marketFactorGainSamples||[],asOf:at}),factorVersion:VERSION,inputs:factorRows},...flags};
}
function cycle(date,kind){
 const d=new Date(date.slice(0,10)+'T00:00:00Z');
 if(kind==='week'){const weekday=(d.getUTCDay()+6)%7,start=new Date(+d-weekday*DAY),last=new Date(+start+4*DAY);return {start:start.toISOString().slice(0,10),end:last.toISOString().slice(0,10),calendarEnd:new Date(+start+6*DAY).toISOString().slice(0,10)};}
 if(kind==='month'){const y=d.getUTCFullYear(),m=d.getUTCMonth();return {start:new Date(Date.UTC(y,m,1)).toISOString().slice(0,10),end:new Date(Date.UTC(y,m+1,0)).toISOString().slice(0,10),calendarEnd:new Date(Date.UTC(y,m+1,0)).toISOString().slice(0,10)};}
 return {start:date.slice(0,10),end:date.slice(0,10),calendarEnd:date.slice(0,10)};
}
function calendarSessions(calendar,c,asOf){
 const known=instant(calendar?.knownAt),dates=list(calendar?.tradeDates||calendar?.dates);
 if(!source(calendar)||known===null||known>asOf||!dayOK(calendar.from)||!dayOK(calendar.to)||calendar.from>c.start||calendar.to<c.calendarEnd||!dates.every(dayOK)||new Set(dates).size!==dates.length)return null;
 return dates.filter(d=>d>=c.start&&d<=c.calendarEnd).sort();
}
function buildMultiTimeframeEvidence({archive={},code,asOf,calendar,gainSamples}={}){
 const at=instant(asOf,true),rows=list(archive.bars).filter(r=>r&&(!r.role||r.role==='stock')&&String(r.code||r.symbol)===String(code)),frames=[],missing=[];
 if(at===null)return {version:VERSION,status:'unknown',frames:[],conflicts:[],missing:['有效观察时点'],factors:[],independentGain:{...evaluateMarketFactorGain({asOf,factorVersion:TIMEFRAME_VERSION}),inputs:[]},...flags};
 const daily=cleanSeries(rows,at,{code:String(code),kind:'day'}).rows;
 for(const kind of ['minute','day','week','month']){
  const rawPeriods=[...new Set(rows.filter(r=>visible(r,at)&&r.closed!==false&&period(r.period||(String(r.date).length>10?'分时':'日K'))===kind).map(r=>r.period||'分时'))];
  const minutes=p=>p==='分时'?1:Number(/\d+/.exec(p)?.[0])||Infinity;
  const sourcePeriod=kind==='minute'?rawPeriods.sort((a,b)=>minutes(a)-minutes(b)||a.localeCompare(b))[0]:null;
  const accepted=[],incomplete=[],direct=cleanSeries(kind==='minute'?rows.filter(r=>(r.period||'分时')===sourcePeriod):rows,at,{code:String(code),kind}).rows;
  for(const row of direct){
   if(!row.priceBasis||![row.open,row.high,row.low,row.close,row.volume].every(finite)||Math.min(row.open,row.high,row.low,row.close)<=0||row.volume<0||row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close)){incomplete.push(row.date);continue;}
   if(kind==='minute'&&String(row.date).length<=10){incomplete.push(row.date);continue;}
   const c=cycle(row.date,kind),sessions=calendarSessions(calendar,c,at),lastDay=sessions?.at(-1)||c.end;
   const close=kind==='minute'?instant(row.closedAt??row.barEndAt??row.date):instant(lastDay);
   // A Wednesday's weekly bar or this month's accumulated bar is never treated
   // as a completed cycle merely because the provider set a boolean flag.
   if(close===null||close>at||(kind==='week'||kind==='month')&&row.date.slice(0,10)!==lastDay){incomplete.push(row.date);continue;}
   accepted.push({...row,cycleStart:c.start,cycleEnd:lastDay,closedAt:close,derived:false});
  }
  if((kind==='week'||kind==='month')&&!accepted.length){
   const groups=new Map();for(const row of daily){const c=cycle(row.date,kind);if(!groups.has(c.start))groups.set(c.start,{c,rows:[]});groups.get(c.start).rows.push(row);}
   for(const {c,rows:rs} of groups.values()){
    const sessions=calendarSessions(calendar,c,at);
    if(!sessions?.length||instant(sessions.at(-1))>at||rs.length!==sessions.length||rs.some((r,i)=>r.date!==sessions[i]||!r.priceBasis)||!rs.every(r=>[r.open,r.high,r.low,r.close,r.volume].every(finite))||new Set(rs.map(source)).size!==1||new Set(rs.map(r=>r.priceBasis)).size!==1){incomplete.push(c.start);continue;}
    accepted.push({code:String(code),date:sessions.at(-1),period:kind,open:rs[0].open,close:rs.at(-1).close,high:Math.max(...rs.map(r=>r.high)),low:Math.min(...rs.map(r=>r.low)),volume:rs.reduce((n,r)=>n+r.volume,0),source:source(rs[0]),knownAt:Math.max(...rs.map(receipt)),priceBasis:rs[0].priceBasis,cycleStart:c.start,cycleEnd:sessions.at(-1),closedAt:instant(sessions.at(-1)),derived:true,components:rs.map(reference)});
   }
  }
  accepted.sort((a,b)=>a.closedAt-b.closedAt);
  const latest=accepted.at(-1),prior=accepted.at(-2),compatible=!prior||source(prior)===source(latest)&&prior.priceBasis&&prior.priceBasis===latest.priceBasis;
  const value=!compatible?null:latest&&prior?(latest.close/prior.close-1)*100:latest&&finite(latest.open)&&latest.open>0?(latest.close/latest.open-1)*100:null;
  const comparisonEvidence=[...(prior?prior.components||[reference(prior)]:[]),...(latest?latest.components||[reference(latest)]:[])];
  const frame={period:kind,sourcePeriod,status:latest?'closed':'unknown',direction:value===null?'unknown':value>0.1?'up':value<-.1?'down':'flat',returnPct:round(value),comparison:prior?'previous-closed-cycle':'cycle-open-to-close',previousClosedDate:prior?.date||null,comparisonEvidence,
   latest:latest?{date:latest.date,cycleStart:latest.cycleStart,cycleEnd:latest.cycleEnd,closedAt:latest.closedAt,open:latest.open,high:latest.high,low:latest.low,close:latest.close,volume:latest.volume,derived:latest.derived,evidence:latest.components||[reference(latest)]}:null,incompleteCycles:[...new Set(incomplete)].sort()};
  if(!latest)missing.push(kind+'闭合K线'+((kind==='week'||kind==='month')?'及完整交易日历':''));
  else if(!compatible)missing.push(kind+'相邻周期来源或价格口径不一致');
  frames.push(frame);
 }
 const conflicts=[];
 for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++)if(['up','down'].includes(frames[i].direction)&&['up','down'].includes(frames[j].direction)&&frames[i].direction!==frames[j].direction)conflicts.push({periods:[frames[i].period,frames[j].period],reason:'已闭合周期方向分歧',evidenceDates:[frames[i].latest.date,frames[j].latest.date]});
 const closed=frames.filter(f=>f.status==='closed'),available=closed.length;
 const factors=closed.filter(f=>finite(f.returnPct)).map(f=>({code:'EV33_CLOSED_'+f.period.toUpperCase()+'_RETURN',version:TIMEFRAME_VERSION,value:f.returnPct,unit:'percent',subjectCode:String(code||''),
  observedAt:f.latest.closedAt,knownAt:Math.max(...f.comparisonEvidence.map(e=>e.knownAt)),windowFrom:f.previousClosedDate||f.latest.cycleStart,windowTo:f.latest.cycleEnd,evidenceHash:hash(f.comparisonEvidence)}));
 return {version:VERSION,asOf:at,code:String(code||''),status:!available?'unknown':missing.length?'partial':conflicts.length?'conflict':'aligned',frames,conflicts,missing,factors,periodsAreNotIndependentSamples:true,
  independentGain:{...evaluateMarketFactorGain({samples:gainSamples||archive.multiTimeframeGainSamples||[],asOf:at,factorVersion:TIMEFRAME_VERSION}),inputs:factors},...flags};
}
const FINANCIAL_FIELDS=[
 ['roePct','净资产收益率','percent',v=>v<0?'亏损侵蚀权益':null],
 ['earningsGrowthPct','单季净利润同比','percent',v=>v<0?'单季净利润同比下降':null],
 ['revenueGrowthPct','单季营收同比','percent',v=>v<0?'单季营收同比下降':null],
 ['debtAssetsPct','资产负债率','percent',v=>v>70?'高负债需结合行业核验':null],
 ['operatingCashToProfit','经营现金与净利润比','ratio',v=>v<0.8?'利润现金支持偏弱':null],
 ['receivableGrowthPct','应收账款同比','percent',()=>null],
 ['inventoryGrowthPct','存货同比','percent',()=>null],
 ['grossMarginPct','毛利率','percent',v=>v<0?'毛利率为负':null],
 ['goodwillToEquityPct','商誉占净资产','percent',v=>v>30?'商誉占比较高需核验减值':null],
 ['netMarginPct','净利率','percent',v=>v<0?'净利率为负':null],
 ['basicEps','基本每股收益','CNY/share',v=>v<0?'基本每股收益为负':null],
 ['operatingCashPerShare','每股经营现金流','CNY/share',v=>v<0?'每股经营现金流为负':null],
 ['receivableDays','应收账款周转天数','days',()=>null],
 ['inventoryDays','存货周转天数','days',()=>null],
 ['currentRatio','流动比率','ratio',v=>v<1?'流动资产不足覆盖流动负债，需结合行业核验':null],
 ['quickRatio','速动比率','ratio',v=>v<0.7?'速动比率偏低，需结合行业核验':null]
];
const DISCLOSURE_TYPES=[
 ['audit','审计意见'],['shareholding','股东减持及重要股权变化'],
 ['impairment','商誉及减值风险'],['material-risk','财务异常和重大风险披露']
];
const AUDIT_OPINIONS={unmodified:'标准无保留意见',qualified:'保留意见',adverse:'否定意见',disclaimer:'无法表示意见','unmodified-with-emphasis':'带强调事项的无保留意见'};
const safeText=(value,max=1000)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max).trim():'';
const hashOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const disclosureType=category=>({审计意见:'audit',减持:'shareholding',解禁:'shareholding',股权变化:'shareholding',商誉:'impairment',减值:'impairment',问询:'material-risk',监管:'material-risk',重大风险:'material-risk'})[category]||category;
// Child timestamps cannot make an enclosing future/retracted snapshot visible.
// Missing wrapper clocks are allowed only because each consumed child still
// requires its own complete receipt; supplied clocks must all be valid.
function financialEnvelopeVisible(value,asOf){
 if(!value||asOf===null||isTest(value)||value.retracted===true)return false;
 return ['knownAt','receivedAt','recordedAt','availableAt','createdAt','observedAt','observedAtMs','capturedAt','decisionAt','asOf','publishedAt','updatedAt','publicationDate','updatedDate']
  .filter(key=>Object.hasOwn(value,key)).every(key=>{const at=instant(value[key],['publicationDate','updatedDate'].includes(key));return at!==null&&at<=asOf;});
}
function financialRecordMeta(record,code,at,{disclosure=false}={}){
 const received=receipt(record),available=instant(record?.availableAt),published=instant(record?.publishedAt)||instant(record?.publicationDate,true),updated=instant(record?.updatedAt)||instant(record?.updatedDate,true);
 if(!record||String(record.code||record.symbol)!==String(code)||!source(record)||isTest(record)||record.retracted===true||received===null||available===null||received>at||available>at||!hashOK(record.evidenceHash)||!safeText(record.revisionId,120))return null;
 if(disclosure&&(published===null||updated===null||published>updated||updated>received||updated>available||record.reportDate&&(!dayOK(record.reportDate)||instant(record.reportDate)>published)))return null;
 return {source:source(record),recordedAt:received,availableAt:available,publishedAt:published,updatedAt:updated,reportDate:dayOK(record.reportDate)?record.reportDate:null,
  revisionId:safeText(record.revisionId,120),evidenceHash:record.evidenceHash,url:/^https:\/\/[^\s]+$/.test(record.url||'')?record.url:null};
}
function financialDisclosures({versions,archive={},code,asOf}){
 const accepted=[],clues=[],coverage=[],seen=new Map(),conflicts=new Set();
 const add=row=>{
  const key=row.category+'/'+row.id,prior=seen.get(key);
  if(prior&&row.evidence.recordedAt===prior.evidence.recordedAt&&hash(row)!==hash(prior)){conflicts.add(key);return;}
  if(!prior||row.evidence.recordedAt>prior.evidence.recordedAt)seen.set(key,row);
  accepted.push(row);
 };
 for(const version of versions.slice(0,1000)){
  if(!version||isTest(version)||version.retracted===true||String(version.symbol||version.code)!==String(code))continue;
  for(const e of list(version.disclosures).slice(0,1000)){
   const category=disclosureType(e?.category),meta=financialRecordMeta(e,code,asOf,{disclosure:true}),description=safeText(e?.description||e?.title),id=safeText(e?.id,160);
   if(!meta||!id||!description||!DISCLOSURE_TYPES.some(([type])=>type===category)||e.verified!==true)continue;
   if(category==='audit'&&!Object.hasOwn(AUDIT_OPINIONS,e.auditOpinion))continue;
   add({id,category,description,verified:true,statementKind:'typed-source-disclosure',value:finite(e.value)?e.value:null,unit:safeText(e.unit,40)||null,
    auditOpinion:category==='audit'?e.auditOpinion:null,auditLabel:category==='audit'?AUDIT_OPINIONS[e.auditOpinion]:null,
    risk:category==='audit'&&e.auditOpinion!=='unmodified'?AUDIT_OPINIONS[e.auditOpinion]:safeText(e.riskTag,240)||null,evidence:meta});
  }
 }
 // Keep the established announcement/holding-change reader's fact-versus-clue
 // distinction. A matching headline does not establish an audit opinion or risk.
 const reports=[...list(archive.pressureHistory),archive.v6Observation?.stock?.pressure].filter(Boolean);
 if(archive.scope!=='demo'&&!isTest(archive))for(const report of reports.slice(0,2000)){
  if(report.code!==code||isTest(report)||receipt(report)===null||receipt(report)>asOf)continue;
  for(const c of list(report.coverage))if(c?.code===code&&receipt(c)!==null&&receipt(c)<=asOf)coverage.push({id:safeText(c.id,80),label:safeText(c.label,100),status:safeText(c.status,80),recordedAt:receipt(c)});
  for(const fact of list(report.facts)){
   if(isTest(fact)||!confirmedFact(fact,code,dateAt(asOf),asOf))continue;
   const category=disclosureType(fact.category);if(!DISCLOSURE_TYPES.some(([type])=>type===category))continue;
   add({id:safeText(fact.id,160),category,description:safeText(fact.description),verified:true,statementKind:'original-pressure-fact',value:finite(fact.value)?fact.value:null,unit:safeText(fact.unit,40)||null,
    auditOpinion:null,auditLabel:null,risk:safeText(fact.riskTag,240)||null,evidence:{source:source(fact),recordedAt:receipt(fact),availableAt:receipt(fact),publishedAt:instant(fact.publishedAt),updatedAt:instant(fact.sourceUpdatedAt),
     reportDate:fact.category==='商誉'?fact.eventDay:null,eventDate:fact.eventDay,expires:fact.expires,revisionId:fact.id+'@'+receipt(fact),evidenceHash:hash(fact),hashKind:'original-archived-fact',url:/^https:\/\/[^\s]+$/.test(fact.url||'')?fact.url:null}});
  }
  for(const clue of list(report.clues)){
   const category=disclosureType(clue?.category),received=receipt(clue),published=instant(clue?.publishedAt);
   if(clue?.code!==code||isTest(clue)||!source(clue)||received===null||published===null||published>received||received>asOf||!DISCLOSURE_TYPES.some(([id])=>id===category))continue;
   clues.push({id:safeText(clue.id,160),category,title:safeText(clue.title),source:source(clue),publishedAt:published,knownAt:received,status:'unverified-clue',verified:false});
  }
 }
 const stock=archive.v6Observation?.stock,observation=archive.v6Observation;
 if(archive.scope!=='demo'&&!isTest(archive)&&observation?.code===code&&!isTest(observation)&&!isTest(stock)&&receipt({...observation,knownAt:observation?.observedAtMs??observation?.observedAt})!==null&&receipt({...observation,knownAt:observation?.observedAtMs??observation?.observedAt})<=asOf){
  const announcements=list(stock?.announcements).filter(e=>String(e?.code||'')===code&&!isTest(e)&&receipt(e)!==null&&receipt(e)<=asOf&&instant(e.publishedAt)!==null&&instant(e.publishedAt)<=receipt(e));
  const linked=require('../strategy/issuer-event-linkage').linkIssuerEvents({symbol:code,announcements,now:asOf,maxAgeDays:366});
  for(const event of linked.events){
   const original=announcements.find(e=>e.url===event.url&&e.title===event.title);if(!original)continue;
   for(const [category,pattern] of [['audit',/审计报告|审计意见|审计事项/],['shareholding',/减持|增持|股权|股份转让|实际控制人|控股股东|质押|解禁/],['impairment',/商誉|减值/],['material-risk',/财务异常|财务造假|重大风险|风险提示|债务违约|资金占用|退市|行政处罚|立案|问询函|监管函/]]){
    if(pattern.test(event.title))clues.push({id:event.id,category,title:event.title,source:event.source,url:event.url,publishedAt:instant(event.publishedAt),knownAt:receipt(original),status:'unverified-clue',verified:false});
   }
  }
 }
 const visible=[...seen].filter(([key])=>!conflicts.has(key)).map(([,value])=>value).sort((a,b)=>b.evidence.recordedAt-a.evidence.recordedAt||a.id.localeCompare(b.id));
 const categories=DISCLOSURE_TYPES.map(([id,label])=>{const items=visible.filter(row=>row.category===id),unverified=[...new Map(clues.filter(row=>row.category===id).map(row=>[row.id,row])).values()];return {id,label,status:items.length?'observed':unverified.length?'clues-only':'unknown',items,clues:unverified,missingReason:items.length?null:'尚无当时已知、同股且可核对的'+label+'证据；不能据此断定无风险'};});
 return {categories,coverage:{observed:categories.filter(c=>c.items.length).length,total:categories.length},sourceCoverage:[...new Map(coverage.map(c=>[c.id,c])).values()],conflicts:[...conflicts].sort(),
  revisions:accepted.sort((a,b)=>a.evidence.recordedAt-b.evidence.recordedAt||a.id.localeCompare(b.id)),absenceIsNotNoRisk:true};
}
const VALUATION_FIELDS=[['peTtm','滚动市盈率','ratio','TTM'],['pb','市净率','ratio','latest-disclosed-book'],['dividendYieldPct','近12个月现金股息率','percent','trailing-12m-cash-dividend']];
function financialValuation({versions,code,asOf}){
 const observations=[],conflicts=new Set(),byIdentity=new Map();
 for(const version of versions.slice(0,1000)){
  if(!version||isTest(version)||version.retracted===true||String(version.symbol||version.code)!==String(code))continue;
  for(const row of list(version.valuationObservations).slice(0,1000)){
   const meta=financialRecordMeta(row,code,asOf),observed=instant(row?.observedAt),definition=VALUATION_FIELDS.find(([id])=>id===row?.metric),published=instant(row?.financialPublishedAt);
   if(!meta||!definition||observed===null||observed>meta.recordedAt||observed>meta.availableAt||published===null||published>observed||row.unit!==definition[2]||row.basis!==definition[3]||row.currency!=='CNY'||row.priceBasis!=='unadjusted'||!finite(row.value))continue;
   const item={metric:row.metric,value:row.value,unit:row.unit,basis:row.basis,currency:row.currency,priceBasis:row.priceBasis,observedAt:observed,financialPublishedAt:published,evidence:meta,industry:row.industry||null};
   const key=row.metric+'/'+observed+'/'+meta.recordedAt,old=byIdentity.get(key);
   if(old&&hash(old)!==hash(item))conflicts.add(key);else byIdentity.set(key,item);
  }
 }
 for(const [key,row] of byIdentity)if(!conflicts.has(key))observations.push(row);
 const metrics=VALUATION_FIELDS.map(([id,label,unit,basis])=>{
  const e=observations.filter(row=>row.metric===id).sort((a,b)=>b.observedAt-a.observedAt||b.evidence.recordedAt-a.evidence.recordedAt)[0];
  const base={id,label,unit,basis,status:e?'observed':'unknown',value:e?.value??null,observedAt:e?.observedAt??null,evidence:e?.evidence??null,
   industryComparison:{status:'unknown',value:null,difference:null,premiumPct:null,reason:'缺少同期同口径行业样本及当时归属证据'}};
  if(!e)return base;
  const p=e.industry,received=receipt(p),available=instant(p?.availableAt),observed=instant(p?.observedAt),membership=instant(p?.membershipKnownAt);
  if(!p||!source(p)||isTest(p)||p.retracted===true||!safeText(p.code,80)||!safeText(p.classificationVersion,120)||membership===null||membership>e.observedAt||received===null||received>asOf||available===null||available>asOf||observed!==e.observedAt||observed>received||observed>available||p.unit!==unit||p.basis!==basis||p.currency!==e.currency||p.priceBasis!==e.priceBasis||p.method!=='median'||!Number.isSafeInteger(p.sampleSize)||p.sampleSize<3||!finite(p.value)||!hashOK(p.evidenceHash)||!safeText(p.revisionId,120))return base;
  const meaningful=(id==='dividendYieldPct'?e.value>=0&&p.value>=0:e.value>0&&p.value>0);
  base.industryComparison={status:meaningful?'comparable':'not-comparable',industryCode:p.code,classificationVersion:p.classificationVersion,membershipKnownAt:membership,method:'median',sampleSize:p.sampleSize,
   value:p.value,difference:meaningful?round(e.value-p.value):null,premiumPct:meaningful&&p.value>0?round((e.value/p.value-1)*100):null,
   reason:meaningful?'同期已披露口径的行业中位数对照，不推导买卖结论':'负值或零估值分母不形成有效溢价对照',evidence:{source:source(p),recordedAt:received,availableAt:available,observedAt:observed,evidenceHash:p.evidenceHash,revisionId:p.revisionId}};
  return base;
 });
 return {status:metrics.every(m=>m.status==='observed')?'observed':metrics.some(m=>m.status==='observed')?'partial':'unknown',metrics,coverage:{observed:metrics.filter(m=>m.status==='observed').length,total:metrics.length},conflicts:[...conflicts].sort(),comparisonIsNotRecommendation:true};
}
function buildFinancialHealthEvidence({financials,archive={},code,asOf,radar}={}){
 const at=instant(asOf,true),versions=financialEnvelopeVisible(financials,at)?(list(financials?.versions).length?financials.versions:Array.isArray(financials)?financials:[financials]).filter(version=>financialEnvelopeVisible(version,at)):[],features={},used=[],conflicts=[];
 if(at!==null)for(const version of versions.slice(0,1000)){
  if(isTest(version)||version?.retracted===true)continue;
  let fields={};try{fields=financialFeatures(version,{code:String(code),asOf:at});}catch{fields={};}
  // Supplementary typed observations must carry their own disclosed revision,
  // unit and receipt. No unverified supplier numeric alias is interpreted here.
  for(const [key,,unit] of FINANCIAL_FIELDS){
   const e=version?.features?.[key],received=receipt(e),available=instant(e?.availableAt),publication=instant(e?.publishedAt)||instant(e?.publicationDate,true),updated=instant(e?.updatedAt)||instant(e?.updatedDate,true);
   if(version?.symbol===String(code)&&!isTest(version)&&version.retracted!==true&&!isTest(e)&&e?.code===String(code)&&source(e)&&e.unit===unit&&finite(e.value)&&dayOK(e.reportDate)&&publication!==null&&updated!==null&&received!==null&&available!==null&&instant(e.reportDate)<=publication&&publication<=updated&&updated<=received&&updated<=available&&received<=at&&available<=at&&/^[a-f0-9]{64}$/.test(e.evidenceHash||'')&&typeof e.revisionId==='string'&&e.revisionId.length)fields[key]={...e,recordedAt:received,availableAt:available};
  }
  for(const [key,e] of Object.entries(fields)){
   const old=features[key],id=e.evidenceId||e.evidenceHash;
   if(old&&old.reportDate===e.reportDate&&old.recordedAt===e.recordedAt&&old.value!==e.value){conflicts.push(key);delete features[key];continue;}
   if(conflicts.includes(key))continue;
   if(!old||e.reportDate>old.reportDate||e.reportDate===old.reportDate&&e.recordedAt>old.recordedAt)features[key]=e;
   used.push({field:key,reportDate:e.reportDate,publicationDate:e.publicationDate||null,updatedDate:e.updatedDate||null,recordedAt:e.recordedAt,revisionId:e.revisionId||id,evidenceId:id,value:e.value});
  }
 }
 const metrics=FINANCIAL_FIELDS.map(([id,label,unit,risk])=>{const e=features[id];return {id,label,unit,status:e?'observed':'unknown',value:e?.value??null,risk:e?risk(e.value):null,evidence:e?{source:e.source,reportDate:e.reportDate,publicationDate:e.publicationDate||null,updatedDate:e.updatedDate||null,availableAt:e.availableAt,recordedAt:e.recordedAt,revisionId:e.revisionId||e.evidenceId||e.evidenceHash,evidenceId:e.evidenceId||e.evidenceHash}:null};});
 const risks=metrics.filter(m=>m.risk).map(m=>({id:m.id,reason:m.risk,evidence:m.evidence}));
 for(const field of ['receivableGrowthPct','inventoryGrowthPct'])if(features[field]&&features.revenueGrowthPct&&features[field].reportDate===features.revenueGrowthPct.reportDate&&features[field].value-features.revenueGrowthPct.value>20)risks.push({id:field,reason:field==='receivableGrowthPct'?'应收增速超过营收20个百分点':'存货增速超过营收20个百分点',evidence:metrics.find(m=>m.id===field).evidence});
 const count=metrics.filter(m=>m.status==='observed').length;
 const disclosures=financialDisclosures({versions,archive,code:String(code||''),asOf:at}),valuation=financialValuation({versions,code:String(code||''),asOf:at});
 const disclosureRisks=disclosures.categories.flatMap(c=>c.items.filter(e=>e.risk).map(e=>({id:c.id,reason:e.risk,evidence:e.evidence})));
 const missing=[...metrics.filter(m=>m.status==='unknown').map(m=>m.label),...disclosures.categories.filter(c=>c.status!=='observed').map(c=>c.label),...valuation.metrics.filter(m=>m.status==='unknown').map(m=>m.label),...valuation.metrics.filter(m=>m.industryComparison.status!=='comparable').map(m=>m.label+'行业对照')];
 return {version:VERSION,asOf:at,code:String(code||''),status:count===0&&disclosures.coverage.observed===0&&valuation.coverage.observed===0?'unknown':missing.length?'partial':'observed-research-only',coverage:{observed:count,total:metrics.length},metrics,disclosures,valuation,risks:[...risks,...disclosureRisks],missing,conflictingFields:[...new Set(conflicts)],revisions:used.sort((a,b)=>a.recordedAt-b.recordedAt||a.field.localeCompare(b.field)),
  existingRadar:radar===undefined?null:structuredClone(radar),thresholdVersion:'financial-health-1',thresholdBasis:'透明研究提示，行业阈值未经独立增益验证',...flags};
}
function signalPriceReview({signal,latestQuote,latestObservation,asOf,decisionAt}){
 const hasRange=['entryMin','entryMax'].some(k=>Object.hasOwn(signal||{},k)),isPlan=!!signal?.frozenAt||!!signal?.planId;
 const lower=finite(signal?.entryMin)&&signal.entryMin>0?signal.entryMin:null,upper=finite(signal?.entryMax)&&signal.entryMax>0?signal.entryMax:null;
 const out={status:'not-applicable',price:null,entryMin:lower,entryMax:upper,stop:finite(signal?.stop)?signal.stop:null,target:finite(signal?.target)?signal.target:null,
  outsideFrozenRange:null,quoteAt:null,receivedAt:null,source:null,evidenceKind:null,reason:'原信号未包含冻结买入区间',requiresOriginalExecutionGate:true,canTrade:false};
 if(!hasRange&&!isPlan)return out;
 if(upper===null||Object.hasOwn(signal||{},'entryMin')&&lower===null||lower!==null&&lower>upper||signal?.stop!=null&&(!finite(signal.stop)||signal.stop<=0||signal.stop>=(lower??upper))||signal?.target!=null&&(!finite(signal.target)||signal.target<=upper))return {...out,status:'unknown',reason:'原计划冻结买入区间缺失或无效'};
 if(asOf===null||decisionAt===null)return {...out,status:'unknown',reason:'原计划或观察时点未知'};
 let quote=latestQuote,kind='original-quote',original=null;
 if(!quote&&latestObservation){
  try{
   original=require('./paper-plan-observer').validateObservation(latestObservation,{now:asOf,day:dateAt(asOf),plan:signal});
   quote={symbol:original.code,price:original.price,quoteAt:original.quoteAt,receivedAt:original.receivedAt,quoteSource:original.source,mode:original.mode,tradable:original.tradable,suspended:original.suspended};
   kind='validated-plan-observation';
  }catch{return {...out,status:'unknown',reason:'原计划观察回执的版本、身份或完整性校验未通过'};}
 }
 if(!quote)return {...out,status:'unknown',reason:'缺少同股当前原始报价或原计划观察回执'};
 const row={...quote,quoteSource:quote.quoteSource||quote.source||quote.provider},view=quoteObservationView(row,asOf),received=receipt(row);
 if(String(quote.code||quote.symbol)!==String(signal.code)||isTest(quote)||view.missingReason!==null||view.quoteStatus!=='recent-unverified'||view.tradeDate!==dateAt(asOf)||!quoteSourceAllowsUse(row)||received===null||received>asOf||view.quoteAt<decisionAt||quote.timestamp!=null&&quote.timestamp!==quote.quoteAt||quote.tradeDate!=null&&quote.tradeDate!==view.tradeDate){
  return {...out,status:'unknown',quoteAt:view.quoteAt,receivedAt:view.receivedAt,source:view.quoteSource,evidenceKind:kind,reason:'同股原始报价未通过15秒、来源、日期或冻结后时点检查',missingReason:view.missingReason||'identity-source-or-time-mismatch'};
 }
 const price=quote.price,outside=price>upper||lower!==null&&price<lower,stop=finite(signal.stop)&&price<=signal.stop,target=finite(signal.target)&&price>=signal.target;
 return {...out,status:stop?'stop-condition':target?'target-condition':outside?'outside-range':'inside-range',price,outsideFrozenRange:outside,quoteAt:view.quoteAt,receivedAt:view.receivedAt,source:view.quoteSource,evidenceKind:kind,
  observationFingerprint:original?.fingerprint||null,planVersion:original?.planVersion||null,originalEntryAllowed:original?.entry?.allowed??null,
  reason:stop?'最新原始报价已触及原计划止损条件':target?'最新原始报价已触及原计划目标条件':outside?'最新原始报价超出原冻结买入区间':'最新原始报价位于原冻结买入区间；执行仍由原后端门禁判断'};
}
function reviewSignalValidity({signal,latestEvidence,latestQuote,latestObservation,asOf,policy={},revalidation}={}){
 const at=instant(asOf,true),decision=instant(signal?.decisionAt??signal?.frozenAt??signal?.recordedAt),explicit=instant(signal?.expiresAt??signal?.validUntil,true),maxAge=Number.isInteger(policy.maxAgeMs)&&policy.maxAgeMs>0&&policy.maxAgeMs<=30*DAY?policy.maxAgeMs:DAY;
 const explicitPresent=signal?.expiresAt!=null||signal?.validUntil!=null,planExpiry=dayOK(signal?.intendedDate)?Date.parse(signal.intendedDate+'T14:57:00+08:00'):null;
 const expiry=explicit??planExpiry??(decision===null?null:decision+maxAge),reasons=[];
 if(at===null||decision===null||decision>at)reasons.push('缺少当时已知的原始信号时点');
 if(isTest(signal))reasons.push('教学或测试信号不能作为正式有效信号');
 if(explicitPresent&&explicit===null)reasons.push('原信号有效期格式无效');
 if(signal?.intendedDate!=null&&planExpiry===null)reasons.push('原计划交易日无效');
 if(expiry!==null&&decision!==null&&expiry<=decision)reasons.push('有效期早于或等于信号时点');
 const expired=at!==null&&expiry!==null&&at>=expiry;
 if(expired)reasons.push('超过原信号有效期');
 const observed=instant(latestEvidence?.observedAt??latestEvidence?.quoteAt),received=receipt(latestEvidence),available=latestEvidence?.availableAt==null?received:instant(latestEvidence.availableAt),latest=at!==null&&observed!==null&&received!==null&&available!==null&&observed<=received&&observed<=available&&received<=at&&available<=at&&(decision===null||observed>=decision)&&source(latestEvidence)&&!isTest(latestEvidence)&&(!signal?.code||String(latestEvidence?.code||latestEvidence?.symbol)===String(signal.code));
 if(!latest)reasons.push('缺少可核对的当前原始证据');
 const maxDataAge=Number.isInteger(policy.maxDataAgeMs)&&policy.maxDataAgeMs>0&&policy.maxDataAgeMs<=30*DAY?policy.maxDataAgeMs:DAY;
 const stale=latest&&(at-observed>maxDataAge||latestEvidence.stale===true);
 if(stale)reasons.push('当前数据已过期');
 const originalHash=signal?.evidenceHash||signal?.snapshotHash||signal?.decisionId,currentHash=latestEvidence?.evidenceHash||latestEvidence?.snapshotHash;
 if(!hashOK(originalHash)||!hashOK(currentHash))reasons.push('缺少可比较的原信号与当前数据版本');
 if(originalHash&&currentHash&&originalHash!==currentHash)reasons.push('原判断使用的数据版本已改变');
 if(signal?.settingsVersion&&!latestEvidence?.settingsVersion)reasons.push('当前规则版本未取得');
 const rulesChanged=signal?.settingsVersion&&latestEvidence?.settingsVersion&&signal.settingsVersion!==latestEvidence.settingsVersion;
 if(rulesChanged)reasons.push('规则版本已改变');
 const conditions=list(latestEvidence?.conditions),failed=conditions.filter(c=>c?.pass===false||c?.status==='fail'),unknown=conditions.filter(c=>c?.pass!==true&&c?.status!=='pass'&&c?.pass!==false&&c?.status!=='fail');
 if(failed.length)reasons.push('原成立条件已失效');
 if(unknown.length||!conditions.length)reasons.push('当前条件尚未完整复核');
 const priceReview=signalPriceReview({signal,latestQuote,latestObservation,asOf:at,decisionAt:decision});
 if(!['inside-range','not-applicable'].includes(priceReview.status))reasons.push(priceReview.reason);
 const blocked=latestEvidence?.blocked===true||latestEvidence?.gate?.position===0||latestEvidence?.gate?.canTrade===false||priceReview.evidenceKind==='validated-plan-observation'&&priceReview.originalEntryAllowed!==true;
 if(blocked)reasons.push('原风控或执行门禁限制或尚未确认');
 const baseValid=!isTest(signal)&&at!==null&&decision!==null&&decision<=at&&expiry!==null&&expiry>decision&&(!explicitPresent||explicit!==null)&&(signal?.intendedDate==null||planExpiry!==null);
 const status=!baseValid?'unknown':expired?'expired':reasons.length?'requires-revalidation':'research-valid';
 let checked={status:'not-validated',reason:'重新验证必须留下新的时点和证据，不能延长旧信号或覆盖执行门禁'};
 if(revalidation){
  const checkedAt=instant(revalidation.evaluatedAt),id=String(signal?.id||signal?.planId||'');
  const valid=baseValid&&!expired&&latest&&!stale&&!blocked&&['inside-range','not-applicable'].includes(priceReview.status)&&checkedAt!==null&&checkedAt>=decision&&checkedAt<=at&&checkedAt>=received&&(!priceReview.receivedAt||checkedAt>=priceReview.receivedAt)&&revalidation.signalId===id&&hashOK(currentHash)&&revalidation.evidenceHash===currentHash&&revalidation.status==='pass'&&conditions.length>0&&!failed.length&&!unknown.length&&(!rulesChanged||revalidation.settingsVersion===latestEvidence.settingsVersion)&&(!signal?.settingsVersion||!!latestEvidence?.settingsVersion);
  checked={status:valid?'research-revalidated':'rejected',evaluatedAt:checkedAt,evidenceHash:valid?currentHash:null,originalStatus:status,canTrade:false,requiresOriginalExecutionGate:true,reason:valid?'新证据仅形成独立研究复核记录，原信号状态保留':'复核时点、身份、条件、区间或原门禁不满足'};
 }
 return {version:'signal-validity-2',asOf:at,signalId:String(signal?.id||signal?.planId||''),decisionAt:decision,expiresAt:expiry,expiryBasis:explicit!==null?'frozen-explicit-expiry':planExpiry!==null?'original-plan-entry-session-policy':'versioned-research-policy',originalHashBasis:signal?.evidenceHash?'evidence-hash':signal?.snapshotHash?'snapshot-hash':signal?.decisionId?'original-decision-id':null,status,reasons:[...new Set(reasons)],priceReview,failedConditions:failed.map(c=>String(c.id||c.field||'条件')),unknownConditions:unknown.map(c=>String(c.id||c.field||'条件')),revalidation:checked,requiresOriginalExecutionGate:true,...flags};
}
function buildEvolutionMarketEvidence({archive={},code,asOf,financials,signal,latestEvidence,latestQuote,latestObservation,calendar,benchmarks,radar,revalidation}={}){
 return {schemaVersion:1,version:VERSION,asOf:instant(asOf,true),code:String(code||''),relativeStrength:buildRelativeStrengthEvidence({archive,code,asOf,benchmarks}),multiTimeframe:buildMultiTimeframeEvidence({archive,code,asOf,calendar}),financialHealth:buildFinancialHealthEvidence({financials,archive,code,asOf,radar}),signalValidity:reviewSignalValidity({signal,latestEvidence,latestQuote,latestObservation,asOf,revalidation}),...flags};
}
module.exports={VERSION,TIMEFRAME_VERSION,evaluateMarketFactorGain,buildRelativeStrengthEvidence,buildMultiTimeframeEvidence,buildFinancialHealthEvidence,reviewSignalValidity,buildEvolutionMarketEvidence};
