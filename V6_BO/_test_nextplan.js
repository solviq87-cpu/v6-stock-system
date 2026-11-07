// 次日作战计划 nextplan.js 离线验证
// 沙箱无行情，用构造数据把每一条评分规则都跑到位，确保逻辑是真的按写的那样执行。
const N = require('./nextplan.js');
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const sec = t => console.log('\n' + t);

// 构造 30 行 K 线：前面平量 base，最后一天放量 mult 倍、涨幅 pct%
function mkKlines(n = 30, baseVol = 10000, lastMult = 1, lastPct = 3, drift = 0.001) {
  const rows = [];
  let px = 10;
  for (let i = 0; i < n; i++) {
    px = px * (1 + drift);
    const vol = i === n - 1 ? baseVol * lastMult : baseVol;
    const p = i === n - 1 ? lastPct : drift * 100;
    rows.push({ date: '2026-09-' + String(i + 1).padStart(2, '0'), open: px, close: px * (1 + p / 100), high: px * (1 + Math.abs(p) / 100 + 0.005), low: px * (1 - 0.005), volume: vol, amount: vol * px, amp: 2, pct: p });
  }
  return rows;
}
function fundDays(contIn, lastNet) {
  // contIn = 末尾连续净流入天数
  const a = [];
  for (let i = 0; i < 6; i++) {
    const isIn = i >= 6 - contIn;
    const net = isIn ? 1e6 : -1e6;
    a.push({ date: 'd' + i, main: net, super: net * 0.6, big: net * 0.4, mid: -net * 0.6, small: -net * 0.4 });
  }
  if (lastNet != null) a[5].main = lastNet;
  return a;
}

sec('① 量比计算：必须做「分钟折算」，否则早盘量比虚高');
{
  // 过去5日均量 10000 手/日 → 每分钟均量 = 10000/240
  // 若至今只走了 30 分钟、成交 5000 手 → 每分钟 166.7 → 量比 = 166.7/(10000/240)= 4.0
  const rows = mkKlines(30, 10000, 0.5, 1);   // 最后一天 0.5倍=5000
  const vr30 = N.volumeRatio(rows, 30);
  ok('盘中30分钟：5000手 → 量比≈4.0（分钟折算生效）', Math.abs(vr30 - 4.0) < 0.15, String(vr30));
  const vr240 = N.volumeRatio(rows, 240);
  ok('同一天按收盘算：5000手 → 量比≈0.5', Math.abs(vr240 - 0.5) < 0.02, String(vr240));
  ok('样本不足(<6根)返回 null 而非瞎猜', N.volumeRatio([{ volume: 1 }], 240) === null);
  // 全天 3 倍量
  const r3 = mkKlines(30, 10000, 3, 5);
  ok('全天3倍量 → 量比≈3.0', Math.abs(N.volumeRatio(r3, 240) - 3.0) < 0.1, String(N.volumeRatio(r3, 240)));
}

sec('② 量比必须结合位置解读 —— 同样是放量，低位和高位结论相反');
{
  const a = N.volumeVerdict(4, { pct: 5, prevDaysUp: 3 });    // 低位放量
  const b = N.volumeVerdict(4, { pct: 5, prevDaysUp: 25 });   // 高位放量
  ok('中低位放量是加分（资金介入）', a.scoreDelta > 0, JSON.stringify(a));
  ok('高位放量不加分甚至扣分（出货风险）', b.scoreDelta < a.scoreDelta, JSON.stringify(b));
  ok('高位暴量明确回避', N.volumeVerdict(8, { prevDaysUp: 30 }).scoreDelta < 0);
  ok('极度缩量无资金关注 → 负分', N.volumeVerdict(0.4, { prevDaysUp: 0 }).scoreDelta < 0);
  ok('缺数据时中性不给分也不扣分', N.volumeVerdict(null, {}).scoreDelta === 0);
}

