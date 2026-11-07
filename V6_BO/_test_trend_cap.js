// 趋势票池三条新规矩（2026-09-30 用户指定）：
//   ①「加上一个条件市值大于五十亿」
//   ②「K线上蹿下跳的你放里面回调风险那么大你放里面不是害人吗」→ 上蹿下跳一律出局
//   ③「你自己也都多看看有没有那种连续小阳线拉升的」→ 连续小阳必须能认出来并加分
// 离线、确定性：K 线是构造的，市值/资金都是注入的。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const A = require('./analysis');

// 按「每日涨幅 + 当日振幅」造 K 线（振幅 = (high-low)/前收，用来模拟上蹿下跳）
function rowsFrom(pcts, ampFn) {
  const rows = []; let c = 10;
  for (let i = 0; i < pcts.length; i++) {
    const p = pcts[i];
    const prev = c; c = c * (1 + p / 100);
    const amp = (typeof ampFn === 'function' ? ampFn(i) : ampFn) / 100;
    const hi = Math.max(prev, c) * (1 + amp / 2), lo = Math.min(prev, c) * (1 - amp / 2);
    rows.push({
      date: 'd' + i, open: +prev.toFixed(4), close: +c.toFixed(4),
      high: +hi.toFixed(4), low: +lo.toFixed(4), volume: 1e7, amount: 1e8, pct: +p.toFixed(2)
    });
  }
  return rows;
}
// 基准形态刻意做成「中档分」：先涨30天 → 回撤25天 → 再抬15天（含尾部8天）。
// 一路无脑涨的样本 trendScore 会撞到 100 上限，连阳那 +10 分就被钳掉了看不出来
// （之前实测过：分数会挤在满分上，排不出先后 —— 测试样本必须避开这个盲区）。
const base62 = () => Array(30).fill(1.2).concat(Array(25).fill(-0.9), Array(7).fill(0.6));
const TAIL_YANG = [0.9, 1.1, 0.7, 1.3, 0.6, 1.0, 0.8, 1.2];   // 连续小阳，每天一点点抬
const TAIL_JUMP = [6.5, -5.5, 6.5, -5.5, 6.5, -5.5, 6.5, -5.5]; // 大阳大阴反复抽
const TAIL_ALT = [1.9, -0.1, 1.9, -0.1, 1.9, -0.1, 1.9, -0.1];   // 跳一步退半步：累计涨幅与 TAIL_YANG 几乎相同，但阳线不连续
const mk = (tail, amp) => rowsFrom(base62().concat(tail), amp == null ? 2.0 : amp);
const check = (rows, extra) => A.trendPoolCheck(Object.assign({
  rows, fundDays: [{ main: 1e7 }, { main: 1e7 }, { main: 1e7 }],
  price: rows[rows.length - 1].close, mainInflow: 1e7, thsNetAmt: null
}, extra || {}));

// ══════════ ① 市值门槛 ≥50亿 ══════════
console.log('\n【① 流通市值必须 >50亿（用户指定）】');
{
  const rows = mk(TAIL_YANG);
  const small = check(rows, { floatCap: 30e8 });
  ok('30亿小盘 → 出局（几千万就能拉一根阳线，形态是做出来的）', small.ok === false && small.capOk === false,
    JSON.stringify({ ok: small.ok, capOk: small.capOk, capYi: small.capYi }));
  ok('市值如实算出 = 30.0亿', small.capYi === 30, String(small.capYi));
  const edge49 = check(rows, { floatCap: 49.9e8 });
  ok('49.9亿 → 出局（差一点也不行）', edge49.ok === false && edge49.capOk === false, String(edge49.capYi));
  const edge50 = check(rows, { floatCap: 50e8 });
  ok('正好 50亿 → 放行（门槛是">=50"）', edge50.ok === true && edge50.capOk === true, JSON.stringify({ ok: edge50.ok, capYi: edge50.capYi }));
  const big = check(rows, { floatCap: 500e8 });
  ok('500亿 → 放行', big.ok === true && big.capYi === 500, String(big.capYi));
  const none = check(rows, {});
  ok('拿不到市值 → 不拦（缺数据不判死，跟缺K线同一个原则）', none.capOk === null && none.ok === true,
    JSON.stringify({ capOk: none.capOk, ok: none.ok }));
  ok('小市值即便形态过关，趋势分也要被打折（-10）', small.trendScore < big.trendScore,
    `${small.trendScore} vs ${big.trendScore}`);
}

