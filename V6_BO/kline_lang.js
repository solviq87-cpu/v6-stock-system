// 缩量柱 K线语言规则库
// 来源：用户提供的 5 张思维导图（2026-10-20）
// 框架：趋势阶段 × K线形态 × 换手率 三维度交叉解读缩量信号
// ⚠️ 本库属于经验规则库，不是统计验证过的因子；命中率、覆盖率、不同市场环境下的稳定性需单独回测。

const A = require('./analysis');

// ---------- 默认阈值（可调） ----------
const DEFAULTS = {
  shrinkThresh: 0.85,       // 当日量 / 近5日均量 < 此值视为"缩量柱"
  lowTurnoverThresh: 3.0,   // 换手率 < 此值视为"低换手"（%）
  highRallyPct: 30.0,       // 近20日累计涨幅 > 此值视为"连续大涨"
  highProximity: 0.95,      // 现价 >= 近20日高 × 此值视为"高位"
  ma20UpSlope: 0.998,       // MA20 当前 >= 前值 × 此值视为"向上"
  ma20DownSlope: 1.002,     // MA20 当前 <= 前值 × 此值视为"向下"
  shadowRatio: 0.30,        // 影线占振幅比例 >= 此值视为显著
  dojiBodyRatio: 0.10,      // 实体 / 振幅 <= 此值视为十字星
};

