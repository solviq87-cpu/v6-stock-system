// ═══ gq 轮实证研究（2026-10-13 凌晨）：用户「先调研」项的数据支撑测量 ═══
//  Items: I6 市值U型筛选 / M4 小盘因子衰减 / V13 微盘因子 → 合一为「流通市值分档」
//         H9 换手率区间 → 「换手率分档」
//         I7 底部首板效应 → 「位置×板位」
//         P5 RSI超卖底背离
//         Y7 ATR动态止损 vs 固定止损（模拟盘口径）
// 数据源：.kline_cache（每票近 60 交易日 K 线）+ stocks_snapshot.json（浮动股本代理）
// 口径自校验：kline volume 单位（手 vs 股）用快照 turnover 反推验证，不许带病上岗。
// ⛔ 所有结论必须带 n 与 base（相对什么），薄样本不下结论（learnall「证据不够不下结论」同源）。
const fs = require('fs');
const A = require('./analysis.js');

// ── 1. 浮动股本代理（快照只有今天值；近 3 个月股本变动占比很小，分档统计可容忍）──
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const floatSh = new Map();   // code -> {fs, capYi, turnSnap, price, listedTs, name}
for (const r of snap.rows || []) {
  if (!r.code || !(r.price > 0) || !(r.floatCap > 0)) continue;
  floatSh.set(r.code, {
    fs: r.floatCap / r.price,                       // 流通股本（股）
    capYi: r.floatCap / 1e8,                        // 今天的流通市值（亿）
    turnSnap: r.turnover,                           // 今天换手率%（快照口径，用于校验）
    price: r.price,
    listedTs: Number(r.listedDate) || 0,
    name: r.name || ''
  });
}

// ── 2. 单位自校验：kline volume 是手还是股？──
(function sanityUnits() {
  const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
  let okShou = 0, okGu = 0, tested = 0;
  for (const f of files) {
    const code = f.replace('.json', '');
    const sh = floatSh.get(code);
    if (!sh || !sh.fs) continue;
    let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
    const rows = k.rows || [];
    if (!rows.length) continue;
    const last = rows[rows.length - 1];
    const v = Number(last.volume) || 0;
    if (!(v > 0)) continue;
    const tShou = v * 100 / sh.fs * 100;   // 手→股
    const tGu = v / sh.fs * 100;           // 股
    if (Math.abs(tShou - sh.turnSnap) < Math.max(0.3, sh.turnSnap * 0.05)) okShou++;
    if (Math.abs(tGu - sh.turnSnap) < Math.max(0.3, sh.turnSnap * 0.05)) okGu++;
    tested++;
    if (tested >= 300) break;
  }
  console.log(`[单位自校验] 样本 ${tested}：volume=手 解释匹配 ${okShou}，volume=股 解释匹配 ${okGu}`);
  if (okShou <= okGu) { console.error('⛔ volume 单位判定异常（股口径匹配不劣于手口径），终止'); process.exit(1); }
})();

// ── 3. 逐票扫描：特征 + 次日结局 ──
const DAY_MS = 86400000;
function tsOf(d) { return new Date(d + 'T12:00:00').getTime(); }
function rsiAt(closes, i, n) {
  if (i < n) return null;
  let up = 0, dn = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) up += d; else dn -= d;
  }
  if (up + dn === 0) return 50;
  return up / (up + dn) * 100;
}
function atrOf(rows, i, n) {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const pc = rows[k - 1].close;
    s += Math.max(rows[k].high - rows[k].low, Math.abs(rows[k].high - pc), Math.abs(rows[k].low - pc));
  }
  return s / n;
}

