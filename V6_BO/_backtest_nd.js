// 每日回测 · 三类信号 nd 命中率 + 三层市场环境分层 lift
//
// 用途：把「每日回测 automation（21:05）」里原本靠人工在报告里写散文的分层归因，
// 变成**确定性的、可复跑、可守门**的计算。口径铁律（见项目记忆 §3 / automation 提示 ①）：
//   ⛔ 只按 sig.nd（信号日收盘 → 次日最高/收盘）统计，绝不用 s.resolved（一进二 resolved.hit 恒 false，曾造 0/27 误读）。
//   ⛔ 三层市场环境用 breadth.json 的 upRatio（涨跌比）分层：普跌 <40 / 退潮 40~52 / 普涨 >52；
//      breadth 缺失 → 「未知」层（只计入总体、不进分层，避免伪造环境）。
//   ⛔ lift 用全A 基线（learnall.json n=441952）：次日涨停 2.94%、次日 +3% 12.8%，单位 pp（百分点），不静默。
//
// 既是独立 CLI（node _backtest_nd.js → 打印 markdown + 写 backtest_nd.json），也是模块（module.exports.backtest 供守门真跑）。
// 版本与发布无关（分析脚本，不进 server.js），但须随包（automation 在云端跑此脚本），故登记 _publish.py CODE_FILES。

const fs = require('fs');
const path = require('path');

const CLASSES = ['auczt', 'yier', 'lianban'];
const LAYERS = ['普跌', '退潮', '普涨'];
const BASE = { limitUp: 2.94, up3: 12.8 }; // 全A 次日基线（涨停率 / +3%率），单位 %

