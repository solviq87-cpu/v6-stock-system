#!/usr/bin/env node
/**
 * Private outbound notification static regression gate (2026-11-05).
 *
 * In 2026-10 the old gate required mustDeliver to allow a private->public
 * fallback. That policy was replaced by the safer invariant that NO private
 * message, including an OTP, may be publicly retransmitted on failure.
 * The old test remained in the offline audit and falsely reported nine fails.
 *
 * This audit deliberately checks fail-closed structure and the absence of
 * outbound public transports from the private branch. It is not a live
 * Feishu delivery or network fault-injection test.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
let pass=0,fail=0;
const check=(name,condition)=>{
 const ok=!!condition;
 console.log('  '+(ok?'✅ ':'❌ ')+name);
 if(ok)pass++;else fail++;
};
function between(source,start,end){
 const a=source.indexOf(start);
 if(a<0)return '';
 const b=source.indexOf(end,a+start.length);
 return b>=0?source.slice(a,b):'';
}
// Only source inside pushAll; do not accidentally match a second route.
const push=between(src,'function pushAll(text, force, opts) {','function feishuSend(');
const priv=between(push,'  if (opts && opts.private) {','  // 通道1：飞书自定义机器人');
console.log('\n=== A. 默认私密，只有明确 public:true 才能进公共通道 ===');
check('pushAll真实实现存在',push.length>1000);
check('缺省选项自动私密',/if\s*\(!opts\)\s*opts\s*=\s*\{\s*private:\s*true\s*\}/.test(push));
check('显式 public:true 才能改变默认私密路径',/opts\.public\s*===\s*true/.test(push));
check('未声明 public 的选项仍会强制 private',/else\s+if\s*\(!opts\.private\)\s*opts\s*=\s*Object\.assign\([^\n]*private:\s*true/.test(push));
console.log('\n=== B. 私密发送只走私密机器人，失败不退回群或邮箱 ===');
check('定位到独立私密发送分支',priv.length>1200);
check('私密通道不可用时阻止外发并回滚',/if\s*\(!privReady\(\)\)/.test(priv)&&/_release\('私密通道未配置'\)/.test(priv)&&/return false;/.test(priv));
check('私密分支只向私密机器人发送',/feishuProbe\(feishuSecId\(/.test(priv));
check('私密分支没有公共飞书发送',!/\bfeishuSend\s*\(/.test(priv));
check('私密分支没有邮件或旧群直发',!/\b(?:sendMail|mailSend|pushWecom|sendWecom)\s*\(/.test(priv));
check('明确拒绝和异常都写脱敏私密失败流水',
 (priv.match(/pushLog\('🔒 私密未送达·不外发', '\[私密消息已隐藏\]'/g)||[]).length>=3);
check('明确拒绝和异常后回滚额度，不改发群',
 /_release\('私密通道拒收'\)/.test(priv)&&/_release\('私密通道异常'\)/.test(priv));
check('明确拒绝和异常时不以mustDeliver作为公开发送例外',
 !/\bif\s*\([^)]*mustDeliver/.test(priv)&&!/\bfeishuSend\s*\(/.test(priv));
check('送达结果未知保护防重复',
 (priv.match(/sendResultUnknown\(/g)||[]).length===2&&(priv.match(/送达结果未知\(私密\)/g)||[]).length===2);
check('私密分支终止后不进入公共飞书或邮箱',
 /return true;\s*\/\/[^\n]*绝不再往下走群机器人/.test(priv));
console.log('\n=== C. 历史失效的mustDeliver组群兜底不允许复活 ===');
check('没有必达标志作为公共重传旁路',!/mustDeliver:\s*true/.test(src));
check('所有行情/验证码私密失败都不得退回群的禁止说明仍在',
 /Private content is never eligible for a public fallback, including mustDeliver/.test(priv));
check('明确拒绝时没有调用公开发信通道',!/_release\('私密通道拒收'\)[\s\S]{0,100}\bfeishuSend\s*\(/.test(priv));
console.log('\n=== D. 手动通知不能默认穿透夜间静默 ===');
const pn=between(src,"if (p === '/api/push-note'",'// ── 发布看板移动端 API');
check('找到push-note处理',pn.length>350);
check('force只在显式true时启用',/nForce\s*=\s*b\.force\s*===\s*true/.test(pn));
check('推送调用使用nForce，而非固定true',/pushAll\([^)]*nForce,\s*\{\s*manual:\s*true/.test(pn));
check('响应回报实际force设置',/force:\s*nForce/.test(pn));
console.log('\n'+(fail?'❌':'✅')+` 私密不外泄静态审计：${pass}通过 / ${fail}失败`);
process.exitCode=fail?1:0;
