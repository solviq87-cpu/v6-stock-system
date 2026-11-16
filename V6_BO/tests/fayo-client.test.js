'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('data:text/javascript;base64,'+fs.readFileSync(path.resolve(__dirname,'../public/nova/client.js')).toString('base64'));
const quoteAt=Date.parse('2026-11-13T07:00:00Z');
const oldState=()=>({trading:false,isSnapshot:true,snapshotDay:'20261113',news:{items:[{title:'旧公告'}]},dashboard:{rows:[{code:'600101',price:12.3,quoteAt,quoteSource:'fixture-friday'}],indices:[{code:'1.000001',price:3210,quoteAt}],counts:{candidates:1},mood:{label:'周五观察'}},pool:[{code:'600101',price:12.3,quoteAt}],sectors:[{name:'真实已存板块'}]});

test('weekend display retention preserves original quotes while keeping current news and does not mutate either response',async()=>{
 const {retainMarket}=await load(),previous=oldState();
 const incoming={trading:false,isSnapshot:true,snapshotDay:'20261113',dashboard:{rows:[],indices:[]},pool:[],sectors:[],news:{items:[{title:'周末新公告'}]}};
 const beforePrevious=JSON.stringify(previous),beforeIncoming=JSON.stringify(incoming);
 const recovered=retainMarket(previous,incoming);
 assert.equal(recovered.dashboard.rows[0].quoteAt,quoteAt,'Sunday refresh must not replace original Friday quote time');
 assert.equal(recovered.dashboard.rows[0].quoteSource,'fixture-friday');
 assert.equal(recovered.dashboard.rows[0].price,12.3);
 assert.equal(recovered.dashboard.indices[0].quoteAt,quoteAt);
 assert.deepEqual(recovered.news.items,[{title:'周末新公告'}],'news continues to update independently');
 assert.equal(JSON.stringify(previous),beforePrevious);
 assert.equal(JSON.stringify(incoming),beforeIncoming);
});

test('an explicitly live weekday response is not silently replaced with a prior Friday pool',async()=>{
 const {retainMarket}=await load(),incoming={trading:true,isSnapshot:false,dashboard:{rows:[],indices:[]},pool:[]};
 const current=retainMarket(oldState(),incoming);
 assert.deepEqual(current.dashboard.rows,[]);
 assert.deepEqual(current.pool,[]);
});

test('retained market fields preserve their individual source dates instead of the newer empty reply date',async()=>{
 const {retainMarket}=await load(),previous={...oldState(),snapshotFieldDays:{pool:'20261112',sectors:'20261113'}};
 const incoming={trading:false,isSnapshot:true,snapshotDay:'20261115',pool:[],sectors:[],snapshotFieldDays:{pool:'20261115',sectors:'20261115'}};
 const result=retainMarket(previous,incoming);
 assert.equal(result.snapshotFieldDays.pool,'20261112');
 assert.equal(result.snapshotFieldDays.sectors,'20261113');
 assert.equal(result.snapshotFieldDays.dashboard,'20261113');
 assert.equal(incoming.snapshotFieldDays.pool,'20261115','caller metadata is immutable');
 const fresh=retainMarket(previous,{...incoming,pool:[{code:'600102'}]});
 assert.equal(fresh.snapshotFieldDays.pool,'20261115','actually populated replacements retain their new source day');
 const unknown=retainMarket({pool:[{code:'600101'}]},{trading:false,pool:[],snapshotDay:'20261115'});
 assert.equal(unknown.snapshotFieldDays.pool,'','an unknown historical source day stays unknown');
});

test('retention never fabricates a Friday history when no actual prior snapshot exists',async()=>{
 const {retainMarket}=await load(),incoming={trading:false,isSnapshot:true,dashboard:{rows:[],indices:[]},pool:[]};
 assert.deepEqual(retainMarket(null,incoming),incoming);
 assert.throws(()=>retainMarket(oldState(),null),/状态/);
});

test('revoked authorization aborts concurrent requests and late private responses cannot return to the caller',async()=>{
 const {createClient}=await load(),originalLocation=global.location,originalFetch=global.fetch;
 global.location={origin:'http://fayo.test'};
 let release,aborted=false,denials=0;
 global.fetch=(url,options)=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/api/slow')return new Promise(resolve=>{
   options.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
   release=()=>resolve({ok:true,status:200,json:async()=>({ok:true,private:'must-not-return'})});
  });
  assert.equal(options.headers.Authorization,'Bearer fixture-token');
  assert.equal(options.cache,'no-store');
  return Promise.resolve({ok:true,status:200,json:async()=>({locked:true,needAuth:true,error:'revoked'})});
 };
 try{
  const client=createClient({onUnauthorized:()=>denials++,getToken:()=> 'fixture-token'});
  const delayed=client.api('/api/slow');
  await assert.rejects(client.api('/api/state'),/revoked/);
  assert.equal(denials,1);
  assert.equal(aborted,true);
  release();
  await assert.rejects(delayed,error=>error.name==='AbortError');
 }finally{global.location=originalLocation;global.fetch=originalFetch;}
});

