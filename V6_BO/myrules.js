'use strict';
// 用户的「十四条」选股体系 myrules.js
// 用户原话（2026-10-01）：「我要的从来都不是票，是你能否提前发现那些能涨停、
//   而且我买了以后会盈利、同时还能规避风险」，随后给出自己的 14 条条件。
//
// 设计原则（与 nextplan.js 同一套）：
//   1) 每条单独判，输出实际数值 + 计算式。算不出的一律标 unknown，**绝不能当成"不满足"**——
//      把"没数据"显示成"不符合条件"，会让人平白错过一只票（这个坑项目里踩过不止一次）。
//   2) 排除项与加分项分开：第⑪条是"不要"，命中直接出局；其余是"符合加分"。
//   3) 阈值全部可配置（cfg），你的尺子你自己能调。
//
// 数据可得性（2026-10-01 逐条 curl 实测，不是猜的）：
//   可算：① ② ③ ④ ⑤ ⑥ ⑧ ⑨ ⑩ ⑪ ⑬
//   ⑫ 已接入：东财龙虎榜（RPT_BILLBOARD_DAILYDETAILSBUY）。
//      判据 = 知名席位名录 × 净买额 × 该席位3日上涨概率，三者都写出来可核对。
//      ⚠️ 龙虎榜收盘后才出，盘中只能看到上一交易日的榜 → 用于次日作战，不用于当日实时。
//   ⑦⑭ 已接入：东财竞价分时 trends2/get?iscr=1（2026-10-09 实测可取 09:15–09:25 每分钟价/量；
//      成交额恒为 0，但价与量(手)每分钟都有 → ⑦用「每分钟价 vs 昨收」近似红绿柱、⑭用尾盘价上翘+量放大）。
//      取数失败时（东财限流）auctionTicksFor 不缓存 → ⑦⑭ 退化为 unknown，绝不算成"不符合"。

const A = require('./analysis.js');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n1 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(1));
const n2 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(2));
const yi = v => {
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return String(Math.round(v));
};

function maOf(rows, n, key) {
  if (!rows || rows.length < n) return null;
  let s = 0;
  for (let i = rows.length - n; i < rows.length; i++) s += +(rows[i][key || 'close'] || 0);
  return s / n;
}
// 近 n 日平均成交量（不含最后一根）
function avgVol(rows, n, skipLast) {
  const end = rows.length - (skipLast ? 1 : 0);
  const st = Math.max(0, end - n);
  let s = 0, c = 0;
  for (let i = st; i < end; i++) { s += +(rows[i].volume || 0); c++; }
  return c ? s / c : null;
}
// 简单线性回归斜率与拟合度（判断"上升通道"用）
function linreg(ys) {
  const n = ys.length;
  if (n < 5) return { slope: null, r2: null };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; syy += ys[i] * ys[i]; }
  const den = n * sxx - sx * sx;
  if (!den) return { slope: null, r2: null };
  const slope = (n * sxy - sx * sy) / den;
  const icpt = (sy - slope * sx) / n;
  let ss = 0, sr = 0;
  const my = sy / n;
  for (let i = 0; i < n; i++) { const p = slope * i + icpt; sr += (ys[i] - p) * (ys[i] - p); ss += (ys[i] - my) * (ys[i] - my); }
  return { slope, r2: ss > 0 ? 1 - sr / ss : null };
}

// ── 单条判定：统一返回 {ok:true/false, unknown:true, val, note} ───────────
const R = (ok, val, note) => ({ ok: !!ok, val, note });
const U = note => ({ ok: false, unknown: true, val: null, note });

