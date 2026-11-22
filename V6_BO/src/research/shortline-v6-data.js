'use strict';

const { fetchPublicStockHistory } = require('../core/public-stock-history');
const { attachAuctionObservation } = require('./shortline-auction-observation');
const { fetchReviewLimitPool } = require('../core/public-market-context');
const { aShareCalendarDate, assessDailyBarFinality } = require('../core/a-share-calendar');
const { normalizeDay } = require('../core/limit-reason-evidence');
const { validTradingDate } = require('../strategy/cached-kline-adapter');
const { createHash } = require('node:crypto');

const CN = 8 * 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = n => Number.isSafeInteger(n) && n >= 0;
const timeOK = (n, now) => Number.isSafeInteger(n) && n > 0 && n <= now;
const minute = t => new Date(t + CN).toISOString().slice(0, 16).replace('T', ' ');
const closeOf = day => Date.parse(day + 'T15:00:00+08:00');
const settled = (day, now) => validTradingDate(day) && closeOf(day) + 10 * 60000 <= now;
const rounded = x => Math.round(x * 100) / 100;
const cleanName = s => typeof s === 'string' ? s.trim().slice(0, 80) : '';
const mean = rows => rows.length ? rows.reduce((sum, v) => sum + v, 0) / rows.length : null;
const fullPrice = b => b && [b.open,b.high,b.low,b.close].every(v => finite(v) && v > 0) &&
  b.high >= Math.max(b.open,b.close) && b.low <= Math.min(b.open,b.close) && finite(b.volume) && b.volume >= 0;
const INDEX = [
  ['trend','1.000985',/^中证全指(?:指数)?$/],
  ['sh','1.000001',/^(?:上证指数|上证综指|上证综合指数)$/],
  ['cy','0.399006',/^创业板指(?:数)?$/]
];

function confirmedPool(pool, day) {
  if (!day || pool?.tradeDate !== day || pool.complete !== true || !Array.isArray(pool.records) ||
      pool.records.length !== pool.totalCount) return null;
  const symbols = pool.records.map(r => r?.symbol);
  return symbols.every(s => /^\d{6}$/.test(s)) && new Set(symbols).size === symbols.length ? pool.records : null;
}

function datedQuotes(state, day, now) {
  const stocks = new Map();
  for (const s of state.stocks || []) {
    if (!s || !/^\d{6}$/.test(s.code) || !cleanName(s.quoteSource) || !timeOK(s.receivedAt, now) ||
        !timeOK(s.quoteAt, s.receivedAt) || aShareCalendarDate(s.quoteAt) !== day || s.quoteAt < closeOf(day)) continue;
    if (!stocks.has(s.code) || stocks.get(s.code).quoteAt < s.quoteAt) stocks.set(s.code, s);
  }
  return stocks;
}

