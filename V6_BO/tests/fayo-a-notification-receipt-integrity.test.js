'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyFeishuReceipt:receipt}=require('../src/core/feishu-receipt');
const {projectPushLogDelivery:project}=require('../src/core/notification-delivery-view');
const {pushLogKey,mergePushLogs}=require('../_pushlog_durable');
const unknown=r=>{assert.equal(r.ok,false);assert.equal(r.status,'unknown');assert.match(r.msg,/^送达结果未知/);};
const unconfirmed=r=>{assert.equal(r.deliveryStatus,'unconfirmed');assert.equal(r.gatewayAccepted,null);assert.equal(r.receiverConfirmed,false);};
// T1: malformed business codes are not definite rejections.
test('unsafe integer business codes cannot establish a rejection',()=>{
 for(const code of [Number.MAX_SAFE_INTEGER+1,1e30])unknown(receipt(200,{code}));
});
test('both business aliases must be valid when supplied',()=>{
 for(const StatusCode of [null,'0',NaN,Number.MAX_SAFE_INTEGER+1])unknown(receipt(200,{code:0,StatusCode}));
});
// T2: mismatched nonzero business aliases cannot select a favorable retry code.
test('conflicting nonzero codes cannot authorize a retry',()=>{
 for(const payload of [{code:11232,StatusCode:19021},{code:19021,StatusCode:11232},{code:9499,StatusCode:19021,msg:'too many requests'}])unknown(receipt(200,payload));
});
test('matching numeric aliases and original zero-versus-rejection behavior remain intact',()=>{
 assert.equal(receipt(200,{code:0,StatusCode:0}).ok,true);
 assert.equal(receipt(200,{code:19021,StatusCode:19021}).status,'rejected');
 unknown(receipt(200,{code:0,StatusCode:19021}));
});
// T3: an explicitly accepted response body conflicts with HTTP rejection.
test('HTTP 4xx cannot authorize rejection when the supplied body claims acceptance',()=>{
 for(const code of [400,401,403,429,499])for(const payload of [{code:0},{StatusCode:0},{code:0,StatusCode:19021}])unknown(receipt(code,payload));
});
test('a genuine status-only HTTP rejection remains supported, with uncertain statuses separate',()=>{
 assert.deepEqual(receipt(429,null),{ok:false,status:'rejected',msg:'HTTP 429'});
 assert.equal(receipt(403,{code:19021}).status,'rejected');
 for(const code of [408,500,503,302,undefined])unknown(receipt(code,{code:0}));
});
// T4: reject unsafe text coercion, contradictory aliases, and transport uncertainty.
test('rate limit text must not be manufactured by coercing a non-string message',()=>{
 for(const msg of [['too many requests'],{value:'rate limit'},true,11232])unknown(receipt(200,{code:9499,msg}));
});
test('competing rate-limit and non-rate message aliases remain uncertain',()=>{
 for(const [msg,StatusMessage] of [['too many requests','invalid signature'],['invalid signature','too many requests']])unknown(receipt(200,{code:11232,msg,StatusMessage}));
});
test('transport uncertainty cannot be erased by a numeric rejection or acceptance code',()=>{
 for(const msg of ['timeout while reading HTTP 429','socket disconnected','送达结果未知','HTTP 502','回执互相矛盾'])for(const code of [0,11232,9499])unknown(receipt(200,{code,msg}));
});
test('a positive code with an explicit rate rejection message is contradictory',()=>{
 for(const msg of ['too many requests','rate limit exceeded'])unknown(receipt(200,{code:0,msg}));
});
test('genuine rate-limit and normal business errors retain original behavior without echoing raw bodies',()=>{
 assert.equal(receipt(200,{code:9499,msg:'too many requests'}).msg,'code=9499 too many requests');
 assert.equal(receipt(200,{StatusCode:11232,StatusMessage:'rate limit exceeded'}).msg,'code=11232 too many requests');
 assert.equal(receipt(200,{code:19021,msg:'success'}).status,'rejected');
 assert.equal(receipt(200,{code:19021,msg:'private-hook=SECRET'}).msg,'code=19021 业务拒绝');
 assert.deepEqual(receipt(200,{code:0,msg:'success'}),{ok:true,status:'accepted',msg:'ok'});
});
// T5: the read-only projection must consider all contradictory evidence.
test('a benign error alias cannot hide a contradictory detail',()=>{
 unconfirmed(project({status:'gateway-accepted',error:'ok',detail:'HTTP 502 timeout'}));
 unconfirmed(project({status:'✅ 已送达',error:'success',detail:'送达结果未知'}));
});
test('accepted legacy status with a definite negative or malformed error stays uncertain',()=>{
 for(const patch of [{error:'HTTP 429'},{error:'signature invalid'},{detail:'网关拒绝'},{error:{reason:'timeout'}},{gatewayAccepted:false}])unconfirmed(project({status:'✅ 已送达(私密)',...patch}));
});
test('a malformed detail cannot certify accepted delivery or receiver confirmation',()=>{
 unconfirmed(project({status:'gateway-accepted',detail:['timeout']}));
});
test('projection preserves original status, durable key, source row, and normal receipt semantics',()=>{
 const row={status:'✅ 已送达(私密)',ts:1800000000000,title:'隔离通知',channel:'飞书·私密',error:'ok',detail:'success',codes:['600000']};const before=JSON.stringify(row),v=project(row);
 assert.equal(v.gatewayAccepted,true);assert.equal(v.receiverConfirmed,false);assert.equal(v.status,row.status);
 assert.equal(pushLogKey(v),pushLogKey(row));assert.equal(mergePushLogs([v],[row],500).length,1);assert.equal(JSON.stringify(row),before);
 assert.equal(project({status:'queued'}).deliveryStatus,'queued');assert.equal(project({status:'夜间静默拦截'}).deliveryStatus,'not-sent');
});
