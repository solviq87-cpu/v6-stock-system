'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {createDashboardServer}=require('../src/server/bootstrap');
const {freezeCohort}=require('../src/core/forward-signal-observer');
const {runOnce}=require('../src/core/forward-tracking-store');
const {joinAuthorizedFollowup}=require('../src/server/forward-tracking-projection');
const at=d=>Date.parse(d+'T16:00:00+08:00');
function prep(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-forward-auth-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'protected','forward.json');
 const feed={source:'imported',provider:'unit-fixture',datasetId:'unit-case',priceBasis:'unadjusted'};
 const signals=['600001','000002'].map((symbol,i)=>({
  signalId:'frozen-'+i,symbol,system:'fourteen',cohort:'研究候选',
  provenance:'test-only',signalDate:'2026-11-02',signalAt:at('2026-11-02'),baselineClose:10
 }));
 const cohort=freezeCohort({schemaVersion:1,feed,signals},{now:at('2026-11-02')+1000});
 const calendar=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09'];
 const market={schemaVersion:1,feed,asOf:'2026-11-09',observedAt:at('2026-11-09'),
  calendar,stocks:signals.map(s=>({symbol:s.symbol,corporateActions:[],bars:calendar.map((date,i)=>({
   date,close:10+i,volume:100,suspended:false}))}))};
 runOnce({cohort,market,stateFile:file,now:at('2026-11-09')+1000});
 return file;
}
async function request({forwardTrackingFile,mode='ok',target='/api/quant-picks?max=12',sourceOk=()=>true}){
 const handle=(_req,res,u)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(u.pathname==='/api/health'){res.end(JSON.stringify({ok:true,health:true}));return;}
  if(mode==='denied'){res.statusCode=403;res.end(JSON.stringify({ok:false,error:'denied'}));return;}
  if(mode==='locked'){res.end(JSON.stringify({ok:false,locked:true,items:[]}));return;}
  if(mode==='write'){
   res.write(JSON.stringify({items:[{code:'600001'}]}));res.end();return;
  }
  if(mode==='length'){
   const value=JSON.stringify({items:[{code:'600001'}]});
   res.setHeader('Content-Length',Buffer.byteLength(value));res.end(value);return;
  }
  if(mode==='gzip'||mode==='gzip-mock'||mode==='gzip-length'||mode==='gzip-denied'){
   // Production json() sends larger candidate lists via asynchronous gzip and
   // writeHead(), not plaintext res.end(). Test the actual wire encoding.
   const payload=JSON.stringify({ok:mode!=='gzip-denied',isMock:mode==='gzip-mock',
    items:[{code:'600001',name:'Visible'.repeat(1000)}]});
   // Force the writeHead-only case; Node getHeader() cannot see these fields.
   res.removeHeader('Content-Type');
   const headers={'Content-Type':'application/json; charset=utf-8',
    'Content-Encoding':'gzip','Vary':'Accept-Encoding'};
   const bytes=zlib.gzipSync(Buffer.from(payload,'utf8'));
   if(mode==='gzip-length')headers['Content-Length']=bytes.length;
   res.writeHead(mode==='gzip-denied'?403:200,headers);
   res.end(bytes);
   return;
  }
  res.end(JSON.stringify({ok:true,items:[{code:'600001',name:'Visible'}]}));
 };
 const {server}=createDashboardServer({handle,forwardTrackingFile,
  sameOriginOk:sourceOk,bodyLimit:1024,port:0,host:'127.0.0.1'});
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 try{
  return await new Promise((resolve,reject)=>{
   http.get({hostname:'127.0.0.1',port:server.address().port,path:target},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));
    res.on('end',()=>{
     const bytes=Buffer.concat(chunks);
     const raw=res.headers['content-encoding']==='gzip'?
      zlib.gunzipSync(bytes).toString('utf8'):bytes.toString('utf8');
     resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)});
    });
   }).on('error',reject);
  });
 }finally{await new Promise(resolve=>server.close(resolve));}
}
test('only authorized quant-picks candidates receive matching frozen observations',async t=>{
 const file=prep(t),r=await request({forwardTrackingFile:file});
 assert.equal(r.status,200);assert.equal(r.body.items.length,1);
 assert.equal(r.body.forwardTracking.records.length,1);
 assert.equal(r.body.forwardTracking.records[0].symbol,'600001');
 assert.equal(r.body.forwardTracking.records[0].windows[0].status,'observed');
 assert.equal(r.body.forwardTracking.canTrade,false);
 assert.ok(!JSON.stringify(r.body).includes('000002'));
});
test('no auth or no matching result cannot expose private research data',async t=>{
 const file=prep(t);
 const denied=await request({forwardTrackingFile:file,mode:'denied'});
 assert.equal(denied.status,403);
 assert.equal(denied.body.forwardTracking,undefined);
 const locked=await request({forwardTrackingFile:file,mode:'locked'});
 assert.equal(locked.body.forwardTracking,undefined);
 const csrf=await request({forwardTrackingFile:file,sourceOk:()=>false});
 assert.equal(csrf.status,403);
 assert.equal(csrf.body.forwardTracking,undefined);
});
test('no opt-in file or corrupted report falls back to original authorized response',async t=>{
 const file=prep(t);
 const absent=await request({});
 assert.equal(absent.body.forwardTracking,undefined);
 fs.appendFileSync(file,'changed'); // JSON syntax and seal corrupted
 const bad=await request({forwardTrackingFile:file});
 assert.equal(bad.status,200);
 assert.equal(bad.body.items[0].code,'600001');
 assert.equal(bad.body.forwardTracking,undefined);
});
test('HTTP health, already-streaming and fixed content-length requests remain untouched',async t=>{
 const file=prep(t);
 assert.equal((await request({forwardTrackingFile:file,target:'/api/health'})).body.forwardTracking,undefined);
 assert.equal((await request({forwardTrackingFile:file,mode:'write'})).body.forwardTracking,undefined);
 assert.equal((await request({forwardTrackingFile:file,mode:'length'})).body.forwardTracking,undefined);
});
test('gzip-compressed candidate lists also receive only permitted frozen tracking evidence',async t=>{
 const file=prep(t),r=await request({forwardTrackingFile:file,mode:'gzip'});
 assert.equal(r.status,200);
 assert.equal(r.headers['content-encoding'],'gzip','do not break client compression');
 assert.equal(r.headers.vary,'Accept-Encoding');
 assert.ok(r.body.items[0].name.length>1000);
 assert.equal(r.body.forwardTracking.records.length,1);
 assert.equal(r.body.forwardTracking.records[0].symbol,'600001');
 assert.ok(!JSON.stringify(r.body).includes('000002'));
 const mock=await request({forwardTrackingFile:file,mode:'gzip-mock'});
 assert.equal(mock.headers['content-encoding'],'gzip');
 assert.equal(mock.body.forwardTracking,undefined,'do not promote mocked candidates to observations');
});
test('no projection from response without granted visible candidates or invalid metadata',()=>{
 const report={report:{feed:{source:'imported'},records:[{symbol:'600001'}]}};
 assert.equal(joinAuthorizedFollowup({items:[]},report),null);
 assert.equal(joinAuthorizedFollowup({items:[{code:'000002'}]},report),null);
 assert.equal(joinAuthorizedFollowup({locked:true,items:[{code:'600001'}]},report),null);
});

test('production writeHead-only gzip response rejects fixed-length changes and non-200 exposure',async t=>{
 const file=prep(t);
 const fixed=await request({forwardTrackingFile:file,mode:'gzip-length'});
 assert.equal(fixed.status,200);
 assert.equal(fixed.headers['content-encoding'],'gzip');
 assert.ok(Number(fixed.headers['content-length'])>0);
 assert.equal(fixed.body.forwardTracking,undefined,'do not rewrite Content-Length');
 const denied=await request({forwardTrackingFile:file,mode:'gzip-denied'});
 assert.equal(denied.status,403);
 assert.equal(denied.headers['content-encoding'],'gzip');
 assert.equal(denied.body.forwardTracking,undefined);
});