// Names and amount/volume mappings come from V6's authenticated-symbol
// unadjusted reader. The human-readable current name is not a model feature.
function stockBars(history, code, day, now) {
  if (history?.stock?.symbol !== code || history.stock.priceBasis !== 'unadjusted' ||
      history.priceBasis !== 'unadjusted' || history.units?.volume !== 'shares' ||
      !history.provider || !timeOK(history.retrievedAt, now) || !Array.isArray(history.stock.bars)) return [];
  const rows = history.stock.bars.filter(b => validTradingDate(b.date) && b.date <= day &&
      timeOK(b.knownAt, history.retrievedAt) && fullPrice(b) && b.knownAt >= closeOf(b.date) &&
      assessDailyBarFinality(b.date,{now:b.knownAt,observedAt:b.knownAt}).usable);
  const out = [], seen = new Set();
  const turns = new Map();
  // V6 retains the authenticated raw Eastmoney payload. f61 (index 10)
  // in that documented mapping is turnover percentage. Tencent's extra
  // array fields can be corporate-action objects and never supply turnover.
  if (history.provider === 'eastmoney' && history.rawEvidence?.encoding === 'base64') {
    try {
      const raw = Buffer.from(history.rawEvidence.data,'base64');
      if (raw.length > 2*1024*1024 || createHash('sha256').update(raw).digest('hex') !== history.rawHash) throw Error();
      const d = JSON.parse(raw.toString('utf8')).data;
      if (d.code !== code || !Array.isArray(d.klines)) throw Error();
      for (const text of d.klines) {
        const cells = String(text).split(',');
        if (cells.length === 11 && /^\d+(?:\.\d+)?$/.test(cells[10]) && Number(cells[10]) <= 100)
          turns.set(cells[0],Number(cells[10]));
      }
    } catch { /* A missing raw turnover field leaves the normalized OHLCV usable. */ }
  }
  for (const b of rows) {
    if (seen.has(b.date)) return [];
    seen.add(b.date);
    out.push({date:b.date, code, name:cleanName(history.stock.name)||code, role:'stock',period:'日K',
      open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
      ...(finite(b.amount) && b.amount >= 0 ? {amount:b.amount} : {}), ...(turns.has(b.date)?{turnover:turns.get(b.date)}:{}),
      availableAt:minute(b.knownAt), knownAt:b.knownAt, source:'V6/'+history.provider,priceBasis:'unadjusted',volumeUnit:'shares'});
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}

function indexState(result, label, day, now) {
  if (!result || !label.test(result.name) || !timeOK(result.receivedAt,now) ||
      !result.src || !Array.isArray(result.rows)) return null;
  // Refuse wrong-identity equity fallbacks, unfinished closes and incomplete MA windows.
  const rows = result.rows.filter(b=>validTradingDate(b.date)&&b.date<=day);
  if (rows.length<20 || rows.at(-1).date!==day || !assessDailyBarFinality(day,{now:result.receivedAt,observedAt:result.receivedAt}).usable ||
      rows.some((b,i)=>!finite(b.close)||b.close<=0||(i&&b.date<=rows[i-1].date))) return null;
  const ma=n=>mean(rows.slice(-n).map(x=>x.close));
  const fast=ma(5),mid=ma(10),slow=ma(20),last=rows.at(-1),prev=rows.at(-2);
  const trend=fast>mid&&mid>slow?'多头':fast<mid&&mid<slow?'空头':'震荡';
  const vols=rows.slice(-6,-1).map(b=>b.volume);
  let volume;
  if (vols.every(v=>finite(v)&&v>0) && finite(last.volume) && last.volume>0) {
    const ratio=last.volume/mean(vols),up=last.close>prev.close;
    if(ratio>=1.2)volume=up?'放量上涨':last.close<prev.close?'放量下跌':undefined;
    if(ratio<=0.8)volume=up?'缩量上涨':last.close<prev.close?'缩量阴跌':undefined;
  }
  const index={trend,close:last.close,change:rounded((last.close/prev.close-1)*100),volume,source:result.src,name:result.name,receivedAt:result.receivedAt};
  if(/^中证全指(?:指数)?$/.test(result.name)){
    // Keep the provider's original receipt time even when selecting a historical close.
    // A later retrieval is evidence for today's replay, never for the earlier decision.
    const start=Math.max(0,rows.length-24);
    index.evidence={name:result.name,source:result.src,receivedAt:result.receivedAt,rows:rows.slice(start).map((r,i)=>{
      const end=start+i+1,bar={date:r.date,close:r.close};
      if([r.open,r.high,r.low].every(x=>finite(x)&&x>0)&&r.high>=Math.max(r.close,r.open)&&r.low<=Math.min(r.close,r.open))
        Object.assign(bar,{open:r.open,high:r.high,low:r.low});
      if(finite(r.volume)&&r.volume>0)bar.volume=r.volume;
      const prior=rows.slice(Math.max(0,end-6),end-1);
      if(prior.length===5&&prior.every(x=>finite(x.volume)&&x.volume>0)&&bar.volume>0)
        bar.volumeRatio=bar.volume/mean(prior.map(x=>x.volume));
      for(const n of [5,10,20]){
        if(end>=n)bar['ma'+n]=mean(rows.slice(end-n,end).map(x=>x.close));
      }
      return bar;
    })};
  }
  return index;
}

function sectorEvidence(state, day, sealed, now) {
  const meta=state.ztReviewPoolMeta;
  const source=meta?.sources?.find(x=>x.source==='cls' && x.providerComplete && x.status==='available' && x.tradeDate===day && timeOK(x.receivedAt,now));
  const tags=new Map(), counts=new Map();
  if(!source||!sealed?.length||!Array.isArray(state.ztReviewPool))return {tags,counts};
  for(const row of state.ztReviewPool){
    if(!row.sources?.includes('cls')||row.heldRecord||row.tradeDate!==day||row.clsObservation?.tradeDate!==day||
        !timeOK(row.clsObservation.receivedAt,now))continue;
    const theme=[...new Set((row.plates||[]).map(p=>cleanName(p?.name)).filter(Boolean))];
    if(theme.length)tags.set(row.code,theme);
  }
  for(const row of sealed)for(const name of tags.get(row.symbol)||[])counts.set(name,(counts.get(name)||0)+1);
  // Theme breadth is the share of sealed names that have at least one
  // same-theme peer. Require theme membership for the entire reference pool.
  const diffusion=sealed.every(r=>tags.has(r.symbol))?rounded(100*sealed.filter(r=>tags.get(r.symbol).some(t=>counts.get(t)>=2)).length/sealed.length):undefined;
  return {tags,counts,diffusion};
}

function themeRank(sealed, tags) {
  if(!sealed?.length)return {groups:[],basis:null,first:null};
  const completeThemes=sealed.every(r=>tags.get(r.symbol)?.length);
  const useIndustry=!completeThemes && sealed.every(r=>cleanName(r.industry));
  if(!completeThemes && !useIndustry)return {groups:[],basis:null,first:null};
  const groups=new Map();
  for(const r of sealed){
    const names=useIndustry?[cleanName(r.industry)]:tags.get(r.symbol);
    for(const name of names){
      if(!groups.has(name))groups.set(name,[]);
      groups.get(name).push(r);
    }
  }
  const ranked=[...groups].map(([name,members])=>{
    const heights=members.map(r=>r.consecutiveLimits);
    const allHeights=heights.every(h=>Number.isSafeInteger(h)&&h>=1&&h<=100);
    const levels=allHeights?[...new Set(heights)].sort((a,b)=>b-a):[];
    const highest=levels[0]||0;
    const ladder=levels.length?levels.map(h=>h+'板 '+members.filter(r=>r.consecutiveLimits===h).length+'只').join(' / '):null;
    const completeLadder=allHeights&&highest>=2?levels.length===highest:null;
    const top=members.filter(r=>r.consecutiveLimits===highest);
    let leader=highest>=2&&top.length===1?top[0]:null;
    if(highest>=2 && top.length>1 && top.every(r=>/^(?:09|10|11|13|14|15)[0-5][0-9][0-5][0-9]$/.test(r.firstSealTime))){
      const byTime=top.slice().sort((a,b)=>a.firstSealTime.localeCompare(b.firstSealTime));
      if(byTime[0].firstSealTime!==byTime[1].firstSealTime)leader=byTime[0];
    }
    const amount=members.every(r=>finite(r.amountCny)&&r.amountCny>=0)?members.reduce((v,r)=>v+r.amountCny,0):null;
    return {name,count:members.length,amount,members,leader,ladder,completeLadder};
  });
  // First select by count. An incomplete turnover tie-break cannot manufacture a winner.
  const hasCompleteTurnover=new Map();
  for(const g of ranked)hasCompleteTurnover.set(g.count,(hasCompleteTurnover.get(g.count)??true)&&g.amount!=null);
  ranked.sort((a,b)=>b.count-a.count || (hasCompleteTurnover.get(a.count)?b.amount-a.amount:0) || a.name.localeCompare(b.name,'zh-CN'));
  const candidates=ranked.filter(t=>t.count===ranked[0].count);
  const first=ranked[0].count>=2 && (candidates.length===1 ||
    candidates.every(t=>t.amount!=null)&&ranked[0].amount>ranked[1].amount)?ranked[0]:null;
  return {groups:ranked,first,basis:useIndustry?'东财行业归类':'财联社题材归属'};
}

function buildSnapshot({code,day,latestClosedDay,history,report,previousPool,previousDay,state,indexResults,now}) {
  const bars=stockBars(history,code,day,now), quotes=datedQuotes(state,day,now), q=quotes.get(code);
  const sealed=confirmedPool(report?.sealed,day), broken=confirmedPool(report?.broken,day);
  const selected=sealed?.find(r=>r.symbol===code), old=confirmedPool(previousPool,previousDay);
  const market={date:day,previousDay,source:'V6 原始行情和收盘证据',availableAt:minute(now),knownAt:now};
  const stock={code,name:cleanName(q?.name||selected?.name||history?.stock?.name)||code,selected:[]};
  const evidence=[], missing=[];
  if(bars.length)evidence.push('未复权日线 '+bars.length+' 根，来源 '+history.provider+'，成交量单位为股');
  else missing.push('带采集时点的未复权日K');
  if(q){
    stock.quoteAt=q.quoteAt;stock.availableAt=minute(q.receivedAt);stock.quoteSource=q.quoteSource;
    if(finite(q.price)&&q.price>0)stock.price=q.price;
    if(finite(q.pct))stock.change=q.pct;
    if(finite(q.turnover)&&q.turnover>=0&&q.turnover<=100)stock.turnover=q.turnover;
    if(finite(q.amount)&&q.amount>=0)stock.amount=q.amount;
    if(cleanName(q.sector))stock.sector=cleanName(q.sector);
    evidence.push('个股收盘行情 '+q.quoteSource+' '+minute(q.quoteAt));
  }
  const today=bars.find(b=>b.date===day);
  if(today){
    stock.price??=today.close;
    if(finite(today.turnover))stock.turnover??=today.turnover;
    if(finite(today.amount))stock.amount??=today.amount;
  }
  if(report?.day===day){
    if(sealed){ market.upLimit=sealed.length;
      if(sealed.length && sealed.every(x=>Number.isSafeInteger(x.consecutiveLimits)&&x.consecutiveLimits>0))
        market.height=Math.max(...sealed.map(x=>x.consecutiveLimits));
    }
    if(count(report.down))market.downLimit=report.down;
    if(sealed&&broken){
      const codes=new Set(sealed.map(r=>r.symbol)),n=sealed.length+broken.length;
      if(n && !broken.some(r=>codes.has(r.symbol))) market.breakRate=rounded(100*broken.length/n);
    }
    if(finite(report.marketTurnover)&&report.marketTurnover>0){
      market.amount=report.marketTurnover/1e8;
      market.fieldSources={amount:{source:'V6 沪深两市收盘成交额',scope:'沪深两市成交额',knownAt:now}};
    }
    if(sealed)evidence.push('同日完整封板池 '+sealed.length+' 家'+(broken?'，炸板池 '+broken.length+' 家':''));
  }
  const b=Object.values(state.breadth||{}).find(x=>normalizeDay(x?.day)===day && timeOK(x.at,now) &&
    aShareCalendarDate(x.at)===day && x.at>=closeOf(day) && count(x.n)&&count(x.up)&&count(x.down)&&x.up+x.down<=x.n);
  if(b){
    if(b.complete===true&&cleanName(b.source)&&b.sourceDay===day){market.adv=b.up;market.dec=b.down;}
    market.localBreadth={kind:'breadth',scope:b.scope||'V6 报价样本',source:b.source||'V6 收盘观察',day,knownAt:b.at,observed:b.n,
      adv:b.up,dec:b.down,complete:b.complete===true&&b.sourceDay===day};
    evidence.push('V6 同日收盘宽度 '+b.n+' 只，原时点 '+minute(b.at));
  }
  for(const [i,[key,,name]] of INDEX.entries()){
    const v=indexState(indexResults[i],name,day,now);
    if(!v)continue;
    market[key]=v.trend;
    const prefix=key==='trend'?'allA':key;
    market[prefix+'Close']=v.close;market[prefix+'Change']=v.change;
    market.fieldSources||={};
    for(const field of [key,prefix+'Close',prefix+'Change',...(key==='trend'?['indexChange',...(v.volume?['volume']:[])]:[])])market.fieldSources[field]={source:v.source,knownAt:v.receivedAt};
    if(key==='trend'){market.indexChange=v.change;market.indexEvidence=v.evidence;if(v.volume)market.volume=v.volume;}
    evidence.push(v.name+' '+v.trend+'，MA5/10/20 排列；来源 '+v.source);
  }
  if(old?.length && old.every(r=>Number.isSafeInteger(r.consecutiveLimits) && r.consecutiveLimits>=1)){
    const height=Math.max(...old.map(r=>r.consecutiveLimits)),leaders=old.filter(r=>r.consecutiveLimits===height);
    const change=r=>quotes.get(r.symbol)?.pct;
    if(height>=2 && leaders.every(r=>finite(change(r)))){
      market.leader=rounded(mean(leaders.map(change)));evidence.push('昨日最高 '+height+' 板全部 '+leaders.length+' 只，按今日收盘涨幅等权');
    }
    if(old.every(r=>finite(change(r))))market.premium=rounded(mean(old.map(change)));
    const firstBoards=old.filter(r=>r.consecutiveLimits===1);
    if(firstBoards.length&&firstBoards.every(r=>finite(change(r))))market.firstBoardPremium=rounded(mean(firstBoards.map(change)));
  }
  const {tags,counts,diffusion}=sectorEvidence(state,day,sealed,now);
  if(finite(diffusion)){market.diffusion=diffusion;evidence.push('题材扩散度为完整封板池中具有同题材助攻的标的占比');}
  if(selected){
    if(cleanName(selected.industry))stock.industry=cleanName(selected.industry);
    for(const k of ['consecutiveLimits','breakCount','sealedFundsCny'])if(finite(selected[k]))stock[k]=selected[k];
    if(selected.firstSealTime)stock.firstSealTime=selected.firstSealTime;
    if(stock.consecutiveLimits>=2 && stock.consecutiveLimits===market.height)stock.selected.push('42:0','1:5');
    if(finite(selected.turnoverPct) && selected.turnoverPct>=0 && selected.turnoverPct<=100)stock.turnover??=selected.turnoverPct;
  }
  if(tags.has(code)){
    stock.themes=tags.get(code);stock.theme=stock.themes.slice().sort((a,b)=>(counts.get(b)||0)-(counts.get(a)||0))[0];
    stock.sectorAssists=Math.max(0,(counts.get(stock.theme)||0)-1);
    if(stock.sectorAssists>=2)stock.selected.push('42:1','1:1');
  }
  const ranked=themeRank(sealed,tags);
  if(ranked.groups.length){
    market.themes=ranked.groups.map(g=>({name:g.name,type:g===ranked.first?'主线':'观察题材',
      leader:g.leader?.name||g.leader?.symbol||null,ladder:g.ladder,ladderComplete:g.completeLadder,
      count:g.count,assists:g.leader?g.count-1:null,amountCny:g.amount,classification:ranked.basis,
      members:g.members.map(r=>({code:r.symbol,name:r.name||r.symbol,level:r.consecutiveLimits??null,firstSealTime:r.firstSealTime||null,sealedFundsCny:r.sealedFundsCny??null,amountCny:r.amountCny??null,change:quotes.get(r.symbol)?.pct??null}))}));
    if(ranked.first){
      const g=ranked.first;
      market.theme=g.name;market.themeType='主线';market.tier=g.ladder;
      if(g.leader){
        market.themeLeader=g.leader.name||g.leader.symbol;
        market.assistCount=g.count-1;
        market.assists=g.members.filter(r=>r.symbol!==g.leader.symbol).map(r=>r.name||r.symbol).join('、');
      }
    }
    const candidateGroup=ranked.groups.find(g=>g.members.some(r=>r.symbol===code)) ||
      (ranked.basis==='东财行业归类'&&ranked.groups.find(g=>g.name===stock.sector));
    if(candidateGroup){
      const member=candidateGroup.members.some(r=>r.symbol===code);
      stock.sector=candidateGroup.name;stock.theme=candidateGroup.name;stock.themeBasis=ranked.basis;
      stock.sectorAssists=candidateGroup.count-(member?1:0);
      stock.mainline=ranked.first?candidateGroup===ranked.first:null;
      stock.ladder=candidateGroup.ladder;stock.ladderComplete=candidateGroup.completeLadder;
      stock.sectorLeader=candidateGroup.leader?.name||candidateGroup.leader?.symbol||null;
      if(stock.mainline)stock.selected.push('1:0','33:0','45:3');
      if(candidateGroup.completeLadder)stock.selected.push('17:3','23:0');
      if(stock.sectorAssists>=2)stock.selected.push('42:1','1:1','19:1');
    }
    evidence.push(ranked.basis+'覆盖完整东财封板池，按去重涨停数排序，同数比较全组已知成交额；主线至少两只封板，证据平局留空');
    evidence.push('题材龙头按二板以上最高连板，同板比较可核对的最早封板时刻；梯队按首板至最高板逐级核对');
  }
  if(selected?.sealedFundsCny>0 && selected.amountCny>0){
    stock.sealRatio=rounded(100*selected.sealedFundsCny/selected.amountCny);
    stock.amount??=selected.amountCny;
    if(stock.sealRatio>=3)stock.selected.push('1:4');
  }
  if(selected?.price>0 && (!today||today.close===selected.price))stock.limitUp=selected.price;
  stock.selected=[...new Set(stock.selected)];
  if(finite(stock.turnover) && stock.turnover>=2 && stock.turnover<=20)stock.selected.push('6:2','42:2','17:2');
  if(stock.selected.length)evidence.push('收盘因子据同日换手、梯队和题材成员确认 '+stock.selected.length+' 项；健康换手区间 2%–20%');
  for(const [key,name] of [['upLimit','涨停家数'],['downLimit','跌停家数'],['breakRate','炸板率'],['height','连板高度'],['leader','高标反馈'],['diffusion','题材扩散度'],['trend','全A基准趋势'],['sh','上证趋势'],['cy','创业板趋势']]){
    if(market[key]===undefined)missing.push(name);
  }
  const latestClosed=day===latestClosedDay && settled(day,now) && !!(today || q || selected);
  if(!latestClosed)missing.push('最新交易日同标的收盘确认');
  if(!stock.themes?.length)missing.push('同日核验的题材归属');
  const {date,source,availableAt,knownAt,previousDay:calendarPrevious,...observations}=market;
  return {code,name:stock.name,day,latestClosedDay,latestClosed,observedAt:minute(now),observedAtMs:now,bars,
    market:Object.keys(observations).length?[market]:[],stock,evidence,missing,researchOnly:true,canTrade:false};
}

function createShortlineV6Reader({getState,readCloseReviewEvidence,fetchHistory=fetchPublicStockHistory,
    fetchPreviousPool=fetchReviewLimitPool,fetchIndexKline,fetchAuctionTicks,previousTradeDay,getLatestClosedDay,quoteFallback,marketBackfill,breadthFallback,recoveredRows,clock=Date.now}={}) {
  if(typeof getState!=='function')throw Error('V6 研究接口需要读取现有行情状态');
  const cache=new Map();
  // Reuse the original result with its receipt time. Requests share the V6
  // supplier governor. The cache holds bounded promises, including in-flight reads.
  async function once(key,load){
    const now=clock(), old=cache.get(key);
    if(old && (old.pending || now-old.time<300000))return old.task;
    for(const [k,v] of cache)if(!v.pending && (now-v.time>=300000 || cache.size>=24))cache.delete(k);
    if(cache.size>=24)return null;
    const item={time:now,pending:true,task:null};
    item.task=Promise.resolve().then(load).then(value=>({value,received:clock()})).catch(()=>null).finally(()=>{item.pending=false;});
    cache.set(key,item);return item.task;
  }
  async function baseline(day,previous){
    const [review,prior,...indexResults]=await Promise.all([
      typeof readCloseReviewEvidence==='function'?once('review/'+day,()=>readCloseReviewEvidence(day,previous,{seatsReady:false})):null,
      previous?once('prev/'+previous,()=>fetchPreviousPool(previous,'sealed')):null,
      ...INDEX.map(async ([,id,label])=>{
        const cached=typeof fetchIndexKline==='function'?await once('index/'+id+'/'+aShareCalendarDate(clock()),()=>fetchIndexKline(id,120)):null;
        if(indexState(cached?.value,label,day,clock())||!quoteFallback)return cached?.value;
        const alternate=await once('verified-index/'+id+'/'+day,()=>quoteFallback.readIndex({secid:id,day,count:120,name:({'1.000985':'中证全指','1.000001':'上证指数','0.399006':'创业板指'})[id]}));
        return alternate?.value;
      })
    ]);
    return {report:review?.value?.day===day?review.value:null,previousPool:prior?.value,previousDay:previous,indexResults};
  }
  async function readMarket(day){
    const previous=normalizeDay(await previousTradeDay?.(day)),state=getState()||{};
    const inputs=await baseline(day,previous);
    const base=buildSnapshot({code:'',day,latestClosedDay:day,history:null,state,...inputs,now:clock()}).market.find(r=>r.date===day);
    const parts=await Promise.allSettled([
      marketBackfill?marketBackfill({day,review:inputs.report,previousPool:inputs.previousPool,clsPool:state.ztReviewPool}):null,
      breadthFallback?breadthFallback({day,latestClosedDay:day,state,needBreadth:base?.adv==null||base?.dec==null,needAmount:base?.amount==null}):null
    ]);
    const sentiment=parts[0].value,width=parts[1].value,now=clock();
    const byDate=new Map();
    for(const row of sentiment?.rows||[])if(row.date<=day)byDate.set(row.date,{...row});
    const daily=byDate.get(day)||{};
    const valid=Object.fromEntries(Object.entries(width?.market||{}).filter(([,v])=>v!=null));
    const stamp=Math.max(base?.knownAt||0,daily.knownAt||0,width?.knownAt||0);
    if(stamp>0&&stamp<=now){
      // The multi-session reader validates the population used for each ratio.
      // Keep its value and method together when a native scalar is also available.
      const fieldSources={...base?.fieldSources,...width?.fieldSources,...daily.fieldSources};
      byDate.set(day,{...base,...valid,...daily,date:day,previousDay:previous,source:'V6 多源收盘观测',knownAt:stamp,availableAt:minute(stamp),fieldSources});
    }
    const sources=[...(sentiment?.sources||[]),...(width?.sources||[])];
    if(base)sources.push({name:base.source,status:'available'});
    for(const dayRow of sentiment?.rows||[])for(const item of Object.values(dayRow.fieldSources||{})){
      for(const origin of item.sources||[])if(origin.source)sources.push({name:origin.source,status:'available'});
    }
    for(const item of inputs.indexResults)if(item?.src)sources.push({name:item.src,status:'available'});
    if(!sentiment?.rows?.length&&marketBackfill)sources.push({name:'涨跌停与历史反馈',status:'retrying'});
    if(!Object.keys(valid).length&&!(width?.coverage||[]).some(x=>x.day===day&&(finite(x.adv)||finite(x.amountCny)))&&!base?.adv&&breadthFallback)sources.push({name:'市场宽度与成交额',status:'retrying'});
    return {rows:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),sources:[...new Map(sources.map(s=>[s.name,s])).values()],
      coverage:[...(width?.coverage||[]),...(base?.localBreadth?[base.localBreadth]:[])]};
  }
  async function read({code,day,previousDay}={}){
    if(typeof code!=='string'||!/^(?:60|68|00|30|43|83|87|88|92)\d{4}$/.test(code))throw Error('需要有效的六位 A 股代码');
    const start=clock(),state=getState()||{};
    const calendarDay=normalizeDay(await getLatestClosedDay?.());
    const latestClosedDay=settled(calendarDay,start)?calendarDay:null;
    if(day!==undefined&&(!validTradingDate(day)||!settled(day,start)))throw Error('请选择已经收盘的交易日期');
    const h=await once('stock/'+code+'/'+aShareCalendarDate(start),()=>fetchHistory({symbol:code,historyDays:120,provider:'auto'}));
    const history=h?.value;
    const witnessed=normalizeDay(state.ztPoolSourceStatus?.sourceTradeDate);
    const recentBar=history?.stock?.bars?.at(-1)?.date;
    const inferredDay=[latestClosedDay,settled(witnessed,start)?witnessed:null,settled(recentBar,start)?recentBar:null].filter(Boolean).sort().at(-1);
    const requestedDay=day||latestClosedDay||inferredDay;
    if(!requestedDay)return {code,name:code,day:null,latestClosed:false,latestClosedDay,observedAt:minute(clock()),
      observedAtMs:clock(),bars:[],market:[],stock:{code,name:code,selected:[]},missing:['可信交易日','未复权日K'],evidence:[],researchOnly:true,canTrade:false};
    const p=normalizeDay(await previousTradeDay?.(requestedDay));
    if(previousDay!==undefined && (!validTradingDate(previousDay)||previousDay>=requestedDay || (p&&previousDay!==p)))throw Error('前交易日与交易日历不符');
    // Caller-supplied arbitrary historical dates cannot label a prior high-board cohort.
    const prev=validTradingDate(p)&&p<requestedDay?p:null;
    const inputs=await baseline(requestedDay,prev);
    const now=clock();
    const snapshot=buildSnapshot({code,day:requestedDay,latestClosedDay,history,...inputs,state:getState()||state,now});
    let recovered=await recoveredRows?.(requestedDay)||[];
    if(!recovered.length&&requestedDay!==latestClosedDay&&(marketBackfill||breadthFallback)){
      const historyMarket=await once('review-market/'+requestedDay,()=>readMarket(requestedDay));
      recovered=historyMarket?.value?.rows||[];
    }
    if(recovered.length){
      const dayRow=recovered.find(r=>r.date===requestedDay);
      if(dayRow){
        const native=snapshot.market[0]||{},at=Math.max(dayRow.knownAt,native.knownAt||0);
        snapshot.market=[{...native,...dayRow,date:requestedDay,knownAt:at,availableAt:minute(at),
          fieldSources:{...native.fieldSources,...dayRow.fieldSources}}];
      }
      snapshot.market=[...recovered.filter(r=>r.date<requestedDay),...snapshot.market];
    }
    // The cache is keyed by the exact symbol requested by V6's native auction reader.
    const auctionCache=(getState()||state).auctionTicks?.[code];
    let ticks=auctionCache?.ok===true && normalizeDay(auctionCache.date)===requestedDay?auctionCache.data:null;
    if(!ticks && snapshot.latestClosed && typeof fetchAuctionTicks==='function'){
      ticks=(await once('auction/'+code+'/'+requestedDay,()=>fetchAuctionTicks(code,requestedDay)))?.value;
    }
    if(!attachAuctionObservation(snapshot,ticks,clock()))snapshot.missing.push('可核实的09:25竞价价格与昨收');
    snapshot.missing.push('逐笔主动买卖、竞价成交额与竞价量比');
    const sectorName=snapshot.stock.sector;
    if(quoteFallback){
      const secid=(/^(60|68)/.test(code)?'1.':'0.')+code,reference=snapshot.bars.find(b=>b.date===requestedDay);
      const result=await once('minutes/'+code+'/'+requestedDay,()=>quoteFallback.readIntraday({secid,day:requestedDay,name:snapshot.name,reference}));
      if(result?.value?.bars?.length){
        snapshot.bars.push(...result.value.bars.map(b=>({...b,...(sectorName?{sector:sectorName}:{})})));
        snapshot.evidence.push('同日分时 '+result.value.period+' · '+result.value.src+' · '+result.value.bars.length+' 根');
      }else snapshot.missing.push('同日可核实的个股分钟K线');
    }
    if(sectorName && (typeof fetchIndexKline==='function'||breadthFallback||quoteFallback)){
      // S.sectors provides a code-to-name mapping only. Its un-timestamped
      // current change cannot be assigned to an arbitrary historical date.
      const board=(state.sectors||[]).find(r=>r.name===sectorName && /^BK[0-9]{4}$/.test(r.code));
      if(board){
        let result=typeof fetchIndexKline==='function'?(await once('sector/'+board.code+'/'+aShareCalendarDate(start),()=>fetchIndexKline('90.'+board.code,120)))?.value:null;
        if((result?.name!==board.name||result?.rows?.at(-1)?.date!==requestedDay)&&quoteFallback){
          result=(await once('verified-sector/'+board.code+'/'+requestedDay,()=>quoteFallback.readIndex({secid:'90.'+board.code,day:requestedDay,count:120,name:board.name})))?.value;
        }
        if(quoteFallback){
          const intraday=await once('minutes/'+board.code+'/'+requestedDay,()=>quoteFallback.readIntraday({secid:'90.'+board.code,day:requestedDay,name:board.name}));
          if(intraday?.value?.bars?.length){
            snapshot.bars.push(...intraday.value.bars);
            snapshot.evidence.push(board.name+' '+intraday.value.period+' · '+intraday.value.src+' · '+intraday.value.bars.length+' 根');
          }
        }
        const rows=result?.rows?.filter(b=>validTradingDate(b.date)&&b.date<=requestedDay);
        if(result?.name===board.name && timeOK(result.receivedAt,clock()) && rows?.length>=2 && rows.at(-1).date===requestedDay &&
           rows.at(-2).date<requestedDay && [rows.at(-1).close,rows.at(-2).close].every(v=>finite(v)&&v>0) &&
           assessDailyBarFinality(requestedDay,{now:result.receivedAt,observedAt:result.receivedAt}).usable){
          const change=rounded(100*(rows.at(-1).close/rows.at(-2).close-1));
          snapshot.stock.sectorChange=change;snapshot.stock.strongSector=change>0;
          const m=snapshot.market.find(r=>r.date===requestedDay);
          const group=m?.themes?.find(t=>t.name===sectorName);
          if(group){group.change=change;group.changeSource=result.src;group.changeKnownAt=result.receivedAt;}
          if(m?.indexChange>0&&change>0)snapshot.stock.resonance='题材指数共振';
          if(m?.indexChange<0&&change>0)snapshot.stock.resonance='题材独立背离';
          if(m && m.theme===sectorName && snapshot.stock.resonance)m.resonance=snapshot.stock.resonance;
          snapshot.evidence.push(sectorName+' '+board.code+' 同日板块指数收盘涨跌 '+change+'%，来源 '+(result.src||'V6'));
          snapshot.observedAtMs=clock();snapshot.observedAt=minute(snapshot.observedAtMs);
          if(m){m.knownAt=snapshot.observedAtMs;m.availableAt=snapshot.observedAt;}
        }
      }
    }
    if(sectorName && !finite(snapshot.stock.sectorChange) && breadthFallback){
      const board=(state.sectors||[]).find(r=>r.name===sectorName && /^BK[0-9]{4}$/.test(r.code));
      const alternate=await once('breadth-sector/'+sectorName+'/'+requestedDay,()=>breadthFallback({day:requestedDay,latestClosedDay,state,
        sectorCode:board?.code,sectorName,needBreadth:false,needAmount:false}));
      const sector=alternate?.value?.sector;
      if(sector?.date===requestedDay&&sector.name===sectorName&&finite(sector.change)&&timeOK(sector.knownAt,clock())){
        snapshot.stock.sectorChange=sector.change;snapshot.stock.strongSector=sector.change>0;
        snapshot.evidence.push(sector.name+' 同日板块涨跌 '+sector.change+'% · '+sector.source);
      }
    }
    if(snapshot.latestClosed&&process.env.V6_OPTIONAL_RESEARCH_FILE){
      const feed=require('../core/optional-research-view').optionalResearchView(process.env.V6_OPTIONAL_RESEARCH_FILE,snapshot.observedAtMs);
      if(feed.code===code&&feed.status==='research-only'){
        snapshot.stock.announcements=feed.announcements.filter(row=>row.codes.includes(code)).map(row=>({
          code,title:row.title,url:row.url,source:row.source,publishedAt:row.publishedAt,
          knownAt:new Date(feed.observedAt).toISOString(),verified:row.verified
        }));
      }
    }
    const observedMarket=snapshot.market.find(r=>r.date===requestedDay);
    const labels={upLimit:'涨停家数',downLimit:'跌停家数',breakRate:'炸板率',height:'连板高度',leader:'高标反馈',diffusion:'题材扩散度',trend:'全A基准趋势',sh:'上证趋势',cy:'创业板趋势'};
    const recoveredLabels=new Set(Object.entries(labels).filter(([k])=>observedMarket?.[k]!=null).map(([,v])=>v));
    snapshot.missing=snapshot.missing.filter(v=>!recoveredLabels.has(v));
    snapshot.observedAtMs=clock();snapshot.observedAt=minute(snapshot.observedAtMs);
    // Raw evidence hashes identify the captured stock history without saving supplier bytes.
    if(history?.rawHash)snapshot.historyHash=history.rawHash;
    return snapshot;
  }
  read.readMarket=readMarket;
  return read;
}

