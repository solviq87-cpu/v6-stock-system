// 守门测试：事后样本（hindsight）不得参与任何校准 / 标定 / 阈值自适应（2026-10-06）
//
// 背景（前视偏差专项审计查出）：
//   seedLearnFromHistory 是「先知道当天涨停了，才倒推登记一条信号」—— 决策时刻并不知道它会涨停，
//   属于教科书式的事后选择偏差。本机实测：回测样本 600 条次日命中 **75%**，同期实盘预判只有 **36%**。
//   而 empTable（实测重标定）只要求 s.nd，把这 600 条 100% 收进标定表：
//     未启动类|65-74  回测 77 条(84%) 混进 30 条实盘(23%) → 混合 67%，虚高 44 个点
//     未启动类|55-64  回测 187 条(75%) 混进 7 条实盘(43%)  → 混合 74%，虚高 31 个点
//     全部|<70        回测 571 条(74%) 混进 272 条实盘(36%) → 混合 61%，虚高 25 个点
//   污染链：empInfo → fusedProb → 推送门槛；以及 S.learn.buckets[].corr → calibratedProb。
//   口径分离其实早就做了（S.learn.split 三口径），但只用在**面板展示**，empTable 这条后加的
//   链路漏了继承 —— 典型的新功能漏继承旧口径。
//
// 本测试钉死：
//   ① 回测样本（resolved.mode==='历史回测'）不进实测标定表
//   ② 事后样本（type=zt/review，或"已封板后登记 maxGain≈0"）不进实测标定表
//   ③ corr 校准只认实盘样本（res = live，不再是 all）
//   ④ 剔除后天数不够时走**单向强证伪**通道，不能退回 corr=1（否则修完偏差反而放松闸门）
'use strict';
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const SRC = fs.readFileSync('server.js', 'utf8');

