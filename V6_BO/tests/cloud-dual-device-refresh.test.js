'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const mobile=read('public/mobile.html'),desktop=read('public/index.html');
const extract=(start,end)=>{
 const a=mobile.indexOf(start),b=mobile.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing mobile runtime markers '+start);
 return mobile.slice(a,b);
};
function runtime(fetchImpl){
 const elements=new Map();
 for(const name of ['app','err','foot','gate','sub'])
  elements.set(name,{style:{display:name==='app'?'none':''},textContent:''});
 let lastRendered=null,fetchCount=0,gateCount=0;
 const ctx={_lastLoad:0,Date,encodeURIComponent,getToken:()=>'',fetch:(...args)=>{
  fetchCount++;return fetchImpl(...args);
 },render:data=>{lastRendered=data;elements.get('app').style.display='';},
 showGate:()=>{gateCount++;},document:{getElementById:id=>elements.get(id)}};
 const code=extract('// Mobile and desktop are two read-only clients','\nfunction showGate(){');
 vm.runInNewContext(code+'\nglobalThis.__run=load;globalThis.__manual=manualMobileRefresh;',ctx);
 return {ctx,elements,run:ctx.__run,manual:ctx.__manual,
  rendered:()=>lastRendered,calls:()=>fetchCount,gated:()=>gateCount};
}
test('desktop and mobile expose explicit cloud GET refresh without client-side write',()=>{
 assert.match(desktop,/id="btnCloudRefresh"[^>]*onclick="refresh\(\)"/);
 assert.match(desktop,/<script src="\/assets\/app\.js\?v=/);
 assert.match(read('public/assets/app.js'),/async function refresh\(\)/);
 assert.match(read('public/assets/app.js'),/fetchStateOnce\(\)/);
 assert.match(mobile,/id="mobileCloudRefresh"[^>]*onclick="manualMobileRefresh\(\)"/);
 assert.match(mobile,/v6-mobile-refresh-accessible" aria-label="从云端刷新页面数据"/);
 assert.match(mobile,/fetch\('\/api\/mobile-digest'/);
 assert.doesNotMatch(extract('// Mobile and desktop are two read-only clients','\nfunction showGate(){'),/method\s*:\s*['"]POST/);
});
test('mobile concurrent requests are coalesced and never overwrite a newer shared snapshot',async()=>{
 let release;
 const pending=new Promise(resolve=>release=resolve);
 const state=runtime(async(uri,opts)=>{
  assert.equal(uri,'/api/mobile-digest');
  assert.equal(opts.cache,'no-store');
  await pending;
  return {ok:true,status:200,json:async()=>({isSnapshot:true,snapshotDay:'20261106'})};
 });
 const first=state.run(),overlap=await state.run();
 assert.equal(overlap,false);assert.equal(state.calls(),1);
 release();
 assert.equal(await first,true);
 assert.equal(state.rendered().snapshotDay,'20261106');
 assert.equal(await state.manual(),true);
 assert.equal(state.calls(),2);
});
test('mobile retains previous cloud screen with stale label on 502 rather than pretending it is live',async()=>{
 let fail=false;
 const state=runtime(async()=>fail?{ok:false,status:502}:{
  ok:true,status:200,json:async()=>({isSnapshot:true,snapshotDay:'20261106'})});
 assert.equal(await state.run(),true);
 fail=true;
 assert.equal(await state.manual(),false);
 assert.equal(state.elements.get('app').style.display,'');
 assert.match(state.elements.get('sub').textContent,/上次画面（非实时）/);
 assert.equal(state.rendered().snapshotDay,'20261106');
});
test('mobile HTTP 401 revokes old display and returns to authentication',async()=>{
 let unauthorized=false;
 const state=runtime(async()=>unauthorized?{status:401}:{
  ok:true,status:200,json:async()=>({isSnapshot:false})});
 assert.equal(await state.run(),true);unauthorized=true;
 assert.equal(await state.manual(),false);
 assert.equal(state.gated(),1);
});
test('foreground iPhone resumes cloud sync; background and uninitialized view do not',()=>{
 const source=extract('function onPageVisible() {',"document.addEventListener('visibilitychange', onPageVisible)");
 const app={style:{display:''}};
 let calls=0;
 const ctx={Date:{now:()=>40000},_verChkAt:30000,document:{hidden:false,
  getElementById:()=>app},manualMobileRefresh:()=>{calls++;},checkMobVer:()=>{}};
 vm.runInNewContext(source+'\nglobalThis.__run=onPageVisible;',ctx);
 ctx.__run();assert.equal(calls,1);
 ctx.document.hidden=true;ctx.__run();assert.equal(calls,1);
 ctx.document.hidden=false;app.style.display='none';ctx.__run();assert.equal(calls,1);
});
test('weekend quotes preserve actual snapshot date, and independent weekend news stays authorized',()=>{
 assert.match(mobile,/const snap = d\.isSnapshot/);
 assert.match(mobile,/const snapDay = snap \? fmtDay\(d\.snapshotDay\)/);
 assert.match(mobile,/⏸ 休市 · 显示 /);
 const guard=read('_test_holiday_push.js');
 assert.match(guard,/新闻汇总不再被 isTradeDay 卡住（休市日照发）/);
 assert.match(guard,/放松新闻的同时，竞价\/复盘\/趋势\/盯盘仍被 isTradeDay 拦住/);
 assert.match(read('docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md'),/周六、周日和长假/);
});
