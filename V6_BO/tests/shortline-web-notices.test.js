const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {noticeView,noticeDeviceAction,hasDueWebNotices,syncNoticeSchedule,resetNoticeArchive,tickWebNotices,vapidHeaders}=require('../src/research/shortline/web-notices.mjs');
const {settingsAt}=require('../public/nova/shortline/settings.mjs');
const {enableDevice,noticeList}=require('../public/nova/shortline/web-notices.mjs');
const day='2024-01-23',now=Date.parse(day+'T16:00:01+08:00'),url='https://fcm.googleapis.com/fcm/send/FakeTestEndpointForUnitTests';
const initial=()=>({scope:'live',settingsHistory:[{version:1,effectiveAt:'2024-01-01T00:00:00Z',config:{...settingsAt({}),dailyReviewTime:'16:00'}}]});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-notice-')),dir=path.join(root,'books','book-1000000000000000');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,dir,state:initial(),book:'book-1000000000000000',primary:true,tradingDay:true,day,now};
}
function addDevice(o,endpoint=url){return noticeDeviceAction({...o,action:'notice:subscribe',payload:{endpoint}});}
test('inactive or demo schedules, replicas, nontrading days and early times do not create a notification',async t=>{
 const x=fixture(t);
 assert.equal(hasDueWebNotices(x),false);syncNoticeSchedule(x);assert.equal(hasDueWebNotices(x),true);
 for(const overrides of [{primary:false},{tradingDay:false},{isPrimary:()=>false},{book:'demo'},{day:'2024-01-22'},{now:now-60000}]){
  assert.deepEqual(await tickWebNotices({...x,...overrides}),{sent:0,generated:0});
 }
 assert.equal(noticeView(x).notices.length,0);
 x.state.settingsHistory[0].config.dailyReviewTime='';syncNoticeSchedule(x);assert.equal(hasDueWebNotices(x),false);
 assert.deepEqual(await tickWebNotices(x),{sent:0,generated:0});
});
test('due research review is a durable account-local inbox without devices; resuming a process does not repeat the day',async t=>{
 const x=fixture(t);syncNoticeSchedule(x);
 const result=await tickWebNotices({...x,sendPush:()=>assert.fail('no authorized device')});assert.deepEqual(result,{sent:0,generated:1});
 assert.equal(hasDueWebNotices(x),false);let inbox=noticeView(x);
 assert.equal(inbox.notices[0].day,day);assert.equal(inbox.devices,0);assert.ok(inbox.notices[0].text);
 assert.deepEqual(await tickWebNotices({...x}),{sent:0,generated:0});
 assert.equal(noticeView({...x,dir:x.root,book:'main'}).notices.length,0);
 resetNoticeArchive(x);assert.equal(noticeView(x).notices.length,0);
});
test('fixed push service endpoints, eight-device bound, redacted public view, mode 0600, VAPID signature and blank payload',async t=>{
 const x=fixture(t);
 assert.throws(()=>addDevice({...x,replica:true}));assert.throws(()=>addDevice({...x,book:'demo'}));
 for(const bad of ['http://fcm.googleapis.com/fcm/send/abcdef','https://127.0.0.1/abcd','https://fcm.googleapis.com:8443/fcm/send/token','https://fcm.googleapis.com.evil.test/fcm/send/z','https://fcm.googleapis.com/anything/else','https://user@web.push.apple.com/abc'])assert.throws(()=>addDevice(x,bad));
 const key=noticeDeviceAction({...x,action:'notice:key',payload:{}}).publicKey;
 assert.equal(Buffer.from(key,'base64url').length,65);
 assert.equal(addDevice(x).devices,1);assert.equal(addDevice(x).devices,1);
 const keysFile=path.join(x.root,'research-vapid-key-v1.json');
 assert.equal(fs.statSync(keysFile).mode&0o777,0o600);
 const keys=JSON.parse(fs.readFileSync(keysFile,'utf8')),headers=vapidHeaders(url,keys,'t',now);
 const token=/^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization);
 const [h,claims,sig]=token[1].split('.');
 assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'ES256');
 assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,'https://fcm.googleapis.com');
 assert.equal(JSON.parse(Buffer.from(claims,'base64url')).exp,Math.floor(now/1000)+3600);assert.equal(headers['Content-Length'],'0');
 const pub=crypto.createPublicKey(crypto.createPrivateKey({key:keys.jwk,format:'jwk'}));
 assert.ok(crypto.verify('sha256',Buffer.from(h+'.'+claims),{key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url')));
 for(let i=1;i<8;i++)addDevice(x,url+i);
 assert.throws(()=>addDevice(x,url+'tooMany'),/8 台/);
 assert.equal(noticeView(x).devices,8);assert.ok(!JSON.stringify(noticeView(x)).includes(url));
 assert.equal(fs.statSync(path.join(x.dir,'research-notices-v1.json')).mode&0o777,0o600);
 assert.equal(noticeDeviceAction({...x,action:'notice:unsubscribe',payload:{endpoint:url}}).devices,7);
});
test('concurrent ticks reserve one delivery, retry honours supplier delay, gone endpoint is removed',async t=>{
 const x=fixture(t);syncNoticeSchedule(x);addDevice(x);
 let calls=0,release;const latch=new Promise(r=>release=r);
 const first=tickWebNotices({...x,sendPush:async(endpoint,keys,topic,when)=>{
  assert.equal(endpoint,url);assert.equal(when,now);assert.ok(keys.publicKey);assert.ok(topic.length<=32);calls++;await latch;return {status:429,retryAt:now+180000};
 }});
 await new Promise(r=>setImmediate(r));
 const second=await tickWebNotices({...x,sendPush:()=>assert.fail('duplicate send')});assert.equal(second.sent,0);
 release();await first;assert.equal(calls,1);
 assert.equal(hasDueWebNotices({...x,now:now+120000}),false);
 assert.equal(hasDueWebNotices({...x,now:now+180000}),true);
 const retry=await tickWebNotices({...x,now:now+180000,sendPush:async()=>410});assert.equal(retry.sent,0);
 assert.equal(noticeView(x).devices,0);assert.equal(hasDueWebNotices({...x,now:now+800000}),false);
});
test('muted categories retain private facts without sending; withdrawing a subscription cancels retries',async t=>{
 const x=fixture(t);addDevice(x);x.state.settingsHistory[0].config.mutedAlertTypes=['review'];
 const quiet=await tickWebNotices({...x,sendPush:()=>assert.fail('muted delivery')});
 assert.equal(quiet.generated,1);assert.equal(noticeView(x).notices[0].muted,true);
 resetNoticeArchive(x);x.state.settingsHistory[0].config.mutedAlertTypes=[];
 await tickWebNotices({...x,sendPush:async()=>502});
 noticeDeviceAction({...x,action:'notice:unsubscribe',payload:{endpoint:url}});
 await tickWebNotices({...x,now:now+90000,sendPush:()=>assert.fail('cancelled retry')});
});
test('authenticated replica inbox renders escaped private notes and never requests a device subscription',async()=>{
 const x={state:{permissions:{canWrite:false}},readView:async()=>({notices:[{title:'收盘<script>',text:'私有正文'}]}),modal(title,html,save){assert.equal(save,null);assert.match(html,/&lt;script&gt;/);},save(){assert.fail();}};
 await enableDevice(x,{canEdit:true},'main');
 assert.match(noticeList([]),/暂无/);assert.match(noticeList([{title:'<',text:'a"&'}]),/a&quot;&amp;/);
});
test('web push banner discards supplied payload and click opens a fixed same-origin authenticated route',async()=>{
 const handlers={},shown=[];let pending,opened;
 const self={location:{origin:'https://example.test'},addEventListener:(key,fn)=>handlers[key]=fn,
   registration:{showNotification:(title,params)=>shown.push([title,params])},
   clients:{matchAll:async()=>[],openWindow:u=>{opened=u;}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8'),{self,URL,location:self.location,caches:{},Date,Set,Map});
 handlers.push({data:{text(){assert.fail('private push payload read');}},waitUntil:p=>pending=p});await pending;
 assert.equal(shown.length,1);assert.equal(shown[0][1].data.researchNotice,true);
 handlers.notificationclick({notification:{data:{researchNotice:true,url:'https://foreign.example/'},close(){}},waitUntil:p=>pending=p});await pending;
 assert.equal(opened,'https://example.test/#/lab/shortline-settings');
});
test('matching consecutive-month risk becomes an account inbox item with its costs and support, once per warning period',async t=>{
 const x=fixture(t),date='2024-04-18',instant=Date.parse(date+'T16:00:01+08:00');
 x.state.trades=[];
 for(const [m,pnls] of Object.entries({'01':[4,4,4,4,-1],'02':[3,3,3,-2,-2],'03':[2,2,-4,-4,-4]})){
  pnls.forEach((pnl,i)=>{const d='2024-'+m+'-10';
   x.state.trades.push({id:d+'/'+i,date:d,exitDate:d,name:'样本',code:'600000',entryTime:d+'T09:35',exitTime:d+'T14:00',createdAt:d+'T07:00:00Z',pnl,factors:['题材承接'],trend:'震荡',strategy:'龙头',snapshotVerified:true});
  });
 }
 await tickWebNotices({...x,day:date,now:instant,sendPush:()=>assert.fail()});
 const risk=noticeView(x).notices.filter(n=>n.type==='risk');assert.equal(risk.length,1);assert.match(risk[0].text,/2024-03 5 笔/);
 await tickWebNotices({...x,day:'2024-04-19',now:instant+86400000,sendPush:()=>assert.fail()});
 assert.equal(noticeView(x).notices.filter(n=>n.type==='risk').length,1);
});
test('archive reset epoch hides stale bodies and suppresses writes when snapshot guard becomes stale',async t=>{
 const x=fixture(t);addDevice(x);syncNoticeSchedule(x);
 const stale=await tickWebNotices({...x,isCurrent:()=>false,sendPush:()=>assert.fail('stale')});assert.equal(stale.generated,0);
 const statuses=[true,true,false];await tickWebNotices({...x,isCurrent:()=>statuses.shift()??false,sendPush:()=>assert.fail('stale')});
 assert.equal(noticeView(x).notices.length,0);
 await tickWebNotices({...x,sendPush:async()=>503});
 x.state.ledgerStartAt=now+1;assert.equal(noticeView(x).notices.length,0);
 await tickWebNotices({...x,now:now+1000,sendPush:async()=>200});
 assert.ok(noticeView(x).notices.every(n=>n.createdAt>=x.state.ledgerStartAt));
});
