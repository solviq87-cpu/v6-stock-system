'use strict';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const own=(row,key)=>row!=null&&Object.prototype.hasOwnProperty.call(row,key);
const record=row=>row!=null&&typeof row==='object'&&!Array.isArray(row);
const BASIS=new Set(['qfq','hfq','unadjusted']);
const DAILY=new Set(['1d','day','daily','日K','101',101]);
const safeClock=v=>Number.isSafeInteger(v)&&v>0&&v<=8e15;
const {assessDailyBarFinality}=require('./a-share-calendar');
function declaredBasis(row){
  const values=['adjust','adjustment','priceBasis'].filter(k=>own(row,k)&&row[k]!=null).map(k=>row[k]);
  if(own(row,'priceAdjustment')&&row.priceAdjustment!=null)
    values.push(record(row.priceAdjustment)?row.priceAdjustment.mode:undefined);
  return values;
}
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

function indexBars(bars, source) {
  if (!Array.isArray(bars)) throw new Error(`${source} K线必须是数组`);
  const indexed = new Map();
  for (const bar of bars) {
    if (!bar || !validDate(bar.date)) throw new Error(`${source} K线日期无效`);
    if (indexed.has(bar.date)) throw new Error(`${source} 存在重复交易日: ${bar.date}`);
    if (![bar.open, bar.high, bar.low, bar.close].every(finite) ||
        [bar.open, bar.high, bar.low, bar.close].some(price => price <= 0) ||
        bar.high < Math.max(bar.open, bar.close, bar.low) ||
        bar.low > Math.min(bar.open, bar.close)) {
      throw new Error(`${source} K线价格关系无效: ${bar.date}`);
    }
    if (!Number.isSafeInteger(bar.volume) || bar.volume < 0) throw new Error(`${source} K线成交量无效: ${bar.date}`);
    for(const flag of ['isST','suspended','tradable']){
      if(own(bar,flag)&&bar[flag]!=null&&typeof bar[flag]!=='boolean')
        throw new Error(`${source} K线风险状态无效: ${bar.date} ${flag}`);
    }
    if(bar.suspended===true&&(bar.volume!==0||bar.tradable===true))
      throw new Error(`${source} K线停牌与成交或可交易状态冲突: ${bar.date}`);
    indexed.set(bar.date, bar);
  }
  return indexed;
}

/**
 * Audits continuity when a historical K-line feed changes provider.
 * expectedDates must come from the exchange trading calendar, never weekdays guessed locally.
 * It deliberately refuses silent provider mixing when price basis diverges.
 */
function auditKlineSourceContinuity({ primaryBars, fallbackBars, expectedDates, primaryName = 'primary', fallbackName = 'fallback', maxCloseDivergencePct = 1 } = {}) {
  if (!Array.isArray(expectedDates) || expectedDates.length === 0 || !expectedDates.every(validDate)) {
    throw new Error('必须提供有效的交易所预期交易日期');
  }
  for (let i = 1; i < expectedDates.length; i++) {
    if (expectedDates[i] <= expectedDates[i - 1]) throw new Error('预期交易日期必须严格递增且无重复');
  }
  if (!finite(maxCloseDivergencePct) || maxCloseDivergencePct < 0 || maxCloseDivergencePct > 20) {
    throw new Error('价格差异阈值无效');
  }
  const primary = indexBars(primaryBars || [], primaryName);
  const fallback = indexBars(fallbackBars || [], fallbackName);
  const supplied=[...primary.values(),...fallback.values()];
  if(primary.size&&fallback.size&&primaryName===fallbackName)
    throw new Error('主备来源标识重复');
  if(!dailyKlineMetadataValid({rows:supplied}))
    throw new Error('跨数据源K线周期或复权口径冲突');
  const declaredCount=supplied.filter(bar=>declaredBasis(bar).length>0).length;
  const knownBasis=declaredCount?supplied.flatMap(declaredBasis)[0]:null;
  const priceBasisEvidence={status:declaredCount===0?'unknown':declaredCount===supplied.length?'declared-consistent':'partial',
    declaredBasis:knownBasis,declaredCount,total:supplied.length,scope:'all-supplied-bars',verified:false};
  const rows = [];
  const gaps = [];
  const sourceSwitches = [];
  let lastSource = null;
  for (const date of expectedDates) {
    const p = primary.get(date);
    const f = fallback.get(date);
    if (!p && !f) { gaps.push(date); continue; }
    if (p && f) {
      const divergence = Math.abs(p.close - f.close) / Math.max(p.close, f.close) * 100;
      if (divergence > maxCloseDivergencePct) {
        throw new Error(`跨数据源收盘价差异超过阈值: ${date} (${divergence.toFixed(4)}%)`);
      }
      for(const flag of ['isST','suspended','tradable']){
        if(typeof p[flag]==='boolean'&&typeof f[flag]==='boolean'&&p[flag]!==f[flag])
          throw new Error(`跨数据源K线风险状态冲突: ${date} ${flag}`);
      }
      if((p.volume===0)!==(f.volume===0))
        throw new Error(`跨数据源K线零成交状态冲突: ${date}`);
    }
    const source = p ? primaryName : fallbackName;
    const bar = p || f;
    if (lastSource && lastSource !== source) sourceSwitches.push({ date, from: lastSource, to: source });
    rows.push({ ...bar, date, source, fallbackUsed: !p });
    lastSource = source;
  }
  const unexpectedDates = [...primary.keys(), ...fallback.keys()].filter(date => !expectedDates.includes(date)).sort();
  return {
    status: gaps.length ? 'incomplete' : 'continuous',
    complete: gaps.length === 0,
    expectedCount: expectedDates.length,
    acceptedCount: rows.length,
    gaps,
    unexpectedDates,
    sourceSwitches,
    priceBasisEvidence,
    bars: rows,
    verifiedLive: false,
    canTrade: false,
    warning: '连续性审计不证明行情源真实或已授权；交易放行仍需独立来源与实时性验证'
  };
}

