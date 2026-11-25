'use strict';

// Derived observations only. The authority remains paper-application-service;
// this module never writes cash, positions, orders, settlements or fills.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const journal = require('./research-workspace-store');
const {withAccountLock} = require('./account-process-lock');
const {aShareCalendarDate} = require('./a-share-calendar');
const {quoteObservationView, quoteSourceAllowsUse} = require('./quote-observation-view');

const PROTOCOL = 'fayo-account-equity-evidence-v1';
const MAX_GAP_MS = 90000, MIN_SAMPLE_MS = 60000, MAX_READ = 4000, MAX_EVENT_REFERENCES = 128;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const timeOk = n => Number.isSafeInteger(n) && n > 0 && n < 8e15;
const dayOk = d => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
const idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const rawHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
const clone = value => JSON.parse(JSON.stringify(value));

function authorityOf(book, accountId) {
  if (!idOk(accountId) || !book || book.schemaVersion !== 1 || !Number.isSafeInteger(book.revision) || book.revision < 1 ||
      !book.account || !finite(book.initialCash) || book.initialCash < 0 || book.paperOnly !== true || book.brokerConnected !== false)
    throw Error('权益证据需要原权威模拟账户及有效账户标识');
  const {fingerprint, ...payload} = book, account = book.account;
  if (rawHash(payload) !== fingerprint || rawHash({cash:account.cash,positions:account.positions,events:account.events}) !== account.fingerprint ||
      !finite(account.cash) || account.cash < 0 || !account.positions || !Array.isArray(account.events) || !book.orders)
    throw Error('权益证据的权威账户指纹或现金无效');
  // reset/setInitial preserves the previous book in archives. A new epoch must
  // never inherit an old performance peak or turn new initial capital into P&L.
  const archives = book.archives || [];
  if (!Array.isArray(archives)) throw Error('权益证据的账户阶段无效');
  const accountEpoch = journal.digest({accountId,initialCash:book.initialCash,
    archiveRevisions:archives.map(row => row.revision),legacyInitial:book.legacy?.initial ?? null});
  return {accountEpoch,account};
}

function positionAvailability(position, symbol, orders, day) {
  let eligible=0, todayBlocked=0, reserved=0;
  const reasons=[];
  if (!Array.isArray(position.lots) || position.lots.reduce((n,l)=>n+l.quantity,0)!==position.quantity)
    reasons.push('POSITION_LOT_QUANTITY_UNVERIFIED');
  for (const lot of position.lots || []) {
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity<0 || !dayOk(lot.buyDate) || lot.buyDate>day ||
        lot.sellableDate != null && (!dayOk(lot.sellableDate) || lot.sellableDate<lot.buyDate) ||
        lot.reserved != null && (!Number.isSafeInteger(lot.reserved) || lot.reserved<0 || lot.reserved>lot.quantity)) {
      reasons.push('POSITION_LOT_SELLABILITY_UNVERIFIED'); continue;
    }
    const usable=lot.sellableDate ? lot.sellableDate<=day : lot.buyDate<day;
    if (usable) { eligible+=lot.quantity; reserved+=lot.reserved || 0; }
    else todayBlocked+=lot.quantity;
  }
  let frozen=0;
  for (const item of Object.values(orders)) {
    if (item.order?.symbol!==symbol || item.order?.side!=='sell' || item.state?.terminal===true) continue;
    const quantity=item.state?.remainingQuantity;
    if (!Number.isSafeInteger(quantity) || quantity<0) reasons.push('FROZEN_SELL_QUANTITY_UNVERIFIED');
    else frozen+=quantity;
  }
  if (frozen+reserved>eligible) reasons.push('FROZEN_SELL_QUANTITY_CONFLICT');
  return {sellableQuantity:reasons.length ? null : eligible-reserved-frozen,
    todayBlockedQuantity:reasons.length ? null : todayBlocked,frozenQuantity:frozen+reserved,
    sellabilityStatus:reasons.length ? 'unknown' : 'observed-lots',sellabilityReasons:[...new Set(reasons)]};
}