// ══════════ ② 上蹿下跳一律出局 ══════════
console.log('\n【② 上蹿下跳的票不得进池（回调风险大，放进去是害人）】');
{
  // 关键回归：近5日恰好温和（gentle 判定通过），旧逻辑看不出来，只有拉长到20日才抓得住
  const j = check(mk(TAIL_JUMP));
  ok('大阳大阴反复抽 → jumpy=true', j.jumpy === true, JSON.stringify({ amp20: j.amp20, swingDays: j.swingDays, maxUp: j.maxUp, maxDown: j.maxDown }));
  ok('近5日温和判据 gentle 居然是 true（证明旧逻辑真的会漏掉它）', j.gentle === true, String(j.gentle));
  ok('但 ok=false —— 新逻辑把它拦下了', j.ok === false, String(j.ok));
  ok('20日内 ±5% 以上的天数被数出来了（≥4）', j.swingDays >= 4, String(j.swingDays));
  ok('jumpWhy 写清了为什么（不是静默丢弃）', (j.jumpWhy || []).length > 0, JSON.stringify(j.jumpWhy));
  ok('上蹿下跳会被重扣趋势分(-18)', j.trendScore < check(mk(TAIL_YANG)).trendScore - 20,
    `${j.trendScore} vs ${check(mk(TAIL_YANG)).trendScore}`);
}
{
  // 判据①：单日涨跌都不大，但每天都上蹿下跳（日均振幅 >5.5%）
  const w = check(mk(base62().concat(Array(8).fill(0.5)).slice(-70), 9.0));
  ok('日均振幅 9% → jumpy（每天都上蹿下跳）', w.jumpy === true && w.amp20 > 5.5, String(w.amp20));
  ok('它的 swingDays=0 → 说明是"日均振幅"这条判据抓的，不是凑数', w.swingDays === 0, String(w.swingDays));
  ok('jumpWhy 点名"日均振幅"', (w.jumpWhy || []).some(t => /日均振幅/.test(t)), JSON.stringify(w.jumpWhy));
}
{
  // 判据③：20天内既有单日 +7% 又有 -7%，但只有 1 天超过 ±5% 之外的都不算 → 靠"同时有大阳大阴"抓
  const pcts = base62().slice(0, 66).concat([7.5, -7.5]);
  const x = check(rowsFrom(pcts, 2.0));
  ok('20日内既有 +7.5% 又有 -7.5% → jumpy', x.jumpy === true, JSON.stringify({ maxUp: x.maxUp, maxDown: x.maxDown, swingDays: x.swingDays }));
  ok('jumpWhy 点名两个极值', (x.jumpWhy || []).some(t => /既有单日/.test(t)), JSON.stringify(x.jumpWhy));
}
{
  const calm = check(mk(TAIL_YANG));
  ok('平稳票（日均振幅≈2%、20日内无±5%）不算上蹿下跳', calm.jumpy === false,
    JSON.stringify({ amp20: calm.amp20, swingDays: calm.swingDays }));
}
{
  // 组合拳：小市值 + 上蹿下跳 → 双重拦下
  const both = check(mk(TAIL_JUMP), { floatCap: 20e8 });
  ok('小市值 + 上蹿下跳 → 两个毛病都被记上了', both.capOk === false && both.jumpy === true && both.ok === false);
}