// Legacy caches may lack explicit metadata; never accept explicitly incompatible metadata.
function dailyKlineMetadataValid(snapshot,{expectedBasis=null,rows=snapshot?.rows}={}){
  if(!record(snapshot)||expectedBasis!=null&&!BASIS.has(expectedBasis)||
     rows!=null&&!Array.isArray(rows))return false;
  const basis=new Set(expectedBasis==null?[]:[expectedBasis]);
  for(const row of [snapshot,...(rows||[])]){
    if(!record(row))return false;
    for(const value of declaredBasis(row)){
      if(!BASIS.has(value))return false;
      basis.add(value);
      if(basis.size>1)return false;
    }
    if(['frequency','period'].some(k=>own(row,k)&&row[k]!=null&&!DAILY.has(row[k])))return false;
  }
  return true;
}
// Provider daily rows can still be displayed intraday. Only the research
// adapters call this gate, so an explicit unfinished original observation
// cannot become a completed sample merely because the cache was refreshed.
function dailyKlineResearchEvidenceValid(snapshot,{rows=snapshot?.rows,observedAt,now=Date.now()}={}){
  if(!record(snapshot)||!Array.isArray(rows)||!rows.length||
     !safeClock(observedAt)||!safeClock(now)||observedAt>now)return false;
  const entries=[[snapshot,rows.at(-1)?.date],...rows.map(row=>[row,row?.date])];
  for(const [row,date] of entries){
    if(!record(row)||!validDate(date))return false;
    if(['complete','finalized'].some(k=>own(row,k)&&row[k]!=null&&row[k]!==true))return false;
    for(const key of ['observedAt','receivedAt']){
      if(!own(row,key)||row[key]==null)continue;
      const stamp=row[key];
      if(!safeClock(stamp)||stamp>observedAt||
         !assessDailyBarFinality(date,{observedAt:stamp,now}).usable)return false;
    }
  }
  return true;
}
function dailyProviderRowsValid(rows,now=Date.now()){
  if(!Array.isArray(rows)||!rows.length||!Number.isFinite(now)||!Number.isFinite(new Date(now+28800000).getTime())||
     !dailyKlineMetadataValid({rows}))return false;
  const today=new Date(now+28800000).toISOString().slice(0,10);
  return rows.every((bar,i)=>bar&&validDate(bar.date)&&bar.date<=today&&(!i||bar.date>rows[i-1].date)&&
    [bar.open,bar.high,bar.low,bar.close].every(x=>finite(x)&&x>0)&&
    bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close)&&finite(bar.volume)&&bar.volume>=0);
}
module.exports = { auditKlineSourceContinuity, validCalendarDate: validDate,dailyKlineMetadataValid,dailyProviderRowsValid,dailyKlineResearchEvidenceValid };
