import {factorDictionary} from './factor-dictionary.mjs';
import {confirmedFact} from './pressure.mjs';

import {isTestSample} from './sample-quality.mjs';
import {predict} from './learning.mjs';
import {deriveCheckInput,applyLiveSignalWindow} from './backtest.mjs';
import {settingsAt,blacklistReason,calendarWarnings} from './settings.mjs';

const metrics = [
  ['upLimit','涨停家数',0,10000,true], ['downLimit','跌停家数',0,10000,true],
  ['breakRate','炸板率',0,100], ['height','连板高度',0,100,true],
  ['leader','高标平均反馈',-100,100], ['diffusion','题材扩散度',0,100],
];
const otherNumbers = [
  ['adv','上涨家数',0,10000,true], ['dec','下跌家数',0,10000,true],
  ['amount','全市场成交额',0,1e8], ['premium','昨日涨停溢价',-100,100], ['indexChange','全A涨跌幅',-100,100],
];
const trends=['多头','震荡','空头'];
const hasValue=v=>v!==null && v!==undefined && String(v).trim()!=='';
const validDate=d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(v,min,max,integer=false)=>hasValue(v) && ['string','number'].includes(typeof v) && Number.isFinite(Number(v)) && Number(v)>=min && Number(v)<=max && (!integer||Number.isInteger(Number(v)));
const latest=s=>[...(s.market||[])].sort((a,b)=>b.date.localeCompare(a.date))[0]?.date || new Date().toISOString().slice(0,10);

export function normalizeMarket(row) {
  if(!validDate(row.date)) throw Error('请输入有效交易日期');
  const result={date:row.date};
  for(const [key,label,min,max,integer] of [...metrics,...otherNumbers]) {
    if(hasValue(row[key])&&!finite(row[key],min,max,integer)) throw Error(label+'超出有效范围');
    result[key]=hasValue(row[key])?Number(row[key]):null;
  }
  for(const key of ['trend','sh','cy']) {
    if(hasValue(row[key])&&!trends.includes(row[key])) throw Error('指数趋势取值无效');
    result[key]=row[key]||'';
  }
  const valueSets={volume:['放量上涨','缩量上涨','放量下跌','缩量阴跌','平量震荡'],themeType:['主线','支线','轮动题材','消息一日游'],indexPosition:['低位企稳','中间震荡','高位承压'],resonance:['题材指数共振','题材独立背离'],highlights:['空间板','龙头','断板','反包','首板先锋','辨识度标的']};
  for(const [key,choices] of Object.entries(valueSets)){
    if(hasValue(row[key])&&!choices.includes(row[key])) throw Error('市场标签无效');
    result[key]=row[key]||'';
  }
  for(const key of ['theme','tier','themeLeader','assists','followers','notes']) result[key]=String(row[key]||'').trim().slice(0,500);
  for (const key of ['themeDays','assistCount']) {
    if(hasValue(row[key])&&!finite(row[key],0,10000,true))throw Error('题材天数和助攻数量须为非负整数');
    result[key]=hasValue(row[key])?Number(row[key]):null;
  }
  return result;
}

// Use Beijing wall-clock timestamps throughout the daily market snapshot archive.
const stampText=t=>typeof t==='number'&&Number.isFinite(t)?new Date(t+8*36e5).toISOString().slice(0,16).replace('T',' '):String(t||'').replace('T',' ').slice(0,16);
export function knowledgeCutoff(value){
  if(Number.isFinite(value))return value;
  let s=String(value||'').replace(' ','T');
  if(s.length===10)s+='T15:00';
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'+08:00');
}
export function knownBy(row,point){
  const cutoff=knowledgeCutoff(point);
  return (row.knownAt==null || knowledgeCutoff(row.knownAt)<=cutoff) && knowledgeCutoff(row.availableAt||row.date)<=cutoff;
}
function visibleDays(days,date,at) {
  const point=stampText(at||date+' 15:00');
  const values=new Map();
  for(const day of days||[]){
    if(!validDate(day.date)||day.date>date)continue;
    const observed=stampText(day.availableAt||day.date+' 15:00');
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(observed)||observed>point||!knownBy(day,at||point))continue;
    const previous=values.get(day.date);
    if(!previous||previous.stamp<=observed)values.set(day.date,{stamp:observed,day});
  }
  return [...values.values()].map(x=>x.day).sort((a,b)=>a.date.localeCompare(b.date));
}
export function marketAsOf(state,date,at){
  const rows=[...(state.marketHistory||[]),...(state.market||[])];
  return visibleDays(state.scope==='live'?rows.filter(r=>!isTestSample(r)):rows,date,at);
}

