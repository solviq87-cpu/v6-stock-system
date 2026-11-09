'use strict';
/**
 * Point-in-time daily intake of V6 scanner's independently reported bullish
 * research patterns. This does not attribute them to the original four systems.
 * Historical/replayed snapshots are intentionally ineligible for new capture.
 */
const crypto=require('node:crypto');
const {freezeCohort}=require('./forward-signal-observer');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const validMs=x=>Number.isSafeInteger(x)&&x>0;
const close=d=>Date.parse(d+'T16:00:00+08:00');
const before=d=>Date.parse(d+'T15:00:00+08:00');
const allowedRule=r=>r&&typeof r.id==='string'&&r.id.length<=120&&r.id.startsWith('pattern:')&&
 r.type==='research-pattern'&&r.status==='matched';
function isCaptureWindow(market,now=Date.now()){
 return validMs(now)&&market&&date(market.asOf)&&day(now)===market.asOf&&
  now>=close(market.asOf)&&now<=close(market.asOf)+4*3600000;
}
function captureDailyCohort({scan,market,now=Date.now()}={}){
 if(!isCaptureWindow(market,now))throw Error('只有当日收盘后四小时内可冻结新信号，历史补跑禁止倒填');
 if(!scan||!validMs(scan.asOf)||scan.asOf>now||scan.asOf<before(market.asOf)||
  now-scan.asOf>3*3600000||!Array.isArray(scan.items)||scan.items.length>5000||
  scan.simulated>0||!scan.feed||JSON.stringify(scan.feed)!==JSON.stringify(market.feed)||
  market.feed.source!=='imported'||market.feed.priceBasis!=='unadjusted'||
  !Array.isArray(market.calendar)||!market.calendar.includes(market.asOf)||
  !Array.isArray(market.stocks)||market.stocks.length>500||
  !validMs(market.observedAt)||market.observedAt>now||market.observedAt<close(market.asOf))
  throw Error('缺少同日可核验的扫描时间、行情来源或明确交易日历');
 const byCode=new Map(),duplicated=new Set();
 for(const stock of market.stocks){
  const code=stock?.symbol;
  if(!/^\d{6}$/.test(String(code||'')))continue;
  if(byCode.has(code)){duplicated.add(code);byCode.delete(code);}
  else if(!duplicated.has(code))byCode.set(code,stock);
 }
 const seen=new Set(),signals=[];
 const items=[...scan.items].sort((a,b)=>String(a?.symbol||'').localeCompare(String(b?.symbol||'')));
 for(const item of items){
  const symbol=item?.symbol;
  if(!/^\d{6}$/.test(String(symbol||'')))continue;
  if(seen.has(symbol))throw Error('同一份扫描报告存在重复股票，拒绝冻结');
  seen.add(symbol);
  const stock=byCode.get(symbol),bar=stock?.bars?.at(-1),q=item?.quality;
  if(!stock||!Array.isArray(stock.corporateActions)||!Array.isArray(stock.bars)||
   !bar||bar.date!==market.asOf||!Number.isFinite(bar.close)||bar.close<=0||
   !Number.isSafeInteger(bar.volume)||bar.volume<=0||bar.suspended===true||
   item.blockedBySafety===true||item.patternDate!==market.asOf||
   item.rationale?.selection?.watchEligible!==true||
   q?.usable!==true||q?.fresh!==true||q?.simulated!==false||q?.source!=='imported'||
   !validMs(q.timestamp)||q.timestamp<before(market.asOf)||q.timestamp>scan.asOf+60000||
   day(q.timestamp)!==market.asOf)continue;
  const original=new Set((item.patterns?.matched||[]).filter(x=>x?.side==='bullish'&&
   x.status==='matched'&&typeof x.id==='string').map(x=>'pattern:'+x.id));
  const rules=(item.rationale.selection.rules||[]).filter(allowedRule)
   .filter(rule=>original.has(rule.id));
  for(const rule of [...new Map(rules.map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id))){
   signals.push({signalId:sha({date:market.asOf,symbol,rule:rule.id,feed:market.feed}).slice(0,32),
    symbol,system:'research',cohort:rule.id,provenance:'v6-scanner-bullish-pattern:'+rule.id,
    signalDate:market.asOf,signalAt:now,baselineClose:bar.close});
  }
 }
 if(signals.length>500)throw Error('本日信号超出单批安全上限，不允许截断作为完整结果');
 if(!signals.length)return {cohort:null,signals:0,reason:'当日没有可核验的完整研究规则信号'};
 return {cohort:freezeCohort({schemaVersion:1,feed:market.feed,signals},{now}),
  signals:signals.length,reason:'仅研究规则命中；非原四套策略收益或真实成交'};
}
module.exports={captureDailyCohort,isCaptureWindow};