function markOf(input, symbol, now) {
  const rows=Array.isArray(input) ? input : input ? [input] : [];
  if (rows.length>1 && new Set(rows.map(q=>journal.digest({price:q?.price,quoteAt:q?.quoteAt,quoteSource:q?.quoteSource || q?.provider || null}))).size>1)
    return {price:null,quote:{quoteStatus:'conflict',quoteAt:null,quoteSource:null,receivedAt:null,missingReason:'conflicting-price-sources'},reason:'QUOTE_SOURCE_CONFLICT'};
  const raw=rows[0];
  const row=raw ? {...raw,quoteSource:raw.quoteSource || raw.provider || null} : null;
  const view=quoteObservationView(row,now);
  const conflict=row?.sourceConflict===true || row?.conflict===true || row?.evidenceStatus==='conflict' ||
    row?.symbol!=null && row.symbol!==symbol || row?.code!=null && row.code!==symbol ||
    row?.provider!=null && row.provider!==row.quoteSource || row?.timestamp!=null && row.timestamp!==row.quoteAt ||
    row?.tradeDate!=null && row.tradeDate!==view.tradeDate;
  const identity=row && (row.symbol || row.code)===symbol;
  const usable=identity && !conflict && view.quoteStatus==='recent-unverified' && view.missingReason===null &&
    view.tradeDate===aShareCalendarDate(now) && quoteSourceAllowsUse(row);
  const reason=conflict ? 'QUOTE_SOURCE_CONFLICT' : !identity ? 'QUOTE_IDENTITY_OR_VALUE_MISSING' :
    view.missingReason ? 'QUOTE_'+view.missingReason.toUpperCase().replace(/-/g,'_') : !usable ? 'QUOTE_OBSERVATION_ONLY' : null;
  return {price:usable ? row.price : null,quote:{...view,observedPrice:finite(row?.price) ? row.price : null,
    ...(conflict ? {quoteStatus:'conflict',missingReason:'conflicting-price-sources'} : {}),canTrade:false,canNotify:false},reason};
}

