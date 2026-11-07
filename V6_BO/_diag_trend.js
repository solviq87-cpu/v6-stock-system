// 诊断：趋势票池里到底装了些什么形态的票（用户说「都是那些走势难看的」）
const fs = require('fs');
const path = require('path');

const j = JSON.parse(fs.readFileSync('./_tmp_st.json', 'utf8'));
const tp = j.trendPool || {};
const arr = [];
for (let i = 0; ; i++) { if (!(i in tp)) break; arr.push(tp[i]); }

const KC = '.kline_cache';
function rowsOf(code) {
  try { return JSON.parse(fs.readFileSync(path.join(KC, code + '.json'), 'utf8')).rows || []; }
  catch (e) { return []; }
}
const pick = (r, names) => {
  for (const n of names) { const x = Number(r[n]); if (Number.isFinite(x) && x > 0) return x; }
  return 0;
};

let have = 0, miss = 0;
const stat = [];
for (const it of arr) {
  const r = rowsOf(it.code);
  if (r.length < 25) { miss++; continue; }
  have++;
  const cl = r.map(x => pick(x, ['close', 'c']));
  const last = cl[cl.length - 1];
  const avg = n => { const s = cl.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
  const ma5 = avg(5), ma20 = avg(20), ma60 = cl.length >= 60 ? avg(60) : null;
  const ret = n => (cl.length > n ? (last - cl[cl.length - 1 - n]) / cl[cl.length - 1 - n] * 100 : null);
  // 近20日最大回撤
  const w = cl.slice(-20);
  const dd = ((Math.max(...w) - last) / Math.max(...w)) * 100;
  stat.push({
    code: it.code, name: it.name, prob: it.prob, pct: it.pct, price: last,
    r5: ret(5), r10: ret(10), r20: ret(20),
    aboveMa20: last > ma20, aboveMa60: ma60 ? last > ma60 : null,
    bearStack: ma60 ? (ma5 < ma20 && ma20 < ma60) : (ma5 < ma20),
    dd20: dd
  });
}

const f = x => (x == null ? '  — ' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
console.log('池子', arr.length, '只 | 有本地K线可核', have, '只 | 无K线', miss, '只\n');
console.log('代码     名称        现价   prob  近5日   近10日  近20日  20日回撤 上20线 上60线 空头');
stat.slice(0, 24).forEach(s => console.log(
  String(s.code).padEnd(9),
  String(s.name).padEnd(10).slice(0, 10),
  String(s.price).padStart(6),
  String(s.prob).padStart(5),
  f(s.r5).padStart(7), f(s.r10).padStart(7), f(s.r20).padStart(7),
  (s.dd20.toFixed(1) + '%').padStart(7),
  String(s.aboveMa20 ? '是' : '否').padStart(5),
  String(s.aboveMa60 == null ? '—' : (s.aboveMa60 ? '是' : '否')).padStart(5),
  String(s.bearStack ? '⚠️' : '').padStart(4)));

const n = stat.length;
const cnt = p => stat.filter(p).length;
console.log('\n──── 汇总（' + n + ' 只） ────');
console.log('站上20日线        ', cnt(s => s.aboveMa20), '/', n);
console.log('站上60日线        ', cnt(s => s.aboveMa60 === true), '/', n, '（有60线的样本 ' + cnt(s => s.aboveMa60 != null) + ' 只）');
console.log('空头排列 ma5<ma20 ', cnt(s => s.bearStack), '/', n);
console.log('近20日累计下跌    ', cnt(s => s.r20 != null && s.r20 < 0), '/', n);
console.log('近10日累计下跌    ', cnt(s => s.r10 != null && s.r10 < 0), '/', n);
console.log('近20日回撤>15%    ', cnt(s => s.dd20 > 15), '/', n);
console.log('prob < 20 分      ', cnt(s => s.prob < 20), '/', n);
console.log('prob >= 60 分     ', cnt(s => s.prob >= 60), '/', n);
const bad = stat.filter(s => s.bearStack || (s.r20 != null && s.r20 < 0) || s.dd20 > 15);
console.log('\n▸ 「走势难看」（空头排列 或 近20日下跌 或 回撤>15%）:', bad.length, '/', n,
  '(' + Math.round(bad.length / n * 100) + '%)');
