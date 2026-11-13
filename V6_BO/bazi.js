// 八字选股口诀引擎：趋势 / 资金 / 位置 / 承接
//
// 用户原话（2026-10-02）：
//   ① 看趋势：顺势交易，只选均线多头、稳步抬升、回踩支撑不跌破的个股；
//      板块要有连续上涨节奏，有龙头带领、反复活跃，排除一日游；剔除长期阴跌、冲高回落、趋势走坏。
//   ② 看资金：主力大单持续流入、筹码不断集中；近期涨停或大阳线较多，回调之后能再度拉起，
//      异动伴随放量。资金进场的地方才有行情；持续撤离的标的进场容易接盘。
//   ③ 看位置：重点低位启动、中位蓄力突破，谨慎高位加速。
//      启动位=刚突破+放量；洗盘位=涨一波后震荡调整、散户被洗出，是二次上车机会；
//      高位加速=连续大涨、情绪一致，大概率接最后一棒。
//   ④ 看承接：下跌缩量（抛压衰竭）、回调不破关键支撑、分时被砸能快速拉回。
//
// ⛔ 设计铁律（与「不喂假数据」一致）：
//   1) **不另起炉灶算一套指标**。四维度全部复用 analysis.js 已有结论
//      （bigMoneyContext 的均线位置/回撤、volPricePattern 的量价形态、computeLevels 的关键价位），
//      否则八字给出的结论会和趋势池/大单池互相打架，用户看到两套矛盾的说法。
//   2) 缺数据的一律标 insufficient 并把该维度按中性处理，**不猜、不补默认值冒充结论**。
//   3) 每个维度必须给出可读的 why —— 说不出理由的分不算分。
const A = require('./analysis.js');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const N = (r, ns) => { for (const n of ns) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };
const observedNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

// ---------- 维度一：趋势（均线多头 + 稳步抬升 + 回踩不破 + 板块节奏）----------
function dimTrend(ctx) {
  const { rows, price, ctx: bmc, sectorInfo } = ctx;
  const why = [], miss = [];
  let s = 50;   // 中性起评
  if (!rows || rows.length < 25 || !price) return { score: null, label: '数据不足', why: 'K线不足25日，趋势判不出来', insufficient: true };

  const closes = rows.map(r => N(r, ['close', 'c'])).filter(v => v > 0);
  const ma = n => closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null;
  const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma60 = ma(60);

  // ① 均线多头排列（ma5>ma10>ma20）：趋势方向本身
  if (ma5 && ma10 && ma20) {
    const bull = ma5 > ma10 && ma10 > ma20;
    if (bull) { s += 18; why.push('均线多头排列（5>10>20）'); }
    else if (ma5 < ma10 && ma10 < ma20) { s -= 18; why.push('均线空头排列（5<10<20）——逆势，不碰'); }
    else why.push('均线交织，方向未明');
  } else miss.push('均线');

  // ② 稳步抬升：ma20/ma60 向上（不是躺在底部横着）
  if (bmc && bmc.ma20up != null) {
    if (bmc.ma20up) { s += 10; why.push('20日线走平或向上（稳步抬升）'); }
    else { s -= 12; why.push('20日线向下（下降通道中的反弹，不是趋势）'); }
  } else miss.push('ma20方向');
  if (ma60 && price > ma60) { s += 6; why.push('站上60日线'); }
  else if (ma60 && price <= ma60) { s -= 6; why.push('仍在60日线下方'); }
  else miss.push('ma60');

  // ③ 回踩支撑不跌破：近10日最低价不能显著破 ma20
  if (ma20) {
    const low10 = Math.min(...rows.slice(-10).map(r => N(r, ['low', 'l']) || Infinity));
    if (isFinite(low10)) {
      if (low10 >= ma20 * 0.97) { s += 10; why.push('近10日回踩未跌破20日线（支撑有效）'); }
      else if (low10 < ma20 * 0.9) { s -= 12; why.push('近10日跌破20日线超10%（支撑失效）'); }
      else why.push('近10日曾下探20日线附近');
    }
  }
  // ④ 剔除长期阴跌 / 冲高回落
  if (bmc && bmc.dd60 != null && bmc.dd60 > 35) { s -= 14; why.push(`距60日高点回撤${bmc.dd60}%（长期阴跌，趋势走坏）`); }
  const last = rows[rows.length - 1];
  const upShadow = N(last, ['high', 'h']) > 0
    ? (N(last, ['high', 'h']) - Math.max(N(last, ['close', 'c']), N(last, ['open', 'o']))) / N(last, ['high', 'h']) * 100 : 0;
  if (upShadow >= 3 && N(last, ['pct']) > 3) { s -= 8; why.push(`冲高回落（上影${upShadow.toFixed(1)}%）`); }

  // ⑤ 板块节奏：连续上涨 + 有龙头带领 + 反复活跃 → 加分；一日游 → 减分
  if (sectorInfo) {
    const { secZT = null, streak = null, leaderPct = null } = sectorInfo;
    if (secZT >= 2) { s += 10; why.push(`所属板块今日${secZT}只涨停（有龙头带领下持续活跃）`); }
    else if (secZT === 1) { s += 2; why.push('所属板块今日1只涨停（需次日验证是否一日游）'); }
    if (streak >= 2) { s += 6; why.push(`板块连续${streak}日上榜（非一日游）`); }
    else if (streak == null) miss.push('板块连续性');
    // ⚠️ leaderPct 是从涨停池/板块榜直接拿的原始值，实测见过 10.0217866897583 这种浮点，
    //    不格式化会把一长串小数打进推送文案里（手机上看就是一串乱码）
    if (leaderPct != null && leaderPct >= 5) { s += 4; why.push(`板块龙头涨${(+leaderPct).toFixed(1)}%领涨`); }
  } else miss.push('板块');

  return { score: clamp(Math.round(s), 0, 100), label: scoreLabel(s), why: why.join('；') || '无可判据', miss };
}

