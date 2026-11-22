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
function firstSealTime(value,day,receivedAt){
 if(typeof value!=='string'||!/^\d{6}$/.test(value))return null;
 const time=value.match(/../g).join(':'),at=Date.parse(day+'T'+time+'+08:00');
 // The opening match and the two trading sessions share the same provider field.
 const session=time==='09:25:00'||time>='09:30:00'&&time<='11:30:00'||time>='13:00:00'&&time<='15:00:00';
 return session&&at<=receivedAt?time:null;
}

export function sectorLeadershipEvidence(state={},now=Date.now()){
 const meta=state.ztReviewPoolMeta,day=reviewDay(meta?.tradeDate),sources=arr(meta?.sources);
 const source=sources.find(item=>item?.source==='eastmoney');
 const sourceAt=source?.receivedAt;
 const received=at=>Number.isSafeInteger(at)&&chinaDay(at)>=day&&at<=now;
 const current=day&&reviewDay(source?.tradeDate)===day&&['available','partial'].includes(source?.status)&&
  received(sourceAt);
 const secondSource=current&&sources.find(item=>item?.source==='cls'&&item.status==='available'&&
  item.providerComplete===true&&reviewDay(item.tradeDate)===day&&received(item.receivedAt));
 const members=new Map(),industries=new Map(),duplicates=new Set();
 if(current)for(const row of arr(state.ztReviewPool)){
  const batch=row?.poolEvidence;
  // Retained or reconstructed records cannot supply timings from the current response.
  if(row?.src!=='em'||typeof row.code!=='string'||!/^\d{6}$/.test(row.code)||row.heldRecord===true||
    row.sourceStatuses?.eastmoney!==source.status||!arr(row.sources).includes('eastmoney')||
    reviewDay(row.tradeDate)!==day||reviewDay(row.sourceTradeDate)!==day||batch?.source!=='em'||
    batch.scope!=='eastmoney-limit-up-pool'||reviewDay(batch.tradeDate)!==day||batch.receivedAt!==sourceAt)continue;
  if(members.has(row.code)){duplicates.add(row.code);continue;}
  members.set(row.code,{code:row.code,name:row.name||row.code,industry:typeof row.sector==='string'?row.sector.trim():'',
   firstSeal:firstSealTime(row.firstSeal,day,sourceAt),
   crossListed:row.sourceStatuses?.cls==='available'&&row.clsObservation?.source==='cls'&&
    reviewDay(row.clsObservation.tradeDate)===day&&row.clsObservation.receivedAt===secondSource?.receivedAt});
 }
 for(const code of duplicates)members.delete(code);
 for(const member of members.values()){
  if(!member.industry||['-','--','未知','板块待核验'].includes(member.industry))continue;
  if(!industries.has(member.industry))industries.set(member.industry,[]);
  industries.get(member.industry).push(member);
 }
 const complete=source?.status==='available'&&source.providerComplete===true&&!duplicates.size&&
  source.totalCount===members.size&&source.uniqueCount===members.size;
 return stock=>{
  const dates=[stock?.poolDay,stock?.sourceTradeDate,stock?.tradeDate].filter(value=>value!=null&&value!=='').map(reviewDay);
  const tradeDate=dates.length?dates[0]:chinaDay(stock?.vendorQuoteAt??stock?.quoteAt);
  if(!tradeDate||dates.some(date=>date!==tradeDate))return {status:'pending',tradeDate:null,reason:'个股原始交易日待核验'};
  if(!current||tradeDate!==day)return {status:'pending',tradeDate,reason:'缺少与个股同日的东方财富涨停批次'};
  const own=members.get(stock?.code),industry=own?.industry,group=industries.get(industry);
  if(!own||!group)return {status:'pending',tradeDate,reason:own?'来源行业待核验':'个股在该批次缺少可核验的涨停记录'};
  const peers=group.filter(member=>member.code!==own.code),timed=peers.filter(member=>member.firstSeal);
  const earlier=own.firstSeal?timed.filter(member=>member.firstSeal<own.firstSeal):[];
  const tied=own.firstSeal?timed.filter(member=>member.firstSeal===own.firstSeal):[];
  const later=own.firstSeal?timed.filter(member=>member.firstSeal>own.firstSeal):[];
  later.sort((a,b)=>a.firstSeal.localeCompare(b.firstSeal)||a.code.localeCompare(b.code));
  // Count-based research display within one provider's industry and limit-up scope.
  // A missing clock can change the ordering, so it prevents a strength label.
  let status='pending',reason=null;
  if(!own.firstSeal)reason='个股首封时间待核验';
  else if(!complete)reason='来源批次覆盖不完整，先后仅供样本核对';
  else if(timed.length!==peers.length)reason='部分同业首封时间待核验';
  else if(earlier.length)status='following';
  else if(tied.length)status='tied';
  else status=later.length>=4?'early-spread':'early-limited';
  return {status,reason,tradeDate,industry,sourceAt,complete,firstSeal:own.firstSeal,peerCount:peers.length,
   timedCount:timed.length,earlierCount:earlier.length,tiedCount:tied.length,later,
   crossListed:secondSource?own.crossListed:null,crossListedPeers:secondSource?peers.filter(member=>member.crossListed).length:null};
 };
}

