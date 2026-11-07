// 诊断：大单流入池里混了多少「下跌趋势中的大单」+ 冷门板块（用户指出的两个问题）
const fs = require('fs');
const path = require('path');

const j = JSON.parse(fs.readFileSync('./_tmp_st.json', 'utf8'));
const bm = j.bigMoney || {};
const arr = bm.items || [];
const hotSecs = new Set((j.sectors || []).slice(0, 20).map(x => x.name));
const ztSecs = new Set(Object.keys(j.ztBySector || {}));

const KC = '.kline_cache';
function rowsOf(code) {
  try { return JSON.parse(fs.readFileSync(path.join(KC, code + '.json'), 'utf8')).rows || []; }
  catch (e) { return []; }
}
const pick = (r, names) => { for (const n of names) { const x = Number(r[n]); if (Number.isFinite(x) && x > 0) return x; } return 0; };

console.log('大单池', arr.length, '只 | 热门板块(资金前20)', hotSecs.size, '个 | 有涨停的板块', ztSecs.size, '个\n');
console.log('代码     名称        现价   今日%   主力占比  近5日   近20日  上20线 上60线 距60高   板块');

let down = 0, cold = 0, both = 0;
const rowsOut = [];
for (const it of arr) {
  const r = rowsOf(it.code);
  let r5 = null, r20 = null, a20 = null, a60 = null, dd60 = null, bear = null;
  if (r.length >= 25) {
    const cl = r.map(x => pick(x, ['close', 'c']));
    const last = cl[cl.length - 1];
    const avg = n => { const s = cl.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
    const ma20 = avg(20), ma60 = cl.length >= 60 ? avg(60) : null;
    const ma5 = avg(5);
    r5 = cl.length > 5 ? (last - cl[cl.length - 6]) / cl[cl.length - 6] * 100 : null;
    r20 = cl.length > 20 ? (last - cl[cl.length - 21]) / cl[cl.length - 21] * 100 : null;
    a20 = last > ma20; a60 = ma60 ? last > ma60 : null;
    const hi60 = Math.max(...r.slice(-60).map(x => pick(x, ['high', 'h'])));
    dd60 = hi60 > 0 ? (hi60 - last) / hi60 * 100 : null;
    bear = ma60 ? (ma5 < ma20 && ma20 < ma60) : (ma5 < ma20);
  }
  const sec = it.sector || '未知';
  const isCold = sec === '未知' || (!hotSecs.has(sec) && !ztSecs.has(sec));
  const isDown = (a20 === false) || (r20 != null && r20 < 0) || bear === true || (dd60 != null && dd60 > 25);
  if (isDown) down++;
  if (isCold) cold++;
  if (isDown && isCold) both++;
  const f = x => (x == null ? '   —' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
  rowsOut.push({ it, r5, r20, a20, a60, dd60, bear, sec, isCold, isDown });
  console.log(
    String(it.code).padEnd(9),
    String(it.name).padEnd(10).slice(0, 10),
    String(it.price).padStart(6),
    (it.pct >= 0 ? '+' : '') + Number(it.pct).toFixed(2) + '%',
    String(it.mainPct).padStart(7) + '%',
    f(r5).padStart(7), f(r20).padStart(7),
    String(a20 == null ? '—' : (a20 ? '是' : '否')).padStart(5),
    String(a60 == null ? '—' : (a60 ? '是' : '否')).padStart(5),
    (dd60 == null ? '—' : dd60.toFixed(1) + '%').padStart(7),
    '  ' + sec + (isCold ? ' ❄️冷门' : '') + (isDown ? ' ⬇️下跌' : ''));
}

console.log('\n──── 汇总 ────');
console.log('下跌趋势中的票（未站上20线 / 近20日跌 / 空头排列 / 回撤>25%）:', down, '/', arr.length);
console.log('冷门板块（未知 或 不在资金前20且无涨停）:', cold, '/', arr.length);
console.log('两者皆是（正是用户说的那类）:', both, '/', arr.length);
console.log('\n板块分布:', rowsOut.map(x => x.sec).join(' | '));
