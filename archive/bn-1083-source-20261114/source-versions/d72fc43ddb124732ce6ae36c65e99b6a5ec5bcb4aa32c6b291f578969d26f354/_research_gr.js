// ═══ gr 轮实证研究（2026-10-13 早盘后）：台账 184 项「采纳」候选条件的批量测量 ═══
//  背景：用户问「那个表里那么多采纳的你怎么不做」。184 项采纳 = 用户已拍板「采纳进候选池」的
//  验证条件/因子，其中约一半依赖外部数据（北向/两融/期权/财报/宏观/舆情），本地 .kline_cache
//  测不了；本脚本把 **kline 可算的 17 项**按 gq 轮同款口径一次测完：
//   · 切片：涨停日收盘（剔一字板）≈ 打板入口，与 nextDayLimitProb 候选群同源
//   · 结局：次日最高触板率（nextZtTouch）+ 次日均涨
//   · 纪律：每档 n≥30 才下结论；|Δ|≥3pp 标候选；两半窗方向一致性检查
//  条目 → 台账 ID：H1/I5/J8/J9/J13/J14/K1/K12/M5/M6/M7/M8/P2/P4/P6/P10/Q1/Q14/R12
//  K10 获利比例与 gq rangePos 同源（20 日位置），不重复测，台账注明。
const fs = require('fs');
const A = require('./analysis.js');

// ── 1. 浮动股本代理（同 gq）──
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const floatSh = new Map();
for (const r of snap.rows || []) {
  if (!r.code || !(r.price > 0) || !(r.floatCap > 0)) continue;
  floatSh.set(r.code, {
    fs: r.floatCap / r.price, capYi: r.floatCap / 1e8,
    turnSnap: r.turnover, price: r.price,
    listedTs: Number(r.listedDate) || 0, name: r.name || ''
  });
}

const DAY_MS = 86400000;
function tsOf(d) { return new Date(d + 'T12:00:00').getTime(); }

