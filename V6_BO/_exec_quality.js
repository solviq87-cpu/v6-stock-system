// 执行层测量 · 退出规则精确回测 + 模拟盘实成对照（#264 · ig 轮 2026-10-16）
//
// 为什么有这一个模块（EV 口径的两个没量的缺口）：
//   ① evP3 的「+3% 止盈」是**近似**：跳空高开 >3% 时保守按 +3% 计（其实开盘价更优），
//      且**完全不含止损**——用户原话「不要只看上涨，还要看回落」。本模块用 .kline_cache 的
//      次日 K 线（open/high/low/close 全在）把四条退出规则**精确**回测：
//        R_close 收盘卖（= evClose 口径，对照基准）
//        R_take  +3% 止盈否则收盘（= evP3 口径；⛔ 跳空高开时止盈单开盘即成交，按**开盘价**
//                计——日线给得出 open，比近似口径的保守下界更真，且仍不虚构）
//        R_stop  −3% 止损否则收盘（新增缺口；⛔ 跳空低开穿过止损价时真实成交更差，按**开盘价**
//                计——同样不虚构；盘中触及按 −3% 限价计，标准保守假设）
//        R_both  止盈/止损组合（⛔ 同日双触时按「先止盈」乐观计，双触案例单独计数可见）
//   ② 模拟盘实成盈亏 vs 信号 EV：paper.json 逐笔流水算 round-trip 实成收益率（费后）。
//      ⛔⛔ 成交**没有记触发信号**（只有 reason 文本）→ 无法归因到信号类型，也**不能**把两边
//      当成同一口径比——只并列展示，并留「先记因再归因」的待办。
//
// 口径铁律（与 _ev_daily.js 同源，⛔ 禁第二份）：
//   · live 样本分类用 _ev_daily 的 isLiveSample（注入，不自带判据）
//   · 统计/显著性/充分性用 _ev_daily 的 evOf/withSufficiency（聚类 t 同日信号相关）
//   · 环境分层用 _backtest_nd 的 envLayerOf/normDate
//   · 缺 K 线/缺次日 bar → skipped 计数可见，⛔ 不猜不编不当通过
// 既是独立 CLI（node _exec_quality.js → markdown + exec_quality.json），也是模块。
// 须随包（automation 在云端跑此脚本），登记 _publish.py CODE_FILES。

const fs = require('fs');
const path = require('path');
const { evOf, withSufficiency, isLiveSample, FEE_RT, MIN_N, MIN_DAYS } = require('./_ev_daily.js');
const { envLayerOf, normDate } = require('./_backtest_nd.js');

const TAKE_PCT = 3;      // 止盈线（%）：与 evP3 口径一致，改须同步 _ev_daily 注释
const STOP_PCT = 3;      // 止损线（%）：本模块新增口径

// ── .kline_cache 读取（懒加载 + 进程内缓存；⛔ 读失败返回 null，由调用方记 skipped）──
function klineReader(dir) {
  const cache = new Map();
  return code => {
    if (cache.has(code)) return cache.get(code);
    let k = null;
    try { k = JSON.parse(fs.readFileSync(path.join(dir, code + '.json'), 'utf8')); } catch (e) { k = null; }
    cache.set(code, k);
    return k;
  };
}

