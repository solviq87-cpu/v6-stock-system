'use strict';
// Execute the actual standalone page module. Every transport below is an
// in-memory Response; neither this suite nor the inline module reaches a host.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(process.env.V6_WORKBUDDY_SOURCE||path.resolve(__dirname,'../../V6_WEB/workbuddy/index.html'),'utf8');
const begin=html.indexOf('/* V6_NEWS_POOL_START */'),end=html.indexOf('/* V6_NEWS_POOL_END */',begin);
assert.ok(begin>=0&&end>begin,'The real inline news-pool module must exist');
const inline=html.slice(begin,end);
const base=Date.parse('2026-11-13T09:45:00+08:00');
const iso=value=>new Date(value).toISOString();
const plain=value=>JSON.parse(JSON.stringify(value));
const stock=(overrides={})=>({symbol:'600000',name:'示例科技',sector:'半导体',sectorNode:'sector-semiconductor',sectorSource:'fixture-classification',sectorUpdatedAt:iso(base-3600000),sectorClassificationKnown:true,sectorTags:[],...overrides});
const item=(overrides={})=>({code:'n1',title:'示例科技中标项目',summary:'签订新增订单',showTime:'2026-11-13 09:40:00',stockList:['1.600000'],url:'https://finance.eastmoney.com/a/20261113333333333.html',...overrides});
function world(options={}){
 let now=options.now??base,requested=options.requested!==false,hidden=options.hidden===true;
 const calls=[],storage=options.storage||new Map(),events=new Map(),timers=new Map();let timerId=0;
 const settings={rows:{101:options.rows101??[item()],104:options.rows104??[]},errors:new Set(options.errors||[]),beforeResponse:null,body:null,headers:null};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const denied=()=>{throw Error('This offline fixture forbids direct fetch');};
 const listen=(type,fn)=>{const list=events.get(type)||[];list.push(fn);events.set(type,list);};
 const context={Date:Clock,URL,URLSearchParams,AbortController,Response,Headers,TextEncoder,TextDecoder,console,
  setTimeout(fn,delay=0){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){return ++timerId;},clearInterval(){},
  fetch:denied,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  document:{get hidden(){return hidden;},addEventListener:listen,removeEventListener(){}},addEventListener:listen,removeEventListener(){},
  V6Market:{get status(){return {collectionRequested:requested,collectionEnabled:requested&&!hidden&&options.sessionOpen!==false,marketSession:{open:options.sessionOpen!==false}};},snapshot:{stocks:options.stocks||[stock()]},
   async publicFetch(url,request={}){const parsed=new URL(url),column=Number(parsed.searchParams.get('fastColumn'));
    assert.equal(parsed.origin,'https://np-weblist.eastmoney.com');assert.equal(parsed.pathname,'/comm/web/getFastNewsList');
    calls.push({url,request,column,at:now});if(settings.beforeResponse)await settings.beforeResponse({column,request});
    if(settings.errors.has(column))throw Error('synthetic source unavailable');
    const body=settings.body??JSON.stringify({data:{fastNewsList:settings.rows[column]||[],sortEnd:'older-unrequested-page'}});
    return new Response(body,{status:200,headers:settings.headers||{'content-type':'application/json'}});
   }}
 };
 context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(inline,context,{filename:'workbuddy-news-pool.inline.js'});
 assert.ok(context.V6NewsPool);
 return {api:context.V6NewsPool,context,calls,settings,storage,get now(){return now;},setNow(value){now=value;},advance(ms){now+=ms;},setRequested(value){requested=value;},setHidden(value){hidden=value;for(const fn of events.get('visibilitychange')||[])fn();},flushTimers(){for(const [id,timer]of [...timers]){timers.delete(id);timer.fn();}}};
}
const article=(w,id='n1')=>w.api.snapshot.items.find(row=>row.id===id);
const risk=(w,target=stock())=>w.api.riskFor(target,{now:w.now});
async function refresh(w){await w.api.refresh();return w.api.snapshot;}

