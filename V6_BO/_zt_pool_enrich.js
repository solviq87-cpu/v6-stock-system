// _zt_pool_enrich.js —— K 线派生涨停补漏能力（iq 轮，2026-10-19）
//
// 背景：_audit_zt_pool.js 已能用本地 .kline_cache 交叉验证 ztPool_snapshot.json，
//   并发现真漏票（如 2026-10-16 的 000678、002531）。本模块把「漏票检测」能力
//   封装成可复用的 enrichment 入口，供 automation / server.js 选择性地把 K 线派生涨停
//   并入 ztPool，或仅生成报告。
//
// 默认行为（安全）：只检测、不自动合并。合并需显式传 { merge: true } 或环境开关。

const fs = require('fs');
const path = require('path');
const audit = require('./_audit_zt_pool.js');

const ROOT = __dirname;
const DEFAULT_POOL = path.join(ROOT, 'ztPool_snapshot.json');
const DEFAULT_CACHE = path.join(ROOT, '.kline_cache');
const DEFAULT_STOCKS = path.join(ROOT, 'stocks_snapshot.json');
const MISSED_FILE = path.join(ROOT, 'zt_pool_missed.json');

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

// 取快照日或指定日
function dayOf(poolPath, day) {
  if (day) return String(day).replace(/-/g, '');
  const pj = readJSON(poolPath, {});
  return String(pj.day || '').replace(/-/g, '');
}

// 检测指定日期的 K 线漏票
// opts: { day, poolPath, cacheDir, stocksPath }
function detectMissed(opts = {}) {
  const poolPath = opts.poolPath || DEFAULT_POOL;
  const cacheDir = opts.cacheDir || DEFAULT_CACHE;
  const stocksPath = opts.stocksPath || DEFAULT_STOCKS;
  const day = dayOf(poolPath, opts.day);
  if (!/^\d{8}$/.test(day)) { return { ok: false, error: '无法确定归属日', missed: [] }; }

  const pj = readJSON(poolPath, {});
  const pool = Array.isArray(pj.pool) ? pj.pool : Array.isArray(pj.data) ? pj.data : [];
  const { klines } = audit.loadCacheKlines(cacheDir);
  const stocksRaw = readJSON(stocksPath, {});
  const stocks = Array.isArray(stocksRaw) ? stocksRaw : (Array.isArray(stocksRaw.rows) ? stocksRaw.rows : []);
  const noLimit = audit.makeNoLimit(stocks);

  const res = audit.auditZTPool(pool, klines, {
    day,
    noLimit: noLimit.fn,
    noLimitActive: noLimit.active,
    now: Date.now(),
    snapAt: pj.at || null
  });

  return { ok: true, day, ...res };
}

// 把 missed 写入 zt_pool_missed.json 供人工复核；不直接改 ztPool_snapshot.json
function saveMissedReport(opts = {}) {
  const res = detectMissed(opts);
  if (!res.ok) return res;
  const payload = {
    day: res.day,
    at: Date.now(),
    poolN: res.poolN,
    missed: res.missed || [],
    nearMiss: res.nearMiss || [],
    aboveLimit: res.aboveLimit || [],
    noLimitActive: res.noLimitActive,
    notes: res.notes || [],
    scope: res.scope
  };
  fs.writeFileSync(MISSED_FILE, JSON.stringify(payload, null, 2));
  return { ok: true, saved: MISSED_FILE, ...payload };
}

// 安全合并：把 missed 中的票追加进 ztPool 副本，生成 enriched 快照（默认不覆写原文件）
// 要求 missed 的 close/limitPx 与生产 isLimitUp 一致，字段尽量补全
function mergeMissedIntoPool(opts = {}) {
  const res = detectMissed(opts);
  if (!res.ok) return res;
  const poolPath = opts.poolPath || DEFAULT_POOL;
  const outPath = opts.outPath || path.join(ROOT, 'ztPool_snapshot_enriched.json');
  const pj = readJSON(poolPath, {});
  const pool = Array.isArray(pj.pool) ? pj.pool : Array.isArray(pj.data) ? pj.data : [];
  const poolSet = new Set(pool.map(z => String(z.code || '')));
  const added = [];
  for (const m of (res.missed || [])) {
    const code = String(m.code || '');
    if (!code || poolSet.has(code)) continue;
    added.push({
      code,
      name: m.name || '',
      pct: +(m.pct || 0).toFixed(2),
      close: m.close,
      limitPx: m.limitPx,
      sector: 'K线派生',        // 明确标记来源
      src: 'kline-derived',
      firstSeal: null,
      lastSeal: null,
      sealRatio: null
    });
    poolSet.add(code);
  }
  const enriched = { ...pj, enrichedAt: Date.now(), addedN: added.length, pool: pool.concat(added) };
  if (opts.write !== false) fs.writeFileSync(outPath, JSON.stringify(enriched, null, 2));
  return { ok: true, outPath, addedN: added.length, added, enriched };
}

module.exports = { detectMissed, saveMissedReport, mergeMissedIntoPool, MISSED_FILE };

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  const has = k => argv.includes(k);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const day = arg('--day', '');

  if (has('--merge')) {
    const r = mergeMissedIntoPool({ day, write: true });
    if (!r.ok) { console.error('✗', r.error); process.exit(1); }
    console.log(`合并完成：新增 ${r.addedN} 条 K 线派生涨停 → ${r.outPath}`);
    for (const a of r.added) console.log(`  + ${a.code} ${a.name} pct=${a.pct}%`);
  } else {
    const r = saveMissedReport({ day });
    if (!r.ok) { console.error('✗', r.error); process.exit(1); }
    console.log(`漏票报告已保存：${r.saved}`);
    console.log(`poolN=${r.poolN} missed=${r.missed.length} nearMiss=${r.nearMiss.length} aboveLimit=${r.aboveLimit.length}`);
    for (const m of r.missed) console.log(`  漏票 ${m.code} ${m.name} close=${m.close} limitPx=${m.limitPx}`);
  }
}
