'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectPushLogDelivery}=require('../src/core/notification-delivery-view');
const {pushLogKey,mergePushLogs}=require('../_pushlog_durable');

test('legacy success projects gateway acceptance without rewriting durable dedup identity or asserting receipt',()=>{
  for(const status of ['✅ 已送达','✅ 已送达(私密)','gateway-accepted','验证码(安全通道)']){
    const original={status,ts:1800000000000,title:'隔离通知',channel:'飞书·私密',codes:['600000']},before=JSON.stringify(original);
    const view=projectPushLogDelivery(original);
    assert.equal(view.status,status);assert.equal(view.deliveryStatus,'gateway-accepted');
    assert.equal(view.gatewayAccepted,true);assert.equal(view.receiverConfirmed,false);
    assert.match(view.deliveryLabel,/网关受理.*接收端未确认/);
    assert.equal(pushLogKey(view),pushLogKey(original));
    assert.equal(mergePushLogs([view],[original],500).length,1);
    assert.equal(JSON.stringify(original),before);
  }
});

test('uncertain, queued and locally blocked records retain different truthful delivery states',()=>{
  for(const [status,expected] of [['⚠️ 送达结果未知(私密)','unconfirmed'],['queued','queued'],
    ['夜间静默拦截','not-sent'],['🔒 私密未送达·不外发','not-sent'],['❌ 发送失败','unconfirmed']]){
    const view=projectPushLogDelivery({status});assert.equal(view.deliveryStatus,expected);
    assert.equal(view.receiverConfirmed,false);assert.equal(view.status,status);
  }
  const contradictory=projectPushLogDelivery({status:'✅ 已送达(私密)',error:'timeout'});
  assert.equal(contradictory.deliveryStatus,'unconfirmed');assert.equal(contradictory.gatewayAccepted,null);
});

test('plain log text, viewer state and unverified receiver labels cannot fabricate device confirmation',()=>{
  for(const row of [null,{}, {status:'receiver-confirmed',receiverConfirmed:true,viewed:true},
    {status:'已送达',receiverConfirmed:true}, {status:'🧠 学习完成'}]){
    const view=projectPushLogDelivery(row);assert.equal(view.receiverConfirmed,false);
    assert.notEqual(view.deliveryStatus,'receiver-confirmed');
    assert.doesNotMatch(view.deliveryLabel,/已送达|送达成功/);
  }
});