sec('③ 每条候选都要能回答四个问题：为什么买/怎么动手/错在哪/怎么验证');
{
  const rows = mkKlines(30, 10000, 2.2, 4.5, 0.004);
  const u = {
    stock: { code: '600001', name: '示例股份', price: 12.5, pct: 4.5, turnover: 9.2, mainInflow: 2.2e7 },
    rows,
    sector: { name: '央企改革', ztCount: 4, pct: 3.1, mainInflow: 3e8 },
    fundDays: fundDays(3, 2.2e7)
  };
  const r = N.evaluate(u, {});
  ok('没有被丢弃', !r.drop, JSON.stringify(r));
  ok('给出了>>为什么选它<<的多条逻辑理由', r.reasons.length >= 3, JSON.stringify(r.reasons));
  ok('逻辑里包含量比解读（用户点名要学会看的）', r.reasons.some(s => s.indexOf('量比') === 0), JSON.stringify(r.reasons));
  ok('逻辑里包含板块效应', r.reasons.some(s => s.indexOf('所属板块') >= 0));
  ok('逻辑里包含资金连续性', r.reasons.some(s => s.indexOf('主力净') >= 0) && r.inflowDays === 3, String(r.inflowDays));
  ok('给出了进场区间', Array.isArray(r.entry) && r.entry[0] > 0 && r.entry[1] > r.entry[0], JSON.stringify(r.entry));
  ok('给出了止损且止损低于现价', r.stop && r.stop < r.price, `${r.stop} < ${r.price}`);
  // 关键：止损必须在纪律区间内。MA5 远离现价时不能给出 -30% 这种「假止损」
  ok('止损不窄于 -4.5%（给波动留空间）', r.stop <= r.price * 0.955 + 0.02, `${r.stop} vs ${(r.price * 0.955).toFixed(2)}`);
  ok('止损不宽于 -8%（止损必须有执行意义）', r.stop >= r.price * 0.92 - 0.02, `${r.stop} vs ${(r.price * 0.92).toFixed(2)}`);
  ok('给出了目标位且高于现价', r.target > r.price, String(r.target));
  ok('给出了「什么情况算我错了」（失效条件）', r.invalid.length >= 2, JSON.stringify(r.invalid));
  ok('给出了次日验证条件', r.confirm.length >= 2, JSON.stringify(r.confirm));
  ok('评分在 0~100 之间', r.score >= 0 && r.score <= 100, String(r.score));
  ok('给出了可执行档位', /布局|轻仓|观察|观望/.test(r.grade), r.grade);
}

sec('④ 排除项：ST、停牌、样本不足 —— 一律不推');
{
  const rows = mkKlines(30, 10000, 2, 4);
  const base = () => ({ rows, sector: { name: 'X', ztCount: 2, pct: 2, mainInflow: 1e8 }, fundDays: fundDays(2, 1e7) });
  const r1 = N.evaluate({ ...base(), stock: { code: '600002', name: '*ST海核', price: 5, pct: 4, turnover: 5 } }, {});
  ok('ST 股直接排除', !!r1.drop && /ST/.test(r1.drop), JSON.stringify(r1));
  const r2 = N.evaluate({ ...base(), stock: { code: '600003', name: '停牌股份', price: 8, pct: 0, turnover: 0, suspended: true } }, {});
  ok('停牌股直接排除', !!r2.drop && /停牌/.test(r2.drop), JSON.stringify(r2));
  const r3 = N.evaluate({ ...base(), rows: [{ volume: 1, close: 1 }], stock: { code: '600004', name: '新股', price: 9, pct: 1, turnover: 3 } }, {});
  ok('K线不足直接排除', !!r3.drop && /样本不足/.test(r3.drop), JSON.stringify(r3));
}

