'use strict';
/** Public A-share DAILY history adapter. No exchange-grade verification claim.
 * Unlike filling missing suspension days synthetically, fail closed on mismatched calendars. */
const crypto=require('node:crypto');
const {validateImport}=require('./market-data-center');
const {aShareCalendarDate}=require('./a-share-calendar');
const ENDPOINT='https://push2his.eastmoney.com/api/qt/stock/kline/get';
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validDate=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;
};
function secId(symbol){
 if(typeof symbol!=='string'||!/^(?:0[0-9]{5}|3[0-9]{5}|6[0-9]{5})$/.test(symbol))throw Error('只支持有效的沪深A股6位代码，不臆测北交所市场映射');
 return (symbol.startsWith('6')?'1.':'0.')+symbol;
}
function parseKlines(payload,expected){
 const d=payload?.data;
 if(!d||String(d.code)!==expected||!Array.isArray(d.klines)||d.klines.length<32||d.klines.length>10000)throw Error('公开日K线结构或返回代码不一致: '+expected);
 const seen=new Set();const bars=[];
 for(const row of d.klines){
  if(typeof row!=='string')throw Error('公开日K线必须是逗号分隔文本');
  // Eastmoney f56 is quoted in hands (100 shares per hand), whereas V6's
  // absolute liquidity / participation controls use shares. f57 is CNY
  // turnover on the actual tape, NOT a forward-adjusted monetary figure.
  const cells=row.split(',');if(cells.length<7)throw Error('公开日K线缺失OHLCV或成交额字段');
  const [date,open,close,high,low,volumeHands,amountYuan]=cells;
  if(!validDate(date)||seen.has(date))throw Error('公开日K线日期无效或重复');seen.add(date);
  if([open,close,high,low,volumeHands,amountYuan].some(x=>x.trim()===''))
   throw Error('公开日K线OHLCV或成交额缺失: '+expected);
  const shares=Number(volumeHands)*100;
  const b={date,open:Number(open),high:Number(high),low:Number(low),close:Number(close),
   volume:shares,amount:Number(amountYuan)};
  if(!Object.values(b).slice(1).every(x=>Number.isFinite(x))||
     !Number.isSafeInteger(shares)||b.open<=0||b.close<=0||
     b.high<Math.max(b.open,b.close,b.low)||b.low<=0||
     b.low>Math.min(b.open,b.close)||b.volume<0||b.amount<0||
     ((b.volume===0)!==(b.amount===0)))
   throw Error('公开日K线OHLCV或成交额异常: '+expected);
  bars.push(b);
 }
 for(let i=1;i<bars.length;i++)if(bars[i].date<=bars[i-1].date)throw Error('公开日K线日期无序: '+expected);
 return {code:expected,name:String(d.name||expected).slice(0,80),market:expected.startsWith('3')?'chinext':expected.startsWith('68')?'star':'main',bars};
}
async function boundedJson(response,maxBytes){
 if(!response?.ok)throw Error('公开日K线HTTP '+(response?.status??'无响应'));
 const ct=response.headers?.get?.('content-type');if(ct&&!/^(?:application\/(?:json|[\w.+-]+\+json)|text\/plain)(?:\s*;|\s*$)/i.test(ct))throw Error('公开K线响应类型非JSON');
 let bytes;
 if(response.body&&typeof response.body[Symbol.asyncIterator]==='function'){
  const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes)throw Error('公开K线响应超过大小限制');chunks.push(chunk);}bytes=Buffer.concat(chunks);
 }else{const s=await response.text();bytes=Buffer.from(s);if(bytes.length>maxBytes)throw Error('公开K线响应超过大小限制');}
 try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error('公开K线响应不是合法JSON');}
}
async function fetchEastmoneyHistory({symbols,start,end,fetchImpl=globalThis.fetch,timeoutMs=10000,maxBytes=2*1024*1024,now=Date.now(),priceAdjustment='qfq'}={}){
 if(!Array.isArray(symbols)||symbols.length<1||symbols.length>100||new Set(symbols).size!==symbols.length)throw Error('沪深A股股票池需要1到100只互异代码');
 for(const s of symbols)secId(s);
 if(!['qfq','unadjusted'].includes(priceAdjustment))throw Error('历史复权要求明确 qfq 或 unadjusted');
 if(!validDate(start)||!validDate(end)||start>=end||end>aShareCalendarDate(now))throw Error('历史行情起止日期无效或位于未来');
 if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>8*1024*1024)throw Error('历史接口请求参数无效');
 const stocks=[];
 for(const symbol of symbols){
  const url=new URL(ENDPOINT);
  for(const [k,v] of Object.entries({secid:secId(symbol),fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57',klt:'101',fqt:priceAdjustment==='qfq'?'1':'0',beg:start.replaceAll('-',''),end:end.replaceAll('-',''),lmt:'10000'}))url.searchParams.set(k,v);
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  let payload;
  try{payload=await boundedJson(await fetchImpl(url.toString(),{method:'GET',redirect:'error',signal:ctrl.signal,headers:{Accept:'application/json'}}),maxBytes);}
  finally{clearTimeout(timer);}
  const parsed=parseKlines(payload,symbol);
  if(parsed.bars[0].date<start||parsed.bars.at(-1).date>end)throw Error('公开行情返回了请求日期区间之外的K线');
  stocks.push(parsed);
 }
 const last=stocks[0].bars.at(-1).date;
 // Explicitly reject nonaligned sessions. Filling suspended bars with invented price is forbidden.
 if(stocks.some(s=>s.bars.at(-1).date!==last||s.bars.length!==stocks[0].bars.length||s.bars.some((b,i)=>b.date!==stocks[0].bars[i].date)))throw Error('沪深股票停牌或缺失K线导致交易日不一致，拒绝虚构补齐');
 // v2 reflects a BREAKING unit correction: never silently rewrite a v1 import.
 const provider='eastmoney-public-history',datasetId='em-'+priceAdjustment+'-v2-'+sha({symbols,start,end,last,priceAdjustment}).slice(0,20);
 const dataset={source:'imported',provider,datasetId,asOf:last,
  volumeUnit:'shares',amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover',
  priceAdjustment:{mode:priceAdjustment,provider:'eastmoney-public-history-fqt-'+(priceAdjustment==='qfq'?'1':'0')},stocks};
 validateImport(dataset,{provider,datasetId});
 return {dataset,metadata:{mode:'unverified-public-daily-history',provider,datasetId,asOf:last,stockCount:stocks.length,priceAdjustment,volumeUnit:'shares',amountUnit:'CNY',
  amountBasis:'actual-unadjusted-turnover',verifiedLive:false,canTrade:false,
  warning:'公开接口可能调整、返回延迟或不完整行情。未核验交易所官方记录、公司行为、复权正确性及数据使用授权。f56按手转股，f57按人民币元保留原成交额；前复权价不得与原始成交额直接反算均价。不能直接用于实盘。'}};
}
module.exports={fetchEastmoneyHistory,parseKlines,secId};