const records = [];
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
const skipped = { noFloat: 0, junk: 0, newStock: 0, short: 0 };
for (const f of files) {
  const code = f.replace('.json', '');
  const sh = floatSh.get(code);
  if (!sh || !sh.fs) { skipped.noFloat++; continue; }
  let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
  const nm = k.name || sh.name || '';
  if (A.isJunkName(nm)) { skipped.junk++; continue; }
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) { skipped.junk++; continue; }  // 北交所单列口径，先不进主表
  const rows = (k.rows || []).filter(r => r && r.close > 0);
  if (rows.length < 25) { skipped.short++; continue; }
  const lp = A.limitPctOf(code, nm);
  const closes = rows.map(r => r.close);
  const start = Math.max(20, rows.length - 60);
  let newSkipped = false;
  for (let i = start; i < rows.length - 1; i++) {
    const ts = tsOf(rows[i].date);
    if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) { skipped.newStock++; newSkipped = true; break; }   // 新股早期无参照
    const c = rows[i].close, cPrev = rows[i - 1].close;
    const pct = (c / cPrev - 1) * 100;
    // 20 日位置 / 60 日回撤
    let mn20 = Infinity, mx20 = -Infinity, mx60 = -Infinity;
    for (let q = Math.max(0, i - 19); q <= i; q++) { mn20 = Math.min(mn20, rows[q].low); mx20 = Math.max(mx20, rows[q].high); }
    for (let q = Math.max(0, i - 59); q <= i; q++) mx60 = Math.max(mx60, rows[q].high);
    const rangePos = mx20 > mn20 ? +((c - mn20) / (mx20 - mn20) * 100).toFixed(1) : 50;
    const dd60 = +((c / mx60 - 1) * 100).toFixed(1);
    // 近 5 日涨停数（收盘封板口径， tol 0.3）
    let zt5 = 0;
    for (let q = Math.max(1, i - 4); q <= i; q++) {
      const pp = (rows[q].close / rows[q - 1].close - 1) * 100;
      if (pp >= lp - 0.3) zt5++;
    }
    const ztToday = pct >= lp - 0.3;
    const yiZi = rows[i].open >= cPrev * (1 + lp / 100) - 0.02;   // 一字板（开盘即封）
    const r6 = rsiAt(closes, i, 6);
    const atr14 = atrOf(rows, i, 14);
    // P5 底背离：当日收盘 = 20 日最低（±0.3% 内），且 RSI6 高于上一个 20 日窗口最低点的 RSI6
    let div = false;
    if (r6 != null && i >= 40) {
      let mnA = Infinity, jA = -1;
      for (let q = i - 19; q <= i; q++) if (closes[q] < mnA) { mnA = closes[q]; jA = q; }
      let mnB = Infinity, jB = -1;
      for (let q = i - 39; q <= i - 20; q++) if (closes[q] < mnB) { mnB = closes[q]; jB = q; }
      if (jA === i && jB >= 0) {
        const rB = rsiAt(closes, jB, 6);
        if (rB != null && r6 > rB + 3) div = true;   // RSI 抬升 3 点以上才算背离，滤噪声
      }
    }
    // 次日结局
    const nx = rows[i + 1];
    const nextPct = (nx.close / c - 1) * 100;
    const nextHiPct = (nx.high / c - 1) * 100;
    records.push({
      code, name: nm, date: rows[i].date, lp,
      pct: +pct.toFixed(2), close: c,
      capYi: +(c * sh.fs / 1e8).toFixed(1),                        // 当日流通市值（亿，代理）
      turnPct: +(rows[i].volume * 100 / sh.fs * 100).toFixed(2),   // 当日换手率%（手→股）
      rangePos, dd60, zt5, ztToday, yiZi,
      r6: r6 == null ? null : +r6.toFixed(1), div,
      atrPct: atr14 != null ? +(atr14 / c * 100).toFixed(2) : null,
      nextPct: +nextPct.toFixed(2), nextHiPct: +nextHiPct.toFixed(2),
      nextZtTouch: nextHiPct >= lp - 0.3,
      nextZtClose: nextPct >= lp - 0.3
    });
  }
  void newSkipped;
}
console.log(`[扫描] 股票-日记录 ${records.length} 条；跳过：无浮动股本 ${skipped.noFloat} / ST·北交所 ${skipped.junk} / 新股窗口 ${skipped.newStock} / K线不足 ${skipped.short}`);