sec('⑤ 资金连续性与守恒校验');
{
  const ok4 = fundDays(3, 2e7);
  ok('连续3日净流入被识别', N.fundOf({ mainInflow: 2e7 }, ok4).cont === 3, String(N.fundOf({ mainInflow: 2e7 }, ok4).cont));
  const bad = fundDays(3, 2e7); bad[5] = { date: 'x', main: 2e7, super: 9e6, big: 9e6, mid: 9e6, small: 9e6 };
  const f = N.fundOf({ mainInflow: 2e7 }, bad);
  ok('四类资金不守恒时标记脏数据（不硬判多空）', f.valid === false && /不守恒/.test(f.note), JSON.stringify(f));
  const neg = fundDays(0, -3e7);
  const r = N.evaluate({ stock: { code: '600005', name: '流出股份', price: 10, pct: 2, turnover: 5, mainInflow: -3e7 }, rows: mkKlines(30, 10000, 2, 2), sector: { name: 'X', ztCount: 2, pct: 2, mainInflow: 1e8 }, fundDays: neg }, {});
  ok('当日主力净流出会在风险/逻辑中体现', r.reasons.some(s => /流出/.test(s)), JSON.stringify(r.reasons));
}

sec('⑥ 整池扫描：排序 + 阈值 + 数量控制');
{
  const uni = [];
  for (let i = 0; i < 12; i++) {
    const strong = i < 4;
    uni.push({
      stock: { code: '6001' + String(i).padStart(2, '0'), name: '票' + i, price: 10 + i * 0.3, pct: strong ? 5 : 0.4, turnover: strong ? 9 : 2, mainInflow: strong ? 2e7 : -1e6 },
      rows: mkKlines(30, 10000, strong ? 2.4 : 0.8, strong ? 5 : 0.3, strong ? 0.005 : 0),
      sector: { name: strong ? '主线板块' : '冷门板块', ztCount: strong ? 5 : 0, pct: strong ? 3 : -0.5, mainInflow: strong ? 4e8 : -1e7 },
      fundDays: fundDays(strong ? 3 : 0, strong ? 2e7 : -1e6)
    });
  }
  const p = N.buildPlan(uni, { maxPicks: 4, minScore: 55 });
  ok('产出了计划对象', !!p && typeof p.count === 'number');
  ok('结果按分数降序', p.picked.every((x, i) => i === 0 || p.picked[i - 1].score >= x.score), p.picked.map(x => x.score).join(','));
  ok('数量不超过 maxPicks', p.picked.length <= 4, String(p.picked.length));
  ok('低于 minScore 的没进来', p.picked.every(x => x.score >= 55));
  ok('强势票排在最前', p.picked[0] && p.picked[0].sector === '主线板块', p.picked[0] && p.picked[0].sector);
  const mid = N.buildPlan(uni, { maxPicks: 4, minScore: 70 });
  const strict = N.buildPlan(uni, { maxPicks: 4, minScore: 90 });
  ok('阈值抬高后结果单调减少（宁缺毋滥，不硬凑名额）', strict.picked.length <= mid.picked.length && mid.picked.length <= p.picked.length,
    `55分→${p.picked.length} / 70分→${mid.picked.length} / 90分→${strict.picked.length}`);
  ok('每条都必须够及格分才出来（不会为凑数量放水）', p.picked.every(x => x.score >= 55));
}

sec('⑦ 推送排版：逻辑必须摊开，不能只有一句"关注XXX"');
{
  const rows7 = mkKlines(30, 10000, 2.6, 5.2, 0.006);
  const price7 = +rows7[rows7.length - 1].close.toFixed(2);   // 价格与K线自洽，样例才可信
  const uni = [{
    stock: { code: '600111', name: '龙头股份', price: price7, pct: 5.2, turnover: 11, mainInflow: 5e7 },
    rows: rows7,
    sector: { name: '人工智能', ztCount: 6, pct: 4.2, mainInflow: 6e8 },
    fundDays: fundDays(4, 5e7)
  }];
  const p = N.buildPlan(uni, { maxPicks: 3, minScore: 40 });
  const msg = N.formatPlan(p);
  ok('生成了排版文本', !!msg && msg.length > 100);
  ok('含【为什么选它】段落', msg.indexOf('为什么选它') >= 0);
  ok('含【怎么动手】段落', msg.indexOf('怎么动手') >= 0);
  ok('含【什么情况算我错了】段落（这是最重要的风控）', msg.indexOf('算我错了') >= 0);
  ok('含次日验证条件', msg.indexOf('怎么验证') >= 0);
  ok('不含买卖保证性措辞', !/必涨|稳赚|保证/.test(msg));
  ok('空结果返回 null（不推空消息）', N.formatPlan({ picked: [] }) === null);
  console.log('\n  ── 文本样例 ──\n' + msg.split('\n').map(s => '  ' + s).join('\n'));
}

