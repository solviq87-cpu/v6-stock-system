'use strict';
// ═══ 每日回测学习 · 一进二人群因子实证（2026-10-14）═══
// 台账 H/I/D 组当前重点候选，按 hf 轮同款实证流水线：
//   人群：历史每日涨停池（东财 getTopicZTPool 历史 date，含 fbt 首次封板时间/fund 封单额/zbc 炸板次数）
//         × 连板数=1（首板，与 scanYiEr 人群同口径），剔一字板/ST/北交所/新股(45天)。
//   结局：次日【收盘】涨停（一进二，与 yier 信号 nd 口径一致）；附列次日触板（与 gq/gr/gs/hf 研究可比）。
//   稳健关：① 两半窗同向（各半窗 n>=30）② 三层市场环境（普跌<40/震荡40-60/普涨>=60）不显著变差
//          ③ |Δ|>=2.5pp ④ 桶 n>=60。系数取实测 log-odds 保守端；单一因子不许独大。
// 候选：H2 封板时间(fbt) / I9 市值·位置·封成比 / H3 封单强度 / H7 炸板次数(撤单分歧代理) / D2 随市况分层。
// ⛔ H5 竞价量比/H6 未匹配买单：历史竞价分时/盘口不可得（trends2 仅最新1交易日）→ 本轮数据不可算，留痕。
const fs = require('fs'), path = require('path');
const A = require('./analysis.js');
const snap = JSON.parse(fs.readFileSync('stocks_snapshot.json', 'utf8'));
const listedTs = new Map();
for (const r of snap.rows || []) { if (r.code) listedTs.set(r.code, Number(r.listedDate) || 0); }
const DAY_MS = 86400000;

// ── 1. 市场环境（逐日涨跌比，全宇宙） ──
const dayUp = {}, dayTot = {};
const kcache = new Map();
function krows(code) {
  if (kcache.has(code)) return kcache.get(code);
  let r = null;
  try { r = JSON.parse(fs.readFileSync(path.join(__dirname, '.kline_cache', code + '.json'), 'utf8')).rows || null; } catch {}
  kcache.set(code, r); return r;
}
for (const f of fs.readdirSync('.kline_cache')) {
  if (!/^[0-9]{6}\.json$/.test(f)) continue;
  const rows = krows(f.slice(0, 6));
  if (!rows) continue;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].date;
    dayTot[d] = (dayTot[d] || 0) + 1;
    if ((rows[i].close / rows[i - 1].close - 1) > 0) dayUp[d] = (dayUp[d] || 0) + 1;
  }
}
const urOf = d => dayTot[d] ? (dayUp[d] || 0) / dayTot[d] * 100 : null;
const regimeOf = u => u == null ? null : u < 40 ? 'down' : u < 60 ? 'side' : 'up';

