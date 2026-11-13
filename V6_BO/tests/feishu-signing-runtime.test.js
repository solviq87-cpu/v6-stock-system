'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(require.resolve('../server'),'utf8');
const signature='dS97l9LWRDQR1VIj5lOPettZgMRsMjo0vQOh3/zjbbY='; // Independent Python hmac fixture.
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}\n',start)+2);}
function harness(env={},config={}){
 const sent=[];
 const https={request(options,callback){return {on(){return this;},setTimeout(){},destroy(){},end(body){
  sent.push({options,payload:JSON.parse(body.toString())});const handlers={};
  callback({statusCode:200,on(event,handler){handlers[event]=handler;}});
  handlers.data?.(JSON.stringify({code:0,msg:'success'}));handlers.end?.();
 } };}};
 const context={process:{env},S:{config},crypto,Buffer,Date:{now:()=>1599360473000},
  classifyFeishuReceipt:require('../src/core/feishu-receipt').classifyFeishuReceipt,
  console:{log(){},error(){}},require:name=>{assert.equal(name,'https');return https;},stripHtmlTags:x=>x};
 vm.createContext(context);
 for(const name of ['feishuId','feishuSecId','feishuProbe','feishuSendOnce','feishuSendPrivate'])vm.runInContext(fn(name),context);
 context._fsPrivateQueue={send:(job,cb)=>context.feishuProbe(job.id,job.secret,job.text).then(r=>cb(r.ok,r.msg))};
 return {context,sent,https};
}
test('signed private probe follows the official empty-message HMAC protocol',async()=>{
 const h=harness();const result=await h.context.feishuProbe('fixture-private-id','fixture-signing-key','测试卡片',h.https);
 assert.equal(result.ok,true);assert.equal(h.sent[0].payload.timestamp,'1599360473');assert.equal(h.sent[0].payload.sign,signature);
 assert.equal(h.sent[0].payload.content.text,'测试卡片');assert.equal(h.sent[0].options.hostname,'open.feishu.cn');
});
test('public sender uses runtime webhook and secret ahead of stored configuration',()=>{
 const h=harness({V6_FEISHU_PUBLIC_WEBHOOK:'https://open.feishu.cn/open-apis/bot/v2/hook/runtime-public-id',V6_FEISHU_PUBLIC_SECRET:'fixture-signing-key'},
  {feishuWebhook:'https://open.feishu.cn/open-apis/bot/v2/hook/old-public-id',feishuSecret:'old-key'});
 let result;h.context.feishuSendOnce('fixture card',ok=>result=ok);
 assert.equal(result,true);assert.ok(h.sent[0].options.path.endsWith('/runtime-public-id'));assert.equal(h.sent[0].payload.sign,signature);
});
test('unsigned robots stay compatible and legacy configured secrets still work',async()=>{
 const h=harness({}, {feishuWebhook:'https://open.feishu.cn/open-apis/bot/v2/hook/config-public-id',feishuSecret:'fixture-signing-key'});
 h.context.feishuSendOnce('configured',()=>{});assert.equal(h.sent[0].payload.sign,signature);
 await h.context.feishuProbe('unsigned-id','','unsigned',h.https);
 assert.equal(h.sent[1].payload.sign,undefined);assert.equal(h.sent[1].payload.timestamp,undefined);
});
test('ordinary default-private selection push consumes runtime secret without public or email delivery',async()=>{
 const h=harness({V6_FEISHU_PRIVATE_WEBHOOK:'https://open.feishu.cn/open-apis/bot/v2/hook/runtime-private-id',V6_FEISHU_PRIVATE_SECRET:'fixture-signing-key'}, {feishuSecSecret:'wrong-stored-secret'});
 Object.assign(h.context,{prepareRecommendationDelivery:text=>({ok:true,text}),redactSecrets:x=>x,extractStockCodes:()=>[],inManualPush:()=>false,
  isReplica:()=>false,msgGate:()=>({ok:true}),inQuietHours:()=>false,sseSendEdit(){},privReady:()=>true,pushLog(){},feishuSecMask:()=> 'masked',_pushLast:{},
  feishuSend:()=>assert.fail('private message reached public bot'),sendQQMail:()=>assert.fail('private message reached email')});
 vm.runInContext(fn('pushAll'),h.context);assert.equal(h.context.pushAll('fixture research observation',false),true);
 await Promise.resolve();await Promise.resolve();assert.equal(h.sent.length,1);
 assert.ok(h.sent[0].options.path.endsWith('/runtime-private-id'));assert.equal(h.sent[0].payload.sign,signature);
});
test('probing a replacement bot never silently reuses the current bot signing key',async()=>{
 const start=source.indexOf("if (p === '/api/feishu/probe'");const end=source.indexOf('\n  // 之前只有一个',start);
 const block=source.slice(start,end);assert.ok(start>0&&end>start);
 for(const body of [{},{webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/replacement-id'},{webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/replacement-id',secret:'explicit'}]){
  const calls=[];const c={p:'/api/feishu/probe',req:{method:'POST'},res:{},u:{searchParams:new URLSearchParams()},body:JSON.stringify(body),S:{config:{}},
   process:{env:{V6_FEISHU_PUBLIC_WEBHOOK:'https://open.feishu.cn/open-apis/bot/v2/hook/runtime-public-id',V6_FEISHU_PUBLIC_SECRET:'current-private-key'}},
   requireEditor:()=>true,feishuProbe:(id,key)=>{calls.push({id,key});return Promise.resolve({ok:true});},json(){},maskHook:()=> 'masked',feishuErrTip(){}};
  vm.runInNewContext('(function(){'+block+'})()',c);await Promise.resolve();
  assert.equal(calls[0].key,body.secret??(body.webhook?'':'current-private-key'));
 }
});
test('diagnostics judge the actual private route, independent of public/email setup',()=>{
 const start=source.indexOf('if (diag.replica) diag.verdict =');const end=source.indexOf('\n    if (!sDry)',start);assert.ok(start>0&&end>start);
 for(const privateReady of [true,false]){
  const c={diag:{replica:false,trading:true,quiet:false},feishuSecReady:()=>privateReady,feishuReady:()=>!privateReady,mailReady:()=>!privateReady};
  vm.runInNewContext(source.slice(start,end),c);
  assert.match(c.diag.verdict,privateReady?/未确认手机送达/:/默认私密推送通道未配置/);
 }
});
