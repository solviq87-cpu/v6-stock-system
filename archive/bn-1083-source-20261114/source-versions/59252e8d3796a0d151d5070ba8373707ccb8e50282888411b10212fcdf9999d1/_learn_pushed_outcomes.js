'use strict';
// 推送结果学习：把每天被推的票及其收盘结果落库，用于持续观察各信号类型的真实命中率。
// 与 learnall 不同：这里学的是「系统自己推的票后来怎么样了」，是信号质量监控，不是全 A 走势预测。
const fs = require('fs');
const path = require('path');
const A = require('./analysis.js');
const LEARNALL = require('./learnall.js');

const ROOT = __dirname;
const KLINE_DIR = path.join(ROOT, '.kline_cache');
const SNAPSHOT = path.join(ROOT, 'stocks_snapshot.json');
const OUT_FILE = path.join(ROOT, 'learn_pushed_outcomes.json');

function fmtDs(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
const ds = process.argv[2] || fmtDs(new Date());
const PUSH_GROUPS = path.join(ROOT, '..', 'stock-dashboard-artifacts', 'daily-brief', `_tmp_pushlog_groups_${ds}.json`);

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function atomicWrite(p, data) {
  const tmp = p + '.tmp' + Date.now();
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, p);
}

const snap = readJson(SNAPSHOT);
if (!snap || !snap.rows) { console.error('missing snapshot'); process.exit(1); }
const snapMap = new Map(snap.rows.map(r => [r.code, r]));

const groups = readJson(PUSH_GROUPS) || [];

// 去重代码，保留首次出现的标题/时间
const codeMeta = new Map();
for (const g of groups) {
  const t = new Date(g.ts);
  const time = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  for (const c of g.codes || []) {
    if (!codeMeta.has(c)) codeMeta.set(c, { titles: [], ts: g.ts, time });
    const m = codeMeta.get(c);
    m.titles.push(g.title);
    if (g.ts < m.ts) { m.ts = g.ts; m.time = time; }
  }
}

A.setNoLimitFn(code => {
  const r = snapMap.get(code);
  if (!r || !r.listedDate) return false;
  const today = Number(ds);
  return (today - r.listedDate) <= 4;
});

const samples = [];
for (const [code, meta] of codeMeta) {
  const r = snapMap.get(code);
  if (!r) continue;
  const kf = path.join(KLINE_DIR, code + '.json');
  if (!fs.existsSync(kf)) continue;
  const kline = readJson(kf);
  const rows = kline && kline.rows;
  if (!rows || rows.length < 8) continue;
  const limitPct = A.limitPctOf(code, r.name);
  const feat = LEARNALL.extractFeatures(rows, rows.length - 1, { limitPct, code, name: r.name });
  if (!feat) continue;
  const isZt = A.isLimitUp(code, r.name, r.pct);
  const ztType = A.classifyZT({ rows, price: rows[rows.length - 1].close, code, name: r.name }).type;
  let outcome = 'flat';
  if (isZt) outcome = 'zt';
  else if (r.pct > 0) outcome = 'up';
  else if (r.pct < 0) outcome = 'down';
  samples.push({
    ds, code, name: r.name,
    titles: Array.from(new Set(meta.titles)),
    time: meta.time,
    pct: r.pct,
    limitPct,
    outcome,
    zt: isZt ? 1 : 0,
    ztType,
    feat
  });
}

// 增量写入
let db = readJson(OUT_FILE) || { ver: 1, samples: [] };
if (!Array.isArray(db.samples)) db.samples = [];
// 去重：同一天同一代码只保留最新
const existing = db.samples.filter(s => !(s.ds === ds));
const combined = existing.concat(samples);
db.samples = combined;

// 统计：按标题聚合近 30 天命中/上涨率
const stats = {};
for (const s of combined.slice(-5000)) {
  for (const t of s.titles || []) {
    const e = stats[t] = stats[t] || { n: 0, zt: 0, up: 0, win: 0 };
    e.n++;
    e.zt += s.zt;
    if (s.outcome === 'up') e.up++;
    if (s.outcome === 'zt' || s.outcome === 'up') e.win++;
  }
}
const titleStats = Object.entries(stats)
  .map(([t, e]) => ({ title: t, n: e.n, zt: e.zt, up: e.up, win: e.win, ztRate: e.n ? +(e.zt/e.n*100).toFixed(1) : 0, winRate: e.n ? +(e.win/e.n*100).toFixed(1) : 0 }))
  .sort((a, b) => b.winRate - a.winRate);

// 今日按 outcome 统计
const todayByOutcome = { zt: 0, up: 0, down: 0, flat: 0 };
for (const s of samples) todayByOutcome[s.outcome] = (todayByOutcome[s.outcome] || 0) + 1;

db.updatedAt = Date.now();
db.summary = {
  totalSamples: combined.length,
  todaySamples: samples.length,
  todayZt: samples.filter(s => s.zt).length,
  todayUp: samples.filter(s => s.outcome === 'up').length,
  todayDown: samples.filter(s => s.outcome === 'down').length,
  todayWinRate: samples.length ? +(((samples.filter(s => s.outcome === 'zt' || s.outcome === 'up').length) / samples.length) * 100).toFixed(1) : 0,
  todayByOutcome,
  titleStats
};

atomicWrite(OUT_FILE, JSON.stringify(db, null, 2));
console.log(`写入 ${samples.length} 条今日样本，累计 ${combined.length} 条`);
console.log(`今日 outcome: zt=${todayByOutcome.zt}, up=${todayByOutcome.up}, down=${todayByOutcome.down}, flat=${todayByOutcome.flat}`);
console.log(`今日上涨率（含涨停） ${db.summary.todayWinRate}%`);
console.log(JSON.stringify(titleStats.slice(0, 8), null, 2));