// ── 2. 建人群：涨停池首板 × kline ──
const recs = [];
const skipped = { noK: 0, junk: 0, newStock: 0, short: 0, yiZi: 0, noNext: 0, notFirst: 0 };
for (const f of fs.readdirSync('.ztpool_hist').sort()) {
  const d = f.replace('.json', '');
  let pool; try { pool = JSON.parse(fs.readFileSync(path.join(__dirname, '.ztpool_hist', f), 'utf8')); } catch { continue; }
  const ur = urOf(d);
  for (const z of pool) {
    if ((z.limitUpCount || 1) !== 1) { skipped.notFirst++; continue; }
    const code = z.code;
    const nm = z.name || '';
    if (A.isJunkName(nm)) { skipped.junk++; continue; }
    if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) { skipped.junk++; continue; }
    const rows = krows(code);
    if (!rows || rows.length < 25) { skipped.short++; continue; }
    const i = rows.findIndex(r => r.date === d);
    if (i < 19 || i >= rows.length - 1) { skipped.short++; continue; }
    const lt = listedTs.get(code) || 0;
    if (lt && new Date(d + 'T12:00:00').getTime() - lt < 45 * DAY_MS) { skipped.newStock++; continue; }
    const cur = rows[i], prev = rows[i - 1], nx = rows[i + 1];
    const lp = A.limitPctOf(code, nm);
    if (cur.open >= prev.close * (1 + lp / 100) - 0.02) { skipped.yiZi++; continue; }
    if (!nx.high || !cur.close) { skipped.noNext++; continue; }
    // 结局
    const nextPct = (nx.close / cur.close - 1) * 100;
    const nextZt = A.isLimitUp(code, nm, +nextPct.toFixed(2));
    const nextHiPct = (nx.high / cur.close - 1) * 100;
    const nextTouch = nextHiPct >= lp - 0.3;
    // 特征（口径与 reviewFlags 逐字同源）
    const w20 = rows.slice(i - 19, i + 1);
    let hi = -Infinity, lo = Infinity;
    for (const r of w20) { if (r.high > hi) hi = r.high; if (r.low < lo) lo = r.low; }
    const rangePos = hi > lo ? +((cur.close - lo) / (hi - lo) * 100).toFixed(1) : null;
    const vArr = w20.map(r => r.volume).sort((a, b) => a - b);
    const vMed = vArr.length ? vArr[Math.floor(vArr.length / 2)] : 0;
    const volRatio = vMed > 0 ? +(cur.volume / vMed).toFixed(2) : null;
    const capYi = z.floatCap > 0 ? +(z.floatCap / 1e8).toFixed(1) : null;
    const sealRatio = z.amount > 0 ? +(z.sealAmount / z.amount * 100).toFixed(2) : null;   // 封成比 %
    const sealStrength = z.floatCap > 0 ? +(z.sealAmount / z.floatCap * 100).toFixed(3) : null; // 封单强度 %
    const zbc = Number(z.breakCount) || 0;
    const fbt = z.firstSeal != null ? String(z.firstSeal).padStart(6, '0') : null;          // HHMMSS
    recs.push({
      code, name: nm, date: d, src: z.src || 'ths', lp,
      nextZt, nextTouch, nextPct: +nextPct.toFixed(2), nextHiPct: +nextHiPct.toFixed(2),
      capYi, rangePos, volRatio, sealRatio, sealStrength, zbc, fbt,
      turnover: z.turnover || 0, regime: regimeOf(ur), ur: ur == null ? null : +ur.toFixed(0)
    });
  }
}
console.log(`[扫描] 一进二人群 n=${recs.length}（源：东财 ${recs.filter(r => r.src === 'em').length} / 同花顺 ${recs.filter(r => r.src !== 'em').length}）`);
console.log(`[跳过] ${JSON.stringify(skipped)}`);
const N = recs.length;
const baseZt = recs.filter(r => r.nextZt).length / N * 100;
const baseTouch = recs.filter(r => r.nextTouch).length / N * 100;
console.log(`[基线] 次日收盘涨停 ${baseZt.toFixed(1)}%（一进二成功率）｜次日触板 ${baseTouch.toFixed(1)}%\n`);

