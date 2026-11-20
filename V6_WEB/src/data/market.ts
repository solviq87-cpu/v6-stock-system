export const DISCLAIMER = '演示数据，不构成投资建议。'
export const PERIODS = ['分时', '1分', '5分', '15分', '30分', '60分', '日K', '周K', '月K'] as const
type Period = (typeof PERIODS)[number]
export interface Candle {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
}
const day = 86400000
export const SNAPSHOT = Date.parse('2026-11-17T15:40:00+08:00')
const cents = (x: number) => Math.round(x * 100) / 100
export const limitPrice = (code: string, p: number) =>
  Math.round((Math.round(p * 100) * (/^30/.test(code) ? 120 : 110)) / 100) / 100
export function ma(values: number[], n: number) {
  return Number.isInteger(n) && n > 0 && values.length >= n
    ? values.slice(-n).reduce((a, b) => a + b, 0) / n
    : null
}
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const fixtures = [
  ['002685', '华东重机', '装备', 3],
  ['002475', '立讯精密', '电子', -1],
  ['300750', '宁德时代', '能源', -1],
  ['600000', '浦发银行', '金融', 0],
  ['300124', '汇川技术', '装备', 1],
  ['600036', '招商银行', '金融', 0],
  ['002371', '北方华创', '电子', 0],
  ['300014', '亿纬锂能', '能源', 0],
] as const
const sectors = ['装备', '电子', '金融', '能源'].map((name, i) => ({
  name,
  rank: i + 1,
  netInflow: 4 - i * 1.7,
  change5d: 5 - i * 2,
  prevChange5d: -1,
  prevRank: 4 - i,
  leaderCode: fixtures.find((f) => f[2] === name)![0],
  limitUpCount: fixtures.filter((f) => f[2] === name && f[3] > 0).length,
}))
export type Sector = (typeof sectors)[number]
export const SECTORS_IN = sectors.filter((s) => s.netInflow >= 0)
export const SECTORS_OUT = sectors.filter((s) => s.netInflow < 0)
function history(code: string, boards: number) {
  const rng = mulberry32(+code),
    rows: Candle[] = []
  let prev = 10 + (+code % 50)
  const dates = Array.from({ length: 161 }, (_, i) => new Date(SNAPSHOT - (160 - i) * day)).filter(
    (date) => ![0, 6].includes(date.getUTCDay()),
  )
  for (const [i, date] of dates.entries()) {
    const cap = limitPrice(code, prev),
      o = cents(prev * (0.99 + rng() * 0.025))
    const c = dates.length - 1 - i < boards ? cap : cents(prev * (0.975 + rng() * 0.052))
    rows.push({
      t: date.toISOString().slice(0, 10),
      o,
      c,
      h:
        i === dates.length - 1 && boards < 0
          ? cap
          : Math.min(cap, cents(Math.max(o, c) * (1 + rng() * 0.015))),
      l: cents(Math.min(o, c) * (1 - rng() * 0.017)),
      v: Math.round(10000 + rng() * 40000),
    })
    prev = c
  }
  return rows
}
export const CANDLES = Object.fromEntries(fixtures.map(([code, , , boards]) => [code, history(code, boards)]))
export function streak(code: string, rows: Candle[]) {
  let count = 0
  for (let i = rows.length - 1; i > 0 && rows[i].c === limitPrice(code, rows[i - 1].c); i--) count++
  return count
}
export function aggregate(rows: Candle[], key: (r: Candle, i: number) => string) {
  const out: Candle[] = []
  let previous = ''
  rows.forEach((r, i) => {
    const k = key(r, i)
    if (k !== previous) {
      out.push({ ...r })
      previous = k
      return
    }
    const bar = out[out.length - 1]
    bar.h = Math.max(bar.h, r.h)
    bar.l = Math.min(bar.l, r.l)
    bar.c = r.c
    bar.v += r.v
    bar.t = r.t
  })
  return out
}
export function seriesFor(code: string, period: Period): Candle[] {
  const rows = CANDLES[code]
  if (!rows) return []
  if (period === '日K') return rows.map((r) => ({ ...r }))
  if (period === '月K') return aggregate(rows, (r) => r.t.slice(0, 7))
  if (period === '周K')
    return aggregate(rows, (r) => {
      const d = new Date(r.t)
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      return d.toISOString().slice(0, 10)
    })
  const last = rows.at(-1)!,
    minutes: Candle[] = [],
    rng = mulberry32(+code)
  let prev = last.o
  for (let i = 0; i < 240; i++) {
    const minute = (i < 120 ? 570 : 780) + (i % 120)
    const t = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')
    const c =
      i === 239
        ? last.c
        : cents(
            Math.min(
              last.h,
              Math.max(
                last.l,
                last.o + ((last.c - last.o) * i) / 239 + (rng() - 0.5) * (last.h - last.l) * 0.1,
              ),
            ),
          )
    minutes.push({
      t,
      o: prev,
      c,
      h: i === 200 ? last.h : Math.max(prev, c),
      l: i === 20 ? last.l : Math.min(prev, c),
      v: Math.floor((last.v * (i + 1)) / 240) - Math.floor((last.v * i) / 240),
    })
    prev = c
  }
  const n = period === '分时' ? 5 : parseInt(period)
  return aggregate(minutes, (_, i) => String(Math.floor(i / n))).map((r, i) => ({
    ...r,
    t: minutes[i * n].t,
  }))
}
export const INDICES = [
  {
    id: 'sh',
    name: '上证指数',
    value: 3400,
    chg: -0.3,
    delta: -10.23,
    spark: [3410, 3408, 3400],
    amount: 5600,
    upCount: 1900,
    downCount: 2800,
    limitUpCount: 52,
    limitDownCount: 5,
    brokenCount: 6,
  },
]
export type IndexQuote = (typeof INDICES)[number]
export type Stock = {
  code: string
  name: string
  tag: string
  prob: number | null
  target: number | null
  logic: string
  price: number
  chg: number
  theme: string
  boards: number
  limitUp: boolean
  broken: boolean
}
export type Role = '龙头' | '龙二' | '中军' | '跟风' | '无'
function makeStocks() {
  return fixtures.map(([code, name, theme], i) => {
    const rows = CANDLES[code],
      last = rows.at(-1)!,
      prev = rows.at(-2)!.c,
      closes = rows.map((r) => r.c)
    const sector = sectors.find((s) => s.name === theme)!,
      cap = limitPrice(code, prev),
      limitUp = last.c === cap,
      broken = last.h >= cap && !limitUp
    const role: Role = sector.leaderCode === code ? '龙头' : i % 2 ? '中军' : '龙二'
    const boards = streak(code, rows),
      price = last.c,
      ma5 = ma(closes, 5)!,
      high60 = Math.max(...rows.slice(-60).map((r) => r.h))
    return {
      code,
      name,
      theme,
      role,
      boards,
      limitUp,
      broken,
      price,
      tag: '教学样本',
      prob: null,
      target: null,
      logic: DISCLAIMER,
      chg: (price / prev - 1) * 100,
      prevClose: prev,
      open: last.o,
      high: last.h,
      low: last.l,
      volume: last.v,
      amount: (last.v * 100 * (last.o + price)) / 2,
      turnover: 3 + i,
      amplitude: ((last.h - last.l) / prev) * 100,
      volumeRatio:
        last.v /
        ma(
          rows.slice(0, -1).map((r) => r.v),
          5,
        )!,
      floatCap: 40 + i * 20,
      sealAmount: limitUp ? 12000 : 0,
      openCount: broken || boards >= 2 ? 1 : 0,
      firstSeal: limitUp || broken ? '09:48' : null,
      lastSeal: limitUp ? '10:15' : null,
      ma5,
      ma10: ma(closes, 10)!,
      ma20: ma(closes, 20)!,
      ma60: ma(closes, 60)!,
      aboveMa5: price > ma5,
      high60,
      brokeHigh: price >= high60,
      mainNet: 0.03 - i * 0.008,
      prevMainShare: 0.005,
      northNet: 0.01 - i * 0.002,
      northNet2: 0.008,
      lhb: i % 3 === 0 ? { buySeat: '机构专用', sellSeat: '营业部', net: 0.03 } : null,
      newsScore: 70 - i * 15,
      themeRank: sector.rank,
      sector,
      index: INDICES[0],
      asOf: SNAPSHOT,
      now: SNAPSHOT,
      newsAgeDays: 1,
      auctionVolume: 800 + i,
      prevAuctionVolume: 790,
      previousLhb: i === 3 ? { buySeat: '机构专用', net: 0.01 } : null,
      dailyLoss: 0,
      drawdown: 0,
    }
  })
}
type Sample = ReturnType<typeof makeStocks>[number]
export type Quote = Stock &
  Omit<Sample, keyof Stock | 'role' | 'lhb' | 'previousLhb'> & {
    role: Role
    lhb: { buySeat: string; sellSeat: string; net: number } | null
    previousLhb: { buySeat: string; net: number } | null
  }
export const STOCKS: Quote[] = makeStocks()
export const THEME_RANKS = sectors.map(({ name, rank, leaderCode }) => ({ name, rank, leaderCode }))
export const REVIEW_ROWS = STOCKS.map(({ code, name, boards, broken }) => ({ code, name, boards, broken }))
export type ThemeRank = (typeof THEME_RANKS)[number]
export type ReviewRow = (typeof REVIEW_ROWS)[number]
export const NEWS = STOCKS.map(({ code, newsScore }) => ({ code, newsScore }))
export const LHB = STOCKS.filter((s) => s.lhb).map(({ code, lhb }) => ({ code, ...lhb }))
export function readMarket(now: number = SNAPSHOT) {
  // 先读市场宽度与炸板率，再读板块流入排名，再判定个股角色，最后才使用个股 K 线和因子。
  return {
    asOf: '2026-11-17 15:40',
    delayed: true as const,
    indices: INDICES,
    sectors,
    leaders: THEME_RANKS,
    stocks: STOCKS.map((q) => ({ ...q, now })),
    reviews: REVIEW_ROWS,
    alerts: [{ id: 'demo', level: '信息' as const, text: DISCLAIMER }],
  }
}

export { STRATEGIES, matchStrategy } from './strategies'