// ═════════ 一、源码静态断言：所有消费历史样本做决策的地方都要过这一关 ═════════
console.log('\n[1] 事后样本判定与调用点');
ok(/const isBacktestSample\s*=/.test(SRC), '定义 isBacktestSample（历史回测倒推）');
ok(/function isPostHocSample\s*\(/.test(SRC), '定义 isPostHocSample（已涨停后登记）');
ok(/const isLiveSample\s*=/.test(SRC), '定义 isLiveSample（盘中预判→真推送→次日回验）');

// empTable：把 empTable 函数体整段抠出来检查
const e0 = SRC.indexOf('function empTable() {');
const e1 = SRC.indexOf('\nfunction empProb(');
ok(e0 > 0 && e1 > e0, 'server.js 里存在 empTable');
const empBody = SRC.slice(e0, e1);
// ⛔ dv 轮：这一行被拆成「回测」「事后」两条**分别计数**的出局分支 —— isLiveSample 只返回
//    true/false，看不出到底是哪一类被排除了（面板上永远分不清「还没回验」还是「按设计排除」）。
//    断言改成钉语义：两类都必须有一条紧接 continue 的出局分支（中间只允许计数语句）。
const _OUT_BACKTEST = /isBacktestSample\(s\)[\s\S]{0,80}?continue;/;
const _OUT_POSTHOC = /isPostHocSample\(s\)[\s\S]{0,80}?continue;/;
ok(_OUT_BACKTEST.test(empBody) && _OUT_POSTHOC.test(empBody),
  '⚠️ empTable 里回测样本与事后样本各自出局（核心断言；dv 轮拆成两条分别计数）',
  'backtest=' + _OUT_BACKTEST.test(empBody) + ' posthoc=' + _OUT_POSTHOC.test(empBody));

// 各调用点
const fnBody = (name, until) => {
  const i = SRC.indexOf(name);
  if (i < 0) return '';
  const j = SRC.indexOf(until, i);
  return j > i ? SRC.slice(i, j) : SRC.slice(i, i + 3000);
};
// 注意：recomputeBuckets 里是传引用（all.filter(isLiveSample)），不是调用形式 isLiveSample(s)
const rbBody = fnBody('function recomputeBuckets()', '// —— A/B 对照实验');
ok(/isLiveSample/.test(rbBody) && /all\.filter\(isLiveSample\)/.test(rbBody), 'recomputeBuckets 的校准口径只认实盘');
ok(/const res = live;/.test(fnBody('function recomputeBuckets()', '// —— A/B 对照实验')), '⚠️ recomputeBuckets 里 res = live（不再 res = all 拿回测凑厚度）');
ok(/isLiveSample\(s\)/.test(fnBody('function learnFusedReport()', 'function learnFusedReportXxx')), 'learnFusedReport 只统计实盘样本');
ok(/isLiveSample\(s\)/.test(fnBody('function trendSelfOptimize()', 'function ') !== '' ? fnBody('function trendSelfOptimize()', '\nfunction bigMoneyStats(') : ''), 'trendSelfOptimize 只认实盘（否则误判"命中率不错→放宽阈值"）');
ok(/isLiveSample\(s\)/.test(fnBody('function bigMoneyStats()', '\nfunction ')), 'bigMoneyStats 排除事后样本（否则误压涨停率→抬高门槛）');
ok(/isLiveSample\(s\)/.test(fnBody('function similarStats()', '\nfunction ')), 'similarStats 排除事后样本');
ok(/isLiveSample\(s\)/.test(fnBody('function bmEmpBuckets()', '\nfunction ')), 'bmEmpBuckets（A/B 实证组）排除事后样本');

// POST_HOC_TYPES 只允许有一处定义，避免两处口径漂移
const phCount = (SRC.match(/const POST_HOC_TYPES\s*=/g) || []).length;
ok(phCount === 1, `POST_HOC_TYPES 只有一处定义（实为 ${phCount} 处，两处就会漂移）`);

// ═════════ 二、行为断言：把 empTable 装进沙箱真跑 ═════════
console.log('\n[2] empTable 沙箱行为');
// 整段抽出：EMP_* 常量 → 三个判定函数 → empTable → empProb → empInfo
const b0 = SRC.indexOf('const EMP_MIN_N = 20');
// ⛔ iq 轮：bigMoneySelfOptimize 已更名 bigMoneyStatsRefresh（只剩统计刷新，不调门槛）——
//    切块终点跟着改名，否则 indexOf 返 -1 → slice(b0,-1) 把半个文件塞进沙箱。
const b1 = SRC.indexOf('\nfunction bigMoneyStatsRefresh(');
ok(b0 > 0 && b1 > b0, '抽出 empTable 区块（EMP 常量 + 判定 + empTable + empInfo）');
const block = SRC.slice(b0, b1);
// ⛔⛔ B1 轮（2026-10-17）补：empTable 现在调 isRetiredProbScale 过滤退役刻度样本，
//    沙箱漏装 = ReferenceError = 整段崩掉而不是变红（同款坑第 N 次）。原样切进来。
const retiredSrc = SRC.slice(SRC.indexOf('const AUCZT_PROB_HONEST_MAX = 20;'), SRC.indexOf('function inferZTProb'));
ok(retiredSrc.includes('isRetiredProbScale'), '抽到退役刻度判据（isRetiredProbScale）');

const mkEmp = src => new Function('S', 'Date', src + '\n; return { empTable, empInfo, empProb, isLiveSample, isBacktestSample, isPostHocSample };');
const mkSig = o => Object.assign({
  type: 'histzt', code: '600000', name: 'X', date: '2026-09-29', prob: 60, price: 10,
  resolved: { mode: '当日', hit: true, limitUp: false, maxGain: 5 },
  nd: { hit: true, limitUp: false, maxGain: 5 }
}, o);
const tableWith = sigs => mkEmp(block + '\n' + retiredSrc)({ learn: { signals: sigs } }, { now: () => Date.now() }).empTable();

// ① 正常实盘样本照进（不能把功能一起关掉）
let t = tableWith([mkSig({})]);
ok(Object.keys(t).length > 0 && t['未启动类|55-64'] && t['未启动类|55-64'].n === 1, '正常实盘样本照常进标定表（防护不能误伤）');

// ② 历史回测样本被排除
t = tableWith([mkSig({ resolved: { mode: '历史回测', hit: true, limitUp: true, maxGain: 8 } })]);
ok(Object.keys(t).length === 0, '⚠️ 历史回测样本（已知涨停倒推）不进标定表（核心断言）');

// ③ 事后样本：type=zt（已封板后才登记）
t = tableWith([mkSig({ type: 'zt', resolved: { mode: '当日', hit: false, limitUp: true, maxGain: 0 } })]);
ok(Object.keys(t).length === 0, '⚠️ 事后样本 type=zt 不进标定表');

// ④ 事后样本：type=review
t = tableWith([mkSig({ type: 'review' })]);
ok(Object.keys(t).length === 0, '事后样本 type=review 不进标定表');

// ⑤ 事后样本：回验出"当天涨停但最高涨幅≈0"（登记价就在板上）
t = tableWith([mkSig({ type: 'pool', resolved: { mode: '当日', hit: false, limitUp: true, maxGain: 0.2 } })]);
ok(Object.keys(t).length === 0, '⚠️ 已封板后登记（limitUp 且 maxGain≈0）不进标定表');

// ⑥ 混合：实盘保留、回测剔除
t = tableWith([
  mkSig({}),
  mkSig({ resolved: { mode: '历史回测', hit: true, limitUp: true, maxGain: 8 } })
]);
ok(t['未启动类|55-64'] && t['未启动类|55-64'].n === 1, '混合样本里只保留实盘那一条（回测被剔除）');

// ⑦ 反证：把那行过滤删掉，回测样本必须重新出现 —— 证明这条过滤是唯一防线
// 同上：反证构造也要跟着拆成两条（否则 replace 不命中 = 破坏版根本没破坏）
// ⛔ 必须把 `if (...)` 一起吃掉：只删后半段会留下悬空的 `if (cond) }` → SyntaxError。
//    整条语句（含花括号）一起删，才等价于原来删掉 `if (!isLiveSample(s)) continue;`。
const _dropOut = kind => block.replace(
  new RegExp('if \\(' + kind + '\\(s\\)\\)' + '\\s*\\{?[\\s\\S]*?continue;\\s*\\}?', 'g'), '');
// ⛔⛔ B1 轮：破坏版也要删掉退役刻度过滤行，否则沙箱里 isRetiredProbScale 未定义直接崩
const broken = _dropOut('isPostHocSample').replace(
  /if \(isBacktestSample\(s\)\)\s*\{?[\s\S]*?continue;\s*\}?/g, '')
  .replace(/if \(isRetiredProbScale\(s\)\)\s*\{?[\s\S]*?continue;\s*\}?/g, '');
ok(broken !== block, '（反证用）成功构造"去掉过滤"的破坏版');
const tb = mkEmp(broken)({ learn: { signals: [mkSig({ resolved: { mode: '历史回测', hit: true, limitUp: true, maxGain: 8 } })] } }, { now: () => Date.now() }).empTable();
ok(Object.keys(tb).length > 0 && tb['未启动类|55-64'].n === 1, '⚠️ 反证：删掉过滤后回测样本立刻污染标定表（说明这行真在起作用）');

// ⑦-2 B1 轮反证：只删退役刻度过滤，prob=70 的 auczt（ig 之前旧刻度）必须重新进桶
const brokenRetired = _dropOut('isRetiredProbScale');
ok(brokenRetired !== block, '（反证用）成功构造"只去掉退役过滤"的破坏版');
const tbr = mkEmp(brokenRetired)({ learn: { signals: [mkSig({ type: 'auczt', prob: 70,
  resolved: { mode: '当日', hit: true, limitUp: true, maxGain: 6.5 } })] } }, { now: () => Date.now() }).empTable();
ok(!!tbr['auczt|65-74'] && tbr['auczt|65-74'].n === 1, '⚠️ 反证：删掉退役过滤后旧刻度 auczt 立刻进桶（说明这行真在起作用）',
  JSON.stringify(Object.keys(tbr)));
// 正面：带上过滤时同一样本进不了桶
const tbf = mkEmp(block + '\n' + retiredSrc)({ learn: { signals: [mkSig({ type: 'auczt', prob: 70,
  resolved: { mode: '当日', hit: true, limitUp: true, maxGain: 6.5 } })] } }, { now: () => Date.now() }).empTable();
ok(!tbf['auczt|65-74'], '正面：prob=70 的 auczt 被退役过滤挡住（诚实刻度样本积累前不校准）', JSON.stringify(Object.keys(tbf)));

// ⑧ empInfo 同样拿不到（证据不足 → 调用方沿用原值，不胡乱标定）
const api = mkEmp(block)({ learn: { signals: [mkSig({ resolved: { mode: '历史回测', hit: true, limitUp: true, maxGain: 8 } })] } }, { now: () => Date.now() });
ok(api.empInfo(60, 'histzt') === null, '只有回测样本时 empInfo 返回 null（宁可不校准，也不拿假数据标定）');

// ═════════ 三、真实数据：量化污染量级 ═════════
console.log('\n[3] 用真实 stats.json 复算污染量级');
let real = null;
try { real = JSON.parse(fs.readFileSync('stats.json', 'utf8')); } catch { }
const sigs = real ? ((real.learn && real.learn.signals) || real.signals || []) : [];
ok(sigs.length > 0, `读到真实样本库（${sigs.length} 条）`);
if (sigs.length) {
  const bt = sigs.filter(s => s.resolved && s.resolved.mode === '历史回测' && s.nd);
  ok(bt.length >= 100, `库里确实存在 ${bt.length} 条事后倒推样本（污染不是假设）`);
  const rate = a => a.length ? Math.round(a.filter(s => s.nd.hit).length / a.length * 100) : null;
  const rb = rate(bt), rl = rate(sigs.filter(s => s.nd && !(s.resolved && s.resolved.mode === '历史回测')));
  ok(rb - rl >= 20, `事后样本命中率 ${rb}% 比实盘 ${rl}% 高 ${rb - rl} 点 —— 正是它被挡在标定外的理由`);
}

// ═════════ 四、corr 校准：强证伪通道（防止"修完偏差反而放松闸门"） ═════════
console.log('\n[4] corr 强证伪通道');
// 直接抽 recomputeBuckets 里算 buckets/corr 那一整段真跑，避免复制一份逻辑来测
const c0 = SRC.indexOf("  const expect = { '90+'");
const c1 = SRC.indexOf('  // —— A/B 对照实验');
ok(c0 > 0 && c1 > c0, '抽出 corr 计算块');
const corrSrc = SRC.slice(c0, c1);
ok(/CORR_REFU_N/.test(corrSrc), 'corr 块里存在强证伪分支（CORR_REFU_N）');
const CORR_REFU_N = +(/const CORR_REFU_N = (\d+)/.exec(SRC) || [])[1] || 0;
const CORR_REFU_GAP = +(/CORR_REFU_GAP = (\d+)/.exec(SRC) || [])[1] || 0;
ok(CORR_REFU_N >= 50 && CORR_REFU_GAP >= 10, `强证伪门槛合理（n≥${CORR_REFU_N}、实测低于期望≥${CORR_REFU_GAP}点）`);

const mkCorr = (bucketName, n, hit, days) => {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({ prob: bucketName === '<70' ? 60 : 75, date: '2026-09-' + String(20 + (i % days)).padStart(2, '0'),
      resolved: { hit: i < hit } });
  }
  const buckets = { [bucketName]: { n, hit, list } };
  const S = { learn: {} };
  const dayStats = l => ({ n: l.length, hit: l.filter(s => s.resolved.hit).length, days: new Set(l.map(s => s.date)).size });
  const neutralRate = l => (l.length ? l.filter(s => s.resolved.hit).length / l.length : null);
  const _cl = (v, a, b) => Math.max(a, Math.min(b, v));
  // ⛔ dr 轮补：corrSrc 的文案走 ppTxt，沙箱必须装它
  const _ppSrc = SRC.slice(SRC.indexOf('function ppTxt(v, signed) {'), SRC.indexOf('\n}\n', SRC.indexOf('function ppTxt(v, signed) {')) + 3);
  return new Function('buckets', 'dayStats', 'MIN_LEARN_DAYS', 'CORR_REFU_N', 'CORR_REFU_GAP',
    'neutralRate', 'EXP', 'GLOBAL', '_cl', 'S', _ppSrc + '\n' + corrSrc + '\n return S.learn.buckets;'
  )(buckets, dayStats, 5, CORR_REFU_N, CORR_REFU_GAP, neutralRate, {}, 0.5, _cl, S)[bucketName];
};