// ── 3. 测量（hf 同款稳健关） ──
function measure(id, name, rows, keyFn, buckets, oc = 'nextZt') {
  const b0 = rows.length ? rows.filter(r => r[oc]).length / rows.length * 100 : 0;
  const ds = rows.map(r => r.date).sort();
  const mid = ds[Math.floor(ds.length / 2)];
  const h1 = rows.filter(r => r.date <= mid), h2 = rows.filter(r => r.date > mid);
  const b1 = h1.length ? h1.filter(r => r[oc]).length / h1.length * 100 : 0;
  const b2 = h2.length ? h2.filter(r => r[oc]).length / h2.length * 100 : 0;
  const out = { id, name, n: rows.length, base: +b0.toFixed(1), baseTouch: +(rows.length ? rows.filter(r => r.nextTouch).length / rows.length * 100 : 0).toFixed(1), buckets: [] };
  for (const b of buckets) {
    const rs = rows.filter(r => keyFn(r) === b.k);
    const n = rs.length;
    if (!n) { out.buckets.push({ k: b.k, n: 0 }); continue; }
    const rate = rs.filter(r => r[oc]).length / n * 100;
    const delta = +(rate - b0).toFixed(1);
    const g1 = h1.filter(r => keyFn(r) === b.k), g2 = h2.filter(r => keyFn(r) === b.k);
    let half = 'n<30';
    if (g1.length >= 30 && g2.length >= 30) {
      const z1 = g1.filter(r => r[oc]).length / g1.length * 100, z2 = g2.filter(r => r[oc]).length / g2.length * 100;
      half = (z1 > b1) === (z2 > b2) ? '同向' : '背离';
    }
    const reg = {};
    for (const rg of ['down', 'side', 'up']) {
      const rrs = rs.filter(r => r.regime === rg);
      const rrBase = rows.filter(r => r.regime === rg);
      const rb = rrBase.length ? rrBase.filter(r => r[oc]).length / rrBase.length * 100 : 0;
      reg[rg] = { n: rrs.length, rate: rrs.length ? +(rrs.filter(r => r[oc]).length / rrs.length * 100).toFixed(1) : 0, delta: rrs.length ? +(rrs.filter(r => r[oc]).length / rrs.length * 100 - rb).toFixed(1) : null };
    }
    // log-odds（保守端=两半窗中 |Δ| 较小者；加性平滑防 p=0/1 出 NaN/-Inf）
    let lo = null;
    if (g1.length >= 30 && g2.length >= 30) {
      const loOf = (hits, n) => Math.log((hits + 0.5) / (n - hits + 0.5));
      const d1 = loOf(g1.filter(r => r[oc]).length, g1.length) - loOf(h1.filter(r => r[oc]).length, h1.length);
      const d2 = loOf(g2.filter(r => r[oc]).length, g2.length) - loOf(h2.filter(r => r[oc]).length, h2.length);
      lo = +(Math.abs(d1) < Math.abs(d2) ? d1 : d2).toFixed(3);
    }
    // 稳健关
    const passHalf = half === '同向';
    const passReg = ['down', 'side', 'up'].every(rg => reg[rg].delta == null || (delta >= 0 ? reg[rg].delta >= -3 : reg[rg].delta <= 3));
    const passMag = Math.abs(delta) >= 2.5;
    const passN = n >= 60;
    out.buckets.push({ k: b.k, n, rate: +rate.toFixed(1), delta, half, reg, lo, pass: passHalf && passReg && passMag && passN });
  }
  return out;
}
const R = [];
R.push(measure('H2', '封板时间(首次封板 fbt)', recs.filter(r => r.fbt), r => {
  const t = r.fbt;
  if (t <= '092500') return '①竞价/开盘即封';
  if (t <= '100000') return '②09:30-10:00';
  if (t <= '113000') return '③10:00-11:30';
  if (t <= '140000') return '④13:00-14:00';
  return '⑤14:00-15:00 尾盘';
}, [{ k: '①竞价/开盘即封' }, { k: '②09:30-10:00' }, { k: '③10:00-11:30' }, { k: '④13:00-14:00' }, { k: '⑤14:00-15:00 尾盘' }]));
R.push(measure('I9a', '流通市值(亿)', recs.filter(r => r.capYi != null), r => r.capYi < 30 ? '<30' : r.capYi < 100 ? '30-100' : r.capYi < 500 ? '100-500' : '≥500', [{ k: '<30' }, { k: '30-100' }, { k: '100-500' }, { k: '≥500' }]));
R.push(measure('I9b', '20日位置 rangePos', recs.filter(r => r.rangePos != null), r => r.rangePos < 30 ? '<30 底部' : r.rangePos <= 70 ? '30-70 半山腰' : '>70 顶部', [{ k: '<30 底部' }, { k: '30-70 半山腰' }, { k: '>70 顶部' }]));
R.push(measure('I9c', '封成比(封单额/成交额 %)', recs.filter(r => r.sealRatio != null), r => r.sealRatio < 0.3 ? '<0.3%' : r.sealRatio < 1 ? '0.3-1%' : r.sealRatio < 3 ? '1-3%' : '≥3%', [{ k: '<0.3%' }, { k: '0.3-1%' }, { k: '1-3%' }, { k: '≥3%' }]));
R.push(measure('H3', '封单强度(封单额/流通市值 %)', recs.filter(r => r.sealStrength != null), r => r.sealStrength < 0.3 ? '<0.3%' : r.sealStrength < 0.5 ? '0.3-0.5%' : r.sealStrength < 1 ? '0.5-1%' : '≥1%', [{ k: '<0.3%' }, { k: '0.3-0.5%' }, { k: '0.5-1%' }, { k: '≥1%' }]));
R.push(measure('H7', '炸板次数(撤单/分歧代理)', recs, r => r.zbc === 0 ? '0次 硬板' : r.zbc === 1 ? '1次' : '≥2次', [{ k: '0次 硬板' }, { k: '1次' }, { k: '≥2次' }]));
R.push(measure('D2x', '缩量首板(volRatio<0.8)', recs.filter(r => r.volRatio != null), r => r.volRatio < 0.8 ? '<0.8 缩量' : r.volRatio < 1.5 ? '0.8-1.5' : '≥1.5 放量', [{ k: '<0.8 缩量' }, { k: '0.8-1.5' }, { k: '≥1.5 放量' }]));