test('news module loading is passive, and an unqueried pool cannot certify a candidate',()=>{
 const w=world();assert.equal(w.calls.length,0);assert.equal(risk(w).status,'unknown');
 for(const name of ['refresh','hydrate','serialize','riskFor','render','subscribe','cacheKey'])assert.equal(typeof w.api[name],'function');
});
test('one successful round requests only the two known first pages and preserves source/receive clocks',async()=>{
 const w=world();await refresh(w);assert.equal(w.calls.length,2);assert.deepEqual(w.calls.map(x=>x.column).sort(),[101,104]);
 for(const request of w.calls){const url=new URL(request.url);assert.equal(url.searchParams.get('pageSize'),'100');assert.ok(!url.searchParams.get('sortEnd'));}
 const row=article(w);assert.equal(row.publishedAt,'2026-11-13T01:40:00.000Z');assert.equal(row.receivedAt,iso(base));assert.equal(row.sentiment,'good');assert.deepEqual(plain(row.codes),['600000']);
 assert.equal(risk(w).status,'checked');assert.ok(risk(w).scope.includes('bounded'));
});
test('negative evidence wins over a positive keyword and is applied only to explicitly linked stocks',async()=>{
 const w=world({rows101:[item({title:'中标合同后收到处罚决定',summary:'签订合作协议，但被处罚'})]});await refresh(w);
 assert.equal(article(w).sentiment,'bad');assert.equal(risk(w).status,'blocked');assert.equal(risk(w,stock({symbol:'600001',sector:'医药',sectorNode:'sector-drugs'})).status,'checked');
 assert.ok(risk(w).articles.some(row=>row.id==='n1'));
});
test('adverse facts after the first 90 summary characters cannot be hidden by a positive headline',async()=>{
 const w=world({rows101:[item({summary:'公开经营情况说明。'.repeat(15)+'公司收到处罚决定并被立案调查'})]});await refresh(w);
 assert.equal(article(w).sentiment,'bad');assert.equal(risk(w).status,'blocked');
});
test('a truncated oversized summary cannot certify its discarded adverse ending as positive',async()=>{
 const w=world({rows101:[item({summary:'公开信息。'.repeat(450)+'公司被立案调查'})]});await refresh(w);
 assert.equal(article(w).sentiment,'unknown');assert.equal(risk(w).status,'unknown');
});
test('selling repurchased shares retains the existing adverse semantic reversal',async()=>{
 const w=world({rows101:[item({title:'拟出售已回购股份',summary:'董事会审议通过相关方案'})]});await refresh(w);
 assert.equal(article(w).sentiment,'bad');assert.equal(risk(w).status,'blocked');assert.match(article(w).reasons.join(' '),/回购|出售|反转|减持/);
});
test('positive stories never cancel a separate current negative story',async()=>{
 const w=world({rows101:[item(),item({code:'n2',title:'示例科技收到立案通知',summary:'涉嫌违法'})]});await refresh(w);
 assert.equal(w.api.snapshot.items.length,2);assert.equal(risk(w).status,'blocked');
});
test('a company-name coincidence without source stock codes does not create a direct stock link',async()=>{
 const w=world({rows101:[item({title:'示例科技收到立案通知',summary:'',stockList:[]})]});await refresh(w);
 assert.deepEqual(plain(article(w).codes),[]);assert.equal(risk(w).status,'checked');
});
test('malformed, foreign and suffix-bearing source securities do not become mainland stock codes',async()=>{
 const w=world({rows101:[item({title:'某公司收到处罚',summary:'',stockList:['116.00700','2.600000','1.600000extra','600000extra','1.12345','1.600000']})]});await refresh(w);
 assert.deepEqual(plain(article(w).codes),['600000']);assert.equal(risk(w).status,'blocked');
});
test('an exchange-index code cannot collide with an unrelated stock sharing six digits',async()=>{
 const q=stock({symbol:'000001',sector:'银行',sectorNode:'sector-bank'});
 const w=world({stocks:[q],rows101:[item({title:'上证指数跌超百分之二',summary:'',stockList:['1.000001']})]});await refresh(w);
 assert.ok(!article(w).codes.includes('000001'));assert.equal(risk(w,q).status,'checked');
});
test('sector spillover uses known classification, identifies indirect influence and does not guess a company',async()=>{
 const w=world({rows101:[item({title:'半导体行业风险提示',summary:'行业受到制裁',stockList:[]})]});await refresh(w);
 assert.equal(article(w).sectors[0].name,'半导体');assert.deepEqual(plain(article(w).codes),[]);
 const result=risk(w);assert.equal(result.status,'blocked');assert.match(result.reasons.join(' '),/间接|行业|板块/);
 assert.notEqual(risk(w,stock({sectorClassificationKnown:false,sectorSource:null})).status,'checked');
});
test('a bank company name without source codes is not an adverse story about every bank',async()=>{
 const q=stock({sector:'银行',sectorNode:'sector-bank'}),w=world({stocks:[q],rows101:[item({title:'招商银行被处罚',summary:'',stockList:[]})]});await refresh(w);
 assert.deepEqual(plain(article(w).sectors),[]);assert.equal(risk(w,q).status,'checked');
});
test('a longer industry name cannot spill over to its shorter-name neighbor',async()=>{
 const power=stock({symbol:'600001',sector:'电力',sectorNode:'sector-power'}),equipment=stock({symbol:'600002',sector:'电力设备',sectorNode:'sector-power-equipment'});
 const w=world({stocks:[power,equipment],rows101:[item({title:'电力设备行业受到制裁',summary:'',stockList:[]})]});await refresh(w);
 assert.deepEqual(plain(article(w).sectors.map(row=>row.name)),['电力设备']);assert.equal(risk(w,power).status,'checked');assert.equal(risk(w,equipment).status,'blocked');
});
test('an explicit bank-sector headline still produces only labeled indirect influence',async()=>{
 const q=stock({sector:'银行',sectorNode:'sector-bank'}),w=world({stocks:[q],rows101:[item({title:'银行板块面临风险提示',summary:'',stockList:[]})]});await refresh(w);
 assert.equal(risk(w,q).status,'blocked');assert.match(risk(w,q).reasons.join(' '),/间接/);assert.deepEqual(plain(article(w).codes),[]);
});
test('explicit stock codes remain direct even when its company name is not an industry mention',async()=>{
 const first=stock({sector:'银行',sectorNode:'sector-bank'}),other=stock({symbol:'600001',sector:'银行',sectorNode:'sector-bank'});
 const w=world({stocks:[first,other],rows101:[item({title:'招商银行被处罚',summary:''})]});await refresh(w);
 assert.equal(risk(w,first).status,'blocked');assert.match(risk(w,first).reasons.join(' '),/直接/);assert.equal(risk(w,other).status,'checked');
});
for(const [label,showTime]of [
 ['missing source time',null],['date-only source time','2026-11-13'],['invalid date','2026-02-30 09:40:00'],['unqualified clock','09:40:00'],['future source time','2026-11-13 10:00:00']
])test(label+' cannot be refreshed into a valid news check',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案',summary:'',showTime})]});await refresh(w);
 assert.equal(risk(w).status,'unknown');assert.notEqual(article(w).timeStatus,'valid');
});
test('a failed source column makes the pool unknown instead of silently accepting partial results',async()=>{
 const w=world({errors:[104]});await refresh(w);assert.equal(w.calls.length,2);assert.equal(risk(w).status,'unknown');assert.ok(w.api.snapshot.lastError);
});
test('a later failed fetch revokes a previously checked pool without changing old source timestamps',async()=>{
 const w=world();await refresh(w);const old=article(w).publishedAt,received=article(w).receivedAt;
 w.advance(300001);w.settings.errors.add(101);await refresh(w);
 assert.equal(risk(w).status,'unknown');assert.equal(article(w).publishedAt,old);assert.equal(article(w).receivedAt,received);
});
test('an expired pool changes cache identity and cannot authorize a current news check',async()=>{
 const w=world();await refresh(w);w.advance(599999);const before=w.api.cacheKey(w.now);assert.equal(risk(w).status,'checked');w.advance(2);
 assert.equal(risk(w).status,'unknown');assert.notEqual(w.api.cacheKey(w.now),before);
});
test('clock rollback cannot make a future received pool fresh',async()=>{
 const w=world();await refresh(w);w.advance(-1000);assert.equal(risk(w).status,'unknown');
});
test('same-ID revisions replace the old positive projection and retain one current article',async()=>{
 const w=world();await refresh(w);const hash=article(w).versionHash;
 w.advance(300001);w.settings.rows[101]=[item({title:'示例科技被立案调查',summary:'原公告随后修订',showTime:'2026-11-13 09:48:00'})];await refresh(w);
 assert.equal(w.api.snapshot.items.filter(row=>row.id==='n1').length,1);assert.equal(article(w).sentiment,'bad');assert.notEqual(article(w).versionHash,hash);assert.equal(risk(w).status,'blocked');
});
test('explicit source withdrawal removes its active effect without deleting the visible record',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案',summary:''})]});await refresh(w);assert.equal(risk(w).status,'blocked');
 w.advance(300001);w.settings.rows[101]=[item({title:'来源撤回该快讯',summary:'',showTime:'2026-11-13 09:48:00',status:'retracted'})];await refresh(w);
 assert.equal(article(w).retracted,true);assert.equal(article(w).current,false);assert.equal(article(w).sourceStatus,'retracted');assert.equal(risk(w).status,'checked');
});
for(const showTime of [null,'2026-11-13 10:30:00'])test('withdrawal with '+(showTime?'future':'unknown')+' source time cannot clear a known adverse event',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案',summary:''})]});await refresh(w);assert.equal(risk(w).status,'blocked');
 w.advance(300001);w.settings.rows[101]=[item({title:'来源撤回该快讯',summary:'',showTime,status:'retracted'})];await refresh(w);
 assert.notEqual(risk(w).status,'checked');
});
test('withdrawing one adverse story does not remove the other current adverse story',async()=>{
 const second=item({code:'n2',title:'示例科技收到处罚',summary:''});const w=world({rows101:[item({title:'示例科技被立案',summary:''}),second]});await refresh(w);
 w.advance(300001);w.settings.rows[101]=[item({title:'来源撤回该快讯',summary:'',showTime:'2026-11-13 09:48:00',status:'retracted'}),second];await refresh(w);
 assert.equal(risk(w).status,'blocked');assert.ok(risk(w).articles.some(row=>row.id==='n2'));
});
test('absence from a later first page is not interpreted as source withdrawal',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案',summary:''})]});await refresh(w);
 w.advance(300001);w.settings.rows[101]=[];await refresh(w);assert.equal(article(w).retracted,false);assert.equal(risk(w).status,'blocked');
});
test('page flags other than an explicit withdrawal do not invent a retraction',async()=>{
 const w=world({rows101:[item({title:'示例科技被处罚',summary:'',deleted:false,status:'updated',isDeleted:false})]});await refresh(w);assert.equal(article(w).retracted,false);assert.equal(risk(w).status,'blocked');
});
test('duplicate stories across both columns share one active event',async()=>{
 const w=world({rows101:[item()],rows104:[item()]});await refresh(w);assert.equal(w.api.snapshot.items.filter(row=>row.id==='n1').length,1);
});
test('an older positive row in the second column cannot erase a newer adverse revision',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案调查',summary:'',showTime:'2026-11-13 09:44:00'})],rows104:[item()]});await refresh(w);
 assert.notEqual(risk(w).status,'checked');assert.equal(w.api.snapshot.items.filter(row=>row.id==='n1').length,1);
});
test('same-clock contradictory projections cannot silently grant positive clearance',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案调查',summary:''})],rows104:[item()]});await refresh(w);
 assert.notEqual(risk(w).status,'checked');
});
test('articles older than the bounded 72-hour observation window are not retained as current risks',async()=>{
 const w=world({rows101:[item({showTime:'2026-11-09 09:40:00'})]});await refresh(w);assert.equal(w.api.snapshot.items.length,0);assert.equal(risk(w).status,'checked');
});
test('unknown-time records are also bounded by their original receive time rather than retained forever',async()=>{
 const w=world({rows101:[item({showTime:null})]});await refresh(w);assert.equal(w.api.snapshot.items.length,1);
 w.advance(72*3600000+1);w.settings.rows[101]=[];await refresh(w);assert.equal(w.api.snapshot.items.length,0);
});
test('successive bounded first-page rounds cannot grow the pool beyond 500 records',async()=>{
 const w=world();
 for(let round=0;round<3;round++){
  for(const column of [101,104])w.settings.rows[column]=Array.from({length:100},(_,i)=>item({code:'n'+round+'-'+column+'-'+i}));
  await refresh(w);if(round<2)w.advance(300001);
 }
 assert.ok(w.api.snapshot.items.length<=500);assert.ok(w.api.snapshot.items.length>=400);assert.equal(new Set(w.api.snapshot.items.map(row=>row.id)).size,w.api.snapshot.items.length);
});
test('a neutral source story remains neutral and cannot be marketed as positive',async()=>{
 const w=world({rows101:[item({title:'示例科技发布办公地点信息',summary:'按原计划召开例行会议'})]});await refresh(w);assert.equal(article(w).sentiment,'neutral');assert.equal(risk(w).status,'checked');
});
test('serializing and hydrating an old cache preserves observation dates but cannot grant wire freshness',async()=>{
 const first=world();await refresh(first);const payload=first.api.serialize();const second=world({now:base+120000});second.api.hydrate(payload);
 assert.equal(second.calls.length,0);assert.equal(article(second).publishedAt,article(first).publishedAt);assert.equal(article(second).receivedAt,article(first).receivedAt);assert.equal(second.api.snapshot.fetchedAt,first.api.snapshot.fetchedAt);assert.equal(risk(second).status,'unknown');
});
test('a matching shared cache with a known negative still blocks rather than granting positive support',async()=>{
 const first=world({rows101:[item({title:'示例科技收到处罚',summary:''})]});await refresh(first);const second=world({now:base+1000});second.api.hydrate(first.api.serialize());
 assert.equal(risk(second).status,'blocked');
});
test('hydrating older positive data cannot overwrite a newer adverse revision',async()=>{
 const first=world();await refresh(first);const old=plain(first.api.serialize());
 first.advance(300001);first.settings.rows[101]=[item({title:'示例科技收到处罚决定',summary:'',showTime:'2026-11-13 09:48:00'})];await refresh(first);const at=first.api.snapshot.fetchedAt;
 first.api.hydrate(old);assert.equal(article(first).sentiment,'bad');assert.equal(first.api.snapshot.fetchedAt,at);assert.equal(risk(first).status,'blocked');
});
test('a newer shared receive time cannot restore an older positive source revision over a later adverse one',async()=>{
 const current=world({rows101:[item({title:'示例科技被立案调查',summary:'',showTime:'2026-11-13 09:44:00'})]});await refresh(current);
 const older=world({now:base+300001});await refresh(older);current.advance(300001);current.api.hydrate(older.api.serialize());
 assert.equal(article(current).sentiment,'bad');assert.notEqual(risk(current).status,'checked');
 current.settings.rows[101]=[];current.advance(300001);await refresh(current);
 assert.equal(article(current).sentiment,'bad');assert.notEqual(risk(current).status,'checked');
});
test('untrusted shared positive, neutral or withdrawal projections cannot clear a known adverse event through a later empty fetch',async()=>{
 for(const update of [
  {title:'示例科技中标项目',summary:'新增订单'},
  {title:'示例科技发布办公地点信息',summary:'例行信息'},
  {title:'来源撤回该快讯',summary:'',status:'retracted'}
 ]){
  const current=world({rows101:[item({title:'示例科技被立案调查',summary:''})]});await refresh(current);
  const shared=world({now:base+300001,rows101:[item({...update,showTime:'2026-11-13 09:48:00'})]});await refresh(shared);
  current.advance(300001);current.api.hydrate(shared.api.serialize());assert.notEqual(risk(current).status,'checked');
  current.settings.rows[101]=[];current.advance(300001);await refresh(current);assert.notEqual(risk(current).status,'checked');
 }
});
test('replaying identical shared content cannot downgrade a locally checked snapshot',async()=>{
 const w=world();await refresh(w);const payload=plain(w.api.serialize());assert.equal(risk(w).status,'checked');w.api.hydrate(payload);assert.equal(risk(w).status,'checked');
});
for(const [label,change]of [
 ['unsupported schema',p=>p.schemaVersion=99],['unknown top-level fields',p=>p.extra='unexpected'],['invalid version',p=>p.version=-1],['malformed timestamp',p=>p.fetchedAt='today'],['oversized article set',p=>p.items=Array.from({length:501},()=>({...p.items[0]}))],['bad article code',p=>p.items[0].codes=['600000<script>']]
])test('hydrate rejects '+label+' without mutating the previous pool',async()=>{
 const w=world();await refresh(w);const before=JSON.stringify(w.api.serialize()),payload=plain(w.api.serialize());change(payload);
 assert.throws(()=>w.api.hydrate(payload));assert.equal(JSON.stringify(w.api.serialize()),before);
});
test('untrusted derived sentiment and hashes cannot turn factual adverse text into positive clearance',async()=>{
 const w=world({rows101:[item({title:'示例科技被立案调查',summary:''})]});await refresh(w);
 const payload=plain(w.api.serialize()),originalHash=article(w).versionHash;payload.items[0].sentiment='good';payload.items[0].versionHash='forged';
 // A receiver may reject derived-field tampering or reconstruct those fields
 // from the original text. Both must retain the existing adverse decision.
 try{w.api.hydrate(payload);}catch(error){assert.ok(error instanceof Error||typeof error.message==='string');}
 assert.equal(article(w).sentiment,'bad');assert.equal(article(w).versionHash,originalHash);assert.equal(risk(w).status,'blocked');
});
test('force cannot bypass the five-minute interval or buy extra source requests',async()=>{
 const w=world();await refresh(w);await w.api.refresh({force:true});w.advance(299999);await w.api.refresh({force:true});assert.equal(w.calls.length,2);
 w.advance(1);await w.api.refresh({force:true});assert.equal(w.calls.length,4);
});
test('concurrent refreshes coalesce into one pair of supplier calls',async()=>{
 const w=world();let release;const gate=new Promise(resolve=>release=resolve);let entered=false;
 w.settings.beforeResponse=async()=>{if(!entered){entered=true;await gate;}};
 const a=w.api.refresh(),b=w.api.refresh(),c=w.api.refresh({force:true});await Promise.resolve();release();await Promise.all([a,b,c]);assert.equal(w.calls.length,2);
});
test('manual pause refuses news wire without falsely marking the pool fetched',async()=>{
 const w=world({requested:false});await refresh(w);assert.equal(w.calls.length,0);assert.equal(risk(w).status,'unknown');assert.equal(w.api.snapshot.fetchedAt,null);
});
test('a hidden page refuses news wire even if automatic intent was enabled',async()=>{
 const w=world({hidden:true});await refresh(w);assert.equal(w.calls.length,0);assert.equal(risk(w).status,'unknown');
});
for(const reason of ['pause','hidden'])test('a late source response after '+reason+' cannot grant a new checked snapshot',async()=>{
 const w=world();let release;const pendingResponse=new Promise(resolve=>release=resolve);
 w.settings.beforeResponse=()=>pendingResponse;const pending=w.api.refresh();await Promise.resolve();
 if(reason==='pause')w.setRequested(false);else w.setHidden(true);release();await pending;
 assert.equal(w.api.snapshot.fetchedAt,null);assert.equal(risk(w).status,'unknown');
});
test('closed market hours still allow news while user intent is enabled',async()=>{
 const w=world({now:Date.parse('2026-11-14T12:00:00+08:00'),sessionOpen:false,rows101:[item({showTime:'2026-11-14 11:55:00'})]});await refresh(w);assert.equal(w.calls.length,2);assert.equal(risk(w).status,'checked');
});
test('oversized source data fails as unknown rather than entering shared cache',async()=>{
 const w=world();w.settings.body=' '.repeat(2*1024*1024+1);await refresh(w);assert.equal(risk(w).status,'unknown');assert.equal(w.api.snapshot.items.length,0);assert.ok(w.api.snapshot.lastError);
});
test('source content is escaped and unsafe links never enter executable markup',async()=>{
 const w=world({rows101:[item({title:'<img src=x onerror=alert(1)>中标',summary:'<script>alert(2)</script>',url:'javascript:alert(3)'})]});await refresh(w);
 const rendered=w.api.render({},w.context.V6Market.snapshot,{now:w.now});
 assert.match(rendered,/data-module-id="news-pool"/);assert.match(rendered,/data-news-refresh/);assert.match(rendered,/data-news-filter/);assert.match(rendered,/&lt;img/);assert.doesNotMatch(rendered,/<script>|<img src=x|href="javascript:/);
 assert.match(rendered,/600000/);assert.match(rendered,/09:40/);assert.match(rendered,/来源|东方财富/);
});
test('valid original links and stock focus remain actionable without writing an account',async()=>{
 const w=world();await refresh(w);const rendered=w.api.render({},w.context.V6Market.snapshot,{filter:'good',now:w.now});
 assert.match(rendered,/data-focus="600000"/);assert.match(rendered,/https:\/\/finance\.eastmoney\.com\/a\/20261113333333333\.html/);assert.match(rendered,/noopener|noreferrer/);assert.equal(w.calls.length,2);
});
test('news rendering names direct stocks and bounds the distinct known indirect stock list with its total',async()=>{
 const direct=stock({name:'源直联名称'}),peers=Array.from({length:14},(_,i)=>stock({symbol:String(600001+i),name:'芯片观察'+String(i+1).padStart(2,'0')}));
 const unknown=stock({symbol:'600015',name:'未知分类不列出',sectorClassificationKnown:false}),similar=stock({symbol:'600016',name:'半导体近似公司名',sector:'医药',sectorNode:'sector-drugs'});
 const w=world({stocks:[direct,...peers,unknown,similar],rows101:[item({title:'半导体行业风险提示',summary:'行业受到制裁'})]});await refresh(w);
 const markup=w.api.render({},w.context.V6Market.snapshot,{now:w.now}),content=markup.replace(/<[^>]*>/g,' '),focus=[...markup.matchAll(/data-focus="(\d{6})"/g)].map(m=>m[1]);
 assert.match(content,/源直联名称/);assert.match(content,/600000/);assert.equal(focus.filter(c=>c==='600000').length,1);
 const indirect=focus.filter(c=>c!=='600000');assert.equal(indirect.length,12);assert.equal(new Set(indirect).size,12);assert.ok(indirect.every(code=>peers.some(q=>q.symbol===code)));
 assert.match(content,/(?:共\s*14|14\s*只|12\s*\/\s*14)/);assert.match(content,/间接/);assert.match(content,/待核/);
 for(const code of indirect)assert.ok(content.includes(peers.find(q=>q.symbol===code).name));
 assert.doesNotMatch(content,/未知分类不列出|半导体近似公司名/);assert.equal(w.calls.length,2);
});
test('news rendering does not invent affected stocks from unknown classifications or similar company names',async()=>{
 const rows=[stock({symbol:'600001',name:'半导体行业模拟公司',sector:'医药',sectorNode:'sector-drugs'}),stock({symbol:'600002',name:'仅名称类似半导体股份',sectorClassificationKnown:false}),stock({symbol:'600003',name:'更长行业名称公司',sector:'半导体设备',sectorNode:'sector-equipment'})];
 const w=world({stocks:rows,rows101:[item({title:'半导体行业风险提示',summary:'行业受到制裁',stockList:[]})]});await refresh(w);
 const markup=w.api.render({},w.context.V6Market.snapshot,{now:w.now});assert.match(markup,/半导体行业风险提示/);assert.doesNotMatch(markup,/data-focus=/);
 for(const q of rows)assert.ok(!markup.includes(q.name));assert.equal(w.calls.length,2);
});
test('a source URL with embedded credentials is not exposed as a clickable original link',async()=>{
 const w=world({rows101:[item({url:'https://fixture-user:fixture-pass@finance.eastmoney.com/a/news.html'})]});await refresh(w);
 assert.doesNotMatch(w.api.render({},w.context.V6Market.snapshot,{now:w.now}),/href="[^"]*fixture-user/);
});
test('worst-case 500-news industry risk keeps full decisions but bounds per-stock references', {timeout:15000}, async t=>{
 const stocks=Array.from({length:5000},(_,i)=>stock({symbol:String(600000+i),name:'合成样本'+i}));
 const w=world({stocks,rows101:[],rows104:[]});
 for(let round=0;round<3;round++){
  if(round)w.advance(300001);
  for(const column of [101,104])w.settings.rows[column]=Array.from({length:100},(_,i)=>item({code:'perf-'+round+'-'+column+'-'+i,title:'半导体行业经营信息',summary:'公开经营资料。'.repeat(180)+(round===2&&column===104&&i===99?'公司被立案调查':''),showTime:round===2&&column===104&&i===98?'来源未提供':'2026-11-13 09:40:00',stockList:i<3?['1.'+stocks[i].symbol]:[]}));
  await refresh(w);
 }
 assert.equal(w.api.snapshot.items.length,500);
 const result=risk(w,stocks[0]);assert.equal(result.status,'blocked');assert.equal(result.matchedCount,500);
 assert.equal(result.articles.length,12);assert.equal(result.omittedCount,488);
 assert.ok(result.articles.some(row=>row.id==='perf-2-104-99'&&row.sentiment==='bad'));
 assert.ok(result.articles.some(row=>row.id==='perf-2-104-98'&&row.timeStatus==='unknown'));
 assert.ok(result.articles.every(row=>!Object.hasOwn(row,'summary')&&!Object.hasOwn(row,'sectors')&&!Object.hasOwn(row,'codes')));
 const original=result.articles[0].title;result.articles[0].title='caller mutation';assert.equal(risk(w,stocks[0]).articles[0].title,original);
 const {performance}=require('node:perf_hooks'),began=performance.now();let blocked=0;
 for(const q of stocks)if(risk(w,q).status==='blocked')blocked++;
 const elapsedMs=performance.now()-began;assert.equal(blocked,5000);assert.ok(elapsedMs<5000,'5000-stock risk projection exceeded a conservative 5-second offline bound');t.diagnostic('5000 stocks / 500 long summaries: '+elapsedMs.toFixed(2)+' ms; 12 short refs per stock. Not a browser or production benchmark.');
});

test('shared risk summaries expire and a valid source revision invalidates the warmed industry result',async()=>{
 const w=world({rows101:[item({title:'半导体行业被处罚',summary:'公开风险',stockList:[]})]});await refresh(w);
 for(let i=0;i<20;i++)assert.equal(risk(w).status,'blocked');
 const before=w.api.cacheKey(w.now);w.advance(600001);assert.notEqual(w.api.cacheKey(w.now),before);assert.equal(risk(w).status,'unknown');
 w.settings.rows[101]=[item({title:'原快讯明确撤稿',summary:'来源撤销原条目',showTime:'2026-11-13 09:55:00',status:'retracted',stockList:[]})];await refresh(w);
 assert.equal(risk(w).status,'checked');assert.equal(risk(w).matchedCount,0);assert.deepEqual(plain(risk(w).articles),[]);
});