// ---------- 维度二：资金（主力持续流入 + 筹码集中 + 炒作惯性 + 放量异动）----------
function dimFund(ctx) {
  const { rows, price, fundDays, mainInflow, thsNetAmt, ctx: bmc } = ctx;
  const why = [], miss = [];
  let s = 50;
  if (!rows || rows.length < 10) return { score: null, label: '数据不足', why: 'K线不足，资金判不出来', insufficient: true };

  // ① 主力资金：四级保障（东财三日 → 当日净流入 → 同花顺主动净买 → 量价代理）
  let src = null, inflow = null;
  const window = Array.isArray(fundDays) ? fundDays.slice(-3) : [];
  const historyComplete = window.length === 3 && window.every(d => d && observedNumber(d.main) !== null);
  if (historyComplete && Number.isFinite(window.reduce((a, d) => a + d.main, 0))) {
    inflow = window.reduce((a, d) => a + d.main, 0);
    src = '东财三日主力净额';
  } else if (observedNumber(mainInflow) !== null) { inflow = mainInflow; src = '当日主力净流入'; }
  else if (observedNumber(thsNetAmt) !== null) { inflow = thsNetAmt; src = '同花顺主动净买'; }
  if (inflow != null) {
    const wan = +(inflow / 1e4).toFixed(0);
    if (inflow > 0) { s += 16; why.push(`${src} +${wan}万（主力在进）`); }
    else if (inflow < 0) { s -= 18; why.push(`${src} ${wan}万（该口径净流出，注意承接风险）`); }
    else why.push(`${src} 0万（已观测净额为零，不作流入或流出加减分）`);
    // 持续性：逐日都为正才算"持续流入"
    if (historyComplete) {
      const all = window.every(d => d.main > 0);
      if (all) { s += 8; why.push('近3日连续净流入（持续性成立）'); }
      else if (window.every(d => d.main < 0)) { s -= 8; why.push('近3日连续净流出'); }
    }
  } else { miss.push('资金流'); why.push('资金流未知，仅保留独立量价形态评分，不能据此认定资金流入'); }

  // ② 炒作惯性：近20日涨停 / 大阳线数量（"资金曾经炒作过的更容易再来"）
  const r20 = rows.slice(-20);
  let zt = 0, bigUp = 0;
  for (const r of r20) {
    const p = N(r, ['pct']);
    if (A.isLimitUp(ctx.code, ctx.name, p)) zt++;
    else if (p >= 5) bigUp++;
  }
  if (zt >= 2) { s += 12; why.push(`近20日${zt}次涨停（有涨停基因，资金记得它）`); }
  else if (zt === 1) { s += 7; why.push('近20日1次涨停'); }
  else if (bigUp >= 3) { s += 8; why.push(`近20日${bigUp}根大阳线（反复活跃）`); }
  else if (bigUp >= 1) { s += 3; why.push(`近20日${bigUp}根大阳线`); }
  else why.push('近20日无涨停无大阳（缺乏炒作记忆）');

  // ③ 回调后再度拉起：近10日里"先跌后收复"的次数
  let recover = 0;
  for (let i = Math.max(1, rows.length - 10); i < rows.length; i++) {
    if (N(rows[i - 1], ['pct']) < -2 && N(rows[i], ['pct']) > 1.5) recover++;
  }
  if (recover >= 1) { s += 8; why.push(`近10日${recover}次回调后拉起（有资金接）`); }

  // ④ 异动伴随放量
  const vp = A.volPricePattern(rows);
  if (vp) {
    const lastPct = N(rows[rows.length - 1], ['pct']);
    // ⚠️ 涨停（尤其一字/封死）当日成交量天然极小 —— 那是"没人卖"不是"没人关注"，
    //    照搬"缩量=关注度不足"会把最强的票扣成没人气（实测园林股份 vr=0.05 就这么被冤枉）
    const ztToday = A.isLimitUp(ctx.code, ctx.name, lastPct);
    if (vp.vr >= 1.5 && lastPct > 0) { s += 8; why.push(`放量${vp.vr}倍收涨（异动有量）`); }
    else if (vp.vr < 0.7 && ztToday) why.push(`涨停封板成交仅${vp.vr}倍（锁筹，量能不具参考性）`);
    else if (vp.vr < 0.7) { s -= 4; why.push(`缩量至${vp.vr}倍（关注度不足）`); }
  } else miss.push('量价形态');

  // ⑤ 高位大单要打折：在高位加速区间的"资金流入"可能是拉高出货
  if (bmc && bmc.atHigh) { s -= 8; why.push('已在60日高点附近，此时的流入需警惕拉高出货'); }

  return { score: clamp(Math.round(s), 0, 100), label: scoreLabel(s), why: why.join('；') || '无可判据', miss,
    fundsEvidence: { source: src, net: inflow, observed: inflow !== null, historyComplete,
      method: src === '同花顺主动净买' ? 'active-net-buy' : src ? 'vendor-order-size-estimate' : null,
      sourceTimestamp: ctx.fundsSourceTimestamp ?? null, verifiedLive: false } };
}