function check(o, cfg) {
  const { stock, rows, sector, auction, profitRatio } = o;
  const out = [];
  const push = (i, name, r) => out.push({ i, name, ...r });

  // ① 流通市值 50~100 亿（打板最舒服的盘子：太小容易被砸、太大拉不动）
  {
    const lo = cfg.capLo, hi = cfg.capHi;
    const cap = stock.floatCap > 0 ? +(stock.floatCap / 1e8).toFixed(1) : null;
    push(1, '流通市值50-100亿', cap == null ? U('缺流通市值数据')
      : R(cap >= lo && cap <= hi, cap, `流通市值 ${cap}亿${cap >= lo && cap <= hi ? '' : `（不在 ${lo}~${hi}亿区间）`}`));
  }
  // ② 股价 < 40 元
  {
    const p = stock.price;
    push(2, '股价<40元', p == null ? U('缺现价')
      : R(p < cfg.priceMax, p, `现价 ${p}元`));
  }
  // ③ 均线多头排列 / 粘合后突破 / 上升通道（三选一即算符合）
  {
    if (!rows || rows.length < 60) { push(3, '均线多头/粘合突破/上升通道', U('K线不足60根')); }
    else {
      const c = +rows[rows.length - 1].close;
      const m5 = maOf(rows, 5), m10 = maOf(rows, 10), m20 = maOf(rows, 20), m60 = maOf(rows, 60);
      const bull = m5 > m10 && m10 > m20 && m20 > m60;
      const mx = Math.max(m5, m10, m20), mn = Math.min(m5, m10, m20);
      const spread = mn > 0 ? (mx - mn) / mn * 100 : null;
      const glueBreak = spread != null && spread < cfg.glueSpread && c > mx;
      const lr = linreg(rows.slice(-20).map(r => +r.close || 0));
      const channel = lr.slope != null && lr.slope > 0 && lr.r2 != null && lr.r2 >= cfg.channelR2;
      const ok = bull || glueBreak || channel;
      const why = [bull ? '多头排列' : null, glueBreak ? `粘合突破(均线离散${n1(spread)}%)` : null, channel ? `上升通道(R²${n2(lr.r2)})` : null].filter(Boolean);
      push(3, '均线多头/粘合突破/上升通道', R(ok, ok ? why.join('+') : `离散${n1(spread)}%·R²${n2(lr.r2)}`, ok ? why.join(' + ') : '三者都不满足'));
    }
  }
  // ④ 涨停基因（近 N 日有涨停）+ 堆量（近5日均量 ≥ 前20日 × 倍数）
  {
    if (!rows || rows.length < 25) { push(4, '涨停基因+堆量', U('K线不足')); }
    else {
      const days = rows.slice(-cfg.geneDays);
      const ztN = days.filter(r => A.isLimitUp(stock.code, stock.name, +r.pct || 0)).length;
      const v5 = avgVol(rows, 5, true), v20 = avgVol(rows, 20, true);
      const pile = v5 != null && v20 != null && v20 > 0 ? v5 / v20 : null;
      const ok = ztN > 0 && pile != null && pile >= cfg.pileRatio;
      push(4, '涨停基因+堆量', R(ok, { ztN, pile: n2(pile) },
        `近${cfg.geneDays}日涨停 ${ztN} 次 · 5日均量/20日均量 = ${n2(pile)}${pile != null && pile >= cfg.pileRatio ? '（堆量）' : ''}`));
    }
  }
  // ⑤ 热点题材与板块效应
  {
    if (!sector) { push(5, '热点题材板块效应', U('未匹配到板块')); }
    else {
      const zt = +(sector.ztCount || 0), sp = +(sector.pct || 0);
      const ok = zt >= cfg.secZtMin || sp >= cfg.secPctMin;
      push(5, '热点题材板块效应', R(ok, { zt, sp }, `【${sector.name}】涨停 ${zt} 只 · 板块涨 ${n1(sp)}%`));
    }
  }
  // ⑥ 集合竞价换手率 0.6~1.5%、涨幅 3~6%
  {
    const aa = auction && auction.auctionAmount, ap = auction && auction.auctionPct;
    const cap = stock.floatCap > 0 ? stock.floatCap : null;
    if (aa == null && ap == null) { push(6, '竞价换手0.6-1.5%·涨幅3-6%', U('无竞价数据（非竞价时段）')); }
    else {
      // 竞价换手 = 竞价成交额 / 流通市值（与"竞价量/流通股"等价，用金额口径更好取）
      const to = (aa != null && cap) ? aa / cap * 100 : null;
      const toOk = to != null && to >= cfg.aucTurnLo && to <= cfg.aucTurnHi;
      const pcOk = ap != null && ap >= cfg.aucPctLo && ap <= cfg.aucPctHi;
      push(6, '竞价换手0.6-1.5%·涨幅3-6%', R(toOk && pcOk, { to: n2(to), ap },
        `竞价换手 ${to == null ? '-' : n2(to) + '%'} · 竞价涨幅 ${ap == null ? '-' : n1(ap) + '%'}`));
    }
  }
  // ⑦ 竞价红柱多绿柱少 —— 红绿柱用「每分钟竞价价 vs 昨收」近似（东财竞价段无主动买卖方向）
  {
    const tk = o.aucTicks;
    if (!tk || !tk.bars || !tk.bars.length) push(7, '竞价红柱多绿柱少', U('缺竞价分时数据（盘中未取到集合竞价分时）'));
    else {
      const pre = (stock.preClose && stock.preClose > 0 ? stock.preClose : null) || tk.preClose;
      let red = 0, green = 0, flat = 0;
      for (const b of tk.bars) {
        if (pre == null) { flat++; continue; }
        if (b.price > pre + 1e-6) red++;
        else if (b.price < pre - 1e-6) green++;
        else flat++;
      }
      const ok = red > green;
      push(7, '竞价红柱多绿柱少', R(ok, { red, green, flat }, `红柱 ${red} · 绿柱 ${green}${flat ? ` · 平 ${flat}` : ''}（红>绿 ${ok ? '✓' : '✗'}）`));
    }
  }
  // ⑧ 竞流比>200 · 封流比>3 · 封成比>1 · 竞昨比>8
  {
    const aa = auction && auction.auctionAmount;
    const cap = stock.floatCap > 0 ? stock.floatCap : null;
    const seal = stock.sealAmount, amt = stock.amount;
    const prevAmt = rows && rows.length >= 2 ? +rows[rows.length - 2].amount || +rows[rows.length - 2].volume || null : null;
    // ⚠️ 这四个"比"在市面上口径不统一，这里把计算式原样写在 note 里，方便你自己核对；
    //    发现口径不同就改 cfg 里的阈值，不用改代码。
    const jingliu = (aa != null && cap) ? aa / cap * 10000 : null;         // ‱（万分之一）
    const fengliu = (seal != null && cap) ? seal / cap * 100 : null;       // %
    const fengcheng = (seal != null && amt) ? seal / amt : null;           // 倍
    const jingzuo = (aa != null && prevAmt) ? aa / prevAmt * 100 : null;   // %
    const v = { 竞流比: jingliu == null ? '-' : n1(jingliu), 封流比: fengliu == null ? '-' : n1(fengliu) + '%', 封成比: fengcheng == null ? '-' : n2(fengcheng), 竞昨比: jingzuo == null ? '-' : n1(jingzuo) + '%' };
    const got = [jingliu, fengliu, fengcheng, jingzuo].filter(x => x != null).length;
    if (!got) { push(8, '竞流比/封流比/封成比/竞昨比', U('缺竞价或封单数据')); }
    else {
      const ok = (jingliu == null || jingliu > cfg.jingliu)
        && (fengliu == null || fengliu > cfg.fengliu)
        && (fengcheng == null || fengcheng > cfg.fengcheng)
        && (jingzuo == null || jingzuo > cfg.jingzuo);
      push(8, '竞流比/封流比/封成比/竞昨比', R(ok, v,
        `竞流比 ${v.竞流比}(>${cfg.jingliu}) 封流比 ${v.封流比}(>${cfg.fengliu}%) 封成比 ${v.封成比}(>${cfg.fengcheng}) 竞昨比 ${v.竞昨比}(>${cfg.jingzuo}%)`));
    }
  }
  // ⑨ 首板 · 上板时间早 · 分时流畅 · 封单大
  {
    const lb = stock.limitUpCount || 0;
    const brk = stock.breakCount;
    const sealR = (stock.sealAmount != null && stock.amount) ? stock.sealAmount / stock.amount : null;
    // ⚠️ "上板时间早/分时流畅"要分时数据，这里用【全天未开板】+【封单/成交额】作近似，
    //    并在 note 里写明是近似，不装作精确判定。
    const hard = brk === 0;
    const bigSeal = sealR != null && sealR >= cfg.sealRatio;
    const ok = lb <= 1 && hard && bigSeal;
    push(9, '首板·硬板·封单大', R(ok, { lb, brk, sealR: n2(sealR) },
      `${lb <= 1 ? '首板' : lb + '连板'} · ${brk == null ? '开板未知' : (brk === 0 ? '全天未开板（近似"上板早且流畅"）' : `开板${brk}次`)} · 封单/成交 ${sealR == null ? '-' : n2(sealR)}`));
  }
  // ⑩ 筹码密集区向上突破 / 低位筹码锁定
  {
    if (!rows || rows.length < 25) { push(10, '筹码密集突破/锁仓', U('K线不足')); }
    else {
      const c = +rows[rows.length - 1].close;
      const prev20 = rows.slice(-21, -1);
      const hi = prev20.length ? Math.max(...prev20.map(r => +r.high || 0)) : null;
      const breakout = hi != null && c > hi;
      // 兼容两种口径：analysis.calcProfitRatio 返回 0~1，外部若直接给百分比(0~100)也能吃
      const pr = profitRatio != null ? (profitRatio <= 1 ? profitRatio * 100 : profitRatio) : null;
      // 低位筹码锁定：获利盘不高（抛压未释放）但已突破 → 典型启动形态
      const locked = pr != null && pr <= cfg.profitMax && breakout;
      push(10, '筹码密集突破/锁仓', R(breakout && (locked || pr == null), { breakout, pr: pr == null ? '-' : n1(pr) },
        `突破20日高点 ${breakout ? '是' : '否'} · 获利盘 ${pr == null ? '缺筹码数据' : n1(pr) + '%'}${pr == null ? '（按突破单判）' : ''}`));
    }
  }
  // ⑪ 排除项：近期 4 连板以上不要
  {
    const lb = stock.limitUpCount || 0;
    push(11, '排除4连板以上', R(lb < cfg.maxLianBan, lb, lb >= cfg.maxLianBan ? `${lb}连板，超过上限 ${cfg.maxLianBan - 1} 板 → 出局` : `${lb}板，未超限`));
  }
  // ⑫ 有大游资介入并跟随 —— 东财龙虎榜席位（2026-10-01 接入）
  //    ⚠️ 龙虎榜是【收盘后】才公布的数据，盘中拿不到当天 → 它代表"上一交易日上榜的席位"。
  //       用于次日作战计划是合适的；拿它给当日盘中推送做判据就是拿昨天的账算今天的命。
  {
    const l = o.lhb;
    if (!l) push(12, '大游资介入', U('缺龙虎榜数据（该股当日未上榜，或榜单尚未公布）'));
    else if (l.whale) push(12, '大游资介入', R(true, l.whaleNet, l.why));
    else push(12, '大游资介入', R(false, l.netBuy, l.why));
  }
  // ⑬ 倍量过左峰
  {
    if (!rows || rows.length < 25) { push(13, '倍量过左峰', U('K线不足')); }
    else {
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      const vr = prev && +prev.volume > 0 ? (+last.volume || 0) / (+prev.volume) : null;
      const hi60 = Math.max(...rows.slice(-61, -1).map(r => +r.high || 0));
      const over = +last.close > hi60;
      push(13, '倍量过左峰', R(vr != null && vr >= cfg.volRatio && over, n2(vr),
        `量比昨日 ${n2(vr)}倍（需≥${cfg.volRatio}） · 突破60日高点 ${over ? '是' : '否'}`));
    }
  }
  // ⑭ 竞价尾盘抢筹上翘：09:23–09:25 价格相对 09:15–09:22 上翘且放量（东财竞价段量在，故可判）
  {
    const tk = o.aucTicks;
    if (!tk || !tk.bars || tk.bars.length < 3) push(14, '竞价尾盘抢筹上翘', U('缺竞价分时数据（盘中未取到集合竞价分时）'));
    else {
      const early = tk.bars.filter(b => b.t <= '09:22');
      const late = tk.bars.filter(b => b.t >= '09:23');
      const avg = arr => arr.length ? arr.reduce((s, b) => s + b.price, 0) / arr.length : null;
      const sum = arr => arr.reduce((s, b) => s + (b.vol || 0), 0);
      const ea = avg(early), la = avg(late);
      const ev = sum(early), lv = sum(late);
      const upPct = (ea && ea > 0) ? (la - ea) / ea * 100 : null;
      const volMul = ev > 0 ? lv / ev : (lv > 0 ? 99 : 0);
      const ok = upPct != null && upPct >= 0.3 && volMul >= 1.2;
      push(14, '竞价尾盘抢筹上翘', R(ok, { upPct: n1(upPct), volMul: n1(volMul) },
        `尾盘价 ${upPct == null ? '-' : (upPct >= 0 ? '+' : '') + n1(upPct) + '%'} · 尾量/前量 ${n1(volMul)}×${ok ? ' ✓' : ' ✗'}`));
    }
  }
  return out;
}

