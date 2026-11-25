// Presentation of existing V6 selection receipts. This module never grants an
// execution permit: paperBuy remains responsible for account and quote gates.
import {eligiblePick,pickReasons,systemPickDay} from './system-picks.mjs';
import {closeDistribution} from './market-evidence.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const stamp=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const text=value=>typeof value==='string'?value.trim():'';
const rows=value=>Array.isArray(value)?value:Array.isArray(value?.items)?value.items:[];
const chinaDay=value=>stamp(value)?new Date(value+28800000).toISOString().slice(0,10):null;
export function battleDate(value){
 const day=typeof value==='string'?value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):'';
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day?day:null;
}
export function battleCode(value){
 if(typeof value!=='string')return null;
 const match=/^(?:(sh|sz|bj|[01]\.))?(\d{6})(?:\.(SH|SZ|BJ))?$/i.exec(value.trim());
 if(!match)return null;
 const exchange=value=>value==='1.'?'sh':value==='0.'?'sz':value?.toLowerCase();
 const prefix=exchange(match[1]),suffix=exchange(match[3]),code=match[2];
 if(prefix&&suffix&&prefix!==suffix)return null;
 const market=prefix||suffix;
 // SH000001 is the Shanghai index, not SZ000001 (Ping An Bank).
 if(market==='sh'&&!/^6/.test(code)||market==='sz'&&!/^[03]/.test(code)||market==='bj'&&!/^(?:4|8|92)/.test(code))return null;
 return code;
}
export function battleDay(state={},now=Date.now()){
 return battleDate(state.closeSession?.day)||battleDate(state.marketClock?.day)||
  battleDate(state.snapshotFieldDays?.candidatePool)||battleDate(state.snapshotDay)||chinaDay(now);
}
const sourceBlocked=row=>/simulat|research|cost|carried|histor|import|fixture|mock|test|synthetic/i.test([row?.quoteMode,row?.mode].filter(Boolean).join(' '))||
 /simulat|readonlybackup/i.test(row?.quoteSource||'')||
 /(?:^|[-_:/\.\s])(?:import(?:ed)?|fixture|mock|test|synthetic)(?:$|[-_:/\.\s])/i.test(row?.quoteSource||'')||
 ['simulated','readOnlyBackup','imported','fixture','mock','synthetic','researchOnly','historicalClose'].some(key=>row?.[key]===true);

function continuousSession(state,now){
 if(state.trading!==true||state.marketClock?.trading===false||state.marketFrozen===true||state.isSnapshot===true||state.closeSession||
    state.marketClock?.openDay===false||!stamp(now))return false;
 const d=new Date(now+28800000),minute=d.getUTCHours()*60+d.getUTCMinutes();
 return minute>=570&&minute<690||minute>=780&&minute<897;
}
function originalQuoteIssue(row,day,now){
 if(row.canTrade===false||sourceBlocked(row))return '报价仅供观察';
 if(!finite(row.price)||row.price<=0)return '缺少有效价格';
 if(!text(row.quoteSource))return '缺少原始报价来源';
 const at=row.quoteAt;
 if(!stamp(at)||row.vendorQuoteAt!=null&&row.vendorQuoteAt!==at||row.quoteTimestamp!=null&&row.quoteTimestamp!==at)return '原始报价时点待核验';
 if(!stamp(row.receivedAt)||row.receivedAt<at||row.receivedAt>now)return '报价接收时点待核验';
 if(at>now)return '报价时点在未来';
 if(now-at>15000)return '原始报价超过 15 秒';
 if(chinaDay(at)!==day||systemPickDay(row,day,now)!==day)return '报价或候选交易日不一致';
 return null;
}
function sealedCodes(state,day){
 const own=battleDate(state.snapshotFieldDays?.ztPool||state.ztPool?.day||state.ztDay);
 return new Set(own===day&&state.ztDayProbed!==false?rows(state.ztPool).map(row=>battleCode(row.code)).filter(Boolean):[]);
}
function candidateIssue(row,state,day,now,sealed){
 if(!eligiblePick(row))return '未通过原选股条件';
 if(!continuousSession(state,now)||day!==chinaDay(now))return '等待连续竞价的新信号';
 const quoteIssue=originalQuoteIssue(row,day,now);
 if(quoteIssue)return quoteIssue;
 if(sealed.has(row.code)||row.sealedUp===true||row.isLimitUp===true||row.oneWord===true)return '当前封板，等待可成交条件';
 if(!finite(row.score)||row.score<0||row.score>100)return '精选评分待核验';
 if(!pickReasons(row).length)return '缺少原策略入选依据';
 return null;
}
function datedHit(row,day,fallback,now){
 if(!row||!battleCode(row.code)||sourceBlocked(row)||!eligiblePick({...row,code:battleCode(row.code)}))return false;
 if(stamp(row.knownAt)&&row.knownAt>now)return false;
 return systemPickDay(row,battleDate(fallback),now)===day;
}