sec('⑧ 自主 review 修复项的回归锁 —— 这些改动极易被改回去，必须钉住');
{
  const rows = mkKlines(30, 10000, 2.2, 4.5, 0.004);
  const base = (stock) => ({
    rows,
    sector: { name: '主线板块', ztCount: 4, pct: 3, mainInflow: 3e8 },
    fundDays: fundDays(3, 2e7),
    stock
  });

  // ── 修复①：资金「没数据」不能被谎报成「净流出」 ────────────────
  // 原缺陷复现：fundOf 拿不到值时 f.net 是 undefined，而 undefined >= 0 为 false，
  // 于是走到 else 分支打出「主力净流出 -」——把"无数据"说成"利空"，实战会平白错过票。
  // 注意：必须「既不传 fundDays、stock.mainInflow 也为 undefined」才是真正的无数据场景。
  // 第一次写这段测试时我在 base() 里默认塞了 fundDays → 根本没有复现出缺陷，
  // 断言却还是绿的（检查"无流出"当然通过），这是典型的假绿测试，已修正。
  const noFund = N.evaluate({
    rows,
    sector: { name: '主线板块', ztCount: 4, pct: 3, mainInflow: 3e8 },
    fundDays: undefined,
    stock: { code: '600201', name: '无数据股份', price: 12, pct: 4, turnover: 9 }
  }, {});
  ok('无资金数据时：明确说清是没数据', noFund.reasons.some(s => /无主力资金数据/.test(s)), JSON.stringify(noFund.reasons));
  ok('无资金数据时：绝不出现「净流出」字样（不把缺数据当利空）',
    !noFund.reasons.concat(noFund.risks).some(s => /流出/.test(s)),
    JSON.stringify(noFund.reasons.concat(noFund.risks)));
  ok('无资金数据时：mainNetIn 保持为空而不是 0', noFund.mainNetIn == null, String(noFund.mainNetIn));
  ok('无资金数据时：给出可行动的风险提示', noFund.risks.some(s => /缺主力资金数据/.test(s)), JSON.stringify(noFund.risks));
  ok('无资金数据时：资金维度不倒扣', (noFund.dims && noFund.dims.资金) === 0, JSON.stringify(noFund.dims));

  // ── 修复②：分维度打分公开 + 权重可调 ─────────────────────────
  ok('返回 dims 五维且齐全', noFund.dims && ['板块', '资金', '量比', '技术', '纪律'].every(k => typeof noFund.dims[k] === 'number'),
    JSON.stringify(noFund.dims));
  const w1 = N.evaluate(base({ code: '600202', name: '权重测试', price: 12, pct: 2, turnover: 9 }), {});
  ok('默认权重下 score === 五维之和(clamp 0~100)',
    w1.score === Math.max(0, Math.min(100, Math.round(['板块', '资金', '量比', '技术', '纪律'].reduce((s, k) => s + w1.dims[k], 0)))),
    `${w1.score} vs ${JSON.stringify(w1.dims)}`);
  const w2 = N.evaluate(base({ code: '600202', name: '权重测试', price: 12, pct: 2, turnover: 9 }), { weights: { 技术: 0, 板块: 0, 量比: 0 } });
  ok('把某维权重调为 0 后 score 确实下降（权重真的生效）', w2.score < w1.score, `默认${w1.score} → 归零后${w2.score}`);
  const w3 = N.evaluate(base({ code: '600202', name: '权重测试', price: 12, pct: 2, turnover: 9 }), { weights: { 资金: 2 } });
  ok('资金权重加倍后 score 提升（用户可调出自己的偏好）', w3.score > w1.score, `默认${w1.score} → 资金x2后${w3.score}`);

  // ── 修复③：T+1 交易纪律必须写出来 ───────────────────────────
  ok('返回 rules 且含 A股T+1 约束', Array.isArray(w1.rules) && w1.rules.some(s => /T\+1/.test(s) && /不能卖出/.test(s)), JSON.stringify(w1.rules));
  ok('rules 含「高开超区间宁可放弃」的追高约束', w1.rules.some(s => /高开/.test(s) && /放弃|不追/.test(s)));

  // ── 修复④：涨停判定按板块，禁止写死 9.8 ──────────────────────
  // 写死 9.8 时：创业板涨 15%（根本没涨停）会被误判涨停 → 白扣 14 分；
  // 而 ST 股 5% 涨停看不见。这里从 evaluate 的行为上直接验证。
  const cyb = N.evaluate(base({ code: '300751', name: '创业科技', price: 12, pct: 15, turnover: 9 }), {});
  ok('创业板涨15%【不算】涨停（20%限幅）→ lc 因>7.5%透支 drop，且 drop 文案不得写「涨停收盘」',
    !!(cyb.drop && /透支/.test(cyb.drop) && !/涨停收盘/.test(cyb.drop)), JSON.stringify(cyb));
  const bj = N.evaluate(base({ code: '920002', name: '北交股份', price: 12, pct: 15, turnover: 9 }), {});
  ok('北交所涨15%【不算】涨停（30%限幅）→ 同样按透支 drop', !!(bj.drop && /透支/.test(bj.drop) && !/涨停收盘/.test(bj.drop)), JSON.stringify(bj));
  const main10 = N.evaluate(base({ code: '600203', name: '主板股份', price: 12, pct: 10, turnover: 9 }), {});
  ok('主板涨10%【算】涨停 → lc 主推 drop 只进接力（用户口径）', !!(main10.drop && /涨停收盘/.test(main10.drop) && /接力/.test(main10.drop)), JSON.stringify(main10));
  const main10r = N.evaluate(base({ code: '600203', name: '主板股份', price: 12, pct: 10, turnover: 9 }), { allowLimitUp: true });
  ok('接力通道（allowLimitUp）放行涨停票并保留限幅提示', !main10r.drop && /10%限幅/.test(JSON.stringify(main10r.risks || [])), JSON.stringify(main10r));

  // ── 修复⑤：日期必须是本地日期，不能用 UTC ─────────────────────
  // 凌晨生成的计划若写成前一天，整套计划的可信度直接崩塌。
  const early = new Date(2026, 8, 29, 3, 20);   // 2026-09-29 03:20 本地
  ok('本地日期：凌晨3点不会被记成前一天', N.localDate(early) === '2026-09-29', N.localDate(early));
  ok('UTC 写法确实会错（确认这个坑真实存在）', early.toISOString().slice(0, 10) !== '2026-09-29', early.toISOString().slice(0, 10));
  ok('buildPlan 的 date 字段与本地日期一致', N.buildPlan([], {}).date === N.localDate());

  // ── 修复⑥：排序必须稳定（可复盘） ────────────────────────────
  const uni2 = [];
  for (let i = 0; i < 6; i++) {
    uni2.push({
      stock: { code: '6003' + String(i).padStart(2, '0'), name: '同分票' + i, price: 10, pct: 4, turnover: 9, mainInflow: 2e7 },
      rows: mkKlines(30, 10000, 2.2, 4, 0.004), sector: { name: '同板块', ztCount: 4, pct: 3, mainInflow: 3e8 }, fundDays: fundDays(3, 2e7)
    });
  }
  const s1 = N.buildPlan(uni2, { maxPicks: 6, minScore: 0 }).picked.map(x => x.code).join(',');
  const s2 = N.buildPlan(uni2, { maxPicks: 6, minScore: 0 }).picked.map(x => x.code).join(',');
  ok('同分票两次扫描顺序一致（序号稳定才能复盘）', s1 === s2, `${s1} | ${s2}`);

  // ── 修复⑦：涨幅缺失不能打出 "+null%" 这种脏文案 ────────────────
  const fakePlan = { date: '2026-09-29', picked: [{ code: '600204', name: '缺涨幅', price: 10, pct: null, score: 60, grade: '观察', dims: { 板块: 0, 资金: 0, 量比: 0, 技术: 0, 纪律: 0 }, entry: [9.9, 10.1], stop: 9.5, target: 11, reasons: ['r'], risks: [], invalid: ['i'], confirm: ['c'] }] };
  const raw = N.formatPlan(fakePlan);
  ok('涨幅未知时不出现 "null%"', raw.indexOf('null%') < 0 && raw.indexOf('涨幅未知') >= 0);

  // ── 格式样例：确认分维度与纪律真的进了推送文案 ─────────────────
  const pA = N.buildPlan([base({ code: '600205', name: '样板股份', price: 12.5, pct: 4.5, turnover: 9.2, mainInflow: 2.2e7 })], { maxPicks: 1, minScore: 0 });
  const msgA = N.formatPlan(pA) || '';
  ok('推送文案含分项打分（让人看懂分怎么来的）', /分项: 板块/.test(msgA), msgA.split('\n').find(s => /分项/.test(s)) || '(缺失)');
  ok('推送文案含【交易纪律】段落', msgA.indexOf('交易纪律') >= 0);
}

