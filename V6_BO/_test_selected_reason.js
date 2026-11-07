'use strict';
// 各池标的 · 上涨原因 单测（2026-10-09 fy 轮）：用户原话「不是只加精选池，是全加，包括复盘趋势池啥的」。
// poolReasonSection 是通用纯函数，四个池各用自己的原因解析器，绝不许拿别池字段凑数：
//   精选池 = pathWhy/paths(选股逻辑)；趋势池 = why/flags(趋势逻辑)；
//   大单池 = 主力资金合成(mainPct·净流入·位置·冷热)；补涨池 = reason(补涨理由)。
// 全部按主线归并（sectorOfStock → themeOfSec），与涨停股同一套口径。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到起始: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j);
}
// ⛔ 一次抠出 poolReasonSection + 四个 why* 解析器（都在 buildReviewMessage 之前），
//    sectorOfStock/themeOfSec 用确定性桩，聚焦本函数的「分组 + 各池原因 + 截断 + 排序」逻辑。
const fnSrc = grab('function poolReasonSection(pool, opt)', 'function buildReviewMessage()');
const stub = `
// ⛔ 桩：真实 sectorOfStock 按 code 从 S.stocks 反查板块；这里复刻「形参对象→返回板块字符串」契约
function sectorOfStock(s){
  const map = { '600519':'白酒', '000858':'白酒', '300750':'电池', '002594':'电池',
                '688981':'半导体', '300001':'电池', '600111':'半导体' };
  return (s && map[s.code]) || '未知';
}
function themeOfSec(sec){
  if (sec === '电池') return '电池·储能';
  if (sec === '白酒') return '白酒';
  if (sec === '半导体') return '半导体';
  return sec || '未知';
}
${fnSrc}
return { poolReasonSection, whySelected, whyTrend, whyBigMoney, whyBuzhang };
`;
const M = new Function(stub)();

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

const selPool = [
  { code: '600519', name: '贵州茅台', pct: 2.3, score: 88, pathWhy: { a: '业绩超预期', b: '北向增持' } },
  { code: '000858', name: '五粮液', pct: 1.8, score: 80, paths: ['消费复苏'] },
  { code: '300750', name: '宁德时代', pct: 3.1, score: 90, pathWhy: { c: '固态电池量产' } },
  { code: '688981', name: '中芯国际', pct: 4.2, score: 92, pathWhy: { e: '国产替代' } },
];
const trendPool = [
  { code: '300001', name: '特锐德', pct: 2.5, trendScore: 78, why: '沿5日线震荡，叠加资金持续流入' },
  { code: '600111', name: '北方稀土', pct: 1.2, trendScore: 70, flags: ['5日线上行', '量价·放量上涨'] },
];
const bigPool = [
  { code: '002594', name: '比亚迪', pct: 3.0, prob: 66, mainPct: 5.2, mainInflow: 1.2e8, ctx: { flowKind: '启动' }, heat: { cold: false } },
  { code: '600519', name: '贵州茅台', pct: 0.8, prob: 55, mainPct: 1.1, mainInflow: 3.5e7, heat: { cold: true } },
];
const bzPool = [
  { code: '300750', name: '宁德时代', pct: 4.0, prob: 71, reason: '板块净流入1.2亿承接 + 涨幅4.0%黄金区' },
];

console.log('── ① 空池 / 各池原因解析 ──');
ok('空池返回空串（四种入参）',
  M.poolReasonSection([]) === '' && M.poolReasonSection(null) === '' &&
  M.poolReasonSection(undefined) === '' && M.poolReasonSection([], { why: M.whyTrend }) === '');

// ⛔ 钉语义：每个池只认自己的字段，绝不许拿别池字段凑数（凑出来的原因看着有、其实是假的）
ok('趋势池只认 why（不串味到 pathWhy）', M.whyTrend({ why: '趋势原因', pathWhy: { z: '选股逻辑' } }) === '趋势原因');
ok('趋势池无 why 时回退 flags', M.whyTrend({ flags: ['5日线上行', null, '温和震荡'] }) === '5日线上行 + 温和震荡');
ok('补涨池只认 reason（不串味到 why）', M.whyBuzhang({ reason: '补涨理由', why: '趋势原因' }) === '补涨理由');
ok('大单池按资金口径合成（净占比·净流入·位置·冷热）',
  M.whyBigMoney({ mainPct: 5.2, mainInflow: 1.2e8, ctx: { flowKind: '启动' }, heat: { cold: false } }) === '主力净占比5.2% · 净流入1.2亿 · 启动');
ok('大单池冷门股标出「板块偏冷」', M.whyBigMoney({ mainPct: 1.1, mainInflow: 3.5e7, heat: { cold: true } }).indexOf('板块偏冷') >= 0);

console.log('── ② 复盘渲染：四个池都带上涨原因 ──');
const selOut = M.poolReasonSection(selPool, { why: M.whySelected, extra: x => (x.score != null ? ' 评分' + x.score : ''), limit: 12 });
ok('精选池 按主线归并出分组头', selOut.includes('【白酒】2只') && selOut.includes('【电池·储能】1只') && selOut.includes('【半导体】1只'));
ok('精选池 上涨原因=选股逻辑(pathWhy/paths)',
  selOut.includes('上涨原因: 业绩超预期；北向增持') && selOut.includes('上涨原因: 消费复苏'));
ok('精选池 涨跌幅带+号·评分透出', selOut.includes('涨+2.3% 评分88'));

const trendOut = M.poolReasonSection(trendPool, { why: M.whyTrend, extra: x => (x.trendScore != null ? ' 趋势分' + x.trendScore : ''), limit: 6 });
ok('趋势池 上涨原因=趋势逻辑(why)', trendOut.includes('上涨原因: 沿5日线震荡，叠加资金持续流入'));
ok('趋势池 无why者用flags并带趋势分', trendOut.includes('上涨原因: 5日线上行 + 量价·放量上涨') && trendOut.includes('趋势分78'));

const bigOut = M.poolReasonSection(bigPool, { why: M.whyBigMoney, extra: x => (x.prob != null ? ' 概率' + x.prob + '%' : ''), limit: 6 });
ok('大单池 上涨原因=资金口径(净占比/净流入/位置/冷热)',
  bigOut.includes('主力净占比5.2%') && bigOut.includes('净流入1.2亿') && bigOut.includes('启动') && bigOut.includes('板块偏冷'));
ok('大单池 概率透出', bigOut.includes('概率66%'));

const bzOut = M.poolReasonSection(bzPool, { why: M.whyBuzhang, extra: x => (x.prob != null ? ' 概率' + x.prob + '%' : ''), limit: 6 });
ok('补涨池 上涨原因=补涨理由(reason)', bzOut.includes('上涨原因: 板块净流入1.2亿承接 + 涨幅4.0%黄金区'));
ok('补涨池 概率透出', bzOut.includes('概率71%'));

console.log('── ③ 排序与截断 ──');
const _first = selOut.match(/【([^】]+)】/);
ok('排序按数量降序（首组为 2 只档）', _first && _first[1].indexOf('半导体') < 0);
const big15 = [];
for (let k = 0; k < 15; k++) big15.push({ code: '99999' + k, name: '票' + k, pct: 1, score: 70, pathWhy: { z: '主线驱动' } });
const _bullets = (M.poolReasonSection(big15, { why: M.whySelected, limit: 12 }).match(/▪/g) || []).length;
ok('单组超过 6 只时每组只渲染 6 行', _bullets === 6, '实际 ▪ 数=' + _bullets);
ok('分组头格式为【主线】N只', /【[^】]+】\d+只/.test(selOut));

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