for (const o of R) {
  console.log(`【${o.id} ${o.name}】 基线 收盘涨停 ${o.base}% / 触板 ${o.baseTouch}% (n=${o.n})`);
  for (const b of o.buckets) {
    if (!b.n) { console.log(`   ${String(b.k).padEnd(14)} n=0`); continue; }
    const regs = ['down', 'side', 'up'].map(rg => `${rg}:${b.reg[rg].rate}%(${b.reg[rg].delta >= 0 ? '+' : ''}${b.reg[rg].delta},n${b.reg[rg].n})`).join(' ');
    console.log(`   ${String(b.k).padEnd(14)} n=${String(b.n).padStart(4)} 涨停${String(b.rate).padStart(5)}% Δ${(b.delta >= 0 ? '+' : '') + b.delta} 半窗:${b.half} lo:${b.lo} ${b.pass ? '✅过' : '❌不过'} | ${regs}`);
  }
}
// 同批因子按「次日触板」结局复测（与 gq/gr/gs/hf 模型系数的校准结局同口径，供比对）
console.log('\n=== 复测：次日触板结局（与模型既有系数的校准口径一致） ===');
const RT = [
  ['H2t', '封板时间(触板口径)', recs.filter(r => r.fbt), r => { const t = r.fbt; return t <= '100000' ? '②≤10:00' : t <= '113000' ? '③10-11:30' : t <= '140000' ? '④13-14:00' : '⑤14-15:00'; }, [{ k: '②≤10:00' }, { k: '③10-11:30' }, { k: '④13-14:00' }, { k: '⑤14-15:00' }]],
  ['SS', '封单强度(触板口径)', recs.filter(r => r.sealStrength != null), r => r.sealStrength < 0.3 ? '<0.3%' : r.sealStrength < 0.5 ? '0.3-0.5%' : r.sealStrength < 1 ? '0.5-1%' : '≥1%', [{ k: '<0.3%' }, { k: '0.3-0.5%' }, { k: '0.5-1%' }, { k: '≥1%' }]],
  ['SR', '封成比(触板口径)', recs.filter(r => r.sealRatio != null), r => r.sealRatio < 1 ? '<1%' : r.sealRatio < 3 ? '1-3%' : '≥3%', [{ k: '<1%' }, { k: '1-3%' }, { k: '≥3%' }]],
  ['VR', '缩量(触板口径)', recs.filter(r => r.volRatio != null), r => r.volRatio < 0.8 ? '<0.8 缩量' : r.volRatio < 1.5 ? '0.8-1.5' : '≥1.5 放量', [{ k: '<0.8 缩量' }, { k: '0.8-1.5' }, { k: '≥1.5 放量' }]],
  ['CP', '市值(触板口径)', recs.filter(r => r.capYi != null), r => r.capYi < 100 ? '<100亿' : r.capYi < 500 ? '100-500亿' : '≥500亿', [{ k: '<100亿' }, { k: '100-500亿' }, { k: '≥500亿' }]],
  ['RP', '位置(触板口径)', recs.filter(r => r.rangePos != null), r => r.rangePos < 30 ? '<30' : r.rangePos <= 70 ? '30-70' : '>70', [{ k: '<30' }, { k: '30-70' }, { k: '>70' }]]
];
for (const [id, nm, rows, kf, bs] of RT) {
  const o = measure(id, nm, rows, kf, bs, 'nextTouch');
  console.log(`【${o.id} ${o.name}】 基线 触板 ${o.base}% (n=${o.n})`);
  for (const b of o.buckets) {
    if (!b.n) { console.log(`   ${String(b.k).padEnd(14)} n=0`); continue; }
    const regs = ['down', 'side', 'up'].map(rg => `${rg}:${b.reg[rg].rate}%(${b.reg[rg].delta >= 0 ? '+' : ''}${b.reg[rg].delta},n${b.reg[rg].n})`).join(' ');
    console.log(`   ${String(b.k).padEnd(14)} n=${String(b.n).padStart(4)} 触板${String(b.rate).padStart(5)}% Δ${(b.delta >= 0 ? '+' : '') + b.delta} 半窗:${b.half} lo:${b.lo} ${b.pass ? '✅过' : '❌不过'} | ${regs}`);
  }
  R.push(o);
}

