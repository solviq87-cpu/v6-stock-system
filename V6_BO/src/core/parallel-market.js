'use strict';
// Operator-authorized gateways normalize vendor payloads; no guessed private APIs.
const fs=require('node:fs'),{validateSourceUrl}=require('./market-data-center');
const IDS=['ifind','choice','sina'],finite=x=>typeof x==='number'&&Number.isFinite(x);
function validateSnapshot(x,id,now){
 if(!x||x.schemaVersion!==1||x.provider!==id||!finite(x.observedAt)||x.observedAt>now||now-x.observedAt>15000||!Array.isArray(x.quotes)||!x.quotes.length||x.quotes.length>100)throw Error('来源、时效或记录数无效');
 const seen=new Set();const quotes=x.quotes.map(q=>{if(!q||!['SH','SZ'].includes(q.exchange)||!/^\d{6}$/.test(q.code)||q.currency!=='CNY'||q.adjustment!=='unadjusted'||q.volumeUnit!=='share'||!['normal','halted'].includes(q.status)||!finite(q.timestamp)||q.timestamp>x.observedAt||now-q.timestamp>15000||!finite(q.price)||q.price<=0||!finite(q.previousClose)||q.previousClose<=0||!finite(q.volume)||q.volume<0)throw Error('报价口径、时间或数值无效');const key=q.exchange+q.code;if(seen.has(key))throw Error('重复证券');seen.add(key);return {exchange:q.exchange,code:q.code,currency:'CNY',adjustment:'unadjusted',volumeUnit:'share',status:q.status,timestamp:q.timestamp,price:q.price,previousClose:q.previousClose,volume:q.volume};});
 return {schemaVersion:1,provider:id,observedAt:x.observedAt,quotes};
}
function analyze(sources,now){
 const symbols=new Set(sources.flatMap(s=>s.snapshot?.quotes.map(q=>q.exchange+q.code)||[]));
 return [...symbols].sort().map(symbol=>{const observations=sources.flatMap(s=>{const q=s.snapshot?.quotes.find(q=>q.exchange+q.code===symbol);return q?[{provider:s.id,...q,pct:(q.price/q.previousClose-1)*100}]:[];});let status='insufficient';
 if(observations.length===3){const times=observations.map(q=>q.timestamp),prices=observations.map(q=>q.price),prev=observations.map(q=>q.previousClose);status=observations.some(q=>q.status!=='normal')?'halted':Math.max(...times)-Math.min(...times)>5000?'time-mismatch':((Math.max(...prices)-Math.min(...prices))/Math.min(...prices)*10000>10||(Math.max(...prev)-Math.min(...prev))/Math.min(...prev)*10000>10)?'conflict':'consistent';}
 return {symbol,status,observations,analysis:status==='consistent'?'三路时点与价格在预设容差内；不等于来源认证或买入建议':'证据不完整或不一致，不生成综合方向',canTrade:false};});
}
function createParallelMarket({sources,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=5000}={}){
 if(!Array.isArray(sources)||sources.length!==3||new Set(sources.map(s=>s?.id)).size!==3||sources.some(s=>!IDS.includes(s?.id))||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw Error('须配置ifind、choice、sina三路及有效超时');
 const entries=sources.map(s=>({id:s.id,url:validateSourceUrl(s.url),tokenEnv:s.tokenEnv}));
 if(new Set(entries.map(s=>s.url)).size!==3)throw Error('三路地址必须独立');
 for(const e of entries)if(e.tokenEnv!==undefined&&!/^[A-Z][A-Z0-9_]{0,79}$/.test(e.tokenEnv))throw Error('凭证环境变量名无效');
 let busy=false;
 async function sync(){if(busy)return {busy:true,canTrade:false};busy=true;try{
 const results=await Promise.all(entries.map(async e=>{let timer;const controller=new AbortController();try{
 const work=(async()=>{const headers={Accept:'application/json'};if(e.tokenEnv){const token=process.env[e.tokenEnv];if(!token)throw Error('missing');headers.Authorization='Bearer '+token;}
 const r=await fetchImpl(e.url,{signal:controller.signal,redirect:'error',headers});if(!r.ok)throw Error('http');if(!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||''))throw Error('type');let size=0,parts=[];for await(const chunk of r.body){size+=chunk.length;if(size>1024*1024)throw Error('size');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString());})();
 const raw=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);})]);return {id:e.id,status:'ok',snapshot:validateSnapshot(raw,e.id,clock())};
 }catch{return {id:e.id,status:'unavailable',error:'供应商未配置、超时或数据校验失败'};}finally{clearTimeout(timer);controller.abort();}}));
 // A slow peer must not make an earlier quote appear current at publication.
 const now=clock();for(const s of results)if(s.snapshot){try{s.snapshot=validateSnapshot(s.snapshot,s.id,now);}catch{delete s.snapshot;s.status='unavailable';s.error='发布时数据已过期';}}
 return {schemaVersion:1,mode:'parallel-authorized-gateways',generatedAt:now,validUntil:now+15000,canTrade:false,verifiedLive:false,sources:results,analysis:analyze(results,now),warning:'仅核对声明来源；未认证供应商身份。三家可能使用同一上游，数值一致不证明独立'};
 }finally{busy=false;}}
 return {sync};
}
function readParallelMarket(file,now=Date.now()){
 const empty={status:'unconfigured',canTrade:false,verifiedLive:false};if(!file)return empty;
 try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4*1024*1024)throw Error('file');const x=JSON.parse(fs.readFileSync(file));if(x.schemaVersion!==1||!['parallel-authorized-gateways','parallel-public-quotes'].includes(x.mode)||!finite(x.generatedAt)||x.generatedAt>now||now-x.generatedAt>15000||x.canTrade!==false||x.verifiedLive!==false||!Array.isArray(x.sources)||x.sources.length!==3||new Set(x.sources.map(s=>s.id)).size!==3||x.sources.some(s=>!(x.mode==='parallel-public-quotes'?['tencent','eastmoney','sina']:IDS).includes(s.id)))throw Error('invalid');const sources=x.sources.map(s=>s.status==='ok'?{id:s.id,status:'ok',snapshot:validateSnapshot(s.snapshot,s.id,now)}:{id:s.id,status:'unavailable'});return {status:'observed-unverified',generatedAt:x.generatedAt,canTrade:false,verifiedLive:false,sources:sources.map(s=>({id:s.id,status:s.status})),analysis:analyze(sources,now)};}catch{return {...empty,status:'invalid-or-stale'};}
}
module.exports={createParallelMarket,validateSnapshot,readParallelMarket,analyze};