// ── 2. 指标计算器（MACD/KDJ/BOLL，标准口径）──
function emaSeries(arr, n) {
  const out = new Array(arr.length).fill(null);
  if (!arr.length) return out;
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 0; i < arr.length; i++) { e = i === 0 ? arr[0] : arr[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function macdSeries(closes) {
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = emaSeries(dif, 9);
  return { dif, dea };
}
function kdjSeries(rows, n = 9) {
  const K = [], D = [];
  let k = 50, d = 50;
  for (let i = 0; i < rows.length; i++) {
    let ll = Infinity, hh = -Infinity;
    for (let q = Math.max(0, i - n + 1); q <= i; q++) { ll = Math.min(ll, rows[q].low); hh = Math.max(hh, rows[q].high); }
    const rsv = hh > ll ? (rows[i].close - ll) / (hh - ll) * 100 : 50;
    k = (2 * k + rsv) / 3; d = (2 * d + k) / 3;   // SMA(...,3,1) 近似
    K.push(k); D.push(d);
  }
  return { K, D };
}
function bollSeries(closes, n = 20) {
  const mid = [], up = [], dn = [], bw = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { mid.push(null); up.push(null); dn.push(null); bw.push(null); continue; }
    let s = 0; for (let q = i - n + 1; q <= i; q++) s += closes[q];
    const m = s / n;
    let md = 0; for (let q = i - n + 1; q <= i; q++) md += Math.abs(closes[q] - m);
    md /= n;
    mid.push(m); up.push(m + 2 * md); dn.push(m - 2 * md); bw.push(4 * md / m * 100);
  }
  return { mid, up, dn, bw };
}

// ── 3. 逐票扫描 ──
const records = [];
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
const skipped = { noFloat: 0, junk: 0, newStock: 0, short: 0 };
const dayUp = {}, dayTot = {};   // K1 涨跌家数比：全宇宙逐日
for (const f of files) {
  const code = f.replace('.json', '');
  const sh = floatSh.get(code);
  if (!sh || !sh.fs) { skipped.noFloat++; continue; }
  let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
  const nm = k.name || sh.name || '';
  if (A.isJunkName(nm)) { skipped.junk++; continue; }
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) { skipped.junk++; continue; }
  const rows = (k.rows || []).filter(r => r && r.close > 0);
  if (rows.length < 25) { skipped.short++; continue; }
  const lp = A.limitPctOf(code, nm);
  const closes = rows.map(r => r.close);
  const vols = rows.map(r => Number(r.volume) || 0);
  const { dif, dea } = macdSeries(closes);
  const { K: kK, D: kD } = kdjSeries(rows);
  const { up: bUp, bw: bBw } = bollSeries(closes);
  // 全宇宙逐日涨跌家数（K1 用，含非涨停日）
  for (let i = 1; i < rows.length; i++) {
    const pct = (closes[i] / closes[i - 1] - 1) * 100;
    const dt = rows[i].date;
    dayTot[dt] = (dayTot[dt] || 0) + 1;
    if (pct > 0) dayUp[dt] = (dayUp[dt] || 0) + 1;
  }
  const start = Math.max(20, rows.length - 60);
  for (let i = start; i < rows.length - 1; i++) {
    const ts = tsOf(rows[i].date);
    if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) { skipped.newStock++; break; }
    const c = rows[i].close, cPrev = rows[i - 1].close, cPrev2 = i >= 2 ? rows[i - 2].close : cPrev;
    const pct = (c / cPrev - 1) * 100;
    const ztToday = pct >= lp - 0.3;
    const yiZi = rows[i].open >= cPrev * (1 + lp / 100) - 0.02;
    // 20 日量能中位
    const v20 = [];
    for (let q = Math.max(0, i - 19); q <= i; q++) v20.push(vols[q]);
    v20.sort((a, b) => a - b);
    const vMed = v20[Math.floor(v20.length / 2)] || 1;
    const vRatio = vols[i] / vMed;
    // 20 日均量（换手激增 R12）
    let vSum = 0; for (let q = Math.max(0, i - 19); q <= i; q++) vSum += vols[q];
    const vAvg20 = vSum / Math.min(20, i + 1) || 1;
    // MA6 / BIAS6（P10）
    let s6 = 0; for (let q = Math.max(0, i - 5); q <= i; q++) s6 += closes[q];
    const ma6 = s6 / Math.min(6, i + 1);
    const bias6 = (c / ma6 - 1) * 100;
    // 20 日新高（M7/M8）
    let mxPrev20 = -Infinity;
    for (let q = Math.max(0, i - 20); q <= i - 1; q++) mxPrev20 = Math.max(mxPrev20, rows[q].high);
    const brk20 = mxPrev20 > 0 && c >= mxPrev20;
    // MACD 金叉近 3 日（K12）
    let macdGC = false;
    if (dif[i] != null && dea[i] != null && i >= 3) {
      for (let q = i - 2; q <= i; q++) {
        if (dif[q] > dea[q] && (q === 0 || dif[q - 1] <= dea[q - 1])) { macdGC = true; break; }
      }
    }
    // 布林带宽 20 日低分位（K12/P6）
    let bwPct = null;
    if (bBw[i] != null && i >= 25) {
      const w = []; for (let q = i - 19; q <= i; q++) if (bBw[q] != null) w.push(bBw[q]);
      w.sort((a, b) => a - b);
      const below = w.filter(x => x <= bBw[i]).length;
      bwPct = below / w.length * 100;
    }
    // MACD 底背离（P2）：收盘 20 日新低 且 DIF 高于前一个 20 日窗口最低点的 DIF
    let macdDiv = false;
    if (i >= 40) {
      let mnA = Infinity, jA = -1;
      for (let q = i - 19; q <= i; q++) if (closes[q] < mnA) { mnA = closes[q]; jA = q; }
      let mnB = Infinity, jB = -1;
      for (let q = i - 39; q <= i - 20; q++) if (closes[q] < mnB) { mnB = closes[q]; jB = q; }
      if (jA === i && jB >= 0 && dif[i] != null && dif[jB] != null && dif[i] > dif[jB] + 0.02) macdDiv = true;
    }
    // 近 5 日涨停数（H1）
    let zt5 = 0;
    for (let q = Math.max(1, i - 4); q <= i; q++) {
      const pp = (closes[q] / closes[q - 1] - 1) * 100;
      if (pp >= lp - 0.3) zt5++;
    }
    // 前 5 日洗盘（J9）：前 5 日内出现过 ≥5% 回撤（从 5 日高）
    let wash5 = false;
    {
      let hh = -Infinity;
      for (let q = Math.max(0, i - 5); q <= i; q++) {
        hh = Math.max(hh, rows[q].high);
        if (q < i && (rows[q].low / hh - 1) * 100 <= -5) wash5 = true;
      }
    }
    // 试攻阳线（J13）：前一日最高触及近涨停但没收涨停（试攻），今日封板
    let tryAttack = false;
    if (i >= 1) {
      const pHiPct = (rows[i - 1].high / cPrev2 - 1) * 100;
      const pClPct = (rows[i - 1].close / cPrev2 - 1) * 100;
      if (pHiPct >= lp - 1.5 && pClPct < lp - 1.5) tryAttack = true;
    }
    // 突破缺口（J14 / Q1 缺口分类）
    const gapPct = (rows[i].open / cPrev - 1) * 100;
    const gapUp = gapPct > 0.3;
    // 启明星孕线（M5）：前二日长阴 + 前一日小实体
    let morningStar = false;
    if (i >= 2) {
      const p2 = (cPrev2 / (i >= 3 ? rows[i - 3].close : cPrev2) - 1) * 100;
      const p1 = (cPrev / cPrev2 - 1) * 100;
      const body1 = Math.abs(rows[i - 1].close - rows[i - 1].open) / cPrev2 * 100;
      if (i >= 3 && p2 <= -3 && Math.abs(p1) < 1.5 && body1 < 2) morningStar = true;
    }
    // 阳包阴（M6）：前一日阴线，今日收盘过前一日最高
    const engulf = cPrev < cPrev2 && c >= rows[i - 1].high;
    // 光头/上影（Q14）
    const upperShadow = (rows[i].high - c) / c * 100;
    const bald = upperShadow < 0.05;
    // 平台型首板（J8）：涨停前 5 日振幅 < 15%（横盘平台）
    let flat5 = false;
    {
      let lo = Infinity, hi = -Infinity;
      for (let q = Math.max(0, i - 5); q <= i - 1; q++) { lo = Math.min(lo, rows[q].low); hi = Math.max(hi, rows[q].high); }
      if (lo > 0 && (hi / lo - 1) * 100 < 15) flat5 = true;
    }
    const nx = rows[i + 1];
    const nextPct = (nx.close / c - 1) * 100;
    const nextHiPct = (nx.high / c - 1) * 100;
    records.push({
      code, date: rows[i].date, lp,
      pct: +pct.toFixed(2), close: c,
      capYi: +(c * sh.fs / 1e8).toFixed(1),
      turnPct: +(vols[i] * 100 / sh.fs * 100).toFixed(2),
      vRatio: +vRatio.toFixed(2), vAvgRatio: +(vols[i] / vAvg20).toFixed(2),
      bias6: +bias6.toFixed(2),
      brk20, macdGC, bwPct: bwPct == null ? null : +bwPct.toFixed(0), macdDiv,
      kdvK: kK[i] == null ? null : +kK[i].toFixed(1), kdvD: kD[i] == null ? null : +kD[i].toFixed(1),
      zt5, wash5, tryAttack, gapPct: +gapPct.toFixed(2), gapUp,
      morningStar, engulf, bald, flat5, upperShadow: +upperShadow.toFixed(2),
      ztToday, yiZi,
      nextPct: +nextPct.toFixed(2), nextHiPct: +nextHiPct.toFixed(2),
      nextZtTouch: nextHiPct >= lp - 0.3,
      nextZtClose: nextPct >= lp - 0.3
    });
  }
}
console.log(`[扫描] 股票-日记录 ${records.length} 条；跳过：无浮动股本 ${skipped.noFloat} / ST·北交所 ${skipped.junk} / 新股窗口 ${skipped.newStock} / K线不足 ${skipped.short}`);

