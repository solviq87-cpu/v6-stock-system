// 守门测试：涨停判定不许有多份实现（2026-10-06）
//
// 背景（新角度：重复实现分叉 —— 同一条业务规则在全项目被各写了一份）：
//   「这只票今天算不算涨停」这条规则，本轮查实被写成了 **四套互不相认的版本**：
//     ① analysis.js  isLimitUp        —— 容差 0.3，且是唯一带「新股无涨跌幅限制期」修复的
//     ② server.js  六处 `pct >= limitPct - 0.5`（ztpre 扫描 / learnall 扫描 / 连续收涨扫描，
//                                        各写两份：已封板排除 + 连板数）
//     ③ server.js  两处 `pct >= A.limitPctOf(...) - 0.25`（大单流入的趋势票/涨停检测）
//     ④ learnall.js `ztCount` / `labelZt` 的 `pct >= lp - 0.5`，`bucketOf` 的 `p >= 9.5`
//        ztpre.js   `labelOf` 的 `pct >= 9.8`、`ingestAll` 的 `pct >= lim - 0.5`
//        analysis.js `trendCheck` 的 `pct >= 9.5`（连板数 + 60日涨停基因）
//   后果一（同一只票两种结论）：主板票涨 9.6%，① 判 false（9.6 < 9.7），② 判 true（9.6 ≥ 9.5）
//   —— 一只票在 A 模块"没涨停"、在 B 模块"涨停了"，连板梯队和涨停池对不上。
//   后果二（修复被绕过，更严重）：bc 版修的「新股上市前 5 日无涨跌幅限制」只写在 ① 里，
//     ②③④ 全是裸比较 → 一只上市第 2 天涨 30% 的主板新股，在连板统计里照样被数成 3 连板，
//     推送文案直接写「3连板」；learnall 的 zt20/zt60（涨停基因）和 labelZt（次日封板标签）
//     也照样把它当涨停（runLearnallIngest 门槛只有 rows.length>=6，新股是真能进来的）
//     → 学出来的规律是假的。
//
// 修法：容差允许不同（各模块对"算不算封板"的松紧要求确实不同），但**限幅规则必须共用一份**。
//   统一入口族：A.isLimitUp(pct) = isNearLimitUp(...,0.3)、A.isNearLimitUp(...,tol)、
//   A.limitUpStreak(rows, i, code, name, tol, minIdx)；learnall / ztpre 改为 require analysis.js。
//
// 本测试钉死：
//   ① 入口族存在且行为正确（含 minIdx 与原 `for(j=i;j>=1;j--)` 语义等价）
//   ② 源码里不再有手写的限幅比较（剥注释后扫，避免注释里的反例假红）
//   ③ 新股在三处扫描器语义下连板数一律 0
//   ④ learnall 的 ztCount / labelZt / bucketOf、ztpre 的 labelOf 都真的走了唯一入口
//   ⑤ 非新股的 9 种限幅组合逐条不变（不能误伤）
//   ⑥ 反证：钩子一摘，污染立刻回来（证明判定真的走入口，不是摆设）
'use strict';
const fs = require('fs');
const A = require('./analysis.js');
const LA = require('./learnall.js');
const ZP = require('./ztpre.js');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SSRC = fs.readFileSync('server.js', 'utf8');
const ASRC = fs.readFileSync('analysis.js', 'utf8');
const LSRC = fs.readFileSync('learnall.js', 'utf8');
const ZSRC = fs.readFileSync('ztpre.js', 'utf8');
const SCODE = stripNoise(SSRC);
const LCODE = stripNoise(LSRC);
const ZCODE = stripNoise(ZSRC);

// 造 K 线：pcts 是每日涨幅（%），close 按 10 元起步累乘
function mkrows(pcts) {
  let c = 10;
  return pcts.map((p, i) => {
    const prev = c;
    c = +(c * (1 + p / 100)).toFixed(3);
    return { date: '2026-01-' + String(i + 1).padStart(2, '0'), close: c, open: prev, high: c, low: c, pct: p, volume: 1e6 };
  });
}

console.log('\n[1] 唯一入口族存在');
ok(typeof A.isLimitUp === 'function', 'isLimitUp 仍导出（老调用点不破）');
ok(typeof A.isNearLimitUp === 'function', 'isNearLimitUp 已导出（带容差的统一入口）');
ok(typeof A.limitUpStreak === 'function', 'limitUpStreak 已导出（连板数统一入口）');
ok(A.isLimitUp('600000', '浦发银行', 9.8) === true && A.isLimitUp('600000', '浦发银行', 9.6) === false,
  '⚠️ isLimitUp 容差就是 0.3（9.8 算 / 9.6 不算），与历史行为一致');
