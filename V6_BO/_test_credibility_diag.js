// 守门：#266 每日可信度自检（ig 轮 · 2026-10-16）
// 钉语义不钉数字：① 接线事实（三类检查/只记录不外发/16:30 定时器/当日一次）② 沙箱真跑各场景
// （盖戳不可信/快照陈旧/宽度陈旧/EV 证据不足/EV 可用/统计不可用/非交易日/当日幂等）。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const fs = require('fs'), path = require('path');
const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (aMark, bMark) => {
  const i = src.indexOf(aMark);
  const j = src.indexOf(bMark, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + aMark);
  return src.slice(i, j);
};

// ============ ① 接线事实 ============
console.log('\n===== ① 接线事实 =====');
const credSrc = cut('// ─── #266 每日可信度自检', 'async function scanBigMoneyPush');
assert(credSrc.includes('function credibilityDiag()'), 'credibilityDiag 函数存在');
assert(/_credDiagDay === ds\) return;/.test(credSrc), '当日一次（_credDiagDay 幂等）');
assert(/if \(!isTradeDay\(new Date\(\)\)\) return;/.test(credSrc), '非交易日不诊断');
assert(/S\.ztDayProbed === false/.test(credSrc), '① 盖戳可信度检查（探测失败留痕）');
assert(/dayKeyOf\(at\)/.test(credSrc) && /不一致——陈旧快照/.test(credSrc), '② 快照归属日 vs 拉取时刻检查');
assert(/todayBreadth\(\)/.test(credSrc) && /bb\.isToday/.test(credSrc), '② 市场宽度新鲜度检查（isToday）');
assert(/evStatsCached\(\)/.test(credSrc) && /EV_COLD_FEE/.test(credSrc), '③ EV 校准充足性检查（含普跌收紧阈值）');
assert(/证据不足/.test(credSrc) && /回退无条件层/.test(credSrc), '③ 环境层证据不足时如实说明回退（不假装条件化生效）');
assert(/for \(const line of lines\) pushLog\('🩺 每日可信度自检', line, \{ note: '#266/.test(credSrc), '只写 push-log（note 标注 #266）');
// ⛔ 只记录不外发：函数体内不许出现任何发送出口
assert(!/feishuSend|pushAll|sendQQMail|enqueueIntradayMsg/.test(credSrc), '⛔ 体内无任何发送出口（只记录不外发）');
// jy 轮：同窗口触发 runDataAccuracyMonitor，允许 if 块内调用。
assert(/if \(isTradeDay\(d\) && t >= 16 \* 60 \+ 30 && t < 24 \* 60\)\s*\{?[\s\S]*?credibilityDiag\(\);/.test(src), '16:30 起每分钟补跑（容器回收不怕，与 D5 同款）');

// ============ ② 沙箱真跑 ============
console.log('\n===== ② 场景真跑 =====');
const EV = require('./_ev_daily.js');
const mk = (S, stubs) => new Function('S', 'todayStr', 'isTradeDay', 'ztDayTag', 'dayKeyOf', 'todayBreadth', 'evStatsCached', 'evEnvNow', 'EV', 'pushLog', 'console', '_envLayerOf',
  `${credSrc}\nreturn { credibilityDiag, _reset: () => { _credDiagDay = ''; } };`)(
    S, stubs.todayStr || (() => '20261016'), stubs.isTradeDay || (() => true),
    stubs.ztDayTag || (d => d === '20261015' ? '昨日' : '今日'),
    // ⛔ dayKeyOf 真实口径是 YYYYMMDD（无横线，与 todayStr/S.sectorsDay 同格式），桩必须对齐
    stubs.dayKeyOf || (() => '20261016'),
    stubs.todayBreadth || (() => ({ upRatio: 10, isToday: true, basisDay: '20261016' })),
    stubs.evStatsCached || (() => null), stubs.evEnvNow || (() => '普跌'),
    EV, stubs.pushLog || (() => { }), { log() { }, error() { } },
    stubs._envLayerOf || (ur => (ur == null || Number.isNaN(ur)) ? '未知' : (ur < 40 ? '普跌' : (ur > 52 ? '普涨' : '退潮'))));

const mkStats = (over) => Object.assign({
  liveN: 1212, minN: 30, minDays: 5,
  skipped: { void: 414, noNd: 232, backtest: 600, postHoc: 142 },
  universe: { n: 1212, evCloseFee: -1.247, sig: 'sig', tClu: -3.55 },
  byEnv: { '普跌': { n: 300, days: 6, evCloseFee: -1.73, sig: 'sig', tClu: -2.9, unknown: false } },
  cells: { 'pool|55-59': { n: 40 }, 'pool|60-69': { n: 30 }, 'fastin|55-59': { n: 10, unknown: true, reason: 'n<30' } },
}, over);

// A) 全绿场景：盖戳可信 + 快照同日 + 宽度今日 + EV 证据足
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => mkStats() });
  G.credibilityDiag();
  const G2 = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => mkStats(), pushLog: (st, tx) => lines.push(st + '|' + tx) });
  G2._reset(); G2.credibilityDiag();
  // 7 行：①盖戳 ②资金流 ②宽度 ③EV总览 ③当前层 ③证据覆盖 ③样本口径
  assert(lines.length === 7, `全绿场景写 7 行（盖戳/资金流/宽度/EV总览/当前层/覆盖/口径）→ 实际 ${lines.length}`);
  assert(lines.every(l => l.startsWith('🩺 每日可信度自检|')), '全部走「🩺 每日可信度自检」标题');
  assert(lines[0].includes('归属日可信'), '① 盖戳可信 ✅');
  assert(lines[1].includes('归属日与拉取日一致'), '② 资金流快照同日 ✅');
  assert(lines[2].includes('市场宽度为今日实时') && lines[2].includes('普跌层'), '② 宽度今日实时且分层正确 ✅');
  assert(lines[3].includes('总体费后 -1.247%') && lines[3].includes('显著'), '③ EV 总览带显著性与门槛 ✅');
  assert(lines[4].includes('当前「普跌」层 EV') && lines[4].includes('-0.5%'), '③ 当前层阈值取普跌收紧值 -0.5% ✅');
  assert(lines[5].includes('2/3'), '③ 证据覆盖 2/3 格（充分格数/总格数）✅');
  assert(lines[6].includes('live 占') && lines[6].includes('1212'), '③ 样本口径行：live 占比 + 条数 ✅');
}
// B) 盖戳探测失败 → 警告且不说"可信"
{
  const lines = [];
  const G = mk({ ztDay: '20261015', ztDayProbed: false, sectorsAt: Date.parse('2026-10-16T09:00:00'), sectorsDay: '20261015' },
    { evStatsCached: () => mkStats(), dayKeyOf: () => '20261016', pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[0].includes('归属日不可信') && lines[0].includes('机器日期兜底'), '① 探测失败 → 警告「不可信·兜底」（盘前把昨日说成今日的风险写明）');
}
// C) 资金流快照归属日 ≠ 拉取日 → 陈旧快照警告
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T09:00:00'), sectorsDay: '20261014' },
    { evStatsCached: () => mkStats(), dayKeyOf: () => '20261016', pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[1].includes('不一致——陈旧快照') && lines[1].includes('20261014'), '② 归属日 10-14 ≠ 拉取日 10-16 → 陈旧快照警告（带两个日子）');
}
// D) 宽度陈旧（isToday=false）→ 阈值可能用错行情
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => mkStats(), todayBreadth: () => ({ upRatio: 12, isToday: false, basisDay: '20261015' }), pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[2].includes('陈旧快照（截至 20261015') && lines[2].includes('用错行情'), '② 宽度陈旧 → 警告并说明后果（普跌收紧可能用错行情）');
}
// E) 当前层 EV 证据不足 → 如实说回退，不假装条件化生效
{
  const lines = [];
  const st = mkStats({ byEnv: { '普跌': { n: 20, days: 3, evCloseFee: -1.1, sig: 'ns', tClu: -1.2, unknown: true, reason: 'n<30' } } });
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => st, pushLog: (st2, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[4].includes('证据不足') && lines[4].includes('n=20') && lines[4].includes('回退无条件层') && lines[4].includes('证据不匹配'), '③ 环境层不足 → 写明 n/days+回退无条件层+证据不匹配（⛔ 不假装条件化生效）');
}
// F) EV 统计不可用 → 闸门今日无人把关
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => null, pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[3].includes('EV 统计不可用') && lines[3].includes('无人把关'), '③ evStatsCached=null → 「闸门整体失效·无人把关」（不静默）');
}
// G) 非交易日 → 一行不写
{
  const lines = [];
  const G = mk({ ztDay: '', ztDayProbed: true, sectorsAt: 0, sectorsDay: '' },
    { isTradeDay: () => false, evStatsCached: () => mkStats(), pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines.length === 0, '非交易日不诊断（无当日数据，写了也是假的）');
}
// H) 当日幂等：第二次调用不重复写
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: Date.parse('2026-10-16T14:30:00'), sectorsDay: '20261016' },
    { evStatsCached: () => mkStats(), pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag(); G.credibilityDiag(); G.credibilityDiag();
  assert(lines.length === 7, `同日多次调用只写一次（7 行）→ 实际 ${lines.length}`);
}
// I) 无资金流快照 → 明说没数据来源
{
  const lines = [];
  const G = mk({ ztDay: '20261016', ztDayProbed: true, sectorsAt: 0, sectorsDay: '' },
    { evStatsCached: () => mkStats(), pushLog: (st, tx) => lines.push(tx) });
  G.credibilityDiag();
  assert(lines[1].includes('无快照') && lines[1].includes('别把那列当实时'), '② 无资金流快照 → 明说没数据来源（⛔ 不留空让人以为有）');
}

console.log(`_test_credibility_diag: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