// ── 4. 汇总工具 ──
const base = (rows, label) => {
  const n = rows.length;
  if (!n) return { n: 0 };
  return { n, ztT: +(rows.filter(r => r.nextZtTouch).length / n * 100).toFixed(1), avg: +(rows.reduce((s, r) => s + r.nextPct, 0) / n).toFixed(2) };
};
function tbl(title, rows, keyFn, buckets) {
  const g = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    (g[k] = g[k] || { n: 0, ztT: 0, sumPct: 0 });
    const e = g[k];
    e.n++; if (r.nextZtTouch) e.ztT++; e.sumPct += r.nextPct;
  }
  console.log('\n── ' + title + ' ──');
  console.log('档位'.padEnd(16) + 'n'.padStart(8) + '次日触板%'.padStart(10) + 'Δvs基数'.padStart(9) + '次日均涨%'.padStart(10));
  const b0 = base(rows);
  for (const b of buckets) {
    const e = g[b.k];
    if (!e || !e.n) { console.log(b.k.padEnd(16) + '0'.padStart(8) + (e && e.n < 30 ? '  (n<30 不判)' : '')); continue; }
    const ztT = e.ztT / e.n * 100;
    console.log(b.k.padEnd(16) + String(e.n).padStart(8) + ztT.toFixed(1).padStart(10)
      + (ztT - b0.ztT).toFixed(1).padStart(9) + (e.sumPct / e.n).toFixed(2).padStart(10)
      + (e.n < 30 ? '  (n<30 不判)' : ''));
  }
  return g;
}
// 两半窗方向一致性（防单窗口过拟合）
function halfConsistency(rows, keyFn, buckets) {
  const dates = rows.map(r => r.date).sort();
  const mid = dates[Math.floor(dates.length / 2)];
  const h1 = rows.filter(r => r.date <= mid), h2 = rows.filter(r => r.date > mid);
  const g1 = {}, g2 = {};
  for (const r of h1) { const k = keyFn(r); if (k == null) continue; (g1[k] = g1[k] || { n: 0, ztT: 0 }); g1[k].n++; if (r.nextZtTouch) g1[k].ztT++; }
  for (const r of h2) { const k = keyFn(r); if (k == null) continue; (g2[k] = g2[k] || { n: 0, ztT: 0 }); g2[k].n++; if (r.nextZtTouch) g2[k].ztT++; }
  const out = {};
  for (const b of buckets) {
    const a = g1[b.k], c = g2[b.k];
    if (!a || !c || a.n < 30 || c.n < 30) { out[b.k] = null; continue; }
    out[b.k] = { h1: +(a.ztT / a.n * 100).toFixed(1), h2: +(c.ztT / c.n * 100).toFixed(1), same: (a.ztT / a.n > base(h1).ztT) === (c.ztT / c.n > base(h2).ztT) };
  }
  return out;
}

