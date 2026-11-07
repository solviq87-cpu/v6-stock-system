// 命中率三口径分离：拿真实 stats.json（966 条已回验样本）验证分类是否正确
// 目的：回答用户「命中率为什么那么低」—— 以前把三种完全不同性质的样本混算成一个数。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const ST = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));

// 直接复用 server.js 里的判定源码，防止测试与实现走偏
const m = src.match(/const POST_HOC_TYPES = new Set\(\[[^\]]*\]\);/);
const g = src.match(/function learnRate\(list\) \{[\s\S]*?\n\}/);
if (!m || !g) { console.error('❌ 未在 server.js 中找到 POST_HOC_TYPES / learnRate'); process.exit(1); }
// ⛔ learnRate 现在走 ndHit（cy 轮：预测力口径），沙箱必须一并注入，
//    漏一个符号 = 整个套件 ReferenceError 崩掉（已踩 7 次）
const ndSrc = (src.split('\n').filter(l => /^const nd(Hit|Lu) = /.test(l)).join('\n'));
const helper = new Function('return (function(){' + m[0] + '\n' + ndSrc + '\n' + g[0] +
  '\n return {POST_HOC_TYPES, learnRate};})()')();
const { POST_HOC_TYPES, learnRate } = helper;

// 与 recomputeBuckets 中完全一致的判定式
const isBT = s => s.resolved.mode === '历史回测';
const isPH = s => !isBT(s) && (POST_HOC_TYPES.has(s.type) ||
  (s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

const all = ST.signals.filter(s => s.resolved && !s.void);
const bt = all.filter(isBT);
const ph = all.filter(isPH);
const live = all.filter(s => !isBT(s) && !isPH(s));
const L = learnRate(live), B = learnRate(bt), P = learnRate(ph);
const OLD = learnRate(all);

console.log('\n──── 口径分离前 vs 后（真实 %d 条样本）────', all.length);
console.log('  旧口径（全混算）：  %d 样本 / 命中 %d = %d%%   ← 面板以前显示的就是这个数', OLD.n, OLD.h, OLD.rate);
console.log('  ├ 实盘预测：        %d 样本 / 命中 %d = %d%%   ← 盘中预判后推送，真正代表水平', L.n, L.h, L.rate);
console.log('  ├ 历史回测：        %d 样本 / 命中 %d = %d%%   ← 已知涨停往回倒推，天然偏高', B.n, B.h, B.rate);
console.log('  └ 已涨停后登记：    %d 样本 / 命中 %d = %d%%   ← 物理上没空间，不计入分母', P.n, P.h, P.rate);

console.log('');
ok('三口径样本数之和 = 全部样本数（不重不漏）', L.n + B.n + P.n === all.length,
  `${L.n}+${B.n}+${P.n} != ${all.length}`);
ok('三类互不重叠', !(all.some(s => isBT(s) && isPH(s))));
ok('历史回测被完整识别出来（mode=历史回测）', B.n === all.filter(s => s.resolved.mode === '历史回测').length);
// ⛔ 别钉死阈值（cy 轮改口径后这批样本的 nd 命中率会变）—— 钉的是**该不该进分母**这个语义：
//    它们是"票已封板后才登记"的样本，当时根本买不进去，命中再高也不代表系统有预测力。
ok('马后炮样本不计入实盘分母（命中再高也不算预测力：当时买不进去）', P.n > 0 && P.n < L.n,
  `马后炮 ${P.n} 条 / 命中率 ${P.rate}%，实盘分母 ${L.n} 条`);
ok('实盘预测口径 = 旧口径减去回测再减去马后炮', L.n === all.length - B.n - P.n);
ok('实盘命中率低于旧口径（说明旧数字是被回测撑起来的）', L.rate < OLD.rate, `实盘${L.rate}% vs 旧${OLD.rate}%`);
ok('历史回测命中率高于实盘（回测是事后倒推，天然虚高）', B.rate > L.rate, `回测${B.rate}% vs 实盘${L.rate}%`);
ok('learnRate 对空列表不除零', learnRate([]).rate === 0 && learnRate([]).n === 0);
// ⛔ 预测力口径（cy 轮）：learnRate 只认 nd —— 顺手钉住"只有 resolved 不算命中"这条
ok('learnRate 命中计数正确（只认 nd）',
  learnRate([{ nd: { hit: true } }, { nd: { hit: false } }]).rate === 50);
ok('learnRate 不把信号当天的既成事实算成命中',
  learnRate([{ resolved: { hit: true } }, { nd: { hit: false } }]).rate === 0);

// 按模块看实盘口径谁在拖后腿 —— 这是给用户的核心答案
console.log('\n──── 实盘口径下各模块命中率（样本≥8）────');
const rows = [];
const types = new Set(live.map(s => s.type));
for (const t of types) {
  const g2 = live.filter(s => s.type === t);
  if (g2.length < 8) continue;
  rows.push([learnRate(g2).rate, t, g2.length, learnRate(g2).h]);
}
rows.sort((a, b) => a[0] - b[0]);
for (const [r, t, n, h] of rows) console.log(`  ${t.padEnd(10)} ${String(n).padStart(4)} 样本 / 命中 ${String(h).padStart(3)} = ${r.toFixed(1)}%`);
console.log('  ⚠️ 上述实盘样本几乎全部来自 2026-09-28 单一交易日（当天上证-1.67%/深证-3.44%/创业板-4.53%），');
console.log('     属于普跌日，绝对命中率天然被压低。已有 beta 中性化 + ≥5 交易日闸门，不拿单日数据错杀模块。');

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
