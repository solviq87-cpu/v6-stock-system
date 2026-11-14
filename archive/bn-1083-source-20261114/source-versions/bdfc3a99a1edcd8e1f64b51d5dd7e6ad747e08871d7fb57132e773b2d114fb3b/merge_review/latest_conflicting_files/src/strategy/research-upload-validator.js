 'use strict';
const codeOk=c=>typeof c==='string'&&/^\d{6}$/.test(c);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function validDate(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
 const t=Date.parse(d+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d;}
function validateUpload(b,{maxStocks=100,maxBars=500}={}){
 if(!b||!Array.isArray(b.stocks)||!b.stocks.length||b.stocks.length>maxStocks)return '股票池须包含1至100只股票';
 const seen=new Set();
 for(const s of b.stocks){
  if(!s||!Array.isArray(s.bars)||s.bars.length<27||s.bars.length>maxBars)return '每只股票须有27至500根K线';
  const code=s.symbol||s.code;
  if(!codeOk(code)||seen.has(code))return '股票代码须为唯一六位数字';seen.add(code);
  if(!s.feed||!['imported','simulated'].includes(s.feed.source))return '上传数据只能声明imported或simulated';
  if(!finite(s.feed.timestamp)||s.feed.timestamp<0||s.feed.timestamp>Date.now()+300000)return '行情时间戳非法或来自未来';
  let prevDate=null,dated=null;
  for(const x of s.bars){
   if(!x||![x.open,x.high,x.low,x.close,x.volume].every(finite)||x.low<=0||x.open<=0||x.close<=0||x.high<=0||x.volume<0||
     x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close)||x.high<x.low)return '上传数据包含无效OHLCV';
   const hasDate=x.date!==undefined&&x.date!==null;
   if(dated!==null&&dated!==hasDate)return 'K线日期字段必须全有或全无';dated=hasDate;
   if(hasDate){if(!validDate(x.date)||prevDate!==null&&x.date<=prevDate)return '历史K线日期无效、重复或倒序';prevDate=x.date;}
  }
 }
 return null;
}
module.exports={validateUpload,validDate};