// ---------- 维度三：位置（启动位 / 洗盘位 / 高位加速）----------
// 返回值带 stage 字段，供上层判定"能不能进"
function dimPosition(ctx) {
  const { rows, price, ctx: bmc, code } = ctx;
  const why = [], miss = [];
  let s = 50, stage = '趋势中继';
  if (!rows || rows.length < 25 || !price) return { score: null, label: '数据不足', stage, why: 'K线不足25日，位置判不出来', insufficient: true };

  const dd60 = bmc && bmc.dd60 != null ? bmc.dd60 : null;      // 距60日高点回撤%
  const r20 = bmc && bmc.r20 != null ? bmc.r20 : null;         // 近20日涨幅%
  const ma20 = bmc && bmc.ma20 != null ? bmc.ma20 : null;
  const bias = ma20 ? +(((price - ma20) / ma20) * 100).toFixed(1) : null;  // 对20日线乖离%

  // 近5日累计涨幅 → 判断是否"连续大涨"
  const c5 = rows.slice(-6, -1).map(r => N(r, ['close', 'c'])).filter(v => v > 0);
  const r5 = c5.length >= 5 ? +(((price - c5[0]) / c5[0]) * 100).toFixed(1) : null;

  // ① 高位加速：必须【同时】满足「贴近60日高点」+「有加速特征（近5日大涨 or 远离均线）」
  // ⚠️ 2026-10-02 修（重要判定漏洞）：原写法把 atTop 当独立条件，结果**所有涨停票
  //    因为涨停当天必然创新高（dd60≈0）被一律判成"高位加速 → 回避"** ——
  //    首板启动的票也被打成"接最后一棒"，与用户口诀里"启动位风险小、上涨空间大"直接冲突。
  //    正确拆法：创新高只是"位置高"，只有【连续大涨/乖离过大】才是"加速"。
  //    创新高但没加速 ≠ 高位加速，它恰恰就是启动位。
  const accelerating = (r5 != null && r5 >= 15) || (bias != null && bias >= 18);
  const atTop = dd60 != null && dd60 <= 6;
  if (accelerating && atTop) {
    stage = '高位加速'; s -= 28;
    why.push(`近5日涨${r5}%、乖离20日线${bias}%、距60日高点仅${dd60}% —— 情绪一致的高位加速，大概率接最后一棒`);
  } else if (accelerating) {
    stage = '拉升中'; s -= 10;
    why.push(`近5日累计涨${r5 == null ? '—' : r5}%，乖离${bias == null ? '—' : bias}%（已有加速，追高需谨慎）`);
  }

  // ② 启动位：刚突破平台 + 放量 +（上方还有空间 或 刚创新高但尚未加速）
  const hi20prev = Math.max(...rows.slice(-21, -1).map(r => N(r, ['high', 'h']) || 0));
  const breakout = hi20prev > 0 && price > hi20prev * 1.005;
  const vp = A.volPricePattern(rows);
  const roomAbove = dd60 == null || dd60 > 12;
  const freshHighNotAccel = atTop && !accelerating;   // 刚创新高、但还没走出加速形态
  if (breakout && (roomAbove || freshHighNotAccel)) {
    stage = '启动位'; s += 20;
    why.push(roomAbove
      // ⛔ roomAbove 的判据本身就包含 `dd60 == null`（缺数据也算"上方还有空间"），
      //    可下面却把 dd60 当数字拼进文案 —— 于是打出 "还有null%空间"。
      //    同一函数 222 行还写着 `if (dd60 == null) miss.push('回撤')`，等于上面标"缺数据"、
      //    下面当已知值往外报。缺数据一律打 '—'（这也是本文件 17 行自己定的铁律）。
      ? `突破近20日高点${hi20prev.toFixed(2)}、上方距60日高点还有${dd60 == null ? '—' : dd60}%空间 —— 启动位（刚突破、关注度初起）`
      : `突破近20日高点${hi20prev.toFixed(2)}创新高，但近5日仅涨${r5 == null ? '—' : r5}%、乖离${bias == null ? '—' : bias}%尚未加速 —— 启动位而非高位加速`);
    if (vp && vp.vr >= 1.3) { s += 6; why.push(`突破伴随放量${vp.vr}倍（有效突破）`); }
    else if (vp && vp.vr < 1 && !A.isLimitUp(code, ctx.name, N(rows[rows.length - 1], ['pct']))) { s -= 6; why.push(`突破但量能仅${vp.vr}倍（无量突破，需确认）`); }
  }

  // ③ 洗盘位：涨过一波后震荡调整、缩量、不破关键支撑 → 二次上车
  if (stage === '趋势中继' && r20 != null && r20 >= 8 && ma20) {
    const last10 = rows.slice(-10);
    const inRange = Math.max(...last10.map(r => N(r, ['high', 'h']))) / Math.min(...last10.map(r => N(r, ['low', 'l']))) - 1;
    const low10 = Math.min(...last10.map(r => N(r, ['low', 'l']) || Infinity));
    const holdMa20 = isFinite(low10) && ma20 && low10 >= ma20 * 0.95;
    const shrink = vp && vp.vr < 1.1;
    if (inRange <= 0.18 && holdMa20 && shrink) {
      stage = '洗盘位'; s += 14;
      why.push(`近20日涨${r20}%后进入${(inRange * 100).toFixed(0)}%窄幅震荡、缩量且不破20日线 —— 洗盘位（二次上车机会）`);
    }
  }

  // ④ 底部蓄势：回撤很深但已站上20日线（左侧，风险与空间并存）
  if (stage === '趋势中继' && bmc && bmc.aboveMa20 && dd60 != null && dd60 > 25) {
    stage = '底部蓄势'; s += 2;
    why.push(`距60日高点回撤${dd60}%但已站上20日线 —— 底部蓄势（左侧，需放量确认）`);
  }

  // ⑤ 破位：跌破20日线且20日线向下
  if (bmc && bmc.aboveMa20 === false && bmc.ma20up === false) {
    stage = '破位整理'; s -= 20;
    why.push('跌破20日线且20日线向下 —— 破位，不是买入位置');
  }

  if (bias != null) { if (bias > 12) why.push(`乖离20日线${bias}%（偏离偏大）`); else why.push(`乖离20日线${bias}%`); }
  else miss.push('乖离');
  if (dd60 == null) miss.push('回撤');

  return { score: clamp(Math.round(s), 0, 100), label: scoreLabel(s), stage, why: why.join('；') || '无可判据', miss, bias, dd60, r5 };
}

