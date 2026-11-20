import { limitPrice, ma, type Quote, type Candle } from './market'
export const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50)
export const ret = (r: Candle[], n: number) =>
  r.length > n ? (r.at(-1)!.c / r.at(-1 - n)!.c - 1) * 100 : NaN
export const stale = (q: Quote) => q.now - q.asOf > 900000 || q.now < q.asOf
export const range = (rows: Candle[]) =>
  Math.max(...rows.map((r) => r.h)) / Math.min(...rows.map((r) => r.l)) - 1
export const compressed = (r: Candle[]) => r.length >= 11 && range(r.slice(-6, -1)) < range(r.slice(-11, -6))
const yes = (v: boolean) => (v ? 100 : 0)
const band = (x: number, a: number, b: number) => x >= a && x <= b
type Eval = (q: Quote, r: Candle[]) => number
function factor(
  id: string,
  name: string,
  group: string,
  window: number,
  direction: 'high' | 'low' | 'mid',
  formula: string,
  learn: string,
  fail: string,
  evaluate: Eval,
) {
  return {
    id,
    name,
    group,
    window,
    direction,
    formula,
    learn,
    fail,
    scoreFactor(q: Quote, r: Candle[]) {
      if ((group === '资金' && stale(q)) || r.length < window) return 50
      return clamp(evaluate(q, r))
    },
  }
}
export const FACTORS = [
  factor(
    'ma_bull',
    '均线多头',
    '趋势',
    20,
    'high',
    '收盘>MA5>MA10>MA20',
    '观察不同周期是否同步走强。',
    '高位一字板可能无法参与。',
    (q) => yes(q.price > q.ma5 && q.ma5 > q.ma10 && q.ma10 > q.ma20),
  ),
  factor(
    'above_ma5',
    '短线强弱',
    '趋势',
    5,
    'high',
    '收盘>MA5',
    '观察五日成本线。',
    '次日低开可使信号消失。',
    (q) => yes(q.aboveMa5),
  ),
  factor(
    'ma20_slope',
    '中期斜率',
    '趋势',
    25,
    'high',
    'MA20高于五日前',
    '观察中期方向。',
    '震荡期方向反复。',
    (q, r) =>
      yes(
        q.ma20 >
          ma(
            r.slice(0, -5).map((x) => x.c),
            20,
          )!,
      ),
  ),
  factor(
    'bias_ma5',
    '五日乖离',
    '趋势',
    5,
    'mid',
    '绝对乖离≤3%为100，向上超过8%为0，其余50',
    '观察价格偏离均线的程度。',
    '强趋势可持续远离均线。',
    (q) => (q.price / q.ma5 > 1.08 ? 0 : Math.abs(q.price / q.ma5 - 1) <= 0.03 ? 100 : 50),
  ),
  ...[5, 20].map((n) =>
    factor(
      'ret_' + n,
      n + '日动量',
      '动量',
      n + 1,
      'high',
      '50+2×区间涨幅百分数',
      '观察区间价格是否持续走强。',
      n === 5 ? '连板末端动量仍高。' : '主线切换后老龙头仍有惯性。',
      (_, r) => 50 + 2 * ret(r, n),
    ),
  ),
  factor(
    'new_high_60',
    '六十日新高',
    '动量',
    60,
    'high',
    '收盘≥60日最高',
    '观察长期平台突破。',
    '次日可能跌回平台。',
    (q) => yes(q.brokeHigh),
  ),
  factor(
    'limit_momentum',
    '涨停频率',
    '动量',
    11,
    'high',
    '十日涨停次数×25',
    '观察情绪弹性。',
    '连板后容易快速反转。',
    (q, r) => r.slice(-10).filter((x, i) => x.c === limitPrice(q.code, r.at(i - 11)!.c)).length * 25,
  ),
  factor(
    'volume_ratio',
    '放量确认',
    '量价',
    1,
    'mid',
    '1.5至3得100，超过5得10，其余50',
    '观察适度放量。',
    '巨量也可能来自派发。',
    (q) => (band(q.volumeRatio, 1.5, 3) ? 100 : q.volumeRatio > 5 ? 10 : 50),
  ),
  factor(
    'turnover_fit',
    '换手适配',
    '量价',
    1,
    'mid',
    '3至15得100，低于1或超过25得10，其余50',
    '观察筹码交换。',
    '低流通盘换手容易失真。',
    (q) => (band(q.turnover, 3, 15) ? 100 : q.turnover < 1 || q.turnover > 25 ? 10 : 50),
  ),
  factor(
    'vol_price_up',
    '价涨量增',
    '量价',
    6,
    'high',
    '上涨且量超过前五日均量',
    '观察上涨是否获得成交支持。',
    '尾盘对倒可能抬高成交量。',
    (q, r) =>
      yes(
        q.chg > 0 &&
          q.volume >
            ma(
              r.slice(0, -1).map((x) => x.v),
              5,
            )!,
      ),
  ),
  factor(
    'shrink_pullback',
    '缩量回踩',
    '量价',
    12,
    'high',
    '回调且量低于前十日上涨日均量七成，收盘>MA10',
    '观察回调时抛压。',
    '流动性枯竭也会缩量。',
    (q, r) => {
      const up = r.slice(-11, -1).filter((x, i) => x.c > (r.at(i - 12)?.c ?? Infinity))
      return yes(
        q.chg < 0 &&
          q.price > q.ma10 &&
          q.volume <
            0.7 *
              (ma(
                up.map((x) => x.v),
                up.length,
              ) ?? 0),
      )
    },
  ),
  factor(
    'amplitude',
    '振幅带',
    '波动',
    1,
    'mid',
    '4至9得100，超过12得10，其余50',
    '观察可交易的波动范围。',
    '涨跌停限制压缩振幅。',
    (q) => (band(q.amplitude, 4, 9) ? 100 : q.amplitude > 12 ? 10 : 50),
  ),
  factor(
    'atr_compress',
    '振幅收窄后扩张',
    '波动',
    11,
    'high',
    '后五日区间小于前五日，今日振幅超过昨日',
    '观察平台末端。',
    '放大可能向下破位。',
    (_, r) => yes(compressed(r) && range(r.slice(-1)) > range(r.slice(-2, -1))),
  ),
  factor(
    'seal_strength',
    '封单占比',
    '涨停结构',
    1,
    'high',
    '封单万元÷流通市值亿元，同单位占比1%得100',
    '观察封板资金相对规模。',
    '大封单可能反复撤回。',
    (q) => (q.limitUp ? q.sealAmount / q.floatCap : 0),
  ),
  factor(
    'open_count',
    '开板次数',
    '涨停结构',
    1,
    'low',
    '封板时0次100、1次70、其余20',
    '观察封板一致性。',
    '尾盘首次封板观察期短。',
    (q) => (q.limitUp ? ([100, 70][q.openCount] ?? 20) : 0),
  ),
  factor(
    'seal_time',
    '首封时点',
    '涨停结构',
    1,
    'low',
    '10点前100，14点半后10，其余60',
    '观察先手与跟风。',
    '早封也可能反复开板。',
    (q) => (q.limitUp && q.firstSeal ? (q.firstSeal < '10:00' ? 100 : q.firstSeal > '14:30' ? 10 : 60) : 0),
  ),
  factor(
    'promote',
    '连续晋级',
    '涨停结构',
    3,
    'high',
    '连续收盘涨停≥2',
    '观察次日能否继续封板。',
    '高位晋级后可能断板。',
    (q) => yes(q.boards >= 2),
  ),
  factor(
    'main_net',
    '主力占比',
    '资金',
    1,
    'high',
    '净额>0且占比上升',
    '观察大单方向。',
    '尾盘流入可能次日回吐。',
    (q) => yes(q.mainNet > 0 && (q.mainNet * 1e8) / q.amount > q.prevMainShare),
  ),
  factor(
    'north_net',
    '北向同向',
    '资金',
    1,
    'high',
    '上涨且北向净额为正，小于50亿元中性',
    '观察资金与价格方向。',
    '小盘覆盖有限。',
    (q) => (q.floatCap < 50 ? 50 : yes(q.chg > 0 && q.northNet > 0)),
  ),
  factor(
    'sector_rank',
    '板块流入排名',
    '资金',
    1,
    'low',
    '排名≤5得100',
    '观察资金主线。',
    '板块强时跟风股仍可能走弱。',
    (q) => yes(q.sector.rank <= 5),
  ),
  factor(
    'lhb_inst',
    '机构席位',
    '资金',
    1,
    'high',
    '机构净买得100，同一路游资集中卖出扣30',
    '观察席位对手盘。',
    '机构席位也会短线交易。',
    (q) => {
      const seats = (q.lhb?.sellSeat ?? '')
        .split(/[、，,；;]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const concentrated = seats.some(
        (seat) =>
          seat.includes('游资') &&
          seats.filter((other) => other === seat).length >= Math.max(2, Math.ceil(seats.length / 2)),
      )
      const institutional = q.lhb?.buySeat.includes('机构') && q.lhb.net > 0
      return (institutional ? 100 : 50) - (concentrated ? 30 : 0)
    },
  ),
  factor(
    'theme_rank',
    '题材名次',
    '题材',
    1,
    'low',
    '前三得100',
    '观察题材集中度。',
    '主线可能迅速切换。',
    (q) => yes(q.themeRank <= 3),
  ),
  factor(
    'role_score',
    '板块角色',
    '题材',
    1,
    'high',
    '龙头90、龙二75、中军70、跟风45、无30',
    '观察个股在板块中的位置。',
    '龙头也有拥挤风险。',
    (q) => ({ 龙头: 90, 龙二: 75, 中军: 70, 跟风: 45, 无: 30 })[q.role],
  ),
  factor(
    'news_score',
    '消息方向',
    '题材',
    1,
    'high',
    '(新闻分+100)/2，负面封顶40',
    '观察事件催化。',
    '消息可能已被计价。',
    (q) => Math.min(q.newsScore < 0 ? 40 : 100, (q.newsScore + 100) / 2),
  ),
  factor(
    'broken_penalty',
    '炸板扣分',
    '风险',
    1,
    'low',
    '炸板扣25',
    '观察封板失败。',
    '次日可能修复。',
    (q) => (q.broken ? 25 : 0),
  ),
  factor(
    'high_position',
    '高位上限',
    '风险',
    1,
    'low',
    '五日涨幅>25%或连板≥4封顶60',
    '观察拥挤程度。',
    '强趋势可能持续。',
    (q, r) => yes(q.boards >= 4 || ret(r, 5) > 25),
  ),
  factor(
    'data_stale',
    '数据时效',
    '风险',
    1,
    'low',
    '超过15分钟资金因子中性',
    '观察证据时点。',
    '休市快照无法描述新交易日。',
    (q) => yes(stale(q)),
  ),
]
const weights: Record<string, number> = {
  趋势: 0.22,
  动量: 0.18,
  量价: 0.18,
  涨停结构: 0.16,
  资金: 0.16,
  题材: 0.1,
}
export function learning(q: Quote, r: Candle[]) {
  const scores = Object.fromEntries(FACTORS.map((f) => [f.id, f.scoreFactor(q, r)]))
  const groups: Record<string, number> = {}
  const evidence: { text: string; points: number }[] = []
  for (const [group, weight] of Object.entries(weights)) {
    const factors = FACTORS.filter((f) => f.group === group)
    groups[group] = factors.reduce((s, f) => s + scores[f.id], 0) / factors.length
    for (const f of factors)
      evidence.push({
        text: f.name + ' ' + scores[f.id].toFixed(0) + '分：' + f.learn,
        points: (scores[f.id] * weight) / factors.length,
      })
  }
  const base = evidence.reduce((s, e) => s + e.points, 0),
    after = base - scores.broken_penalty
  const score = clamp(Math.min(after, scores.high_position ? 60 : 100))
  const penalty =
    after - score > scores.broken_penalty
      ? '高位拥挤，学习分封顶60'
      : scores.broken_penalty
        ? '炸板扣25分'
        : null
  return {
    score,
    scores,
    groups,
    penalty,
    explain: evidence
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((e) => e.text),
  }
}
