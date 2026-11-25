'use strict';
// Pure projections over the existing archive. Receipt time, source identity and
// closed periods are retained; these views cannot approve or execute an order.
const {createHash}=require('node:crypto');
const {financialFeatures}=require('./public-stock-financials');
const {performanceStatistics}=require('./performance-statistics');
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
const receipt=x=>instant(x?.knownAt??x?.receivedAt??x?.recordedAt);
const isTest=x=>isTestSample(x)||x?.simulated===true||/synthetic|fixture|mock|demo|simulated|教学|测试/i.test(source(x));
function visible(row,asOf){
 const known=receipt(row),available=instant(row?.availableAt??row?.date),ended=instant(row?.date);
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
   if(receipt(old)===at&&hash([old.open,old.high,old.low,old.close,old.volume,source(old)])!==hash([row.open,row.high,row.low,row.close,row.volume,source(row)]))conflicts.add(row.date);
   else if(at>receipt(old)&&row.revisionId)byDate.set(row.date,row);
   else if(at!==receipt(old)&&hash([old.open,old.high,old.low,old.close,old.volume])!==hash([row.open,row.high,row.low,row.close,row.volume]))conflicts.add(row.date);
  }else byDate.set(row.date,row);
 }
 return {rows:[...byDate].filter(([date])=>!conflicts.has(date)).map(([,r])=>r).sort((a,b)=>a.date.localeCompare(b.date)),conflicts:[...conflicts].sort(),rejected};
}
const reference=r=>({date:r.date,source:source(r),knownAt:receipt(r),availableAt:instant(r.availableAt||r.date),revisionId:r.revisionId||null,priceBasis:r.priceBasis||null,
 values:Object.fromEntries(['open','high','low','close','volume','amount'].filter(k=>finite(r[k])).map(k=>[k,r[k]]))});
