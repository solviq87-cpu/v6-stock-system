// ②段：普涨日竞价信号专项归因（hu 轮，2026-10-15）
//
// 背景（ht 轮回填后翻案）：auczt 普涨层 n=100，次日+3% 仅 12%（lift -0.8pp）、
//   收涨仅 22%、均涨幅 -1.88% —— 按 _backtest_nd.js 自带判据是「选股退化」而非环境敏感。
//   本脚本深挖四个信号时点**已知**的维度，看普涨日是否系统性反指：
//     维度一 score  竞价评分（模型自身强弱）
//     维度二 prob / fused  模型输出概率（fused 仅 231 条新样本有）
//     维度三 gap    竞价涨幅 = price 对前一交易日收盘（K线缓存现算）
//     维度四 paths  标准化因子名（竞价额居前X% / 涨幅黄金区·高位 / 连板惯性 / 小盘易拉 /
//                  竞价主力抢筹 / 昨日板块涨停效应 / 板块龙二·中军 / 利好催化）
// 方法：三层环境分层（普跌<40 / 退潮40~52 / 普涨>52）+ 每维度分档 + **两半窗同向检验**
//   （按信号日排序中位切分；某档要下结论，两个半窗的方向必须一致）。
// ⛔ 纪律：缺数据跳过不冒充（gap 算不出就跳过该样本，不当 0）；n<20 的档只列数字不下结论；
//   ⛔ 本脚本只做归因测量，不改任何模型系数 —— 系数方案另经用户确认才动（两半窗同向+不共线+保守端）。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'stats.json'), 'utf8'));
const breadth = JSON.parse(fs.readFileSync(path.join(ROOT, 'breadth.json'), 'utf8'));

// ── 环境分层（与 _backtest_nd.js 同口径：信号日 breadth upRatio）──
const upOf = ds => {
  const k = ds.slice(0, 4) + '-' + ds.slice(4, 6) + '-' + ds.slice(6, 8);
  const b = breadth[k];
  return (b && typeof b.upRatio === 'number') ? b.upRatio : null;
};
const envLayerOf = u => u == null ? '未知' : u < 40 ? '普跌' : u <= 52 ? '退潮' : '普涨';

// ── K线缓存（只读，带内存缓存；坏文件跳过）──
const klineCache = new Map();
function krowsOf(code) {
  if (klineCache.has(code)) return klineCache.get(code);
  let rows = null;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, '.kline_cache', code + '.json'), 'utf8'));
    if (d && Array.isArray(d.rows)) rows = d.rows;
  } catch {}
  klineCache.set(code, rows);
  return rows;
}
// 竞价涨幅：price（竞价虚拟匹配价）对信号日前一交易日收盘
function gapOf(sig) {
  const rows = krowsOf(sig.code);
  if (!rows) return null;
  const ds = sig.date;
  let i = -1;
  for (let k = 0; k < rows.length; k++) if (String(rows[k].date).replace(/-/g, '') === ds) { i = k; break; }
  if (i < 1) return null;                       // 缺信号日本身或没有前一根 → 判不出
  const prev = rows[i - 1];
  if (!prev || !(prev.close > 0) || !(sig.price > 0)) return null;
  return (sig.price - prev.close) / prev.close * 100;
}

// ── 样本 ──
const all = (j.signals || []).filter(s => s && s.type === 'auczt' && !s.void && s.nd && typeof s.nd.maxGain === 'number');
const half = arr => {
  const dates = [...new Set(arr.map(s => s.date))].sort();
  const mid = dates[Math.floor(dates.length / 2)];
  return { a: arr.filter(s => s.date < mid), b: arr.filter(s => s.date >= mid), mid };
};

const BUCKETS = {
  score: [['<50', s => s.score < 50], ['50-59', s => s.score >= 50 && s.score < 60], ['60-69', s => s.score >= 60 && s.score < 70], ['70+', s => s.score >= 70]],
  prob: [['<50', s => s.prob < 50], ['50-59', s => s.prob >= 50 && s.prob < 60], ['60+', s => s.prob >= 60]],
  gap: [['<=0', s => s._gap <= 0], ['0-3', s => s._gap > 0 && s._gap <= 3], ['3-6', s => s._gap > 3 && s._gap <= 6], ['6-9', s => s._gap > 6 && s._gap <= 9], ['9+', s => s._gap > 9]],
  fused: [['<50', s => s.fused < 50], ['50-59', s => s.fused >= 50 && s.fused < 60], ['60+', s => s.fused >= 60]],
};
for (const s of all) { s._gap = gapOf(s); s._env = envLayerOf(upOf(s.date)); s._hit3 = s.nd.nextPct >= 3; s._hit5 = s.nd.maxGain >= 5; }

