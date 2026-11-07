"use strict";
// ============================================================
// 短线速览分析模块（2026-11-02，合并自 a_share_short_term_system）
// 把短线系统的核心洞察并入量化看盘速览页：
//   ① 情绪周期定位（强势股反馈率 → 修复期可做/亢奋期回避/冰点期谨慎）
//   ② 趋势择时（指数20日线）
//   ③ 短线候选股（复用精选池 + 亢奋期高位股回避）
// 数据来源：复用现有 S.ztPool / S.klines + 同花顺直连渠道（实时，免 em 慢链）。
// ============================================================

const https = require('https');

// 同花顺直连（实时渠道，带超时）：历史涨停池，用于强势股反馈率
function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://data.10jqka.com.cn/datacenterph/limitup/limtupInfo.html',
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// 同花顺涨停池（date=YYYYMMDD），返回 [{code, boards}]
async function fetchThsPool(date) {
  const F = '199112,10,9001,330323,330324,330325,133971,133970,1968584,3475914,9002,330329';
  const url = `https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?page=1&limit=200&field=${F}&date=${date}`;
  const d = await httpGetJson(url, 3000);
  if (!d || d.status_code !== 0 || !d.data) return null;
  const info = d.data.info || [];
  return info.map(it => ({ code: it.code, name: it.name }));
}

// 新浪日K（实时渠道，带超时）：用于趋势择时（指数20日线）
async function fetchSinaKline(symbol, count = 30) {
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${count}`;
  const d = await httpGetJson(url, 3000);
  if (!Array.isArray(d) || !d.length) return null;
  return d.map(it => ({ close: parseFloat(it.close) }));
}

/**
 * 计算强势股正反馈率：昨日涨停股中今日仍涨停的比例（真实赚钱效应）。
 * @param {Array} todayPool 今日涨停池
 * @param {Array} yesterdayPool 昨日涨停池
 * @returns {number|null} 0~1，判不出返回 null（不硬判）
 */
function strongPositiveRate(todayPool, yesterdayPool) {
  if (!Array.isArray(todayPool) || !Array.isArray(yesterdayPool)) return null;
  if (!yesterdayPool.length) return null;
  const todayCodes = new Set(todayPool.map(z => z.code));
  let positive = 0;
  for (const z of yesterdayPool) {
    if (todayCodes.has(z.code)) positive++;
  }
  return positive / yesterdayPool.length;
}

/**
 * 情绪周期定位（120天回测验证：修复期次日55%涨/亢奋期42%涨）。
 * @param {number|null} sp 强势股正反馈率
 * @param {number} limitDown 今日跌停数
 */
function sentimentCycle(sp, limitDown) {
  if (sp == null) {
    if (limitDown >= 20) return { stage: "冰点/退潮", advice: "谨慎", tone: "bad" };
    return { stage: "震荡/观察", advice: "观察", tone: "warn" };
  }
  if (sp >= 0.25) return { stage: "亢奋期", advice: "回避/减仓（追高风险大）", tone: "bad" };
  if (sp >= 0.10) return { stage: "修复期", advice: "可做（赚钱效应温和恢复）", tone: "good" };
  return { stage: "冰点期", advice: "谨慎（赚钱效应弱）", tone: "warn" };
}

/**
 * 趋势择时：指数是否站上20日线（弱择时，回测验证最优的市场过滤器）。
 * @param {Array} idxKlines 指数日K线（升序）
 */
function trendTiming(idxKlines) {
  if (!Array.isArray(idxKlines) || idxKlines.length < 21) return { pass: null, note: "指数数据不足" };
  const closes = idxKlines.map(k => k.close);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const last = closes[closes.length - 1];
  return {
    pass: last > ma20,
    last, ma20: +ma20.toFixed(2),
    note: last > ma20 ? "指数站上20日线" : "指数在20日线下方（弱势）",
  };
}

/**
 * 短线候选股：复用精选池，叠加亢奋期高位股回避。
 * @param {Object} S 全局状态
 * @param {string} stage 情绪周期阶段
 */
function shortlineCandidates(S, stage) {
  // 优先精选池 candidatePool，其次当日预选 preselect.items
  let pool = [];
  if (Array.isArray(S.candidatePool) && S.candidatePool.length) {
    pool = S.candidatePool;
  } else if (S.preselect && Array.isArray(S.preselect.items)) {
    pool = S.preselect.items;
  } else if (Array.isArray(S.preselect)) {
    pool = S.preselect;
  }
  // 字段适配（code/name/score/pct/prob 等）
  let items = pool.map(s => ({
    code: s.code,
    name: s.name,
    score: s.score != null ? s.score : (s.prob != null ? s.prob : null),
    pct: s.pct,
    sector: s.sector || s.industry || "",
    reason: s.reason || s.why || "",
    boards: s.boards || s.lianban || 0,
  }));
  // 亢奋期：剔除高位股（近10日涨幅过大/连板≥3），不在情绪顶部接盘
  if (stage === "亢奋期") {
    items = items.filter(s => {
      const lb = s.boards || s.lianban || 0;
      return lb < 3; // 高连板在亢奋期回避
    });
  }
  return items.slice(0, 10);
}

/**
 * 主入口：生成短线速览数据。
 * @param {Object} S 全局状态
 * @param {Object} em 数据源模块
 */
// 超时控制：云端数据源慢/挂时强制降级，保证接口秒回（实时接口要求）
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function analyzeShortline(S, em) {
  // 1. 强势股反馈率：今日池 S.ztPool（内存）+ 昨日池同花顺直连（实时渠道，带超时）
  let sp = null;
  try {
    const todayPool = S.ztPool || [];
    const today = S.ztDay || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const _fetchPrev = (async () => {
      for (let d = 1; d <= 4; d++) {
        const dt = new Date();
        dt.setDate(dt.getDate() - d);
        const ymd = dt.toISOString().slice(0, 10).replace(/-/g, "");
        if (ymd === today) continue;
        const pool = await fetchThsPool(ymd);
        if (Array.isArray(pool) && pool.length) return pool;
      }
      return null;
    })();
    const yesterdayPool = await withTimeout(_fetchPrev, 3500, null);
    sp = strongPositiveRate(todayPool, yesterdayPool);
  } catch (e) { sp = null; }

  // 2. 情绪周期
  const limitDown = (S.mktStats && S.mktStats.limitDown) || 0;
  const cycle = sentimentCycle(sp, limitDown);

  // 3. 趋势择时：新浪日K直连（实时渠道，带超时），失败降级判不出
  let timing = { pass: null, note: "判不出" };
  try {
    const rows = await withTimeout(fetchSinaKline("sh000001", 30), 3500, null);
    if (rows && rows.length >= 21) timing = trendTiming(rows);
  } catch (e) { /* 判不出 */ }

  // 4. 短线候选股
  const candidates = shortlineCandidates(S, cycle.stage);

  return {
    strongPositiveRate: sp,
    cycle,
    timing,
    candidates,
    generatedAt: Date.now(),
  };
}

module.exports = { analyzeShortline, strongPositiveRate, sentimentCycle, trendTiming, fetchThsPool, fetchSinaKline };