function membershipKey(theme) {
  if(!Array.isArray(theme.members)||!theme.members.length||!theme.classification||!theme.name)return null;
  const codes=theme.members.map(m=>m?.code);
  if(codes.some(c=>typeof c!=='string'||!/^\d{6}$/.test(c))||new Set(codes).size!==codes.length)return null;
  return JSON.stringify([theme.classification,theme.name,codes.sort()]);
}

function combineDayEvidence(old,fresh) {
  const row={...fresh};
  if(old.indexEvidence&&fresh.indexEvidence){
    const comparable=index=>JSON.stringify(index,(key,value)=>key==='receivedAt'?undefined:value);
    if(comparable(old.indexEvidence)===comparable(fresh.indexEvidence))row.indexEvidence=old.indexEvidence;
  }
  if(!Array.isArray(old.themes)||!Array.isArray(fresh.themes))return row;
  const previous=new Map();
  for(const theme of old.themes){
    const key=membershipKey(theme);
    if(key)previous.set(key,previous.has(key)?null:theme);
  }
  row.themes=fresh.themes.map(theme=>{
    if(Object.hasOwn(theme,'change'))return theme;
    const prior=previous.get(membershipKey(theme));
    if(!prior||!finite(prior.change))return theme;
    const merged={...theme,change:prior.change};
    for(const field of ['changeSource','changeKnownAt','changeAvailableAt']){
      if(Object.hasOwn(prior,field))merged[field]=prior[field];
    }
    return merged;
  });
  return row;
}