// One vote per actual strategy, per stock and trade day. Auction observations
// are tape evidence, not the auction strategy's selected pool, so never vote.
export function strategyResonance(state={}, {now=Date.now(),day=battleDay(state,now),role='view',auction}={}){
 const byCode=new Map();
 const add=(list,label,fallback)=>{
  for(const raw of rows(list)){
   if(!datedHit(raw,day,fallback,now))continue;
   const code=battleCode(raw.code),labels=byCode.get(code)||new Set();
   labels.add(label);byCode.set(code,labels);
  }
 };
 add(state.pool,'精选',state.snapshotFieldDays?.candidatePool||state.poolDay);
 const selected=auction||state.auctionResonance;
 if(selected?.locked!==true&&selected?.freezeUnavailable!==true&&selected?.error==null)
  add(selected?.items,'竞价引力',selected?.snapshotDay||selected?.day);
 if(role==='edit')add(state.yierList,'一进二',state.yierAsOf||state.snapshotFieldDays?.yierList);
 return byCode;
}

function validRange(value){
 return Array.isArray(value)&&value.length===2&&value.every(n=>finite(n)&&n>0)&&value[0]<=value[1]?value.slice():null;
}
function planFor(row,state,day,now){
 const next=state.nextplan;
 const selected=battleDate(next?.applyDate)===day&&battleDate(next?.date)&&battleDate(next.date)<=day&&
  (!next.knownAt||stamp(next.knownAt)&&next.knownAt<=now)?rows(next?.plan?.picked).find(item=>battleCode(item.code)===row.code):null;
 const own=row.plan&&typeof row.plan==='object'&&!Array.isArray(row.plan)&&
  (!row.plan.code||battleCode(row.plan.code)===row.code)&&
  (!row.plan.applyDate||battleDate(row.plan.applyDate)===day)&&
  (!row.plan.tradeDate||battleDate(row.plan.tradeDate)===day)&&
  (!row.plan.knownAt||stamp(row.plan.knownAt)&&row.plan.knownAt<=now)?row.plan:null;
 const plan=own||selected||row,levels=row.levels||{};
 const entry=validRange(plan.entry||plan.buyRange);
 const basisLow=entry?.[0]??row.price,basisHigh=entry?.[1]??row.price;
 const stopValue=plan.stop??levels.stop,targetValue=plan.target??levels.t1;
 const stop=finite(stopValue)&&stopValue>0&&stopValue<basisLow?stopValue:null;
 const target=finite(targetValue)&&targetValue>basisHigh?targetValue:null;
 const strategyPosition=plan.positionPct??plan.maxPositionPct??plan.maxPosition;
 const rawPosition=strategyPosition??state.paper?.pool?.policy?.positionPct;
 const positionPct=finite(rawPosition)&&rawPosition>0&&rawPosition<=100?rawPosition:null;
 const missing=[!entry&&'买入区间',!stop&&'止损位',!target&&'目标价',!positionPct&&'建议仓位'].filter(Boolean);
 return {entry,stop,target,positionPct,planMissing:missing,planReady:missing.length===0,
  positionSource:strategyPosition!=null?'原策略计划':finite(rawPosition)?'A 盘现有仓位上限':null,
  planSource:own?'同日原策略计划':selected?'已有次日计划 · '+battleDate(next.date):'原候选与技术价位',
  planDay:day};
}

