'use strict';
/**
 * At-the-time, offline bridge from the EXISTING scored-stock factor evidence to
 * a frozen factor feature episode. It never computes hypothetical factors from
 * price, fills missing scores or edits formal strategy weights.
 */
const pack=require('../../strategies/extended-factor-pack.json');
const {freezeCurrentPicks}=require('./quant-picks-eod-freeze');
const {freezeFeatureEpisode}=require('./factor-shadow-evolution');

const DAY=86400000;
const chinaDay=time=>new Date(time+8*3600000).toISOString().slice(0,10);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
const code=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const isTimestamp=x=>Number.isSafeInteger(x)&&x>0;

function validateFactorFeed(snapshot,cohort,now){
 if(!snapshot||snapshot.schemaVersion!==1||
    snapshot.feed?.source!=='imported'||!text(snapshot.feed.provider)||
    !text(snapshot.feed.datasetId)||!isTimestamp(snapshot.asOf)||
    snapshot.asOf>now||!Array.isArray(snapshot.rows)||
    snapshot.rows.length<1||snapshot.rows.length>500)
  throw Error('因子来源快照必须为明示授权导入的逐票历史时点证据');
 const first=cohort.signals[0].signalAt,day=chinaDay(first);
 if(chinaDay(snapshot.asOf)!==day||snapshot.asOf>first||
    first-snapshot.asOf>DAY||
    !cohort.signals.every(s=>chinaDay(s.signalAt)===day&&s.signalAt>=snapshot.asOf))
  throw Error('因子快照必须早于同日冻结信号，禁止事后回填');
 const bySymbol=new Map();
 for(const row of snapshot.rows){
  const symbol=String(row?.code??row?.symbol??'');
  if(!code(symbol)||bySymbol.has(symbol)||!row.factorEvidence||
     !row.feed||row.feed.source!==snapshot.feed.provider||
     row.feed.simulated===true||row.feed.mode==='simulation'||
     !isTimestamp(row.feed.timestamp)||row.feed.timestamp>snapshot.asOf||
     chinaDay(row.feed.timestamp)!==day)
   throw Error('逐票因子行情来源/代码/时点缺失或重复');
  bySymbol.set(symbol,row);
 }
 for(const signal of cohort.signals){
  if(!bySymbol.has(signal.symbol))throw Error('冻结候选没有对应的逐票因子来源快照');
 }
 return bySymbol;
}
function factorProofValid(row,f,cohortSignal,snapshot){
 const score=row[f.field],e=row.factorEvidence[f.field];
 if(!finite(score)||score<0||score>100||
    !e||e.source!==snapshot.feed.provider||e.simulated===true||
    e.mode==='simulation'||!isTimestamp(e.timestamp)||
    e.timestamp>snapshot.asOf||e.timestamp>cohortSignal.signalAt||
    cohortSignal.signalAt-e.timestamp>DAY||
    chinaDay(e.timestamp)!==cohortSignal.signalDate||
    e.code!==undefined&&String(e.code)!==cohortSignal.symbol||
    e.symbol!==undefined&&String(e.symbol)!==cohortSignal.symbol)
  return false;
 return true;
}
function chooseFactorIds(snapshot,cohort,stocks){
 const firstBySymbol=new Map();
 for(const signal of cohort.signals)if(!firstBySymbol.has(signal.symbol))
  firstBySymbol.set(signal.symbol,signal);
 const available=pack.factors.filter(f=>
  [...firstBySymbol.values()].every(s=>factorProofValid(
   stocks.get(s.symbol),f,s,snapshot)));
 const chosen=snapshot.factorIds===undefined?
  available.map(f=>f.id):snapshot.factorIds;
 if(!Array.isArray(chosen)||chosen.length<2||
    chosen.length>pack.factors.length||new Set(chosen).size!==chosen.length||
    chosen.some(id=>!available.some(f=>f.id===id)))
  throw Error('不足两项全覆盖的有效扩展因子，拒绝补零或填入默认中性分');
 return {ids:chosen,eligibleFactorCount:available.length,
  withheldFactorCount:pack.factors.length-chosen.length};
}
function captureFactorEpisode({candidates,market,factorSnapshot,now=Date.now()}={}){
 if(!isTimestamp(now))throw Error('因子研究时钟无效');
 const cohort=freezeCurrentPicks(candidates,market,{now});
 const stocks=validateFactorFeed(factorSnapshot,cohort,now);
 const selected=chooseFactorIds(factorSnapshot,cohort,stocks);
 const selectedDefs=selected.ids.map(id=>pack.factors.find(f=>f.id===id));
 const rows=cohort.signals.map(signal=>{
  const stock=stocks.get(signal.symbol),values={},evidence={};
  for(const f of selectedDefs){
   const proof=stock.factorEvidence[f.field];
   values[f.id]=stock[f.field];
   evidence[f.id]={source:proof.source,observedAt:proof.timestamp};
  }
  return {signalId:signal.signalId,symbol:signal.symbol,
   signalDate:signal.signalDate,values,evidence};
 });
 const features=freezeFeatureEpisode({cohort,feed:factorSnapshot.feed,
  factorIds:selected.ids,rows,marketContext:factorSnapshot.marketContext},{now});
 if(features.cohortFingerprint!==cohort.fingerprint)
  throw Error('冻结的选股信号与因子指纹不一致');
 return {cohort,features,...selected};
}
module.exports={captureFactorEpisode,validateFactorFeed,chooseFactorIds};