function rate(arr) {
  const n = arr.length;
  if (!n) return null;
  return {
    n,
    hit3: arr.filter(s => s._hit3).length / n * 100,   // 口径与 _backtest_nd.js 一致：次日收盘涨幅>=3%
    lim: arr.filter(s => s.nd.limitUp).length / n * 100,
    hit5: arr.filter(s => s._hit5).length / n * 100,   // 次日最高>=5%（与回测表同列）
    next: arr.reduce((a, s) => a + s.nd.nextPct, 0) / n,
    max: arr.reduce((a, s) => a + s.nd.maxGain, 0) / n,
  };
}
function row(name, arr, base) {
  const r = rate(arr);
  if (!r) return null;
  const lift = base ? r.hit3 - base.hit3 : 0;
  const h = half(arr);
  const ra = rate(h.a), rb = rate(h.b);
  const dir = (ra && rb) ? Math.sign(ra.hit3 - base.hit3) === Math.sign(rb.hit3 - base.hit3) && ra.hit3 !== base.hit3 : null;
  return { name, ...r, lift, halfA: ra ? ra.hit3 : null, halfB: rb ? rb.hit3 : null, sameDir: dir, mid: h.mid };
}

const out = { layers: {}, factors: {}, generated: new Date().toISOString() };
for (const layer of ['总体', '普跌', '退潮', '普涨']) {
  const arr = layer === '总体' ? all : all.filter(s => s._env === layer);
  const base = rate(arr);
  if (!base || !arr.length) continue;
  const L = { base, dims: {} };
  for (const [dim, bks] of Object.entries(BUCKETS)) {
    if (dim === 'fused' && arr.filter(s => typeof s.fused === 'number').length < 40) continue; // 薄样本维度不列
    L.dims[dim] = [];
    for (const [name, f] of bks) {
      const sub = arr.filter(f);
      const r = row(name, sub, base);
      if (r && r.n >= 5) L.dims[dim].push(r);
    }
  }
  out.layers[layer] = L;
}

// ── 因子维度：普涨层 with/without + 两半窗 ──
const factorCount = {};
for (const s of all) for (const p of (s.paths || [])) factorCount[p] = (factorCount[p] || 0) + 1;
const topFactors = Object.entries(factorCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
out.topFactors = topFactors.map(f => ({ factor: f, n: factorCount[f] }));
for (const layer of ['普涨', '普跌', '退潮']) {
  const arr = all.filter(s => s._env === layer);
  const base = rate(arr);
  if (!base) continue;
  out.factors[layer] = topFactors.map(f => {
    const withF = arr.filter(s => (s.paths || []).includes(f));
    const r = row('有:' + f, withF, base);
    return r ? { factor: f, ...r } : { factor: f, n: 0 };
  }).filter(x => x.n >= 5);
}

// ── 输出 ──
const fmt = r => r ? `n=${r.n} +3%=${r.hit3.toFixed(1)}% lift=${r.lift >= 0 ? '+' : ''}${r.lift.toFixed(1)}pp 板=${r.lim.toFixed(1)}% 最高5%=${r.hit5.toFixed(0)}% 均涨=${r.next.toFixed(2)}% 均最高=${r.max.toFixed(2)}% 半窗=${r.halfA == null ? '?' : r.halfA.toFixed(0)}/${r.halfB == null ? '?' : r.halfB.toFixed(0)}${r.sameDir ? ' 同向' : ''}` : 'n<5';
console.log('# ②段 普涨日竞价归因（auczt，nd 口径；+3%=次日收盘涨幅，与 _backtest_nd.js 一致）\n');
for (const [layer, L] of Object.entries(out.layers)) {
  console.log(`## ${layer}（n=${L.base.n}，基线 +3%=${L.base.hit3.toFixed(1)}% 板=${L.base.lim.toFixed(1)}% 均涨=${L.base.next.toFixed(2)}%）`);
  for (const [dim, rows] of Object.entries(L.dims)) {
    console.log(`  【${dim}】`);
    for (const r of rows) console.log('    ' + r.name.padEnd(6) + fmt(r));
  }
}
console.log('\n## 因子 with/without（基线=同层总体）');
for (const [layer, rows] of Object.entries(out.factors)) {
  console.log(`  【${layer}】`);
  for (const r of rows) console.log('    ' + r.factor.padEnd(12, '　') + fmt(r));
}
fs.writeFileSync(path.join(ROOT, 'attrib_auction_upday.json'), JSON.stringify(out, null, 1));
console.log('\n产物：attrib_auction_upday.json');
