// 守门测试：定时器不许「同一件事两把锁」（2026-10-06 新增角度：定时器调度体检）
// guard(name, fn) 是**按名字**加锁的 —— 两个定时器若用不同 guard 名（或一个用 guard、
// 一个用自己的 busy 标记）跑同一个重函数，两把锁互不相认，到点就是**并发跑两次**：
//   ① computeBreadth 挂在 'breadth'(5min) 与 'beta'(30min) 两路下 → 每半小时并发两遍
//      全 A 遍历，且 computeBreadth 内部会 atomicWrite(BREADTH_FILE)，等于双倍写盘；
//   ② resolveSignalsDeep + resolveSignals 在复盘块（靠 reviewBusy）与 learn 定时器
//      （guard('learn')）各跑一遍 → 15:30 后并发补拉 K 线、并发写 stats.json，
//      等于自己打自己的数据源，越忙越容易撞限流，回验结果反而更旧。
// 修法都是「抽成共用同一把锁的函数」，本测试把这两处钉死。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const code = stripNoise(src, { keepStrings: true });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('\n=== 定时器调度守门 ===\n');

// 调用点统计（排除 function 定义行本身）
function callSites(fn) {
  const re = new RegExp('\\b' + fn + '\\s*\\(', 'g');
  const out = [];
  let m;
  while ((m = re.exec(code))) {
    const ln = code.slice(0, m.index).split('\n').length;
    const line = src.split('\n')[ln - 1];
    if (new RegExp('function\\s+' + fn + '\\s*\\(').test(line)) continue;   // 定义行
    if (new RegExp('const\\s+' + fn + '\\s*=').test(line)) continue;        // 常量定义行
    out.push(ln);
  }
  return out;
}

console.log('【① 市场宽度：只许有一路在算】');
const cb = callSites('computeBreadth');
console.log('   computeBreadth 调用点: L' + cb.join(', L'));
ok('computeBreadth 调用点 ≤ 2（rebuildPool 后一路 + breadth 定时器一路）', cb.length <= 2, '实际 ' + cb.length + ' 处');
// ⚠️ 必须按**块**判定：guard('beta') 与 guard('breadth') 紧挨着，用 [\s\S]{0,600} 这种
//    跨块正则会一路滑进下一个块里，把"已经删干净"误判成"还在算"（第一版就这么红的）。
const blk = (fromRe, toStr) => {
  const a = src.search(fromRe);
  if (a < 0) return '';
  const b = src.indexOf(toStr, a);
  return b < 0 ? '' : src.slice(a, b + toStr.length);
};
const betaBlk = blk(/guard\('beta', async \(\) => \{/, '30 * 60 * 1000)');
const breadthBlk = blk(/guard\('breadth', async \(\) => \{/, '5 * 60 * 1000)');
ok('beta 块内不再自己算宽度（只管 fetchMarketBeta）', betaBlk.length > 0 && !/computeBreadth/.test(betaBlk));
ok('beta 块仍在刷新大盘基准', /fetchMarketBeta/.test(betaBlk));
ok('breadth 块保留且仍会算宽度', breadthBlk.length > 0 && /computeBreadth/.test(breadthBlk));
ok('宽度结果仍会落盘（computeBreadth 内部 atomicWrite）', /function computeBreadth\(\)[\s\S]{0,2600}?atomicWrite\(BREADTH_FILE/.test(src));

console.log('\n【② 学习回验：复盘与 learn 定时器共用同一把锁】');
const rsd = callSites('resolveSignalsDeep');
const rs = callSites('resolveSignals');
console.log('   resolveSignalsDeep 调用点: L' + rsd.join(', L') + '  resolveSignals 调用点: L' + rs.join(', L'));
// ⚠️ 不能断言"全局只剩 1 处"：建池后顺带回验(L2557)、启动一次性补样本、/api/refresh 手动触发
//    都是合理调用点。要钉死的是**复盘块与 learn 定时器这两路不许各跑各的**。
const reviewBlk = blk(/setInterval\(async \(\) => \{\n    if \(reviewBusy\) return;/, '\n  }, 20000)');
const learnBlk = blk(/setInterval\(\(\) => \{ runLearnCycle\(30\)/, '10 * 60 * 1000)');
// ⚠️ 块内判定必须先剥注释：复盘块里那句「原来的 resolveSignals() 没包异常」是**注释**，
//    直接正则会把"已经改干净"判成"还在调"（第一版就这么红的）。
const reviewCode = stripNoise(reviewBlk, { keepStrings: true });
const learnCode = stripNoise(learnBlk, { keepStrings: true });
ok('复盘块内不再直接调 resolveSignalsDeep（改走 runLearnCycle）',
  reviewBlk.length > 0 && !/resolveSignalsDeep/.test(reviewCode), '块长 ' + reviewBlk.length);
ok('复盘块内不再直接调 resolveSignals（改走 runLearnCycle）',
  reviewBlk.length > 0 && !/resolveSignals\(\)/.test(reviewCode));
ok('learn 定时器块内不再直接调 resolveSignalsDeep',
  learnBlk.length > 0 && !/resolveSignalsDeep/.test(learnBlk), '块长 ' + learnBlk.length);
ok('全局调用点仍保留（建池后回验 / 启动补样本 / 手动刷新都还在）',
  rsd.length >= 2 && rs.length >= 2, 'deep=' + rsd.length + ' signals=' + rs.length);
ok('存在共用的 runLearnCycle，且由 guard(\'learn\') 包着', /const runLearnCycle = guard\('learn'/.test(src));
ok('复盘块调用 runLearnCycle（不再自己直接回验）', /\[复盘\][\s\S]{0,200}?|try \{ await runLearnCycle\(20\)/.test(src) || /await runLearnCycle\(20\)/.test(src));
ok('learn 定时器也调 runLearnCycle', /setInterval\(\(\) => \{ runLearnCycle\(30\)/.test(src));
ok('runLearnCycle 里 await 了重任务（guard 才不会当场释放锁）', /const runLearnCycle = guard\('learn'[\s\S]{0,900}?await resolveSignalsDeep/.test(src));

console.log('\n【③ guard 语义本身】');
ok('guard 按名字加锁（_taskBusy.get(name)）', /function guard\(name, fn\)[\s\S]{0,300}?_taskBusy\.get\(name\)/.test(src));
ok('guard 内部有 try/catch（周期性任务失败要"下轮再来"而不是抛给空气）', /function guard\(name, fn\)[\s\S]{0,700}?catch \(e\) \{ console\.error\(`\[guard:\$\{name\}\]/.test(src));
ok('guard 在 finally 释放锁', /function guard\(name, fn\)[\s\S]{0,700}?finally \{ _taskBusy\.delete\(name\)/.test(src));

console.log('\n【④ 反证】');
// 反证：扫描用的 callSites 得真能数出多处
const fake = 'function foo(){}\nfoo();\nfoo();\nfoo();';
const fakeCode = stripNoise(fake, { keepStrings: true });
(function () {
  const re = /\bfoo\s*\(/g; let n = 0, mm;
  const lines = fake.split('\n');
  while ((mm = re.exec(fakeCode))) {
    const ln = fakeCode.slice(0, mm.index).split('\n').length;
    if (/function\s+foo\s*\(/.test(lines[ln - 1])) continue;
    n++;
  }
  ok('反证：callSites 逻辑对 3 次调用能数出 3（定义行不算）', n === 3, '数出 ' + n);
})();

console.log('\n定时器调度守门：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
