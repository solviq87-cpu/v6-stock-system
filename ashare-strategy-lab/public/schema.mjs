// Form metadata is shared by the browser and the validation engine.
const percentage = { min: 0, max: 100, step: 0.1 };
const price = { min: 0.01, max: 1_000_000, step: 0.01 };
const count = { min: 0, max: 100_000, step: 1, integer: true };
const change = { min: -100, max: 1000, step: 0.01 };
const cash = { min: 0, max: 10_000_000, step: 0.01 };
const trends = [['bull', '多头'], ['range', '震荡'], ['bear', '空头']];

export const DEFAULT_CAPS = Object.freeze({
  singleCapPct: 10,
  themeCapPct: 25,
  offThemeCapPct: 5,
  declineCapPct: 15,
});

export const GROUPS = [
  { key: 'market', label: '盘面环境', fields: [
    { key: 'allAStatus', label: '全A趋势', type: 'select', options: trends, hint: '可手动录入。留空时可由下方全A点位和均线推算。' },
    { key: 'shStatus', label: '上证趋势', type: 'select', options: trends },
    { key: 'cybStatus', label: '创业板趋势', type: 'select', options: trends },
    { key: 'allAPct', label: '全A涨跌幅（%）', type: 'number', ...change },
    { key: 'shPct', label: '上证涨跌幅（%）', type: 'number', ...change },
    { key: 'cybPct', label: '创业板涨跌幅（%）', type: 'number', ...change },
    { key: 'advances', label: '上涨家数', type: 'number', ...count },
    { key: 'declines', label: '下跌家数', type: 'number', ...count },
    { key: 'amount', label: '两市成交额（亿元）', type: 'number', ...cash },
    { key: 'referenceAmount', label: '对照成交额（亿元）', type: 'number', ...cash, min: 0.01, hint: '录入上一交易日的同口径成交额。盘中比较时使用同一时点。' },
    { key: 'emotion', label: '短线情绪', type: 'select', options: [['upswing', '主升'], ['peak', '高潮'], ['divergence', '分歧'], ['decline', '退潮'], ['ice', '冰点'], ['choppy', '混沌']], advanced: true },
    { key: 'allAOpen', label: '全A开盘点位', type: 'number', ...price, advanced: true },
    { key: 'allAClose', label: '全A点位', type: 'number', ...price, advanced: true },
    { key: 'allAMa5', label: '全A MA5', type: 'number', ...price, advanced: true },
    { key: 'allAMa10', label: '全A MA10', type: 'number', ...price, advanced: true },
    { key: 'allAMa20', label: '全A MA20', type: 'number', ...price, advanced: true },
    { key: 'allAStreak', label: '全A连续涨跌天数', type: 'number', ...count, min: -100_000, hint: '上涨用正数，下跌用负数，0 为无连续方向。', advanced: true },
    { key: 'gap', label: '全A缺口状态', type: 'select', options: [['down-open', '向下缺口未回补'], ['up-held', '向上缺口支撑有效'], ['other', '均未出现']], advanced: true },
    { key: 'highBoard', label: '市场最高连板', type: 'number', ...count, advanced: true },
    { key: 'priorSealPremium', label: '昨日涨停股平均溢价（%）', type: 'number', ...change, advanced: true },
    { key: 'firstPremium', label: '昨日首板股平均溢价（%）', type: 'number', ...change, advanced: true },
    { key: 'limitDownToday', label: '当前跌停家数', type: 'number', ...count, advanced: true },
    { key: 'limitDownYesterday', label: '上期跌停家数', type: 'number', ...count, advanced: true },
    { key: 'failedSealToday', label: '当前炸板率（%）', type: 'number', ...percentage, advanced: true },
    { key: 'failedSealYesterday', label: '上期炸板率（%）', type: 'number', ...percentage, advanced: true },
  ] },
  { key: 'stock', label: '个股资料', fields: [
    { key: 'day', label: '观察日期', type: 'date' },
    { key: 'code', label: '股票代码', type: 'text', maxLength: 6, pattern: '[0-9]{6}', inputmode: 'numeric' },
    { key: 'name', label: '股票简称', type: 'text', maxLength: 64 },
    { key: 'sector', label: '所属板块 / 题材', type: 'text', maxLength: 128 },
    { key: 'themeStatus', label: '题材地位', type: 'select', options: [['main', '主线题材'], ['off', '非主线题材']] },
    { key: 'changePct', label: '个股涨跌幅（%）', type: 'number', ...change },
    { key: 'turnoverPct', label: '换手率（%）', type: 'number', ...percentage, max: 1000 },
    { key: 'amount', label: '个股成交额（亿元）', type: 'number', ...cash },
    { key: 'amplitudePct', label: '个股振幅（%）', type: 'number', ...percentage, max: 1000, advanced: true },
    { key: 'floatCap', label: '流通市值（亿元）', type: 'number', ...cash, advanced: true },
    { key: 'auctionGapPct', label: '竞价涨跌幅（%）', type: 'number', ...change, advanced: true },
    { key: 'auctionVolumeRatio', label: '竞价量比', type: 'number', min: 0, max: 10_000, step: 0.01, advanced: true },
    { key: 'auctionAmount', label: '竞价成交额（亿元）', type: 'number', ...cash, advanced: true },
    { key: 'boardCount', label: '个股连板高度', type: 'number', ...count, advanced: true },
    { key: 'close', label: '个股观察价（元）', type: 'number', ...price, advanced: true },
    { key: 'ma5', label: '个股 MA5', type: 'number', ...price, advanced: true },
    { key: 'ma10', label: '个股 MA10', type: 'number', ...price, advanced: true },
    { key: 'ma20', label: '个股 MA20', type: 'number', ...price, advanced: true },
    { key: 'riskReward', label: '预设收益 / 风险比', type: 'number', min: 0, max: 1000, step: 0.01, hint: '填复盘假设的预期收益除以预设风险。', advanced: true },
  ] },
  { key: 'portfolio', label: '模拟仓位与纪律', fields: [
    { key: 'positionPct', label: '该个股现有仓位（%）', type: 'number', ...percentage },
    { key: 'themePositionPct', label: '该题材现有仓位合计（%）', type: 'number', ...percentage },
    { key: 'totalPositionPct', label: '总仓位（%）', type: 'number', ...percentage },
    { key: 'offThemePositionPct', label: '非主线现有仓位合计（%）', type: 'number', ...percentage },
    { key: 'lossesToday', label: '当日连续亏损笔数', type: 'number', ...count },
    { key: 'lossDays', label: '连续亏损交易日', type: 'number', ...count },
    { key: 'gainPct', label: '该个股浮动盈亏（%）', type: 'number', ...change, advanced: true },
    { key: 'stopLossPct', label: '预设止损幅度（%）', type: 'number', ...percentage, min: 0.1, hint: '录入正数。如填 5，亏损达到 −5% 时触发。', advanced: true },
    { key: 'singleCapPct', label: '单标的上限（%）', type: 'number', ...percentage, hint: `默认 ${DEFAULT_CAPS.singleCapPct}%`, advanced: true },
    { key: 'themeCapPct', label: '题材集中度上限（%）', type: 'number', ...percentage, hint: `默认 ${DEFAULT_CAPS.themeCapPct}%`, advanced: true },
    { key: 'offThemeCapPct', label: '非主线总上限（%）', type: 'number', ...percentage, hint: `默认 ${DEFAULT_CAPS.offThemeCapPct}%`, advanced: true },
    { key: 'declineCapPct', label: '退潮期总上限（%）', type: 'number', ...percentage, hint: `默认 ${DEFAULT_CAPS.declineCapPct}%`, advanced: true },
  ] },
];