// 日期归一：stats.json 的 s.date 是 YYYYMMDD，breadth.json 键是 YYYY-MM-DD
function normDate(d) {
  if (!d) return d;
  if (typeof d === 'string' && /^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

// 涨跌比 → 环境层（守门会钉阈值语义，改阈值须同步改守门）
function envLayerOf(upRatio) {
  if (upRatio == null || Number.isNaN(upRatio)) return '未知';
  if (upRatio < 40) return '普跌';
  if (upRatio > 52) return '普涨';
  return '退潮';
}

// 一批信号的 nd 统计（只统计 nextPct 为有限数的，缺 nd 的标待回填由调用方处理）
// B2 轮（2026-10-17）：加 oneLine / oneLineUp3 —— 次日一字板（开盘即涨停·全天无波动→买不进）
//   单列。持仓者开盘即可兑现，但信号若意在次日买入则根本买不进；把它混进普通命中，
//   「一进二/连板命中率」会被一批买不进的票垫高（与 hx 轮 isPostHocSample 同精神）。
//   ⛔ oneLine 为 null（缺 OHLC，没有数据）不计入 —— 没有数据 ≠ 不是一字板。
function ndStats(arr) {
  const n = arr.length;
  if (!n) return { n: 0, limitUp: 0, up3: 0, max5: 0, up: 0, avg: 0, pending: 0, oneLine: 0, oneLineUp3: 0 };
  let lu = 0, u3 = 0, m5 = 0, up = 0, sum = 0, pending = 0, ol = 0, olU3 = 0;
  for (const s of arr) {
    const nd = s.nd || {};
    if (nd.limitUp) lu++;
    if (typeof nd.nextPct === 'number') {
      if (nd.nextPct >= 3) u3++;
      if (nd.nextPct > 0) up++;
      sum += nd.nextPct;
    } else {
      pending++; // nd 未回填（次交易日尚未收盘）
    }
    if (typeof nd.maxGain === 'number' && nd.maxGain >= 5) m5++;
    if (nd.oneLine === true) {
      ol++;
      if (typeof nd.nextPct === 'number' && nd.nextPct >= 3) olU3++;
    }
  }
  return {
    n,
    limitUp: +(lu / n * 100).toFixed(1),
    up3: +(u3 / n * 100).toFixed(1),
    max5: +(m5 / n * 100).toFixed(1),
    up: +(up / n * 100).toFixed(1),
    avg: +(sum / n).toFixed(2),
    pending,
    oneLine: ol,
    oneLineUp3: olU3,
  };
}

// auczt 当日口径统计（resolved.limitUp，与 nd 口径并列展示，避免决策口径错配）
function resolvedStats(arr) {
  const n = arr.length;
  if (!n) return { n: 0, limitUp: 0 };
  let lu = 0;
  for (const s of arr) {
    if (s.resolved && s.resolved.limitUp) lu++;
  }
  return { n, limitUp: +(lu / n * 100).toFixed(1) };
}

// 核心：三类 ×（总体 + 三层环境分层）+ 最近趋势
function backtest({ signals, breadth, base }) {
  base = base || BASE;
  const out = {};
  for (const c of CLASSES) {
    const cls = (signals || []).filter(s => s.type === c);
    // ⛔ void=作废信号（节假日误报/数据异常），服务器 resolveNextDay 本来就跳过、永远不会有 nd——
    //    不计入"待回填"，否则 10-01~10-07 假期票会把待回填数永久垫高（实测 auczt 243 条待回填里 53 条是 void）。
    const live = cls.filter(s => !s.void);
    const filled = live.filter(s => s.nd && typeof s.nd.nextPct === 'number');
    const pending = live.length - filled.length;
    const overall = ndStats(filled);
    overall.pending = pending;
    overall.void = cls.length - live.length;   // 作废条数单列，报告里可见（不静默丢弃）

    // 按信号日环境分层
    const layers = { '普跌': [], '退潮': [], '普涨': [], '未知': [] };
    for (const s of filled) {
      const b = breadth && breadth[normDate(s.date)];
      layers[envLayerOf(b ? b.upRatio : null)].push(s);
    }
    const layered = {};
    for (const L of LAYERS) {
      const st = ndStats(layers[L]);
      st.lift3 = +(st.up3 - base.up3).toFixed(1);     // +3% 相对全A 的 lift（pp）
      st.liftLimit = +(st.limitUp - base.limitUp).toFixed(1);
      layered[L] = st;
    }

    // ⛔ iq 轮（2026-10-19）：auczt 预测的是当日封板，与 yier/lianban 的次日口径不同。
    //   每日回测并列展示「当日封板率（resolved）」和「次日+3%（nd）」，避免读报告时口径错配。
    let resolvedOverall = null, resolvedLayered = null;
    if (c === 'auczt') {
      const rFilled = live.filter(s => s.resolved);
      resolvedOverall = resolvedStats(rFilled);
      resolvedLayered = {};
      for (const L of LAYERS) {
        const rArr = layers[L].filter(s => s.resolved);
        resolvedLayered[L] = resolvedStats(rArr);
      }
    }

    // 最近 10 个信号日趋势（含待回填标注；void 作废票不进趋势，同 live 口径）
    const byDate = {};
    for (const s of live) (byDate[s.date] = byDate[s.date] || []).push(s);
    const dates = Object.keys(byDate).sort();
    const trend = dates.slice(-10).map(d => {
      const arr = byDate[d];
      const ok = arr.filter(s => s.nd && typeof s.nd.nextPct === 'number');
      const u3 = ok.filter(s => s.nd.nextPct >= 3).length;
      const rOk = arr.filter(s => s.resolved);
      const rLu = rOk.filter(s => s.resolved.limitUp).length;
      const b = breadth && breadth[normDate(d)];
      return {
        date: d,
        n: arr.length,
        up3: ok.length ? +(u3 / ok.length * 100).toFixed(1) : null,
        dUp: rOk.length ? +(rLu / rOk.length * 100).toFixed(1) : null, // 当日封板率
        env: envLayerOf(b ? b.upRatio : null),
        pending: arr.length - ok.length,
      };
    });

    out[c] = { overall, layered, trend, nUnknown: layers['未知'].length, resolvedOverall, resolvedLayered };
  }
  return out;
}

// ---- CLI ----
function main() {
  const root = __dirname;
  const st = JSON.parse(fs.readFileSync(path.join(root, 'stats.json'), 'utf8'));
  let breadth = {};
  try { breadth = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8')); } catch (e) {}
  const res = backtest({ signals: st.signals || [], breadth });

  // 写 JSON 产物
  fs.writeFileSync(path.join(root, 'backtest_nd.json'), JSON.stringify(res, null, 2));

  // 打印 markdown
  const lines = [];
  lines.push('# 每日回测 · 三类 nd 命中率 + 三层环境分层 lift');
  lines.push('');
  lines.push('> 口径：yier/lianban 仅 sig.nd（次日口径）；auczt 预测当日封板，额外并列「当日封板率（resolved）」。环境层按 breadth upRatio 分（普跌<40 / 退潮40~52 / 普涨>52）；lift 基线 涨停2.94% / +3% 12.8%。');
  lines.push('> 次日一字板（开盘即涨停·全天无波动）单列：持仓者开盘即可兑现，但意在次日买入则买不进，解读命中率时须与普通命中分开（B2 轮 nd.oneLine）。');
  lines.push('');
  for (const c of CLASSES) {
    const o = res[c];
    const name = c === 'auczt' ? '竞价 auczt' : c === 'yier' ? '一进二 yier' : '二进三 lianban';
    lines.push(`## ${name}（n=${o.overall.n}，待回填 ${o.overall.pending}${o.overall.void ? '，作废 ' + o.overall.void : ''}）`);
    lines.push('');
    // auczt 两口径并列表头
    if (c === 'auczt' && o.resolvedOverall) {
      lines.push('| 环境层 | 样本 | 当日封板(resolved) | 次日涨停 | 次日+3% | +3% lift | 次日最高≥5% | 次日收涨 | 均涨幅 |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      const ro = o.resolvedOverall;
      lines.push(`| 总体 | ${o.overall.n} | ${ro.limitUp}% | ${o.overall.limitUp}% | ${o.overall.up3}% | ${(o.overall.up3 - BASE.up3).toFixed(1)}pp | ${o.overall.max5}% | ${o.overall.up}% | ${o.overall.avg}% |`);
      for (const L of LAYERS) {
        const s = o.layered[L];
        const rs = o.resolvedLayered && o.resolvedLayered[L];
        const dash = s.n === 0 ? '—' : '';
        lines.push(`| ${L} | ${s.n} | ${dash || (rs && rs.limitUp + '%')} | ${dash || s.limitUp + '%'} | ${dash || s.up3 + '%'} | ${dash || (s.lift3 > 0 ? '+' : '') + s.lift3 + 'pp'} | ${dash || s.max5 + '%'} | ${dash || s.up + '%'} | ${dash || s.avg + '%'} |`);
      }
    } else {
      lines.push('| 环境层 | 样本 | 次日涨停 | 次日+3% | +3% lift | 次日最高≥5% | 次日收涨 | 均涨幅 |');
      lines.push('|---|---|---|---|---|---|---|---|');
      lines.push(`| 总体 | ${o.overall.n} | ${o.overall.limitUp}% | ${o.overall.up3}% | ${(o.overall.up3 - BASE.up3).toFixed(1)}pp | ${o.overall.max5}% | ${o.overall.up}% | ${o.overall.avg}% |`);
      for (const L of LAYERS) {
        const s = o.layered[L];
        const dash = s.n === 0 ? '—' : '';
        lines.push(`| ${L} | ${s.n} | ${dash || s.limitUp + '%'} | ${dash || s.up3 + '%'} | ${dash || (s.lift3 > 0 ? '+' : '') + s.lift3 + 'pp'} | ${dash || s.max5 + '%'} | ${dash || s.up + '%'} | ${dash || s.avg + '%'} |`);
      }
    }
    if (o.nUnknown) lines.push(`| 未知(无宽度) | ${o.nUnknown} | — | — | — | — | — | — |`);
    lines.push('');
    if (o.overall.oneLine) lines.push(`> ⚠️ 其中次日一字板 ${o.overall.oneLine} 条（占 ${(o.overall.oneLine / o.overall.n * 100).toFixed(1)}%），${o.overall.oneLineUp3} 条还计入了上方「次日+3%」—— 那部分是开盘一字板，次日买入者买不进。`);
    lines.push('');
    lines.push('**最近 10 信号日趋势（次日 +3% 率）**：');
    const trendBlock = o.trend.map(t => `${t.date} n=${t.n} +3%=${t.up3 == null ? '?' : t.up3 + '%'}${t.dUp != null ? ' 当日封板=' + t.dUp + '%' : ''} [${t.env}]${t.pending ? ' 待回填' + t.pending : ''}`).join('\n');
    lines.push('```');
    lines.push(trendBlock);
    lines.push('```');
    lines.push('');
  }
  // 归因一句话
  const a = res.auczt;
  const bull = a.layered['普涨'], bear = a.layered['普跌'];
  lines.push('## 归因速读');
  if (bull.n === 0 && bear.n === 0) {
    lines.push('- 分层样本不足（信号日缺 breadth 宽度记录）→ 暂无法做环境分层归因；需先补齐历史宽度回填。');
  } else {
    lines.push(`- auczt 普涨日(n=${bull.n}) +3% lift = ${bull.lift3 > 0 ? '+' : ''}${bull.lift3}pp、普跌日(n=${bear.n}) = ${bear.lift3 > 0 ? '+' : ''}${bear.lift3}pp → 若普涨日 lift 也转负/接近0，则退化主因是选股而非环境；若仅普跌日差而普涨日仍强，则属正常环境敏感。`);
  }
  console.log(lines.join('\n'));
  return res;
}

if (require.main === module) main();

module.exports = { backtest, ndStats, envLayerOf, normDate, CLASSES, LAYERS, BASE };