const DEFAULTS = {
  capLo: 50, capHi: 100,           // ① 流通市值（亿）
  priceMax: 40,                    // ② 股价上限
  glueSpread: 5, channelR2: 0.6,   // ③ 均线粘合离散度(%) / 上升通道拟合度
  geneDays: 40, pileRatio: 1.5,    // ④ 涨停基因回溯天数 / 堆量倍数
  secZtMin: 2, secPctMin: 1.5,     // ⑤ 板块涨停数 / 板块涨幅
  aucTurnLo: 0.6, aucTurnHi: 1.5,  // ⑥ 竞价换手%
  aucPctLo: 3, aucPctHi: 6,        // ⑥ 竞价涨幅%
  jingliu: 200, fengliu: 3, fengcheng: 1, jingzuo: 8,  // ⑧ 四个比
  sealRatio: 0.3,                  // ⑨ 封单/成交额
  profitMax: 80,                   // ⑩ 获利盘上限（越低越"锁仓"）
  maxLianBan: 4,                   // ⑪ 连板上限（≥此值出局）
  volRatio: 1.8,                   // ⑬ 倍量
  minHits: 6,                      // 至少命中几条才算"符合体系"
};

// 主入口：给一只票打分
function evaluateOne(o, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const items = check(o, c);
  const hits = items.filter(x => x.ok && !x.unknown);
  const miss = items.filter(x => !x.ok && !x.unknown);
  const unknown = items.filter(x => x.unknown);
  // 排除项（⑪）不通过 → 直接出局，不看命中几条
  const excluded = items.filter(x => x.i === 11 && !x.ok);
  const pass = !excluded.length && hits.length >= c.minHits;
  const known = hits.length + miss.length;   // 可判定的条数（unknown 不计入分母）
  return {
    code: o.stock && o.stock.code, name: o.stock && o.stock.name, price: o.stock && o.stock.price,
    hits: hits.length, known, unknown: unknown.length, pass,
    rate: known ? Math.round(hits.length / known * 100) : null,
    hitList: hits.map(x => x.i), missList: miss.map(x => x.i), unknownList: unknown.map(x => x.i),
    excluded: excluded.length ? excluded.map(x => x.note) : [],
    items,
  };
}

