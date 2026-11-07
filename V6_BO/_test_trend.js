// 趋势票池：为什么以前「都是那些走势难看的」（2026-09-30 修复）
// 用户原话：「还有你的趋势票池怎么都是那些走势难看的」
//
// 查实的四个毛病（逐个锁死，防止再退化）：
//   ① 判据只看 5 日线 + 近5日温和 + 资金流入 —— 一条中期均线都没看，
//      于是「高位跌下来、在底部弱反弹几天」的票也被判成"多头趋势未破坏的回踩中继"；
//   ② 排序按【资金流入绝对值】→ 大盘股金额天然大就霸占前排，跟趋势好不好没关系；
//   ③ why 是同一句模板，41 只票一字不差；
//   ④ sector 九成是"未知"；
//   ⑤ prob 用的是"明日涨停概率"（趋势票天然只有 5 分），放在趋势池里就是自打脸。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

const A = require('./analysis');

// 造K线：先跌 downDays 天，再涨 upDays 天
function series(downDays, upDays, n) {
  n = n || downDays + upDays;
  const rows = []; let p = 10;
  for (let i = 0; i < n; i++) {
    const step = i < downDays ? -0.012 : 0.008;
    const noise = (i % 7 - 3) * 0.0015;
    p = p * (1 + step + noise);
    const prev = p / (1 + step + noise);
    rows.push({ date: 'd' + i, open: prev, close: p, high: p * 1.008, low: prev * 0.992, volume: 1e7, amount: 1e8, pct: (step + noise) * 100 });
  }
  return rows;
}
const check = (rows, extra) => A.trendPoolCheck(Object.assign({
  rows, fundDays: [{ main: 1e7 }, { main: 1e7 }, { main: 1e7 }],
  price: rows[rows.length - 1].close, mainInflow: 1e7, thsNetAmt: null
}, extra || {}));

console.log('\n① 中期趋势：难看的票必须被挡在门外（这是用户抱怨的核心）');
{
  const bottom5 = check(series(65, 5));       // 跌65天、刚抬头5天
  ok('底部刚抬头的（跌65涨5）不入选', bottom5.ok === false, JSON.stringify({ ok: bottom5.ok, aboveMa20: bottom5.aboveMa20, dd60: bottom5.dd60 }));
  ok('它 20 日线仍在下行 → 判据认出来了', bottom5.ma20up === false);
  ok('它距60日高点回撤很大（40%+）', bottom5.dd60 > 25, String(bottom5.dd60));

  const bottom10 = check(series(60, 10));     // 跌60天、反弹10天
  ok('跌60天反弹10天的不入选', bottom10.ok === false, '回撤 ' + bottom10.dd60 + '%');

  const weak = check(series(50, 20));         // 跌50天、反弹20天
  ok('跌50天反弹20天的仍不入选（回撤过大）', weak.ok === false, '回撤 ' + weak.dd60 + '%');

  const bull = check(series(0, 70));          // 全程多头
  ok('全程多头的正常入选', bull.ok === true, JSON.stringify({ ok: bull.ok, score: bull.trendScore }));
  ok('多头票趋势分明显高于底部票', (bull.trendScore || 0) - (bottom5.trendScore || 0) >= 30,
    'bull=' + bull.trendScore + ' bottom=' + bottom5.trendScore);
}

console.log('\n② 趋势强度分：要能排出先后，不是都挤在一个分数上');
{
  const s = [check(series(0, 70)), check(series(20, 50)), check(series(35, 35)), check(series(65, 5))]
    .map(x => x.trendScore);
  console.log('      分数序列（强→弱）:', s.join(' > '));
  ok('序列单调不增（越强的分越高）', s.every((v, i) => i === 0 || s[i - 1] >= v), s.join(','));
  ok('分数确实拉开了差距（首末差 ≥40）', s[0] - s[s.length - 1] >= 40, String(s[0] - s[s.length - 1]));
  ok('分数夹在 0~100', s.every(v => v >= 0 && v <= 100));
}

console.log('\n③ 资金流为负的一律出局（不管均线多漂亮）');
{
  const rows = series(0, 70);
  const out = check(rows, { fundDays: [{ main: -5e6 }, { main: -5e6 }, { main: -5e6 }], mainInflow: -5e6 });
  ok('资金净流出 → 不入选', out.ok === false);
}

console.log('\n④ 返回字段要撑得起面板解释「它站在哪、离高点多远」');
{
  const r = check(series(0, 70));
  for (const k of ['ma20', 'ma60', 'aboveMa20', 'aboveMa60', 'ma20up', 'dd60', 'r20', 'trendScore', 'midOk'])
    ok('返回字段 ' + k, r[k] !== undefined, JSON.stringify(r[k]));
}

console.log('\n⑤ 源码断言：改的是判据不是嘴皮子');
{
  const src = A.trendPoolCheck.toString();
  ok('准入条件里含中期判据 midOk', /&&\s*midOk/.test(src));
  ok('计算了 20 日线', /ma20now/.test(src));
  ok('计算了 60 日高点回撤', /dd60/.test(src));
  // server.js 侧
  const sv = require('fs').readFileSync('server.js', 'utf8');
  ok('排序改用 trendScore（不再按资金额）', /b\.trendScore \|\| 0/.test(sv) && !/sort\(\(a, b\) => _fv\(b\) - _fv\(a\)\)/.test(sv));
  ok('why 文案按形态分支（不再一句模板）', /多头排列主升/.test(sv) && /中期刚转强/.test(sv));
  ok('sector 增加板块成分反查', /S\.secStocks/.test(sv));
}

console.log('\n⑥ 老行为不能被误伤：真正的多头仍然进得来');
{
  const r = check(series(0, 70));
  ok('多头票 ma5up 为真', r.ma5up === true);
  ok('多头票站上20日线', r.aboveMa20 === true);
  ok('多头票站上60日线', r.aboveMa60 === true);
  ok('多头票温和震荡判定为真', r.gentle === true);
  ok('多头票资金流入为真', r.fundIn === true);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