// ── 修复⑧：止损必须落在纪律区间，不许算出「假止损」 ──────────────
// 高位加速票的 MA5 会被远远甩在下面，直接拿 MA5 当止损能算出 -30%，
// 那等于告诉用户"跌到 -30% 才走"，实际早就亏穿了。护栏强制约束在 -4.5%~-8%。
{
  const sp = [];
  let px = 10;
  for (let i = 0; i < 25; i++) {
    px = i < 21 ? 10 : 20;   // 最后 4 天跳涨一倍，MA5 被拉到 18 附近
    sp.push({ date: 'd' + i, open: px, close: px, high: px * 1.01, low: px * 0.99, volume: 10000 });
  }
  const r = N.evaluate({ stock: { code: '600206', name: '高位加速', price: 20, pct: 4, turnover: 9, mainInflow: 2e7 }, rows: sp, sector: { name: '同板块', ztCount: 4, pct: 3, mainInflow: 3e8 }, fundDays: fundDays(3, 2e7) }, {});
  const dn = (r.price - r.stop) / r.price * 100;
  ok('高位加速票止损不宽于 -8%（不许拿远离的MA5当止损）', dn <= 8.1, `止损 ${r.stop}，幅度 -${dn.toFixed(1)}%`);
  ok('止损不严于 -4.5%（别把正常波动设成止损）', dn >= 4.4, `幅度 -${dn.toFixed(1)}%`);
  ok('进场区间跨现价且不超过 ±1.5%', r.entry[0] < r.price && r.entry[1] > r.price && r.entry[1] / r.price < 1.02);
}

