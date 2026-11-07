// 守门：_audit_zt_pool.js（涨停池数据源质量抽查 · G1）
// 钉语义不钉字符串：漏票严口径（收盘贴涨停价）vs 错票宽口径（isLimitUp）的不对称、
// 口径存疑（收盘价超按名+板块推算的涨停价）aboveLimit 单列、触板未封板 nearMiss 不计漏票、新股窗口 noLimitSkip、
// 重码/缺字段/源混杂/陈旧/覆盖率降级、listedDaysAgo 与 makeNoLimit、坏缓存文件不炸轮。
// 汇总行格式走 _runall.js 判定口径「N 通过 / M 失败」。

const assert = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); }
};
let pass = 0, fail = 0;

const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./_audit_zt_pool.js');
const { auditZTPool, listedDaysAgo, makeNoLimit, loadCacheKlines } = M;

// n 天前的 YYYYMMDD 数字（用于上市日期夹具）
const daysAgoStr = n => {
  const d = new Date(Date.now() - n * 86400000);
  return +`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const rows = (prevClose, bar) => ([
  { date: '2026-10-15', open: prevClose, high: prevClose, low: prevClose, close: prevClose, pct: 0 },
  Object.assign({ date: '2026-10-16', open: 0, high: 0, low: 0, close: 0, pct: 0 }, bar)
]);
const noLimit = code => code === '301012';   // 新股窗口夹具钩子
const NOW = Date.now();

// 主夹具：覆盖全部维度
const pool = [
  { code: '600001', name: '甲股份', pct: 10.0, src: 'em', sector: '银行', firstSeal: '093000' },  // 真涨停在池
  { code: '600002', name: '乙股份', pct: 10.0, src: 'em' },                                       // 错票：K线只涨3%
  { code: '600003', name: '丙股份', pct: 10.5, src: 'em' },                                       // pct 偏差观察
  { code: '600004', name: '丁股份', pct: 10.0, src: 'em' },                                       // 重码 ×2
  { code: '600004', name: '丁股份', pct: 10.0, src: 'em' },
  { code: '600005', name: '戊股份', pct: null, src: 'em' },                                       // 缺字段
  { code: '600006', name: '己股份', pct: 10.0, src: 'em' },                                       // 无K线
  { code: '600007', name: '庚股份', pct: 10.0, src: 'ths', sector: '', firstSeal: null }           // 同花顺兜底源
];
const klines = [
  { code: '600001', name: '甲股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) },
  { code: '600002', name: '乙股份', rows: rows(10, { close: 10.3, pct: 3, high: 10.5 }) },
  { code: '600003', name: '丙股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) },
  { code: '600004', name: '丁股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) },
  { code: '600005', name: '戊股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) },
  { code: '600007', name: '庚股份', rows: rows(20, { close: 22, pct: 10, high: 22 }) },
  { code: '600008', name: '辛股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) },   // 漏票：主板封板不在池
  { code: '300009', name: '壬股份', rows: rows(10, { close: 12, pct: 20, high: 12 }) },   // 漏票：创业20cm
  { code: '300010', name: '癸股份', rows: rows(10, { close: 11.5, pct: 15, high: 12 }) }, // 触板未封板
  { code: '600011', name: '*ST测试', rows: rows(10, { close: 11.3, pct: 13, high: 11.3 }) }, // aboveLimit：收盘超按名+板块推算涨停价（ST 2026-04 起 10% → 数据异常）
  { code: '301012', name: '子股份', rows: rows(10, { close: 13, pct: 30, high: 13 }) },   // 新股窗口
  { code: '600013', name: '丑股份', rows: [{ date: '2026-10-16', open: 11, high: 11, low: 11, close: 11, pct: 10 }] }, // 无前收柱
  { code: '600014', name: '寅股份', rows: rows(10, { close: 10.2, pct: 2, high: 10.3 }) } // 普通上涨：什么都不算
];

const r1 = auditZTPool(pool, klines, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });

// 1) 结构与统计
assert(r1.poolN === 8 && r1.crossN === 7, 'poolN=8 / crossN=7（无K线的600006不计）');
assert(Math.abs(r1.coverage - 7 / 8) < 1e-9, 'coverage=7/8');
assert(r1.dupCode.length === 1 && r1.dupCode[0].code === '600004' && r1.dupCode[0].n === 2, '重码识别 600004×2');
assert(r1.badField.length === 1 && r1.badField[0].code === '600005' && r1.badField[0].pct === null, '缺字段识别 600005（pct=null 原样带出）');
assert(JSON.stringify(r1.srcMix) === JSON.stringify({ em: 7, ths: 1 }), 'srcMix=em7/ths1');
assert(r1.noKline.length === 1 && r1.noKline[0] === '600006', '无K线成员单列 600006');

// 2) 错票（宽口径：池说涨停·K线不认）→ fail 方向
assert(r1.fakeZT.length === 1 && r1.fakeZT[0].code === '600002' && r1.fakeZT[0].poolPct === 10 && r1.fakeZT[0].klinePct === 3, '错票识别 600002（池10% vs K线3%）');
assert(r1.verdict === 'fail', '有错票 → verdict=fail');

// 3) pct 偏差观察（不改变判定）
assert(r1.pctDiff.length === 1 && r1.pctDiff[0].code === '600003' && r1.pctDiff[0].poolPct === 10.5 && r1.pctDiff[0].klinePct === 10, 'pct 偏差识别 600003（10.5 vs 10.0，>0.15pp）');

// 4) 漏票（严口径：收盘贴住涨停价）——fakeZT 场景外的正确集合
assert(r1.missed.length === 2 && r1.missed[0].code === '300009' && r1.missed[1].code === '600008', '漏票=300009(20cm)+600008，按 pct 降序');
assert(r1.missed[1].close === 11 && r1.missed[1].limitPx === 11, '漏票记录带 close 与 limitPx 依据');
assert(!r1.missed.some(m => m.code === '300010'), '触板未封板不算漏票（300010 收11.5<涨停价12）');
assert(!r1.missed.some(m => m.code === '600011'), '口径存疑不算漏票（600011 收11.3>按名推算涨停价11）');
assert(!r1.missed.some(m => m.code === '301012'), '新股窗口不算漏票（钩子命中走 noLimitSkip）');

// 5) 三个单列清单
assert(r1.nearMiss.length === 1 && r1.nearMiss[0].code === '300010', '触板未封板单列 300010（high=12=涨停价）');
assert(r1.aboveLimit.length === 1 && r1.aboveLimit[0].code === '600011', '收盘超按名+板块限幅单列 600011（11.3 > 11+1分）');
assert(r1.noPrev.length === 1 && r1.noPrev[0].code === '600013', '无前收柱无法判 → 单列 600013（⛔ 不猜）');
assert(r1.noLimitSkip.length === 1 && r1.noLimitSkip[0].code === '301012' && r1.noLimitSkip[0].inPool === false, '新股窗口单列 301012');

// 6) 同花顺兜底源风险曝光
assert(r1.thsRisk && r1.thsRisk.n === 1 && r1.thsRisk.noSector === 1 && r1.thsRisk.noFirstSeal === 1, 'thsRisk 计数（无行业/无首次封板时间）');
assert(r1.notes.some(n => n.indexOf('同花顺') >= 0), 'notes 曝光兜底源差异');

// 7) 日期归一化：'2026-10-16' 与 '20261016' 等价
const rDash = auditZTPool(pool, klines, { day: '2026-10-16', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });
assert(rDash.missed.length === 2 && rDash.fakeZT.length === 1, '带横线日期同样命中（归一化）');

// 8) 去掉错票后 → warn（漏票在）；干净夹具 → ok
const poolNoFake = pool.filter(z => z.code !== '600002');
const r2 = auditZTPool(poolNoFake, klines, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });
assert(r2.verdict === 'warn' && r2.fakeZT.length === 0 && r2.missed.length === 2, '无错票有漏票 → warn');
const cleanPool = [{ code: '600001', name: '甲股份', pct: 10.0, src: 'em' }];
const cleanK = [{ code: '600001', name: '甲股份', rows: rows(10, { close: 11, pct: 10, high: 11 }) }];
const r3 = auditZTPool(cleanPool, cleanK, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });
assert(r3.verdict === 'ok' && r3.missed.length === 0 && r3.fakeZT.length === 0 && r3.dupCode.length === 0 && r3.badField.length === 0, '干净夹具 → ok');
assert(r3.coverage === 1, '干净夹具 coverage=1');

// 9) 快照陈旧 → warn（即便其他干净）
const r4 = auditZTPool(cleanPool, cleanK, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 30 * 3600000 });
assert(r4.stale === true && r4.verdict === 'warn', '快照 30h 未刷 → stale+warn');

// 10) 覆盖率过低 → warn（查不了不等于没问题）
const r5 = auditZTPool([{ code: '600001', name: '甲股份', pct: 10.0, src: 'em' }, { code: '699999', name: '无K线', pct: 10.0, src: 'em' }], cleanK, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });
assert(r5.coverage === 0.5 && r5.verdict === 'warn', '一半成员无法交叉验证 → warn（⛔ 不拿查不了当通过）');

// 11) 新股钩子降级声明：noLimitActive=false 必须留痕
const r6 = auditZTPool(cleanPool, cleanK, { day: '20261016', noLimit, noLimitActive: false, now: NOW, snapAt: NOW - 3600000 });
// ⛔ kv 轮（2026-10-24）改钉语义不钉字符串：ku 轮把降级说明换成「新股上市日期缺失…按 N/C 前缀兜底…」，
//    语义（显式留痕、不静默）没变，但字面「钩子未生效」没了 → 旧断言假红。
//    判据：noLimitActive=false 时 notes 必须有一条同时讲清「新股」和「降级方式/后果」的显式声明。
assert(r6.noLimitActive === false && r6.notes.some(n => n.indexOf('新股') >= 0
  && /(缺失|兜底|跳过|未生效|待辨认)/.test(n)), '钩子未生效 → notes 显式降级声明（钉语义：讲了新股+降级方式）');

// 12) 池里混新股（宽口径错票检查不误伤）：noLimit 命中的池成员不进 fakeZT
const newPool = [{ code: '301012', name: '子股份', pct: 30.0, src: 'em' }];
const newK = [{ code: '301012', name: '子股份', rows: rows(10, { close: 13, pct: 30, high: 13 }) }];
const r7 = auditZTPool(newPool, newK, { day: '20261016', noLimit, noLimitActive: true, now: NOW, snapAt: NOW - 3600000 });
assert(r7.fakeZT.length === 0 && r7.noLimitSkip.some(o => o.inPool === true), '新股窗口的池成员：不判错票，单列 inPool=true');

// 13) listedDaysAgo：与 server.js 同语义（禁整数减法那条不变量由服务端守门负责，这里钉边界）
assert(listedDaysAgo(0) === null, 'listedDaysAgo(0)=null（缺日期不猜）');
assert(listedDaysAgo('abc') === null, 'listedDaysAgo 非数字=null');
const d3 = listedDaysAgo(daysAgoStr(3));
assert(d3 != null && d3 >= 2 && d3 <= 4, 'listedDaysAgo(3天前)≈3');
assert(listedDaysAgo(daysAgoStr(60)) > 55, 'listedDaysAgo(60天前)>55');

// 14) makeNoLimit：覆盖度过半才激活；行为与 server 注入同口径
const h1 = makeNoLimit([
  { code: 'A', listedDate: daysAgoStr(3) }, { code: 'B', listedDate: daysAgoStr(60) },
  { code: 'C', listedDate: 0 }, { code: 'D', listedDate: daysAgoStr(200) }
]);
assert(h1.active === true, '过半有上市日期 → 钩子激活');
assert(h1.fn('A') === true, '上市3天 → 无涨跌幅限制期');
assert(h1.fn('B') === false && h1.fn('D') === false, '上市60/200天 → 正常限幅');
assert(h1.fn('C') === false && h1.fn('Z') === false, '缺上市日期 → 不判新股（降级路径）');
const h2 = makeNoLimit([{ code: 'A', listedDate: 0 }, { code: 'B', listedDate: 0 }]);
assert(h2.active === false, '全缺上市日期 → 钩子不激活（本地快照实况）');

// 15) loadCacheKlines：坏文件跳过不炸轮，缺目录不炸
const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ztcache-'));
fs.writeFileSync(path.join(dir1, '600001.json'), JSON.stringify({ name: '甲', rows: [{ date: '2026-10-16', close: 11, pct: 10 }] }));
fs.writeFileSync(path.join(dir1, 'bad.json'), '{oops');
fs.writeFileSync(path.join(dir1, 'note.txt'), 'x');
const lc = loadCacheKlines(dir1);
assert(lc.klines.length === 1 && lc.klines[0].code === '600001' && lc.klines[0].name === '甲', 'loadCacheKlines 读好文件');
assert(lc.broken === 1 && lc.files === 2, '坏 JSON 计数不抛（txt 不计入 files）');
const lc2 = loadCacheKlines(path.join(dir1, 'no-such-dir'));
assert(lc2.klines.length === 0 && lc2.broken === 0, '缺目录 → 空结果不抛');
fs.rmSync(dir1, { recursive: true, force: true });

// 16) CLI 接线与共享限幅规则（静态）
const SRCF = fs.readFileSync(path.join(__dirname, '_audit_zt_pool.js'), 'utf8');
assert(SRCF.indexOf('A.limitPctOf') >= 0, '严口径限幅走 A.limitPctOf（规则与生产共用同一份）');
assert(SRCF.indexOf('A.isLimitUp') >= 0, '错票判定走 A.isLimitUp（宽口径，少误报 fail）');
assert(/--fetch/.test(SRCF) && /--stocks-online/.test(SRCF) && /--date/.test(SRCF), 'CLI 接线：--fetch/--stocks-online/--date');
const em = require('./em.js');
assert(typeof em.fetchZTPool === 'function', 'em.fetchZTPool 已导出（--fetch 依赖）');
assert(typeof em.fetchAllStocksEM === 'function', 'em.fetchAllStocksEM 已导出（--stocks-online 依赖）');

// 17) auditMissedBySnapshot：全A快照漏票（覆盖全市场，不只 .kline_cache）+ 低开拉板标注
{
  const snap = [
    { code: '603337', name: '杰克科技', preClose: 31.33, price: 34.46, pct: 9.99, open: 31.14 }, // 主板10%涨停，低开-0.6% → 漏票+低开
    { code: '600001', name: '甲股份', preClose: 10, price: 11, pct: 10, open: 10.9 },            // 涨停，高开+9% → 漏票但非低开
    { code: '600002', name: '未封', preClose: 10, price: 10.99, pct: 9.9, open: 10.1 },          // 板下1分 → 严口径不误报
    { code: '600003', name: '池中有', preClose: 10, price: 11, pct: 10, open: 10.1 },            // 已在池 → 不重复补
    { code: '301012', name: '新股', preClose: 10, price: 13, pct: 30, open: 10 },                // 新股无限制期 → 跳过
    { code: '600004', name: '无open', preClose: 10, price: 11, pct: 10, open: 0 },               // open=0 → openPct=null
  ];
  const rMiss = M.auditMissedBySnapshot(snap, [{ code: '600003', name: '池中有', pct: 10 }], { day: '20261019', noLimit });
  const codes = rMiss.missed.map(o => o.code).sort();
  assert(codes.join(',') === '600001,600004,603337', '全A漏票：主板涨停补 3 只，未封/池中/新股不误报', codes.join(','));
  const jk = rMiss.missed.find(o => o.code === '603337');
  assert(jk && jk.lowOpen === true && jk.openPct === -0.61, '603337 低开拉板：openPct=-0.61、lowOpen=true', JSON.stringify(jk));
  const jia = rMiss.missed.find(o => o.code === '600001');
  assert(jia && jia.lowOpen === false, '高开秒板 lowOpen=false');
  const noOpen = rMiss.missed.find(o => o.code === '600004');
  assert(noOpen && noOpen.openPct === null && noOpen.lowOpen === false, '无 open → openPct=null、lowOpen=false（缺数据≠0）');
  assert(rMiss.lowOpen === 1 && rMiss.noOpen === 1 && rMiss.scanned === 6, '低开/无open计数 + scanned=6', rMiss.lowOpen + '/' + rMiss.noOpen + '/' + rMiss.scanned);
  assert(M.auditMissedBySnapshot([], [], { day: '20261019' }).missed.length === 0, '空快照 → 空漏票（不崩）');
  assert(SRCF.indexOf('auditMissedBySnapshot') >= 0, 'main 接线 auditMissedBySnapshot（每日抽查自动跑）');
}

// 18) 常量与服务器对齐
assert(M.NO_LIMIT_DAYS === 8, 'NO_LIMIT_DAYS=8（与 server.js 同值）');
assert(M.PCT_DIFF_TOL === 0.15 && M.STALE_MS === 26 * 3600 * 1000 && M.NO_KLINE_WARN === 0.2, '观察容差/陈旧阈值/覆盖率告警阈值为约定值');

console.log(`${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
