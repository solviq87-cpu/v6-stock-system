/**
 * 守门测试：次日计划不显示 · 自动拉K线 + 启动补发 + 15:30后全量最新（2026-10-08）
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 次日计划：自动拉K线 + 启动补发 + 15:30后全量最新 ===\n');

console.log('【① 启动补发机制存在（同复盘）】');
ok(/const _nextPlanStartupCheck = async \(\) =>/.test(SRC), '次日计划有启动补发函数 _nextPlanStartupCheck');
ok(/setTimeout\(_nextPlanStartupCheck, 180 \* 1000\)/.test(SRC), '启动 3 分钟后试补发');
ok(/setTimeout\(_nextPlanStartupCheck, 10 \* 60 \* 1000\)/.test(SRC), '启动 10 分钟后再兜一次');
ok(/sentToday\(nextPlanSentDate, todayStr\(\), \/次日作战计划\//.test(SRC), '补发前判「今天已发过没」（双判据）');
ok(/await klineBackfill\(2000/.test(SRC), '补发前强制补齐 K 线（2000 只，不依赖定时器）');

console.log('\n【② 15:30 后 K 线强制补齐模式】');
ok(/进入极速补齐模式/.test(SV), '有"极速补齐模式"日志标记');
ok(/恢复日常补齐模式/.test(SV), '有"恢复日常补齐模式"日志标记');
ok(/_kbfFastTimer = setInterval\(_kbfTick\(true\), 30 \* 1000\)/.test(SRC), '15:30 后切到 30 秒间隔');
ok(/clearInterval\(_kbfDailyTimer\)/.test(SRC), '切极速路时清掉日常路（避免两路并发）');
ok(/clearInterval\(_kbfFastTimer\)/.test(SRC), '退出极速路时清掉极速路');
ok(/await klineBackfill\(afterClose \? 2000 : 1200\)/.test(SRC), '极速模式单次 2000 只、日常 1200 只');
ok(/if \(!afterClose && _kbfProg\.scanned >= 12000\) return;/.test(SRC), '15:30 后突破单日 12000 上限');

console.log('\n【③ computeNextPlan 失败时留痕（不许静默 return）】');
ok(/remedySkip\('nextPlanAuto', 'planEmpty'\)/.test(SRC), 'plan 为空时登记 remedySkip（planEmpty）');
ok(/remedySkip\('nextPlanAuto', 'computeException'\)/.test(SRC), '计算异常时登记 remedySkip（computeException）');
ok(/remedySkip\('nextPlanBoot',/.test(SRC), '启动补发也有 remedySkip 留痕');

console.log('\n【④ 次日计划定时器基本结构未被破坏】');
ok(/setInterval\(async \(\) => \{[\s\S]{0,200}?nextPlanBusy/.test(SRC), '次日计划自动定时器仍在');
ok(/t >= 15 \* 60 \+ 45/.test(SRC), '推送窗口仍是 15:45 之后');
// ⛔ 2026-10-08 改判据：次日计划加了 opts.private=true 走私密通道，正则跟着认新写法
ok(/if \(pushAll\(buildNextPlanMessage\(\), true, \{ private: true \}\) !== false\) nextPlanSentDate = ds/.test(SRC), '先发后置位（推送成功才闭锁）');

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
