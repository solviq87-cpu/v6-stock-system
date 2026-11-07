// 守门：_backfill_nd.js（nd 存量回填 · 与 server.js resolveNextDay 同口径）
// 钉语义不钉字符串：公式真值、quality 四档、各板块 limitUp、六条跳过路径、
// 线上回拉只读兜底+节流、落盘备份+流水+幂等。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./_backfill_nd.js');
const { computeNd, planBackfill, applyBackfill, makeCacheRows, BACKTEST_CLASSES } = M;

// 造K线：signal 日 + 次日
const mkRows = (sigDate, sigClose, nx) => ([
  { date: sigDate, open: sigClose, high: sigClose, low: sigClose, close: sigClose, pct: 0 },
  Object.assign({ date: nx.date, open: sigClose, close: sigClose, pct: 0 }, nx)
]);
const sig = (o) => Object.assign({ type: 'auczt', date: '20261008', code: '600000', name: '测试', price: 10 }, o);

// 1) 公式真值：entry=信号日收盘 10；次日 high 11 / close 10.5 / pct 5
const nd1 = computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.5, pct: 5 }));
assert(nd1 && nd1.date === '20261009' && nd1.mode === '次日', 'computeNd date/mode');
assert(nd1.nextPct === 5, 'computeNd nextPct 取次日 pct');
assert(Math.abs(nd1.maxGain - 10) < 1e-9, 'computeNd maxGain=(11-10)/10=10%');
assert(Math.abs(nd1.closeGain - 5) < 1e-9, 'computeNd closeGain=(10.5-10)/10=5%');
assert(Math.abs(nd1.fallback - 5) < 1e-9, 'computeNd fallback=maxGain-closeGain=5');
assert(nd1.hit === true, 'computeNd hit=maxGain>=3');
assert(nd1.limitUp === false, 'computeNd 主板+5% 不判涨停');
assert(nd1.quality === 'ok', 'computeNd quality：最高10/收5/回落5 → ok（回落>3 不给 strong）');

// 2) quality 四档
const qStrong = computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.7, pct: 7 }));
assert(qStrong.quality === 'strong', 'quality strong：最高≥5 且 收≥3 且 回落≤3');
const qFake = computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 10.5, close: 10.0, pct: 0 }));
assert(qFake.quality === 'fake', 'quality fake：最高≥3 但收盘<1%（追高被套）');
const qMiss = computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 10.2, close: 10.1, pct: 1 }));
assert(qMiss.quality === 'miss', 'quality miss：最高<3%');

// 3) limitUp 板块分版（与 analysis.js isLimitUp 同源，主板10/创业科创20/北交所30；ST 2026-04 起同主板 ±10%，容差0.3）
assert(computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.98, pct: 9.8 })).limitUp === true, 'limitUp 主板 9.8% → true');
assert(computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.95, pct: 9.5 })).limitUp === false, 'limitUp 主板 9.5% → false（容差0.3）');
assert(computeNd(sig({ code: '300750' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 12, close: 11.98, pct: 19.8 })).limitUp === true, 'limitUp 创业板 19.8% → true');
assert(computeNd(sig({ code: '688981' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 12, close: 11.95, pct: 19.5 })).limitUp === false, 'limitUp 科创板 19.5% → false');
assert(computeNd(sig({ code: '600000', name: 'ST 测试' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.98, pct: 9.8 })).limitUp === true, 'limitUp 主板 ST 9.8% → true（与主板同限幅 10%，容差0.3）');
assert(computeNd(sig({ code: '600000', name: 'ST 测试' }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 10.5, close: 10.48, pct: 4.8 })).limitUp === false, 'limitUp 主板 ST 4.8% → false（旧 5cm 口径已废：2026-04 起 ST 与主板同 ±10%）');