function distribution(state,day,now){
 const r=state.marketDistribution;
 if(r?.kind==='market-distribution-intraday'&&r.day===day&&text(r.source)&&text(r.scope)&&
   stamp(r.quoteAt)&&chinaDay(r.quoteAt)===day&&stamp(r.knownAt)&&r.quoteAt<=r.knownAt&&r.knownAt<=now&&now-r.quoteAt<=15*60000&&
   ['adv','dec','flat','observed','total','upLimit','downLimit'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0)&&
   r.observed>0&&r.total>=r.observed&&r.adv+r.dec+r.flat===r.observed&&r.upLimit<=r.adv&&r.downLimit<=r.dec)return r;
 if(!continuousSession(state,now))return closeDistribution(state.marketRecovery,day,now,state.marketDistribution);
 return null;
}
export function marketWeather(state={}, {now=Date.now(),day=battleDay(state,now)}={}){
 const metrics={},sources=[],missing=[];
 const wide=distribution(state,day,now),mood=state.dashboard?.mood;
 if(wide){
  Object.assign(metrics,{breadthPct:100*wide.adv/wide.observed,upLimit:wide.upLimit,downLimit:wide.downLimit});
  sources.push({label:'宽度与涨跌停',source:wide.source,scope:wide.scope,day,at:wide.quoteAt});
 }else{
  const at=mood?.scope?.snapAt,sample=mood?.scope?.sample;
  if(stamp(at)&&at<=now&&chinaDay(at)===day&&now-at<=15*60000&&text(state.dashboard?.source)&&
   Number.isSafeInteger(sample)&&sample>0&&['upN','downN','flatN'].every(k=>Number.isSafeInteger(mood[k])&&mood[k]>=0)&&
   mood.upN+mood.downN+mood.flatN===sample){
   metrics.breadthPct=100*mood.upN/sample;
   // mood.ztN is calculated from quotes while mood.dtN may use a different
   // provider's limit-down pool. Without a shared batch, their ratio is unknown.
   sources.push({label:'盘中样本',source:state.dashboard.source,scope:sample+' 只同批行情',day,at});
  }
 }
 const ecology=state.dabanke,seal=ecology?.ecology?.find(r=>r?.label==='当日封板');
 if(ecology?.day===day&&stamp(ecology.knownAt)&&ecology.knownAt<=now&&
  Number.isSafeInteger(seal?.success)&&Number.isSafeInteger(seal?.total)&&seal.total>0&&seal.success>=0&&seal.success<=seal.total){
  metrics.sealRatePct=100*seal.success/seal.total;
  sources.push({label:'封板率',source:'打板客当日封板',scope:'不含 ST 的当日触板池 '+seal.success+' / '+seal.total,day,at:ecology.knownAt});
 }
 if(metrics.breadthPct==null)missing.push('同日市场宽度');
 if(metrics.upLimit==null||metrics.downLimit==null)missing.push('同批涨跌停数');
 if(metrics.sealRatePct==null)missing.push('同日封板率');
 metrics.limitRatio=metrics.upLimit==null||metrics.downLimit==null||metrics.downLimit===0?null:metrics.upLimit/metrics.downLimit;
 const emptyDown=metrics.downLimit===0&&metrics.upLimit>0;
 let status='unknown',label='谨慎',tone='amber';
 if(!missing.length){
  if(metrics.breadthPct<=30||metrics.downLimit>metrics.upLimit&&metrics.sealRatePct<50){status='defensive';label='空仓';tone='red';}
  else if(metrics.breadthPct>=60&&(emptyDown||metrics.limitRatio>=2)&&metrics.sealRatePct>=70){status='constructive';label='可做多';tone='green';}
  else status='mixed';
 }
 const sentence=missing.length?'谨慎：'+missing.join('、')+'待核验，等待信号。':
  label+'：上涨占比 '+metrics.breadthPct.toFixed(1)+'%，涨停 / 跌停 '+metrics.upLimit+' / '+metrics.downLimit+'，封板率 '+metrics.sealRatePct.toFixed(1)+'%。';
 return {day,status,label,tone,sentence,metrics,sources,missing,canTrade:false,
  rule:'展示规则：上涨占比≥60%、涨停至少为跌停2倍且封板率≥70%为可做多；上涨占比≤30%，或跌停多于涨停且封板率<50%为空仓；其余谨慎。'};
}