// ── 4. 汇总工具 ──
function tbl(title, rows, keyFn, buckets) {
  const g = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    (g[k] = g[k] || { n: 0, ztT: 0, ztC: 0, sumPct: 0, sumHi: 0 });
    const e = g[k];
    e.n++; if (r.nextZtTouch) e.ztT++; if (r.nextZtClose) e.ztC++;
    e.sumPct += r.nextPct; e.sumHi += r.nextHiPct;
  }
  console.log('\n── ' + title + ' ──');
  console.log('档位'.padEnd(14) + 'n'.padStart(8) + '次日触板%'.padStart(10) + '次日封板%'.padStart(10) + '次日均涨%'.padStart(10) + '次日最高均涨%'.padStart(12));
  for (const b of buckets) {
    const e = g[b.k];
    if (!e || !e.n) { console.log(b.k.padEnd(14) + '0'.padStart(8)); continue; }
    console.log(b.k.padEnd(14) + String(e.n).padStart(8)
      + (e.ztT / e.n * 100).toFixed(1).padStart(10)
      + (e.ztC / e.n * 100).toFixed(1).padStart(10)
      + (e.sumPct / e.n).toFixed(2).padStart(10)
      + (e.sumHi / e.n).toFixed(2).padStart(12));
  }
  return g;
}
const CAP_BK = [{ k: '<30亿' }, { k: '30-50亿' }, { k: '50-100亿' }, { k: '100-200亿' }, { k: '200-500亿' }, { k: '≥500亿' }];
const capOf = r => r.capYi < 30 ? '<30亿' : r.capYi < 50 ? '30-50亿' : r.capYi < 100 ? '50-100亿' : r.capYi < 200 ? '100-200亿' : r.capYi < 500 ? '200-500亿' : '≥500亿';
const TURN_BK = [{ k: '<3%' }, { k: '3-5%' }, { k: '5-8%' }, { k: '8-12%' }, { k: '12-18%' }, { k: '18-25%' }, { k: '≥25%' }];
const turnOf = r => r.turnPct < 3 ? '<3%' : r.turnPct < 5 ? '3-5%' : r.turnPct < 8 ? '5-8%' : r.turnPct < 12 ? '8-12%' : r.turnPct < 18 ? '12-18%' : r.turnPct < 25 ? '18-25%' : '≥25%';
const POS_BK = [{ k: '底部<30' }, { k: '中位30-70' }, { k: '顶部>70' }];
const posOf = r => r.rangePos < 30 ? '底部<30' : r.rangePos <= 70 ? '中位30-70' : '顶部>70';
const DD_BK = [{ k: '贴高点≥-10' }, { k: '-10~-25' }, { k: '-25~-40' }, { k: '深跌<-40' }];
const ddOf = r => r.dd60 >= -10 ? '贴高点≥-10' : r.dd60 >= -25 ? '-10~-25' : r.dd60 >= -40 ? '-25~-40' : '深跌<-40';

const ztTouchAll = records.filter(r => r.nextZtTouch).length;
console.log('\n[全宇宙基数] n=' + records.length + ' 次日触板 ' + (ztTouchAll / records.length * 100).toFixed(2) + '%'
  + ' / 均涨 ' + (records.reduce((s, r) => s + r.nextPct, 0) / records.length).toFixed(2) + '%');

// A 上下文：全宇宙分档
tbl('A·全宇宙 流通市值分档 → 次日', records, capOf, CAP_BK);
tbl('A·全宇宙 换手率分档 → 次日', records, turnOf, TURN_BK);

// B1/B2/B3：涨停日切片（打板入口，推送模型的真实候选群）
const ztRows = records.filter(r => r.ztToday && !r.yiZi);   // I1：剔除一字板
console.log('\n[涨停日切片] n=' + ztRows.length + '（已剔除一字板 ' + records.filter(r => r.ztToday && r.yiZi).length + ' 条）'
  + ' 基数：触板 ' + (ztRows.filter(r => r.nextZtTouch).length / ztRows.length * 100).toFixed(1) + '%');