// All windows end at the specified close. A missing observation is never a zero.
export function emotion(days=[],date,asOf) {
  const missing=[],evidence=[];
  const result={stage:'未判定',confidence:0,evidence,missing};
  if(!validDate(date)){missing.push('判定日期');return result}
  const window=visibleDays(days,date,asOf).slice(-3);
  if(!window.some(d=>d.date===date))missing.push(date+' 当日收盘观测');
  for(let i=1;i<window.length;i++){
    if(window[i].previousDay&&window[i].previousDay!==window[i-1].date)missing.push('交易日序列间隔 '+window[i].previousDay);
  }
  if(window.length<3)missing.push('至少3个交易日的收盘观测（已录入'+window.length+'日）');
  for(const day of window)for(const [key,label,min,max,integer] of metrics)
    if(!finite(day[key],min,max,integer))missing.push(day.date+' '+label);
  for(const [key,label] of metrics){
    const unit=['breakRate','leader','diffusion'].includes(key)?'%':'';
    evidence.push(label+'：'+window.map(d=>hasValue(d[key])?d[key]+unit:'缺失').join(' → '));
  }
  // Only traced, already-received attributions supplement the six market votes.
  const cutoff=knowledgeCutoff(asOf||date+' 15:00');
  const attributed=window.find(d=>d.date===date)?.breakAttributions||{};
  let displayed=0;
  for(const [code,row] of Object.entries(attributed).sort(([a],[b])=>a.localeCompare(b))){
    if(displayed>=6)break;
    if(!/^\d{6}$/.test(code)||row?.code!==code||typeof row.status!=='string'||!row.status||row.status==='未判定'||
       row.eventTime?.slice(0,10)!==date||!(knowledgeCutoff(row.eventTime)<=knowledgeCutoff(row.knownAt))||
       !(knowledgeCutoff(row.knownAt)<=cutoff)||!Array.isArray(row.evidence))continue;
    const trace=row.evidence.filter(x=>typeof x==='string'&&x.trim()).slice(0,3);
    if(trace.length){evidence.push('个股炸板归因补充 '+code+' '+row.status.slice(0,80)+' · '+trace.map(x=>x.slice(0,180)).join('；'));displayed++;}
  }
  if(missing.length)return result;
  const [a,b,t]=window.map(day=>Object.fromEntries(metrics.map(([k])=>[k,Number(day[k])])));
  const up=(k)=>a[k]<=b[k]&&b[k]<=t[k]&&t[k]>a[k];
  const down=(k)=>a[k]>=b[k]&&b[k]>=t[k]&&t[k]<a[k];
  const votes = arr=>arr.reduce((n,x)=>n+Number(x),0);
  // Each candidate requires both an anchor and concordant independent observations.
  const rising=votes([up('upLimit'),down('downLimit'),down('breakRate'),t.height>=a.height,up('leader'),up('diffusion')]);
  const falling=votes([down('upLimit'),up('downLimit'),up('breakRate'),t.height<=a.height,down('leader'),down('diffusion')]);
  const severe=votes([t.upLimit<=20,t.downLimit>=25,t.breakRate>=42,t.height<=3,t.leader<=-3,t.diffusion<=25]);
  const hot=votes([t.upLimit>=70,t.downLimit<=6,t.breakRate<=20,t.height>=6,t.leader>=2,t.diffusion>=70]);
  let degree=0,reason='';
  if(severe>=5 && (b.downLimit>=20 || b.breakRate>=38) && t.leader<0) {
    result.stage='冰点';degree=severe;reason='持续承压后，涨停广度、高标反馈和题材扩散进入低位区间';
  } else if(hot>=5 && t.leader>0 && t.diffusion>=70 && t.upLimit>=b.upLimit*.9 && (b.upLimit>=50||rising>=4)) {
    result.stage='高潮';degree=hot;reason='涨停梯队与题材广度处于高位，高标正反馈得到确认';
  } else if(falling>=5 && t.leader<0 && t.diffusion<b.diffusion && t.downLimit>=b.downLimit && t.upLimit<a.upLimit*.8) {
    result.stage='退潮';degree=falling;reason='多个交易日涨停收缩、题材扩散变弱，高标转为负反馈';
  } else if(rising>=5 && t.leader>0 && t.diffusion>b.diffusion && t.upLimit>b.upLimit && t.breakRate<=35) {
    result.stage='发酵';degree=rising;reason='多日涨停与题材广度扩张，高标保持正反馈';
  } else {
    const split=votes([t.upLimit<b.upLimit,t.downLimit>b.downLimit,t.breakRate>=b.breakRate+4,t.leader<b.leader,t.diffusion<b.diffusion,t.height>=a.height]);
    if(split>=4 && t.breakRate>b.breakRate && b.upLimit>=a.upLimit && b.diffusion>=a.diffusion && (t.height>=4||b.upLimit>=40)){
      result.stage='分歧';degree=split;reason='前期扩张后炸板增加，高标、梯队与跟随资金发生分化';
    }
  }
  if(degree) {result.confidence=Math.round(degree/6*100); evidence.push(reason+'（'+degree+'/6 项规则一致）');}
  else evidence.push('多日观测完整，指标未形成足以判定阶段的一致证据');
  return result;
}

const relay=new Set([1,6,7,8,14,17,19,23,26,32,36,42,45,47]);
const dip=new Set([5,22,24,33,34,36]);
const groupedKinds={strategy:'战法条件',avoid:'规避因子',control:'风控纪律',index:'指数环境'};
const stockRiskNames=new Set([11,20,30,37,40,46,49,55,56,57,59,61,66,67,68,69,70]);
const capRules=new Map([[60,5],[62,5],[63,10],[65,10],[73,10],[75,10],[76,10],[77,10],[79,10],[83,5],[86,5],[87,10],[88,10],[90,10],[91,10],[95,10]]);