// ── 4. D2 随市况分层：各因子在三层环境的基线 + 关键分档 ──
console.log('\n=== D2 一进二随市况分层：三层环境基线 ===');
for (const rg of ['down', 'side', 'up']) {
  const rs = recs.filter(r => r.regime === rg);
  if (!rs.length) continue;
  const days = [...new Set(rs.map(r => r.date))].sort();
  console.log(`  ${rg}: 信号日${days.length}天 n=${rs.length} 收盘涨停 ${(rs.filter(r => r.nextZt).length / rs.length * 100).toFixed(1)}% 触板 ${(rs.filter(r => r.nextTouch).length / rs.length * 100).toFixed(1)}%`);
}
console.log('  环境×封单强度 交叉（收盘涨停率%）：');
for (const rg of ['down', 'side', 'up']) {
  const line = ['<0.3%', '0.3-0.5%', '0.5-1%', '≥1%'].map(k => {
    const rs = recs.filter(r => r.regime === rg && r.sealStrength != null && (r.sealStrength < 0.3 ? '<0.3%' : r.sealStrength < 0.5 ? '0.3-0.5%' : r.sealStrength < 1 ? '0.5-1%' : '≥1%') === k);
    return rs.length ? `${k}:${(rs.filter(r => r.nextZt).length / rs.length * 100).toFixed(0)}%(n${rs.length})` : `${k}:-`;
  }).join(' ');
  console.log(`    ${rg}: ${line}`);
}
console.log('  环境×市值 交叉（收盘涨停率%）：');
for (const rg of ['down', 'side', 'up']) {
  const line = ['<30', '30-100', '100-500', '≥500'].map(k => {
    const rs = recs.filter(r => r.regime === rg && r.capYi != null && (r.capYi < 30 ? '<30' : r.capYi < 100 ? '30-100' : r.capYi < 500 ? '100-500' : '≥500') === k);
    return rs.length ? `${k}:${(rs.filter(r => r.nextZt).length / rs.length * 100).toFixed(0)}%(n${rs.length})` : `${k}:-`;
  }).join(' ');
  console.log(`    ${rg}: ${line}`);
}

fs.writeFileSync('_research_yier_out_20261018.json', JSON.stringify({ n: N, baseZt: +baseZt.toFixed(1), baseTouch: +baseTouch.toFixed(1), R }, null, 1));
console.log('\n→ 结果写入 _research_yier_out_20261018.json');