// ① 天数不足但样本够厚 + 实测远低于期望 → 必须照实测打折，不能退回 corr=1
let o = mkCorr('<70', 100, 30, 2);           // 100 条 / 跨 2 日 / 实测 30% vs 期望 60%
ok(o.corr < 1, `⚠️ 强证伪生效：100条跨2日实测30%(期望60%) → corr=${o.corr}（打折，不是 1）`);
ok(!o.locked, '强证伪档不标 locked（证据被采信）');
ok(/强证伪/.test(o.evidence || ''), 'evidence 标注为强证伪，面板可溯源');

// ② 单向性：实测【高于】期望时不放行（那只会放宽闸门，更可能是运气）
o = mkCorr('<70', 100, 90, 2);               // 实测 90% vs 期望 60%
ok(o.corr === 1, '⚠️ 单向性：实测高于期望时不打折（corr=1），避免拿运气抬分放宽闸门');
ok(!!o.locked, '实测高于期望 → 判证据不足并锁定');

// ③ 样本不够厚 → 不触发强证伪
o = mkCorr('<70', 50, 15, 2);                // 50 条 < 80，实测 30%
ok(o.corr === 1 && !!o.locked, '样本不足 80 条 → 不触发强证伪，回到"暂不校准"');

// ④ 天数够 → 走正常校准分支，结果一致
o = mkCorr('<70', 100, 30, 6);               // 跨 6 日 ≥ MIN_LEARN_DAYS
ok(o.corr < 1 && !o.locked, `天数足够时走正常分支：corr=${o.corr}`);

// ⑤ 折扣下限：再差也只打到 0.7，不会把概率压成 0
o = mkCorr('<70', 300, 0, 2);                // 实测 0%
ok(o.corr === 0.7, `折扣有下限：实测 0% 时 corr 仍为 ${o.corr}（clamp 0.7，不会压死）`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
