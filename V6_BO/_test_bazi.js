// 八字选股守门测试（趋势 / 资金 / 位置 / 承接）
// 用户口诀（2026-10-02）：看趋势、看资金、看位置、看承接。
// 本测试分三段：A 静态接线  B 合成K线的确定性判定  C 真票冒烟
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const BZ = require('./bazi.js');
const A = require('./analysis.js');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('✅ ' + n); } else { fail++; console.log('❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('── A. 静态：接线与闸门 ──');
const sv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const bz = fs.readFileSync(path.join(ROOT, 'bazi.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

ok('server.js 已 require bazi.js', /require\('\.\/bazi'\)/.test(sv));
ok('候选池构建处对每个池内标的调用 BAZI.evaluate', /BAZI\.evaluate\(\{[\s\S]{0,300}?code: c\.code/.test(sv));
ok('八字分参与最终排序', /b\.bazi \? b\.bazi\.total : 0/.test(sv));
ok('高位加速 / 破位整理 一票否决踢出精选池',
  /const baziBlocked = c => !!\(c\.bazi && \(c\.bazi\.stage === '高位加速' \|\| c\.bazi\.stage === '破位整理'\)\)/.test(sv)
  && /picked = picked\.filter\(c => !baziBlocked\(c\)\)/.test(sv));
// ⛔ 2026-10-06 修：退路原来是 scored.slice(0,20)，而被否决的恰恰是评分最高的那批 ——
//    行情越差、越该执行这道硬闸门，闸门反而被整条绕过。这里钉死"退路也要过闸门"。
// ⛔ 中间那一截 `.sort(...)` 是可选的：2026-10-06 把比较器抽成命名函数 byFinal 后变成了
//    `scored.filter(...).sort(byFinal).slice(0, 20)`。这里只钉死"退路也要过 baziBlocked 闸门"，
//    排序用内联还是命名函数都行（顺序一致性由 _test_sort_slice.js 第 5 组负责）。
// ⛔ 2026-10-06 再加一条：退路**同时排除 baziUnknown** —— 判不出八字的票不算"过了闸门"
//    （见 _test_gate_unknown.js）。这里用「可选地跟着 !baziUnknown」的写法，
//    免得以后只改一个条件时又互相打架。
ok('退路同样执行闸门（不把被否决的高分票放回池）',
  /const safe = scored\.filter\(c => !baziBlocked\(c\)(?: && !baziUnknown\(c\))?\)(?:\.sort\([^)]*\))?\.slice\(0, 20\)/.test(sv));
ok('⛔ 退路排除「判不出八字」的票（最后一道防线不能放进没审过的票）',
  /const safe = scored\.filter\(c => !baziBlocked\(c\) && !baziUnknown\(c\)\)/.test(sv));
ok('真的一只都不剩时宁可空池（宁缺勿滥）', /picked = \[\];/.test(sv));
ok('四维度分与 stage/verdict 都挂进池项（面板可读）',
  /c\.baziDims = \{[\s\S]{0,120}?trend: r\.detail\.trend/.test(sv) && /c\.bazi = \{ total: r\.total/.test(sv));
ok('推送文案带八字一行（趋势·资金·位置·承接 + 建议）',
  /八字 \$\{c\.bazi\.total\}分｜趋势/.test(sv) && /c\.bazi\.advise/.test(sv));
ok('前端候选池卡片渲染八字四维度', /八字 \$\{x\.bazi\.total\}/.test(html) && /dimSpan\('趋势'/.test(html));
ok('CODE_FILES 已登记 bazi.js（漏了线上 require 直接崩）',
  /"bazi\.js"/.test(fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8')));

console.log('\n── A2. 静态：不另起炉灶（口径必须与趋势池/大单池一致）──');
// ⛔ 八字如果自己再算一套均线/回撤，结论会和趋势池打架，用户会看到两套矛盾说法
ok('复用 analysis.bigMoneyContext 取均线位置/回撤',
  /A\.bigMoneyContext\(\{ rows, price \}\)/.test(bz));
ok('复用 analysis.volPricePattern 取量价形态', /A\.volPricePattern\(rows\)/.test(bz));
ok('涨停判定复用 A.isLimitUp（不写死 pct>=9.8）', /A\.isLimitUp\(/.test(bz) && !/pct >= 9\.8/.test(bz));
ok('缺数据的维度按中性处理并记 insufficient，不冒充结论',
  /x\.score != null \? x\.score : 50/.test(bz) && /insufficient/.test(bz));

console.log('\n── B. 合成K线：确定性判定 ──');
// 造 K 线：close 序列决定均线；pct/high/low 围绕 close 生成
function mk(closes, opt = {}) {
  const rows = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i], p = i ? closes[i - 1] : c;
    const pct = i ? +(((c - p) / p) * 100).toFixed(2) : 0;
    const amp = opt.amp != null ? opt.amp : 0.02;
    rows.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      open: p, close: c, high: +(c * (1 + amp)).toFixed(2), low: +(c * (1 - amp)).toFixed(2),
      volume: opt.vol ? opt.vol[i] || 1000 : 1000, amount: c * 1000 * 100, turnover: 2,
      amp: amp * 200, pct, chg: +(c - p).toFixed(2)
    });
  }
  return rows;
}

// ① 高位加速：连拉 5 天 + 乖离 20 日线远超 18% + 贴 60 日高点
{
  const closes = [];
  for (let i = 0; i < 55; i++) closes.push(10 * (1 + i * 0.004));   // 缓慢爬升到 ~12.1
  const base = closes[closes.length - 1];
  for (let i = 0; i < 5; i++) closes.push(+(base * (1 + 0.06 * (i + 1))).toFixed(2)); // 5天再拉 90%
  const rows = mk(closes, { amp: 0.03 });
  const price = closes[closes.length - 1];
  const r = BZ.evaluate({ code: '600000', name: '测试A', rows, price });
  ok(`高位加速被识别（stage=${r.dims.position.stage}）`, r.dims.position.stage === '高位加速');
  ok(`高位加速 → verdict 必为回避（实际 ${r.verdict}）`, r.verdict === '回避');
  ok('高位加速总分被压在 52 以下（不能因趋势分高就说可介入）', r.total <= 52, `total=${r.total}`);
}

// ② 破位整理：跌破 20 日线且 20 日线向下
{
  const closes = [];
  for (let i = 0; i < 40; i++) closes.push(+(20 - i * 0.15).toFixed(2));  // 一路阴跌到 14.15
  const rows = mk(closes, { amp: 0.02 });
  const price = closes[closes.length - 1];
  const r = BZ.evaluate({ code: '600001', name: '测试B', rows, price });
  ok(`破位整理被识别（stage=${r.dims.position.stage}）`, r.dims.position.stage === '破位整理');
  ok(`破位 → verdict 必为回避（实际 ${r.verdict}）`, r.verdict === '回避');
}

// ③ 启动位：均线多头 + 突破20日高点 + 上方还有空间 + 放量
{
  const closes = [];
  for (let i = 0; i < 30; i++) closes.push(+(10 + i * 0.08).toFixed(2));   // 稳步抬升到 12.32
  for (let i = 0; i < 8; i++) closes.push(+(closes[closes.length - 1] * 0.995).toFixed(2)); // 小幅回踩
  closes.push(13.2);   // 突破前高
  const vols = closes.map((_, i) => (i === closes.length - 1 ? 3000 : 1000));
  const rows = mk(closes, { amp: 0.015, vol: vols });
  const price = closes[closes.length - 1];
  const r = BZ.evaluate({ code: '600002', name: '测试C', rows, price });
  ok(`启动位被识别（stage=${r.dims.position.stage}）`, r.dims.position.stage === '启动位', `bias=${r.detail.bias} dd60=${r.detail.dd60}`);
  ok('启动位不是回避（至少给观察/可介入）', r.verdict !== '回避', `verdict=${r.verdict}`);
  ok('趋势维判定为多头（≥55）', r.detail.trend >= 55, `trend=${r.detail.trend}`);
}

// ④ 四维度分都必须在 0~100，且不返回 NaN
{
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(+(15 + Math.sin(i / 6) * 1.2).toFixed(2));
  const rows = mk(closes);
  const r = BZ.evaluate({ code: '600003', name: '测试D', rows, price: closes[closes.length - 1] });
  const vals = [r.detail.trend, r.detail.fund, r.detail.position, r.detail.support, r.total];
  ok('四维度分与总分都在 0~100 且非 NaN',
    vals.every(v => v != null && Number.isFinite(v) && v >= 0 && v <= 100), JSON.stringify(vals));
  ok('每个维度都给出可读 why（说不出理由的分不算分）',
    ['trend', 'fund', 'position', 'support'].every(k => (r.dims[k].why || '').length > 0));
  ok('stage / verdict 都有值', !!r.stage && !!r.verdict);
}

// ⑤ 数据不足时不崩、不编造
{
  const r1 = BZ.evaluate({ code: '600004', name: '测试E', rows: [], price: 0 });
  ok('空K线不崩，返回数据不足', !!r1 && r1.insufficient != null);
  const r2 = BZ.evaluate({ code: '600005', name: '测试F', rows: mk([10, 10.2, 10.1]), price: 10.1 });
  ok('K线过短不崩且四维度判不出来（insufficient 有值）', !!r2 && r2.insufficient != null);
}

// ⑥ 涨停当天缩量不应被判"关注度不足"（一字/封死成交天然极小）
{
  const closes = [];
  for (let i = 0; i < 40; i++) closes.push(+(10 + i * 0.05).toFixed(2));
  closes.push(+(closes[closes.length - 1] * 1.1).toFixed(2));  // 最后一天涨停
  const vols = closes.map((_, i) => (i === closes.length - 1 ? 60 : 1000));  // 涨停日量极小
  const rows = mk(closes, { amp: 0.001, vol: vols });
  const r = BZ.evaluate({ code: '600006', name: '测试G', rows, price: closes[closes.length - 1] });
  ok('涨停封板缩量不被误扣"关注度不足"',
    !/关注度不足/.test(r.dims.fund.why), r.dims.fund.why.slice(0, 60));
}

console.log('\n── C. 真票冒烟（同花顺真实K线）──');
(async () => {
  let EM = null;
  try { EM = require('./em.js'); } catch { }
  if (!EM) { console.log('⚠️ em.js 加载失败，跳过真跑段'); }
  else {
    for (const [c, n] of [['600519', '贵州茅台'], ['688008', '澜起科技']]) {
      let k = null;
      try { k = await EM.fetchKlineThs(c, 95); } catch { }
      if (!k || !k.rows || k.rows.length < 25) { console.log(`⚠️ ${c} 取不到K线，跳过`); continue; }
      const rows = k.rows, price = rows[rows.length - 1].close;
      const r = BZ.evaluate({ code: c, name: n, rows, price });
      const vals = [r.detail.trend, r.detail.fund, r.detail.position, r.detail.support, r.total];
      ok(`${c} ${n}：八字可算且分数合法（总${r.total} ${r.stage}·${r.verdict}）`,
        vals.every(v => Number.isFinite(v) && v >= 0 && v <= 100), JSON.stringify(vals));
      ok(`${c} 未出现 NaN/Infinity 文案`, !/NaN|Infinity|undefined/.test(JSON.stringify(r)));
    }
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