// ── 5. 共线性检查：封板时间 vs 封单强度/封成比（防同一信息双重计数） ──
console.log('\n=== 共线性：封板时间档 × 封单强度（均值%/触板率） ===');
const fbtBucket = r => { const t = r.fbt; return t <= '100000' ? '②≤10:00' : t <= '113000' ? '③10-11:30' : t <= '140000' ? '④13-14:00' : '⑤14-15:00'; };
for (const fb of ['②≤10:00', '③10-11:30', '④13-14:00', '⑤14-15:00']) {
  const rs = recs.filter(r => r.fbt && fbtBucket(r) === fb && r.sealStrength != null);
  if (!rs.length) continue;
  const meanSS = rs.reduce((a, r) => a + r.sealStrength, 0) / rs.length;
  const strong = rs.filter(r => r.sealStrength >= 0.5).length / rs.length * 100;
  // 档内再按封单强度分层：看 ④ 的惩罚在强封单内存不存在
  const inStrong = rs.filter(r => r.sealStrength >= 0.5);
  const inWeak = rs.filter(r => r.sealStrength < 0.5);
  const sRate = inStrong.length ? (inStrong.filter(r => r.nextZt).length / inStrong.length * 100).toFixed(1) + '%(n' + inStrong.length + ')' : '-';
  const wRate = inWeak.length ? (inWeak.filter(r => r.nextZt).length / inWeak.length * 100).toFixed(1) + '%(n' + inWeak.length + ')' : '-';
  console.log(`  ${fb}: 均封单强度 ${meanSS.toFixed(3)}%｜强封单(≥0.5%)占比 ${strong.toFixed(0)}%｜档内强封单涨停 ${sRate} 弱封单涨停 ${wRate}`);
}
// 参照：全体在强/弱封单内的涨停率
{
  const rs = recs.filter(r => r.sealStrength != null);
  const s = rs.filter(r => r.sealStrength >= 0.5), w = rs.filter(r => r.sealStrength < 0.5);
  console.log(`  [全体] 强封单涨停 ${(s.filter(r => r.nextZt).length / s.length * 100).toFixed(1)}%(n${s.length})｜弱封单涨停 ${(w.filter(r => r.nextZt).length / w.length * 100).toFixed(1)}%(n${w.length})`);
}

// ── 6. 人群按日分布（防早期日期覆盖不足导致基线偏） ──
console.log('\n=== 人群按信号日分布 ===');
const byD = {};
for (const r of recs) byD[r.date] = (byD[r.date] || 0) + 1;
const dk = Object.keys(byD).sort();
console.log('  ' + dk.map(d => d.slice(5) + ':' + byD[d]).join(' '));
console.log(`  合计 ${dk.length} 天 / ${recs.length} 条；前半窗(${dk[0]}~${dk[Math.floor(dk.length / 2)]}) ${recs.filter(r => r.date <= dk[Math.floor(dk.length / 2)]).length} 条`);

// ── 5. 今日新增检查（2026-10-21 自动化）──
// 竞价类候选本地数据可得性核查（留痕，不静默跳过）：
const alog = JSON.parse(fs.readFileSync(path.join(__dirname, 'auction_log.json'), 'utf8'));
const withTicks = alog.filter(x => x.ticks && x.ticks.bars && x.ticks.bars.length);
const hasVol = withTicks.some(x => x.ticks.bars.some(b => b.volume != null || b.vol != null || b.amount != null));
console.log('\n=== 竞价类候选数据核查（auction_log） ===');
console.log(`  竞价留痕 ${alog.length} 条（${[...new Set(alog.map(x => x.date))].sort().join('/')}），带分时 ${withTicks.length} 条；trap=true ${alog.filter(x => x.trap).length} 条`);
console.log(`  分时 bars 含量字段: ${hasVol} → 量比/未匹配买单${hasVol ? '可算' : '不可算（bars 仅 price/high/low）'}；撤单陷阱${alog.filter(x => x.trap).length ? '有方差' : '无方差（恒 false）'}`);
console.log('  封板时间历史源: .ztpool_hist fbt（东财）✅ 已随本轮扩样复测');
fs.writeFileSync(path.join(__dirname, '_research_yier_out_20261021.json'), JSON.stringify({ n: recs.length, baseZt: +baseZt.toFixed(1), baseTouch: +baseTouch.toFixed(1), R }, null, 1));
console.log('→ 写入 _research_yier_out_20261021.json');