export function validate(state,input,options={}) {
  if(!validDate(input.date))throw Error('请输入有效校验日期');
  const date=input.date, code=String(input.code||'').trim(), name=String(input.name||'').trim().slice(0,60);
  if(!/^\d{6}$/.test(code)||!name)throw Error('请填写六位 A 股代码和标的名称');
  const catalog=state.catalog||[],selected=new Set(input.selected||[]);
  const validKeys=new Set(catalog.flatMap(r=>r.factors.map((_,i)=>r.id+':'+i)));
  if([...selected].some(k=>!validKeys.has(k)))throw Error('部分因子不在当前目录中');
  const on=(id,i)=>selected.has(id+':'+i);
  const chosen=catalog.map(r=>({...r,seen:r.factors.filter((_,i)=>on(r.id,i))})).filter(r=>r.seen.length);
  const matches=chosen.filter(r=>r.kind==='strategy'&&r.seen.length===r.factors.length);
  const risks=[],facts=[],blocks=new Set(),add=r=>{if(!risks.includes(r))risks.push(r)};
  const asOf=options.asOf?stampText(options.asOf):date+' 15:00';
  const observedAt=options.asOf||asOf;
  const settings=settingsAt(state,observedAt);
  const available=marketAsOf(state,date,observedAt);
  const market=available.find(x=>x.date===date);
  const em=emotion(available,date,observedAt);
  let cap=20;
  const limit=(v,reason)=>{cap=Math.min(cap,v);add(reason)};
  const exclude=(set,reason)=>{for(const id of set) blocks.add(id);add(reason)};
  const stop=reason=>limit(0,reason);
  const stockEvidence=options.stockEvidence?.code===code && String(options.stockEvidence.date||'').slice(0,10)===date?options.stockEvidence:{};
  const blacklist=blacklistReason(settings,{...stockEvidence,code,name:stockEvidence.name||name,sector:input.theme||stockEvidence.sector,asOf:observedAt});
  if(blacklist)stop(blacklist);
  for(const key of settings.blockedFactors)if(selected.has(key))stop('自定义禁用因子 '+key);
  for(const reason of calendarWarnings(settings,market,date,observedAt,stockEvidence))limit(settings.calendarCap,reason);

  if(!market||!trends.includes(market.trend))stop('缺少当日全A趋势');
  if(em.stage==='未判定')stop('情绪未判定，待补证后再校验');
  if(em.stage==='退潮'){limit(5,'退潮期降仓并暂停接力');exclude(relay,'退潮期过滤接力战法')}
  if(em.stage==='冰点')limit(5,'冰点期仅允许小仓试错');
  if(em.stage==='高潮')exclude(dip,'高潮期过滤低吸战法');
  if(em.stage!=='冰点')blocks.add(18);
  if(em.stage!=='分歧')blocks.add(5);
  if(em.stage!=='高潮'){blocks.add(19);blocks.add(32)}
  if(market?.trend==='震荡'||on(82,0)&&on(82,1)){
    limit(10,'全A震荡，标准上限减半，仅评估分歧低吸');
    for(const r of matches)if(r.id!==5)blocks.add(r.id);
  }
  if(market?.trend==='空头'||on(83,0)&&on(83,1)||on(71,1)){
    limit(5,'指数下降通道，极小仓位试错');exclude(relay,'空头环境暂停高位接力');
  }
  if(market?.volume==='放量下跌'||on(72,0)||on(72,1)||on(85,0))stop('指数放量杀跌，停止新开仓');
  if(market?.volume==='缩量阴跌')exclude(relay,'缩量阴跌不参与接力');
  if(market?.resonance==='题材独立背离')limit(10,'题材与指数背离，降低敞口');
  if((market?.volume?.includes('上涨')||Number(market?.indexChange)>0)&&finite(market?.dec,0,10000)&&finite(market?.adv,0,10000)&&Number(market.dec)>Number(market.adv))limit(10,'指数上涨但下跌家数占优');
  const divided=market?.sh && market?.cy && market.sh!==market.cy && market.trend!==market.cy;
  if((divided||on(80,4))&&input.strongSector!==true)stop('跨指数走势分化，须确认属于强势赛道');
  if(on(51,2)||input.mainline===false)limit(10,'非主线套利压缩仓位');
  if(on(51,3))limit(5,'按退潮期限制新增敞口');
  if(on(54,0)||on(54,2))stop('连续亏损或情绪恶化触发空仓纪律');
  if(on(54,1))limit(5,'连续亏损交易日降低出手频率');
  if(on(58,2))stop('尾盘盲目出手，触发时间窗口过滤');
  if(on(58,0)||on(58,1))limit(5,'长假或月末窗口收紧仓位');
  if(on(93,0)||on(94,1))limit(10,'缺口或缩量上行，减少出手');
  for(const r of chosen.filter(r=>r.kind!=='strategy')){
    const details=r.name+' · '+r.seen.join('、');
    facts.push(details);
    if(stockRiskNames.has(r.id))stop(details);
    const compound=[73,75,90].includes(r.id);
    if(capRules.has(r.id)&&(!compound||r.seen.length===r.factors.length))limit(capRules.get(r.id),details);
    if([76,77,86,91].includes(r.id))exclude(relay,r.name+'暂停接力');
    if(r.id===52&&(on(52,1)||on(52,2)||on(52,3)))stop('结构破坏或逻辑失效，执行止损纪律');
    if(r.id===53)limit(5,'触发止盈信号，优先处理已有持仓');
    if(r.id===64&&(on(64,1)||on(64,2)))limit(5,'强弱转换，保护浮盈');
  }
  const sessions=available.map(d=>d.date);
  const recent=sessions.slice(-3);
  if(recent.length===3 && recent.every(d=>{
    const day=available.find(v=>v.date===d);
    return finite(day?.indexChange,-100,100)&&Number(day.indexChange)<0;
  }))exclude(relay,'全A连续至少三日收跌，暂停接力');
  const cutoff=Date.parse(asOf.replace(' ','T')+':00+08:00');
  const visibleTrades=(state.trades||[]).filter(t=>!t.paperSettlement&&!t.accountId&&(state.scope==='demo'||!isTestSample(t))&&(!t.createdAt||Date.parse(t.createdAt)<=cutoff));
  const realized=new Map();
  for(const t of visibleTrades){
    const d=String(t.exitTime||'').slice(0,10);
    if(d<=date&&stampText(t.exitTime)<=asOf&&finite(t.pnlAmount,-1e15,1e15))realized.set(d,(realized.get(d)||0)+Number(t.pnlAmount));
  }
  if(sessions.length>=2 && sessions.slice(-2).every(d=>realized.has(d)&&realized.get(d)<0))limit(5,'连续两个交易日已实现净亏损，降低频率和仓位');
  const closed=visibleTrades.filter(t=>typeof t.exitTime==='string' && t.exitTime.slice(0,10)===date && stampText(t.exitTime)<=asOf && finite(t.pnl,-100,1e8)).sort((a,b)=>a.exitTime.localeCompare(b.exitTime));
  if(closed.some((t,i)=>i>0&&Number(t.pnl)<0&&Number(closed[i-1].pnl)<0))stop('成交记录显示当日连续两笔亏损，停止新开仓');
  const positions={
    singleCap:20,themeCap:40,totalCap:80,stockHeld:0,themeHeld:0,totalHeld:0
  };
  for(const k of Object.keys(positions)){
    if(hasValue(input[k])&&!finite(input[k],0,100))throw Error('仓位须为 0 至 100 的百分比');
    if(hasValue(input[k]))positions[k]=Number(input[k]);
  }
  positions.singleCap=Math.min(positions.singleCap,settings.maxPosition);
  if(positions.stockHeld>positions.themeHeld||positions.themeHeld>positions.totalHeld)throw Error('已有仓位须满足单标的 ≤ 同题材 ≤ 组合总仓位');
  const totalCeiling=Math.min(positions.totalCap,em.stage==='退潮'?15:em.stage==='冰点'?20:100);
  const room=Math.max(0,Math.min(positions.singleCap-positions.stockHeld,positions.themeCap-positions.themeHeld,totalCeiling-positions.totalHeld));
  if(room<cap)limit(room,'剩余可用仓位受单标的、题材或总仓上限约束');
  const eligible=matches.filter(r=>!blocks.has(r.id));
  if(!eligible.length)stop(matches.length?'已匹配战法与周期或指数约束不一致':'尚无完整匹配的体系内战法');
  const activeParams=state.activeParameters||{};
  const factors=[...new Set([...chosen.flatMap(r=>r.seen),...(options.factorCodes||[])])];
  // Providers can publish a closed snapshot after its signal day. Keep outcome learning
  // strictly before that signal close even when the fact snapshot has a later timestamp.
  const performanceCutoff=asOf<date+' 15:00'?asOf:date+' 15:00';
  const prediction=options.skipPrediction===true?null:predict(state,{factors,strategy:eligible[0]?.name||matches[0]?.name||'',trend:market?.trend,asOf:performanceCutoff.replace(' ','T')});
  if(prediction?.risk && prediction.risk!=='历史样本可供参考' && prediction.risk!=='同类样本不足')add(String(prediction.risk));
  return {date,code,name,asOf,settingsVersion:settings.version,settingsPreset:settings.preset,theme:String(input.theme||market?.theme||'').trim().slice(0,80),selected:[...selected],factors,market:market?{...market}:null,emotion:em,risks,facts,...positions,mainline:input.mainline!==false,strongSector:input.strongSector===true,
    strategy:matches.map(r=>r.name).join('、')||'未匹配',matches:matches.map(r=>r.name),eligible:eligible.map(r=>r.name),position:Math.max(0,Math.floor(cap*100)/100),status:cap<=0?'暂缓开仓':cap<=10?'轻仓试错':'符合开仓条件',prediction,version:prediction?.version||activeParams.version||'基准规则'};
}

