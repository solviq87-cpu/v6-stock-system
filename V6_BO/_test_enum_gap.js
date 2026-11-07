// 守门测试：映射表 / 枚举不许漏项（2026-10-06）
//
// 背景（新角度：写了却没接、或用了却没登记 —— 这类问题的共同点是**不报错**）：
//   项目里有两张"按名字查表"的枚举，漏项都是静默降级，没有任何日志：
//
// ① 实测重标定的族群表 EMP_CHASE / EMP_EARLY
//    empGroupOf(t) 查不到就返回「其它」。而 trend / sector / bigmoney-B 这三个
//    **代码里真在登记**的类型从来没进过任何一张表 —— 于是它们全掉进「其它」，
//    「其它」又是这三个零散类型拼出来的盘子：样本被拆碎、跨交易日永远凑不够
//    → 族自己的档 100% locked（证据不足）→ empProb / empInfo 回落到「全部|同档」。
//    而「全部」是追高类与未启动类的混合值（实测两类次日真涨停率差 11 倍），
//    拿混合值校准一个未启动型信号 = 系统性低估 → fusedProb 偏低 → 本该推的票被闸门拦掉。
//    bigmoney-B 更特殊：它是 A/B 双推的实验 B 组，掉进「其它」后拿到的根本不是
//    "B 组自己的实测命中率"，A/B 比对直接失去意义。
//
// ② 单模块每日推送上限 MOD_DAY_CAP
//    表里写了 12 个模块的额度，但**只有 4 个模块真的调用过 modDayTake** ——
//    另外 8 个键是死配置：这道 2026-10-01 加的防刷屏闸对它们根本不存在。
//    还发现一个隐蔽坑：modDayTake 必须挂在**推送出口**，不是挂在 logSignal 上
//    （auczt 的 logSignal 只是学习留档，每条都登记，推送在另一个函数里）——
//    挂错地方会变成"登记被拦、推送照发"，甚至"推送永久消失"。
//
// 本测试钉死：
//   ① 源码里所有真实登记的类型，必须在族群表（或事后样本表）里有归属
//   ② MOD_DAY_CAP 的每个键，要么有 modDayTake 调用点，要么在显式"预留未接"白名单里
//   ③ modDayTake 的行为语义（超上限 / 换日重置 / 模块独立）
//   ④ 反证：把 trend 从表里拿掉，它立刻掉回「其它」—— 证明断言真在起作用
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');
// ⚠️ 必须 keepStrings：默认模式会把 `'sector'` 这类字符串字面量涂成空格，类型名就全丢了。
//    剥注释仍然必要 —— 否则注释里提到的类型名会变成假阳性。
const CODE = stripNoise(SRC, { keepStrings: true });

// 从源码抽函数体（按行：行首 function / const X = { ... };）
function grabFn(mark, endMark) {
  const i = SRC.indexOf(mark);
  if (i < 0) throw new Error('未找到: ' + mark);
  const j = SRC.indexOf(endMark, i);
  return SRC.slice(i, j < 0 ? SRC.length : j);
}

