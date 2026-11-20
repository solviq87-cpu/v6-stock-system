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

// Provenance-first, read-only interpretation of existing server dashboard rows.
// A score, historic quote or unverified provider "buy" label cannot authorize trading.
export function projectDecisionBrief(state,{now=Date.now(),limit=3}={}) {
  const date=value=>{
    if(typeof value!=='string')return null;
    const day=/^\d{8}$/.test(value)?value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6):value;
    return validDay(day)?day:null;
  };
  const clipped=value=>typeof value==='string'?value.trim().slice(0,120):'';
  const raw=Array.isArray(state?.dashboard?.rows)?state.dashboard.rows:[];
 const marketDay=date(Object.hasOwn(state?.snapshotFieldDays||{},'dashboard')?state.snapshotFieldDays.dashboard:state?.dashboard?.snapshotDay);
  const seen=new Set(),items=[],counts={buy:0,watch:0,sell:0};
  const bounded=Number.isSafeInteger(limit)?Math.max(0,Math.min(limit,20)):3;
  for(const row of raw.slice(0,200)) {
    if(!row||typeof row!=='object'||Array.isArray(row))continue;
    const code=String(row.code||'');
    if(!/^\d{6}$/.test(code)||seen.has(code))continue;
    seen.add(code);
    const ownDay=row.poolDay||row.tradeDate;
    const rowDay=ownDay?date(ownDay):marketDay;
    // quoteAt/quoteTimestamp can be a copied reception or snapshot clock.
    // Only an explicit supplier-origin field may qualify for this display gate.
    const originalAt=Number.isSafeInteger(row.vendorQuoteAt)&&row.vendorQuoteAt>0&&row.vendorQuoteAt<8e15
      ?row.vendorQuoteAt:null;
    const receivedAt=Number.isSafeInteger(row.receivedAt)&&row.receivedAt>0?row.receivedAt:null;
    const source=clipped(row.quoteSource);
    const mode=clipped(row.quoteMode||row.mode);
    const prohibited=/simulat|readonlybackup|(?:^|[-_:\/.\s])(?:impor[t](?:ed)?|fixture|mock|test|synthetic)(?:$|[-_:\/.\s])/i;
    const sourceUsable=Boolean(source)&&!prohibited.test(source)&&
      !/simulat|research|cost|carried|histor|import|fixture|mock|test|synthetic/i.test(mode)&&
      !['simulated','readOnlyBackup','imported','fixture','mock','synthetic'].some(flag=>row[flag]===true);
    const age=originalAt===null?NaN:now-originalAt;
    const fresh=state?.trading===true&&Number.isSafeInteger(now)&&sourceUsable&&
      originalAt!==null&&row.quoteAt===originalAt&&row.quoteStatus==='recent-unverified'&&
      receivedAt!==null&&receivedAt>=originalAt&&receivedAt<=now&&
      age>=0&&age<=15000&&
      Boolean(rowDay&&marketDay&&rowDay===marketDay&&chinaDay(now)===marketDay&&chinaDay(originalAt)===marketDay);
    const review=row.decisionReview;
    const reviewed=review&&typeof review==='object'&&!Array.isArray(review)&&
      review.status==='independently-verified'&&['buy','sell'].includes(review.action)&&
      review.symbol===code&&review.quoteAt===originalAt&&
      Number.isSafeInteger(review.reviewedAt)&&review.reviewedAt>=originalAt&&review.reviewedAt<=now&&
      date(review.asOf)===rowDay&&clipped(review.source)&&
      Array.isArray(review.evidence)&&review.evidence.some(item=>typeof item==='string'&&item.trim());
    // The current server exposes verifiedLive=false: an unverified status string
    // must not produce a buy/sell research label, let alone an execution permit.
    const action=fresh&&state?.dashboard?.verifiedLive===true&&reviewed?review.action:'watch';
    counts[action]++;
    const positives=[],risks=[],signals=[];
    const originalSignals=Array.isArray(row.hit)?row.hit:Array.isArray(row.signals)?row.signals:[];
    for(const record of originalSignals){
      const label=typeof record==='string'?record:clipped(record?.text||record?.label);
      if(label&&signals.length<3)signals.push(label.slice(0,100));
    }
    if(rowDay&&marketDay&&rowDay===marketDay){
      if(row.aboveMa5===true)positives.push('接口标记站上MA5（不等于可买入）');
      if(row.aboveMa5===false)risks.push('接口标记未站上MA5');
      if(finite(row.breakCount)&&row.breakCount>0)risks.push('接口记录开板 '+Math.floor(row.breakCount)+' 次');
    }
    const events=Array.isArray(row?.issuerEvidence?.events)?row.issuerEvidence.events:[];
    for(const event of events.slice(0,30)){
      const title=clipped(event?.title);
      const published=typeof event?.publishedAt==='number'?event.publishedAt:Date.parse(event?.publishedAt||'');
      if(!title||!finite(published)||published<=0||published>now||published>=8e15)continue;
      const notice='公告标题线索 '+new Date(published+8*3600000).toISOString().slice(0,10)+'：'+title;
      if(event?.category==='risk-clue'&&risks.length<5)risks.push(notice);
      if(event?.category==='strength-clue'&&positives.length<4)positives.push(notice);
    }
    if(!risks.length)risks.push('未返回风险线索不等于零风险');
    if(!fresh)risks.unshift('报价非当前可核验的15秒盘中价格，不得直接作为操作依据');
    if(items.length<bounded)items.push({
      code,name:clipped(row.name)||code,score:finite(row.score)&&row.score>=0&&row.score<=100?row.score:null,
      action,label:action==='buy'?'服务端声明买入研究标签（非交易建议）':action==='sell'?'服务端声明卖出研究标签（非交易建议）':'观望 / 待核验',
      day:rowDay,quoteAt:originalAt,
      quoteSource:source||'来源未知',
      quoteStatus:fresh?'供应商声明原时点在15秒内（未独立认证）':'历史 / 未知 / 异常时点',
      positives,risks,signals
    });
  }
  return {marketDay,total:seen.size,counts,items,truncated:raw.length>200,
    note:'只统计首页已回传去重候选；缺原始供应商时间、接收因果时序或独立核验时保持观望。源端声明不是浏览器独立认证，不代表交易许可或策略收益。'};
}

