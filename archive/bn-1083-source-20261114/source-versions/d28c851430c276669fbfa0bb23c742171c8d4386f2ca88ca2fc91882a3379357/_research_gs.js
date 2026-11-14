// ═══ gs 轮实证研究 v2（2026-10-13）：台账 167 项「采纳」待处理项批量测量 ═══
//  目标：把 gr 轮之后仍 pending 的 167 项「采纳」全部往前推——可实证的实证并接线，缺数据源的标注清楚。
//  底座：.kline_cache 全 A 近 60 交易日 × 涨停日切片 n，剔一字板；结局=次日最高触板；
//  稳健性判据（用户 2026-10-12 铁律）：① 两半窗方向一致性（时间分段交叉）② 市场环境分层（普跌<40% / 震荡40-60% / 普涨>60%）三层都不显著变差才算稳健。
//  本脚本只算「日线 OHLCV / 日期 / 上市时长」可得的因子；北向/两融/期权/期指/财报/宏观/舆情/龙虎榜/筹码分布 等
//  本地无数据源，统一在台账标注「需 <源>」，不假实现。
//  新增因子（台账 ID）：H4 弱转强 / I4 板位分层 / K4 新高新低差 / L9 量价背离 / M1 低波 / M3 反转 /
//    N5 均线多头 / N6 均线粘合 / N8 地量 / N9 量价四象限 / P8 换手异常 / P9 量比换手 / Q15 假突破 /
//    J10 近端次新 / J11 日历效应 / J12 周内效应 / H13 涨停家数风控线(近似) / L2 封板率(近似)
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

