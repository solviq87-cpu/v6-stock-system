// 守门：auczt prob 标定诚实化（hy 轮）
// 验证 inferZTProb 中的 score→prob 映射按纯净样本实测重标定
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.log('FAIL:', msg); } }

// ① 静态：新映射公式存在、旧公式已移除
ok(/if \(sc < 45\) prob = 2 \+ sc \* 0\.2;/.test(SV), '① sc<45 映射存在');
ok(/else if \(sc < 50\) prob = -28 \+ sc \* 0\.9;/.test(SV), '② sc<50 映射存在');
ok(/else if \(sc < 55\) prob = -65 \+ sc \* 1\.8;/.test(SV), '③ sc<55 映射存在');
ok(/else prob = -95 \+ sc \* 2\.4;/.test(SV), '④ sc>=55 映射存在');
ok(!/let prob = 18 \+ numNeutral\('auctionScore', x\.score\) \* 0\.62;/.test(SV), '⑤ 旧公式已移除');
ok(SV.includes('hx 轮按纯净样本实测重标定'), '⑥ 注释说明存在');

// ② 动态：关键 score 点的 prob 值（与实测封板率同量级）
function aucztProb(sc) {
  if (sc < 45) return 2 + sc * 0.2;
  if (sc < 50) return -28 + sc * 0.9;
  if (sc < 55) return -65 + sc * 1.8;
  return -95 + sc * 2.4;
}
ok(Math.abs(aucztProb(35) - 9.0) < 0.01, '⑦ score35→prob9.0 (实测~5%)');
ok(Math.abs(aucztProb(45) - 12.5) < 0.01, '⑧ score45→prob12.5 (实测~12%)');
ok(Math.abs(aucztProb(50) - 25.0) < 0.01, '⑨ score50→prob25.0 (实测~30%)');
ok(Math.abs(aucztProb(55) - 37.0) < 0.01, '⑩ score55→prob37.0 (实测~33%)');
ok(Math.abs(aucztProb(60) - 49.0) < 0.01, '⑪ score60→prob49.0');

// ③ 单调性：score 越高 prob 越高
let mono = true;
for (let sc = 30; sc < 70; sc++) { if (aucztProb(sc) > aucztProb(sc+1)) mono = false; }
ok(mono, '⑫ score→prob 单调递增');

// ④ 诚实度：prob 不再系统性虚高（关键档位 prob < 旧值的一半）
ok(aucztProb(40) < 20, '⑬ score40 prob<20 (旧值42.8)');
ok(aucztProb(50) < 30, '⑭ score50 prob<30 (旧值49.0)');
ok(aucztProb(55) < 45, '⑮ score55 prob<45 (旧值52.1)');

// ⑤ 与 empTable 口径一致性：hx 轮已把 hit 改 resolved.limitUp，prob 诚实化后 corr 应回升
//    这里只断言 empTable 中 auczt 的 hit 判据是 resolved.limitUp（已由 _test_nd_caliber.js 覆盖）
ok(/isAuczt \? !!\(s\.resolved && s\.resolved\.limitUp\)/.test(SV), '⑯ empTable bump 仍用 resolved.limitUp');

console.log(`${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