const ztRows = records.filter(r => r.ztToday && !r.yiZi);
console.log('\n[涨停日切片] n=' + ztRows.length + '（剔一字板 ' + records.filter(r => r.ztToday && r.yiZi).length + ' 条）'
  + ' 基数：', JSON.stringify(base(ztRows)));
const fullBase = base(records);
console.log('[全宇宙基数] n=' + records.length + ' ', JSON.stringify(fullBase));

// K1 涨跌家数比（市场环境）——合并进记录
for (const r of records) {
  const dt = r.date;
  const ratio = dayTot[dt] ? (dayUp[dt] || 0) / dayTot[dt] * 100 : null;
  r.mktUpRatio = ratio == null ? null : +ratio.toFixed(0);
}
const MKT_BK = [{ k: '极冷<20%' }, { k: '偏冷20-40' }, { k: '中性40-60' }, { k: '偏热60-80' }, { k: '极热≥80%' }];
const mktOf = r => r.mktUpRatio == null ? null : r.mktUpRatio < 20 ? '极冷<20%' : r.mktUpRatio < 40 ? '偏冷20-40' : r.mktUpRatio < 60 ? '中性40-60' : r.mktUpRatio < 80 ? '偏热60-80' : '极热≥80%';

const out = { at: new Date().toISOString(), ztSlice: base(ztRows), universe: fullBase };

// ── 各条件测量 ──
function measure(id, name, rows, keyFn, buckets) {
  console.log('\n════ ' + id + ' ' + name + ' ════');
  const g = tbl(id + '·' + name, rows, keyFn, buckets);
  const hc = halfConsistency(rows, keyFn, buckets);
  const hcStr = {};
  for (const b of buckets) hcStr[b.k] = g[b.k] && g[b.k].n >= 30 ? (hc[b.k] ? (hc[b.k].same ? '两半窗同向' : '半窗背离') : '样本不足') : 'n<30';
  console.log('半窗一致性：', JSON.stringify(hcStr));
  out[id] = { name, base: base(rows), buckets: g, half: hc };
  return g;
}

measure('H1', '近5日涨停基因（连板动量）', ztRows, r => r.zt5 === 0 ? '0板' : r.zt5 === 1 ? '1板' : r.zt5 === 2 ? '2板' : '≥3板',
  [{ k: '0板' }, { k: '1板' }, { k: '2板' }, { k: '≥3板' }]);

measure('I5', '缩量极端值（量比中位）', ztRows, r => r.vRatio < 0.6 ? '缩量<0.6' : r.vRatio < 1.5 ? '常轨0.6-1.5' : r.vRatio < 2.5 ? '放量1.5-2.5' : '极端>2.5',
  [{ k: '缩量<0.6' }, { k: '常轨0.6-1.5' }, { k: '放量1.5-2.5' }, { k: '极端>2.5' }]);

