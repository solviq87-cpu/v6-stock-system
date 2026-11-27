'use strict';

// Public research feeds. Preserve the supplier's instrument, date, raw units and
// actual receipt time. In particular a BK index is not interchangeable with a
// similarly named sector in another provider's taxonomy.
const {createHash} = require('node:crypto');
const {createResearchRequest, requestResearchBytes} = require('../core/research-curl-bytes');
const {assessDailyBarFinality} = require('../core/a-share-calendar');
const {assessDailyTurnoverBar} = require('../core/daily-turnover-sanity');

const EM = 'https://push2his.eastmoney.com/api/qt/stock/';
const TX = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TX_MINUTES = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline';
const SINA = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20series=/CN_MarketDataService.getKLineData';
const indices = {
  '1.000985': /^中证全指(?:指数)?$/,
  '1.000001': /^(上证指数|上证综指|上证综合指数)$/,
  '0.399001': /^(深证成指|深证成份指数|深证成指指数)$/,
  '0.399006': /^创业板指(?:数)?$/
};
const dateOK = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const minuteStamp = t => new Date(t + 8*3600000).toISOString().slice(0,16).replace('T',' ');
const url = (path, params) => path + '?' + new URLSearchParams(params);
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
function instrument(secid, name) {
  requireThat(typeof secid==='string' && /^(?:0|1|90)\.(?:\d{6}|BK\d{4})$/.test(secid),'不支持的证券代码与市场组合');
  const code = secid.split('.')[1];
  const role = Object.hasOwn(indices,secid) ? 'index' : /^90\.BK\d{4}$/.test(secid) ? 'sector' : 'stock';
  if (role === 'stock') requireThat(/^(?:1\.(?:600|601|603|605|688)\d{3}|0\.(?:000|001|002|003|300|301)\d{3}|0\.(?:43|83|87|88|92)\d{4})$/.test(secid), '不支持的证券代码与市场组合');
  if (role === 'sector') requireThat(typeof name === 'string' && name.trim() && name.length<=60, '板块缺少已知名称');
  const prefix = secid.startsWith('1.') ? 'sh' : /^(43|83|87|88|92)/.test(code) ? 'bj' : 'sz';
  return {secid,code,role,market:Number(secid.split('.')[0]),name,key:prefix+code};
}
function identityName(inst, rawName) {
  requireThat(typeof rawName === 'string' && rawName.trim() && rawName.length <= 80, '供应商未返回证券名称');
  const name = rawName.trim();
  if (inst.role === 'index') requireThat(indices[inst.secid].test(name), '供应商指数名称不符');
  if (inst.role === 'sector') requireThat(name === inst.name, '供应商板块名称不符');
  return name;
}
function emData(inst, raw) {
  const json=JSON.parse(raw), d=json.data;
  requireThat(json.rc===0 && d?.market===inst.market && d.code===inst.code, '东财市场或证券代码不符');
  return {name:identityName(inst,d.name),data:d};
}
function txData(inst, raw) {
  const json=JSON.parse(raw), d=json.data?.[inst.key], q=d?.qt?.[inst.key];
  requireThat(json.code===0 && Array.isArray(q) && q[2]===inst.code, '腾讯市场或证券代码不符');
  return {name:identityName(inst,q[1]),data:d};
}
const number = x => typeof x==='number' ? x : typeof x==='string' && /^\d+(?:\.\d+)?$/.test(x) ? Number(x) : NaN;
function exactVolume(value,multiplier){
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  requireThat(typeof text==='string'&&text.length<=64&&/^\d+(?:\.\d+)?$/.test(text),'行情成交量十进制无效');
  const [whole,fraction='']=text.split('.'),places=multiplier===100?2:0;
  requireThat(!/[^0]/.test(fraction.slice(places)),'行情成交量不能换算为整数');
  const result=BigInt(whole)*BigInt(multiplier)+(places?BigInt((fraction+'00').slice(0,places)):0n);
  requireThat(result<=BigInt(Number.MAX_SAFE_INTEGER),'行情成交量超出安全范围');
  return Number(result);
}
function bar(values, multiplier,hasAmount) {
  const [open,close,high,low,qty,amount] = values.map(number);
  const volume = exactVolume(values[4],multiplier);
  requireThat([open,close,high,low].every(n=>Number.isFinite(n)&&n>0) && high>=Math.max(open,close) &&
    low<=Math.min(open,close) && Number.isSafeInteger(volume) && volume>=0, '行情 OHLCV 数值或单位异常');
  if (hasAmount) requireThat(Number.isFinite(amount) && amount>=0,'成交额数值异常');
  return {open,high,low,close,volume,...(hasAmount?{amount}:{})};
}
function dailyRows(series,day,count,hasAmount) {
  requireThat(Array.isArray(series) && series.length<=1500,'日K序列缺失');
  const rows=[];
  for(const row of series) {
    requireThat(Array.isArray(row) && dateOK(row[0]),'供应商交易日期不合法');
    if(row[0]>day)continue;
    requireThat(!rows.length || rows.at(-1).date<row[0],'日K重复或乱序');
    rows.push({date:row[0],...bar(row.slice(1,hasAmount?7:6),1,hasAmount)});
  }
  requireThat(rows.length>=20 && rows.at(-1)?.date===day, '日K未覆盖指定交易日或均线窗口');
  return rows.slice(-count);
}
function emKline(inst,day,step,count) {
  const end=day.replaceAll('-','');
  return url(EM+'kline/get',{secid:inst.secid,klt:String(step),fqt:'0',end,lmt:String(count),
    ...(step===1?{beg:end}:{}),fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'});
}
function timeline(step) {
  const marks=[];
  for (const origin of [570,780])
    for (let m=origin+step;m<=origin+120;m+=step) marks.push(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
  return marks;
}
function compactMinute(t) {
  if(typeof t!=='string'||!/^\d{12}$/.test(t))return '';
  return t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)+' '+t.slice(8,10)+':'+t.slice(10,12);
}
function intradayRows(series,inst,day,step,provider,name) {
  requireThat(Array.isArray(series) && series.length<=1500,'分钟序列缺失');
  const rows=[], isStock=inst.role==='stock';
  // Tencent's STAR/BSE lot conversion is not independently established.
  if(provider==='tencent') requireThat(!/^688/.test(inst.code)&&!inst.key.startsWith('bj'),'该市场腾讯分时成交量单位未核实');
  const multiplier=isStock && provider!=='sina'?100:1;
  const hasAmount=provider!=='tencent';
  for(const row of series){
    requireThat(Array.isArray(row)&&typeof row[0]==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(row[0]),'无分钟结束时间');
    if(row[0].slice(0,10)!==day || row[0].slice(11)==='09:30')continue;
    const ohlcv=bar(row.slice(1,hasAmount?7:6),multiplier,hasAmount);
    if(isStock && hasAmount) requireThat(['in-range','no-trades'].includes(assessDailyTurnoverBar(ohlcv).status),'原始价与成交量/额单位不匹配');
    rows.push({date:row[0],...ohlcv});
  }
  const marks=timeline(step);
  requireThat(rows.length===marks.length && rows.every((r,i)=>r.date===day+' '+marks[i]),'缺少指定日期的完整交易时段或分钟间隔不符');
  return {rows,name,step};
}
function sinaRows(raw) {
  // Parse the observed bounded JSONP envelope as data; never evaluate JS.
  const match=/^(?:\/\*[^]*?\*\/\s*)?var\s+series\s*=\s*\(\s*(\[[^]*\])\s*\)\s*;?\s*$/.exec(raw);
  requireThat(match,'新浪分钟响应格式异常');
  const rows=JSON.parse(match[1]);
  requireThat(Array.isArray(rows) && rows.length<=1500,'新浪分钟序列异常');
  return rows.map(r=>[typeof r.day==='string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:00$/.test(r.day) ? r.day.slice(0,16) : r.day,r.open,r.close,r.high,r.low,r.volume,r.amount]);
}
function checkReference(ref,inst,day,rows,receivedAt,required) {
  // Sina returns request-bound rows with no instrument identity in the body.
  // An independently identified unadjusted daily bar corroborates its prices.
  if(!ref){ requireThat(!required,'新浪响应未带证券身份，缺少同日独立原始日K参照');return; }
  requireThat(ref.code===inst.code && ref.date===day && ref.priceBasis==='unadjusted' &&
    Number.isSafeInteger(ref.knownAt) && ref.knownAt<=receivedAt && ref.knownAt>=Date.parse(day+'T15:00:00+08:00') &&
    typeof ref.source==='string' && ref.source.trim() && (!required || !/sina|新浪/i.test(ref.source)) &&
    assessDailyBarFinality(day,{now:receivedAt,observedAt:ref.knownAt}).usable, '日K参照身份、复权口径或可用时点不符');
  const same=(a,b)=>Number.isFinite(b)&&Math.abs(a-b)<0.005001;
  requireThat(same(rows.at(-1).close,ref.close),'分时收盘与同日原始日K不符');
  if(required) requireThat(same(rows[0].open,ref.open) && same(Math.max(...rows.map(b=>b.high)),ref.high) &&
    same(Math.min(...rows.map(b=>b.low)),ref.low),'新浪分时与独立同日日K的开高低不符');
}
function createShortlineQuoteFallback({request=requestResearchBytes,clock=Date.now,requestGovernor}={}) {
  const send=createResearchRequest(request,requestResearchBytes,requestGovernor);
  let indexQuotes;
  function closingIndexQuotes(readClock){
    const at=readClock();
    if(!indexQuotes||at<indexQuotes.at||at-indexQuotes.at>=300000){
      const task=send('https://qt.gtimg.cn/q=sh000001,sz399001,sz399006,sh000985',{timeoutMs:10000,maxBytes:65536})
        .then(result=>new TextDecoder('gbk').decode(result.raw)).catch(error=>{indexQuotes=null;throw error;});
      indexQuotes={at,task};
    }
    return indexQuotes.task;
  }
  async function collect(inst,day,plans,kind,reference) {
    const attempts=[];
    const failure = () => ({rows:[],...(kind==='minutes'?{bars:[]}:{}),attempts,src:null,receivedAt:null});
    let high=0,clockInvalid=false;
    const readClock=()=>{try{const at=clock();requireThat(Number.isSafeInteger(at)&&at>0&&
      Number.isFinite(new Date(at+28800000).getTime())&&at>=high,'采集时钟无效或倒退');high=at;return at;}
      catch{clockInvalid=true;indexQuotes=null;throw Error('采集时钟无效或倒退');}};
    let start;try{start=readClock();}catch{return failure();}
    if(!assessDailyBarFinality(day,{observedAt:start,now:start}).usable)return failure();
    for(const {provider,target,parse,timeoutMs=4000} of plans) {
      const attempt={provider,requestUrl:target};
      attempts.push(attempt);
      try {
        readClock();
        const response=await send(target,{timeoutMs,processTimeoutMs:timeoutMs+1000,maxBytes:600000,beforeStart:()=>{readClock();return {};}});
        let receivedAt=readClock();const raw=response?.raw;
        requireThat(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=600000,'无有效响应或采集时刻');
        const rawHash=createHash('sha256').update(raw).digest('hex');
        Object.assign(attempt,{receivedAt,rawHash});
        requireThat((response.status===undefined||response.status===200)&&(response.ok===undefined||response.ok===true)&&
          response.redirected!==true&&response.type!=='opaqueredirect'&&(!response.url||response.url===target),'行情HTTP状态或最终地址异常');
        const text=raw.toString('utf8');
        requireThat(Buffer.from(text,'utf8').equals(raw),'行情原始响应不是有效UTF-8');
        const {name,rows,step}=await parse(text,readClock);
        const completed=readClock();
        if(provider==='sina-tencent'){attempt.rawReceivedAt=receivedAt;receivedAt=completed;attempt.receivedAt=receivedAt;}
        if(kind==='minutes' && inst.role==='stock')checkReference(reference,inst,day,rows,receivedAt,provider==='sina');
        const src='V6/'+provider, period=step?step+'m':'日K';
        const volumeUnit=inst.role==='stock'?'shares':provider+'-index-volume';
        Object.assign(attempt,{status:'observed',count:rows.length});
        const bars=kind==='minutes'?rows.map((r,i)=>({...r,code:inst.code,name,role:inst.role,period,secid:inst.secid,
          ...(inst.role==='sector'?{sector:name}:{}),availableAt:minuteStamp(receivedAt),knownAt:receivedAt,source:src,
          sessionOpen:i===0,sessionClose:i===rows.length-1,volumeUnit,priceBasis:'unadjusted',rawHash})):null;
        return {name,src,secid:inst.secid,priceBasis:'unadjusted',volumeUnit,receivedAt,rawHash,period,rows:bars||rows,...(bars?{bars}:{}),attempts};
      } catch(error) {
        attempt.status='unavailable';
        attempt.reason=error.code==='MARKET_RESTRICTED'?'供应商限流，遵循重试时间':error.response?.status?'行情网关 HTTP '+error.response.status:
          typeof error.code==='number'?'行情网络请求失败（'+error.code+'）':String(error.message||error).slice(0,180);
        if(clockInvalid)break;
      }
    }
    return failure();
  }
  function readIndex({secid,day,count=120,name}={}) {
    requireThat(dateOK(day),'请选择有效交易日期');
    const inst=instrument(secid,name);
    requireThat(inst.role!=='stock' && Number.isInteger(count) && count>=20 && count<=800,'指数日K请求无效');
    const plans=[];
    if(inst.role==='index')plans.push({provider:'tencent',target:url(TX,{param:[inst.key,'day','',day,count,''].join(',')}),
      parse(raw){const {name,data}=txData(inst,raw);return {name,rows:dailyRows(data.day,day,count,false)};}});
    plans.push({provider:'eastmoney',target:emKline(inst,day,101,count),
      parse(raw){const {name,data}=emData(inst,raw);return {name,rows:dailyRows(data.klines?.map(s=>s.split(',')),day,count,true)};}});
    if(inst.role==='index')plans.push({provider:'sina-tencent',timeoutMs:11000,target:url(SINA.replace('series=','_series='),{symbol:inst.key,scale:'240',ma:'no',datalen:String(count)}),
      async parse(raw,readClock){
        const packet=/\bvar _series=\((\[[\s\S]*\])\);?\s*$/.exec(raw);
        requireThat(packet,'新浪日K响应格式不符');
        const rows=dailyRows(JSON.parse(packet[1]).map(b=>[b.day,b.open,b.close,b.high,b.low,b.volume]),day,count,false);
        const response=await closingIndexQuotes(readClock);
        const fields=[...response.matchAll(/^v_([a-z]{2}\d{6})="([^"]+)";?\s*$/gm)].find(m=>m[1]===inst.key);
        requireThat(fields?.[1]===inst.key,'腾讯核对指数身份不符');
        const f=fields[2].split('~'),at=require('../core/public-market').timestamp(f[30]);
        requireThat(f[2]===inst.code&&at>=Date.parse(day+'T15:00:00+08:00')&&at<=readClock()&&
          new Date(at+28800000).toISOString().slice(0,10)===day&&Math.abs(number(f[3])-rows.at(-1).close)<0.0051&&
          Math.abs(number(f[4])-rows.at(-2).close)<0.0051,'两源指数收盘或前收不一致');
        return {name:identityName(inst,f[1]),rows};
      }});
    return collect(inst,day,plans,'daily');
  }
  function readIntraday({secid,day,name,reference}={}) {
    requireThat(dateOK(day),'请选择有效交易日期');
    const inst=instrument(secid,name);
    const em = (target,key)=>({provider:'eastmoney',target,
      parse(raw){const {name,data}=emData(inst,raw);return intradayRows(data[key]?.map(s=>s.split(',')),inst,day,1,'eastmoney',name);}});
    const plans=[em(url(EM+'trends2/get',{secid,fields1:'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11',
      fields2:'f51,f52,f53,f54,f55,f56,f57,f58',iscr:'0',ndays:'5'}),'trends')];
    const canUseTencent=inst.role!=='sector' && !inst.key.startsWith('bj') && !inst.code.startsWith('688');
    function tencentMinutes(step,count) {
      const field='m'+step;
      return {provider:'tencent',target:url(TX_MINUTES,{param:[inst.key,field,'',count].join(',')}),
        parse(raw){
          const {name,data}=txData(inst,raw);
          const series=data[field]?.map(r=>[compactMinute(r[0]),...r.slice(1,6)]);
          return intradayRows(series,inst,day,step,'tencent',name);
        }};
    }
    if(canUseTencent)plans.push(tencentMinutes(1,320));
    plans.push(em(emKline(inst,day,1,1000),'klines'));
    if(canUseTencent)plans.push(tencentMinutes(5,240));
    if(inst.role==='stock' && reference && !inst.key.startsWith('bj'))plans.push({provider:'sina',
      target:url(SINA,{symbol:inst.key,scale:'5',ma:'no',datalen:'240'}),parse(raw){
        return intradayRows(sinaRows(raw),inst,day,5,'sina',identityName(inst,reference.name));}});
    return collect(inst,day,plans,'minutes',reference);
  }
  return {readIndex,readIntraday};
}
module.exports={createShortlineQuoteFallback};