// ---------- 维度四：承接（下跌缩量 + 不破支撑 + 被砸能拉回）----------
function dimSupport(ctx) {
  const { rows, price, ctx: bmc } = ctx;
  const why = [], miss = [];
  let s = 50;
  if (!rows || rows.length < 15 || !price) return { score: null, label: '数据不足', why: 'K线不足15日，承接判不出来', insufficient: true };

  // ① 下跌缩量：近10日"跌的那几天"平均量 < "涨的那几天"平均量 → 抛压衰竭
  const last10 = rows.slice(-10);
  let downVol = 0, downN = 0, upVol = 0, upN = 0;
  for (const r of last10) {
    const v = N(r, ['volume', 'vol', 'v']), p = N(r, ['pct']);
    if (p < -0.5) { downVol += v; downN++; }
    else if (p > 0.5) { upVol += v; upN++; }
  }
  if (downN >= 2 && upN >= 2) {
    const dv = downVol / downN, uv = upVol / upN;
    if (dv < uv * 0.8) { s += 16; why.push(`跌日均量仅为涨日的${(dv / uv).toFixed(2)}倍 —— 下跌缩量，抛压衰竭`); }
    else if (dv > uv * 1.2) { s -= 14; why.push(`跌日均量是涨日的${(dv / uv).toFixed(2)}倍 —— 下跌放量，抛压未竭`); }
    else why.push('涨跌量能相当，抛压中性');
  } else miss.push('涨跌量能');

  // ② 回调不破关键支撑：近10日最低 vs ma20 / ma60
  const low10 = Math.min(...last10.map(r => N(r, ['low', 'l']) || Infinity));
  if (isFinite(low10) && bmc && bmc.ma20 != null) {
    if (low10 >= bmc.ma20 * 0.98) { s += 12; why.push('近10日最低价守住20日线（下方有资金托底）'); }
    else if (low10 < bmc.ma20 * 0.92) { s -= 10; why.push('近10日最低价跌破20日线超8%（托底不牢）'); }
    else why.push('近10日最低价贴近20日线（勉强守住）');
  } else miss.push('支撑位');

  // ③ 被砸后能拉回：当日收盘处在当日振幅的上半区 & 下影线
  //    分时数据拿不到，用日K近似：下影线越长、收盘越靠近当日最高 = 盘中越是被砸后拉回
  const last = rows[rows.length - 1];
  const h = N(last, ['high', 'h']), l = N(last, ['low', 'l']), c = N(last, ['close', 'c']), o = N(last, ['open', 'o']);
  if (h > 0 && l > 0 && h > l) {
    const closePos = (c - l) / (h - l);                       // 收盘在当日振幅中的位置 0~1
    const lowerShadow = (Math.min(c, o) - l) / h * 100;        // 下影线占比%
    if (closePos >= 0.7 && lowerShadow >= 1.5) { s += 14; why.push(`收在当日振幅${(closePos * 100).toFixed(0)}%位置、下影${lowerShadow.toFixed(1)}% —— 被砸后拉回，承接强`); }
    else if (closePos <= 0.3) { s -= 12; why.push(`收在当日振幅${(closePos * 100).toFixed(0)}%位置（收在低位，承接弱）`); }
    else why.push(`收在当日振幅${(closePos * 100).toFixed(0)}%位置`);
  }
  // 近10日长下影次数（多次被砸都能拉回 = 承接盘稳定）
  let shadowDays = 0;
  for (const r of last10) {
    const hh = N(r, ['high', 'h']), ll = N(r, ['low', 'l']), cc = N(r, ['close', 'c']), oo = N(r, ['open', 'o']);
    if (hh > 0 && ll > 0 && hh > ll && (Math.min(cc, oo) - ll) / hh * 100 >= 2) shadowDays++;
  }
  if (shadowDays >= 3) { s += 10; why.push(`近10日${shadowDays}天留长下影（反复被砸都被接住）`); }

  return { score: clamp(Math.round(s), 0, 100), label: scoreLabel(s), why: why.join('；') || '无可判据', miss };
}