// 2b) B2 轮：开盘价三件套（open/openGap/oneLine）
const b2 = computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 10.4, high: 10.8, low: 10.3, close: 10.6, pct: 6 }));
assert(b2.open === 10.4 && Math.abs(b2.openGap - 4) < 1e-9, 'B2 open=次日开盘价 / openGap=(10.4-10)/10=+4%');
assert(b2.oneLine === false, 'B2 普通上涨日 → 不是一字板');
const yz = computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 11, high: 11, low: 11, close: 11, pct: 10 }));
assert(yz.openGap === 10 && yz.limitUp === true && yz.oneLine === true, 'B2 一字板：开盘=涨停价 11 且全天无波动 → oneLine=true（买不进）');
const yz20 = computeNd(sig({ code: '300750' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 12, high: 12, low: 12, close: 12, pct: 20 }));
assert(yz20.oneLine === true, 'B2 创业板一字板（20cm·涨停价 12）同样识别');
const yzST = computeNd(sig({ code: '600000', name: 'ST 测试' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 11, high: 11, low: 11, close: 11, pct: 10 }));
assert(yzST.oneLine === true, 'B2 主板 ST 一字板（10cm·涨停价 11）同样识别');
const openSeal = computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 11, high: 11, low: 10.9, close: 11, pct: 10 }));
assert(openSeal.oneLine === false, 'B2 开盘触板但盘中破过涨停价（low 10.9）→ 不算一字板（理论上买得进）');
const belowLimitOpen = computeNd(sig({ code: '600000' }), mkRows('2026-10-08', 10, { date: '2026-10-09', open: 10.9, high: 11, low: 10.9, close: 11, pct: 10 }));
assert(belowLimitOpen.oneLine === false, 'B2 开盘价未到涨停价（10.9 < 11）→ 不算一字板');
const noOpen = computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.5, pct: 5, open: 0 }));
assert(noOpen.open === null && noOpen.openGap === null && noOpen.oneLine === null, 'B2 缺开盘价 → 三件套写 null（不写 false：没有数据≠不是一字板）');

// 4) 六条跳过路径（⛔ 缺数据跳过，绝不冒充）
assert(computeNd(sig({ void: true }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 })) === null, 'void 信号跳过');
assert(computeNd(sig({}), null) === null, '无K线跳过');
assert(computeNd(sig({}), mkRows('2026-10-07', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 })) === null, '缺信号日那根跳过');
assert(computeNd(sig({}), [{ date: '2026-10-08', close: 10 }]) === null, '缺次日那根跳过（次日未走出来）');
assert(computeNd(sig({ nd: { date: '20261009', openGap: 0.5 } }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 })) === null, 'nd 同日已填（新版带 openGap）→ 幂等跳过');
const upg = computeNd(sig({ nd: { date: '20261009', nextPct: 1 } }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.5, pct: 5 }));
assert(upg && upg.date === '20261009' && typeof upg.openGap === 'number' && upg.nextPct === 5, 'B2 同日但旧版 nd（无 openGap）→ 重算补齐三件套（否则存量永久补不进新字段）');
const ow = computeNd(sig({ nd: { date: '20261010', nextPct: 99 } }), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 }));
assert(ow && ow.date === '20261009' && ow.nextPct === 10, 'nd 不同日 → 覆盖（与服务器一致）');
assert(computeNd(sig({}), mkRows('2026-10-08', 10, { date: '2026-10-09', high: 0, close: 11, pct: 10 })) === null, '次日 high 缺失 → 跳过');