const records = [];
const files = fs.readdirSync('.kline_cache').filter(f => f.endsWith('.json'));
const skipped = { noFloat: 0, junk: 0, newStock: 0, short: 0 };
const dayUp = {}, dayTot = {}, dayZt = {};
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
  const start = Math.max(20, rows.length - 60);
  for (let i = start; i < rows.length - 1; i++) {
    const ts = tsOf(rows[i].date);
    if (sh.listedTs && ts - sh.listedTs < 45 * DAY_MS) { skipped.newStock++; break; }
    const c = rows[i].close, cPrev = rows[i - 1].close, cPrev2 = i >= 2 ? rows[i - 2].close : cPrev;
    const pct = (c / cPrev - 1) * 100;
    const ztToday = pct >= lp - 0.3;
    const yiZi = rows[i].open >= cPrev * (1 + lp / 100) - 0.02;
    const dt = rows[i].date;
    dayTot[dt] = (dayTot[dt] || 0) + 1;
    if (pct > 0) dayUp[dt] = (dayUp[dt] || 0) + 1;
    if (ztToday) dayZt[dt] = (dayZt[dt] || 0) + 1;
    const v20 = []; for (let q = Math.max(0, i - 19); q <= i; q++) v20.push(vols[q]);
    v20.sort((a, b) => a - b);
    const vMed = v20[Math.floor(v20.length / 2)] || 1;
    const vRatio = vols[i] / vMed;
    const vMean = v20.reduce((s, v) => s + v, 0) / v20.length;
    const volCv = vMean > 0 ? stdev(v20) / vMean : 0;
    const ma = n => { let s = 0; for (let q = Math.max(0, i - n + 1); q <= i; q++) s += closes[q]; return s / Math.min(n, i + 1); };
    const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20);
    const maBull = ma5 > ma10 && ma10 > ma20;
    const maSpread = (Math.max(ma5, ma10, ma20) - Math.min(ma5, ma10, ma20)) / c * 100;
    let vBelow = 0; for (const v of v20) if (v <= vols[i]) vBelow++;
    const volBottomPct = vBelow / v20.length * 100;
    const bias20 = (c / ma20 - 1) * 100;
    const rev5 = (c / closes[Math.max(0, i - 5)] - 1) * 100;
    const ret20 = []; for (let q = Math.max(1, i - 19); q <= i; q++) ret20.push(closes[q] / closes[q - 1] - 1);
    const volat20 = stdev(ret20) * 100;
    const p5 = c / rows[Math.max(0, i - 5)].close - 1;
    const vNow = vols.slice(Math.max(0, i - 4), i + 1).reduce((s, v) => s + v, 0);
    const vPre = vols.slice(Math.max(0, i - 9), i - 4).reduce((s, v) => s + v, 0) || 1;
    const vChg = vNow / vPre - 1;
    const quad = (p5 > 0 ? '价升' : '价跌') + (vChg > 0 ? '量增' : '量减');
    const volPriceDiv = p5 > 0 && vChg < -0.1;
    const weakToStrong = cPrev < cPrev2 && ztToday;
    const gapOpen = (rows[i].open / cPrev - 1) * 100;
    const gapUp = gapOpen > 1;
    const fakeBreak = gapUp && rows[i].close < rows[i].open;
    const listedDays = sh.listedTs ? (ts - sh.listedTs) / DAY_MS : 99999;
    const nearNew = listedDays < 365;
    const wd = new Date(dt + 'T12:00:00').getDay();
    const weekday = wd >= 1 && wd <= 5;
    let zt5 = 0; for (let q = Math.max(1, i - 4); q <= i; q++) { const pp = (closes[q] / closes[q - 1] - 1) * 100; if (pp >= lp - 0.3) zt5++; }
    const nx = rows[i + 1];
    const nextPct = (nx.close / c - 1) * 100;
    const nextHiPct = (nx.high / c - 1) * 100;
    const upRatio = (dayUp[dt] || 0) / (dayTot[dt] || 1) * 100;
    const regime = upRatio < 40 ? 'down' : upRatio < 60 ? 'side' : 'up';
    records.push({
      code, date: dt, lp, pct: +pct.toFixed(2), close: c, capYi: +(c * sh.fs / 1e8).toFixed(1),
      vRatio: +vRatio.toFixed(2), volCv: +volCv.toFixed(2), maBull, maSpread: +maSpread.toFixed(2),
      volBottomPct, bias20: +bias20.toFixed(2), rev5: +rev5.toFixed(2), volat20: +volat20.toFixed(2),
      quad, volPriceDiv, weakToStrong, gapUp, fakeBreak, nearNew, weekday, zt5, regime,
      ztToday, yiZi, nextPct: +nextPct.toFixed(2), nextHiPct: +nextHiPct.toFixed(2),
      nextZtTouch: nextHiPct >= lp - 0.3
    });
  }
}
console.log(`[扫描] 股票-日记录 ${records.length} 条；跳过：无浮动股本 ${skipped.noFloat} / ST·北交所 ${skipped.junk} / 新股窗口 ${skipped.newStock} / K线不足 ${skipped.short}`);

const base = (rows) => { const n = rows.length; return { n, ztT: n ? +(rows.filter(r => r.nextZtTouch).length / n * 100).toFixed(1) : 0, avg: n ? +(rows.reduce((s, r) => s + r.nextPct, 0) / n).toFixed(2) : 0 }; };
function regimeBase(rows) { const g = {}; for (const rg of ['down', 'side', 'up']) { const rs = rows.filter(r => r.regime === rg); g[rg] = base(rs).ztT; } return g; }