function buildAccountEquityEvidence({book,accountId,quotes={},now=Date.now()}={}) {
  if (!timeOk(now)) throw Error('权益观察时点无效');
  const {account,accountEpoch}=authorityOf(book,accountId),day=aShareCalendarDate(now),missing=[];
  const positions=[];
  for (const [symbol,p] of Object.entries(account.positions).sort(([a],[b])=>a.localeCompare(b))) {
    if (!/^\d{6}$/.test(symbol) || !Number.isSafeInteger(p.quantity) || p.quantity<0) throw Error('权益持仓数量无效');
    if (!p.quantity) continue;
    const lots=p.lots || [], basisKnown=Array.isArray(lots) && lots.length>0 && lots.every(l=>finite(l.cost) && l.cost>=0);
    const costBasis=basisKnown ? money(lots.reduce((n,l)=>n+l.cost,0)) : null;
    const mark=markOf(quotes instanceof Map ? quotes.get(symbol) : quotes[symbol],symbol,now);
    const availability=positionAvailability(p,symbol,book.orders,day), reasons=[];
    if (mark.reason) reasons.push(mark.reason);
    if (costBasis===null) reasons.push('POSITION_COST_BASIS_MISSING');
    reasons.push(...availability.sellabilityReasons);
    const marketValue=mark.price===null ? null : money(mark.price*p.quantity);
    positions.push({symbol,quantity:p.quantity,costBasis,price:mark.price,marketValue,
      unrealizedPnl:marketValue===null || costBasis===null ? null : money(marketValue-costBasis),
      quote:mark.quote,...availability,evidenceStatus:mark.price===null ? 'unknown' : 'available',reasons});
    for (const reason of reasons) missing.push({symbol,code:reason});
  }
  const ids=new Set(),flowReasons=[];
  let tradeNetCash=0,fillPnl=0,observedFees=0;
  for (const event of account.events) {
    if (!event?.eventId || ids.has(event.eventId)) throw Error('权益证据成交事件重复或无引用');
    ids.add(event.eventId);
    if (!['buy','sell'].includes(event.side) || !finite(event.gross) || event.gross<0 || !finite(event.fee) || event.fee<0 ||
        !dayOk(event.tradeDate) || event.tradeDate>day || event.timestamp!=null && (!timeOk(event.timestamp) || event.timestamp>now)) {
      flowReasons.push('FILL_CASH_EVIDENCE_UNVERIFIED');continue;
    }
    tradeNetCash+=event.side==='buy' ? -(event.gross+event.fee) : event.gross-event.fee;
    observedFees+=event.fee;
    if (event.side==='sell') {
      if (!finite(event.realizedPnl)) flowReasons.push('SETTLED_PNL_UNVERIFIED');
      else fillPnl+=event.realizedPnl;
    }
  }
  let corporateNetCash=0,corporatePnl=0;
  const corporateIds=new Set();
  for (const event of book.corporateEvents || []) {
    if (!event?.eventId || corporateIds.has(event.eventId)) throw Error('权益结算事件重复或无引用');
    corporateIds.add(event.eventId);
    if (!finite(event.cashDelta) || !finite(event.realizedPnl) || !dayOk(event.effectiveDate) || event.effectiveDate>day ||
        !Number.isFinite(Date.parse(event.publishedAt)) || Date.parse(event.publishedAt)>now) {
      flowReasons.push('CORPORATE_CASH_EVIDENCE_UNVERIFIED');continue;
    }
    corporateNetCash+=event.cashDelta;corporatePnl+=event.realizedPnl;
  }
  const expectedCash=money(book.initialCash+tradeNetCash+corporateNetCash);
  if (Math.abs(expectedCash-account.cash)>.011) flowReasons.push('UNRECONCILED_CAPITAL_CHANGE');
  const openingPnl=book.legacy ? (finite(book.legacyOpeningRealized) ? book.legacyOpeningRealized : null) : 0;
  if (openingPnl===null) flowReasons.push('OPENING_SETTLED_PNL_MISSING');
  let openingFees=0,openingFeesComplete=true;
  for (const t of book.legacyOpeningTrades || []) {
    if (!finite(t.fee) || t.fee<0) openingFeesComplete=false;
    else openingFees+=t.fee;
  }
  if ((book.legacy?.tradesDropped || 0)>0) openingFeesComplete=false;
  const cashReconciled=!flowReasons.some(code=>['FILL_CASH_EVIDENCE_UNVERIFIED','CORPORATE_CASH_EVIDENCE_UNVERIFIED','UNRECONCILED_CAPITAL_CHANGE'].includes(code));
  for (const code of new Set(flowReasons)) missing.push({symbol:null,code});
  const priced=positions.filter(p=>p.marketValue!==null), observedMarketValue=money(priced.reduce((n,p)=>n+p.marketValue,0));
  const valuationComplete=cashReconciled && priced.length===positions.length &&
    !positions.some(p=>p.reasons.includes('POSITION_LOT_QUANTITY_UNVERIFIED'));
  const unrealizedComplete=valuationComplete && positions.every(p=>p.unrealizedPnl!==null);
  const quantity=positions.reduce((n,p)=>n+p.quantity,0),pricedQuantity=priced.reduce((n,p)=>n+p.quantity,0);
  const result={schemaVersion:1,protocol:PROTOCOL,accountId,accountEpoch,observedAt:now,day,
    status:valuationComplete ? 'complete' : priced.length ? 'partial' : 'unknown',
    cash:account.cash,equity:valuationComplete ? money(account.cash+observedMarketValue) : null,
    marketValue:valuationComplete ? observedMarketValue : null,observedMarketValue,
    unrealizedPnl:unrealizedComplete ? money(positions.reduce((n,p)=>n+p.unrealizedPnl,0)) : null,
    settledPnl:flowReasons.some(code=>/PNL|CORPORATE|FILL/.test(code)) ? null : money(openingPnl+fillPnl+corporatePnl),
    fees:{observedTotal:money(observedFees+openingFees),total:openingFeesComplete && !flowReasons.includes('FILL_CASH_EVIDENCE_UNVERIFIED') ? money(observedFees+openingFees) : null,
      status:openingFeesComplete && !flowReasons.includes('FILL_CASH_EVIDENCE_UNVERIFIED') ? 'retained-authority-records' : 'incomplete',feePolicyVersion:book.feePolicy?.version || null},
    positions,coverage:{positions:positions.length,pricedPositions:priced.length,quantity,pricedQuantity,
      quantityPct:quantity ? pricedQuantity/quantity*100 : 100,basis:'share-count-not-value-coverage'},
    source:{kind:'authoritative-paper-account',accountRevision:book.revision,snapshotFingerprint:book.fingerprint,
      ledgerFingerprint:account.fingerprint,fillCount:account.events.length,corporateEventCount:corporateIds.size,
      fillHistoryFingerprint:rawHash(account.events),
      fillReferences:account.events.slice(-MAX_EVENT_REFERENCES).map(e=>({eventId:e.eventId,orderId:e.orderId || null,eventFingerprint:rawHash(e)})),
      fillReferenceCoverage:{total:account.events.length,shown:Math.min(MAX_EVENT_REFERENCES,account.events.length),complete:account.events.length<=MAX_EVENT_REFERENCES},
      corporateReferences:[...corporateIds].slice(-MAX_EVENT_REFERENCES),corporateFingerprint:rawHash(book.corporateEvents || []),
      corporateEventReferences:(book.corporateEvents || []).slice(-MAX_EVENT_REFERENCES).map(e=>({eventId:e.eventId,eventFingerprint:rawHash(e)}))},
    cashMovements:{status:cashReconciled ? 'reconciled' : 'unknown',initialCash:book.initialCash,tradeNetCash:money(tradeNetCash),
      corporateNetCash:money(corporateNetCash),expectedCash,externalFlowStatus:'not-exposed-by-authority',
      note:'原账户不提供独立出入金事件；重置或调整初始额开启独立阶段。无法核对的现金变化中断收益与回撤计算。公司分红属于权益收益，不扣成出入金。'},
    missing,authority:'derived-from-original-account',manualHoldingsIncluded:false,researchOnly:true,canTrade:false,canNotify:false,accountMutated:false};
  return {...result,fingerprint:journal.digest(result)};
}

