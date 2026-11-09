/* Read-only public rule inspirations. No production selection/ranking/order writes.
 * Independent of the four deployed strategies; requires causal historical bars.
 * Sources are explanatory references, not claimed profitable A-share systems.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.V6PublicResearchRules=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const SRC={
    candles:'https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary',
    scans:'https://help.stockcharts.com/scanning-and-alerts/scan-writing-resource-center/scanning-case-studies/scanning-for-consolidation-and-breakouts',
    squeeze:'https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/bollinger-band-squeeze',
    technical:'https://www.fidelity.com/learning-center/trading-investing/technical-analysis/what-is-technical-analysis',
    examples:'https://help.stockcharts.com/scanning-and-alerts/scan-writing-resource-center/advanced-scan-library/predefined-scans'
  };
  const rules=Object.freeze([
    {id:'three-soldiers',name:'红三兵',type:'形态',direction:'观察偏多',minBars:9,source:SRC.candles,detail:'前段弱势后出现连续三根收盘逐步抬高、实体较强、收盘接近最高价的阳线'},
    {id:'three-crows',name:'三只乌鸦',type:'风险形态',direction:'风险警示',minBars:9,source:SRC.candles,detail:'前段上涨后出现三根连续实体较强、收盘靠近最低价的阴线；仅警示不选入看涨池'},
    {id:'bullish-engulfing',name:'看涨吞没',type:'反转',direction:'观察偏多',minBars:2,source:SRC.examples,detail:'前一根阴线之后阳线实体覆盖前一根实体，仍需趋势和成交量二次核对'},
    {id:'breakout-20-volume',name:'20日高点放量突破',type:'突破',direction:'观察偏多',minBars:21,source:SRC.scans,detail:'当日收盘突破此前20根K线最高价，成交量不少于此前20日均量的1.5倍'},
    {id:'ma-stack',name:'5/10/20日均线多头',type:'趋势',direction:'观察偏多',minBars:20,source:SRC.technical,detail:'收盘高于5日均线，5日均线高于10日均线且10日均线高于20日均线'},
    {id:'ma-golden-cross',name:'5日上穿20日均线',type:'趋势',direction:'观察偏多',minBars:21,source:SRC.technical,detail:'最新收盘时5日均线上穿20日均线，昨日仍未上穿'},
    {id:'rsi-rebound',name:'RSI14超卖区回升',type:'动量',direction:'观察偏多',minBars:30,source:SRC.technical,detail:'以Wilder平滑RSI14计算，从30及以下回升到30以上，最新收盘同步上涨'},
    {id:'bollinger-squeeze',name:'布林收口后向上突破',type:'波动率',direction:'观察偏多',minBars:82,source:SRC.squeeze,detail:'20日均线±2倍标准差；昨日带宽接近近60日极小值，本日向上越过上轨'},
    {id:'donchian-55',name:'55日价格通道突破',type:'趋势突破',direction:'观察偏多',minBars:56,source:SRC.scans,detail:'收盘突破此前55日最高价；属参数化研究样本，非任何来源的收益承诺'}
  ]);
  function shaDay(now){
    // Shanghai trading dates, not local/browser device timezone.
    return new Date(now+8*3600000).toISOString().slice(0,10);
  }
  function number(v){
    if(v===null||v===undefined||v===''||typeof v==='boolean')return null;
    const n=Number(v);return Number.isFinite(n)?n:null;
  }
  function normalize(rows,now=Date.now()){
    if(!Array.isArray(rows))return {ok:false,error:'未取得K线数组'};
    if(!Number.isFinite(now)||now<0)return {ok:false,error:'无效的研究时点'};
    if(rows.length>2000)return {ok:false,error:'历史数据量超过页面研究上限'};
    const lastDay=shaDay(now),barList=[],seen=new Set();
    for(const r of rows){
      const day=String(r?.date||r?.tradeDate||r?.day||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)return {ok:false,error:'缺少有效交易日期'};
      if(day>lastDay)return {ok:false,error:'包含未来日期K线，拒绝研究'};
      if(seen.has(day))return {ok:false,error:'K线交易日重复'};
      seen.add(day);
      const [open,high,low,close]=[r.open,r.high,r.low,r.close].map(number);
      if([open,high,low,close].some(v=>v===null||v<=0)||high<Math.max(open,low,close)||low>Math.min(open,high,close))return {ok:false,error:'K线OHLC价格不合法'};
      const volume=number(r.volume);
      if(volume!==null&&volume<0)return {ok:false,error:'负成交量不可用于研究'};
      barList.push({day,open,high,low,close,volume});
    }
    barList.sort((a,b)=>a.day.localeCompare(b.day));
    return {ok:true,bars:barList,asOf:barList.at(-1)?.day||null};
  }
  const avg=(list)=>list.reduce((s,v)=>s+v,0)/list.length;
  const sma=(a,k,i=a.length-1)=>i+1>=k?avg(a.slice(i-k+1,i+1).map(x=>x.close)):null;
  const bull=(b)=>b.close>b.open, bear=(b)=>b.close<b.open;
  const upperWick=(b)=>(b.high-Math.max(b.close,b.open))/Math.max(.000001,b.high-b.low);
  const lowerWick=(b)=>(Math.min(b.close,b.open)-b.low)/Math.max(.000001,b.high-b.low);
  const bodyRatio=(b)=>Math.abs(b.close-b.open)/Math.max(.000001,b.high-b.low);
  function rsi(a,period=14){
    if(a.length<period+2)return null;
    let gain=0,loss=0;for(let i=1;i<=period;i++){let d=a[i].close-a[i-1].close;gain+=Math.max(0,d);loss+=Math.max(0,-d)}
    gain/=period;loss/=period;
    const values=new Array(a.length).fill(null);
    const score=()=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);
    values[period]=score();
    for(let i=period+1;i<a.length;i++){const d=a[i].close-a[i-1].close;gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;values[i]=score()}
    return values;
  }
  function bandwidth(a,i){
    if(i<19)return null;
    const prices=a.slice(i-19,i+1).map(x=>x.close),mid=avg(prices);
    if(mid<=0)return null;
    const sd=Math.sqrt(avg(prices.map(x=>(x-mid)**2)));
    return {upper:mid+2*sd,width:4*sd/mid};
  }
  function check(id,b){
    const n=b.length,last=b[n-1],prev=b[n-2];
    switch(id){
      case 'three-soldiers':{
        const a=b.slice(-3),first=a[0],before=b[n-6];
        return before.close> b[n-4].close && a.every((x,i)=>bull(x)&&bodyRatio(x)>=.5&&upperWick(x)<=.25&&(i===0||(x.close>a[i-1].close&&x.open>=Math.min(a[i-1].open,a[i-1].close)&&x.open<=Math.max(a[i-1].open,a[i-1].close))));
      }
      case 'three-crows':{
        const a=b.slice(-3);
        return b[n-6].close<b[n-4].close&&a.every((x,i)=>bear(x)&&bodyRatio(x)>=.5&&lowerWick(x)<=.25&&(i===0||(x.close<a[i-1].close&&x.open>=Math.min(a[i-1].open,a[i-1].close)&&x.open<=Math.max(a[i-1].open,a[i-1].close))));
      }
      case 'bullish-engulfing':
        return bear(prev)&&bull(last)&&last.open<=prev.close&&last.close>=prev.open;
      case 'breakout-20-volume':{
        const past=b.slice(-21,-1),av=avg(past.map(x=>x.volume??NaN));
        return Number.isFinite(av)&&av>0&&last.volume!==null&&last.close>Math.max(...past.map(x=>x.high))&&last.volume>=av*1.5;
      }
      case 'ma-stack':
        return last.close>sma(b,5)&&sma(b,5)>sma(b,10)&&sma(b,10)>sma(b,20);
      case 'ma-golden-cross':
        return sma(b,5)>sma(b,20)&&sma(b,5,n-2)<=sma(b,20,n-2);
      case 'rsi-rebound':{
        const values=rsi(b);return values[n-2]!==null&&values[n-2]<=30&&values[n-1]>30&&last.close>prev.close;
      }
      case 'bollinger-squeeze':{
        const latest=bandwidth(b,n-1),before=bandwidth(b,n-2);
        const widths=[];for(let i=n-61;i<=n-3;i++){const band=bandwidth(b,i);if(band)widths.push(band.width)}
        return !!latest&&!!before&&widths.length>=50&&before.width<=Math.min(...widths)*1.2&&prev.close<=before.upper&&last.close>latest.upper;
      }
      case 'donchian-55':
        return last.close>Math.max(...b.slice(-56,-1).map(x=>x.high));
      default:return false;
    }
  }
  function evaluate(raw,now=Date.now()){
    const result=normalize(raw,now);
    return {...result,items:rules.map(rule=>{
      if(!result.ok)return {...rule,status:'unavailable',reason:result.error};
      if(result.bars.length<rule.minBars)return {...rule,status:'insufficient',reason:'需要至少'+rule.minBars+'根有效历史K线'};
      try{return {...rule,status:check(rule.id,result.bars)?'matched':'not-matched',reason:'研究匹配仅基于最后一根已确认日K；不代表买入或收益预测'};}
      catch{return {...rule,status:'unavailable',reason:'输入证据不足或指标计算失败'};}
    })};
  }
  return Object.freeze({rules,evaluate,normalize});
});
