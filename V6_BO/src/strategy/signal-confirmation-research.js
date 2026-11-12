'use strict';

const {ema,sma}=require('./historical-indicators');
const chartSchool='https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators';
const catalog=Object.freeze([
  {id:'sma15_30_aroon25',label:'15/30日均线金叉＋Aroon趋势确认',family:'trend-confirmation',
    source:'https://github.com/QuantConnect/Lean/blob/master/Algorithm.CSharp/MovingAverageCrossAlgorithm.cs',
    confirmationSource:chartSchool+'/aroon-oscillator'},
  {id:'macd12_26_9_sma30',label:'MACD金叉＋30日均线趋势确认',family:'trend-confirmation',
    source:chartSchool+'/macd-moving-average-convergence-divergence-oscillator'}
].map(rule=>Object.freeze(rule)));

function aroon25(bars){
  const window=bars.slice(-26);
  let highIndex=0;
  let lowIndex=0;
  for(let index=1;index<window.length;index++){
    if(window[index].high>=window[highIndex].high)highIndex=index;
    if(window[index].low<=window[lowIndex].low)lowIndex=index;
  }
  return 100*(highIndex-lowIndex)/25;
}

function evaluateSignalConfirmation(stock){
  const bars=stock.bars;
  const stop=(status,reason)=>catalog.map(rule=>({...rule,status,reasons:[reason],metrics:{}}));
  if(!Array.isArray(bars)||bars.length<40)
    return stop('insufficient_data','至少需要40根已完成日线');
  const last=bars.at(-1);
  if(bars.some(bar=>bar.complete===false))
    return stop('insufficient_data','日线含未收盘记录');
  if([stock,last].some(row=>row.isST===true||row.suspended===true||
     row.isDelisting===true||row.noPriceLimit===true||row.ipoNoLimit===true||
     row.tradable===false)||last.volume===0)
    return stop('risk_blocked','停牌、ST、退市、无涨跌停限制或零成交');
  // The forward audit validates OHLCV and dates before passing a signal-day prefix.
  const closes=bars.map(bar=>bar.close);
  const sma15=sma(closes,15);
  const sma30=sma(closes,30);
  const fast=ema(closes,12);
  const slow=ema(closes,26);
  const macd=fast.map((value,index)=>value-slow[index]);
  const signal=ema(macd,9);
  const oscillator=aroon25(bars);
  const checks=[
    {metrics:{sma15:sma15.at(-1),sma30:sma30.at(-1),aroon25:oscillator},
      conditions:[
        ['15日均线上穿30日均线',sma15.at(-2)<=sma30.at(-2)&&sma15.at(-1)>sma30.at(-1)],
        ['Aroon25振荡值大于零',oscillator>0]
      ]},
    {metrics:{macd:macd.at(-1),signal:signal.at(-1),sma30:sma30.at(-1)},
      conditions:[
        ['MACD上穿信号线',macd.at(-2)<=signal.at(-2)&&macd.at(-1)>signal.at(-1)],
        ['收盘高于上行的30日均线',last.close>sma30.at(-1)&&sma30.at(-1)>sma30.at(-2)]
      ]}
  ];
  return catalog.map((rule,index)=>{
    const {conditions,metrics}=checks[index];
    return {...rule,metrics,status:conditions.every(([,pass])=>pass)?'candidate':'not_matched',
      reasons:conditions.map(([label,pass])=>(pass?'通过：':'未通过：')+label)};
  });
}

module.exports={catalog,evaluateSignalConfirmation};