// Display contracts only: keep original evidence and never grant trading permission.
const arr=value=>Array.isArray(value)?value.filter(Boolean):[];
export function stockReasons(row){
 const text=value=>typeof value==='string'?value:typeof value?.text==='string'?value.text:typeof value?.label==='string'?value.label:typeof value?.id==='string'?value.id:'';
 const primary=['hit','signals','explanation','reasons','why'].flatMap(key=>arr(row?.[key]).map(text)).filter(value=>value.trim());
 return [...new Set(primary.length?primary:[row?.reason,row?.why,row?.note,row?.washNote,row?.via].filter(value=>typeof value==='string'&&value.trim()))];
}
export function requirePoolReady(data){
 const status=String(data?.status||'').trim().toLowerCase(),message=[data?.error,data?.note,data?.message].find(value=>typeof value==='string'&&value.trim())||'';
 if(!data||data.ok===false||data.error||/^(?:error|failed|failure|unavailable|unknown|busy|pending|loading|calculating|computing|not-ready)$/.test(status)||/计算(?:失败|异常)|行情未就绪|正在计算|数据(?:不可用|未就绪)|采集失败/.test(message))throw Error(message||'该股票池尚未返回有效结果，请稍后重试。');
 return data;
}
const published=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:typeof value==='string'?Date.parse(value):NaN;
function cninfoAnnouncement(row,now){
 const pdf=/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/(\d{4}-\d{2}-\d{2})\/\d+\.pdf$/i.exec(typeof row?.url==='string'?row.url:'');
 return row&&row.source==='巨潮资讯 · 未独立核验'&&typeof row.title==='string'&&row.title.trim()&&
  typeof row.publishedAt==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(row.publishedAt)&&validDay(row.publishedAt.slice(0,10))&&published(row.publishedAt)>0&&published(row.publishedAt)<=now&&
  pdf&&validDay(pdf[1])&&
  arr(row.codes).length>0&&row.codes.every(code=>/^\d{6}$/.test(code));
}
export function newsRows(state={},kind,{now=Date.now()}={}){
 const good=arr(state.goodNews?.items),bad=arr(state.badNews?.items);
 // Signal events retain their strategy identities, including multiple events for one code.
 if(kind==='signals')return arr(state.signals);
 if(kind==='alerts')return bad;
 const announcements=arr(state.dashboard?.riskEvidence?.news).filter(row=>cninfoAnnouncement(row,now));
 const identity=row=>JSON.stringify([row.source,row.url,row.title,row.publishedAt,row.t,row.type,row.direction,row.codes,row.id,row.eventId,row.strategy,row.strategyId,row.system]);
 const existing=[...good,...bad],seen=new Set(existing.map(identity));
 const additions=announcements.filter(row=>{const key=identity(row);if(seen.has(key))return false;seen.add(key);return true;});
 return [...existing,...additions].sort((a,b)=>(published(b.publishedAt??b.t)||0)-(published(a.publishedAt??a.t)||0));
}