// 一批票：按命中条数降序（同命中数再按"可判定率"降序），排序稳定
function scan(list, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const out = [];
  for (const o of list) {
    let r;
    try { r = evaluateOne(o, c); } catch { continue; }
    if (!r) continue;
    out.push(r);
  }
  out.sort((a, b) => (b.hits - a.hits) || (b.rate - a.rate) || String(a.code).localeCompare(String(b.code)));
  return { count: out.filter(x => x.pass).length, all: out };
}

function formatOne(r) {
  if (!r) return '';
  const L = [`▌${r.name}(${r.code}) ${r.price}元 · 命中 ${r.hits}/${r.known} 条${r.unknown ? `（${r.unknown} 条缺数据未判）` : ''} ${r.pass ? '✅符合体系' : '—未达标'}`];
  for (const x of r.items) {
    if (x.unknown) { L.push(`  ？ [${x.i}] ${x.name}：${x.note}`); continue; }
    L.push(`  ${x.ok ? '✔' : '✘'} [${x.i}] ${x.name}：${x.note}`);
  }
  if (r.excluded.length) L.push(`  ⛔ 出局：${r.excluded.join('；')}`);
  return L.join('\n');
}

module.exports = { evaluateOne, scan, formatOne, DEFAULTS, maOf, linreg };