const portfolioKeys=['singleCap','themeCap','totalCap','stockHeld','themeHeld','totalHeld'];

function confirmedCodes(state,code,date){
 const obs=state.v6Observation;
 if(!obs||obs.code!==code||obs.day!==date||obs.stock?.code!==code||
    !Number.isSafeInteger(obs.observedAtMs)||obs.observedAtMs>Date.now())return [];
 const stock=obs.stock,cut=obs.latestClosed===true&&obs.latestClosedDay===date?obs.observedAtMs:
   Math.min(obs.observedAtMs,Date.parse(date+'T15:00:00+08:00')),verified=new Set();
 for(const key of stock.factorCodes||[]){
   const proof=stock.factorEvidence?.[key];
   if(proof?.tradeDate===date&&Number.isSafeInteger(proof.knownAt)&&proof.knownAt<=cut&&proof.text)verified.add(key);
 }
 if(stock.pressure?.code===code&&stock.pressure.day===date&&stock.pressure.knownAt<=cut)
   for(const f of stock.pressure.facts||[]){
     if(confirmedFact(f,code,date,cut)&&f.factorCode)verified.add(f.factorCode);
   }
 const registry=factorDictionary(state.catalog).byCode;
 return [...verified].filter(key=>registry.has(key)&&!key.startsWith('YZ-')).sort();
}