test('the new transport refuses external services and URL credentials before making any request',async()=>{
 const {createClient}=await load(),originalLocation=global.location,originalFetch=global.fetch;
 global.location={origin:'http://fayo.test'};
 let calls=0;global.fetch=async()=>{calls++;throw Error('must not fetch');};
 try{
  const client=createClient({getToken:()=> 'fixture-token'});
  await assert.rejects(client.api('https://example.invalid/api/state'),/当前服务/);
  await assert.rejects(client.api('/api/state?token=private'),/凭据/);
  assert.equal(calls,0);
 }finally{global.location=originalLocation;global.fetch=originalFetch;}
});

test('retained Friday cards keep their matching counts rather than presenting a false zero pool',async()=>{
 const {retainMarket}=await load();
 const result=retainMarket(oldState(),{trading:false,isSnapshot:true,snapshotDay:'20261113',dashboard:{rows:[],indices:[],counts:{candidates:0}}});
 assert.equal(result.dashboard.rows.length,1);
 assert.equal(result.dashboard.counts.candidates,1);
 assert.equal(result.dashboard.snapshotRetained,true);
});

test('closed-session relay and movement fallback preserves each original result and its own source day atomically',async()=>{
 const {retainMarket}=await load();
 const previous={...oldState(),role:'edit',yierList:[{code:'600101',price:12.3,quoteAt}],yierAsOf:'20261112',lianbanList:[{code:'600102',price:20,quoteAt}],lianbanAsOf:'20261113',abMove:{items:[{code:'600103',gain:19,status:'near',quoteAt}],count:1,total:1,asOf:quoteAt},snapshotFieldDays:{abMove:'20261113'}};
 const incoming={trading:false,isSnapshot:true,role:'edit',snapshotDay:'20261115',snapshotFieldDays:{yierList:'20261115',lianbanList:'20261115',abMove:'20261115'},yier:null,lianban:null,yierList:[],yierAsOf:'20261115',lianbanList:[],lianbanAsOf:'20261115',abMove:{items:[],count:0,total:0,asOf:Date.parse('2026-11-15T08:00:00Z')},news:{items:[{title:'周日公告'}]}};
 const beforePrevious=JSON.stringify(previous),beforeIncoming=JSON.stringify(incoming),result=retainMarket(previous,incoming);
 assert.deepEqual(result.yierList,previous.yierList);assert.equal(result.yierAsOf,'20261112');assert.equal(result.snapshotFieldDays.yierList,'20261112');
 assert.deepEqual(result.lianbanList,previous.lianbanList);assert.equal(result.lianbanAsOf,'20261113');assert.equal(result.snapshotFieldDays.lianbanList,'20261113');
 assert.deepEqual(result.abMove,previous.abMove,'count, metadata and rows belong to the same retained run');assert.equal(result.snapshotFieldDays.abMove,'20261113');
 assert.deepEqual(result.news,incoming.news);assert.equal(JSON.stringify(previous),beforePrevious);assert.equal(JSON.stringify(incoming),beforeIncoming);
 const newer={...incoming,yierList:[{code:'600104'}],yierAsOf:'20261113',lianbanList:[{code:'600105'}],lianbanAsOf:'20261113',abMove:{items:[{code:'600106'}],count:1}};
 const read=retainMarket(previous,newer);assert.deepEqual(read.yierList,newer.yierList);assert.equal(read.yierAsOf,newer.yierAsOf);assert.deepEqual(read.abMove,newer.abMove);
 const live=retainMarket(previous,{...incoming,trading:true,isSnapshot:false});assert.deepEqual(live.yierList,[]);assert.deepEqual(live.lianbanList,[]);assert.deepEqual(live.abMove,incoming.abMove);
});

test('closed-session retention never resurrects private relay rows after explicit viewer or hidden projections',async()=>{
 const {retainMarket}=await load(),previous={...oldState(),yierList:[{code:'600101'}],yierAsOf:'20261113',lianbanList:[{code:'600102'}],lianbanAsOf:'20261113'};
 for(const projection of [{role:'view'},{readOnly:true},{yier:{hidden:true}},{lianban:{hidden:true}},{paper:{hidden:true}}]){
  const incoming={trading:false,isSnapshot:true,yierList:[],lianbanList:[],yierAsOf:'',lianbanAsOf:'',...projection};
  const result=retainMarket(previous,incoming);assert.deepEqual(result.yierList,[],JSON.stringify(projection));assert.deepEqual(result.lianbanList,[],JSON.stringify(projection));assert.equal(result.yierAsOf,'');assert.equal(result.lianbanAsOf,'');
 }
 assert.deepEqual(retainMarket(null,{trading:false,yierList:[],lianbanList:[]}).yierList,[],'no browser history is fabricated');
});

test('a semantic read-only denial does not revoke an otherwise valid reader session',async()=>{
 const {createClient}=await load(),originalLocation=global.location,originalFetch=global.fetch;
 global.location={origin:'http://fayo.test'};
 let denials=0;
 global.fetch=async url=>new URL(url).pathname==='/api/private-tool'
  ?{ok:false,status:403,json:async()=>({ok:false,readOnly:true,locked:true,error:'需要编辑权限'})}
  :{ok:true,status:200,json:async()=>({ok:true,rows:[{code:'600101'}]})};
 try{
  const client=createClient({onUnauthorized:()=>denials++,getToken:()=> 'fixture-reader'});
  await assert.rejects(client.api('/api/private-tool'),/编辑权限/);
  assert.equal(denials,0,'permission denial is distinct from session revocation');
  assert.equal((await client.api('/api/state')).rows[0].code,'600101');
 }finally{global.location=originalLocation;global.fetch=originalFetch;}
});