console.log('\n[1] 从源码提取真实在用的信号类型');
// logSignal('xxx', ...) 的字面量类型
const literal = new Set();
for (const m of CODE.matchAll(/logSignal\(\s*'([a-zA-Z0-9_-]+)'/g)) literal.add(m[1]);
// 动态类型：logSignal(x._grp === 'B' ? 'bigmoney-B' : 'bigmoney', ...)
for (const m of CODE.matchAll(/logSignal\([^)]*?\?\s*'([a-zA-Z0-9_-]+)'\s*:\s*'([a-zA-Z0-9_-]+)'/g)) { literal.add(m[1]); literal.add(m[2]); }
// alertType 映射的产出（快报里用变量传 type）：只取 ? 或 : 之后、且是 ASCII 标识符的那个串
//   （a.type === '大单快速流入' 里的中文比较值不含 ASCII 字母数字，不会误入）
const atSrc = grabFn('const alertType = a =>', '\n');
const dynamic = new Set();
for (const m of atSrc.matchAll(/[?:]\s*'([a-zA-Z0-9_-]+)'/g)) dynamic.add(m[1]);
const allTypes = new Set([...literal, ...dynamic]);
console.log('     字面量类型: ' + [...literal].sort().join(', '));
console.log('     动态类型(alertType): ' + [...dynamic].sort().join(', '));
ok(allTypes.size >= 8, `提取到 ${allTypes.size} 个真实类型（太少说明提取正则失效了）`);

console.log('\n[2] 每个真实类型都必须有族群归属（不能掉进「其它」）');
{
  // ⚠️ 切到 POST_HOC_TYPES 之前：empGroupOf 定义在 EMP_BUCKETS **之后**，切到 EMP_BUCKETS 会漏掉它
  const empSrc = grabFn('const EMP_CHASE = new Set(', 'const POST_HOC_TYPES');
  const postSrc = grabFn('const POST_HOC_TYPES = new Set(', '\n');
  const ctx = new Function(`${empSrc}\n${postSrc}\nreturn { empGroupOf, EMP_CHASE, EMP_EARLY, POST_HOC_TYPES };`)();
  const CH = [...ctx.EMP_CHASE], EA = [...ctx.EMP_EARLY], PH = [...ctx.POST_HOC_TYPES];
  console.log('     追高类: ' + CH.join(', '));
  console.log('     未启动类: ' + EA.join(', '));
  console.log('     事后样本: ' + PH.join(', '));
  const orphans = [...allTypes].filter(t => ctx.empGroupOf(t) === '其它');
  ok(orphans.length === 0, '⚠️ 没有一个真实类型掉进「其它」', '漏族: ' + orphans.join(', '));
  // 逐个点名（修的就是这三个）
  ok(ctx.empGroupOf('trend') === '未启动类', '⚠️ trend（趋势池）→ 未启动类');
  ok(ctx.empGroupOf('sector') === '未启动类', '⚠️ sector（板块异动联动）→ 未启动类');
  ok(ctx.empGroupOf('bigmoney-B') === '未启动类', '⚠️ bigmoney-B（A/B 实验 B 组）与对照同族');
  ok(ctx.empGroupOf('bigmoney') === ctx.empGroupOf('bigmoney-B'), '⚠️ A/B 两组同族（否则 B 组拿不到自己的实测率）');
  ok(ctx.empGroupOf('buzhang') === '追高类', 'buzhang 仍在追高类（不误伤）');
  ok(ctx.empGroupOf('zt') === '其它', 'zt 属事后样本族（单独排除，不进标定）');
  ok(ctx.POST_HOC_TYPES.has('zt'), 'zt 在 POST_HOC_TYPES 里（不参与 empTable）');
}

console.log('\n[3] MOD_DAY_CAP 不许有「写了没接」的死配置');
{
  const capSrc = grabFn('const MOD_DAY_CAP = {', 'const MOD_DAY_DEFAULT');
  const caps = new Function(capSrc + '\nreturn MOD_DAY_CAP;')();
  const keys = Object.keys(caps);
  // 源码里实际调用过的模块名
  const called = new Set();
  for (const m of CODE.matchAll(/modDayTake\(\s*'([a-zA-Z0-9_-]+)'\s*\)/g)) called.add(m[1]);
  // ⚠️ 快报那处是 modDayTake(alertType(a)) —— 动态模块名，覆盖 ztprob/fastin/trendsig
  const dynCall = /modDayTake\(\s*alertType\(/.test(CODE);
  if (dynCall) { called.add('ztprob'); called.add('fastin'); called.add('trendsig'); }
  ok(dynCall, '⚠️ 快报走动态模块名 modDayTake(alertType(a))（覆盖 ztprob/fastin/trendsig）');
  // 显式白名单：出口不在本模块的独立播报里，写在注释里备案，不许悄悄增加
  const RESERVED = new Set(['auczt', 'bigmoney_repeat', 'buzhang_repeat']);
  const dead = keys.filter(k => !called.has(k) && !RESERVED.has(k));
  console.log('     已接: ' + [...called].sort().join(', '));
  console.log('     预留未接(白名单): ' + [...RESERVED].sort().join(', '));
  ok(dead.length === 0, '⚠️ 没有既没接、又不在白名单里的死额度', '死配置: ' + dead.join(', '));
  ok(/预留未接/.test(SRC), '「预留未接」这三个键在源码注释里写明理由（不许悄悄留空）');
  ok(Object.keys(caps).length >= 12, `表仍在（${Object.keys(caps).length} 个模块额度）`);
  ok(caps.sector > 0 && caps.trend > 0, '⚠️ sector / trend 有额度（原本压根没键，会掉进默认 12）');
}

console.log('\n[4] modDayTake 行为语义');
{
  const mdSrc = grabFn('const MOD_DAY_CAP = {', '// 给面板看：今天各模块各发了几条');
  let DAY = '20261006';
  // ⛔ 2026-10-07 补：modDayTake 在 bt 轮加了落盘（savePushGov），沙箱里没有这个符号 →
  //    ReferenceError 让**整个套件从第 4 组起崩掉**，而 _runall 靠数 ✓ 兜底、打过几个 ✓ 就判绿，
  //    于是这个门从 bt 轮起一直"看着是绿的"却从来没跑完过。块里新增外部符号必须同步补进这里。
  let govSaves = 0;
  const _saveGov = () => { govSaves++; };
  const mk = () => new Function('todayStr', 'savePushGov',
    mdSrc + '\nreturn { modDayTake, _modDay };')(() => DAY, _saveGov);   // modDayStat 定义在切片之外，不导出
  const M = mk();
  const cap = 6;
  let got = 0;
  for (let i = 0; i < cap; i++) if (M.modDayTake('buzhang')) got++;
  ok(got === cap, `额度内 ${cap} 次全部放行`);
  ok(M.modDayTake('buzhang') === false, '⚠️ 超上限后返回 false（不再放行）');
  ok(M.modDayTake('similar') === true, '⚠️ 不同模块独立计数（一个模块用完不影响别的）');
  // 换日重置
  DAY = '20261007';
  ok(M.modDayTake('buzhang') === true, '⚠️ 换一天后额度重置');
  // 反证：把上限改小，同样代码立刻被拦 —— 证明额度真的在读表，不是摆设
  const M2 = new Function('todayStr', 'savePushGov',
    mdSrc.replace(/buzhang:\s*\d+/, 'buzhang: 1') + '\nreturn { modDayTake };')(() => '20261008', _saveGov);
  ok(M2.modDayTake('buzhang') === true && M2.modDayTake('buzhang') === false,
    '⚠️ 反证：把 buzhang 额度改成 1，第二次立刻被拦（说明真的在读表）');
  // 额度被占用时必须落盘（bt 轮：闸门只活在内存 → 冷启动后失效）
  const before = govSaves;
  M2.modDayTake('similar');
  ok(govSaves > before, '⚠️ 占额度后立刻落盘 savePushGov（否则重启后额度归零，防刷屏的闸白设）');
}

console.log('\n[5] 反证：类型从表里拿掉，立刻掉回「其它」');
{
  const empSrc = grabFn('const EMP_CHASE = new Set(', 'const POST_HOC_TYPES');
  const stripped = empSrc.replace(/'trend',\s*'sector',\s*'bigmoney-B'/, '');
  ok(stripped !== empSrc, '成功模拟"漏登记"的旧代码（把补的三个类型摘掉）');
  const ctx = new Function(stripped + '\nreturn { empGroupOf };')();
  ok(ctx.empGroupOf('trend') === '其它', '⚠️ 反证：摘掉后 trend 立刻掉回「其它」（证明断言真在起作用）');
  ok(ctx.empGroupOf('sector') === '其它', '⚠️ 反证：sector 同样掉回「其它」');
  ok(ctx.empGroupOf('bigmoney-B') === '其它', '⚠️ 反证：bigmoney-B 同样掉回「其它」');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
