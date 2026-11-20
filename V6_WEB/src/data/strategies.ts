import {
  CANDLES,
  STOCKS,
  SNAPSHOT,
  limitPrice,
  ma,
  readMarket,
  streak,
  seriesFor,
  type Quote,
  type Stock,
  type Candle,
} from './market'
import { learning, ret, range, compressed, stale } from './factors'
export const POSITION_NOTE = '教学仓位，不是下单指令'
type Position = '空仓' | '轻仓' | '半仓' | '主仓'
type Family = '趋势' | '情绪' | '资金' | '事件' | '风控'
const between = (x: number, l: number, h: number) => x >= l && x <= h
const top = (r: Candle[]) => Math.max(...r.map((x) => x.h))
function context(q: Quote, rows: Candle[]) {
  const prior = rows.slice(0, -1),
    y = prior.at(-1)!,
    result = learning(q, rows)
  const breadth = q.index.brokenCount / (q.index.limitUpCount + q.index.brokenCount || 1)
  const brokenDay = (i: number) => {
    const bar = rows.at(i)!,
      limit = limitPrice(q.code, rows.at(i - 1)!.c)
    return bar.h >= limit && bar.c < limit
  }
  return {
    ...result,
    rows,
    prior,
    y,
    r5: ret(rows, 5),
    r20: ret(rows, 20),
    high20: top(prior.slice(-20)),
    yBoards: streak(q.code, prior),
    priorFailure: brokenDay(-2) || (y.h - Math.max(y.c, y.o)) / (y.h - y.l || 1) > 0.5,
    recentBreak: brokenDay(-2) || brokenDay(-3),
    gap: (q.open / q.prevClose - 1) * 100,
    earlyRed: earlyRed(q),
    breadth,
    ice: q.index.limitUpCount < 25 && breadth > 0.25,
    risk: q.broken || stale(q) || q.dailyLoss < 0 || q.drawdown > 0,
    crowded: q.boards >= 4 || ret(rows, 5) > 25,
    finalist: false,
    mainline: false,
    divergence: false,
    hits: 0,
  }
}
function earlyRed(q: Quote) {
  let touchedPreviousClose = false
  return seriesFor(q.code, '1分')
    .slice(0, 15)
    .some((bar) => {
      touchedPreviousClose ||= bar.l <= q.prevClose
      return touchedPreviousClose && bar.c > q.prevClose
    })
}
type Factors = ReturnType<typeof context>
type Test = (q: Quote, f: Factors) => boolean
type Detail = (q: Quote, f: Factors) => string
function strategy(id: string, name: string, family: Family, rule: string, test: Test, detail?: Detail) {
  return {
    id,
    name,
    family,
    rule,
    horizon: '当日复盘',
    need: {
      趋势: '日K、均线、量能',
      情绪: '个股封板记录、市场宽度、板块角色',
      资金: '资金原始时点、净额与板块排名',
      事件: '事件日期、新闻分与股价',
      风控: '报价时点、涨停结构与账户风险',
    }[family],
    score(q: Quote, f: Factors) {
      const hit = test(q, f)
      let position: Position = hit ? '半仓' : '空仓'
      if (hit && id === 'multi') position = f.score >= 90 ? '主仓' : f.score >= 80 ? '半仓' : '轻仓'
      if (hit && (id === 'crowd_off' || ((id === 'ladder_follow' || id === 'py3') && f.crowded)))
        position = '轻仓'
      if (
        ['volume_dry', 'eight', 'emotion_ice', 'risk_gate'].includes(id) ||
        (id === 'event' && q.limitUp) ||
        (family === '情绪' && f.ice)
      )
        position = '空仓'
      if (position === '主仓' && f.risk) position = stale(q) ? '空仓' : '半仓'
      return {
        hit,
        score:
          id === 'multi'
            ? f.score
            : id === 'fourteen'
              ? (fourteen(q, f) / 14) * 100
              : hit
                ? 100
                : id === 'auction_strong' && f.gap <= 6
                  ? 30
                  : 0,
        position,
        note: [
          detail?.(q, f) ?? (hit ? rule : '条件未齐'),
          family === '情绪' && f.ice ? '冰点，仅观察' : '',
          POSITION_NOTE,
        ]
          .filter(Boolean)
          .join('。'),
      }
    },
  }
}
function fourteen(q: Quote, f: Factors) {
  return [
    q.price > q.open,
    q.price > q.ma5,
    q.price > q.ma10,
    q.ma5 > q.ma10,
    q.volumeRatio >= 1.2,
    between(q.turnover, 3, 15),
    q.amplitude < 10,
    !q.broken,
    f.r5 > 0,
    f.r20 > 0,
    q.price > f.high20 * 0.97,
    q.sector.rank <= 8,
    q.newsScore >= 0,
    q.openCount <= 1,
  ].filter(Boolean).length
}
function gapHeld(f: Factors) {
  return [1, 2, 3].some((age) => {
    const i = f.rows.length - 1 - age,
      bar = f.rows[i],
      edge = f.rows[i - 1].h
    return (
      bar.l > edge &&
      bar.v >
        1.5 *
          ma(
            f.rows.slice(0, i).map((x) => x.v),
            5,
          )! &&
      f.rows.slice(i + 1).every((b) => b.l > edge)
    )
  })
}
const rules = [
  strategy('multi', '多因子评分', '趋势', '学习分≥70', (q, f) => f.score >= 70),
  strategy(
    'fourteen',
    '十四条选股',
    '趋势',
    '收阳、站上MA5、站上MA10、MA5>MA10、量比≥1.2、换手3–15%、振幅<10%、未炸板、5日和20日涨幅各为正、距20日高点<3%、板块前8、新闻非负、开板≤1，满足至少10项',
    (q, f) => fourteen(q, f) >= 10,
    (q, f) => '通过 ' + fourteen(q, f) + '/14 项',
  ),
  strategy(
    'eight',
    '八字口诀',
    '趋势',
    '相对MA10偏离−3%至0，回调且量比<1',
    (q) => between(q.price / q.ma10, 0.97, 1) && q.chg < 0 && q.volumeRatio < 1,
    () => '等待放量',
  ),
  strategy(
    'gpt5',
    'GPT五策略',
    '趋势',
    '事件、情绪、主题、资金、风控五门均≥60，任一低于40否决',
    (q, f) =>
      Math.min(f.scores.news_score, f.groups.涨停结构, f.groups.题材, f.groups.资金, f.risk ? 0 : 100) >= 60,
  ),
  strategy(
    'py3',
    'Python三轮',
    '趋势',
    '剔除炸板和ST后取学习分前30%，高位降轻仓',
    (_, f) => f.finalist,
    (_, f) => (f.crowded ? '高位拥挤风险' : '按第一轮合格样本排序'),
  ),
  strategy(
    'tech',
    '技术形态',
    '趋势',
    '十日区间收窄，量比>1，突破前20日高点且距日高≤1%',
    (q, f) => compressed(f.rows) && q.volumeRatio > 1 && q.price > f.high20 && q.price >= q.high * 0.99,
  ),
  strategy(
    'flow',
    '资金博弈',
    '资金',
    '主力净额>0、板块前5、量比1.2–3',
    (q) => !stale(q) && q.mainNet > 0 && q.sector.rank <= 5 && between(q.volumeRatio, 1.2, 3),
  ),
  strategy(
    'main',
    '主力行为',
    '资金',
    '封单强度≥70或机构净买，开板≤1',
    (q, f) =>
      !stale(q) &&
      (f.scores.seal_strength >= 70 || (!!q.lhb?.buySeat.includes('机构') && q.lhb.net > 0)) &&
      q.openCount <= 1,
  ),
  strategy(
    'event',
    '事件驱动',
    '事件',
    '新闻≥60且涨幅>2%',
    (q) => q.newsScore >= 60 && q.chg > 2,
    (q) => (q.limitUp ? '催化已兑现，只观察不追' : '核对新闻与价格反应'),
  ),
  strategy(
    'rotate',
    '行业轮动',
    '资金',
    '板块五日涨幅转正、流入排名上升，角色为龙头或中军',
    (q) =>
      !stale(q) &&
      q.sector.prevChange5d <= 0 &&
      q.sector.change5d > 0 &&
      q.sector.rank < q.sector.prevRank &&
      ['龙头', '中军'].includes(q.role),
  ),
  strategy(
    'value',
    '价值成长',
    '趋势',
    '未涨停、20日涨幅0–15%、换手<8%、学习分≥55',
    (q, f) => !q.limitUp && between(f.r20, 0, 15) && q.turnover < 8 && f.score >= 55,
  ),
  strategy(
    'first_board',
    '首板先手',
    '情绪',
    '昨日连板数0、今日涨停、首封≤10:30、开板0、板块前5',
    (q, f) =>
      !f.yBoards &&
      q.limitUp &&
      !!q.firstSeal &&
      q.firstSeal <= '10:30' &&
      !q.openCount &&
      q.sector.rank <= 5,
  ),
  strategy(
    'second_board',
    '一进二',
    '情绪',
    '昨日首板、今日再封、开板≤1、最后封板≤11:00',
    (q, f) => f.yBoards === 1 && q.limitUp && q.openCount <= 1 && !!q.lastSeal && q.lastSeal <= '11:00',
  ),
  strategy(
    'ladder_follow',
    '连板接力',
    '情绪',
    '2板以上且龙头或龙二、炸板率<15%，4板以上降轻仓',
    (q, f) => q.boards >= 2 && ['龙头', '龙二'].includes(q.role) && f.breadth < 0.15,
    (q) => (q.boards >= 4 ? '高位接力风险' : '低于四板，核对板块角色'),
  ),
  strategy(
    'weak_to_strong',
    '弱转强',
    '情绪',
    '昨日炸板或长上影，今日高开0–3%、前15分钟翻红且量超昨日',
    (q, f) => f.priorFailure && f.gap > 0 && f.gap <= 3 && f.earlyRed && q.volume > f.y.v,
  ),
  strategy(
    'auction_strong',
    '竞价强度',
    '情绪',
    '高开1–4%，开盘量超过昨日同时段，超过6%降分',
    (q, f) => between(f.gap, 1, 4) && q.auctionVolume > q.prevAuctionVolume,
  ),
  strategy('divergence', '高标分歧', '情绪', '最高板开板，同板块其他个股今日首板', (_, f) => f.divergence),
  strategy(
    'repair',
    '炸板修复',
    '情绪',
    '近两日炸板，收盘站上MA5且今日未触板',
    (q, f) => f.recentBreak && q.aboveMa5 && q.high < limitPrice(q.code, q.prevClose),
  ),
  strategy('emotion_ice', '情绪冰点', '风控', '涨停<25且炸板率>25%，情绪策略空仓', (_, f) => f.ice),
  strategy(
    'mainline_only',
    '主线唯一',
    '情绪',
    '题材前三且非跟风，按学习分每日最多五只',
    (_, f) => f.mainline,
  ),
  strategy(
    'ma_pullback',
    '均线回踩',
    '趋势',
    'MA10>MA20，日内触及并收回MA10或MA20，收阳、量比<1.3',
    (q) =>
      q.ma10 > q.ma20 &&
      [q.ma10, q.ma20].some((m) => q.low <= m && q.price >= m) &&
      q.price > q.open &&
      q.volumeRatio < 1.3,
  ),
  strategy(
    'breakout_platform',
    '平台突破',
    '趋势',
    '前20日区间<12%，突破平台且量比>1.5',
    (q, f) => range(f.prior.slice(-20)) < 0.12 && q.price > f.high20 && q.volumeRatio > 1.5,
  ),
  strategy(
    'trend_mid',
    '中期趋势',
    '趋势',
    '收盘>MA20>MA60，MA60向上，距20日高点回撤<8%',
    (q, f) =>
      q.price > q.ma20 &&
      q.ma20 > q.ma60 &&
      q.ma60 >
        ma(
          f.prior.map((r) => r.c),
          60,
        )! &&
      q.price > f.high20 * 0.92,
  ),
  strategy('gap_hold', '跳空不补', '趋势', '前三日向上缺口量比>1.5，至今未补', (_, f) => gapHeld(f)),
  strategy(
    'volume_dry',
    '地量地价',
    '趋势',
    '量在20日最低20%分位且收盘在MA60上，仅观察',
    (q, f) =>
      q.volume <=
        f.rows
          .slice(-20)
          .map((r) => r.v)
          .sort((a, b) => a - b)[3] && q.price > q.ma60,
  ),
  strategy(
    'box_break',
    '箱体突破',
    '趋势',
    '前15日高低波动<8%且收盘突破箱顶',
    (q, f) => range(f.prior.slice(-15)) < 0.08 && q.price > top(f.prior.slice(-15)),
  ),
  strategy(
    'dragon_back',
    '龙头回封',
    '情绪',
    '龙头开板一次后回封，最后封板早于14:00',
    (q) => q.role === '龙头' && q.limitUp && q.openCount === 1 && !!q.lastSeal && q.lastSeal < '14:00',
  ),
  strategy(
    'anti_drop',
    '抗跌',
    '趋势',
    '指数下跌、个股涨幅>1%、板块前五',
    (q) => q.index.chg < 0 && q.chg > 1 && q.sector.rank <= 5,
  ),
  strategy(
    'north_trend',
    '北向趋势',
    '资金',
    '北向净额连续两日为正且未涨停',
    (q) => !stale(q) && q.northNet > 0 && q.northNet2 > 0 && !q.limitUp,
  ),
  strategy(
    'inst_lhb',
    '机构龙虎榜',
    '资金',
    '昨日买一机构净买，今日高开0–3%',
    (q, f) =>
      !stale(q) && !!q.previousLhb?.buySeat.includes('机构') && q.previousLhb.net > 0 && between(f.gap, 0, 3),
    (_, f) => (f.gap > 3 ? '溢价已用完' : '核对昨日席位及今日开盘'),
  ),
  strategy(
    'sector_spread',
    '板块扩散',
    '资金',
    '板块涨停至少3家且为中军',
    (q) => q.sector.limitUpCount >= 3 && q.role === '中军',
  ),
  strategy(
    'news_continue',
    '新闻延续',
    '事件',
    '两日内利好且消息以来未涨停',
    (q, f) =>
      q.newsAgeDays <= 2 &&
      q.newsScore > 0 &&
      f.rows
        .slice(-1 - q.newsAgeDays)
        .every((r, i) => r.c !== limitPrice(q.code, f.rows.at(i - 2 - q.newsAgeDays)!.c)),
  ),
  strategy(
    'crowd_off',
    '拥挤撤退',
    '风控',
    '5日涨幅>25%或连板≥4',
    (_, f) => f.crowded,
    () => '拥挤风险，教学减仓',
  ),
  strategy(
    'risk_gate',
    '风控门',
    '风控',
    '发生亏损、回撤、炸板或数据过期，限制主仓',
    () => false,
    (_, f) => (f.risk ? '风险触发，限制仓位' : '风控通过'),
  ),
  strategy(
    'combo',
    '策略共振',
    '趋势',
    '至少三项选股规则命中且风控通过',
    (_, f) => f.hits >= 3 && !f.risk,
    (_, f) => '选股规则命中 ' + f.hits + ' 项',
  ),
]
export const STRATEGIES = [
  ...rules,
  { id: 'more', name: '更多策略', family: '趋势', horizon: '', need: '', rule: '展开策略目录' },
]
export function screen(stocks = readMarket(SNAPSHOT).stocks) {
  const rows = stocks
    .map((q) => ({ q, f: context(q, CANDLES[q.code]) }))
    .sort((a, b) => b.f.score - a.f.score || a.q.code.localeCompare(b.q.code))
  const eligible = rows.filter(({ q }) => !q.broken && !/ST/i.test(q.name))
  eligible.slice(0, Math.ceil(eligible.length * 0.3)).forEach(({ f }) => {
    f.finalist = true
  })
  rows
    .filter(({ q }) => q.themeRank <= 3 && q.role !== '跟风')
    .slice(0, 5)
    .forEach(({ f }) => {
      f.mainline = true
    })
  const maxBoard = Math.max(...rows.map(({ q, f }) => Math.max(q.boards, f.yBoards)))
  const leaders = rows.filter(({ q, f }) => Math.max(q.boards, f.yBoards) === maxBoard && q.openCount > 0)
  return rows
    .map(({ q, f }) => {
      f.divergence = q.boards === 1 && maxBoard > 1 && leaders.some((l) => l.q.code !== q.code && l.q.theme === q.theme)
      const results = Object.fromEntries(
        rules.filter((s) => s.id !== 'combo').map((s) => [s.id, s.score(q, f)]),
      )
      f.hits = rules.filter((s) => s.id !== 'combo' && s.family !== '风控' && results[s.id].hit).length
      results.combo = rules.at(-1)!.score(q, f)
      return { quote: q, score: f.score, explain: f.explain, penalty: f.penalty, hits: f.hits, results }
    })
    .sort(
      (a, b) =>
        Number(b.results.combo.hit) - Number(a.results.combo.hit) ||
        b.hits - a.hits ||
        b.score - a.score ||
        a.quote.code.localeCompare(b.quote.code),
    )
}
export function matchStrategy(q: Stock & Partial<Quote>, id: string) {
  if (!STOCKS.some((stock) => stock.code === q.code)) return false
  const market = STOCKS.map((stock) => (stock.code === q.code ? { ...stock, ...q } : stock))
  return screen(market).find((row) => row.quote.code === q.code)?.results[id]?.hit ?? false
}