// 单条信号的退出规则回测。entry = 信号日收盘价（你能埋伏到的价，与 resolveNextDay 同一口径）。
// 返回 { rule → 收益率% } 或 null（缺 K 线/缺次日 bar，调用方记 skipped）。
function ruleReturns(sig, k) {
  if (!k || !k.rows || !k.rows.length) return null;
  const norm = d => String(d == null ? '' : d).replace(/-/g, '');
  const d0 = norm(sig.date);
  const i = k.rows.findIndex(r => norm(r.date) === d0);
  if (i < 0) return null;
  const base = k.rows[i], nx = k.rows[i + 1];
  if (!nx) return null;                                    // 次日还没走出来
  const entry = base.close;
  if (!entry || entry <= 0) return null;
  const pct = v => +(((v - entry) / entry) * 100).toFixed(3);
  const closeR = pct(nx.close);
  const takeLine = entry * (1 + TAKE_PCT / 100), stopLine = entry * (1 - STOP_PCT / 100);
  // 止盈：跳空高开越过止盈线 → 开盘即成交，按开盘价（日线给得出，不虚构）；
  //       否则盘中最高触及 → 限价 +3%（标准保守假设）
  let takeR;
  if (nx.open >= takeLine) takeR = pct(nx.open);
  else if (nx.high >= takeLine) takeR = TAKE_PCT;
  else takeR = closeR;
  // 止损：跳空低开穿过止损线 → 按开盘价（⛔ 真实成交就是更差，不许美化成 −3%）；
  //       否则盘中最低触及 → 限价 −3%
  let stopR;
  if (nx.open <= stopLine) stopR = pct(nx.open);
  else if (nx.low <= stopLine) stopR = -STOP_PCT;
  else stopR = closeR;
  // 组合：同日双触 → 按先止盈乐观计，doubleTouch 由调用方计数（⛔ 不静默）
  const takeHit = nx.open >= takeLine || nx.high >= takeLine;
  const stopHit = nx.open <= stopLine || nx.low <= stopLine;
  let bothR;
  if (takeHit && stopHit) bothR = takeR;
  else if (takeHit) bothR = takeR;
  else if (stopHit) bothR = stopR;
  else bothR = closeR;
  return { close: closeR, take: takeR, stop: stopR, both: bothR, takeHit, stopHit };
}

// 核心：退出规则 × 分类型 × 分环境（live 口径，复用 _ev_daily 分类器/统计/充分性）
function execBacktest({ signals, breadth, klineDir, fee, minN, minDays, isLive }) {
  const feeRt = typeof fee === 'number' ? fee : FEE_RT;
  const minNUse = typeof minN === 'number' ? minN : MIN_N;
  const minDaysUse = typeof minDays === 'number' ? minDays : MIN_DAYS;
  const liveOk = typeof isLive === 'function' ? isLive : isLiveSample;
  const readK = klineReader(klineDir || path.join(__dirname, '.kline_cache'));
  const RULES = ['close', 'take', 'stop', 'both'];

  const skipped = { void: 0, postHoc: 0, backtest: 0, noKline: 0, noNextBar: 0 };
  const rows = [];   // { type, date, env, r: {close,take,stop,both}, doubleTouch }
  let doubleTouch = 0;
  for (const s of (signals || [])) {
    if (s.void) { skipped.void++; continue; }
    if (s.hist || (s.resolved && s.resolved.mode === '历史回测')) { skipped.backtest++; continue; }
    if (!liveOk(s)) { skipped.postHoc++; continue; }
    const k = readK(s.code);
    if (!k) { skipped.noKline++; continue; }
    const r = ruleReturns(s, k);
    if (!r) { skipped.noNextBar++; continue; }
    if (r.takeHit && r.stopHit) doubleTouch++;
    const b = breadth && breadth[normDate(s.date)];
    rows.push({ type: String(s.type || 'unknown'), date: String(s.date || '?'), env: envLayerOf(b ? b.upRatio : null), r, doubleTouch: r.takeHit && r.stopHit });
  }

  // 规则聚合（evOf 吃 {nd:{nextPct}} 形态 → 造合成 nd；聚类显著性/充分性全部走单一实现）
  const agg = (arr, keyOf) => {
    const groups = {};
    for (const x of arr) { const k = keyOf(x); (groups[k] = groups[k] || []).push(x); }
    const out = {};
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      const st = {};
      for (const rule of RULES) {
        const s0 = evOf(g.map(x => ({ date: x.date, nd: { nextPct: x.r[rule] } })));
        s0.evCloseFee = s0.n ? +(s0.evClose - feeRt).toFixed(3) : null;
        st[rule] = withSufficiency(s0, g.map(x => x.date), minNUse, minDaysUse);
      }
      out[k] = st;
    }
    return out;
  };
  const byRule = agg(rows, () => 'all');
  const byType = agg(rows, x => x.type);
  const byEnv = agg(rows, x => x.env);
  // 执行质量分：组合规则相对收盘规则的增量（pp）。⛔ 样本不足/不显著 → unknown 不出分
  const q = { unknown: true, reason: 'no-sample' };
  const bc = byRule.all && byRule.all.both, cc = byRule.all && byRule.all.close;
  if (bc && cc && bc.n >= minNUse && cc.n >= minNUse) {
    const delta = +(bc.evClose - cc.evClose).toFixed(3);
    q.unknown = false;
    q.deltaPp = delta;                       // >0 = 退出规则比收盘卖多赚（pp）
    q.sigBoth = bc.sig; q.sigClose = cc.sig;
    q.note = bc.sig === 'sig' || cc.sig === 'sig'
      ? '组合规则与收盘规则至少一方聚类显著，增量可作参考'
      : '双方均不显著——增量只是点估计，禁作结论（ig+1 教训）';
  } else if (bc && cc) {
    q.reason = `样本不足（n=${bc.n}，需 ≥${minNUse}）`;
  }
  return { fee: feeRt, minN: minNUse, minDays: minDaysUse, rules: RULES, n: rows.length, byRule, byType, byEnv, doubleTouch, skipped, quality: q };
}