// 单因子测量：返回结构化结果（含两半窗一致性 + 三层市场环境分层）
function measure(id, name, rows, keyFn, buckets, filterNote) {
  const b0 = base(rows);
  const rb = regimeBase(rows);
  const ds = rows.map(r => r.date).sort(); const mid = ds[Math.floor(ds.length / 2)];
  const h1 = rows.filter(r => r.date <= mid), h2 = rows.filter(r => r.date > mid);
  const b1 = base(h1).ztT, b2 = base(h2).ztT;
  const out = { id, name, n: rows.length, baseZtT: b0.ztT, filterNote: filterNote || '', buckets: [] };
  for (const b of buckets) {
    const rs = rows.filter(r => keyFn(r) === b.k);
    const n = rs.length;
    const ztT = n ? +(rs.filter(r => r.nextZtTouch).length / n * 100).toFixed(1) : 0;
    const avg = n ? +(rs.reduce((s, r) => s + r.nextPct, 0) / n).toFixed(2) : 0;
    const delta = +(ztT - b0.ztT).toFixed(1);
    // 两半窗一致性
    const g1 = h1.filter(r => keyFn(r) === b.k), g2 = h2.filter(r => keyFn(r) === b.k);
    const n1 = g1.length, n2 = g2.length;
    let half = 'n<30';
    if (n1 >= 30 && n2 >= 30) {
      const z1 = g1.filter(r => r.nextZtTouch).length / n1 * 100;
      const z2 = g2.filter(r => r.nextZtTouch).length / n2 * 100;
      half = (z1 > b1) === (z2 > b2) ? '同向' : '背离';
    }
    // 三层市场环境分层
    const reg = {};
    for (const rg of ['down', 'side', 'up']) {
      const rrs = rs.filter(r => r.regime === rg);
      const rn = rrs.length;
      const rztT = rn ? +(rrs.filter(r => r.nextZtTouch).length / rn * 100).toFixed(1) : 0;
      reg[rg] = { n: rn, ztT: rztT, delta: +(rztT - rb[rg]).toFixed(1) };
    }
    out.buckets.push({ k: b.k, n, ztT, avg, delta, half, reg });
  }
  return out;
}

const zt = records.filter(r => r.ztToday && !r.yiZi);
const ztRecords = records.filter(r => r.ztToday);
console.log('\n[涨停日切片] n=' + zt.length + '（剔一字板 ' + ztRecords.length - zt.length + '）基数', JSON.stringify(base(zt)));