ok(A.isNearLimitUp('600000', '浦发银行', 9.6, 0.5) === true, 'isNearLimitUp(0.5)：9.6 算（容差由调用方决定）');
ok(A.isNearLimitUp('600000', '浦发银行', 9.6, 0.25) === false, 'isNearLimitUp(0.25)：9.6 不算（大单那路的松紧）');

console.log('\n[2] limitUpStreak 语义（含 i 本身、遇非涨停即停）');
{
  const rows = mkrows([1, 1, 1, 10, 10, 10]);   // 最后 3 天主板涨停
  ok(A.limitUpStreak(rows, 5, '600000', '浦发银行', 0.5, 1) === 3, '⚠️ 末 3 天涨停 → 连板 3');
  const r2 = mkrows([1, 1, 10, 1, 10, 10]);     // 中间断了一天
  ok(A.limitUpStreak(r2, 5, '600000', '浦发银行', 0.5, 1) === 2, '中间断一天 → 连板 2（遇非涨停即停）');
  const r3 = mkrows([1, 1, 1, 1, 1, 1]);
  ok(A.limitUpStreak(r3, 5, '600000', '浦发银行', 0.5, 1) === 0, '今天没涨停 → 连板 0（含 i 本身，不能数成 1）');
  // minIdx 必须能 1:1 复刻老的 `for (j = i; j >= 1; j--)`
  const all = mkrows([10, 10, 10, 10, 10, 10]);
  ok(A.limitUpStreak(all, 5, '600000', '浦发银行', 0.5, 1) === 5, '⚠️ minIdx=1 与老写法一致（最多数到下标 1 = 5 根）');
  ok(A.limitUpStreak(all, 5, '600000', '浦发银行', 0.5, 0) === 6, 'minIdx=0 会多数一根（说明参数真的生效，不是摆设）');
  ok(A.limitUpStreak(null, 5, '600000', '浦发银行', 0.5, 1) === 0, 'rows 为 null → 0（不崩）');
  ok(A.limitUpStreak(all, 99, '600000', '浦发银行', 0.5, 1) === 0, '越界下标 → 0（不崩）');
}