const kindName={market:'大盘',industry:'行业',sector:'板块',theme:'题材'};
function relativeClassification(stockReturn,benchmarkReturn,excess,peakRet,drawdown){
 const tags=[];
 if(stockReturn>0&&benchmarkReturn<0)tags.push('逆势走强');
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
   const possible=raw.filter(r=>kind==='market'?r.role==='index':r.role===kind||r.role==='sector'&&(r.benchmarkKind||'sector')===kind);
   const groups=new Map();for(const row of possible){const id=String(row.code||row.sector||row.theme||'');if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
   const chosen=[...groups].filter(([id,rows])=>associations[kind]?id===associations[kind]||rows.some(r=>r.sector===associations[kind]||r.theme===associations[kind]||r.industry===associations[kind]):kind==='market'&&groups.size===1);
   for(const [id,bars] of chosen)specs.push({kind,id,bars,membershipKnownAt:last.knownAt||last.receivedAt,source:source(last)});
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
     Object.assign(row,{stockReturnPct:round(own),benchmarkReturnPct:round(bench),excessPct:round(excess),peakReturnPct:round(peakRet),drawdownFromPeakPct:round(drawdown),tags:relativeClassification(own,bench,excess,peakRet,drawdown),evidence:[...rows.map(reference),...aligned.map(reference)]});
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
  const rawPeriods=[...new Set(rows.filter(r=>period(r.period||(String(r.date).length>10?'分时':'日K'))===kind).map(r=>r.period||'分时'))];
  const minutes=p=>p==='分时'?1:Number(/\d+/.exec(p)?.[0])||Infinity;
  const sourcePeriod=kind==='minute'?rawPeriods.sort((a,b)=>minutes(a)-minutes(b)||a.localeCompare(b))[0]:null;
  const accepted=[],incomplete=[],direct=cleanSeries(kind==='minute'?rows.filter(r=>(r.period||'分时')===sourcePeriod):rows,at,{code:String(code),kind}).rows;
  for(const row of direct){
   if(![row.open,row.high,row.low,row.close,row.volume].every(finite)||Math.min(row.open,row.high,row.low,row.close)<=0||row.volume<0||row.high<Math.max(row.open,row.close,row.low)||row.low>Math.min(row.open,row.close)){incomplete.push(row.date);continue;}
   if(kind==='minute'&&String(row.date).length<=10){incomplete.push(row.date);continue;}
   const c=cycle(row.date,kind),sessions=calendarSessions(calendar,c,at),lastDay=sessions?.at(-1)||c.end;
   const close=kind==='minute'?instant(row.date):instant(lastDay);
   // A Wednesday's weekly bar or this month's accumulated bar is never treated
   // as a completed cycle merely because the provider set a boolean flag.
   if(close===null||close>at||(kind==='week'||kind==='month')&&row.date.slice(0,10)!==lastDay){incomplete.push(row.date);continue;}
   accepted.push({...row,cycleStart:c.start,cycleEnd:lastDay,closedAt:close,derived:false});
  }
  if((kind==='week'||kind==='month')&&!accepted.length){
   const groups=new Map();for(const row of daily){const c=cycle(row.date,kind);if(!groups.has(c.start))groups.set(c.start,{c,rows:[]});groups.get(c.start).rows.push(row);}
   for(const {c,rows:rs} of groups.values()){
    const sessions=calendarSessions(calendar,c,at);
    if(!sessions?.length||instant(sessions.at(-1))>at||rs.length!==sessions.length||rs.some((r,i)=>r.date!==sessions[i])||!rs.every(r=>[r.open,r.high,r.low,r.close,r.volume].every(finite))||new Set(rs.map(source)).size!==1||new Set(rs.map(r=>r.priceBasis)).size!==1){incomplete.push(c.start);continue;}
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
function buildFinancialHealthEvidence({financials,code,asOf,radar}={}){
 const at=instant(asOf,true),versions=list(financials?.versions).length?financials.versions:Array.isArray(financials)?financials:[financials],features={},used=[],conflicts=[];
 if(at!==null)for(const version of versions.slice(0,1000)){
  let fields={};try{fields=financialFeatures(version,{code:String(code),asOf:at});}catch{fields={};}
  // Supplementary typed observations must carry their own disclosed revision,
  // unit and receipt. No unverified supplier numeric alias is interpreted here.
  for(const [key,,unit] of FINANCIAL_FIELDS){
   const e=version?.features?.[key],received=instant(e?.recordedAt??e?.receivedAt),available=instant(e?.availableAt),publication=instant(e?.publishedAt)||instant(e?.publicationDate,true),updated=instant(e?.updatedAt)||instant(e?.updatedDate,true);
   if(version?.symbol===String(code)&&version.simulated!==true&&version.retracted!==true&&e?.code===String(code)&&source(e)&&e.unit===unit&&finite(e.value)&&dayOK(e.reportDate)&&publication!==null&&updated!==null&&received!==null&&available!==null&&instant(e.reportDate)<=publication&&publication<=updated&&updated<=received&&received<=at&&available<=at&&/^[a-f0-9]{64}$/.test(e.evidenceHash||'')&&typeof e.revisionId==='string'&&e.revisionId.length)fields[key]={...e,recordedAt:received,availableAt:available};
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
 return {version:VERSION,asOf:at,code:String(code||''),status:count===0?'unknown':count<metrics.length?'partial':'observed-research-only',coverage:{observed:count,total:metrics.length},metrics,risks,missing:metrics.filter(m=>m.status==='unknown').map(m=>m.label),conflictingFields:[...new Set(conflicts)],revisions:used.sort((a,b)=>a.recordedAt-b.recordedAt||a.field.localeCompare(b.field)),
  existingRadar:radar===undefined?null:structuredClone(radar),thresholdVersion:'financial-health-1',thresholdBasis:'透明研究提示，行业阈值未经独立增益验证',...flags};
}
function reviewSignalValidity({signal,latestEvidence,asOf,policy={},revalidation}={}){
 const at=instant(asOf,true),decision=instant(signal?.decisionAt??signal?.frozenAt??signal?.recordedAt),explicit=instant(signal?.expiresAt??signal?.validUntil,true),maxAge=Number.isInteger(policy.maxAgeMs)&&policy.maxAgeMs>0&&policy.maxAgeMs<=30*DAY?policy.maxAgeMs:DAY;
 const expiry=explicit??(decision===null?null:decision+maxAge),reasons=[];
 if(at===null||decision===null||decision>at)reasons.push('缺少当时已知的原始信号时点');
 if(expiry!==null&&decision!==null&&expiry<=decision)reasons.push('有效期早于或等于信号时点');
 const expired=at!==null&&expiry!==null&&at>=expiry;
 if(expired)reasons.push('超过原信号有效期');
 const observed=instant(latestEvidence?.observedAt??latestEvidence?.quoteAt),received=receipt(latestEvidence),latest=at!==null&&observed!==null&&received!==null&&observed<=received&&received<=at&&source(latestEvidence)&&!isTest(latestEvidence)&&(!signal?.code||String(latestEvidence?.code||latestEvidence?.symbol)===String(signal.code));
 if(!latest)reasons.push('缺少可核对的当前原始证据');
 const maxDataAge=Number.isInteger(policy.maxDataAgeMs)&&policy.maxDataAgeMs>0&&policy.maxDataAgeMs<=30*DAY?policy.maxDataAgeMs:DAY;
 if(latest&&(at-observed>maxDataAge||latestEvidence.stale===true))reasons.push('当前数据已过期');
 const originalHash=signal?.evidenceHash||signal?.snapshotHash,currentHash=latestEvidence?.evidenceHash||latestEvidence?.snapshotHash;
 if(!/^[a-f0-9]{64}$/.test(originalHash||'')||!/^[a-f0-9]{64}$/.test(currentHash||''))reasons.push('缺少可比较的原信号与当前数据版本');
 if(originalHash&&currentHash&&originalHash!==currentHash)reasons.push('原判断使用的数据版本已改变');
 if(signal?.settingsVersion&&latestEvidence?.settingsVersion&&signal.settingsVersion!==latestEvidence.settingsVersion)reasons.push('规则版本已改变');
 const conditions=list(latestEvidence?.conditions),failed=conditions.filter(c=>c?.pass===false||c?.status==='fail'),unknown=conditions.filter(c=>c?.pass!==true&&c?.status!=='pass'&&c?.pass!==false&&c?.status!=='fail');
 if(failed.length)reasons.push('原成立条件已失效');
 if(unknown.length||!conditions.length)reasons.push('当前条件尚未完整复核');
 if(latestEvidence?.blocked===true||latestEvidence?.gate?.position===0||latestEvidence?.gate?.canTrade===false)reasons.push('原风控或执行门禁限制');
 const baseValid=at!==null&&decision!==null&&decision<=at&&expiry!==null&&expiry>decision;
 const status=!baseValid?'unknown':expired?'expired':reasons.length?'requires-revalidation':'research-valid';
 let checked={status:'not-validated',reason:'重新验证必须留下新的时点和证据，不能延长旧信号或覆盖执行门禁'};
 if(revalidation){
  const checkedAt=instant(revalidation.evaluatedAt),id=String(signal?.id||signal?.planId||'');
  const valid=baseValid&&latest&&checkedAt!==null&&checkedAt>=decision&&checkedAt<=at&&checkedAt>=received&&revalidation.signalId===id&&/^[a-f0-9]{64}$/.test(currentHash||'')&&revalidation.evidenceHash===currentHash&&revalidation.status==='pass'&&conditions.length>0&&!failed.length&&!unknown.length;
  checked={status:valid?'research-revalidated':'rejected',evaluatedAt:checkedAt,evidenceHash:valid?currentHash:null,originalStatus:status,canTrade:false,requiresOriginalExecutionGate:true,reason:valid?'新证据仅形成独立研究复核记录，原信号状态保留':'复核时点、身份、条件或证据不完整'};
 }
 return {version:'signal-validity-1',asOf:at,signalId:String(signal?.id||signal?.planId||''),decisionAt:decision,expiresAt:expiry,expiryBasis:explicit===null?'versioned-research-policy':'frozen-explicit-expiry',status,reasons:[...new Set(reasons)],failedConditions:failed.map(c=>String(c.id||c.field||'条件')),unknownConditions:unknown.map(c=>String(c.id||c.field||'条件')),revalidation:checked,requiresOriginalExecutionGate:true,...flags};
}
function buildEvolutionMarketEvidence({archive={},code,asOf,financials,signal,latestEvidence,calendar,benchmarks,radar,revalidation}={}){
 return {schemaVersion:1,version:VERSION,asOf:instant(asOf,true),code:String(code||''),relativeStrength:buildRelativeStrengthEvidence({archive,code,asOf,benchmarks}),multiTimeframe:buildMultiTimeframeEvidence({archive,code,asOf,calendar}),financialHealth:buildFinancialHealthEvidence({financials,code,asOf,radar}),signalValidity:reviewSignalValidity({signal,latestEvidence,asOf,revalidation}),...flags};
}
module.exports={VERSION,TIMEFRAME_VERSION,evaluateMarketFactorGain,buildRelativeStrengthEvidence,buildMultiTimeframeEvidence,buildFinancialHealthEvidence,reviewSignalValidity,buildEvolutionMarketEvidence};
