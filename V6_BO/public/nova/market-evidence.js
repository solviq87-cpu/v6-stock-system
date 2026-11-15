/* Pure market evidence adapters for the native FAYO interface.
   Display validation does not grant trading or notification permission. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value+'T00:00:00Z')) &&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const chinaDay = now => finite(now) && now > 0 && now < 8e15
  ? new Date(now+8*3600000).toISOString().slice(0,10) : null;
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const short = (value,max=70) => typeof value === 'string' ? value.slice(0,max) : '';

export function normalizeCandles(rows,{now=Date.now()}={}) {
  const today=chinaDay(now);
  if(!Array.isArray(rows)||!today)return [];
  const seen=new Set(),result=[];
  for(const row of rows) {
    if(!row||!validDay(row.date)||row.date>today||seen.has(row.date))continue;
    const {open,high,low,close}=row;
    if(![open,high,low,close].every(finite)||low<=0||
       low>Math.min(open,close)||high<Math.max(open,close)||high<low)continue;
    // Missing or invalid volume is unknown, never a fabricated zero.
    const volume=finite(row.volume)&&row.volume>=0?row.volume:null;
    seen.add(row.date);
    result.push({date:row.date,open,high,low,close,volume});
  }
  // The first valid occurrence wins: an older history page cannot overwrite a
  // newer page's already displayed session, nor count it twice in monthly volume.
  return result.sort((left,right)=>left.date.localeCompare(right.date));
}

export function aggregateCandles(rows,period,{now=Date.now()}={}) {
  if(!['day','month','year'].includes(period))throw new Error('不支持的历史K线周期');
  const daily=normalizeCandles(rows,{now});
  if(period==='day')return daily;
  const result=[];
  for(const row of daily) {
    const bucket=row.date.slice(0,period==='month'?7:4),previous=result.at(-1);
    if(previous?.period===bucket) {
      previous.date=row.date;
      previous.high=Math.max(previous.high,row.high);
      previous.low=Math.min(previous.low,row.low);
      previous.close=row.close;
      previous.sessions++;
      const volume=previous.volume===null||row.volume===null?null:previous.volume+row.volume;
      previous.volume=finite(volume)?volume:null;
    } else result.push({period:bucket,...row,sessions:1});
  }
  return result;
}

export function movingAverages(rows,period=5,{now=Date.now()}={}) {
  if(!Number.isSafeInteger(period)||period<1||period>1000)throw new Error('均线周期需要1至1000之间的整数');
  const daily=normalizeCandles(rows,{now});
  return daily.map((row,index)=>{
    if(index+1<period)return {date:row.date,value:null};
    // Prices are positive, so this incremental mean remains inside the
    // observed range even when a raw sum would overflow to Infinity.
    let mean=daily[index-period+1].close;
    for(let count=2;count<=period;count++)mean+=(daily[index-period+count].close-mean)/count;
    return {date:row.date,value:mean};
  });
}

const horizons=[1,5,20,60];
const statuses={pending:'待成熟','calendar-incomplete':'交易日历不足',
  'corporate-action-unresolved':'公司行为待核对','missing-or-suspended':'停牌或缺价'};

export function projectForwardTracking(payload,code,{now=Date.now()}={}) {
  const empty={state:'missing',asOf:null,entries:[],observed:0,unresolved:0,
    note:'暂无服务端冻结信号的后续观察记录，不能用本次涨跌幅代替跟踪结果。'};
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!payload||typeof payload!=='object')return empty;
  const today=chinaDay(now);
  if(payload.schemaVersion!==1||payload.mode!=='forward-signal-price-observation'||
     payload.canTrade!==false||payload.verifiedLive!==false||payload.prospectiveCertified!==false||
     payload.executionSimulated!==false||!validDay(payload.asOf)||!today||payload.asOf>today||
     !fingerprint(payload.cohortFingerprint)||!fingerprint(payload.marketFingerprint)||
     !Array.isArray(payload.records)||payload.records.length>500) {
    return {...empty,state:'invalid',note:'跟踪证据协议不完整或不可信，已停止展示收益数值。'};
  }
  const entries=[],seen=new Set();
  for(const record of payload.records) {
    if(!record||record.symbol!==code||!validDay(record.signalDate)||record.signalDate>payload.asOf||
       typeof record.signalId!=='string'||!record.signalId.trim()||record.signalId.length>200||
       seen.has(record.signalId)||!Array.isArray(record.windows)||record.windows.length!==horizons.length||
       !finite(record.baselineClose)||record.baselineClose<=0)continue;
    const windows=[];
    for(let index=0;index<horizons.length;index++) {
      const window=record.windows[index],days=horizons[index];
      if(!window||window.tradingDays!==days||typeof window.status!=='string') {
        windows.push({days,state:'unknown',label:'证据无效',pct:null,date:null});continue;
      }
      const observed=window.status==='observed'&&validDay(window.targetDate)&&
        window.targetDate>record.signalDate&&window.targetDate<=payload.asOf&&
        finite(window.priceReturnPct)&&window.priceReturnPct>-100;
      if(observed) { windows.push({days,state:'observed',label:'已观察',pct:window.priceReturnPct,date:window.targetDate});continue; }
      const plausibleDate=window.targetDate===null||validDay(window.targetDate)&&window.targetDate>record.signalDate;
      const known=Object.hasOwn(statuses,window.status)&&plausibleDate;
      windows.push({days,state:known?window.status:'unknown',label:known?statuses[window.status]:'证据无效',
        pct:null,date:plausibleDate?window.targetDate:null});
    }
    seen.add(record.signalId);
    entries.push({signalId:short(record.signalId,200),date:record.signalDate,
      system:short(record.system,60)||'来源未知',cohort:short(record.cohort,80)||'条件组未知',windows});
  }
  if(!entries.length)return {...empty,asOf:payload.asOf,
    note:'没有与这只股票代码匹配的冻结信号，不能套用其他股票或本次涨跌幅。'};
  return {state:'available',asOf:payload.asOf,entries:entries.slice(0,8),totalSignals:entries.length,
    observed:entries.reduce((count,entry)=>count+entry.windows.filter(window=>window.state==='observed').length,0),
    unresolved:entries.reduce((count,entry)=>count+entry.windows.filter(window=>window.state!=='observed').length,0),
    note:'基于冻结信号日收盘价的未复权价格变化，非可成交净收益；来源与指纹未在浏览器独立认证，不可作为策略有效性结论。'};
}

// Display contracts only: keep original evidence and never grant trading permission.
const arr=value=>Array.isArray(value)?value.filter(Boolean):[];
export function stockReasons(row){
 const primary=Array.isArray(row?.hit)?row.hit.map(x=>typeof x==='string'?x:x?.text||x?.label||x?.id):Array.isArray(row?.signals)?row.signals:arr(row?.explanation);
 const reasons=[...primary,...arr(row?.reasons)].filter(x=>typeof x==='string'&&x);
 return reasons.length?reasons:[row?.reason,row?.why,row?.note,row?.washNote,row?.via].filter(x=>typeof x==='string'&&x);
}
export function requirePoolReady(data){
 const status=String(data?.status||'').toLowerCase(),message=data?.error||data?.note||data?.message||'';
 if(!data||data.ok===false||data.error||/^(?:error|failed|failure|unavailable|unknown|busy|pending|loading|calculating|computing|not-ready)$/.test(status)||/计算(?:失败|异常)|行情未就绪|正在计算|数据(?:不可用|未就绪)|采集失败/.test(message))throw Error(message||'该股票池尚未返回有效结果，请稍后重试。');
 return data;
}
const published=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:typeof value==='string'?Date.parse(value):NaN;
function cninfoAnnouncement(row){
 return row&&row.source==='巨潮资讯 · 未独立核验'&&typeof row.title==='string'&&row.title.trim()&&
  typeof row.publishedAt==='string'&&published(row.publishedAt)>0&&published(row.publishedAt)<=Date.now()&&
  /^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i.test(row.url||'')&&
  arr(row.codes).length>0&&row.codes.every(code=>/^\d{6}$/.test(code));
}
export function newsRows(state,kind){
 const good=arr(state.goodNews?.items),bad=arr(state.badNews?.items);
 // Signal events retain their strategy identities, including multiple events for one code.
 if(kind==='signals')return arr(state.signals);
 if(kind==='alerts')return bad;
 const announcements=arr(state.dashboard?.riskEvidence?.news).filter(cninfoAnnouncement);
 const identity=row=>JSON.stringify([row.source,row.url,row.title,row.publishedAt,row.t,row.type,row.direction,row.codes,row.id,row.eventId,row.strategy,row.strategyId,row.system]);
 const existing=[...good,...bad],seen=new Set(existing.map(identity));
 const additions=announcements.filter(row=>{const key=identity(row);if(seen.has(key))return false;seen.add(key);return true;});
 return [...existing,...additions].sort((a,b)=>(published(b.publishedAt??b.t)||0)-(published(a.publishedAt??a.t)||0));
}

const reviewDay=value=>{const day=typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';return validDay(day)?day:null;};
export function dailyReviewEvidence(state={}){
 const readonly=Array.isArray(state.ztReviewPool),sourceEvidence=readonly&&state.ztReviewPoolMeta&&typeof state.ztReviewPoolMeta==='object'?state.ztReviewPoolMeta:null;
 const day=reviewDay(readonly?sourceEvidence?.tradeDate:state.ztDay),reviewMatched=!!day&&reviewDay(state.review?.date)===day;
 const reviews=new Map(reviewMatched?arr(state.review?.items).filter(x=>/^\d{6}$/.test(x.code||'')).map(x=>[x.code,x]):[]);
 const pool=new Map();let excludedDateRows=0;
 for(const row of arr(readonly?state.ztReviewPool:state.ztPool)){
  if(!/^\d{6}$/.test(row.code||''))continue;
  const ownDay=reviewDay(row.sourceTradeDate||row.tradeDate);
  if(readonly&&day&&ownDay&&ownDay!==day){excludedDateRows++;continue;}
  if(!pool.has(row.code))pool.set(row.code,row);
 }
 const rows=[...pool.values()].map(row=>{
  const sourceDay=reviewDay(row.sourceTradeDate||row.tradeDate),dateMatched=!!day&&sourceDay===day;
  const review=dateMatched?reviews.get(row.code):null;
  const knownReason=x=>dateMatched&&x?.reasonDateStatus==='matched'&&reviewDay(x.reasonTradeDate)===day&&typeof x.reasonSource==='string'&&x.reasonSource.trim();
  const reasonRow=knownReason(row)&&typeof row.reason==='string'&&row.reason.trim()?row:knownReason(review)&&typeof review.reasonRaw==='string'&&review.reasonRaw.trim()?review:null;
  const role=dateMatched?(row.role||review?.role):null;
  const sector=typeof row.sector==='string'?row.sector:'',sectorTags=[...new Set([...arr(row.sectorTags),sector].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
  return {code:row.code,name:row.name||row.code,sector,sectorTags,day,sourceDay,dateMatched,
   heldRecord:row.heldRecord===true,currentSourceConfirmed:typeof row.currentSourceConfirmed==='boolean'?row.currentSourceConfirmed:null,
   heldSources:arr(row.heldSources).filter(value=>typeof value==='string'),sourceStatuses:row.sourceStatuses&&typeof row.sourceStatuses==='object'?{...row.sourceStatuses}:{},
   reasonSourceStatus:row.reasonSourceStatus||null,receivedAt:row.receivedAt??null,sourceEventAt:row.sourceEventAt??null,reasonReceivedAt:row.reasonReceivedAt??null,
   source:arr(row.sources).filter(value=>typeof value==='string').join(' + ')||row.src||row.quoteSource||'来源待核验',limitUpCount:Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount:null,
   reason:reasonRow?(reasonRow===row?row.reason:review.reasonRaw):null,reasonSource:reasonRow?.reasonSource||null,reasonDay:reasonRow?day:null,
   role:['leader','deputy','mid','follow'].includes(role)?role:null,
   linkedRecords:arr(review?.peers).map(peer=>({name:typeof peer.n==='string'?peer.n:typeof peer.name==='string'?peer.name:'名称待核验',code:/^\d{6}$/.test(peer.code||'')?peer.code:null,limitUpCount:Number.isInteger(peer.lb)&&peer.lb>=0?peer.lb:null,role:['leader','deputy','mid','follow'].includes(peer.role)?peer.role:null,strong:peer.strong===true})),
   stock:{code:row.code,name:row.name,price:row.price,pct:row.pct,sector:row.sector,quoteAt:row.quoteAt,vendorQuoteAt:row.vendorQuoteAt,quoteSource:row.quoteSource||row.src,receivedAt:row.receivedAt},peers:[]};
 });
 const groups=new Map();for(const row of rows)for(const key of row.sectorTags.length?row.sectorTags:['板块待核验']){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 for(const row of rows)if(row.sectorTags.length&&row.dateMatched){
  const related=new Map();for(const tag of row.sectorTags)for(const peer of groups.get(tag))if(peer.code!==row.code&&peer.dateMatched){
   if(!related.has(peer.code))related.set(peer.code,{code:peer.code,name:peer.name,limitUpCount:peer.limitUpCount,sharedTags:[]});related.get(peer.code).sharedTags.push(tag);
  }row.peers=[...related.values()];
 }
 const sectors=[...groups].map(([name,items])=>({name,count:items.length,logic:[...new Set(items.map(row=>row.reason).filter(Boolean))]}));
 return {day,reviewMatched,rows,sectors,readonly,sourceEvidence,excludedDateRows,reasonKnown:rows.filter(row=>row.reason).length,dateUnknown:rows.filter(row=>!row.dateMatched).length};
}