// ── 修复⑨：模块必须真的被 server.js 挂载（2026-10-01 才补上） ──────
// 事故：nextplan.js 2026-09-29 就写完了，server.js 里却零处 require —— 无 API、无定时、
// 无面板，等于没跑过一次。用户 2026-10-01 凌晨质问「为什么不推涨停票让我买」才暴露。
// 这类"写了没接"的坑只有源码断言能锁住：模块自身再正确，没挂载对用户就是不存在。
{
  const fs = require('fs');
  const S = fs.readFileSync('./server.js', 'utf8');
  const P = fs.readFileSync('./_publish.py', 'utf8');
  ok('server.js 必须 require nextplan', /const NP = require\('\.\/nextplan'\)/.test(S));
  ok('必须有 computeNextPlan 主入口', /async function computeNextPlan/.test(S));
  ok('必须有推送文案构建 buildNextPlanMessage', /function buildNextPlanMessage/.test(S));
  ok('必须有 /api/nextplan 路由（GET 看 + POST 重算）', /'\/api\/nextplan'/.test(S));
  ok('state 必须输出 nextplan 供面板渲染', /nextplan: S\.nextplan \|\| null/.test(S));
  ok('必须有收盘后 15:45 的定时推送', /15 \* 60 \+ 45/.test(S));
  ok('必须有 nextPlanSentDate 每日只发一条的闭锁', /nextPlanSentDate/.test(S));
  ok('休市日不得拿昨天的池子编明日计划', /await dataTradeDay\(\)/.test(S) && /tradeDay !== todayDash/.test(S));
  ok('无票时明说宁可空仓，不许凑数', /宁可空仓，也不凑数/.test(S));
  ok('nextplan.js 必须在发布清单 CODE_FILES 里', /nextplan\.js/.test(P));
}

