import fs from 'node:fs';
import {backtestAction} from '../../../public/nova/shortline/backtest.mjs';
import {auditTrade} from '../../../public/nova/shortline/learning.mjs';
import {structureDemo} from '../../../public/nova/shortline/structure.mjs';
import {autoValidate} from '../../../public/nova/shortline/market.mjs';
import {reviewAction} from '../../../public/nova/shortline/review.mjs';
import {chipHistory,mergePressureHistory} from '../../../public/nova/shortline/pressure.mjs';

const readTime=(day,time)=>Date.parse(day+'T'+time+':00+08:00');
const source='V6 合成教学场景';
export function seedDemo(state){
  if(state.scope!=='demo')throw Error('演示包只能载入独立演示库');
  if(state.demoVersion===1)return {reused:true};
  if(['bars','plans','checks','trades','notes'].some(k=>state[k].length))throw Error('演示库已有自建记录，可先导出并重置演示库');
  const csv=fs.readFileSync(new URL('../../../public/nova/shortline/sample-kline.csv',import.meta.url),'utf8');
  backtestAction(state,'k:import',{csv});
  const dayBars=state.bars.filter(b=>b.code==='000001');
  for(const [i,bar] of dayBars.entries()){
    const date=bar.date, knownAt=readTime(date,'15:00');
    const wave=i%12,upLimit=28+wave*4;
    const trend=bar.indexTrend;
    state.market.push({date,previousDay:dayBars[i-1]?.date,source,knownAt,availableAt:date+' 15:00',trend,sh:trend,cy:trend,
      upLimit,downLimit:20-wave,breakRate:35-wave,height:3+Math.floor(wave/3),leader:wave-3,diffusion:30+wave*4,
      adv:2200+wave*100,dec:2300-wave*100,amount:8900+100*wave,premium:wave/5,theme:'半导体',themeType:'主线',
      allAClose:Math.round(3600+45*Math.sin(i/6)+i),sampleSet:'test'});
  }
  for(const pool of structureDemo()){
    const market=state.market.find(m=>m.date===pool.date);
    if(market)market.structurePools=[pool];
  }
  for(const [i,b] of state.bars.entries()){
    b.sampleSet='test';b.source=source;
    // These synthetic observations are part of the dated teaching tape.
    b.knownAt=readTime(b.date,'15:00');b.availableAt=b.date+' 15:00';
    b.chipPeak=Math.round((b.open*.7+b.close*.3)*100)/100;
    if(i===31)b.blackSwan=true;
  }
  for(const [i,m] of state.market.entries()){
    const open=state.market[i-1]?.allAClose||m.allAClose;
    state.bars.push({role:'index',period:'日K',code:'000985',name:'教学全A基准',date:m.date,
      open,high:Math.max(open,m.allAClose)+3,low:Math.min(open,m.allAClose)-3,close:m.allAClose,volume:20000000+i*10000,
      sampleSet:'test',priceBasis:'unadjusted',volumeUnit:'shares',source,knownAt:m.knownAt,availableAt:m.availableAt});
  }
  for(let i=6;i+2<dayBars.length;i+=5){
    const b=dayBars[i],exit=dayBars[i+2],previous=dayBars[i-1];
    const good=exit.close>b.open,code=b.code,strategy='趋势突破战法';
    const check=autoValidate(state,{date:previous.date,code,name:b.name});
    Object.assign(check,{id:'demo-check-'+i,source,sampleSet:'test',createdAt:new Date(readTime(previous.date,'15:01')).toISOString()});
    state.checks.push(check);
    const plan={id:'demo-plan-'+i,code,name:b.name,strategy,factors:['温和放量','题材共振'],knownRiskFactors:[],checkId:check.id,
      labels:{cycle:check.emotion?.stage,volume:previous.indexVolume},trend:previous.indexTrend,entryMax:Math.round(previous.close*100)/100,
      maxPosition:5,stop:previous.close*.94,target:previous.close*1.08,sampleSet:'test',intendedDate:b.date,logic:'教学记录：按前一日收盘制定试错计划',
      frozenAt:new Date(readTime(previous.date,'15:05')).toISOString(),holdUntil:exit.date+'T14:00'};
    state.plans.push(plan);
    const trade={id:'demo-trade-'+i,planId:plan.id,checkId:check.id,sampleSet:'test',source,code,name:b.name,date:b.date,exitDate:exit.date,
      entryTime:b.date+'T09:30',exitTime:exit.date+'T15:00',entryPrice:b.open,exitPrice:exit.close,shares:1000,cost:8,
      position:i%2===0?10:5,strategy,strategies:[strategy],factors:plan.factors,knownRiskFactors:[],trend:previous.indexTrend,
      frozenLabels:{volume:previous.indexVolume},labels:{volume:previous.indexVolume},blackSwan:i===16,quality:i===16?'黑天鹅':'教学样本',
      repeatable:i!==16,planStatus:'已冻结',stopAction:'缺少记录',snapshotVerified:true,attribution:good?'题材共振':'板块分歧',
      pnlAmount:Math.round((exit.close-b.open)*100000)/100-8,exitReason:'教学样本到期离场',createdAt:new Date(readTime(exit.date,'15:01')).toISOString()};
    trade.pnl=Math.round(trade.pnlAmount/(b.open*1000)*10000)/100;
    trade.disciplineFacts=auditTrade(plan,trade);trade.violations=trade.disciplineFacts.filter(x=>x.status==='触发').map(x=>x.rule);trade.reviewable=true;
    state.trades.push(trade);
  }
  state.demoVersion=1;
  const date=dayBars.at(-1).date;
  const start=dayBars[1].date,end=dayBars[3].date;
  state.flatRecords=[{id:'demo-flat',start,end,benchmark:'000985',template:'没有模式内机会',reason:'教学区间内未出现预定形态',
    watch:'观察板块能否放量回流',reportedPnl:0,source,sampleSet:'test',createdAt:new Date(readTime(end,'15:10')).toISOString()}];
  const knownAt=readTime(date,'15:02'),code=dayBars[0].code;
  const chips=chipHistory(state.bars,code,date,knownAt);
  for(const chip of chips.slice(-10))mergePressureHistory(state,{code,day:chip.date,name:dayBars[0].name,knownAt:chip.knownAt,chipSeries:[chip]});
  mergePressureHistory(state,{code,day:date,name:dayBars[0].name,knownAt,facts:[{id:'demo-unlock',code,category:'解禁',source,
    description:'合成教学情景，7 月 28 日有 100 万股拟解禁',eventDay:'2025-07-28',sourceUpdatedAt:knownAt,knownAt,expires:'2025-07-28',
    verified:true,value:100,unit:'万股',riskTag:'已列入解禁日程',factorCode:'GG-05'}]});
  reviewAction(state,'review:generate',{date,period:'day',depth:'brief'});
  return {trades:state.trades.length,bars:state.bars.length,date};
}
