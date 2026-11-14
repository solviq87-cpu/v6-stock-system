// ═══ hf 轮实证研究（2026-10-14）：台账「采纳+先调研」里本地日线可算但未实证的选股因子批量测量 ═══
//  用户「可以先加上后期验证 / 同步一起完成提高胜率」：把 kline 可算的候选一次测完，有 edge 的接进模型、
//  无 edge 的留痕否决（不静默丢、不假实现）。后期由线上 empTable 持续样本外验证。
//  底座沿用 gs：.kline_cache 全A × 涨停日切片(剔一字板)，结局=次日最高触板；
//  稳健判据：① 两半窗方向一致 ② 三层市场环境(普跌/震荡/普涨)都不显著变差。
//  ⛔ 已实证否决/共线的不重测（避免重复劳动+双重计数）：
//    N5 均线多头/N6 均线粘合(gs否) / L9 量价背离·N9 四象限(gs否) / M1 低波·M3 反转(gs否) /
//    P2 MACD底背离·P5 RSI底背离(gr否) / Q12 缠论背驰≈背离族(不重测) / V7 动量(A股短期IC负,gr口径) /
//    N7 多周期共振≈N5 / N10 量价背离≈L9 / K4 新高新低≈K1 市场态 / I4 板位≈连板高度。
//  本轮只测「结构上未被既有因子承载」的新候选：
//    P1 顾比均线(GMMA 短/长均线组张力) / P3 MACD 多周期(柱体非背离) / P11 CCI 双周期 /
//    Q2 岛形反转(向上孤岛) / J16 主升浪四特征(均线多头发散+近新高) / U8 CTA趋势(ADX式趋势强度)。
const fs = require('fs');
const A = require('./analysis.js');
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const floatSh = new Map();
for (const r of snap.rows || []) {
  if (!r.code || !(r.price > 0) || !(r.floatCap > 0)) continue;
  floatSh.set(r.code, { fs: r.floatCap / r.price, capYi: r.floatCap / 1e8, listedTs: Number(r.listedDate) || 0, name: r.name || '' });
}
const DAY_MS = 86400000;
function tsOf(d) { return new Date(d + 'T12:00:00').getTime(); }
function stdev(a) { if (a.length < 2) return 0; const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); }
// EMA 序列（用于 MACD）
function ema(arr, n) { const k = 2 / (n + 1); const out = [arr[0]]; for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k)); return out; }