// ---------- 规则表：stage -> pattern -> turnoverLevel -> interpretation ----------
// 低换手 / 正常换手 两套文本分开存，避免运行期拼接出错。
const RULES = {
  '震荡': {
    '涨停': {
      '低换手': '区间缩量涨停：筹码稳定锁仓，试拉，上方压力有待验证',
      '正常换手': '区间缩量涨停：持股者惜售，多头试探上沿，观察能否站稳上轨'
    },
    '阳线': {
      '低换手': '区间缩量阳线：小幅推升，抛压较轻',
      '正常换手': '区间缩量阳线：多空在压力位小幅博弈'
    },
    '阴线': {
      '低换手': '区间缩量阴线：抛压偏弱，支撑暂时有效',
      '正常换手': '区间缩量阴线：持股方惜售，观察低位承接力度'
    },
    '上影线': {
      '低换手': '区间缩量上影：轻度试盘，回落幅度不大',
      '正常换手': '区间缩量上影：测试抛压，行情维持区间震荡'
    },
    '下影线': {
      '低换手': '区间缩量下影：下探力度弱，支撑有效',
      '正常换手': '区间缩量下影：少量资金承接，价格回升'
    },
    '上下影线': {
      '低换手': '区间缩量上下影：小幅拉锯，暂无明确方向',
      '正常换手': '区间缩量上下影：持续博弈，等待方向选择'
    },
    '十字星': {
      '低换手': '区间缩量十字星：市场观望情绪浓厚',
      '正常换手': '区间缩量十字星：震荡格局维持不变'
    },
    '假阳线': {
      '低换手': '区间缩量假阳：修复力度不足，难以突破压力',
      '正常换手': '区间缩量假阳：价格依旧在区间内运行'
    },
    '假阴线': {
      '低换手': '区间缩量假阴：震荡格局维持不变',
      '正常换手': '区间缩量假阴：清洗短线浮筹'
    }
  },
  '下跌': {
    '涨停': {
      '低换手': '下跌途中缩量涨停：筹码惜售，反弹持续性较差',
      '正常换手': '下跌途中缩量涨停：上方套牢盘压力沉重'
    },
    '阳线': {
      '低换手': '下跌缩量阳线：抛压短暂收敛，反弹力度偏弱',
      '正常换手': '下跌缩量阳线：短暂止跌，原有下跌趋势不变'
    },
    '阴线': {
      '低换手': '下跌缩量阴线：卖盘持续流出，无企稳信号',
      '正常换手': '下跌缩量阴线：抛压缓慢释放，下跌动能仍存'
    },
    '上影线': {
      '低换手': '下跌缩量上影：短线拉试，遇压回落',
      '正常换手': '下跌缩量上影：企稳信号微弱'
    },
    '下影线': {
      '低换手': '下跌缩量下影：短暂止跌，仍需后续K线验证',
      '正常换手': '下跌缩量下影：原有跌势难以快速反转'
    },
    '上下影线': {
      '低换手': '下跌缩量上下影：多头力量不足',
      '正常换手': '下跌缩量上下影：博弈加剧，等待方向选择'
    },
    '十字星': {
      '低换手': '下跌缩量十字星：抛压衰减，止跌力度不足',
      '正常换手': '下跌缩量十字星：需要下一根K线确认方向'
    },
    '假阳线': {
      '低换手': '下跌缩量假阳：多头反攻失败',
      '正常换手': '下跌缩量假阳：反弹无力，不改下跌趋势'
    },
    '假阴线': {
      '低换手': '下跌缩量假阴：高开诱多，空头占优',
      '正常换手': '下跌缩量假阴：高开诱多，空头占优'
    }
  },
  '上涨': {
    '涨停': {
      '低换手': '上升缩量涨停：筹码稳定锁定，上涨持续性强',
      '正常换手': '上升缩量涨停：少量消化浮筹，趋势健康'
    },
    '阳线': {
      '低换手': '上升缩量阳线：筹码稳定，趋势延续',
      '正常换手': '上升缩量阳线：小幅消化获利盘'
    },
    '阴线': {
      '低换手': '上升缩量阴线：回调空间有限',
      '正常换手': '上升缩量阴线：清洗浮筹，下方支撑良好'
    },
    '上影线': {
      '低换手': '上升缩量上影：少量获利盘兑现离场',
      '正常换手': '上升缩量上影：测试压力，清洗浮筹'
    },
    '下影线': {
      '低换手': '上升缩量下影：支撑牢固',
      '正常换手': '上升缩量下影：上涨途中回踩确认支撑'
    },
    '上下影线': {
      '低换手': '上升缩量上下影：趋势保持完好',
      '正常换手': '上升缩量上下影：清洗浮筹，等待方向选择'
    },
    '十字星': {
      '低换手': '上升缩量十字星：大概率中继休整',
      '正常换手': '上升缩量十字星：上涨趋势暂未破坏'
    },
    '假阳线': {
      '低换手': '上升缩量假阳：筹码保持稳定',
      '正常换手': '上升缩量假阳：多头动能衰减'
    },
    '假阴线': {
      '低换手': '上升缩量假阴：整体趋势完好',
      '正常换手': '上升缩量假阴：清洗短线获利筹码'
    }
  },
  '高位': {
    '涨停': {
      '低换手': '高位缩量涨停：末期拉升，买盘不足；低换手下主力出货空间不足',
      '正常换手': '高位缩量涨停：末期拉升，买盘不足；追高资金减少，主力难以大规模兑现筹码'
    },
    '阳线': {
      '低换手': '高位缩量阳线：多头乏力，风险累积；筹码没有大规模出逃',
      '正常换手': '高位缩量阳线：多头乏力，风险累积；多头承接减弱，趋势存在反转隐患'
    },
    '阴线': {
      '低换手': '高位缩量阴线：抛压初步显现；抛压刚刚出现',
      '正常换手': '高位缩量阴线：抛压初步显现；多头承接减弱，趋势存在反转隐患'
    },
    '上影线': {
      '低换手': '高位缩量上影：冲高遇压；少量资金兑现筹码',
      '正常换手': '高位缩量上影：冲高遇压；借冲高派发筹码'
    },
    '下影线': {
      '低换手': '高位缩量下影：盘中下探，诱多托底；属于护盘假象',
      '正常换手': '高位缩量下影：盘中下探，诱多托底；盘中托底力量有限'
    },
    '上下影线': {
      '低换手': '高位缩量上下影：多空小幅争夺；上涨动能逐步衰减',
      '正常换手': '高位缩量上下影：多空小幅争夺；主力分批小幅出货'
    },
    '十字星': {
      '低换手': '高位缩量十字星：上涨停滞，多头进攻放缓；多头停止进攻',
      '正常换手': '高位缩量十字星：上涨停滞，多头进攻放缓；获利盘持续兑现'
    },
    '假阳线': {
      '低换手': '高位缩量假阳：低开回升，上涨动能不足；多头进攻意愿不足',
      '正常换手': '高位缩量假阳：低开回升，上涨动能不足；进入高位筑顶阶段'
    },
    '假阴线': {
      '低换手': '高位缩量假阴：高开低走，做多意愿不足；主力尝试小批量出货',
      '正常换手': '高位缩量假阴：高开低走，做多意愿不足；吸引追高资金兑现筹码'
    }
  }
};

const STAGES = Object.keys(RULES);
const PATTERNS = Object.keys(RULES['震荡']);