function validateEquityEvidence(value) {
  if (!value || value.protocol!==PROTOCOL || value.schemaVersion!==1 || !idOk(value.accountId) || !hashOk(value.accountEpoch) ||
      !timeOk(value.observedAt) || !dayOk(value.day) || aShareCalendarDate(value.observedAt)!==value.day ||
      value.canTrade!==false || value.canNotify!==false || value.accountMutated!==false || value.manualHoldingsIncluded!==false ||
      !Array.isArray(value.positions) || !value.source || !hashOk(value.source.snapshotFingerprint)) throw Error('权益派生证据结构无效');
  const {fingerprint,...payload}=value;
  if (journal.digest(payload)!==fingerprint) throw Error('权益派生证据指纹损坏');
  return value;
}

function buildEquityHistory({observations=[],accountId,accountEpoch,now=Date.now(),maxGapMs=MAX_GAP_MS,truncated=false}={}) {
  if (!idOk(accountId) || !hashOk(accountEpoch) || !timeOk(now) || !Number.isSafeInteger(maxGapMs) || maxGapMs<MIN_SAMPLE_MS || maxGapMs>3600000 || !Array.isArray(observations))
    throw Error('权益历史查询范围无效');
  const rows=[],seen=new Set();
  for (const original of observations) {
    const row=validateEquityEvidence(original);
    if (row.accountId!==accountId || row.accountEpoch!==accountEpoch) throw Error('禁止混合账户或重置前后权益');
    if (row.observedAt>now) continue;
    if (seen.has(row.fingerprint)) continue;
    seen.add(row.fingerprint);rows.push(row);
  }
  rows.sort((a,b)=>a.observedAt-b.observedAt);
  const gaps=[],points=[];
  let previous=null,index=100,peak=100,maxDrawdown=0,segment=0,completeCount=0,comparisonCount=0;
  for (const row of rows) {
    if (previous && row.observedAt===previous.observedAt) throw Error('同一时点存在冲突权益证据');
    if (previous && row.source.accountRevision<previous.source.accountRevision) throw Error('权益观察的权威账户版本倒序');
    if (previous && row.source.accountRevision===previous.source.accountRevision && row.source.snapshotFingerprint!==previous.source.snapshotFingerprint)
      throw Error('同一权威账户版本存在冲突快照');
    if (previous && row.observedAt-previous.observedAt>maxGapMs) gaps.push({from:previous.observedAt,to:row.observedAt,code:'OBSERVATION_GAP'});
    const complete=row.status==='complete' && finite(row.equity) && row.equity>=0 && row.cashMovements.status==='reconciled';
    if (!complete) {
      gaps.push({from:row.observedAt,to:row.observedAt,code:'VALUATION_OR_CASH_GAP'});
      points.push({at:row.observedAt,equity:null,index:null,drawdownPct:null,segment:null,evidenceId:row.fingerprint});
      previous=row;continue;
    }
    completeCount++;
    let bridge=previous?.status==='complete' && finite(previous.equity) && previous.equity>0 && previous.cashMovements.status==='reconciled';
    if (bridge) {
      const before=previous.source.fillReferences,after=row.source.fillReferences;
      const oldCorporate=previous.source.corporateEventReferences,newCorporate=row.source.corporateEventReferences;
      const compatible=(oldRefs,newRefs,oldCount,newCount)=>{
        if (!Array.isArray(oldRefs) || !Array.isArray(newRefs)) return false;
        const overlap=Math.min(oldRefs.length,Math.max(0,newRefs.length-(newCount-oldCount)));
        if (!overlap && oldCount>0) return false;
        const previousTail=overlap ? oldRefs.slice(-overlap) : [];
        return previousTail.every((ref,i)=>journal.digest(ref)===journal.digest(newRefs[i]));
      };
      if (row.source.fillCount<previous.source.fillCount || row.source.corporateEventCount<previous.source.corporateEventCount ||
          row.source.fillCount===previous.source.fillCount && row.source.fillHistoryFingerprint!==previous.source.fillHistoryFingerprint ||
          row.source.corporateEventCount===previous.source.corporateEventCount && row.source.corporateFingerprint!==previous.source.corporateFingerprint ||
          row.source.fillCount>previous.source.fillCount && !compatible(before,after,previous.source.fillCount,row.source.fillCount) ||
          row.source.corporateEventCount>previous.source.corporateEventCount && !compatible(oldCorporate,newCorporate,previous.source.corporateEventCount,row.source.corporateEventCount)) {
        bridge=false;gaps.push({from:previous.observedAt,to:row.observedAt,code:'AUTHORITY_EVENT_CONTINUITY_UNKNOWN'});
      }
      const cashDifference=row.cash-previous.cash;
      const authorityDifference=row.cashMovements.tradeNetCash-previous.cashMovements.tradeNetCash+
        row.cashMovements.corporateNetCash-previous.cashMovements.corporateNetCash;
      if (Math.abs(cashDifference-authorityDifference)>.021) {
        bridge=false;gaps.push({from:previous.observedAt,to:row.observedAt,code:'UNRECONCILED_CAPITAL_CHANGE'});
      }
    }
    if (!bridge) { segment++;index=100;peak=100; }
    else {index*=row.equity/previous.equity;comparisonCount++;}
    peak=Math.max(peak,index);
    const drawdownPct=bridge ? Math.max(0,(peak-index)/peak*100) : null;
    if (drawdownPct!==null) maxDrawdown=Math.max(maxDrawdown,drawdownPct);
    points.push({at:row.observedAt,equity:row.equity,index,drawdownPct,segment,evidenceId:row.fingerprint});previous=row;
  }
  if (rows.length && now-rows.at(-1).observedAt>maxGapMs) gaps.push({from:rows.at(-1).observedAt,to:now,code:'OBSERVATION_NOT_CURRENT'});
  return {protocol:'fayo-observed-equity-history-v1',accountId,accountEpoch,status:rows.length<2 ? 'insufficient' : gaps.length ? 'gaps' : 'observed',
    sampleCount:rows.length,completeSampleCount:completeCount,from:rows[0]?.observedAt || null,to:rows.at(-1)?.observedAt || null,
    samplingIntervalMs:MIN_SAMPLE_MS,maxObservationGapMs:maxGapMs,truncated,points,gaps,comparisonCount,observedMaxDrawdownPct:comparisonCount ? maxDrawdown : null,
    currentObservedDrawdownPct:points.at(-1)?.drawdownPct ?? null,
    continuousAccountMaxDrawdownPct:null,
    note:'回撤来自真实账户权益观察；最大值仅覆盖已观察时点，未观测区间和采样间极值未知，不使用累计已结算盈亏替代连续账户最大回撤。',
    cashFlowTreatment:'original-fill-and-corporate-cash-reconciliation; reset-separated; unexplained-capital-change-unknown',
    canTrade:false,accountMutated:false};
}

