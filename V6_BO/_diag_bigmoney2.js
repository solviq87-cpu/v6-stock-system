// 复核：同一份真实榜单，在「加权重排」前后名次怎么变（用户指出的两个毛病是否真的被治住）
// 输入是线上抓下来的状态快照 _tmp_st.json（旧版 bt 的榜单），K 线取本地 .kline_cache 真实数据。
const fs = require('fs');
const path = require('path');
const A = require('./analysis');

const j = JSON.parse(fs.readFileSync('./_tmp_st.json', 'utf8'));
const arr = (j.bigMoney || {}).items || [];
const hotSecs = new Set((j.sectors || []).slice(0, 25).map(x => x.name));
const ztSecs = new Set(Object.keys(j.ztBySector || {}));

function rowsOf(code) {
  try { return JSON.parse(fs.readFileSync(path.join('.kline_cache', code + '.json'), 'utf8')).rows || []; }
  catch { return []; }
}
const heatOf = sec => {
  if (!sec || sec === '未知') return { hot: false, cold: true, short: '❄️冷门' };
  const n = (j.ztBySector && j.ztBySector[sec] ? j.ztBySector[sec].length : 0);
  const hot = n > 0 || hotSecs.has(sec);
  return { hot, cold: !hot, short: hot ? (n > 0 ? `🔥主线·${n}板` : '🔥热门') : '❄️冷门' };
};

const list = arr.map(x => {
  const c = A.bigMoneyContext({ rows: rowsOf(x.code), price: x.price });
  const h = heatOf(x.sector);
  const w = c ? c.weight : 0.7;
  const bmScore = +((x.mainPct || 0) * w * (h.hot ? 1.15 : 0.85)).toFixed(2);
  return { ...x, ctx: c, heat: h, bmScore };
});

const old = [...list].sort((a, b) => (b.mainPct - a.mainPct) || (b.mainInflow - a.mainInflow));
const now = [...list].sort((a, b) => (b.bmScore - a.bmScore) || (b.mainPct - a.mainPct));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('【旧排名】纯按主力净占比降序（用户看到的样子）');
console.log('#  代码     名称        占比%  板块      性质');
old.forEach((x, i) => console.log(
  String(i + 1).padStart(2), x.code, pad(x.name, 10), String(x.mainPct).padStart(6),
  pad(x.sector, 8), (x.ctx ? x.ctx.flowKind : '无K线') + (x.heat.cold ? ' ❄️' : '')));

console.log('\n【新排名】净占比 × 位置权重 × 板块冷热');
console.log('#  代码     名称        占比%  综合分  板块      性质           位置');
now.forEach((x, i) => {
  const c = x.ctx;
  console.log(
    String(i + 1).padStart(2), x.code, pad(x.name, 10), String(x.mainPct).padStart(6),
    String(x.bmScore).padStart(7), pad(x.sector, 8), pad(c ? c.flowKind : '无K线', 12),
    c ? `20线${c.aboveMa20 ? '上' : '下'}/60线${c.aboveMa60 ? '上' : '下'}/回撤${c.dd60}%` : '-',
    x.heat.short);
});

const downOld = old.slice(0, 6).filter(x => x.ctx && /下跌途中|深跌后/.test(x.ctx.flowKind)).length;
const downNew = now.slice(0, 6).filter(x => x.ctx && /下跌途中|深跌后/.test(x.ctx.flowKind)).length;
console.log('\n──── 汇总 ────');
console.log('前 6 名里「下跌途中/深跌后」的大单：旧', downOld, '→ 新', downNew);
console.log('全池冷门板块:', list.filter(x => x.heat.cold).length, '/', list.length);
console.log('性质分布:', Object.entries(list.reduce((m, x) => { const k = x.ctx ? x.ctx.flowKind : '无K线'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => `${k}x${v}`).join(' '));
