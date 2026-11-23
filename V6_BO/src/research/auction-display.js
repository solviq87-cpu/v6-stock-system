'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {requestResearchBytes}=require('../core/research-curl-bytes');
const {timestamp}=require('../core/public-market');
const {normalizeDay}=require('../core/limit-reason-evidence');
const symbol=code=>/^(?:60|68)\d{4}$/.test(code)?'sh'+code:/^(?:00|30)\d{4}$/.test(code)?'sz'+code:null;
const finitePositive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const number=s=>/^\d+(?:\.\d+)?$/.test(s)?Number(s):NaN;
const nameOk=s=>typeof s==='string'&&!!s.trim()&&s.trim().length<=32;
const cutoff=day=>Date.parse(day+'T09:25:00+08:00');
const wire=url=>requestResearchBytes(url,{timeoutMs:4500,processTimeoutMs:5500,maxBytes:256*1024});

// A transaction page contains a time but no date. Pair its opening print with
// the dated minute ledger (symbol, opening price, cumulative lots and yuan).
// A 09:30 minute on its own can never establish a 09:25 transaction.
function openingPrint(code,day,details,minute,knownAt){
  const id=symbol(code),source=minute?.data?.[id],at=cutoff(day);
  if(!id||minute?.code!==0||!Number.isSafeInteger(knownAt)||at>knownAt||
    String(source?.data?.date)!==day.replaceAll('-',''))return null;
  const quote=source.qt?.[id],first=source.data.data?.[0];
  if(!Array.isArray(quote)||quote[2]!==code||!nameOk(quote[1])||!/^0930 /.test(first))return null;
  let quoteAt;try{quoteAt=timestamp(quote[30]);}catch{return null;}
  if(quoteAt<at||quoteAt>knownAt||new Date(quoteAt+28800000).toISOString().slice(0,10)!==day)return null;
  const line=new RegExp('^\\s*v_detail_data_'+id+'=\\[0,"([^"]+)"\\];?\\s*$').exec(details);
  if(!line)return null;
  const [seq,time,px,,lots,yuan]=line[1].split('|',1)[0].split('/'),[minuteTime,opening,volume,amount]=first.split(/\s+/);
  const price=number(px),prev=number(quote[4]),size=number(lots),cash=number(yuan);
  if(seq!=='0'||time!=='09:25:00'||minuteTime!=='0930'||!finitePositive(prev)||!finitePositive(price)||
    !Number.isSafeInteger(size)||size<=0||!Number.isSafeInteger(cash)||cash<=0||price!==number(quote[5])||
    price!==number(opening)||size!==number(volume)||!finitePositive(number(amount))||
    Math.abs(cash-number(amount))>price*100||Math.abs(cash-size*100*price)>price*100)return null;
  return {code,name:quote[1].trim(),day,quoteAt:at,knownAt,price,openPct:Math.round((price/prev-1)*10000)/100,
    amountYuan:cash,lots:size,source:'腾讯逐笔成交与当日分时'};
}
async function fetchPrint(code,day){
  const id=symbol(code);
  if(!id)return null;
  const [detail,minute]=await Promise.all([wire('https://stock.gtimg.cn/data/index.php?appn=detail&action=data&c='+id+'&p=0'),
    wire('https://web.ifzq.gtimg.cn/appstock/app/minute/query?code='+id)]);
  return openingPrint(code,day,detail.raw.toString('ascii'),JSON.parse(minute.raw.toString('utf8')),Date.now());
}

function thsSeals(response,day,knownAt){
  const data=response?.data,at=cutoff(day);
  if(response?.status_code!==0||normalizeDay(data?.date)!==day||!Array.isArray(data.info)||at>knownAt)return [];
  return data.info.filter(r=>symbol(r.code)&&nameOk(r.name)&&[r.first_limit_up_time,r.last_limit_up_time].some(v=>/^\d{10}$/.test(v)&&Number(v)*1000===at))
    .map(r=>({code:r.code,name:r.name.trim(),day,quoteAt:at,knownAt,sealSource:'同花顺涨停聚焦'}));
}
async function fetchSeals(day){
  // Only positively identified 09:25 rows enter the sample. An unreturned
  // stock on this page cannot be counted as a failed auction signal.
  const url='https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?page=1&limit=100&field=199112,10,9001,330324,133971,133970,1968584,3475914,9002,330329&filter=HS,GEM2STAR&order_field=330324&order_type=0&date='+day.replaceAll('-','');
  const {raw}=await wire(url);
  const reply=JSON.parse(raw.toString('utf8')),at=Date.now();
  if(reply.status_code!==0||normalizeDay(reply.data?.date)!==day||!Array.isArray(reply.data.info))throw Error('竞价池交易日或响应无效');
  return thsSeals(reply,day,at);
}