console.log('\n[3] 源码里不再有手写的限幅比较（剥注释后扫）');
ok(!/limitPct\s*-\s*0\.5/.test(SCODE), '⚠️ server.js 不再有 `limitPct - 0.5` 的裸比较（三个扫描器共 6 处）');
ok(!/limitPctOf\([^)]*\)\s*-\s*0\.25/.test(SCODE), '⚠️ server.js 不再有 `limitPctOf(...) - 0.25` 的裸比较（大单 2 处）');
ok((SCODE.match(/A\.isNearLimitUp\(/g) || []).length >= 5, '⚠️ server.js 至少 5 处改走 A.isNearLimitUp（3 扫描各 1 + 大单 2）');
ok((SCODE.match(/A\.limitUpStreak\(/g) || []).length >= 3, '⚠️ server.js 三处连板数改走 A.limitUpStreak');
ok(!/pct\s*>=\s*9\.8/.test(LCODE), '⚠️ learnall.js 不再有写死的 9.8');
ok(!/pct\s*>=\s*9\.8/.test(ZCODE), '⚠️ ztpre.js 不再有写死的 9.8（否则 20cm 票一条都学不到）');
ok(/require\('\.\/analysis\.js'\)/.test(LSRC) && /require\('\.\/analysis\.js'\)/.test(ZSRC),
  '⚠️ learnall / ztpre 都 require 了 analysis.js（限幅规则共用一份）');
ok(!/p\s*>=\s*9\.5/.test(stripNoise(ASRC)), '⚠️ analysis.js 不再有写死的 9.5（trendCheck 的连板/涨停基因）');

console.log('\n[4] 新股：连板数一律 0（bc 版修复不再被绕过）');
{
  const IS_NEW = new Set(['600001', '300001']);
  A.setNoLimitFn(code => IS_NEW.has(String(code)));
  const rows = mkrows([1, 30, 30, 30, 30]);      // 主板新股连着 4 天涨 30%
  ok(A.limitUpStreak(rows, 4, '600001', '主板新股', 0.5, 1) === 0, '⚠️ 主板新股连涨 30% × 4 → 连板 0（不是 4 连板）');
  ok(A.isNearLimitUp('600001', '主板新股', 30, 0.5) === false, '⚠️ 新股"已封板"判定为 false（不再被当成封板排除）');
  ok(A.isNearLimitUp('300001', '创业新股', 50, 0.25) === false, '⚠️ 创业板新股涨 50%（大单那路 0.25 容差）也不算涨停');
  // 非新股不受影响
  const r2 = mkrows([1, 1, 10, 10, 10]);
  ok(A.limitUpStreak(r2, 4, '600000', '浦发银行', 0.5, 1) === 3, '非新股连板数不受影响（仍 3 连板）');
}

console.log('\n[5] learnall 的 ztCount / labelZt / bucketOf 走唯一入口');
{
  const rows = mkrows([1, 1, 30, 30, 30, 30, 1, 1]);   // 主板新股中间 4 天涨 30%
  const i = rows.length - 1;
  ok(LA.ztCount(rows, i, 20, 10, { code: '600001', name: '主板新股' }) === 0,
    '⚠️ 带 code：新股涨停基因 zt20 = 0（不再把 30% 数成涨停）');
  ok(LA.labelZt(rows, 1, 10, { code: '600001', name: '主板新股' }) === 0,
    '⚠️ 带 code：新股"次日封板"标签 = 0（次日 30% 不算封板）');
  ok(LA.bucketOf({ pct: 30 }, { code: '600001', name: '主板新股' }) !== '涨停',
    '⚠️ 带 code：bucketOf 不再把新股 30% 归为「涨停」桶');
  // 退化为纯数值时必须与修之前逐字节等价（不带 code 的旧签名）
  ok(LA.ztCount(rows, i, 20, 10) === 4, '不带 code：退化为纯数值比较（4 天 30% ≥ 9.5 → 4），与修复前一致');
  ok(LA.labelZt(rows, 1, 10) === 1, '不带 code：labelZt 退化行为不变（次日 30% ≥ 9.5 → 封板）');
  ok(LA.bucketOf({ pct: 9.8 }) === '涨停', '不带 code：bucketOf 退化行为不变（9.8 → 涨停）');
  // 非新股：带 code 也不误伤
  const r2 = mkrows([1, 1, 1, 1, 1, 10, 10]);
  ok(LA.ztCount(r2, r2.length - 1, 20, 10, { code: '600000', name: '浦发银行' }) === 2, '非新股带 code：zt20 = 2（不误伤）');
  ok(LA.ztCount(r2, r2.length - 1, 20, 20, { code: '300750', name: '宁德时代' }) === 0, '创业板 10% 不算涨停基因（板块限幅生效）');
}

console.log('\n[6] ztpre 的 labelOf 走唯一入口（不再一刀切 9.8）');
{
  // ⚠️ labelOf(rows, i) 标的是 **i+1** 那天，所以 i 要指向大涨幅的【前一天】
  const rows = mkrows([1, 1, 19.9, 1, 1]);
  const lab = ZP.labelOf(rows, 1, { code: '300750', name: '宁德时代' });
  ok(lab && lab.zt === true, '⚠️ 创业板次日涨 19.9% → 判封板（i 指向前一天，标的是 i+1）');
  const lab2 = ZP.labelOf(rows, 1, { code: '300750', name: '宁德时代', isLimitUp: p => p >= 9.8 });
  ok(lab2 && lab2.zt === true, 'opt.isLimitUp 仍可注入（测试/外部可覆盖判定）');
  const r2 = mkrows([1, 1, 9.8, 1, 1]);
  ok(ZP.labelOf(r2, 1, { code: '300750', name: '宁德时代' }).zt === false,
    '⚠️ 创业板次日涨 9.8% → **不**判封板（写死 9.8 的旧版会误判成涨停）');
  ok(ZP.labelOf(r2, 1, { code: '600000', name: '浦发银行' }).zt === true,
    '主板次日涨 9.8% → 判封板（不误伤主板）');
  // 新股
  A.setNoLimitFn(code => code === '600001');
  const r3 = mkrows([1, 1, 30, 1, 1]);
  ok(ZP.labelOf(r3, 1, { code: '600001', name: '主板新股' }).zt === false,
    '⚠️ 新股次日涨 30% → 不判封板（ztpre 学习样本不再被污染）');
  A.setNoLimitFn(null);
}

console.log('\n[7] trendCheck 的连板/涨停基因按板块限幅（不再写死 9.5）');
{
  A.setNoLimitFn(null);
  // 创业板：60 日内最高单日 12%（不是涨停）→ 涨停基因应为 0；主板同样 12% → 应为 1
  const pcts = new Array(30).fill(0.5);
  pcts[10] = 12;
  const rowsC = mkrows(pcts);
  const price = rowsC[rowsC.length - 1].close;
  // ⚠️ 注意函数别认错：连板/涨停基因在 **trendPoolCheck**（趋势池闸门）里，不是 trendCheck（MA5/破前高）
  ok(/function trendPoolCheck\(\{[^}]*code, name \}\)/.test(ASRC), '⚠️ trendPoolCheck 收 code/name（否则拿不到板块限幅）');
  ok((SCODE.match(/A\.trendPoolCheck\(\{[^}]*code: s\.code/g) || []).length >= 2,
    '⚠️ server 两处调用 trendPoolCheck 都传了 code/name（传漏一处 = 那一路退回写死 9.5）');
  ok(!/p\s*>=\s*9\.5/.test(stripNoise(ASRC)), 'trendPoolCheck 内部已换成 isNearLimitUp（不再 9.5 一刀切）');
  ok(Number.isFinite(price), 'K 线构造正常（自检）');
}

console.log('\n[8] 非新股 9 种限幅组合逐条不变（不能误伤）');
{
  A.setNoLimitFn(null);
  const cases = [
    ['600000', '浦发银行', 10, true, '主板 10%'],
    ['600000', '浦发银行', 9.4, false, '主板 9.4%'],
    ['300750', '宁德时代', 20, true, '创业板 20%'],
    ['300156', 'ST有棵树', 20, true, '创业板ST 20%（板块优先）'],
    ['300156', 'ST有棵树', 5, false, '创业板ST 5% 不误判'],
    ['688981', '中芯国际', 20, true, '科创板 20%'],
    ['830799', '艾融软件', 30, true, '北交所 30%'],
    ['600122', '*ST中珠', 10, true, '主板ST 10%（2026-04 起与主板同限幅）'],
    ['600122', '*ST中珠', 5, false, '主板ST 5% 不误判（旧 5cm 口径已废）'],
  ];
  for (const [code, name, pct, want, label] of cases) {
    ok(A.isNearLimitUp(code, name, pct, 0.5) === want, `${label} → ${want}（容差 0.5 口径）`);
  }
}

console.log('\n[9] 反证：钩子一摘，污染立刻回来（证明真的走入口）');
{
  const rows = mkrows([1, 30, 30, 30]);
  A.setNoLimitFn(null);
  ok(A.limitUpStreak(rows, 3, '600001', '主板新股', 0.5, 1) === 3,
    '⚠️ 反证：不注入上市日期时，新股 30% 又被数成 3 连板（说明入口真的在起作用）');
  A.setNoLimitFn(() => false);
  ok(LA.ztCount(rows, 3, 20, 10, { code: '600001', name: '主板新股' }) === 3,
    '⚠️ 反证：钩子返回 false 时，learnall 又把它数成 3 个涨停基因');
  A.setNoLimitFn(() => { throw new Error('x'); });
  ok(A.limitUpStreak(rows, 3, '600001', '主板新股', 0.5, 1) === 3, '钩子抛异常时退化为限幅判定（不崩、不静默）');
  A.setNoLimitFn(null);
}

console.log('\n[10] ST/退市过滤也只有一份（且大小写与限幅判定一致）');
{
  ok(typeof A.isJunkName === 'function', '⚠️ isJunkName 已导出（ST/退市过滤唯一入口）');
  ok(!/\/ST\|[^/]*\/\.test\(/.test(SCODE), '⚠️ server.js 不再散落手写的 /ST|退/ 正则（曾 11 处）');
  ok((SCODE.match(/A\.isJunkName\(/g) || []).length >= 12, '⚠️ 已统一到 A.isJunkName（含新增的 scanSteadyUp）');
  // 大小写必须一致：isJunkName 必须带 /i（小写 st 也曾漏判）。
  ok(A.isJunkName('st某某') === true, '⚠️ 小写 st 也判为 ST（老写法 /ST|退/ 不带 i 会漏）');
  ok(A.isJunkName('*ST中珠') === true && A.isJunkName('天夏退') === true && A.isJunkName('退市某某') === true,
    '常见 ST / 退市 / 退市整理 名字都能拦住');
  ok(A.isJunkName('宁德时代') === false && A.isJunkName('') === false && A.isJunkName(null) === false, '正常名字不误伤、null 不炸');
  // 限幅与过滤是两条独立口径（jn 轮 2026-10-21 起）：ST 限幅并回主板 10%，
  // 选股侧仍一律过滤 —— 互相不再假设，各锁各的
  ok(A.limitPctOf('600122', 'st中珠') === 10 && A.isJunkName('st中珠') === true,
    '⚠️ 自洽：st中珠 限幅 10%（并回主板）且选股侧仍被过滤');
  // scanSteadyUp 必须真的挂上（它原先一处都没写）
  // ⛔ mv 轮改钉语义不钉窗口：原来按固定 2200/1600 字符窗口切片，函数体一加长
  //    （加让出行）就把 isJunkName 顶出窗口 → 假红。改为按函数体边界取（到顶层收尾大括号）。
  const fnSrcOf = (sig) => {
    const m = SSRC.match(new RegExp('function ' + sig + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
    return m ? m[0] : '';
  };
  const seg = fnSrcOf('scanSteadyUp');
  ok(/A\.isJunkName\(name\)/.test(seg), '⚠️ scanSteadyUp 挂上了 ST/退市过滤（原先漏挂，退市股能混进连续收涨榜）');
  ok(/close\) >= 2/.test(seg), '⚠️ scanSteadyUp 挂上了仙股价过滤（低于 2 元）');
  // 另两个扫描器不能因为改了函数就掉链子
  const z = fnSrcOf('scanZtPre');
  ok(/A\.isJunkName\(name\)/.test(z), 'scanZtPre 仍在过滤 ST/退市');
}

console.log('\n[9] 精选池「爆发日」不许写死 9%（按板块限幅）');
{
  const A = require('./analysis.js');
  ok(typeof A.isSurgeDay === 'function', '⚠️ analysis.js 导出了 isSurgeDay');
  // 主板：9% 就是爆发（与修之前完全一致，不许越改越松）
  ok(A.isSurgeDay('600000', '浦发银行', 9, 1) === true, '主板 9% 判爆发（与旧写法 pct>9 同档）');
  ok(A.isSurgeDay('600000', '浦发银行', 8.5, 1) === false, '主板 8.5% 不判爆发');
  // 创业板/科创：9% 只是半程，必须不算爆发 —— 这正是老写法把强势票沉到池底的原因
  ok(A.isSurgeDay('300750', '宁德时代', 9, 1) === false, '⚠️ 创业板 9% 不判爆发（老写法会误判 → 沉到池底）');
  ok(A.isSurgeDay('688008', '澜起科技', 9, 1) === false, '⚠️ 科创板 9% 不判爆发');
  ok(A.isSurgeDay('300750', '宁德时代', 19, 1) === true, '创业板 19% 判爆发（接近 20cm 涨停）');
  // 北交所 30cm
  ok(A.isSurgeDay('830799', '北交所票', 18, 1) === false && A.isSurgeDay('830799', '北交所票', 29, 1) === true,
    '⚠️ 北交所 18% 不算、29% 才算（老写法 9% 就判死）');
  // 主板 ST：限幅已并回主板 10%（2026-04 规则修订），爆发阈值与主板同一把尺子
  ok(A.isSurgeDay('600122', 'st中珠', 9, 1) === true && A.isSurgeDay('600122', 'st中珠', 8.5, 1) === false,
    '主板 ST 爆发阈值与主板一致（9% 判、8.5% 不判；旧 5cm 口径 4% 就判已废）');
  // ⛔ 与 isNearLimitUp 的唯一分歧点：新股无涨跌幅限制期，两边结论必须相反
  A.setNoLimitFn(() => true);
  ok(A.isSurgeDay('600000', '新股', 30, 1) === true, '⚠️ 新股涨 30% 必须判【爆发】（否则会被当"还没启动"顶到池首）');
  ok(A.isNearLimitUp('600000', '新股', 30, 0.3) === false, '⚠️ 同一只票 isNearLimitUp 必须 false（那段时间不存在涨停）');
  ok(A.isSurgeDay('600000', '新股', 30, 1) !== A.isNearLimitUp('600000', '新股', 30, 0.3),
    '⚠️ 反证：新股这两入口结论必须相反（所以不能拿 isNearLimitUp 顶替 isSurgeDay）');
  A.setNoLimitFn(() => false);
  // 源码：精选池不许再出现写死的 9
  const poolSeg = SSRC.slice(SSRC.indexOf('const focused ='), SSRC.indexOf('const focused =') + 200);
  ok(/A\.isSurgeDay\(/.test(poolSeg), '⚠️ 精选池 focused 走 A.isSurgeDay', poolSeg.split('\n')[0].trim().slice(0, 110));
  // ⛔ 必须拿**剥掉注释**的源码来判：我在这段上方写的说明里就带着 `r.pct > 9` 这几个字，
  //    拿 SSRC 直接测会命中自己的注释 → 假红。
  ok(!/\bpct\s*[>≥=]+\s*9\b/.test(SCODE), '⚠️ 剥注释后源码里已无「pct > 9」这类裸比较（写死的 9 已清零）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