const records = [];
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
const skipped = { noFloat: 0, junk: 0, newStock: 0, short: 0 };
const dayUp = {}, dayTot = {};
for (const f of files) {
  const code = f.replace('.json', '');
  const sh = floatSh.get(code);
  if (!sh || !sh.fs) { skipped.noFloat++; continue; }
  let k; try { k = JSON.parse(fs.readFileSync('.kline_cache/' + f, 'utf8')); } catch { continue; }
  const nm = k.name || sh.name || '';
  if (A.isJunkName(nm)) { skipped.junk++; continue; }
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) { skipped.junk++; continue; }
  const rows = (k.rows || []).filter(r => r && r.close > 0);
  if (rows.length < 62) { skipped.short++; continue; }   // 需 ma60
  const lp = A.limitPctOf(code, nm);
  const closes = rows.map(r => r.close), highs = rows.map(r => r.high), lows = rows.map(r => r.low);
  const maAt = (arr, i, n) => { let s = 0; for (let q = Math.max(0, i - n + 1); q <= i; q++) s += arr[q]; return s / Math.min(n, i + 1); };
  const start = Math.max(61, rows.length - 60);
  for (let i = start; i < rows.length - 1; i++) {
    const ts = tsOf(rows[i].date);
    if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) { skipped.newStock++; break; }
    const c = rows[i].close, cPrev = rows[i - 1].close;
    const pct = (c / cPrev - 1) * 100;
    const ztToday = pct >= lp - 0.3;
    const yiZi = rows[i].open >= cPrev * (1 + lp / 100) - 0.02;
    const dt = rows[i].date;
    dayTot[dt] = (dayTot[dt] || 0) + 1;
    if (pct > 0) dayUp[dt] = (dayUp[dt] || 0) + 1;
    const ma5 = maAt(closes, i, 5), ma10 = maAt(closes, i, 10), ma20 = maAt(closes, i, 20), ma60 = maAt(closes, i, 60);
    // P1 顾比均线：短组(3/5/8)均值 - 长组(13/21/34)均值，占价比
    const shortGrp = (maAt(closes, i, 3) + ma5 + maAt(closes, i, 8)) / 3;
    const longGrp = (maAt(closes, i, 13) + maAt(closes, i, 21) + maAt(closes, i, 34)) / 3;
    const gmmaSpread = (shortGrp - longGrp) / c * 100;
    // P3 MACD(12,26,9) 柱体 = 2*(DIF-DEA)
    const e12 = ema(closes.slice(Math.max(0, i - 59), i + 1), 12);
    const e26 = ema(closes.slice(Math.max(0, i - 59), i + 1), 26);
    const dif = e12[e12.length - 1] - e26[e26.length - 1];
    const dea = ema(e12.map((v, j) => v - e26[j]), 9).slice(-1)[0];
    const macdHist = 2 * (dif - dea) / c * 100;
    // P11 CCI(14) = (TP-MA(TP))/(0.015*MD)
    const tp = (highs[i] + lows[i] + c) / 3;
    const tps = []; for (let q = i - 13; q <= i; q++) tps.push((highs[q] + lows[q] + closes[q]) / 3);
    const tpMa = tps.reduce((s, v) => s + v, 0) / 14;
    const tpMd = tps.reduce((s, v) => s + Math.abs(v - tpMa), 0) / 14;
    const cci = tpMd > 0 ? (tp - tpMa) / (0.015 * tpMd) : 0;
    // Q2 向上岛形反转：3~5日前有向下缺口(孤岛底)，随后收复 → 现在涨停
    let island = false;
    for (let b = 2; b <= 5 && !island; b++) {
      const j = i - b; if (j < 1) break;
      const gapDown = rows[j].high < rows[j - 1].low - 0.001;         // 当日全在昨下影之下=向下孤岛
      const recovered = c > rows[j - 1].low;                          // 已收复孤岛起点
      if (gapDown && recovered) island = true;
    }
    // J16 主升浪：均线多头(5>10>20>60) + 收盘接近20日新高
    const hi20 = Math.max(...highs.slice(Math.max(0, i - 19), i + 1));
    const mainWave = ma5 > ma10 && ma10 > ma20 && ma20 > ma60 && c / hi20 > 0.95;
    // U8 CTA趋势强度：ADX(14) 近似（+DI/-DI）
    let plusDM = 0, minusDM = 0, tr = 0;
    for (let q = i - 13; q <= i; q++) {
      const up = highs[q] - highs[q - 1], dn = lows[q - 1] - lows[q];
      plusDM += (up > dn && up > 0) ? up : 0; minusDM += (dn > up && dn > 0) ? dn : 0;
      tr += Math.max(highs[q] - lows[q], Math.abs(highs[q] - closes[q - 1]), Math.abs(lows[q] - closes[q - 1]));
    }
    const pdi = tr > 0 ? plusDM / tr * 100 : 0, mdi = tr > 0 ? minusDM / tr * 100 : 0;
    const dx = (pdi + mdi) > 0 ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    const adxLike = dx; // 单点 DX 近似（滚动平滑代价高，用当日 DX 分档已足够看方向）
    const nx = rows[i + 1];
    const nextHiPct = (nx.high / c - 1) * 100;
    const upRatio = (dayUp[dt] || 0) / (dayTot[dt] || 1) * 100;
    const regime = upRatio < 40 ? 'down' : upRatio < 60 ? 'side' : 'up';
    records.push({ code, date: dt, lp, pct: +pct.toFixed(2), capYi: +(c * sh.fs / 1e8).toFixed(1),
      gmmaSpread: +gmmaSpread.toFixed(2), macdHist: +macdHist.toFixed(3), cci: +cci.toFixed(0),
      island, mainWave, adxLike: +adxLike.toFixed(0), pdi: +pdi.toFixed(0),
      ztToday, yiZi, nextPct: +((nx.close / c - 1) * 100).toFixed(2), nextHiPct: +nextHiPct.toFixed(2),
      nextZtTouch: nextHiPct >= lp - 0.3, regime });
  }
}
console.log(`[扫描] 股票-日记录 ${records.length}；跳过：无浮动股本 ${skipped.noFloat} / ST·北交所 ${skipped.junk} / 新股 ${skipped.newStock} / K线不足62 ${skipped.short}`);
const base = (rows) => { const n = rows.length; return { n, ztT: n ? +(rows.filter(r => r.nextZtTouch).length / n * 100).toFixed(1) : 0 }; };
function regimeBase(rows) { const g = {}; for (const rg of ['down', 'side', 'up']) g[rg] = base(rows.filter(r => r.regime === rg)).ztT; return g; }
function measure(id, name, rows, keyFn, buckets) {
  const b0 = base(rows); const rb = regimeBase(rows);
  const ds = rows.map(r => r.date).sort(); const mid = ds[Math.floor(ds.length / 2)];
  const h1 = rows.filter(r => r.date <= mid), h2 = rows.filter(r => r.date > mid);
  const b1 = base(h1).ztT, b2 = base(h2).ztT;
  const out = { id, name, n: rows.length, baseZtT: b0.ztT, buckets: [] };
  for (const b of buckets) {
    const rs = rows.filter(r => keyFn(r) === b.k); const n = rs.length;
    const ztT = n ? +(rs.filter(r => r.nextZtTouch).length / n * 100).toFixed(1) : 0;
    const delta = +(ztT - b0.ztT).toFixed(1);
    const g1 = h1.filter(r => keyFn(r) === b.k), g2 = h2.filter(r => keyFn(r) === b.k);
    let half = 'n<30';
    if (g1.length >= 30 && g2.length >= 30) {
      const z1 = g1.filter(r => r.nextZtTouch).length / g1.length * 100, z2 = g2.filter(r => r.nextZtTouch).length / g2.length * 100;
      half = (z1 > b1) === (z2 > b2) ? '同向' : '背离';
    }
    const reg = {};
    for (const rg of ['down', 'side', 'up']) { const rrs = rs.filter(r => r.regime === rg); reg[rg] = { n: rrs.length, ztT: rrs.length ? +(rrs.filter(r => r.nextZtTouch).length / rrs.length * 100).toFixed(1) : 0, delta: +( (rrs.length ? rrs.filter(r => r.nextZtTouch).length / rrs.length * 100 : 0) - rb[rg]).toFixed(1) }; }
    out.buckets.push({ k: b.k, n, ztT, delta, half, reg });
  }
  return out;
}
const zt = records.filter(r => r.ztToday && !r.yiZi);
console.log(`涨停日切片 n=${zt.length}（剔一字板）；基线触板率 ${base(zt).ztT}%\n`);
const R = [];
R.push(measure('P1', '顾比均线GMMA(短/长组张力)', zt, r => r.gmmaSpread > 2 ? '张>2%' : r.gmmaSpread > 0.5 ? '0.5~2%' : '≤0.5%', [{ k: '张>2%' }, { k: '0.5~2%' }, { k: '≤0.5%' }]));
R.push(measure('P3', 'MACD柱体(涨停日)', zt, r => r.macdHist > 0.5 ? '强正>0.5' : r.macdHist > 0 ? '0~0.5' : '≤0', [{ k: '强正>0.5' }, { k: '0~0.5' }, { k: '≤0' }]));
R.push(measure('P11', 'CCI(14)', zt, r => r.cci > 150 ? '>150' : r.cci > 50 ? '50~150' : '≤50', [{ k: '>150' }, { k: '50~150' }, { k: '≤50' }]));
R.push(measure('Q2', '岛形反转(向上孤岛)', zt, r => r.island ? '有孤岛' : '无', [{ k: '有孤岛' }, { k: '无' }]));
R.push(measure('J16', '主升浪四特征', zt, r => r.mainWave ? '主升浪' : '非', [{ k: '主升浪' }, { k: '非' }]));
R.push(measure('U8', 'CTA趋势强度DX', zt, r => r.adxLike > 40 ? 'DX>40' : r.adxLike > 20 ? '20~40' : '≤20', [{ k: 'DX>40' }, { k: '20~40' }, { k: '≤20' }]));
for (const o of R) {
  console.log(`【${o.id} ${o.name}】 基线 ${o.baseZtT}% (n=${o.n})`);
  for (const b of o.buckets) {
    const regs = ['down', 'side', 'up'].map(rg => `${rg}:${b.reg[rg].ztT}%(${b.reg[rg].delta>=0?'+':''}${b.reg[rg].delta},n${b.reg[rg].n})`).join(' ');
    console.log(`   ${b.k.padEnd(8)} n=${String(b.n).padStart(4)} 触板 ${String(b.ztT).padStart(5)}% Δ${(b.delta>=0?'+':'')+b.delta} 半窗:${b.half} | ${regs}`);
  }
}
fs.writeFileSync('_research_hf_out.json', JSON.stringify(R, null, 1));
console.log('\n→ 结果写入 _research_hf_out.json');
