'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=read('server.js'),policy=read('docs/CLOUD_DUAL_DEVICE_WEEKEND_POLICY.md');
test('weekday market push remains trading-day gated while weekends never make old prices live',()=>{
 assert.match(server,/if \(!isTradeDay\(d\)\) return;/);
 assert.match(server,/if \(!isTradeDay\(new Date\(\)\)\) return;/);
 assert.match(server,/isContinuousTrading/);
 assert.match(policy,/周末、节假日不推旧价衍生的买卖信号/);
 assert.match(read('public/mobile.html'),/⏸ 休市 · 显示 /);
});
test('daily news push stays independent of market holidays and weekend digest has dedup window',()=>{
 // Check actual runtime source, not merely an unused legacy test specification.
 const daily=server.match(/if \(d\.getDay\(\) !== 0 && t >= 21 \* 60 && t < 24 \* 60 && !sentToday\(digestSentDate, ds,[^\n]+/);
 assert.ok(daily,'non-Sunday news notification is eligible on market holidays');
 assert.ok(!daily[0].includes('isTradeDay('),'holiday must not block news');
 assert.match(server,/d\.getDay\(\) === 0 && t >= 21 \* 60 && t < 24 \* 60 && !sentToday\(weekendSentDate, ds,/);
 assert.match(policy,/周六、周日新闻抓取和汇总允许继续/);
});
test('Feishu remains the cloud-side push path with private/public separation',()=>{
 const dual=read('docs/V6_飞书双通道统一推送约定.md');
 assert.match(dual,/私密通道不可用时返回未送达，不允许公共兜底/);
 assert.match(dual,/复制\/测试环境禁止真实发送/);
 assert.match(policy,/统一由云端发送/);
 assert.match(policy,/两台网页不构成两个推送实例/);
 const desktop=read('public/index.html'),mobile=read('public/mobile.html');
 assert.match(desktop,/id="btnCloudRefresh"[^>]*onclick="refresh\(\)"/);
 assert.match(mobile,/id="mobileCloudRefresh"[^>]*onclick="manualMobileRefresh\(\)"/);
});
test('unverified and private Feishu risk summary cannot be auto-sent from a client',()=>{
 const cli=read('scripts/private-risk-notify.js');
 assert.match(cli,/V6_RISK_NOTIFY_CONSENT/);
 assert.match(cli,/const send=argv\[2\]==='--send'/);
 const gate=read('src/core/private-risk-feishu-delivery.js');
 assert.match(gate,/deliveredToDevice:false/);
 assert.match(gate,/pending-unknown/);
 assert.match(policy,/私密 Webhook\/签名密钥仅在云端安全环境变量/);
});
