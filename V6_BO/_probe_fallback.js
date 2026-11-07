// 探针 2（cl 轮）：测【部分缺失】的真实场景（不是人为喂 null），判断哪些崩溃真实可达。
const A = require('./analysis');

const row = (c, pct) => ({ close: c, open: c, high: c * 1.01, low: c * 0.99, vol: 1e6, pct: pct || 0, date: '2026-10-06' });
const rows25 = (() => { const a = []; for (let i = 0; i < 30; i++) a.push(row(10 + i * 0.1, 0.5)); return a; })();

const cases = [
  // ── 复盘里真实会出现的：ztPool 某项字段缺失 ──
  ['buildZTReason zt=空对象', () => A.buildZTReason({ zt: {}, sectorZT: 0, sectorInflow: 0, sealRatio: 0 })],
  ['buildZTReason zt 缺 sector', () => A.buildZTReason({ zt: { code: '000001', name: '测试' }, sectorZT: 3, sectorInflow: 1e8, sealRatio: 0.5 })],
  ['buildZTReason zt 缺 amount', () => A.buildZTReason({ zt: { code: '000001', name: '测试', sector: '银行' }, sectorZT: 3, sectorInflow: 1e8, sealRatio: 0 })],
  ['buildZTReason zt=null', () => A.buildZTReason({ zt: null, sectorZT: 0, sectorInflow: 0, sealRatio: 0 })],
  // ── 大单：rows 为 undefined（klineRows 取不到时的真实形态）──
  ['bigMoneyContext rows=undefined', () => A.bigMoneyContext({ rows: undefined, price: 10 })],
  ['bigMoneyContext rows=[]', () => A.bigMoneyContext({ rows: [], price: 10 })],
  ['bigMoneyContext rows=5根', () => A.bigMoneyContext({ rows: rows25.slice(0, 5), price: 10 })],
  ['bigMoneyContext price=0', () => A.bigMoneyContext({ rows: rows25, price: 0 })],
  ['bigMoneyContext price=NaN', () => A.bigMoneyContext({ rows: rows25, price: NaN })],
  // ── 次日涨停概率：字段部分缺失 ──
  ['nextDayLimitProb 全 0', () => A.nextDayLimitProb({ limitUpCount: 0, sealRatio: 0, breakCount: 0, sectorZT: 0, turnover: 0, aboveMa5: false })],
  ['nextDayLimitProb 缺 turnover', () => A.nextDayLimitProb({ limitUpCount: 1, sealRatio: 0.3, breakCount: 0, sectorZT: 2 })],
  ['nextDayLimitProb turnover=NaN', () => A.nextDayLimitProb({ limitUpCount: 1, sealRatio: 0.3, breakCount: 0, sectorZT: 2, turnover: NaN, aboveMa5: true })],
  ['nextDayLimitProb sealRatio=NaN', () => A.nextDayLimitProb({ limitUpCount: 1, sealRatio: NaN, breakCount: 0, sectorZT: 2, turnover: 3, aboveMa5: true })],
  ['nextDayLimitProb undefined 字段', () => A.nextDayLimitProb({ limitUpCount: undefined, sealRatio: undefined, breakCount: undefined, sectorZT: undefined, turnover: undefined, aboveMa5: undefined })],
  // ── scoreStock：真实调用形态 ──
  ['scoreStock 最小', () => A.scoreStock({ code: '000001', name: '测试' })],
  ['scoreStock 缺 rows', () => A.scoreStock({ code: '000001', name: '测试', price: 10 })],
  // ── reviewFlags ──
  ['reviewFlags 25根', () => A.reviewFlags(rows25, 12)],
  ['reviewFlags 全0价', () => A.reviewFlags(rows25.map(r => ({ ...r, close: 0, high: 0, low: 0, open: 0 })), 12)],
  // ── trendPoolCheck 缺数据 ──
  ['trendPoolCheck 缺 floatCap', () => A.trendPoolCheck({ rows: rows25, fundDays: [], price: 12, mainInflow: 1e8 })],
  ['trendPoolCheck 缺 fundDays', () => A.trendPoolCheck({ rows: rows25, price: 12, mainInflow: 1e8, floatCap: 1e10 })],
  ['trendPoolCheck rows 空', () => A.trendPoolCheck({ rows: [], price: 12, floatCap: 1e10 })],
];

let crash = 0, nan = 0;
for (const [name, fn] of cases) {
  let v, err = '';
  try { v = fn(); } catch (e) { err = (e && e.constructor ? e.constructor.name + ': ' : '') + ((e && e.message) || String(e)); }
  if (err) { crash++; console.log('CRASH ' + name.padEnd(32) + ' -> ' + err.slice(0, 80)); continue; }
  let s;
  try { s = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90); }
  catch (e) { s = '(无法序列化)'; }
  const isNaN = typeof v === 'number' && !isFinite(v);
  if (isNaN) nan++;
  console.log((isNaN ? '⚠️ ' : '   ') + name.padEnd(32) + ' → ' + s);
}
console.log(`\n崩溃 ${crash} / ${cases.length}；返回 NaN/Infinity ${nan} 处`);
