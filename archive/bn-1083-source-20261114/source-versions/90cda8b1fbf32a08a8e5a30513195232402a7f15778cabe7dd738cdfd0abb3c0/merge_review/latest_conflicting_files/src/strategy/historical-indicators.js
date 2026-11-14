'use strict';
// Pure historical bar indicators. Input bars oldest -> newest; no future leakage.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>finite(x)?+x.toFixed(4):null;
function ema(values,period){
 if(!Number.isInteger(period)||period<1)throw Error('invalid EMA period');
 let prev=null;return values.map(v=>{
  if(!finite(v)){prev=null;return null;}
  prev=prev===null?v:(2*v/(period+1))+(1-2/(period+1))*prev;
  return prev;
 });
}
function sma(values,period){
 if(!Number.isInteger(period)||period<1)throw Error('invalid SMA period');
 return values.map((v,i)=>{
  if(i+1<period)return null;
  const window=values.slice(i-period+1,i+1);
  return window.every(finite)?window.reduce((a,b)=>a+b,0)/period:null;
 });
}
function barsToIndicators(bars=[]){
 if(!Array.isArray(bars)||!bars.length)return {valid:false,reason:'无历史K线',bars:0};
 const clean=bars.map(b=>({open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)}));
 if(clean.some(b=>!Object.values(b).every(finite)||b.close<=0||b.open<=0||b.high<Math.max(b.open,b.close,b.low)||b.low<=0||b.low>Math.min(b.open,b.close)||b.volume<0))
  return {valid:false,reason:'K线字段无效',bars:bars.length};
 const closes=clean.map(b=>b.close),volumes=clean.map(b=>b.volume),last=closes.length-1;
 const ma5=sma(closes,5),ma10=sma(closes,10),ma20=sma(closes,20),vol5=sma(volumes,5);
 const fast=ema(closes,12),slow=ema(closes,26);
 const dif=fast.map((v,i)=>v-slow[i]),dea=ema(dif,9),hist=dif.map((v,i)=>2*(v-dea[i]));
 let gains=0,losses=0,rsi=null;
 if(last>=14){
  for(let i=last-13;i<=last;i++){const d=closes[i]-closes[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d);}
  rsi=losses===0?(gains===0?50:100):100-100/(1+gains/losses);
 }
 let k=50,d=50,j=null;
 for(let i=0;i<clean.length;i++){
  const w=clean.slice(Math.max(0,i-8),i+1);
  const high=Math.max(...w.map(x=>x.high)),low=Math.min(...w.map(x=>x.low));
  const rsv=high===low?50:(clean[i].close-low)/(high-low)*100;
  k=(2*k+rsv)/3;d=(2*d+k)/3;j=3*k-2*d;
 }
 const previous20=last>=20?closes.slice(last-20,last):[];
 const breakout=previous20.length===20&&closes[last]>Math.max(...previous20);
 const volumeRatio=last>=5&&vol5[last-1]>0?volumes[last]/vol5[last-1]:null;
 return {valid:true,bars:bars.length,close:round(closes[last]),ma5:round(ma5[last]),ma10:round(ma10[last]),ma20:round(ma20[last]),
  macd:{dif:round(dif[last]),dea:round(dea[last]),hist:round(hist[last])},rsi14:round(rsi),
  kdj:{k:round(k),d:round(d),j:round(j)},volumeRatio:round(volumeRatio),breakout20:breakout,
  ready:bars.length>=26};
}
module.exports={ema,sma,barsToIndicators};