export function buildBattleBoard(state={}, {now=Date.now(),role='view',auction}={}){
 const day=battleDay(state,now),weather=marketWeather(state,{day,now}),blocked=[],candidates=[],seen=new Set();
 const resonance=strategyResonance(state,{day,now,role,auction}),sealed=sealedCodes(state,day);
 const declared=battleDate(state.snapshotFieldDays?.candidatePool||state.poolDay);
 const pool=rows(state.pool).filter(r=>r&&typeof r==='object').slice().sort((a,b)=>(finite(b.score)?b.score:-Infinity)-(finite(a.score)?a.score:-Infinity));
 for(const raw of pool){
  const code=battleCode(raw.code);
  if(!code||seen.has(code))continue;
  const row={...raw,code},issue=declared&&declared!==day?'候选池原始交易日不一致':
   weather.status==='defensive'?'天气为空仓，暂停展示买入候选':candidateIssue(row,state,day,now,sealed);
  // A rejected duplicate cannot shadow a later complete receipt for the same symbol.
  if(issue){blocked.push({code,reason:issue});continue;}
  seen.add(code);
  const labels=[...(resonance.get(code)||new Set(['精选']))];
  const themes=[...new Set([row.sector,row.industry,...(Array.isArray(row.themes)?row.themes:[])].map(text).filter(Boolean))];
  const reason=pickReasons(row)[0],plan=planFor(row,state,day,now);
  candidates.push({code,name:text(row.name)||code,day,poolDay:day,score:row.score,reason,
   quoteAt:row.quoteAt,receivedAt:row.receivedAt,source:row.quoteSource,price:row.price,
   themes,resonance:labels.length,resonanceLabels:labels,...plan,
   selectionGate:'existing-system-pick',executionReady:false,canTrade:false,
   row:{...row,poolDay:day}});
 }
 candidates.sort((a,b)=>b.resonance-a.resonance||b.score-a.score||a.code.localeCompare(b.code));
 return {day,weather,candidates:candidates.slice(0,3),blocked:blocked.filter(row=>!seen.has(row.code)),qualifiedCount:candidates.length,
  emptyReason:candidates.length?'':'今天空仓，等待信号',
  gateNote:'已核原选股条件与报价时点；实际委托仍由原模拟盘门禁判定。'};
}

export function stockConclusion(row={}, {state={},now=Date.now(),day=battleDay(state,now)}={}){
 const code=battleCode(row.code),own=systemPickDay(row,null,now);
 const reasons=[],evidence=[];
 const validDay=!!day&&own===day;
 if(validDay){
  const theme=text(row.sector||row.industry);if(theme)evidence.push('题材：'+theme);
  if(finite(row.sealAmount)&&row.sealAmount>=0)evidence.push('封单：'+row.sealAmount.toLocaleString('zh-CN')+' 元');
  if(finite(row.pct))evidence.push('量价：涨跌 '+row.pct.toFixed(2)+'%'+(finite(row.volume)&&row.volume>=0?'，成交量 '+row.volume.toLocaleString('zh-CN'):''));
  if(typeof row.aboveMa5==='boolean')evidence.push('位置：'+(row.aboveMa5?'五日线上':'五日线下'));
  else if(finite(row.levels?.ma5))evidence.push('位置：五日线 '+row.levels.ma5.toFixed(2));
 }
 const quoteIssue=originalQuoteIssue({...row,code},day,now);
 if(!code||!eligiblePick({...row,code}))reasons.push('原选股条件未通过');
 if(!validDay)reasons.push('缺少一致的原始交易日');
 if(quoteIssue)reasons.push(quoteIssue);
 const sealed=sealedCodes(state,day).has(code)||row.sealedUp===true||row.isLimitUp===true;
 if(sealed)reasons.push('当前封板，缺少可成交条件');
 const waiting=validDay&&!reasons.length&&(row.awaitingReseal===true||Number.isInteger(row.breakCount)&&row.breakCount>0);
 const label=reasons.length?'回避':waiting?'等待回封':'可关注';
 if(waiting)reasons.push('有开板记录，等待回封确认');
 if(!reasons.length)reasons.push(pickReasons(row)[0]||'核对同日题材、封单及量价证据');
 return {label,tone:label==='回避'?'red':label==='等待回封'?'amber':'green',day:own,
  reason:reasons.join('；'),evidence,canTrade:false};
}