const capG = tbl('B1·涨停日 流通市值分档（I6 市值U型 / M4 小盘衰减 / V13 微盘）', ztRows, capOf, CAP_BK);
const turnG = tbl('B2·涨停日 换手率分档（H9 换手率区间）', ztRows, turnOf, TURN_BK);
const posG = tbl('B3·涨停日 位置分档（I7 底部首板效应）', ztRows, posOf, POS_BK);
const ddG = tbl('B3b·涨停日 60日回撤分档（I7 底部首板效应）', ztRows, ddOf, DD_BK);
// B3 交叉：位置 × 板位（首板 vs 连板）
const cross = {};
for (const r of ztRows) {
  const k = posOf(r) + ' × ' + (r.zt5 >= 2 ? '连板' : '首板');
  (cross[k] = cross[k] || { n: 0, ztT: 0, sumPct: 0 });
  cross[k].n++; if (r.nextZtTouch) cross[k].ztT++; cross[k].sumPct += r.nextPct;
}
console.log('\n── B3c·涨停日 位置×板位 交叉（I7） ──');
for (const k of Object.keys(cross).sort()) {
  const e = cross[k];
  console.log(k.padEnd(18) + String(e.n).padStart(8) + (e.ztT / e.n * 100).toFixed(1).padStart(10) + (e.sumPct / e.n).toFixed(2).padStart(10));
}

// P5：RSI 超卖 + 底背离 切片
const ovs = records.filter(r => r.r6 != null && r.r6 < 20);
const divRows = ovs.filter(r => r.div);
function rate(rows) { return rows.length ? { n: rows.length, ztT: +(rows.filter(r => r.nextZtTouch).length / rows.length * 100).toFixed(2), avg: +(rows.reduce((s, r) => s + r.nextPct, 0) / rows.length).toFixed(2) } : { n: 0, ztT: 0, avg: 0 }; }
console.log('\n── P5·RSI6 超卖切片（全宇宙） ──');
console.log('RSI6<20 全部：', JSON.stringify(rate(ovs)));
console.log('其中底背离（收盘20日新低+RSI6高于前低3点以上）：', JSON.stringify(rate(divRows)));
console.log('超卖无背离：', JSON.stringify(rate(ovs.filter(r => !r.div))));