// ── 修复⑩：涨停票必须单独成段（用户问的就是"涨停的票明天能干吗"） ──────
// 涨停票被纪律项硬扣 14 分，55 分门槛下几乎全灭（实测 9/30 的 52 只最高 48 分）。
// 若只留主推段，用户永远看不到涨停票 —— 等于没回答他的问题。所以单列 45 分段的"涨停接力"。
{
  const fs = require('fs');
  const S = fs.readFileSync('./server.js', 'utf8');
  ok('必须有涨停接力段（ztCodes 子群）', /ztCodes/.test(S) && /relayRaw/.test(S));
  ok('涨停子群门槛必须低于主推（45 vs 55）', /minScore: 45/.test(S) && /minScore: 55/.test(S));
  ok('接力文案必须写明"做不到就别碰"', /做不到就别碰/.test(S));
  ok('接力段必须标注高风险/要盯盘', /高风险/.test(S) && /盯盘/.test(S));
  ok('接力段要带连板数与封单（人对着7连板和首板决心不同）', /limitUpCount/.test(S) && /sealAmount/.test(S));
  ok('relay 必须进 state 供面板渲染', /relay,/.test(S));
}

sec('⑥ lc：用户口径「别给我涨停/开太高的」——排除项沙箱');
{
  const mkU = (over, rowsOver) => Object.assign({
    rows: Array.from({ length: 25 }, (_, i) => ({ date: '2026-10-' + String(i + 1).padStart(2, '0'), open: 10 + i * 0.02, close: 10 + i * 0.02, high: 10.05 + i * 0.02, low: 9.98 + i * 0.02, pct: 0.2, volume: 5000 })),
    sector: { name: 'X', ztCount: 3, pct: 2.5, mainInflow: 2e8 },
    fundDays: fundDays(2, 1e7)
  }, over || {});
  const highOpen = mkU({ stock: { code: '600301', name: '高开股份', price: 12, pct: 3.5, turnover: 8 } });
  highOpen.rows[24] = { ...highOpen.rows[24], open: 11.0, close: 12, pct: 3.5 };   // 较前收 ~10.44 高开 >5%
  highOpen.rows[23] = { ...highOpen.rows[23], close: 10.44 };
  const rGap = N.evaluate(highOpen, {});
  ok('高开>5% → drop「开太高」', !!(rGap.drop && /高开 \d/.test(rGap.drop)), JSON.stringify(rGap));
  const rDp = N.evaluate(mkU({ stock: { code: '600302', name: '透支股份', price: 12, pct: 9, turnover: 8 } }), {});
  ok('当日涨>7.5%（非涨停）→ drop「透支」', !!(rDp.drop && /透支/.test(rDp.drop)), JSON.stringify(rDp));
  const rBest = N.evaluate(mkU({ stock: { code: '600303', name: '温和股份', price: 12, pct: 4, turnover: 8 } }), {});
  ok('3-5% 温和走强：最高分档（+10）且不因涨停/高开被误杀', !rBest.drop && rBest.dims && rBest.dims.纪律 >= 10, JSON.stringify(rBest.dims));
}
console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