// ══════════ ③ 连续小阳线必须认得出来 ══════════
console.log('\n【③ 连续小阳线拉升：认得出、说得出、排得前】');
{
  const y = check(mk(TAIL_YANG));
  ok('近8日 8 根小阳 → yang8=8', y.yang8 === 8, String(y.yang8));
  ok('最长连涨 8 天 → runMax=8', y.runMax === 8, String(y.runMax));
  ok('近8日累计涨幅落在 2%~15%', y.sum8 >= 2 && y.sum8 <= 15, String(y.sum8));
  ok('steadyRun=true（真·连续小阳）', y.steadyRun === true);
  ok('smallYang=true', y.smallYang === true);
  ok('这类票正常入选', y.ok === true, JSON.stringify({ ok: y.ok, score: y.trendScore }));
}
{
  // 零散阳线：阳阴阳阴交替，阳线数不够 → 不算"连续小阳"
  const alt = check(mk([1.2, -1.0, 1.2, -1.0, 1.2, -1.0, 1.2, -1.0]));
  ok('阳阴阳阴交替 → 不算连续小阳（yang8 不够）', alt.smallYang === false && alt.yang8 === 4, String(alt.yang8));
}
{
  // 有一根脉冲大阳（>+6%）→ 是"拉"不是"抬"，不算
  const pulse = check(mk([0.9, 1.1, 8.5, 0.7, 1.0, 0.6, 1.2, 0.8]));
  ok('中间夹一根 +8.5% 大阳 → 不算连续小阳（是拉不是抬）', pulse.smallYang === false, String(pulse.smallYang));
}
{
  // 有一根大阴（<-3%）→ 抬升被打断，不算
  const yin = check(mk([0.9, 1.1, -4.5, 0.7, 1.0, 0.6, 1.2, 0.8]));
  ok('中间夹一根 -4.5% 大阴 → 不算连续小阳', yin.smallYang === false);
}
{
  // 连阳加分必须真的体现在分数上。
  // 对照组刻意做到「终点收盘价几乎相同」（累计涨幅 7.7% vs 7.3%），只把路径从
  // "每天一点点抬"换成"跳一步退半步" —— 否则 r20/回撤这些连续项会盖过连阳那 10 分。
  const yang = check(mk(TAIL_YANG));
  const chop = check(mk(TAIL_ALT));
  console.log(`      连阳 ${yang.trendScore} 分（yang8=${yang.yang8} 累计+${yang.sum8}%） vs 跳步 ${chop.trendScore} 分（yang8=${chop.yang8} 累计+${chop.sum8}%）`);
  ok('两条路径累计涨幅接近（对照成立）', Math.abs(yang.sum8 - chop.sum8) < 1.5, `${yang.sum8} vs ${chop.sum8}`);
  ok('跳步路径不算连阳（阳线散着，不连续）', chop.smallYang === false && chop.yang8 === 4, String(chop.yang8));
  ok('连阳票趋势分 > 跳步票', yang.trendScore > chop.trendScore, `${yang.trendScore} vs ${chop.trendScore}`);
  ok('差距 ≥8（连阳加分真的落到了分上）', yang.trendScore - chop.trendScore >= 8, String(yang.trendScore - chop.trendScore));
}

// ══════════ ④ 不能误伤：好票照进 ══════════
console.log('\n【④ 老行为不误伤】');
{
  const rows = mk(TAIL_YANG);
  const g = check(rows, { floatCap: 120e8 });
  ok('大市值 + 平稳上行 + 连阳 → 正常入选', g.ok === true, JSON.stringify({ ok: g.ok, capYi: g.capYi, amp20: g.amp20, steadyRun: g.steadyRun }));
  ok('趋势分仍夹在 0~100', g.trendScore >= 0 && g.trendScore <= 100, String(g.trendScore));
  ok('rows 不足 25 根 → 判不出来返回 null（不瞎给结论）', A.trendPoolCheck({ rows: rows.slice(-10), price: 11, fundDays: null }) === null);
}

console.log(`\n${'─'.repeat(56)}\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
