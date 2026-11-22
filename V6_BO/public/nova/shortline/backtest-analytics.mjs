// Analysis consumes frozen signals and matured outcomes only. No chart or
// cost assumption feeds recognition, cooldown, matching or model promotion.
import {sampleMatches,isTestSample} from './sample-quality.mjs';
const windows=new Set([1,2,3,5,10]);
const finite=Number.isFinite;
const mean=a=>a.length?a.reduce((sum,n)=>sum+n,0)/a.length:null;
const reasons=new Set(['受限观察','兑现信号']);
const bands=[
  [-Infinity,-10,'低于 −10%'],[-10,-5,'−10% 至 −5%'],[-5,0,'−5% 至 0%'],
  [0,5,'0% 至 5%'],[5,10,'5% 至 10%'],[10,Infinity,'10% 及以上']
];
export const scopeOptions=[['all','全部样本'],['standard','标准样本'],['blackSwan','仅黑天鹅'],['extreme','仅极端行情'],
  ['excludeBlackSwan','排除黑天鹅'],['excludeExtreme','排除极端行情']];
function keys(s){
  return [...(s.strategies||[s.strategy]).filter(Boolean).map(n=>'战法 · '+n),...(s.analysisFactors||s.factors||[]).map(n=>'因子 · '+n)];
}
export function analysisSelectors(rows){return [...new Set(rows.flatMap(keys))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function studyCohort(signals,{selector='',start='',end,asOf=end,horizon=5,quality='all',sampleSet='all'}){
  if(!end || !windows.has(horizon)||!asOf||start>end)return [];
  const cutoff=asOf.length===10?asOf+' 23:59':asOf;
  const selected=[];
  for(const s of signals){
    const day=s.date.slice(0,10),decision=s.decisionAt||(s.date.length===10?s.date+' 15:00':s.date);
    if(day<start||day>end||decision>cutoff||decision.slice(0,10)>end||reasons.has(s.type)||selector&&!keys(s).includes(selector))continue;
    const o=s.outcomes?.[horizon];
    if(!finite(o?.close)||o.end>end||!o.availableAt||o.availableAt>cutoff||!o.entry||o.entry<=decision.slice(0,10))continue;
    const flags={blackSwan:s.blackSwan||o.blackSwan,extreme:s.extreme||o.extreme,sampleSet:isTestSample(s)||isTestSample(o)?'test':'real'};
    if(!sampleMatches(flags,quality)||sampleSet!=='all'&&sampleSet!==flags.sampleSet)continue;
    selected.push({id:s.id,code:s.code,decision,entry:o.entry,exit:o.end,gross:o.close});
  }
  return selected;
}
function netAfterCost(gross,costBps,slipBps){
  // costBps is the assumed ROUND-TRIP fee in basis points. Slippage is
  // per side. Both are charged against the respective entry/exit notionals.
  if(costBps===0&&slipBps===0)return gross;
  const fee=costBps/20000,slip=slipBps/10000;
  return ((1+gross/100)*(1-fee)*(1-slip)/((1+fee)*(1+slip))-1)*100;
}
export function returnStudy(signals,options){
  const {costBps=12,slipBps=5}=options;
  if(![costBps,slipBps].every(x=>finite(x)&&x>=0&&x<=1000))throw Error('费用与滑点需为 0 至 1000 个基点');
  const cohort=studyCohort(signals,options).sort((a,b)=>a.entry.localeCompare(b.entry)||a.decision.localeCompare(b.decision)||a.code.localeCompare(b.code)||a.id.localeCompare(b.id));
  const returns=[],bins=bands.map(([,,label])=>({label,n:0}));
  let settled=0,funds=1,peak=1,maxDrawdown=0,free='',wins=0;
  for(const r of cohort){
    const net=netAfterCost(r.gross,costBps,slipBps);returns.push(net);
    if(net>1e-10)wins++;
    const bucket=bands.findIndex(([lo,hi])=>net>=lo&&net<hi);
    bins[bucket].n++;
    // Single-slot research equity: entries at the open cannot use funds
    // released at the close of that same session. Ties are deterministic.
    if(r.entry<=free)continue;
    funds*=1+net/100;peak=Math.max(peak,funds);maxDrawdown=Math.max(maxDrawdown,100*(1-funds/peak));
    free=r.exit;settled++;
  }
  const gross=mean(cohort.map(r=>r.gross)),net=mean(returns),n=cohort.length;
  return {n,settled,gross,net,friction:n?gross-net:null,winRate:n?100*wins/n:null,
    totalReturn:settled?(funds-1)*100:null,maxDrawdown:settled?maxDrawdown:null,bins,costBps,slipBps};
}
export function stressStudies(signals,options,selectors){
  const selected=[...new Set(selectors)];
  const baseCost=options.costBps??12,baseSlip=options.slipBps??5;
  const groups=new Map(selected.map(name=>[name,[]]));
  for(const s of signals){
    if(groups.has(''))groups.get('').push(s);
    for(const name of new Set(keys(s)))if(groups.has(name))groups.get(name).push(s);
  }
  return selected.flatMap(selector=>[1,2,3].map(multiplier=>({selector,multiplier,
    ...returnStudy(groups.get(selector),{...options,selector:'',costBps:Math.min(baseCost*multiplier,1000),slipBps:Math.min(baseSlip*multiplier,1000)})})));
}