function scoreLabel(s) {
  if (s == null) return '数据不足';
  if (s >= 75) return '强';
  if (s >= 60) return '偏强';
  if (s >= 45) return '中性';
  if (s >= 30) return '偏弱';
  return '弱';
}

// ---------- 主入口 ----------
// ctx: { code, name, rows, price, fundDays, mainInflow, thsNetAmt, floatCap, sectorInfo:{secZT,streak,leaderPct} }
// 返回 { total, dims, stage, verdict, advise, line, insufficient }
function evaluate(ctx) {
  const rows = ctx.rows || [];
  const price = ctx.price || (rows.length ? N(rows[rows.length - 1], ['close', 'c']) : 0);
  // 复用 bigMoneyContext 的均线位置/回撤结论，保证与趋势池、大单池口径一致
  const bmc = (rows.length >= 25 && price) ? A.bigMoneyContext({ rows, price }) : null;
  const base = Object.assign({}, ctx, { price, ctx: bmc });

  const trend = dimTrend(base);
  const fund = dimFund(base);
  const position = dimPosition(base);
  const support = dimSupport(base);

  // 缺数据的维度按中性 50 计，但记下来，绝不冒充真实判据
  const v = x => (x && x.score != null ? x.score : 50);
  const W = { trend: 0.30, fund: 0.30, position: 0.20, support: 0.20 };
  let total = v(trend) * W.trend + v(fund) * W.fund + v(position) * W.position + v(support) * W.support;

  // ⛔ 一票否决：位置在高位加速、或趋势明确破位 —— 分数再高也不能说"可介入"
  //    这是用户口诀里最硬的一条："高位加速进场大概率接最后一棒"
  const stage = position.stage || '趋势中继';
  let verdict, advise;
  if (stage === '高位加速') { total = Math.min(total, 52); verdict = '回避'; advise = '位置在高位加速区，情绪一致时进场大概率接最后一棒 —— 等回踩或换标的'; }
  else if (stage === '破位整理') { total = Math.min(total, 45); verdict = '回避'; advise = '趋势已破位，逆势抄底是散户亏钱的大坑 —— 等重新站回20日线再看'; }
  else if (total >= 68 && v(trend) >= 55 && v(fund) >= 55) { verdict = '可介入'; advise = adviceFor(stage, base); }
  else if (total >= 55) { verdict = '观察'; advise = adviceFor(stage, base); }
  else { verdict = '回避'; advise = '四个维度里明显短板，先放观察池'; }

  // 资金持续撤离也要压住结论（"资金进场的地方才有行情"）
  if (fund && fund.score != null && fund.score < 35 && verdict === '可介入') {
    verdict = '观察'; advise = '资金维度偏弱（持续撤离），即使形态好看也先观察，别急着接';
  }

  const dims = { trend, fund, position, support };
  // ⚠️ 必须把"整个维度判不出来"（insufficient）也算进 miss：
  //    早退分支返回的对象没有 miss 数组，只 concat miss 会让 insufficient 恒为 null，
  //    调用方以为数据齐全 —— 这正是"缺数据还装作判过了"的假数据。
  const missSet = new Set();
  for (const [k, d] of Object.entries(dims)) {
    if (d && d.insufficient) missSet.add(k);
    for (const m of ((d && d.miss) || [])) missSet.add(m);
  }
  const miss = [...missSet];
  // Keep the legacy research score for compatibility, but never promote missing evidence
  // to an actionable verdict. Coverage is about inputs, not a calibrated win probability.
  const knownDimensions = Object.values(dims).filter(d => observedNumber(d.score) !== null && !d.insufficient).length;
  const completeDimensions = Object.values(dims).filter(d => observedNumber(d.score) !== null && !d.insufficient && !(d.miss || []).length).length;
  const evidenceComplete = miss.length === 0;
  const criticalMissing = Object.entries(dims).filter(([, d]) => d.insufficient || observedNumber(d.score) === null).map(([id]) => id);
  if (!fund.fundsEvidence?.observed && !criticalMissing.includes('fund')) criticalMissing.push('资金流');
  if (observedNumber(price) === null || price <= 0) criticalMissing.push('有效价格');
  const hardVeto = stage === '高位加速' || stage === '破位整理';
  if (criticalMissing.length && !hardVeto) {
    verdict = '观察';
    advise = `关键证据不足（${criticalMissing.join('、')}），暂不据此给出介入或加仓建议；等待数据补齐后重新评估`;
  }
  const line = `八字 ${trend.label}/${fund.label}/${position.label}/${support.label}｜${stage}·${verdict}`;

  return {
    total: Math.round(total * 10) / 10,
    dims, stage, verdict, advise, line,
    insufficient: miss.length > 0 ? miss : null,
    scoreKind: 'research-score', calibrationCertified: false,
    evidenceComplete, actionable: !criticalMissing.length && verdict === '可介入',
    coverage: { totalDimensions: 4, knownDimensions, completeDimensions,
      completeRate: completeDimensions / 4, missing: miss, criticalMissing },
    detail: {
      trend: trend.score, fund: fund.score, position: position.score, support: support.score,
      bias: position.bias, dd60: position.dd60, r5: position.r5
    }
  };
}

function adviceFor(stage, ctx) {
  const price = ctx.price;
  if (stage === '启动位') return `启动位：现价${price}附近可轻仓，回踩不破20日线${(ctx.ctx && ctx.ctx.ma20) || '-'}加仓，跌破则走`;
  if (stage === '洗盘位') return `洗盘位：震荡下沿分批低吸，放量突破震荡上沿再顺势加 —— 二次上车机会`;
  if (stage === '底部蓄势') return `底部蓄势：左侧位置，等放量站上20日线再动，别急着抄底`;
  if (stage === '拉升中') return `拉升中：已有涨幅，只做回踩不追高，止损贴5日线`;
  return `趋势中继：沿20日线${(ctx.ctx && ctx.ctx.ma20) || '-'}持有，回踩缩量企稳可加，破线离场`;
}

module.exports = { evaluate, dimTrend, dimFund, dimPosition, dimSupport, scoreLabel };
