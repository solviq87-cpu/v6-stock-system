'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{
 const server=net.createServer();server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
});
function request(port,url,payload,token=''){
 return new Promise((resolve,reject)=>{
  const data=payload===null?'':JSON.stringify(payload);
  const req=http.request({hostname:'127.0.0.1',port,path:url,method:payload===null?'GET':'POST',
   headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),
    ...(token?{Authorization:'Bearer '+token}:{})},timeout:3000},res=>{
   let text='';res.on('data',part=>text+=part);res.on('end',()=>{
    try{resolve(JSON.parse(text));}catch{reject(Error('invalid fixture response'));}
   });
  });
  req.once('error',reject);req.once('timeout',()=>req.destroy(Error('fixture HTTP timeout')));req.end(data);
 });
}

test('actual legacy research HTTP route enforces historical dates, membership and liquidity inputs',async t=>{
 const source=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-ledger-http-'));
 const port=await freePort();
 for(const name of ['server.js','src','strategies','public','config','package.json']){
  if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(tmp,name),{recursive:true});
 }
 for(const name of fs.readdirSync(source))if(name.endsWith('.js')&&name!=='server.js')fs.copyFileSync(path.join(source,name),path.join(tmp,name));
 const salt='ledger-http-test-only-salt';
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync('isolated-ledger-password',salt,32).toString('hex'),devices:{}}));
 const networkGuard=path.join(tmp,'deny-external.cjs');
 fs.writeFileSync(networkGuard,`for(const name of ['http','https']){const m=require(name);for(const key of ['request','get']){const original=m[key];m[key]=function(...args){const value=args[0];const host=typeof value==='string'?new URL(value).hostname:value?.hostname||value?.host||'localhost';if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('external network disabled by ledger fixture');return original.apply(this,args);};}}`);
 const child=spawn(process.execPath,['--require',networkGuard,'server.js'],{cwd:tmp,
  env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_OPTIONAL_RESEARCH_FILE:'',V6_SIX_PHOTO_FILE:''},
  stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',part=>logs+=part);child.stderr.on('data',part=>logs+=part);
 t.after(async()=>{
  child.kill('SIGTERM');
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(resolve,1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  fs.rmSync(tmp,{recursive:true,force:true});
 });
 let ready=false;
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('fixture server exited '+logs.slice(-1000));
  try{await request(port,'/api/lock/status',null);ready=true;break;}catch{}
  await pause(100);
 }
 assert.ok(ready,'fixture server not ready '+logs.slice(-1000));
 const login=await request(port,'/api/lock/unlock',{password:'isolated-ledger-password',role:'edit',fp:'ledger-test'});
 assert.equal(login.ok,true);const token=login.token;
 const bars=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
  open:10,high:10.1,low:9.9,close:10,volume:1000,amount:10000,
  factors:{trendScore:95,relativeStrength:99,volumeScore:99,capitalScore:98,amount:1e9,positionScore:95,breakoutScore:95,momentumScore:95}}));
 const stock={symbol:'600000',market:'main',volumeUnit:'shares',feed:{source:'imported',timestamp:Date.now()},bars};
 const payload={stocks:[stock],start:27,end:32,feeBps:0,slippageBps:0,sellTaxBps:0,maxParticipationPct:10,tradingDates:bars.map(b=>b.date)};
 const post=body=>request(port,'/api/research/ledger',body,token);
 const allowed=await post(payload);
 assert.equal(allowed.ok,true,JSON.stringify(allowed));
 assert.equal(allowed.result.researchOnly,true);assert.equal(allowed.result.canTrade,false);
 assert.equal(allowed.result.dataProvenance.verifiedExternal,false);
 assert.ok(allowed.result.orders.some(o=>o.side==='buy'&&o.status==='filled'));
 assert.ok(allowed.result.orders.filter(o=>o.status==='filled').every(o=>o.shares<=100));
 const malformed=await post({...payload,maxParticipationPct:101});
 assert.equal(malformed.ok,false);assert.match(malformed.error,/参与率/);
 const strictMissing=await post({...payload,strictHistoricalStatus:true});
 assert.equal(strictMissing.ok,false);assert.match(strictMissing.error,/逐日ST/);
 const strictStock=structuredClone(stock);
 for(const b of strictStock.bars)Object.assign(b,{isST:false,suspended:false,tradable:true});
 Object.assign(strictStock,{isST:true,suspended:true,tradable:false});
 const strict=await post({...payload,stocks:[strictStock],strictHistoricalStatus:true});
 assert.equal(strict.ok,true,JSON.stringify(strict));
 assert.equal(strict.result.dataProvenance.historicalEvidence.strictHistoricalStatus,true);
 assert.ok(strict.result.orders.some(o=>o.status==='filled'));
 const misdated=structuredClone(stock);misdated.symbol='000001';
 misdated.bars=misdated.bars.map(b=>({...b,date:new Date(Date.parse(b.date)+86400000).toISOString().slice(0,10)}));
 const misaligned=await post({...payload,stocks:[stock,misdated]});
 assert.equal(misaligned.ok,false);assert.match(misaligned.error,/未对齐/);
 const wrongCalendar=payload.tradingDates.slice();wrongCalendar.splice(29,1);
 const calendar=await post({...payload,tradingDates:wrongCalendar});
 assert.equal(calendar.ok,false);assert.match(calendar.error,/交易日历/);
 const forbidden=await post({...payload,universeHistory:[{symbol:stock.symbol,from:bars[0].date,through:bars.at(-1).date,
  knownAt:'2024-12-01T00:00:00Z',source:'fixture',eligible:false}]});
 assert.equal(forbidden.ok,true);assert.equal(forbidden.result.orders.filter(o=>o.status==='filled').length,0);
 const anonymous=await request(port,'/api/research/ledger',payload);
 assert.notEqual(anonymous.ok,true);
});