// 5) planBackfill 分类计数 + 类型过滤 + 历史回测直认
(async () => {
  const rowsByCode = {
    '600001': mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 10.5, pct: 5 }),   // 可补
    '600002': [{ date: '2026-10-08', close: 10 }],                                                // 缺次日
    '600003': [{ date: '2026-10-06', close: 10 }, { date: '2026-10-07', close: 10 }]  // 缺信号日（10-08 不在）
  };
  const signals = [
    { type: 'auczt', date: '20261008', code: '600001', name: 'A' },
    { type: 'auczt', date: '20261008', code: '600002', name: 'B' },
    { type: 'auczt', date: '20261008', code: '600003', name: 'C' },
    { type: 'auczt', date: '20261008', code: '600004', name: 'D' },                                // 无缓存
    { type: 'auczt', date: '20261008', code: '600001', name: 'A2', void: true },                   // 作废
    { type: 'auczt', date: '20261008', code: '600001', name: 'A3', nd: { date: '20261009', nextPct: 1 } }, // 已填
    { type: 'pool', date: '20261008', code: '600001', name: 'P' },                                 // 非回测三类，默认不进
    { type: 'yier', date: '20261007', code: '600005', name: 'H', resolved: { mode: '历史回测', date: '20261008', nextPct: 6, maxGain: 7, limitUp: false, hit: true } }
  ];
  const plan = await planBackfill({ signals, rowsOf: c => rowsByCode[c] || null, sleepFn: async () => {} });
  // B2 轮：A3 是旧版 nd（有 nextPct 但无 openGap）→ 不再计 done，重新进计划升级 → 可补 3 条
  assert(plan.actions.length === 3, 'planBackfill 可补 3 条（600001 + A3 旧版 nd 升级 + 历史直认）');
  assert(plan.actions[0].src === 'cache' && plan.actions[1].src === 'cache' && plan.actions[2].src === 'hist', 'src 标记 cache/hist');
  assert(plan.actions[2].nd.nextPct === 6 && plan.actions[2].nd.mode === '次日', '历史回测直认 nd 字段');
  assert(plan.actions[1].sig === signals[5] && typeof plan.actions[1].nd.openGap === 'number', 'B2 升级路径：A3 的 nd 被重算补齐 openGap');
  assert(plan.skipped.noNextBar === 1 && plan.skipped.noSigBar === 1 && plan.skipped.noRows === 1, '跳过分类：缺次日/缺信号日/无缓存 各1');
  assert(plan.skipped.void === 1 && plan.skipped.done === 0, '跳过分类：void 1 / 已填 0（A3 旧版 nd 不算已完成）');
  assert(plan.perType.auczt.filled === 0 && plan.perType.auczt.pending === 5, 'perType auczt 已填0/待补5（A3 进待补）');
  assert(plan.perType.yier.pending === 1, 'perType yier 待补1');
  assert(!plan.actions.some(a => a.sig.type === 'pool'), '默认范围不含 pool（--all 才进）');

  // 5b) B2 轮修真 bug：--all 曾经静默失效（main 里把 null 转成 undefined → 触发 planBackfill
  //     解构默认值又变回三类，而 scope 打印写着「全类型」—— 说的和做的不一样）
  //     ⛔ 查源码必须先剥整行注释：这个 bug 的来龙去脉就写在注释里，字面量会在注释中复现
  const SRCF = fs.readFileSync('./_backfill_nd.js', 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert(/types: all \? null : BACKTEST_CLASSES/.test(SRCF) && !/types: types \|\| undefined/.test(SRCF),
    'B2 CLI 接线：--all 的 null 原样透传（不再 || undefined 触发解构默认值）');
  const planAll = await planBackfill({ signals, rowsOf: c => rowsByCode[c] || null, sleepFn: async () => {}, types: null });
  assert(planAll.actions.some(a => a.sig.type === 'pool'), 'B2 types=null → 全类型都进（pool 也处理，对齐服务器）');
  const planDef = await planBackfill({ signals: [{ type: 'pool', date: '20261008', code: '600001', name: 'P' }], rowsOf: c => rowsByCode[c] || null, sleepFn: async () => {} });
  assert(planDef.actions.length === 0, 'B2 不传 types → 默认仍只回测三类（pool 不进）');

  // 6) --online 兜底：本地解析不了才回拉；太新的信号不打；节流生效；失败计数不崩
  let fetched = [], slept = 0;
  const plan2 = await planBackfill({
    signals: [
      { type: 'auczt', date: '20261008', code: '600001', name: 'A' },   // 本地可解析 → 不回拉
      { type: 'auczt', date: '20261008', code: '600009', name: 'Z' },   // 本地没有 → 回拉成功
      { type: 'auczt', date: '20261008', code: '600010', name: 'Y' },   // 本地没有 → 回拉也失败
      { type: 'auczt', date: '20261014', code: '600011', name: 'N' }    // 太新（=latestDay）→ 不打线上
    ],
    rowsOf: c => rowsByCode[c] || null,
    fetchRows: async c => { fetched.push(c); return c === '600009' ? mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 }) : null; },
    sleepFn: async () => { slept++; },
    latestDay: '20261014'
  });
  assert(fetched.length === 2 && fetched[0] === '600009' && fetched[1] === '600010', 'online 只回拉本地解析不了的老信号（2只）');
  assert(plan2.actions.filter(a => a.src === 'online').length === 1, '线上回拉成功 1 条进 actions');
  assert(plan2.skipped.onlineFail === 1, '线上取不到计数 1（不猜不崩）');
  assert(plan2.skipped.onlineSkipNew === 1, '信号日=最新交易日 → 不打线上（onlineSkipNew）');
  assert(slept === 2, '每次真实回拉后都节流（sleepFn 被调 2 次）');

  // 7) applyBackfill：备份 → 写 → 流水；且落盘后重跑计划 = 全 sameDate/done（幂等）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ndfill-'));
  const statFile = path.join(tmp, 'stats.json');
  const j = { signals };
  fs.writeFileSync(statFile, JSON.stringify(j));
  const r = applyBackfill(tmp, statFile, j, plan.actions, { mode: 'test' });
  assert(r.wrote === 3 && fs.existsSync(path.join(tmp, r.backup)), 'applyBackfill 写 3 条 + 备份存在');
  const after = JSON.parse(fs.readFileSync(statFile, 'utf8'));
  assert(after.signals[0].nd && after.signals[0].nd.date === '20261009', '落盘后信号0 有 nd');
  assert(after.signals[5].nd && typeof after.signals[5].nd.openGap === 'number', 'B2 落盘后 A3 的 nd 已升级（带 openGap）');
  assert(after.signals[4].void === true && !after.signals[4].nd, 'void 信号没被写 nd');
  const ops = JSON.parse(fs.readFileSync(path.join(tmp, '.nd_backfill_ops.json'), 'utf8'));
  assert(Array.isArray(ops) && ops.length === 1 && ops[0].wrote === 3 && ops[0].mode === 'test', '流水登记 1 条（wrote/mode）');
  const plan3 = await planBackfill({ signals: after.signals, rowsOf: c => rowsByCode[c] || null, sleepFn: async () => {} });
  assert(plan3.actions.length === 0, '重跑计划：0 可补（幂等；升级后的 A3 也已 done，历史直认的薄 nd 无缓存可取→noRows）');
  assert(plan3.skipped.done === 2, '重跑计划：done 2（本轮新填 2 条 + A3 升级 1 条都入账）');
  fs.rmSync(tmp, { recursive: true, force: true });

  // 8) makeCacheRows 内存缓存：同票二次调用不重复读盘（用 fs 读取计数不便，改测返回一致性+坏文件容错）
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ndcache-'));
  fs.writeFileSync(path.join(dir2, '600001.json'), JSON.stringify({ rows: mkRows('2026-10-08', 10, { date: '2026-10-09', high: 11, close: 11, pct: 10 }) }));
  fs.writeFileSync(path.join(dir2, 'broken.json'), '{bad json');
  const rowsOf = makeCacheRows(dir2);
  assert(rowsOf('600001').length === 2, 'makeCacheRows 正常读 rows');
  assert(rowsOf('600001') === rowsOf('600001'), 'makeCacheRows 同票返回同一引用（内存缓存）');
  assert(rowsOf('broken') === null, 'makeCacheRows 坏 JSON → null（不抛）');
  assert(rowsOf('nope') === null, 'makeCacheRows 不存在 → null');
  fs.rmSync(dir2, { recursive: true, force: true });

  // 9) 常量与服务器对齐
  assert(BACKTEST_CLASSES.join(',') === 'auczt,yier,lianban', '默认范围=回测三类');
  assert(M.HIT_THR === 3, 'HIT_THR=3（与 server.js L1011 同值）');

  console.log(`${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