measure('J8', '平台型首板（前5日振幅<15%）', ztRows, r => r.flat5 ? '平台型' : '非平台',
  [{ k: '平台型' }, { k: '非平台' }]);

measure('J9', '5日洗盘买点（前5日≥5%回撤）', ztRows, r => r.wash5 ? '有洗盘' : '无洗盘',
  [{ k: '有洗盘' }, { k: '无洗盘' }]);

measure('J13', '试攻阳线（前日触近涨停未封）', ztRows, r => r.tryAttack ? '有试攻' : '无试攻',
  [{ k: '有试攻' }, { k: '无试攻' }]);

measure('J14', '突破缺口（跳空>0.3%）', ztRows, r => r.gapUp ? '向上缺口' : '无缺口/低开',
  [{ k: '向上缺口' }, { k: '无缺口/低开' }]);

measure('K1', '涨跌家数比（市场环境）', ztRows, mktOf, MKT_BK);

measure('K12', 'MACD金叉×布林收口共振', ztRows, r => (r.macdGC && r.bwPct != null && r.bwPct <= 20) ? '金叉+收口' : r.macdGC ? '仅金叉' : '其它',
  [{ k: '金叉+收口' }, { k: '仅金叉' }, { k: '其它' }]);

measure('M5', '启明星孕线（长阴+小实体+封板）', ztRows, r => r.morningStar ? '启明星' : '非启明星',
  [{ k: '启明星' }, { k: '非启明星' }]);

measure('M6', '阳包阴吞没', ztRows, r => r.engulf ? '阳包阴' : '非包阴',
  [{ k: '阳包阴' }, { k: '非包阴' }]);

measure('M7', '突破20日新高', ztRows, r => r.brk20 ? '创新高' : '未创新高',
  [{ k: '创新高' }, { k: '未创新高' }]);

measure('M8', '突破+量能确认（>1.5倍均量）', ztRows, r => r.brk20 ? (r.vAvgRatio > 1.5 ? '突破+放量' : '突破+平量') : '未突破',
  [{ k: '突破+放量' }, { k: '突破+平量' }, { k: '未突破' }]);

measure('P2', 'MACD底背离（全宇宙近低点）', records, r => r.macdDiv ? 'MACD底背离' : '其它',
  [{ k: 'MACD底背离' }, { k: '其它' }]);

measure('P4', 'KDJ低位过滤（K<20）', ztRows, r => r.kdvK == null ? null : r.kdvK < 20 ? 'K<20' : r.kdvK < 50 ? 'K20-50' : 'K≥50',
  [{ k: 'K<20' }, { k: 'K20-50' }, { k: 'K≥50' }]);

measure('P6', '布林收口突破（带宽低分位+收上轨）', ztRows, r => (r.bwPct != null && r.bwPct <= 20 && r.brk20) ? '收口+突破' : '其它',
  [{ k: '收口+突破' }, { k: '其它' }]);

measure('P10', '乖离率BIAS6', ztRows, r => r.bias6 < -3 ? '<-3%' : r.bias6 < 0 ? '-3~0%' : r.bias6 < 3 ? '0~3%' : r.bias6 < 6 ? '3~6%' : '≥6%',
  [{ k: '<-3%' }, { k: '-3~0%' }, { k: '0~3%' }, { k: '3~6%' }, { k: '≥6%' }]);

measure('Q1', '缺口分类', ztRows, r => r.gapPct > 0.3 ? '向上缺口' : r.gapPct < -0.3 ? '向下缺口' : '平开',
  [{ k: '向上缺口' }, { k: '平开' }, { k: '向下缺口' }]);

measure('Q14', 'K线组合（光头vs上影）', ztRows, r => r.bald ? '光头' : r.upperShadow == null ? null : '有上影',
  [{ k: '光头' }, { k: '有上影' }]);

measure('R12', '筹码换手激增（>2倍20日均量）', ztRows, r => r.vAvgRatio > 2 ? '激增>2x' : r.vAvgRatio > 1.2 ? '放大1.2-2x' : '常轨≤1.2x',
  [{ k: '激增>2x' }, { k: '放大1.2-2x' }, { k: '常轨≤1.2x' }]);

fs.writeFileSync('_research_gr_out.json', JSON.stringify(out, null, 1));
fs.writeFileSync('_research_gr_records.json', JSON.stringify(records));
console.log('\n✅ 研究结果已落盘 _research_gr_out.json（记录缓存 _research_gr_records.json，供 gr2 敏感性/共线性复测）');