const RESULTS = [];
RESULTS.push(measure('H4', '弱转强（前日阴+今涨停）', zt, r => r.weakToStrong ? '弱转强' : '非弱转强', [{ k: '弱转强' }, { k: '非弱转强' }]));
RESULTS.push(measure('I4', '板位分层（近5日涨停数）', zt, r => r.zt5 === 1 ? '首板' : r.zt5 === 2 ? '2板' : r.zt5 >= 3 ? '≥3板' : '其他', [{ k: '首板' }, { k: '2板' }, { k: '≥3板' }]));
RESULTS.push(measure('K4', '新高新低差（市场环境，逐日）', zt, r => r.regime === 'down' ? '普跌<40%' : r.regime === 'side' ? '震荡40-60' : '普涨>60%', [{ k: '普跌<40%' }, { k: '震荡40-60' }, { k: '普涨>60%' }]));
RESULTS.push(measure('L9', '量价背离（价升量减）', zt, r => r.volPriceDiv ? '背离' : '非背离', [{ k: '背离' }, { k: '非背离' }]));
RESULTS.push(measure('M1', '低波因子（20日波动率分档）', zt, r => r.volat20 < 2 ? '<2%' : r.volat20 < 3.5 ? '2-3.5%' : r.volat20 < 5 ? '3.5-5%' : '>5%', [{ k: '<2%' }, { k: '2-3.5%' }, { k: '3.5-5%' }, { k: '>5%' }]));
RESULTS.push(measure('M3', '反转因子（5日收益分档）', zt, r => r.rev5 < -5 ? '<-5%' : r.rev5 < 0 ? '-5~0%' : r.rev5 < 5 ? '0~5%' : '>5%', [{ k: '<-5%' }, { k: '-5~0%' }, { k: '0~5%' }, { k: '>5%' }]));
RESULTS.push(measure('N5', '均线多头排列', zt, r => r.maBull ? '多头' : '非多头', [{ k: '多头' }, { k: '非多头' }]));
RESULTS.push(measure('N6', '均线粘合（MA间距分档）', zt, r => r.maSpread < 2 ? '粘合<2%' : r.maSpread < 5 ? '2-5%' : '>5%', [{ k: '粘合<2%' }, { k: '2-5%' }, { k: '>5%' }]));
RESULTS.push(measure('N8', '地量见地价（量能最低分位）', zt, r => r.volBottomPct < 20 ? '地量<20%' : r.volBottomPct < 50 ? '20-50%' : '>50%', [{ k: '地量<20%' }, { k: '20-50%' }, { k: '>50%' }]));
RESULTS.push(measure('N9', '量价四象限', zt, r => r.quad, [{ k: '价升量增' }, { k: '价升量减' }, { k: '价跌量增' }, { k: '价跌量减' }]));
RESULTS.push(measure('P8', '换手率异常（量能变异系数）', zt, r => r.volCv < 0.4 ? '平稳<0.4' : r.volCv < 0.8 ? '0.4-0.8' : r.volCv < 1.2 ? '0.8-1.2' : '>1.2异常', [{ k: '平稳<0.4' }, { k: '0.4-0.8' }, { k: '0.8-1.2' }, { k: '>1.2异常' }]));
RESULTS.push(measure('P9', '量比×换手位置', zt, r => (r.vRatio < 0.8 && r.volBottomPct < 50) ? '缩量低位' : (r.vRatio < 0.8) ? '缩量高位' : '常轨≥0.8', [{ k: '缩量低位' }, { k: '缩量高位' }, { k: '常轨≥0.8' }]));
RESULTS.push(measure('Q15', '假突破过滤（跳空高开回落）', zt, r => r.fakeBreak ? '假突破' : r.gapUp ? '真突破' : '无缺口', [{ k: '假突破' }, { k: '真突破' }, { k: '无缺口' }]));
RESULTS.push(measure('J10', '近端次新（上市<1年）', zt, r => r.nearNew ? '次新' : '非次新', [{ k: '次新' }, { k: '非次新' }]));
RESULTS.push(measure('J11', '日历效应（月初/末 vs 中）', zt, r => { const d = +r.date.slice(8, 10); return d <= 5 ? '月初1-5' : d >= 25 ? '月末25-' : '月中6-24'; }, [{ k: '月初1-5' }, { k: '月中6-24' }, { k: '月末25-' }]));
RESULTS.push(measure('J12', '周内效应（周一/五 vs 中）', zt, r => { const w = new Date(r.date + 'T12:00:00').getDay(); return w === 1 ? '周一' : w === 5 ? '周五' : '周二三四'; }, [{ k: '周一' }, { k: '周二三四' }, { k: '周五' }]));
RESULTS.push(measure('H13', '涨停家数风控线（全宇宙当日涨停数）', ztRecords, r => { const n = dayZt[r.date] || 0; return n < 30 ? '<30(冰点)' : n < 80 ? '30-80' : n < 150 ? '80-150' : '>150(过热)'; }, [{ k: '<30(冰点)' }, { k: '30-80' }, { k: '80-150' }, { k: '>150(过热)' }]));
RESULTS.push(measure('L2', '封板率近似（涨停/上涨）', ztRecords, r => { const d = r.date; const up = dayUp[d] || 1; const n = dayZt[d] || 0; const r0 = n / up * 100; return r0 < 3 ? '低<3%' : r0 < 6 ? '3-6%' : '>6%'; }, [{ k: '低<3%' }, { k: '3-6%' }, { k: '>6%' }]));

// 控制台可读摘要
for (const o of RESULTS) {
  console.log('\n════ ' + o.id + ' ' + o.name + ' ════  (n=' + o.n + ', base=' + o.baseZtT + '%)');
  for (const b of o.buckets) {
    const reg = b.reg ? ` down:${b.reg.down.n}/${b.reg.down.ztT}(${b.reg.down.delta>0?'+':''}${b.reg.down.delta}) side:${b.reg.side.n}/${b.reg.side.ztT}(${b.reg.side.delta>0?'+':''}${b.reg.side.delta}) up:${b.reg.up.n}/${b.reg.up.ztT}(${b.reg.up.delta>0?'+':''}${b.reg.up.delta})` : '';
    console.log('  ' + b.k.padEnd(12) + ' n=' + String(b.n).padStart(5) + ' 次日触板=' + String(b.ztT).padStart(5) + '% (Δ' + (b.delta>0?'+':'') + b.delta + ')  半窗=' + b.half + reg);
  }
}

fs.writeFileSync('_research_gs_out.json', JSON.stringify({ at: new Date().toISOString(), ztBase: base(zt), results: RESULTS }, null, 1));
console.log('\n✅ gs v2 测量结果已落盘 _research_gs_out.json（含两半窗一致性 + 三层市场环境分层，一次性测量工具，不进发布包）');