export function autoValidate(state,input) {
  const code=String(input?.code||'').trim(),date=input?.date;
  if(!/^\d{6}$/.test(code)||!validDate(date))throw Error('请输入六位 A 股代码和有效交易日期');
  const query={code,date};
  for(const key of portfolioKeys)if(hasValue(input[key]))query[key]=input[key];
  const observed=deriveCheckInput(state,{code,date});
  const factorCodes=confirmedCodes(state,code,date);
  const evidence=state.v6Observation?.stock?.factorEvidence||{};
  const factorObservations=Object.fromEntries(factorCodes.filter(k=>evidence[k]).map(k=>[k,evidence[k]]));
  const result=validate(state,{
    ...query,name:observed.name||code,theme:observed.theme||'',
    selected:observed.selected||[],mainline:observed.mainline===true,strongSector:observed.strongSector===true
  },{asOf:observed.observedAtMs||observed.asOf,stockEvidence:observed.stockEvidence,factorCodes});
  return applyLiveSignalWindow(state,{
    ...result,factorCodes,factorObservations,
    strategy:result.matches.length?result.strategy:'未判定',
    recognition:observed.recognition,capture:observed.capture,
    method:'行情自动识别'
  },observed.observedAtMs||observed.asOf);
}

const css=`<style>
.mk{display:grid;gap:18px;min-width:0;color:inherit}
.mk .mk-head,.mk .mk-actions,.mk .mk-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mk h2,.mk h3,.mk h4,.mk p{margin:0}.mk h2{font-size:24px}.mk h3{font-size:17px}.mk h4{font-size:15px}
.mk .mk-sub,.mk-sub{color:#717888;font-size:13px;line-height:1.65}
.mk .mk-panel{background:#fff;border:1px solid #e4e7ef;border-radius:12px;padding:20px;min-width:0}
.mk .mk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px}
.mk-field{display:grid;gap:6px;min-width:0;font-size:13px;color:#505767}
.mk-field input,.mk-field select,.mk-field textarea,.mk-search{border:1px solid #dfe2ec;border-radius:7px;background:#fff;color:#272d40;min-width:0;font:inherit;padding:9px 11px;box-sizing:border-box;width:100%}
.mk .mk-chips{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.mk .mk-tab{background:transparent;border:1px solid transparent;border-radius:7px;color:#626a7b;padding:7px 11px;font:inherit;font-size:13px;cursor:pointer}
.mk .mk-tab[aria-pressed=true]{background:#eeecff;color:#5847cc;border-color:#dcd7ff;font-weight:600}
.mk .mk-note{background:#f6f5ff;border:1px solid #e4e0fa;padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.7;color:#554d79}
.mk .mk-warn{background:#fff7ec;border:1px solid #f3dfc0;color:#8d5e23}
.mk details{border-bottom:1px solid #e8eaf0;padding:11px 0}.mk summary{list-style-position:inside;cursor:pointer;font-size:14px}.mk summary span{color:#858b9b;font-size:12px;margin-left:10px}
.mk .mk-badges{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 2px}.mk .mk-badges label,.mk .mk-pill{display:inline-flex;align-items:center;gap:7px;font-weight:400;color:#4e566a;border:1px solid #e2e5ed;border-radius:6px;background:#fafbfe;padding:6px 9px;font-size:13px}

.mk .mk-evidence{display:grid;gap:5px;font-size:13px;color:#646d80;line-height:1.55;margin-top:10px}
.mk .mk-scroll{overflow:auto;max-height:540px}.mk .mk-table{width:100%;text-align:left;border-collapse:collapse;font-size:14px}
.mk .mk-table td,.mk .mk-table th{padding:12px 8px;border-bottom:1px solid #e8ebf2;white-space:nowrap}
.mk .mk-table th{color:#7b8392;font-size:13px;font-weight:500;background:#fafbfe}
.mk .mk-struct{display:grid;gap:15px;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);align-items:start}
.mk .mk-blank{padding:25px;text-align:center;color:#7b8392}
.mk .mk-label{font-size:12px;color:#7b8392}.mk .mk-num{font-size:25px;line-height:1.4;letter-spacing:-.03em;font-weight:650;font-variant-numeric:tabular-nums}
.mk .mk-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
.mk .mk-spaced{display:grid;gap:14px}.mk .mk-history{cursor:pointer}.mk .mk-history:hover{background:#f8f7fd}
@media(max-width:850px){.mk .mk-struct{grid-template-columns:minmax(0,1fr)}}@media(max-width:520px){.mk .mk-panel{padding:14px}.mk .mk-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>`;
const field=(label,key,markup)=>'<label class="mk-field"><span>'+esc(label)+'</span>'+markup.replace('name=""','name="'+key+'"')+'</label>';
const inputField=(label,key,value='',type='text',extra='')=>field(label,key,'<input name="" type="'+type+'" value="'+esc(value)+'" '+extra+'>');
const button=(s,id,primary=false)=>'<button type="button" class="btn '+(primary?'primary':'')+'" data-mk="'+id+'">'+esc(s)+'</button>';
const find=(root,sel)=>root.querySelector(sel);
function evidenceHTML(e){
  return '<div class="mk-evidence">'+(e.evidence||[]).map(v=>'<div>'+esc(v)+'</div>').join('')+
    ((e.missing||[]).length?'<div>待补数据 · '+e.missing.map(esc).join('、')+'</div>':'')+'</div>';
}
function catalogView(el,rows){
  let kind='strategy',query='';
  el.innerHTML='<div class="mk-spaced"><div class="mk-head"><div class="mk-chips">'+Object.entries(groupedKinds).map(([k,v])=>'<button type="button" class="mk-tab" data-kind="'+k+'" aria-pressed="'+(k===kind)+'">'+v+'</button>').join('')+'</div><input class="mk-search" aria-label="搜索战法或因子" style="max-width:230px" placeholder="搜索战法或因子"></div><div class="mk-scroll" data-list></div></div>';
  const list=find(el,'[data-list]');
  function draw(){
    const visible=rows.filter(r=>r.kind===kind&&(r.name+' '+r.factors.join(' ')).includes(query.trim()));
    list.innerHTML=visible.length?visible.map((r,i)=>'<details '+((query&&i<5)||visible.length===1?'open':'')+'><summary>'+esc(r.name)+'<span>'+r.factors.length+' 项</span></summary><div class="mk-badges">'+r.factors.map(v=>'<span class="mk-pill">'+esc(v)+'</span>').join('')+'</div>'+(r.guidance?'<p class="mk-sub" style="margin-top:8px">'+esc(r.guidance)+'</p>':'')+'</details>').join(''):'<div class="mk-blank">没有符合搜索条件的因子</div>';
  }
  el.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;el.querySelectorAll('[data-kind]').forEach(n=>n.setAttribute('aria-pressed',n===b));draw()});
  find(el,'input.mk-search').oninput=e=>{query=e.target.value;draw()};
  draw();
}
function exportRows(ui,records){
  const header=['交易日','标的代码','标的名称','题材','情绪阶段','规则一致率','符合战法','可执行战法','开仓提示','新增仓位上限%','风险证据','认定因子','规则版本','识别方式','识别依据','缺失证据'];
  const quote=x=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  const rows=records.map(r=>[r.date,r.code,r.name,r.theme,r.emotion?.stage,r.emotion?.confidence,r.strategy,r.eligible?.join('、'),r.status,r.position,r.risks?.join('；'),r.factors?.join('、'),r.version,r.method||'历史记录',r.recognition?.evidence?.join('；'),r.recognition?.missing?.join('；')]);
  ui.download('战法校验记录.csv','\ufeff'+[header,...rows].map(row=>row.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}

function resultHTML(r){
  const p=r.prediction||{},market=r.market||{};
  const phase=['冰点','发酵','高潮','分歧','退潮'].includes(r.emotion?.stage)?r.emotion.stage:'';
  const snapshot=[['全A趋势',market.trend],['上证趋势',market.sh],['创业板趋势',market.cy],['上涨家数',market.adv],['下跌家数',market.dec],[market.fieldSources?.amount?.scope==='沪深两市成交额'?'沪深两市成交额（亿元）':'成交额（亿元）',market.amount]];
  return '<div class="mk-spaced"><div class="mk-head"><h3>校验结果</h3><span class="tag">'+esc(r.status)+'</span></div>'+
  '<div class="mk-metrics"><div><div class="mk-label">新增仓位上限</div><div class="mk-num">'+esc(r.position)+'%</div></div>'+(phase?'<div><div class="mk-label">情绪周期</div><div class="mk-num">'+esc(phase)+'</div></div>':'')+'<div><div class="mk-label">匹配战法</div><div class="mk-num">'+(r.matches?.length??0)+'</div></div></div>'+
  '<details class="mk-note '+(r.position===0?'mk-warn':'')+'"><summary>校验依据与风控条款</summary>'+(r.risks?.length?r.risks.map(x=>'<div>'+esc(x)+'</div>').join(''):'通过已录入的盘面和纪律校验')+'</details>'+
  (r.matches?.length?'<div><h4>匹配明细</h4><div class="mk-evidence">'+esc(r.matches.join('、'))+'</div></div>':'')+
  '<details><summary>同期盘面快照</summary><div class="mk-metrics">'+snapshot.map(([label,value])=>'<div><div class="mk-label">'+label+'</div><div>'+esc(hasValue(value)?value:'缺失')+'</div></div>').join('')+'</div></details>'+
  '<details><summary>情绪判定证据 <span>规则一致率 '+esc(r.emotion?.confidence??0)+'%</span></summary>'+evidenceHTML(r.emotion||{})+'</details>'+
  '<details><summary>历史同类样本 <span>'+esc(p.n??0)+' 笔</span></summary><div class="mk-evidence"><div>'+esc(p.risk||'')+'</div><div>历史胜率 · '+(p.winRate==null?'样本不足':esc(p.winRate)+'%')+'</div><div>历史盈亏比 · '+esc(p.payoff??'样本不足')+'</div><div>估计收益 · '+(p.expectedReturn==null?'样本不足':esc(p.expectedReturn)+'%')+'</div><div>参数版本 · '+esc(r.version||'基准规则')+'</div></div></details></div>';
}
function recognitionHTML(rec){
  if(!rec)return '';
  const evidence=rec.evidence||[],missing=rec.missing||[],candidates=rec.candidates||[];
  const list=(items,empty)=>items.length?'<ul style="margin:0;padding-left:1.4em">'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':esc(empty);
  const partial=candidates.filter(c=>(c.missing?.length||c.failed?.length)&&
    (Array.isArray(c.matched)?c.matched.length>0:Number(c.matched)>0));
  return '<section class="mk-panel mk-spaced"><h3>自动识别依据</h3><details open><summary>观测证据 <span>'+evidence.length+' 项</span></summary><div class="mk-evidence">'+list(evidence,'暂无可核实的观测')+'</div></details>'+
    '<details><summary>缺失证据 <span>'+missing.length+' 项</span></summary><div class="mk-evidence">'+list(missing,'已提供系统列出的观测字段')+'</div></details>'+
    '<details><summary>接近匹配的战法 <span>'+partial.length+' 组</span></summary><div class="mk-evidence">'+(partial.length?partial.map(c=>{
      const matched=Array.isArray(c.matched)?c.matched.length:c.matched;
      return '<details><summary>'+esc(c.name)+'<span>已命中 '+esc(matched)+' 项</span></summary><div class="mk-evidence">'+(Array.isArray(c.matched)?'<div>已命中 · '+esc(c.matched.join('、'))+'</div>':'')+(c.missing?.length?'<div>待补证 · '+esc(c.missing.join('、'))+'</div>':'')+(c.failed?.length?'<div>未满足 · '+esc(c.failed.join('、'))+'</div>':'')+'</div></details>';
    }).join(''):'暂无具备部分条件的战法')+'</div></details></section>';
}

const evidenceQueues=new WeakMap();
function newCheck(ui,mount=ui.root,embedded=false){
  const state=ui.state,root=mount,observation=state.v6Observation||{};
  const date=[ui.initialDay,ui.date,observation.day,latest(state)].find(validDate);
  const stockBars=(state.bars||[]).filter(b=>(!b.role||b.role==='stock')&&/^\d{6}$/.test(b.code));
  const currentCode=[ui.initialCode,ui.stock?.code,ui.stock,observation.code,stockBars.at(-1)?.code,state.checks?.at(-1)?.code].map(v=>String(v||'')).find(v=>/^\d{6}$/.test(v))||'';
  const sourceCodes=[...new Map(stockBars.map(b=>[b.code,b.name||''])).entries()];
  const stockList='<datalist id="mk-known-codes">'+sourceCodes.map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('')+'</datalist>';
  root.innerHTML=css+'<section class="mk">'+(embedded?'':'<div class="mk-head"><div><h2>自动战法校验</h2><p class="mk-sub">选择标的与交易日，按信号时点可获得的行情识别战法和风险。</p></div>'+button('校验记录','back')+'</div>')+
  '<form class="mk-spaced" data-check><section class="mk-panel mk-spaced"><h3>校验标的</h3><div class="mk-grid">'+
  inputField('股票代码','code',currentCode,'text','required list="mk-known-codes" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="六位股票代码"')+inputField('信号日期','date',date,'date','required')+stockList+'</div>'+
  '<details><summary>组合仓位与限额 <span>占总权益百分比</span></summary><div class="mk-grid" style="margin-top:12px">'+
  [['singleCap','单标的上限',20],['themeCap','题材上限',40],['totalCap','组合上限',80],['stockHeld','单标的已有仓位',0],['themeHeld','同题材已有仓位',0],['totalHeld','组合已有仓位',0]].map(([k,l,v])=>inputField(l+'（%）',k,v,'number','required min="0" max="100" step="0.01"')).join('')+'</div></details></section>'+
  '<div aria-live="polite" data-result></div><div class="mk-actions" style="justify-content:flex-end"><button type="submit" class="btn primary" disabled>保存校验记录</button></div></form></section>';
  const form=find(root,'[data-check]'),out=find(form,'[data-result]'),save=find(form,'[type=submit]');
  let sequence=0,timer,loadedKey='',visibleResult=null;
  const read=()=>Object.fromEntries(new FormData(form));
  const key=({code,date})=>code+'|'+date;
  const ready=input=>/^\d{6}$/.test(input.code)&&validDate(input.date);
  const showNote=text=>{out.innerHTML='<section class="mk-panel"><p class="mk-sub">'+esc(text)+'</p></section>';save.disabled=true;visibleResult=null};
  function draw(){
    if(!form.isConnected)return;
    const p=read();
    if(loadedKey!==key(p)||!ready(p))return;
    try{
      visibleResult=autoValidate(ui.state,p);
      out.innerHTML='<div class="mk-spaced"><section class="mk-panel"><div class="mk-head" style="margin-bottom:15px"><div><h3>'+esc(visibleResult.name)+' <span class="mk-sub">'+esc(p.code)+'</span></h3><p class="mk-sub">'+esc(visibleResult.asOf||p.date)+' 观测快照</p></div><span class="tag">行情自动识别</span></div>'+resultHTML(visibleResult)+'</section>'+recognitionHTML(visibleResult.recognition)+'</div>';
      save.disabled=false;
    }catch(err){showNote(err.message)}
  }
  async function load(p,request){
    try{
      // The adapter persists its observation and revision. Keep writes in selection order.
      const previous=evidenceQueues.get(ui)||Promise.resolve();
      const task=previous.catch(()=>{}).then(async ()=>{
        if(request===sequence&&form.isConnected)await ui.loadEvidence(p.code,p.date);
      });
      evidenceQueues.set(ui,task);
      await task;
      if(request!==sequence||!form.isConnected||key(read())!==key(p))return;
      loadedKey=key(p);ui.initialCode=p.code;ui.initialDay=p.date;draw();
    }catch(err){
      if(request!==sequence||!form.isConnected)return;
      showNote('无法载入该日行情 · '+err.message);
      out.insertAdjacentHTML('beforeend',button('重试载入','retry'));find(out,'[data-mk=retry]').onclick=schedule;
    }
  }
  function schedule(){
    clearTimeout(timer);loadedKey='';const request=++sequence,p=read();
    if(!ready(p)){showNote('输入完整股票代码和信号日期后，系统将自动检索同期证据。');return}
    showNote('正在载入 '+p.code+' 在 '+p.date+' 可见的行情…');
    timer=setTimeout(()=>load(p,request),250);
  }
  form.addEventListener('input',e=>{
    if(['code','date'].includes(e.target.name))schedule();
    else if(portfolioKeys.includes(e.target.name))draw();
  });
  if(!embedded)find(root,'[data-mk=back]').onclick=()=>ui.open('checks');
  form.onsubmit=async e=>{
    e.preventDefault();
    const p=read();
    if(!visibleResult||loadedKey!==key(p))return;
    save.disabled=true;
    try{await ui.save('check',p);ui.toast?.('校验证据与结果已冻结保存');ui.open('checks')}
    catch(err){ui.toast?.(err.message);if(form.isConnected)draw()}
  };
  schedule();
}
export function renderMarket(ui,mode='check'){
  if(mode==='new')return newCheck(ui);
  const {state,root}=ui;
  if(mode==='library'){
    root.innerHTML=css+'<section class="mk"><div class="mk-head"><div><h2>战法因子库</h2><p class="mk-sub">共 '+state.catalog.length+' 组战法条件、交易纪律与指数环境因子。</p></div>'+button('自动校验','new',true)+'</div><div class="mk-panel" data-catalog></div></section>';
    catalogView(find(root,'[data-catalog]'),state.catalog);
    find(root,'[data-mk=new]').onclick=()=>newCheck(ui);return;
  }
  const records=[...(state.checks||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
  root.innerHTML=css+'<section class="mk"><div class="mk-head"><div><h2>自动战法校验</h2><p class="mk-sub">从标的行情自动识别战法，回查各交易日的证据与风险。</p></div></div><div data-auto-check></div>'+
  '<section class="mk-panel mk-spaced"><div class="mk-head"><h3>历史校验记录</h3>'+button('导出 CSV','export')+'</div><div class="mk-row"><input aria-label="检索校验记录" placeholder="搜索标的、战法、题材" class="mk-search" style="max-width:280px"><span class="mk-sub" data-count></span></div><div class="table-wrap mk-scroll"><table class="mk-table"><thead><tr><th>校验日期</th><th>标的</th><th>匹配战法</th><th>周期</th><th>开仓提示</th><th>新增仓位</th><th></th></tr></thead><tbody></tbody></table></div></section><div data-detail></div></section>';
  let filtered=records;
  const table=find(root,'tbody');
  function draw(){
    const q=find(root,'.mk-search').value.trim();
    filtered=records.filter(r=>[r.date,r.code,r.name,r.strategy,r.theme].join(' ').includes(q));
    find(root,'[data-count]').textContent=filtered.length+' 条记录';
    table.innerHTML=filtered.length?filtered.map((r,i)=>'<tr><td>'+esc(r.date)+'</td><td><b>'+esc(r.name)+'</b> <span class="mk-sub">'+esc(r.code)+'</span></td><td>'+esc(r.strategy==='未判定'?'':r.strategy)+'</td><td>'+esc(r.emotion?.stage==='未判定'?'':r.emotion?.stage||'')+'</td><td><span class="tag">'+esc(r.status)+'</span></td><td>'+esc(r.position)+'%</td><td>'+button('详情',i)+'</td></tr>').join(''):'<tr><td colspan="7"><div class="mk-blank">暂无符合条件的校验记录</div></td></tr>';
  }
  table.onclick=e=>{
    const row=filtered[e.target.closest('button')?.dataset.mk];if(!row)return;
    const detail=find(root,'[data-detail]');detail.innerHTML='<section class="mk-panel mk-spaced"><div class="mk-head"><h3>'+esc(row.name)+' · '+esc(row.date)+'</h3>'+button('收起','close')+'</div>'+resultHTML(row)+recognitionHTML(row.recognition)+'<details><summary>校验当时认定的因子</summary><div class="mk-badges">'+(row.factors||[]).map(v=>'<span class="mk-pill">'+esc(v)+'</span>').join('')+'</div></details></section>';
    find(detail,'button').onclick=()=>detail.replaceChildren();
    detail.scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  find(root,'.mk-search').oninput=draw;
  newCheck(ui,find(root,'[data-auto-check]'),true);
  find(root,'[data-mk=export]').onclick=()=>exportRows(ui,filtered);
  draw();
}
