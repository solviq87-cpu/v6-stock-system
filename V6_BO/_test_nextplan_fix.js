/**
 * 守门测试：次日计划启动补发保留，历史补齐统一受预算保护。
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const { POLICY } = require('./src/strategy/history-backfill-budget');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 次日计划：启动补发 + 有界历史补齐 ===\n');

console.log('【① 启动补发机制存在（同复盘）】');
ok(/const _nextPlanStartupCheck = async \(\) =>/.test(SRC), '次日计划有启动补发函数 _nextPlanStartupCheck');
ok(/setTimeout\(_nextPlanStartupCheck, 180 \* 1000\)/.test(SRC), '启动 3 分钟后试补发');
ok(/setTimeout\(_nextPlanStartupCheck, 10 \* 60 \* 1000\)/.test(SRC), '启动 10 分钟后再兜一次');
ok(/sentToday\(nextPlanSentDate, todayStr\(\), \/次日作战计划\//.test(SRC), '补发前判「今天已发过没」（双判据）');
ok(/await klineBackfill\(HISTORY_BACKFILL_POLICY\.batchLimit, 60\)/.test(SRC), '补发前补历史也使用统一单轮上限');

console.log('\n【② 盘后与其他入口共享有界历史预算】');
ok(POLICY.batchLimit > 0 && POLICY.batchLimit <= 60, '单轮最多60只');
ok(POLICY.minIntervalMs >= 60000, '调度至少间隔60秒');
ok(POLICY.dailyLimit > 0 && POLICY.dailyLimit <= 6000, '日预算有明确安全上限');
ok(/setInterval\(_kbfTick, HISTORY_BACKFILL_POLICY\.minIntervalMs\)/.test(SRC), '统一调度器采用同一最小间隔');
ok(!/_kbfFastTimer|afterClose\s*\?\s*2000\s*:\s*1200/.test(SRC), '不存在额外盘后极速补齐通道');
ok(/_kbfBudget\.reserve\(todo,/.test(SRC), '手动与自动进入同一预算预留入口');
ok(!/!afterClose\s*&&\s*_kbfProg\.scanned\s*>=/.test(SRC), '没有盘后豁免日预算的分支');

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