export function limitReasonEvidence(row,text,tradeDate){
 const day=reviewDay(tradeDate);
 const reason=typeof text==='string'?text.trim():'';
 const source=typeof row?.reasonSource==='string'?row.reasonSource.trim():'';
 if(!day||!reason||!source||row.reasonDateStatus!=='matched'||reviewDay(row.reasonTradeDate)!==day)return null;
 return {reason,reasonSource:source,reasonDay:day};
}
export const reviewSupplier=value=>String(value||'来源待核验').split(/\s*\+\s*/).map(name=>
 ({eastmoney:'东方财富',em:'东方财富',cls:'财联社',ths:'同花顺',tencent:'腾讯',sina:'新浪',derive:'历史行情重建','dated-stock-reconstruction':'历史行情重建'})[name]||name).join(' + ');
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
  const originalReason=dateMatched?(limitReasonEvidence(row,row.reason,day)||limitReasonEvidence(review,review?.reasonRaw,day)):null;
  const role=dateMatched?(row.role||review?.role):null;
  const sector=typeof row.sector==='string'?row.sector:'',sectorTags=[...new Set([...arr(row.sectorTags),sector].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
  return {code:row.code,name:row.name||row.code,sector,sectorTags,day,sourceDay,dateMatched,isST:typeof row.isST==='boolean'?row.isST:/^\*?ST/i.test(String(row.name||'').trim())?true:null,
   heldRecord:row.heldRecord===true,currentSourceConfirmed:typeof row.currentSourceConfirmed==='boolean'?row.currentSourceConfirmed:null,
   heldSources:arr(row.heldSources).filter(value=>typeof value==='string'),sourceStatuses:row.sourceStatuses&&typeof row.sourceStatuses==='object'?{...row.sourceStatuses}:{},
   reasonSourceStatus:row.reasonSourceStatus||null,receivedAt:row.receivedAt??null,sourceEventAt:row.sourceEventAt??null,reasonReceivedAt:row.reasonReceivedAt??null,
   source:arr(row.sources).filter(value=>typeof value==='string').join(' + ')||row.src||row.quoteSource||'来源待核验',limitUpCount:Number.isInteger(row.limitUpCount)&&row.limitUpCount>0?row.limitUpCount:null,
   reason:originalReason?.reason||null,reasonSource:originalReason?.reasonSource||null,reasonDay:originalReason?.reasonDay||null,
   role:['leader','deputy','mid','follow'].includes(role)?role:null,
   linkedRecords:arr(review?.peers).filter(peer=>{const own=dates(peer);return !own.conflict&&(!own.day||own.day===day);}).map(peer=>({name:typeof peer.n==='string'?peer.n:typeof peer.name==='string'?peer.name:'名称待核验',code:/^\d{6}$/.test(peer.code||'')?peer.code:null,limitUpCount:Number.isInteger(peer.lb)&&peer.lb>=0?peer.lb:null,role:['leader','deputy','mid','follow'].includes(peer.role)?peer.role:null,strong:peer.strong===true})),
   stock:{code:row.code,name:row.name,price:row.price,pct:row.pct,sector:row.sector,poolDay:dateMatched?day:null,quoteAt:row.quoteAt,vendorQuoteAt:row.vendorQuoteAt,quoteSource:row.quoteSource||row.src,receivedAt:row.receivedAt},peers:[]};
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

// Presentation only. Recovered observations never enter the decision or trading engine.
const recoveryLimits={adv:[0,20000],dec:[0,20000],upLimit:[0,20000],downLimit:[0,20000],breakRate:[0,100],height:[0,100],amount:[0,1e8],leader:[-100,1000],diffusion:[0,100],premium:[-100,1000],indexChange:[-100,1000]};
const phases=['冰点','发酵','高潮','分歧','退潮'];
const countMetrics=new Set(['adv','dec','upLimit','downLimit','height']);
export function recoveredMetric(recovery,key,day=recovery?.referenceDay,asOf=Date.now()){
 const row=key==='emotion'?recovery?.emotion:recovery?.metrics?.[key];
 if(!validDay(day)||!row||!validDay(row.date)||row.date>day||row.date>chinaDay(asOf)||
    !finite(row.knownAt)||row.knownAt<=0||row.knownAt>asOf||row.date>chinaDay(row.knownAt)||typeof row.source!=='string'||!row.source.trim())return null;
 const bounds=recoveryLimits[key],v=row.value;
 if(bounds){if(!finite(v)||v<bounds[0]||v>bounds[1]||countMetrics.has(key)&&!Number.isSafeInteger(v))return null;}
 else if(key==='emotion'){if(!phases.includes(v)||!finite(row.confidence)||row.confidence<0||row.confidence>100)return null;}
 else if(['trend','sh','cy'].includes(key)){if(!['多头','震荡','空头'].includes(v))return null;}
 else if(typeof v!=='string'||!v.trim()||['未知','未判定','待判定'].includes(v.trim()))return null;
 return {...row,historical:row.date!==day};
}
export const marketPhaseName=value=>phases.includes(value)?value:'';
export function observedCoverage(recovery,day=recovery?.referenceDay,asOf=Date.now()){
 if(!validDay(day)||!Array.isArray(recovery?.coverage))return [];
 const scopes=new Map();
 for(const raw of recovery.coverage){
  if(!raw||!validDay(raw.day)||raw.day>day||!raw.scope?.trim?.()||!raw.source?.trim?.()||
     !finite(raw.knownAt)||raw.knownAt<=0||raw.knownAt>asOf||raw.day>chinaDay(raw.knownAt)||
     !Number.isSafeInteger(raw.observed)||raw.observed<1||raw.total!=null&&(!Number.isSafeInteger(raw.total)||raw.total<raw.observed))continue;
  const numbers={};for(const key of ['adv','dec','flat'])if(Number.isSafeInteger(raw[key])&&raw[key]>=0&&raw[key]<=raw.observed)numbers[key]=raw[key];
  if(Object.values(numbers).reduce((a,b)=>a+b,0)>raw.observed)continue;
  const memberCounts=Object.keys(numbers).length>0;
  if(finite(raw.change)&&raw.change>=-100&&raw.kind==='sector'&&raw.observed===1&&!memberCounts)numbers.change=raw.change;
  if(finite(raw.meanChange)&&raw.meanChange>=-100&&memberCounts)numbers.meanChange=raw.meanChange;
  if(finite(raw.amountCny)&&raw.amountCny>=0)numbers.amountCny=raw.amountCny;
  const key=JSON.stringify([raw.scope,raw.kind,raw.source]),previous=scopes.get(key);
  if(!previous||previous.day<raw.day||previous.day===raw.day&&previous.knownAt<raw.knownAt)scopes.set(key,{scope:raw.scope,source:raw.source,day:raw.day,knownAt:raw.knownAt,
   observed:raw.observed,total:raw.total??null,complete:raw.complete===true&&raw.observed===raw.total,...numbers});
 }
 return [...scopes.values()].sort((a,b)=>b.day.localeCompare(a.day)||b.observed-a.observed);
}
export const turnoverLabel=r=>/沪深两市/.test([r?.scope,r?.source].filter(Boolean).join(' '))?'沪深两市成交额':'成交额';
export function coverageValues(row){
 const signed=v=>(v>0?'+':'')+v.toLocaleString('zh-CN',{maximumFractionDigits:2})+'%';
 return [row.change!=null?'板块指数涨跌幅 '+signed(row.change):'',row.meanChange!=null?'已核个股等权平均涨跌幅 '+signed(row.meanChange):'',row.adv!=null?'上涨 '+row.adv+' 家':'',row.dec!=null?'下跌 '+row.dec+' 家':'',row.flat!=null?'平盘 '+row.flat+' 家':'',
  row.amountCny!=null?'成交额 '+(row.amountCny/1e8).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 亿元':''].filter(Boolean).join(' · ');
}

export const coverageCount=row=>'已核 '+row.observed+(row.total!=null?' / '+row.total:'')+(['adv','dec','flat'].some(k=>row[k]!=null)?' 只':' 条');
export function archivedStockQuote(bars,code,day=chinaDay(Date.now()),asOf=Date.now()){
 if(!/^\d{6}$/.test(code)||!validDay(day))return null;
 let best=null;
 for(const r of Array.isArray(bars)?bars:[]){
  if(r.code!==code||r.role!=='stock'||r.period!=='日K'||!validDay(r.date)||r.date>day||typeof r.source!=='string'||!r.source.trim()||
     !finite(r.close)||r.close<=0||!Number.isSafeInteger(r.knownAt)||r.knownAt<=0||r.knownAt>asOf||r.date>chinaDay(r.knownAt))continue;
  if(!best||r.date>best.date||r.date===best.date&&r.knownAt>best.knownAt)best={value:r.close,date:r.date,source:r.source,knownAt:r.knownAt};
 }
 return best;
}