// 模拟盘实成对照：逐账户 round-trip 实成收益率（费后，买卖两边费用都扣）。
// ⛔ 成交没有记触发信号 → 只报实成本身，不与信号 EV 混算（口径不同，并列展示）。
function paperExec(paper) {
  const out = {};
  for (const key of Object.keys(paper || {})) {
    const acc = paper[key];
    if (!acc || !Array.isArray(acc.trades) || !acc.trades.length) { out[key] = { n: 0, unknown: true, reason: 'no-trades' }; continue; }
    // 配对：同 code 的 买→卖（FIFO 简化为按时间顺序配对；⛔ 未配对的不猜）
    const open = {};
    let n = 0, sum = 0, wins = 0;
    const trades = acc.trades.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
    for (const t of trades) {
      if (!t || !t.code) continue;
      const buy = String(t.side || '').indexOf('买') >= 0;
      if (buy) { if (!open[t.code]) open[t.code] = []; open[t.code].push(t); continue; }
      const q2 = open[t.code] && open[t.code].shift();
      if (!q2) continue;                                   // 卖无配对买（持仓继承/数据缺口）→ 不计，不猜
      const cost = (Number(q2.amount) || 0) + (Number(q2.fee) || 0);
      const got = (Number(t.amount) || 0) - (Number(t.fee) || 0);
      if (!(cost > 0)) continue;
      const r = +(((got - cost) / cost) * 100).toFixed(3);
      n++; sum += r; if (r > 0) wins++;
    }
    const left = Object.keys(open).filter(c => open[c].length).length;
    out[key] = n
      ? { n, avg: +(sum / n).toFixed(3), winRate: +(wins / n * 100).toFixed(1), openUnpaired: left, unknown: false,
          note: left ? `⚠️ ${left} 只票有买入未配对（可能仍持仓或流水被裁），未计入` : '' }
      : { n: 0, unknown: true, reason: 'no-paired-roundtrip' };
  }
  return out;
}