// ---------- 纯函数：取字段（兼容多名字） ----------
function _n(r, names) {
  if (!r) return 0;
  for (const n of names) {
    const v = r[n];
    if (v != null && isFinite(+v)) return +v;
  }
  return 0;
}

// ---------- 趋势阶段判定 ----------
// 返回：'高位' / '上涨' / '下跌' / '震荡' / null（数据不足）
function detectStage(rows, opts) {
  if (!rows || rows.length < 25) return null;
  const o = { ...DEFAULTS, ...(opts || {}) };
  const closes = rows.map(r => _n(r, ['close', 'c'])).filter(v => v > 0);
  if (closes.length < 25) return null;
  const i = rows.length - 1;
  const price = closes[closes.length - 1];
  const ma20now = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const prev20 = closes.slice(-21, -1);
  const ma20prev = prev20.length >= 20 ? prev20.reduce((s, v) => s + v, 0) / 20 : ma20now;
  const ma20up = ma20now >= ma20prev * o.ma20UpSlope;
  const ma20down = ma20now <= ma20prev * o.ma20DownSlope;

  // 近20日高/低与累计涨幅
  const window20 = rows.slice(-20);
  const highs20 = window20.map(r => _n(r, ['high', 'h'])).filter(v => v > 0);
  const lows20 = window20.map(r => _n(r, ['low', 'l'])).filter(v => v > 0);
  const hi20 = highs20.length ? Math.max(...highs20) : 0;
  const lo20 = lows20.length ? Math.min(...lows20) : 0;
  const base20 = rows.length >= 21 ? _n(rows[rows.length - 21], ['close', 'c']) : lo20;
  const rally20 = (base20 > 0 && price > 0) ? (price - base20) / base20 * 100 : 0;

  // 连续大涨高位：贴近20日高点 + 累计涨幅大
  if (hi20 > 0 && price >= hi20 * o.highProximity && rally20 >= o.highRallyPct) {
    return '高位';
  }
  // 上涨/下跌：用 MA20 斜率 + 价格相对 MA20 位置
  if (ma20up && price > ma20now) return '上涨';
  if (ma20down && price < ma20now) return '下跌';
  return '震荡';
}

// ---------- K线形态判定 ----------
// 返回：{ pattern, detail } / null
function detectPattern(r, code, name) {
  if (!r) return null;
  const o = r.open != null ? +r.open : 0;
  const c = r.close != null ? +r.close : 0;
  const h = r.high != null ? +r.high : 0;
  const l = r.low != null ? +r.low : 0;
  const pct = r.pct != null ? +r.pct : 0;
  if (!(o > 0) || !(c > 0) || !(h > 0) || !(l > 0)) return null;
  const rng = h - l;
  const body = Math.abs(c - o);
  const upper = rng > 0 ? (h - Math.max(o, c)) / rng : 0;
  const lower = rng > 0 ? (Math.min(o, c) - l) / rng : 0;

  // 1. 涨停（必须最先判，涨停日其它形态不重要）
  if (A.isLimitUp(String(code || ''), String(name || ''), pct)) {
    return { pattern: '涨停', upper, lower, body, rng };
  }

  // 2. 假阳 / 假阴（按收盘价红绿与当日涨跌方向相反）
  if (c > o && pct < 0) return { pattern: '假阳线', upper, lower, body, rng };
  if (c < o && pct > 0) return { pattern: '假阴线', upper, lower, body, rng };

  // 3. 十字星
  if (rng > 0 && body / rng <= DEFAULTS.dojiBodyRatio) {
    return { pattern: '十字星', upper, lower, body, rng };
  }

  // 4. 上下影线 / 上影线 / 下影线（影线显著）
  const hasUpper = upper >= DEFAULTS.shadowRatio;
  const hasLower = lower >= DEFAULTS.shadowRatio;
  if (hasUpper && hasLower) return { pattern: '上下影线', upper, lower, body, rng };
  if (hasUpper) return { pattern: '上影线', upper, lower, body, rng };
  if (hasLower) return { pattern: '下影线', upper, lower, body, rng };

  // 5. 阳线 / 阴线
  if (c >= o) return { pattern: '阳线', upper, lower, body, rng };
  return { pattern: '阴线', upper, lower, body, rng };
}