function createAuctionDisplay({directory,canPersist=()=>true,clock=Date.now,readPrint=fetchPrint,readSeals=fetchSeals,readIndicative}={}){
  let state=null;
  function valid(r,day){
    const seal=['同花顺涨停聚焦','打板客连板梯队'].includes(r?.sealSource);
    const print=r?.source==='腾讯逐笔成交与当日分时'&&finitePositive(r.price)&&Number.isFinite(r.openPct)&&
      Number.isSafeInteger(r.amountYuan)&&r.amountYuan>0&&Number.isSafeInteger(r.lots)&&r.lots>0;
    return (seal||print)&&(!r.sealSource||seal)&&(!r.source||print)&&symbol(r.code)&&nameOk(r.name)&&r.day===day&&r.quoteAt===cutoff(day)&&
      Number.isSafeInteger(r.knownAt)&&r.quoteAt<=r.knownAt&&r.knownAt<=clock();
  }
  function update(s,rows){
    let changed=false;
    for(const row of rows||[]){
      if(!valid(row,s.day))continue;
      const old=s.rows.get(row.code);
      if(old&&(!row.sealSource||old.sealSource)&&(!row.source||old.source))continue;
      s.rows.set(row.code,{...old,...row,knownAt:Math.max(old?.knownAt||0,row.knownAt),
        ...(row.source?{printKnownAt:row.knownAt}:{}),...(row.sealSource?{sealKnownAt:row.knownAt}:{})});changed=true;
    }
    if(changed)s.dirty=true;
    if(s.dirty&&directory&&canPersist()&&clock()>=s.saveAfter){
      const file=path.join(directory,s.day+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
      try{fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(tmp,JSON.stringify([...s.rows.values()]),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);s.dirty=false;}
      catch{s.saveAfter=clock()+30000;console.error('[auction-display] 竞价记录暂存于内存');}finally{try{fs.unlinkSync(tmp);}catch{}}
    }
  }
  function sessionState(day){
    if(state?.day===day)return state;
    state={day,dirty:false,saveAfter:0,rows:new Map(),attempts:new Map(),indicative:new Map(),nextIndicative:0,nextSeal:0,sealBusy:false,printBusy:false,channels:{}};
    if(directory){
      try{const file=path.join(directory,day+'.json');
        if(fs.statSync(file).size<256*1024)for(const r of JSON.parse(fs.readFileSync(file,'utf8')))if(valid(r,day))state.rows.set(r.code,r);
      }catch{}
    }
    return state;
  }
  return function read({session,day,index,previousWatch,previousIndex,previousDay,network=true}){
    if(normalizeDay(day)!==day||!day)return null;
    const s=sessionState(day),now=clock(),at=cutoff(day);
    const live=session.trading&&normalizeDay(session.day)===day&&network;
    const seeds=new Map();
    if(index?.day===day&&index.knownAt>=at&&index.knownAt<=now){
      const seals=[];
      for(const tier of index.tiers||[])for(const r of tier.members||[]){
        if(!symbol(r.code)||!nameOk(r.name))continue;
        if(r.firstSeal==='09:25:00')seals.push({code:r.code,name:r.name,day,quoteAt:at,knownAt:index.knownAt,sealSource:'打板客连板梯队'});
        if(/^\d+进\d+$/.test(tier.name))seeds.set(r.code,r.name);
      }
      update(s,seals);
    }
    if(previousWatch?.day===previousDay&&previousDay<day&&previousWatch.knownAt<=now)
      for(const r of previousWatch.items||[])if(symbol(r.code))seeds.set(r.code,r.name);
    if(previousIndex?.day===previousDay&&previousDay<day&&previousIndex.knownAt<=now){
      for(const t of previousIndex.tiers||[])for(const r of t.members||[])
        if(r.status==='封住'&&symbol(r.code)&&nameOk(r.name))seeds.set(r.code,r.name);
    }
    if(live&&now<at&&readIndicative&&!s.indicativeBusy&&now>=s.nextIndicative&&seeds.size){
      const entries=[...seeds].slice(0,12),start=s.cursor||0;
      const batch=[entries[start%entries.length],...(entries.length>1?[entries[(start+1)%entries.length]]:[])];
      s.cursor=(start+batch.length)%entries.length;s.nextIndicative=now+5000;s.indicativeBusy=true;
      Promise.allSettled(batch.map(async ([code,name])=>{
        const q=await readIndicative(code,day),knownAt=clock();
        if(!nameOk(name)||q?.code&&q.code!==code||q?.tradeDate!==day||q.quoteSource!=='eastmoney-auction'||
          !finitePositive(q.preClose)||!Number.isSafeInteger(q.receivedAt)||q.receivedAt>knownAt||knownAt>=at)return;
        const bar=q.bars?.at(-1);
        if(!finitePositive(bar?.price)||!Number.isSafeInteger(bar.quoteAt)||bar.quoteAt<at-600000||bar.quoteAt>=at||
          bar.quoteAt>q.receivedAt||knownAt-bar.quoteAt>120000)return;
        s.indicative.set(code,{code,name,day,quoteAt:bar.quoteAt,knownAt,price:bar.price,
          openPct:Math.round((bar.price/q.preClose-1)*10000)/100,source:'东方财富竞价分时'});
      })).finally(()=>{s.indicativeBusy=false;});
    }
    if(live&&now>=at&&!s.sealBusy&&now>=s.nextSeal){
      s.sealBusy=true;s.nextSeal=now+(s.rows.size?300000:30000);
      Promise.resolve().then(()=>readSeals(day)).then(rows=>{
        update(s,rows);s.channels.ths={status:'observed',count:rows.length,checkedAt:clock()};
      }).catch(()=>{s.channels.ths={status:'unavailable',checkedAt:clock()};}).finally(()=>{s.sealBusy=false;});
    }
    if(live&&session.minute>=570&&!s.printBusy){
      const universe=[...new Set([...s.rows.values()].filter(r=>r.sealSource).map(r=>r.code).concat([...seeds.keys()].slice(0,24)))];
      const batch=universe.filter(c=>!s.rows.get(c)?.source&&now>=(s.attempts.get(c)||0)).slice(0,2);
      if(batch.length){
        s.printBusy=true;
        for(const code of batch)s.attempts.set(code,now+300000);
        Promise.allSettled(batch.map(c=>readPrint(c,day))).then(results=>{
          const rows=results.filter(v=>v.status==='fulfilled'&&v.value).map(v=>v.value);
          const failures=results.filter(v=>v.status==='rejected');
          const httpStatuses=[...new Set(failures.map(v=>v.reason?.response?.status).filter(n=>Number.isInteger(n)&&n>=400&&n<=599))];
          const status=failures.length===batch.length?'unavailable':failures.length?'partial':rows.length?'observed':'no-matched-print';
          update(s,rows);
          s.channels.print={status,count:rows.length,requested:batch.length,failed:failures.length,httpStatuses,checkedAt:clock()};
        }).finally(()=>{s.printBusy=false;});
      }
    }
    if(s.dirty)update(s,[]);
    const all=[...s.rows.values()];
    const items=all.filter(r=>r.sealSource||r.openPct>=2).sort((a,b)=>Number(!!b.sealSource)-Number(!!a.sealSource)||(b.openPct??-Infinity)-(a.openPct??-Infinity)||(b.amountYuan||0)-(a.amountYuan||0)||a.code.localeCompare(b.code));
    return {day,items,indicative:now<at?[...s.indicative.values()].filter(r=>now-r.quoteAt<=120000&&r.openPct>=2).sort((a,b)=>b.openPct-a.openPct):[],printCount:all.filter(r=>r.source).length,channels:{...s.channels},
      phase:now<at?'before-match':'matched',scope:'09:25 封板及昨日梯队高开观察',canTrade:false,canNotify:false};
  };
}
module.exports={openingPrint,thsSeals,createAuctionDisplay};