function applyShortlineV6Source(state,snapshot) {
  const bars=state.bars||[], lookup=new Map(bars.map(b=>[[b.role||'stock',b.code,b.period||'日K',b.date].join('/'),b]));
  const pending=[],conflicts=[];
  for(const b of snapshot.bars){
    const key=[b.role,b.code,b.period,b.date].join('/'),old=lookup.get(key);
    if(!old){lookup.set(key,b);pending.push(b);continue;}
    // Provider revisions and manual imports remain explicit conflicts. They
    // must never silently replace the original price used in historical checks.
    if(['open','high','low','close','volume','amount','turnover'].some(k=>old[k]!=null && b[k]!=null && old[k]!==b[k]))conflicts.push(key);
  }
  if(bars.length+pending.length>50000)throw Error('K 线研究库已达 50,000 根上限');
  const market=[...(state.market||[])],history=[...(state.marketHistory||[])];
  let daysAdded=0,daysRevised=0;
  for(const incoming of snapshot.market){
    const idx=market.findIndex(d=>d.date===incoming.date);
    if(idx<0){market.push(incoming);daysAdded++;continue;}
    const old=market[idx];
    const prevKnown=old.knownAt??Date.parse((old.availableAt||old.date+' 15:00').replace(' ','T')+':00+08:00');
    if(finite(prevKnown)&&prevKnown>incoming.knownAt)continue;
    const fresh=combineDayEvidence(old,incoming);
    const keys=Object.keys(fresh).filter(k=>!['date','source','availableAt','knownAt','fieldSources','missing'].includes(k));
    const sourceIdentity=row=>JSON.stringify(Object.fromEntries(Object.entries(row.fieldSources||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,typeof v==='string'?v:v?.source||v?.sources?.map(t=>t.source).join('/')||''])));
    const sourceChanged=fresh.fieldSources&&sourceIdentity({...old,fieldSources:{...old.fieldSources,...fresh.fieldSources}})!==sourceIdentity(old);
    if(!sourceChanged&&!keys.some(k=>fresh[k]!=null && JSON.stringify(fresh[k])!==JSON.stringify(old[k])))continue;
    const next={...old,...fresh};
    if(fresh.fieldSources)next.fieldSources={...old.fieldSources,...fresh.fieldSources};
    // A fresh complete theme ranking can invalidate yesterday's attribution
    // on the same session (including an unresolved tie). Keep it atomic.
    if(Array.isArray(fresh.themes)){
      for(const field of ['theme','themeType','themeLeader','assistCount','assists','tier','resonance'])
        if(!Object.hasOwn(fresh,field))delete next[field];
    }
    history.push(old);market[idx]=next;daysRevised++;
  }
  state.bars=bars.concat(pending);
  state.market=market.sort((a,b)=>a.date.localeCompare(b.date));state.marketHistory=history;
  const {bars:ignoredBars,market:ignoredMarket,...summary}=snapshot;
  if(conflicts.length)summary.missing=[...summary.missing,'重复行情存在原值冲突 '+conflicts.length+' 条，研究库保留早先冻结值'];
  const latest=state.v6Observation;
  if(snapshot.latestClosed && (!latest || latest.day<snapshot.day || latest.day===snapshot.day && (latest.observedAtMs||0)<=snapshot.observedAtMs))
    state.v6Observation=summary;
  return {...summary,barsAdded:pending.length,barsCount:ignoredBars.length,daysAdded,daysRevised,conflicts};
}

module.exports={createShortlineV6Reader,applyShortlineV6Source};
