'use strict';
// 渠道健壮性（fw 轮）：全A快照落盘 + 冷启动恢复 单测。
// 直接抠 server.js 里的 setAllStocks / loadSnapshotsOnBoot 源码，注入最小依赖在受控环境跑真实往返。
const fs = require('fs');
const os = require('os');
const path = require('path');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到起始: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
const STOCKS_SNAP_FILE = path.join(tmp, 'stocks_snapshot.json');
const ZTPOOL_SNAP_FILE = path.join(tmp, 'ztPool_snapshot.json');
const SECTORS_FILE = path.join(tmp, 'sectors.json');

// 注入的最小依赖
const S = { stocks: [], stocksAt: 0, ztPool: [], ztDay: '', sectors: [] };
const ingestPx = () => {};
const atomicWrite = (file, text) => { try { fs.writeFileSync(file, text); return true; } catch (e) { return false; } };
const _diskFail = () => {};

// 抽 setAllStocks（唯一写入入口，成功即落盘快照）
const setSrc = grab('function setAllStocks(rows) {', '// 涨跌幅符号：');
const setAllStocks = new Function('S', 'atomicWrite', 'ingestPx', '_diskFail', 'STOCKS_SNAP_FILE', 'ZTPOOL_SNAP_FILE',
  setSrc + '\nreturn setAllStocks;')(S, atomicWrite, ingestPx, _diskFail, STOCKS_SNAP_FILE, ZTPOOL_SNAP_FILE);

// 抽 loadSnapshotsOnBoot（启动即读回磁盘快照）
const loadSrc = grab('function loadSnapshotsOnBoot() {', 'async function init() {');
// ⛔ 2026-10-28 补：恢复段现在还会过一遍 A.ztTallyOf（涨停家数口径：退市整理期股不计入），
//    另外还会调 loadStrategyCards / loadAuctionSnapshot 恢复策略卡片与竞价快照。
//    沙箱是 new Function 拼的 —— 块里多引用一个外部符号就必须在这里同步补上，
//    否则不是断言变红，而是整段 try 抛异常被 catch 吞掉 → 快照"恢复不出来"，
//    看起来像生产 bug，实际是夹具缺依赖（本次就是这条：A 没注入）。
const A = require('./analysis.js');
const loadSnapshotsOnBoot = new Function('S', 'fs', 'path', 'A',
  'STOCKS_SNAP_FILE', 'ZTPOOL_SNAP_FILE', 'SECTORS_FILE', 'console', 'loadStrategyCards', 'loadAuctionSnapshot',
  loadSrc + '\nreturn loadSnapshotsOnBoot;')(
  S, fs, path, A, STOCKS_SNAP_FILE, ZTPOOL_SNAP_FILE, SECTORS_FILE, console,
  () => false, () => false);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ① setAllStocks 落盘 + 写入 S.stocks
const rows = Array.from({ length: 120 }, (_, i) => ({ code: String(600000 + i), name: 'X' + i, price: 10, pct: 1, floatCap: 1e9 }));
ok('setAllStocks 拒绝过少样本', setAllStocks([{ code: '1', name: 'a', price: 1, pct: 0 }]) === false);
ok('setAllStocks 接受足量样本', setAllStocks(rows) === true);
ok('setAllStocks 写入 S.stocks', S.stocks.length === 120);
ok('setAllStocks 落盘快照文件', fs.existsSync(STOCKS_SNAP_FILE));
const snap = JSON.parse(fs.readFileSync(STOCKS_SNAP_FILE, 'utf8'));
ok('快照含 rows 与 at', Array.isArray(snap.rows) && snap.rows.length === 120 && typeof snap.at === 'number');

// ② 清空内存后，loadSnapshotsOnBoot 从磁盘恢复 S.stocks
S.stocks = []; S.stocksAt = 0;
loadSnapshotsOnBoot();
ok('冷启动恢复全A', S.stocks.length === 120);
ok('恢复带 stocksAt', typeof S.stocksAt === 'number' && S.stocksAt > 0);

// ③ 涨停池快照往返
const zt = [{ code: '600000', name: 'X', price: 11, pct: 10, limitUpCount: 1, sector: '电池' }];
fs.writeFileSync(ZTPOOL_SNAP_FILE, JSON.stringify({ day: '20261009', at: Date.now(), pool: zt }));
S.ztPool = []; S.ztDay = '';
loadSnapshotsOnBoot();
ok('冷启动恢复涨停池', S.ztPool.length === 1 && S.ztPool[0].code === '600000');
ok('恢复带 ztDay', S.ztDay === '20261009');

// ③b ⛔ 2026-10-28 新增（涨停家数口径：退市整理期股不计入）：
//    快照是上一进程写的，可能是「退市股也算一家」的旧口径 → 恢复时必须过同一把尺子，
//    并且**剔了谁要留痕**（不许静默消失），快照来的戳一律标未探测（来历不可考）。
{
  fs.writeFileSync(ZTPOOL_SNAP_FILE, JSON.stringify({ day: '20261028', at: Date.now(), pool: [
    { code: '600000', name: 'X', price: 11, pct: 10 },
    { code: '002731', name: '萃华退', price: 0.28, pct: 10 }] }));
  S.ztPool = []; S.ztDay = ''; S.ztExcluded = null; S.ztDayProbed = true;
  loadSnapshotsOnBoot();
  ok('退市整理期股恢复时被剔除（涨停家数口径）', S.ztPool.length === 1 && S.ztPool[0].code === '600000',
    '实恢复 ' + S.ztPool.length + ' 只');
  ok('被剔除的票留痕可查（S.ztExcluded 记只数与明细）',
    !!S.ztExcluded && S.ztExcluded.count === 1 && /萃华退/.test(JSON.stringify(S.ztExcluded)),
    JSON.stringify(S.ztExcluded));
  ok('快照恢复的戳标未探测（来历不可考）', S.ztDayProbed === false);
}

// ④ 已有数据时不覆盖（实时拉取优先）
S.stocks = [{ code: '999999', name: 'live', price: 1, pct: 0 }];
loadSnapshotsOnBoot();
ok('内存已有数据不被快照覆盖', S.stocks.length === 1 && S.stocks[0].code === '999999');

// ⑤ 空/损坏快照不崩
S.ztPool = []; fs.writeFileSync(ZTPOOL_SNAP_FILE, JSON.stringify({ pool: [] }));
loadSnapshotsOnBoot();
ok('空涨停池快照不崩', S.ztPool.length === 0);
S.stocks = []; fs.writeFileSync(STOCKS_SNAP_FILE, 'not json');
loadSnapshotsOnBoot();
ok('损坏快照不崩', S.stocks.length === 0);

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