function createAccountEquityEvidenceStore({root,clock=Date.now,canWrite=()=>false}={}) {
  journal.privateRoot(root);
  if (typeof clock!=='function' || typeof canWrite!=='function') throw Error('权益观察存储配置无效');
  const allow=()=>{if (canWrite()!==true) throw Error('权益观察仅原主实例可追加');};
  const scope=(accountId,accountEpoch,create=false)=>{
    if (!idOk(accountId) || !hashOk(accountEpoch)) throw Error('权益观察账户路径无效');
    const base=journal.privateRoot(root,create),account=journal.privateRoot(path.join(base,accountId),create);
    return journal.privateRoot(path.join(account,accountEpoch),create);
  };
  const dayRows=(dir,asOf)=>journal.readEvents(dir,{asOf}).map(event=>{
    if (event.kind!=='diagnostic' || event.data?.asOf!==event.recordedAt) throw Error('权益观察日志类型或时点损坏');
    const row=validateEquityEvidence(event.data.evidence);
    if (row.observedAt!==event.recordedAt || row.day!==path.basename(dir)) throw Error('权益观察日志日期不一致');
    return row;
  });
  function append({evidence}={}) {
    validateEquityEvidence(evidence);const now=clock();
    if (!timeOk(now) || evidence.observedAt>now || now-evidence.observedAt>15000 || now>Date.now()) throw Error('权益观察须保存本次真实时点，禁止补造历史');
    allow();const base=scope(evidence.accountId,evidence.accountEpoch,true);
    return withAccountLock(path.join(base,'equity-writer'),()=>{
      allow();
      const days=fs.readdirSync(base).filter(name=>name!=='equity-writer.guard').sort();
      if (days.some(day=>!dayOk(day))) throw Error('权益观察日期目录损坏');
      const latestDay=days.at(-1);
      if (latestDay && latestDay>evidence.day) throw Error('权益观察日期倒序，禁止重放旧日');
      const dir=journal.privateRoot(path.join(base,evidence.day),true),rows=dayRows(dir,now);
      const previousDay=days.filter(day=>day<evidence.day).at(-1);
      const last=rows.at(-1) || (previousDay ? dayRows(journal.privateRoot(path.join(base,previousDay)),now).at(-1) : null);
      if (rows.some(row=>row.fingerprint===evidence.fingerprint)) return {added:false,reused:true,status:'unchanged',evidenceId:evidence.fingerprint};
      if (last && evidence.observedAt<=last.observedAt) throw Error('权益观察时点倒序或同点冲突');
      if (last && evidence.source.accountRevision<last.source.accountRevision) throw Error('权益观察权威账户版本倒序');
      if (last && evidence.source.accountRevision===last.source.accountRevision && evidence.source.snapshotFingerprint!==last.source.snapshotFingerprint)
        throw Error('同一权威账户版本存在冲突快照');
      // Unchanged account state can be sampled once per minute. A fill or a
      // valuation failure is retained immediately rather than hidden by cooldown.
      if (last && evidence.observedAt-last.observedAt<MIN_SAMPLE_MS && last.source.snapshotFingerprint===evidence.source.snapshotFingerprint && last.status===evidence.status)
        return {added:false,reused:false,status:'sample-interval',evidenceId:last.fingerprint};
      allow();const event=journal.appendEvent(dir,'diagnostic',{asOf:evidence.observedAt,evidence},
        {now:evidence.observedAt,requestId:'equity-'+evidence.fingerprint});
      return {added:!event.reused,reused:event.reused,status:'observed',evidenceId:evidence.fingerprint,recordHash:event.hash};
    });
  }
  function read({accountId,accountEpoch,now=clock(),limit=500}={}) {
    if (!timeOk(now) || now>clock() || now>Date.now() || !Number.isSafeInteger(limit) || limit<1 || limit>MAX_READ) throw Error('权益观察读取范围无效');
    const base=scope(accountId,accountEpoch),rows=[];
    let truncated=false;
    if (fs.existsSync(base)) {
      const names=fs.readdirSync(base).filter(name=>name!=='equity-writer.guard');
      if (names.length>10000 || names.some(name=>!dayOk(name))) throw Error('权益观察日期目录损坏或超过容量');
      const dates=names.filter(day=>day<=aShareCalendarDate(now)).sort().reverse();
      for (let i=0;i<dates.length;i++) {
        const dir=journal.privateRoot(path.join(base,dates[i]));
        rows.unshift(...dayRows(dir,now));
        if (rows.length>=limit) {truncated=rows.length>limit || i<dates.length-1;break;}
      }
    }
    const observations=rows.slice(-limit);
    const history=buildEquityHistory({observations,accountId,accountEpoch,now,truncated});
    return {protocol:PROTOCOL,status:observations.length ? 'observed' : 'missing',accountId,accountEpoch,
      observations:clone(observations),latest:observations.length ? clone(observations.at(-1)) : null,history,truncated,canTrade:false,accountMutated:false};
  }
  return {append,read};
}

module.exports={PROTOCOL,MAX_GAP_MS,MIN_SAMPLE_MS,buildAccountEquityEvidence,buildEquityHistory,createAccountEquityEvidenceStore,
  validateEquityEvidence,positionAvailability};
