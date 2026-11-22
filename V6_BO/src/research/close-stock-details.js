'use strict';
const {requestResearchBytes}=require('../core/research-curl-bytes');
const {fetchResearchHistory}=require('./public-history-fallback');
const {reviewFlags}=require('../../analysis');

function numeric(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
}
async function fetchCloseFlow(code,day,{request=requestResearchBytes,clock=Date.now}={}){
 if(!/^\d{6}$/.test(code)||!/^\d{4}-\d\d-\d\d$/.test(day)||!(Date.parse(day+'T15:00:00+08:00')<=clock()))return null;
 const exchange=/^6/.test(code)?'1':'0';
 const east='https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid='+exchange+'.'+code+'&lmt=12&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65&ut=b2884a393a59ad64002292a3e90d46a5';
 const sina='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs?daima='+(exchange==='1'?'sh':'sz')+code+'&page=1&num=6&sort=opendate&asc=0';
 // The two vendors use different order-size classifications. Preserve the
 // provider with the value so their measures cannot be added or averaged.
 for(const [url,provider] of [[east,'东方财富主力净流入'],[sina,'新浪主力净流入（超大单口径）']]){
  try{
   const {raw}=await request(url,{timeoutMs:6500,maxBytes:256*1024});
   const data=JSON.parse(raw.toString('utf8'));let matched=[];
   if(url===east){
    if(data.rc!==0||data.data?.code!==code||String(data.data.market)!==exchange||!Array.isArray(data.data.klines))continue;
    matched=data.data.klines.map(s=>String(s).split(',')).filter(r=>r.length===15&&r[0]===day).map(r=>numeric(r[1]));
   }else if(Array.isArray(data)){
    matched=data.filter(r=>r?.opendate===day&&(!r.daima||r.daima===(exchange==='1'?'sh':'sz')+code)).map(r=>numeric(r.r0_net));
   }
   if(matched.length===1&&matched[0]!==null)return {code,day,mainInflow:matched[0],flowSource:provider,flowKnownAt:clock()};
  }catch{/* Retry the independent domestic source. */}
 }
 return null;
}
async function fetchCloseFlags(code,day,{history=fetchResearchHistory,clock=Date.now}={}){
 const cutoff=Date.parse(day+'T15:10:00+08:00');
 if(!Number.isFinite(cutoff)||clock()<cutoff)return null;
 const result=await history({symbol:code,historyDays:30,provider:'auto'}),stock=result?.stock;
 if(result?.status!=='observed-unverified'||result.priceBasis!=='unadjusted'||stock?.symbol!==code||!Array.isArray(stock?.bars)||
   !Number.isSafeInteger(result.retrievedAt)||result.retrievedAt<cutoff||result.retrievedAt>clock())return null;
 const bars=stock.bars.filter(b=>b.date<=day&&Number.isSafeInteger(b.knownAt)&&b.knownAt<=result.retrievedAt);
 if(bars.at(-1)?.date!==day||bars.some((b,i)=>i>0&&b.date<=bars[i-1].date||!Number.isFinite(b.close)||b.close<=0||!Number.isFinite(b.high)||b.high<b.close))return null;
 const flags=reviewFlags(bars,bars.at(-1).close);
 return flags?{code,day,aboveMa5:flags.aboveMa5,breakHigh:flags.brokeHighHold,barSource:stock.provider,barKnownAt:result.retrievedAt}:null;
}
module.exports={fetchCloseFlow,fetchCloseFlags};