const reviewDay=value=>{const day=typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';return validDay(day)?day:null;};
export function dailyReviewEvidence(state={}){
 const readonly=Array.isArray(state.ztReviewPool),sourceEvidence=readonly&&state.ztReviewPoolMeta&&typeof state.ztReviewPoolMeta==='object'&&!Array.isArray(state.ztReviewPoolMeta)?state.ztReviewPoolMeta:null;
 const day=reviewDay(readonly?sourceEvidence?.tradeDate:state.ztDay),reviewMatched=!!day&&reviewDay(state.review?.date)===day;
 const reviews=new Map(reviewMatched?arr(state.review?.items).filter(x=>/^\d{6}$/.test(x.code||'')).map(x=>[x.code,x]):[]);
 const pool=new Map();let excludedDateRows=0;
 const dates=row=>{const declared=[row?.sourceTradeDate,row?.tradeDate].filter(value=>value!==undefined&&value!==null&&value!=='');const days=declared.map(reviewDay);return {day:days[0]||null,conflict:days.some(value=>!value)||new Set(days).size>1};};
 for(const row of arr(readonly?state.ztReviewPool:state.ztPool)){
  if(!/^\d{6}$/.test(row.code||''))continue;
  const own=dates(row);
  if(readonly&&(own.conflict||day&&own.day&&own.day!==day)){excludedDateRows++;continue;}
  const prior=pool.get(row.code),priorDate=dates(prior);
  // Select one complete matching record; never splice evidence between duplicate rows.
  if(!prior||day&&own.day===day&&!own.conflict&&(priorDate.day!==day||priorDate.conflict))pool.set(row.code,row);
 }
 const rows=[...pool.values()].map(row=>{
  const own=dates(row),sourceDay=own.conflict?null:own.day,dateMatched=!!day&&sourceDay===day;
  const review=dateMatched?reviews.get(row.code):null;
  const knownReason=x=>dateMatched&&x?.reasonDateStatus==='matched'&&reviewDay(x.reasonTradeDate)===day&&typeof x.reasonSource==='string'&&x.reasonSource.trim();
  const reasonRow=knownReason(row)&&typeof row.reason==='string'&&row.reason.trim()?row:knownReason(review)&&typeof review.reasonRaw==='string'&&review.reasonRaw.trim()?review:null;
  const role=dateMatched?(row.role||review?.role):null;
  const sector=typeof row.sector==='string'?row.sector:'',sectorTags=[...new Set([...arr(row.sectorTags),sector].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
  return {code:row.code,name:row.name||row.code,sector,sectorTags,day,sourceDay,dateMatched,isST:typeof row.isST==='boolean'?row.isST:/^\*?ST/i.test(String(row.name||'').trim())?true:null,
   heldRecord:row.heldRecord===true,currentSourceConfirmed:typeof row.currentSourceConfirmed==='boolean'?row.currentSourceConfirmed:null,
   heldSources:arr(row.heldSources).filter(value=>typeof value==='string'),sourceStatuses:row.sourceStatuses&&typeof row.sourceStatuses==='object'?{...row.sourceStatuses}:{},
   reasonSourceStatus:row.reasonSourceStatus||null,receivedAt:row.receivedAt??null,sourceEventAt:row.sourceEventAt??null,reasonReceivedAt:row.reasonReceivedAt??null,
   source:arr(row.sources).filter(value=>typeof value==='string').join(' + ')||row.src||row.quoteSource||'来源待核验',limitUpCount:Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount:null,
   reason:reasonRow?(reasonRow===row?row.reason:review.reasonRaw):null,reasonSource:reasonRow?.reasonSource||null,reasonDay:reasonRow?day:null,
   role:['leader','deputy','mid','follow'].includes(role)?role:null,
   linkedRecords:arr(review?.peers).filter(peer=>{const own=dates(peer);return !own.conflict&&(!own.day||own.day===day);}).map(peer=>({name:typeof peer.n==='string'?peer.n:typeof peer.name==='string'?peer.name:'名称待核验',code:/^\d{6}$/.test(peer.code||'')?peer.code:null,limitUpCount:Number.isInteger(peer.lb)&&peer.lb>=0?peer.lb:null,role:['leader','deputy','mid','follow'].includes(peer.role)?peer.role:null,strong:peer.strong===true})),
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
