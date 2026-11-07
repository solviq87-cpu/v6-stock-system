'use strict';
// 次日作战计划 nextplan.js
// 用户原话：结合板块和资金情况+我给的条件，筛选第二天能干的票，要附加选股逻辑和条件，
//          并且要把逻辑讲清楚，让他能看懂、能复盘、能自己上手。
// 设计原则：
//   1) 每条候选必须能回答四个问题：为什么买(逻辑)、多少钱买(进场)、什么价位算错(失效/止损)、
//      次日怎么验证(确认条件)。答不出就不推。
//   2) 量比是核心因子之一（用户点名要学会看）：量比本身是中性的，必须与"位置"一起解读。
//   3) 利好利空不做二元判定，给可信度 + 交叉证据。
//   4) 对外只暴露纯函数，便于离线回测（沙箱无行情时也能 learn/verify）。

const A = require('./analysis.js');   // 复用统一的涨停口径（纯函数模块，无副作用）

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct1 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(1));

// 本地日期（YYYY-MM-DD）。
// ⚠️ 踩过一次的坑：new Date().toISOString() 给的是 **UTC** 日期。
// 国内时区凌晨生成的计划会被标成"前一天"（例如 03:20 CST → UTC 还是昨天），
// 推送标题上写错日期会让整套计划的可信度崩塌。
function localDate(d) {
  const t = d || new Date();
  const p = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
const yi = v => {
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return String(Math.round(v));
};

// ── 指标：均线 ────────────────────────────────────────────────
function maOf(rows, n, key) {
  if (!rows || rows.length < n) return null;
  let s = 0;
  for (let i = rows.length - n; i < rows.length; i++) s += +(rows[i][key || 'close'] || 0);
  return s / n;
}

// ── 核心：量比 ────────────────────────────────────────────────
// 量比 = 当日每分钟平均成交量 / 过去5个交易日每分钟平均成交量
// 交易所全天 240 分钟 intraday 时要注意"分钟数折算"，否则早盘量比会被严重高估。
function volumeRatio(rows, elapsedMin) {
  if (!rows || rows.length < 6) return null;
  const mins = clamp(elapsedMin > 0 ? elapsedMin : 240, 1, 240);
  const today = +(rows[rows.length - 1].volume || 0);
  let s = 0, cnt = 0;
  for (let i = rows.length - 6; i < rows.length - 1; i++) { s += +(rows[i].volume || 0); cnt++; }
  if (!cnt) return null;
  const avg5 = s / cnt;                 // 过去5日日均成交量（手）
  if (avg5 <= 0) return null;
  return +((today / mins) / (avg5 / 240)).toFixed(2);
}

// 量比的性质判断：必须结合位置，否则会得出相反结论
// 返回 {verdict, note, scoreDelta}
function volumeVerdict(vr, ctx) {
  const up = +(ctx && ctx.pct || 0);
  const afterUp = +(ctx && ctx.prevDaysUp || 0);   // 前面几日累计涨幅%
  const posHi = afterUp > 15;                       // 短期已在高位
  if (vr == null) return { verdict: '无量比数据', note: '缺历史成交量，跳过量能打分', scoreDelta: 0 };
  if (vr < 0.6) {
    return { verdict: '极度缩量', scoreDelta: posHi ? 2 : -6,
      note: posHi ? '高位极度缩量：上攻乏力但抛压也不重，多为整理' : '极度缩量：无资金关注，次日难有主动性行情' };
  }
  if (vr < 0.9) {
    return { verdict: '缩量', scoreDelta: -3, note: '缩量整理，需等放量确认方向' };
  }
  if (vr < 1.5) {
    return { verdict: '温和量能', scoreDelta: 4, note: '量能温和，节奏健康；若配合板块效应可加分' };
  }
  if (vr < 3) {
    return { verdict: '放量', scoreDelta: posHi ? 4 : 12,
      note: posHi ? '高位放量：可能是接力也可能是出货，须看收盘是否守住均价' : '低位/中位放量：资金介入的典型信号' };
  }
  if (vr < 6) {
    return { verdict: '显著放量', scoreDelta: posHi ? 0 : 14,
      note: posHi ? '高位显著放量：对倒/出货风险大，只做卖出不加仓' : '显著放量：攻击量能，次日惯性上冲概率高' };
  }
  return { verdict: '暴量', scoreDelta: posHi ? -8 : 8,
    note: posHi ? '高位暴量：典型派发特征，回避' : '暴量：情绪高潮，次日波动剧烈，仓位要减半' };
}

// ── 技术形态（均线/位置/突破）─────────────────────────────────
function techOf(rows) {
  if (!rows || rows.length < 25) return null;
  const last = rows[rows.length - 1];
  const ma5 = maOf(rows, 5), ma10 = maOf(rows, 10), ma20 = maOf(rows, 20);
  const hi = Math.max(...rows.slice(-20).map(r => +r.high || 0));
  const posHi = ma20 ? clamp((+last.close - ma20) / ma20 * 100, -99, 999) : null;
  const aboveMa5 = ma5 ? +last.close > ma5 : null;
  const bull = ma5 && ma10 && ma20 ? (ma5 > ma10 && ma10 > ma20) : null;
  // 突破20日新高（昨日收盘已站上前20日最高）
  const prev20 = rows.slice(-21, -1);
  const preHigh = prev20.length ? Math.max(...prev20.map(r => +r.high || 0)) : null;
  const breakout = preHigh != null ? (+last.close > preHigh) : null;
  return { close: +last.close, ma5, ma10, ma20, hi20: hi, devMa20: posHi, aboveMa5, bullArrange: bull, breakout20: breakout, volume60avg: null };
}

// ── 资金：连续性与守恒校验（和用户第7问同一套逻辑）─────────────────
function fundOf(stock, fundDays) {
  // fundDays: 最近若干日 [ {date, main(net), super, big, mid, small} ] 升序
  if (!fundDays || !fundDays.length) return { net: stock && stock.mainInflow, cont: 0, valid: false, note: '无多日资金数据' };
  let cont = 0;
  for (let i = fundDays.length - 1; i >= 0; i--) { if ((+fundDays[i].main || 0) > 0) cont++; else break; }
  let last = fundDays[fundDays.length - 1];
  let valid = true, note = '';
  const s = +last.super || 0, b = +last.big || 0, m = +last.mid || 0, sm = +last.small || 0;
  if (Math.abs(s + b + m + sm) > Math.max(1, Math.abs(+last.main || 0)) * 0.35) {
    valid = false; note = '四类资金不守恒（可能未复权/脏数据），结论降权';
  }
  return { net: last.main, cont, valid, note, superIn: s, bigIn: b };
}

// ── 综合打分 ─────────────────────────────────────────────────
// cfg 实际生效的就三个键：{maxPicks, minScore, weights}
//   weights 形如 {板块:1, 资金:2, 量比:1, 技术:1, 纪律:1}，缺省一律 1。
//   以前注释里还列了 requireSectorHeat / excludeST / excludeLimitUpNext / dayMinute 四个
//   根本没实现的开关 —— 对外承诺的参数不存在，比不写注释更糟，删掉。
function evaluate(o, cfg) {
  cfg = cfg || {};
  const { stock, rows, sector, fundDays, elapsedMin } = o;
  const reasons = [], risks = [];
  let score = 0;

  // ① 排除项（没有商量余地）
  if (/ST|\*ST|退市/i.test(stock.name || '')) return { drop: 'ST/退市股直接排除' };
  if (stock.suspended) return { drop: '停牌中，无操作空间' };
  // lc（用户：主推别给我涨停票/开太高的）——涨停收盘只走接力通道（cfg.allowLimitUp=true 时），主推一律 drop：
  // 调研共识（约投顾/新浪/头条等五源）：涨停票次日高开兑现压力大，不属于「次日低吸/埋伏」池子。
  if (!cfg.allowLimitUp && A.isLimitUp(stock.code, stock.name, +(stock.pct || 0))) {
    return { drop: '涨停收盘 → 只进「涨停接力」区，不进主推（次日高开兑现压力大）' };
  }

  const t = techOf(rows);
  if (!t) return { drop: 'K线样本不足' };

  // ── 各维度分开累计 ────────────────────────────────────────────
  // 分开是为了两件事：① 你自己能看懂分是怎么来的；② 你能用 cfg.weights 调权重
  // （比如你更看重资金，就把 资金 权重调高），这才是"把方法交给你"而不是给你结论。
  const D = { 板块: 0, 资金: 0, 量比: 0, 技术: 0, 纪律: 0 };

  // ② 量比（用户点名因子）
  const vr = volumeRatio(rows, elapsedMin);
  let prevDaysUp = 0;
  if (rows.length >= 6) {
    const ref = +rows[rows.length - 6].close || +rows[rows.length - 6].open || 0;
    if (ref > 0) prevDaysUp = (+rows[rows.length - 1].close - ref) / ref * 100;
  }
  const vres = volumeVerdict(vr, { pct: stock.pct, prevDaysUp });
  D.量比 += vres.scoreDelta;
  reasons.push(`量比 ${vr == null ? '-' : vr}（${vres.verdict}）：${vres.note}`);

  // ③ 资金：缺数据时必须承认缺，不能把"没数据"显示成"净流出"（以前就犯过这个错，
  //    undefined >= 0 为 false → 误报利空，实战中会让人平白错过一只票）
  const f = fundOf(stock, fundDays);
  let fundScore = 0;
  if (f.net == null) {
    reasons.push('当日无主力资金数据 → 资金维度不计分，也不倒扣');
    risks.push('缺主力资金数据，请在面板确认行情源正常后再参考');
  } else {
    if (f.net > 0) { fundScore += 8; if (f.valid) fundScore += 2; }
    if (f.cont >= 2) fundScore += 8;
    if (f.cont >= 3) fundScore += 6;
    if (f.net < 0) fundScore -= 12;
    reasons.push(`主力净${f.net >= 0 ? '流入' : '流出'} ${yi(f.net)}${f.cont >= 2 ? `，已连续${f.cont}日流入` : ''}`);
  }
  if (!f.valid && f.note) risks.push(f.note);
  D.资金 += fundScore;

  // ④ 板块效应
  let secScore = 0;
  if (sector) {
    const heat = +(sector.ztCount || 0);
    const sp = +(sector.pct || 0);
    if (heat >= 3) secScore += 14; else if (heat === 2) secScore += 9; else if (heat === 1) secScore += 4;
    if (sp >= 2) secScore += 6; else if (sp >= 0.5) secScore += 3;
    if (sector.mainInflow > 0) secScore += 4;
    reasons.push(`所属板块【${sector.name}】当日${heat}只涨停、板块涨${pct1(sp)}%、板块主力${sector.mainInflow > 0 ? '净流入' : '净流出'} ${yi(sector.mainInflow)}`);
    if (heat === 0 && sp < 0) risks.push('所属板块当日无涨停且板块下跌，缺乏板块效应支撑');
  } else {
    risks.push('未匹配到所属板块，板块效应无法评估');
  }
  D.板块 += secScore;

  // ⑤ 技术形态
  if (t.aboveMa5) { D.技术 += 6; reasons.push(`站上5日线（MA5=${t.ma5.toFixed(2)}）`); }
  else risks.push('未站上5日线，短线偏弱');
  if (t.bullArrange) { D.技术 += 8; reasons.push('均线多头排列（MA5>MA10>MA20）'); }
  if (t.breakout20) { D.技术 += 10; reasons.push('放量突破近20日新高（有攻击形态）'); }
  if (t.devMa20 != null) {
    if (t.devMa20 > 25) { D.技术 -= 10; risks.push(`偏离20日线${pct1(t.devMa20)}%，追高风险大`); }
    else if (t.devMa20 < -12) { D.技术 -= 4; risks.push('处于20日线下方较深，属于弱势区'); }
    else reasons.push(`距20日线${pct1(t.devMa20)}%，位置合理`);
  }

  // ⑥ 当日涨幅纪律：已经大涨的，次日性价比下降
  const dp = +(stock.pct || 0);
  // ⚠️ 涨停判定必须走 A.isLimitUp 按板块识别限幅，不能写死 9.8：
  // 写死 9.8 会把创业板涨 15%（非涨停）误判成"涨停收盘"，
  // 同时看不见 ST 股 5% 涨停 —— 与我刚在 server.js 里修掉的是同一个 bug，
  // 而我在写这个文件时又原样踩了一遍，必须锁进测试防止再犯。
  if (A.isLimitUp(stock.code, stock.name, dp)) {
    D.纪律 -= 14; risks.push(`当日涨停收盘（${A.limitPctOf(stock.code, stock.name)}%限幅），次日高开后一致性过强，接力需谨慎`);
  }
  else if (dp > 7.5) { return { drop: `当日涨 ${dp}% 透支次日空间（调研共识：3-5% 最佳，>7.5% 次日兑现压力大）` }; }
  else if (dp >= 5) { D.纪律 += 3; risks.push(`当日涨${pct1(dp)}%，偏强但未透支（最佳区为 3-5%）`); }
  else if (dp >= 3) { D.纪律 += 10; reasons.push(`当日涨${pct1(dp)}%，正处 3-5%「温和走强」最佳区（调研共识）`); }

    // lj：近10日 A杀风险提示（先急涨≥15%后回撤≥12%）——只提示不否决
  try {
    const _seg = rows.slice(-10); let _pk = 0, _pi = -1;
    for (let k = 0; k < _seg.length; k++) { const c = +_seg[k].close || 0; if (c > _pk) { _pk = c; _pi = k; } }
    if (_pi >= 2 && _pk > 0) {
      const _r3 = (_pk / (+_seg[Math.max(0, _pi - 3)].close || _pk) - 1) * 100;
      const _dd = ((+_seg[_seg.length - 1].close || 0) / _pk - 1) * 100;
      if (_r3 >= 15 && _dd <= -12) risks.push(`近10日 A杀：急涨 +${_r3.toFixed(1)}% 后回撤 ${_dd.toFixed(1)}%——套牢盘压制，仓位要更轻`);
    }
  } catch (e) {}
  // ls：筹码峰+十日量能硬维度（用户要求全页面统一判断「能不能干」）
  try {
    if (typeof A.chipPeakOf === 'function') {
      const _chip = A.chipPeakOf(rows);
      if (_chip) {
        if (_chip.dense && (+stock.price || 0) >= _chip.mainPeak * 1.02) { D.技术 += 2; reasons.push('筹码单峰密集且站上峰顶——上方套牢轻（筹码维度）'); }
        else if (_chip.aboveGapPct != null && _chip.aboveGapPct <= 5) { D.技术 -= 2; risks.push(_chip.chipText); }
      }
    }
    if (typeof A.volTenOf === 'function') {
      const _vol = A.volTenOf(rows);
      if (_vol) {
        if (_vol.verdict === 'bad') { D.纪律 -= 6; risks.push('十日量能：' + _vol.text); }
        else if (_vol.verdict === 'warn') { D.纪律 -= 3; risks.push('十日量能：' + _vol.text); }
        else if (_vol.upDnRatio != null && _vol.upDnRatio >= 1.2) reasons.push('十日红肥绿瘦——资金持续进场（量能维度）');
      }
    }
  } catch (e) {}
// ⑧ 高开幅度（lc 新增，用户点题「开得太高」）——次日能不能买，先看今天是怎么开的
  const _last = rows[rows.length - 1];
  const _prevC = rows.length > 1 ? (+rows[rows.length - 2].close || null) : null;
  const _open = _last ? (+_last.open || null) : null;
  const gap = (_open != null && _prevC) ? +((_open / _prevC - 1) * 100).toFixed(2) : null;
  if (gap != null) {
    if (gap > 5) return { drop: `高开 ${gap}% 开盘即透支（「开太高」次日没肉，用户口径）` };
    if (gap > 2) { D.纪律 -= 5; risks.push(`高开 ${gap}% 偏多，追高性价比下降`); }
    else if (gap >= 0) { D.纪律 += 3; reasons.push(`高开 ${gap}% 温和，筹码换手健康`); }
    else { D.纪律 += 1; reasons.push(`低开 ${gap}% 后走强，承接有力`); }
  }

  // ⑦ 换手率：过高说明分歧大
  const to = +(stock.turnover || 0);
  if (to >= 25) { D.纪律 -= 8; risks.push(`换手${pct1(to)}%偏高，分歧剧烈`); }
  else if (to >= 8) { D.纪律 += 5; reasons.push(`换手${pct1(to)}%，交投活跃但不过热`); }

  const W = Object.assign({ 板块: 1, 资金: 1, 量比: 1, 技术: 1, 纪律: 1 }, cfg.weights || {});
  let raw = 0;
  for (const k of Object.keys(D)) raw += D[k] * (Number(W[k]) || 0);
  score = clamp(Math.round(raw), 0, 100);

  // ── 进出场计划 ─────────────────────────────────────────────
  const price = +(stock.price || t.close || 0);
  // 止损取 MA5 与 -4.5% 两者更严格者，但**不能宽于 8%**：
  // MA5 远离现价时（例如高位加速票）会算出 -30% 的止损，那等于没有止损，
  // 属于"假止损"，会让人亏到不可收拾。这里强制约束在 -4.5%~-8% 的纪律区间。
  let stopRef = Math.min(t.ma5 != null ? t.ma5 : price * 0.95, price * 0.955);
  stopRef = Math.max(stopRef, price * 0.92);
  const stop = +stopRef.toFixed(2);
  const invalid = [];
  if (t.ma5) invalid.push(`次日跌破MA5(${t.ma5.toFixed(2)}) 且不能快速收回 → 形态失效`);
  invalid.push(`跌破止损位 ${stop}（约-${((price - stop) / price * 100).toFixed(1)}%）无条件走`);
  if (vr != null && vr >= 3) invalid.push('次日若缩量回落至均价下方，视为资金撤退');
  if (f.cont >= 2) invalid.push('次日资金转为净流出且板块转弱 → 逻辑证伪');

  const confirm = [];
  confirm.push('开盘后30分钟内不跌破均价且量能不小于昨日同期');
  if (sector) confirm.push(`板块【${sector.name}】次日仍有涨停/领涨股出现`);
  confirm.push('不出现"高开低走且放量"的分时形态');

  let grade = '观望';
  if (score >= 75) grade = '可主动布局';
  else if (score >= 60) grade = '可轻仓试';
  else if (score >= 45) grade = '列入观察';

  return {
    code: stock.code, name: stock.name, price, pct: pct1(dp), turnover: pct1(to),
    sector: sector ? sector.name : null,
    volumeRatio: vr, volumeVerdict: vres.verdict, volumeNote: vres.note,
    mainNetIn: f.net, inflowDays: f.cont,
    aboveMa5: t.aboveMa5, bullArrange: t.bullArrange, breakout20: t.breakout20, devMa20: pct1(t.devMa20),
    score, grade, dims: D, rules: [
      'A股T+1：次日买入的当天【不能卖出】，所以盘中跌破止损也只能下一交易日处理 → 仓位必须留出余地',
      '次日若一字/大幅高开超过计划进场区间上沿，宁可放弃不追（追高会直接破坏赔率）'
    ],
    entry: [+(price * 0.995).toFixed(2), +(price * 1.015).toFixed(2)],
    stop, target: +(Math.max(t.hi20 || price, price) * 1.03).toFixed(2),
    reasons, risks, invalid, confirm
  };
}

// ── 主入口：扫描候选池 ────────────────────────────────────────
// universe: [{stock, rows, sector, fundDays}]
function buildPlan(universe, cfg) {
  cfg = cfg || {};
  const maxPicks = cfg.maxPicks || 6;
  // ⚠️ 别写 `cfg.minScore || 55`：传 0 会被当成"没传"而回落到 55，
  //    于是"放开门槛看全部分数"这件事根本做不到（离线诊断时要看分布就只能拿到空数组）。
  const minScore = Number.isFinite(cfg.minScore) ? cfg.minScore : 55;
  const out = [];
  for (const u of universe) {
    let r;
    try { r = evaluate(u, cfg); } catch (e) { continue; }
    if (!r || r.drop) continue;
    if (r.score < minScore) continue;
    out.push(r);
  }
  // 同分时用代码再排一次：**排序必须稳定**，否则同一批数据两次扫描出的顺序不同，
  // 既没法复盘（"昨天推的第一名今天变第三"），也会让测试随机翻红。
  out.sort((a, b) => (b.score - a.score) || String(a.code).localeCompare(String(b.code)));
  return { date: localDate(), count: out.length, picked: out.slice(0, maxPicks), allScored: out.length };
}

// ── 推送排版：把"逻辑"摊开给人看，而不是一句"关注XXX" ──────────
function formatPlan(p) {
  if (!p || !p.picked || !p.picked.length) return null;
  // ⛔ 首行写【适用日】（下一个交易日），生成日另起一行 —— 见 server.js nextTradeDay 注释：
  //    一个日期同时代表"哪天生成的"和"哪天能用"必然读错，两个方向都会读错。
  const L = [`【次日作战计划 · ${p.applyDate || '下一交易日'}】共${p.count}只入围，按分数取前${p.picked.length}只`];
  if (p.date) L.push(`（生成于 ${p.date}${p.applyDate && p.applyDate !== p.date ? '，为下一交易日准备' : ''}）`);
  L.push('分项可追溯：板块 / 资金 / 量比 / 技术 / 纪律（各自权重可用 cfg.weights 调整）');
  for (const x of p.picked) {
    const d = x.dims || {};
    L.push('');
    // pct1() 拿不到涨幅时返回 null，直接拼字符串会打出 "+null%" 这种脏文案
    const pctTxt = x.pct == null ? '涨幅未知' : `${x.pct >= 0 ? '+' : ''}${x.pct}%`;
    L.push(`▌${x.name}(${x.code}) ${x.price}元 ${pctTxt}  【${x.grade}】${x.score}分`);
    L.push(`  分项: 板块${d.板块} 资金${d.资金} 量比${d.量比} 技术${d.技术} 纪律${d.纪律}`);
    if (x.sector) L.push(`  板块：${x.sector}`);
    L.push(`  【为什么选它】`);
    x.reasons.slice(0, 4).forEach(s => L.push(`    · ${s}`));
    L.push(`  【怎么动手】参考进场 ${x.entry[0]}~${x.entry[1]}；止损 ${x.stop}；上方目标 ${x.target}`);
    L.push(`  【什么情况算我错了】`);
    x.invalid.slice(0, 2).forEach(s => L.push(`    · ${s}`));
    L.push(`  【次日怎么验证】`);
    x.confirm.slice(0, 2).forEach(s => L.push(`    · ${s}`));
    if (x.risks.length) { L.push(`  【风险提示】`); x.risks.slice(0, 2).forEach(s => L.push(`    · ${s}`)); }
    if (x.rules && x.rules.length) { L.push(`  【交易纪律】`); x.rules.slice(0, 2).forEach(s => L.push(`    · ${s}`)); }
  }
  L.push('');
  L.push('以上为量化逻辑推演，不构成投资建议；请以自身纪律为准。');
  return L.join('\n');
}

module.exports = { volumeRatio, volumeVerdict, techOf, fundOf, evaluate, buildPlan, formatPlan, maOf, localDate };