// ---------- 缩量判定 ----------
// 返回 { isShrink: boolean, volRatio: number|null }
function isShrinkVolume(rows, idx, opts) {
  if (!rows || rows.length < 2) return { isShrink: false, volRatio: null };
  const o = { ...DEFAULTS, ...(opts || {}) };
  const i = Number.isFinite(idx) && idx >= 0 && idx < rows.length ? idx : rows.length - 1;
  const cur = _n(rows[i], ['volume', 'vol', 'v']);
  // 当日量必须真实存在（>0），否则不判缩量（避免同花顺延迟把 volume=0 误判为缩量）
  if (!(cur > 0)) return { isShrink: false, volRatio: null };
  const prev = [];
  for (let j = Math.max(0, i - 5); j < i; j++) {
    const v = _n(rows[j], ['volume', 'vol', 'v']);
    if (v > 0) prev.push(v);
  }
  if (prev.length < 3) return { isShrink: false, volRatio: null };
  const avg = prev.reduce((s, v) => s + v, 0) / prev.length;
  const volRatio = avg > 0 ? cur / avg : null;
  return {
    isShrink: volRatio != null && volRatio < o.shrinkThresh,
    volRatio: volRatio == null ? null : +volRatio.toFixed(2)
  };
}

// ---------- 换手档位 ----------
function turnoverLevel(turnover, opts) {
  if (turnover == null) return null;
  const t = Number(turnover);
  if (!isFinite(t) || t < 0) return null;
  const o = { ...DEFAULTS, ...(opts || {}) };
  return t < o.lowTurnoverThresh ? '低换手' : '正常换手';
}

// ---------- 主入口 ----------
// opts: { shrinkThresh, lowTurnoverThresh, highRallyPct, highProximity, ... }
// 返回 null（数据不足/非缩量柱）或 { stage, pattern, turnoverLevel, isShrink, volRatio, interpretation, risk }
function klineLangOf({ rows, idx, code, name, opts }) {
  if (!rows || rows.length < 25) return null;
  const i = Number.isFinite(idx) && idx >= 0 && idx < rows.length ? idx : rows.length - 1;
  const r = rows[i];
  if (!r) return null;

  const stage = detectStage(rows, opts);
  if (!stage) return null;

  const pat = detectPattern(r, code, name);
  if (!pat) return null;

  const toLvl = turnoverLevel(_n(r, ['turnover']), opts);
  if (!toLvl) return null;

  const { isShrink, volRatio } = isShrinkVolume(rows, i, opts);
  // 本库专解缩量柱；非缩量柱返回 null，由调用方决定是否展示。
  if (!isShrink) return null;

  const interpretation = (RULES[stage] && RULES[stage][pat.pattern] && RULES[stage][pat.pattern][toLvl]) || null;
  if (!interpretation) return null;

  // 风险标签（仅做方向性提示，不做交易建议）
  let risk = '中性';
  if (stage === '高位') risk = '警惕';
  else if (stage === '下跌' && ['阳线', '下影线', '十字星', '假阳线'].includes(pat.pattern)) risk = '观察';
  else if (stage === '上涨' && ['阴线', '上影线', '十字星'].includes(pat.pattern)) risk = '健康回调';
  else if (stage === '震荡' && ['涨停', '十字星', '假阳线', '假阴线'].includes(pat.pattern)) risk = '观察';

  return {
    stage,
    pattern: pat.pattern,
    turnoverLevel: toLvl,
    isShrink: true,
    volRatio,
    interpretation,
    risk,
    // 原始形态数值（供面板或回测使用）
    upper: +pat.upper.toFixed(2),
    lower: +pat.lower.toFixed(2),
    body: pat.rng > 0 ? +(pat.body / pat.rng).toFixed(2) : null,
    turnover: +_n(r, ['turnover']).toFixed(2)
  };
}

// ---------- 批量：为最近 N 根 K线生成缩量柱语言（用于面板时间轴） ----------
function klineLangSeries(rows, { code, name, maxDays = 20, opts } = {}) {
  if (!rows || rows.length < 25) return [];
  const out = [];
  const n = Math.min(maxDays, rows.length);
  for (let k = rows.length - n; k < rows.length; k++) {
    const item = klineLangOf({ rows, idx: k, code, name, opts });
    if (item) {
      const d = String(rows[k].date || '').replace(/-/g, '');
      out.push({ date: d, ...item });
    }
  }
  return out;
}

module.exports = {
  DEFAULTS,
  RULES,
  STAGES,
  PATTERNS,
  detectStage,
  detectPattern,
  isShrinkVolume,
  turnoverLevel,
  klineLangOf,
  klineLangSeries
};