// ---- CLI ----
function main() {
  const root = __dirname;
  const st = JSON.parse(fs.readFileSync(path.join(root, 'stats.json'), 'utf8'));
  let breadth = {};
  try { breadth = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8')); } catch (e) {}
  const res = execBacktest({ signals: st.signals || [], breadth });
  let paper = {};
  try { paper = JSON.parse(fs.readFileSync(path.join(root, 'paper.json'), 'utf8')); } catch (e) {}
  res.paper = paperExec(paper);
  fs.writeFileSync(path.join(root, 'exec_quality.json'), JSON.stringify(res, null, 2));

  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + v + '%';
  const sigTxt = c => c.tClu == null ? 'ns(单/双日)' : (Math.abs(c.tClu) >= 2 ? `t=${c.tClu} ✓sig` : `t=${c.tClu} ns`);
  const L = [];
  L.push('# 执行层测量 · 退出规则精确回测 + 模拟盘实成对照（#264）');
  L.push('');
  L.push(`> 样本：可回测 n=${res.n}（跳过：void ${res.skipped.void} / 回测 ${res.skipped.backtest} / 事后登记 ${res.skipped.postHoc} / 缺K线 ${res.skipped.noKline} / 缺次日bar ${res.skipped.noNextBar}）；费用 ${res.fee}% RT；止盈 +${TAKE_PCT}% / 止损 −${STOP_PCT}%。`);
  L.push('> 口径：entry=信号日收盘；止盈跳空高开按开盘价（日线给得出，不虚构）；止损跳空低开按开盘价（⛔ 不美化成 −3%）；同日双触按先止盈乐观计。');
  L.push(`> ⚠️ 同日止盈止损双触 ${res.doubleTouch} 例（乐观计止盈，已单列可见）。`);
  L.push('');
  L.push('## 退出规则对比（总体）');
  L.push('| 规则 | n | 收盘EV | 费后EV | +3%口径EV | 费后+3% | 聚类t |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of res.rules) {
    const c = res.byRule.all[r];
    L.push(`| ${r === 'close' ? '收盘卖(基准)' : r === 'take' ? '+3%止盈' : r === 'stop' ? '−3%止损' : '止盈+止损组合'} | ${c.n} | ${pct(c.evClose)} | ${pct(c.evCloseFee)} | ${pct(c.evP3)} | ${pct(c.evP3Fee)} | ${sigTxt(c)} |`);
  }
  L.push('');
  const q = res.quality;
  L.push(`## 执行质量分：${q.unknown ? `不出分（${q.reason}）` : `组合规则增量 ${q.deltaPp > 0 ? '+' : ''}${q.deltaPp}pp —— ${q.note}`}`);
  L.push('');
  L.push('## 分类型 × 规则（费后收盘EV）');
  L.push('| 类型 | n | 收盘卖 | +3%止盈 | −3%止损 | 组合 |');
  L.push('|---|---|---|---|---|---|');
  for (const t of Object.keys(res.byType).sort((a, b) => res.byType[b].close.n - res.byType[a].close.n)) {
    const c = res.byType[t];
    L.push(`| ${t} | ${c.close.n} | ${pct(c.close.evCloseFee)} | ${pct(c.take.evCloseFee)} | ${pct(c.stop.evCloseFee)} | ${pct(c.both.evCloseFee)} |`);
  }
  L.push('');
  L.push('## 分环境 × 规则（费后收盘EV）');
  L.push('| 环境 | n | 收盘卖 | +3%止盈 | −3%止损 | 组合 |');
  L.push('|---|---|---|---|---|---|');
  for (const e of ['普跌', '退潮', '普涨', '未知']) {
    const c = res.byEnv[e];
    if (!c || !c.close.n) continue;
    L.push(`| ${e} | ${c.close.n} | ${pct(c.close.evCloseFee)} | ${pct(c.take.evCloseFee)} | ${pct(c.stop.evCloseFee)} | ${pct(c.both.evCloseFee)} |`);
  }
  L.push('');
  L.push('## 模拟盘实成对照（费后 round-trip，⛔ 与信号 EV 口径不同，只并列不混算）');
  for (const k of Object.keys(res.paper)) {
    const p = res.paper[k];
    L.push(p.unknown
      ? `- ${k}：无实成样本（${p.reason}）`
      : `- ${k}：${p.n} 笔 round-trip，均值 ${pct(p.avg)}，胜率 ${p.winRate}%${p.note ? ' —— ' + p.note : ''}`);
  }
  L.push('> ⚠️ 待办：成交未记触发信号（只有 reason 文本）→ 无法归因到信号类型；「信号 EV vs 实成 EV」的执行损耗要能算，得先在成交里记 sigType/日期（下一个执行层迭代）。');
  L.push('');
  console.log(L.join('\n'));
  return res;
}

if (require.main === module) main();

module.exports = { execBacktest, ruleReturns, paperExec, klineReader, TAKE_PCT, STOP_PCT };