// Y7：止损模拟（涨停日收盘买入，持有 5 日，五种退出规则）
function simStop(rows, i, c, rule) {
  const atr = atrOf(rows, i, 14);
  for (let d = 1; d <= 5 && i + d < rows.length; d++) {
    const nd = rows[i + d];
    const loPct = (nd.low / c - 1) * 100, hiPct = (nd.high / c - 1) * 100, opPct = (nd.open / c - 1) * 100;
    if (rule.type === 'fixed') {
      if (loPct <= rule.sl) return { pnl: rule.sl, why: '止损', gap: opPct <= rule.sl };
      if (hiPct >= rule.tp) return { pnl: rule.tp, why: '止盈' };
    } else {
      let slPct;
      if (rule.type === 'blend') {
        // cap=最宽允许（如 -12%），floor=最窄（用户底线 -3%）：ATR 给出的线在两者之间移动，
        // 波动小→贴近用户底线，波动大→放宽到 cap 为止（只放宽、绝不收紧过用户底线）
        slPct = Math.max(rule.cap, Math.min(rule.floor, -(rule.k * (atr / c) * 100)));
      } else {
        slPct = -(rule.k * (atr / c) * 100);
      }
      if (loPct <= slPct) return { pnl: +slPct.toFixed(2), why: 'ATR止损', gap: opPct <= slPct };
      if (hiPct >= 8) return { pnl: 8, why: '止盈' };
    }
  }
  const last = rows[Math.min(i + 5, rows.length - 1)];
  return { pnl: +((last.close / c - 1) * 100).toFixed(2), why: '到期' };
}
const RULES = [
  { name: '现行·固定-3%止损/+8%止盈', type: 'fixed', sl: -3, tp: 8 },
  { name: '固定-8%止损/+15%止盈', type: 'fixed', sl: -8, tp: 15 },
  { name: 'ATR 2.0×止损/+8%止盈', type: 'atr', k: 2.0 },
  { name: 'ATR 2.5×止损/+8%止盈', type: 'atr', k: 2.5 },
  { name: 'ATR 3.0×止损/+8%止盈', type: 'atr', k: 3.0 },
  { name: '混合·ATR2×钳[-12%,-3%]', type: 'blend', k: 2.0, cap: -12, floor: -3 },
  { name: '混合·ATR2×钳[-10%,-3%]', type: 'blend', k: 2.0, cap: -10, floor: -3 },
  { name: '混合·ATR2.5×钳[-15%,-3%]', type: 'blend', k: 2.5, cap: -15, floor: -3 }
];
console.log('\n── Y7·止损规则对比（涨停日收盘买入 · 持有≤5交易日 · 不含费用） ──');
const y7out = [];
for (const rule of RULES) {
  let n = 0, sum = 0, win = 0, stop = 0, worst = 0, gapThrough = 0;
  for (const f of files) {
    const code = f.replace('.json', '');
    const sh = floatSh.get(code);
    if (!sh || !sh.fs) continue;
    let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
    const nm = k.name || sh.name || '';
    if (A.isJunkName(nm) || code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) continue;
    const rows = (k.rows || []).filter(r => r && r.close > 0);
    if (rows.length < 25) continue;
    const lp = A.limitPctOf(code, nm);
    const start = Math.max(20, rows.length - 60);
    for (let i = start; i < rows.length - 1; i++) {
      const ts = tsOf(rows[i].date);
      if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) break;
      const pct = (rows[i].close / rows[i - 1].close - 1) * 100;
      if (!(pct >= lp - 0.3)) continue;
      if (rows[i].open >= rows[i - 1].close * (1 + lp / 100) - 0.02) continue;   // 剔一字板
      const r = simStop(rows, i, rows[i].close, rule);
      n++; sum += r.pnl; if (r.pnl > 0) win++;
      if (r.why.indexOf('止损') >= 0) {
        stop++;
        if (r.gap) gapThrough++;
      }
      worst = Math.min(worst, r.pnl);
    }
  }
  if (!n) continue;
  const row = { name: rule.name, n, avg: +(sum / n).toFixed(2), winRate: +(win / n * 100).toFixed(1), stopRate: +(stop / n * 100).toFixed(1), worst: +worst.toFixed(1), gapRate: +(gapThrough / n * 100).toFixed(1) };
  y7out.push(row);
  console.log(rule.name.padEnd(28) + 'n=' + String(n).padStart(6)
    + ' 均盈亏 ' + row.avg.toFixed(2).padStart(7) + '%'
    + ' 胜率 ' + row.winRate.toFixed(1).padStart(6) + '%'
    + ' 止损触发 ' + row.stopRate.toFixed(1).padStart(6) + '%'
    + ' 跳空穿过 ' + row.gapRate.toFixed(1).padStart(6) + '%'
    + ' 最差单笔 ' + row.worst.toFixed(1).padStart(7) + '%');
}

// 落盘研究结果
fs.writeFileSync('_research_gq_out.json', JSON.stringify({
  at: new Date().toISOString(), universe: { n: records.length, ztTouchBase: +(ztTouchAll / records.length * 100).toFixed(2) },
  ztSlice: { n: ztRows.length, ztTouchBase: +(ztRows.filter(r => r.nextZtTouch).length / ztRows.length * 100).toFixed(1) },
  capOnZt: capG, turnOnZt: turnG, posOnZt: posG, ddOnZt: ddG, cross,
  rsi: { oversold: rate(ovs), divergence: rate(divRows), noDiv: rate(ovs.filter(r => !r.div)) },
  y7: y7out
}, null, 1));
console.log('\n✅ 研究结果已落盘 _research_gq_out.json');
