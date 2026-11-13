'use strict';
// 实测重标定单测
// 核心：模型概率越高实测反而越低（≥75档 28% vs 45~65档 66~68%），所以闸门/排序必须改用实测。
// 但**证据不足时绝不能改** —— 三五天的噪声不能拿来改系统。这两条都要锁死。
// 两级证据：常规 ≥20条且跨≥5日；大样本 ≥150条且跨≥3日（否则 75+ 档 285 条实测 28% 永远不生效）。

const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}
const parts = [
  // ⚠️ 这里必须一次抓齐全部证据常量：只抓 EMP_MIN_N 会让新增常量变成未定义
  grab('const EMP_MIN_N = 20', 'EMP_REFU_GAP = 25;'),
  grab('const empMidOf =', '\n'),
  grab('const EMP_CHASE = new Set', '\n'),
  grab('const EMP_EARLY = new Set', '\n'),
  grab('const EMP_BUCKETS = [', '\n'),
  grab('const empBucketOf =', '\n'),
  grab('const empGroupOf =', '\n'),
  // ⛔ ds 轮补：empTable 现在按「概率 / 评分」两套刻度分流（empKeysOf），沙箱缺了它 →
  //    ReferenceError 崩整段。新增 empTable 的外部依赖时，这里必须同步补（第 N 次踩同一个坑）。
  grab('const PROB_KIND = {', '\n};'),
  grab('function probKindOf(type) {', '\n}\n'),
  grab('function empKeysOf(prob, type) {', '\n}\n'),
  // ⛔ empTable 现在要先过 isLiveSample（事后样本不得进标定），沙箱里缺了它 → ReferenceError
  //    整段崩掉。新增 empTable 的外部依赖时，这里必须同步补（2026-10-06 踩）。
  grab('const POST_HOC_TYPES = new Set', '\n'),
  grab('const isBacktestSample =', '\n'),
  grab('function isPostHocSample(s) {', '\n}\n'),
  grab('const isLiveSample =', '\n'),
  // ⛔ dr 轮补：empTable 的证据文案走 ppTxt（百分点单位），沙箱缺了它 → ReferenceError 崩整段
  grab('function ppTxt(v, signed) {', '\n}\n'),
  grab('let _empCache = {', '\n'),
  // ⛔ dv 轮：empTable 的出局分支现在调 skipAdd 计数 —— 沙箱漏注入 = ReferenceError 整个套件崩掉
  grab('const SKIP_RULE = {', '\n};'),
  grab('const _skipTally = ', '\n'),
  grab('function skipAdd(kind, n) {', '\n}\n'),
  // ⛔⛔ B1 轮（2026-10-17）补：empTable 现在按退役刻度过滤（isRetiredProbScale），
  //    沙箱漏注入 = ReferenceError 崩整段（同款坑第 N 次，见上方 ds 轮注释）。
  grab('const AUCZT_PROB_HONEST_MAX = 20;', '\n'),
  grab('function isRetiredProbScale(s) {', '\n}\n'),
  grab('function empTable() {', '\n}\n'),
  grab('function empProb(prob, type) {', '\n}\n'),
  grab('function effProb(prob, type) {', '\n}\n'),
];

// 造信号：type / prob / 命中与否 / 日期（用来凑"跨交易日数"）
// ⚠️ 造的是 sig.nd（信号日收盘→次日最高），不是 sig.resolved（当日回验）。
//    标定只认次日口径，造错字段会让测试全绿但测了个寂寞。
function sigs(type, prob, n, hitN, days) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type, prob, void: false,
      // 只造 days 个不同日期：跨交易日数是"证据够不够"的判据，必须能被精确控制
      date: '202609' + String((i % days) + 1).padStart(2, '0'),
      nd: { hit: i < hitN, limitUp: false },
    });
  }
  return out;
}
// 数据布局（档位互相隔离，避免"全部|档"兜底把用例串味）：
//   45-54 : histzt 52 / 40条全中 / 跨12日  → 未启动类 100%（常规）
//   55-64 : histzt 58 / 40条28中 / 跨12日  → 未启动类 70%（常规）
//   75+   : histzt 80 / 40条8中  / 跨12日  → 未启动类 20%（常规·高分倒挂）
//   65-74 : pool    70 / 200条60中 / 跨3日 → 未启动类 30%（大样本：够150条）
//           buzhang 70 / 100条20中 / 跨2日 → 追高类 20%，天数不足但实测比模型低50点 → 强证伪生效
//                                            （全部|65-74 = 300条80中 = 27%，可用来验证用的是 own 不是 all）
//   <45   : buzhang 44 / 60条全中 / 跨2日  → 实测100%远高于模型(档中值40)，单向不放行
//                                            n=60<80 也不够强证伪 → 与全部档双双不足 → 不校准
const S = {
  learn: {
    signals: [
      ...sigs('histzt', 52, 40, 40, 12),
      ...sigs('histzt', 58, 40, 28, 12),
      ...sigs('histzt', 80, 40, 8, 12),
      ...sigs('histzt', 70, 200, 60, 3),
      ...sigs('buzhang', 70, 100, 20, 2),
      ...sigs('buzhang', 44, 60, 60, 2),
    ],
  },
};
const api = new Function('S', parts.join('\n') + '\nreturn { empTable, empProb, effProb, empBucketOf, empGroupOf };')(S);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const sec = t => console.log('\n' + t);

sec('① 分档与族群划分');
{
  ok('概率 44 → <45', api.empBucketOf(44) === '<45');
  ok('概率 45 → 45-54', api.empBucketOf(45) === '45-54');
  ok('概率 55 → 55-64', api.empBucketOf(55) === '55-64');
  ok('概率 75 → 75+', api.empBucketOf(75) === '75+');
  ok('补涨龙归追高类', api.empGroupOf('buzhang') === '追高类');
  ok('相似走势归追高类', api.empGroupOf('similar') === '追高类');
  ok('histzt 归未启动类', api.empGroupOf('histzt') === '未启动类');
  ok('竞价涨停归未启动类', api.empGroupOf('auczt') === '未启动类');
  ok('未知类型归其它', api.empGroupOf('xyz') === '其它');
  // ⚠️ 防回归：漏网类型会掉进"其它"，样本分散后永远凑不够证据 = 该类型不参与校准。
  //    （bigmoney_repeat 就是这样漏了一版）新增信号类型时，这里必须同步补上。
  const KNOWN = ['histzt', 'auczt', 'pre', 'pool', 'trendsig', 'bigmoney', 'bigmoney_repeat',
    'buzhang', 'ztprob', 'similar', 'fastin'];
  const stray = KNOWN.filter(k => api.empGroupOf(k) === '其它');
  ok('线上出现过的信号类型全都归了族', stray.length === 0, stray.join(','));
}

sec('② 证据充足才校准');
{
  ok('未启动类 prob52 → 实测 100%', api.empProb(52, 'histzt') === 100, String(api.empProb(52, 'histzt')));
  ok('未启动类 prob58 → 实测 70%', api.empProb(58, 'histzt') === 70, String(api.empProb(58, 'histzt')));
  ok('未启动类 prob80 → 实测 20%（高分倒挂）', api.empProb(80, 'histzt') === 20, String(api.empProb(80, 'histzt')));
}

sec('③ 证据不足绝不校准（三五天的噪声不能改系统）');
{
  // <45 档：追高类 60 条全中（看着 100%），但只跨 2 个交易日；
  // 且该档没有别的族群样本 → "全部|<45" 同样不足 → 必须判为不校准
  const v = api.empProb(44, 'buzhang');
  ok('跨2日的60条全中样本 → 返回 null（不校准）', v === null, String(v));
  const t = api.empTable();
  ok('表里标记了 locked 与原因', !!t['追高类|<45'] && /暂不校准/.test(t['追高类|<45'].locked), JSON.stringify(t['追高类|<45']));
  ok('locked 里写清需要多少证据', /需 20 条且跨 ≥5 日/.test(t['追高类|<45'].locked));
  ok('effProb 回落用原概率（不校准≠判死）', api.effProb(44, 'buzhang') === 44);
}

sec('④ 大样本放宽：天数少但样本足够大时必须生效');
{
  const t = api.empTable();
  const k = '未启动类|65-74';
  // 200 条只跨 3 日：按"常规"标准天数不够，但样本够大 → 必须放行，
  // 否则线上 75+ 档 285 条实测 28% 会被"天数不够"卡成永远不校准。
  ok('200条/跨3日 → 判为大样本', t[k].evidence === '大样本', t[k].evidence);
  ok('该档 unlocked', t[k].locked === null, String(t[k].locked));
  ok('该档实测 30%', api.empProb(70, 'histzt') === 30, String(api.empProb(70, 'histzt')));
  ok('常规档判为常规', t['未启动类|55-64'].evidence === '常规', t['未启动类|55-64'].evidence);
  ok('不足档判为不足', t['追高类|<45'].evidence === '不足', t['追高类|<45'].evidence);
  // 边界：149 条不该够大样本（用另一档不好造，这里直接验常量关系）
  ok('大样本门槛 150 条 > 常规门槛 20 条', /EMP_BIG_N = 150/.test(SRC) && /EMP_MIN_N = 20/.test(SRC));
}

sec('⑤ 强证伪：实测远低于模型时，天数不足也必须生效');
{
  const t = api.empTable();
  const k = '追高类|65-74';
  // 100 条只跨 2 日：常规/大样本都不够，但实测 20% 比模型档中值 70% 低了 50 点，
  // 100 条的标准误才 4 个点 —— 这个鸿沟不是两天噪声能造出来的，必须放行。
  ok('判为强证伪', /强证伪/.test(t[k].evidence), t[k].evidence);
  ok('该档 unlocked', t[k].locked === null, String(t[k].locked));
  ok('用自己的实测 20%（不是回落全部档的 27%）', api.empProb(70, 'buzhang') === 20, String(api.empProb(70, 'buzhang')));
  // ⛔ 原来钉的是 `/低50点/` —— dr 轮把百分点单位统一成 pp 后假红。
  //    断言要钉**语义**（写清了差多少、带单位），不是钉单位的字面量。
  ok('evidence 写清比模型低多少（且带百分点单位）', /低50(pp|点)/.test(t[k].evidence), t[k].evidence);
}

sec('⑥ 强证伪是单向的：实测远高于模型时不放行');
{
  // <45 档：60 条全中（100%）远高于档中值 40，只跨 2 日。
  // 这种"好得离谱"更可能是噪声抬分，且放行只会放宽门槛多推票 → 必须仍判不足。
  const t = api.empTable();
  ok('追高类|<45 仍是证据不足', t['追高类|<45'].evidence === '不足', t['追高类|<45'].evidence);
  ok('不因实测高就放行', api.empProb(44, 'buzhang') === null, String(api.empProb(44, 'buzhang')));
}

sec('⑦ 族群档不足时回落到"全部|同档"（追高类是新功能，跨日天然少）');
{
  const t = api.empTable();
  ok('全部|65-74 存在且生效', !!t['全部|65-74'] && t['全部|65-74'].locked === null);
  // 未启动类 75+ 只有 40 条... 这里用"其它"族群（无样本）验证回落：
  // xyz 类型归"其它"，其它|65-74 无样本 → 必须回落到全部|65-74 = 27%
  ok('没有本族样本时回落到全部档', api.empProb(70, 'xyz') === 27, String(api.empProb(70, 'xyz')));
}

sec('⑧ 只认次日口径（当日回验不能混进标定表）');
{
  // 造一条"只有 resolved、没有 nd"的信号：它代表"盘中信号当天兑现"，
  // 不是预测力，绝不能进标定表。否则 1152 条当日样本会把真实预测力稀释掉。
  // ⚠️ resolved 必须带上真实 maxGain：只有 limitUp 而没有 maxGain 时，+(undefined||0)=0，
  //    会被 isPostHocSample 判成「已封板后登记（物理上没空间）」而排除 —— 那是 2026-10-06
  //    新加的事后样本过滤，不是本节的考点。这里造的是「当天封板且真有 6.5% 空间」的正常样本。
  const S3 = { learn: { signals: [
    { type: 'histzt', prob: 58, void: false, date: '20260901', resolved: { hit: true, limitUp: true, maxGain: 6.5 } },
  ] } };
  const a3 = new Function('S', parts.join('\n') + '\nreturn { empTable, empProb, effProb };')(S3);
  ok('只有 resolved 的信号不进表', Object.keys(a3.empTable()).length === 0, JSON.stringify(Object.keys(a3.empTable())));
  ok('因此 empProb 为 null', a3.empProb(58, 'histzt') === null);
  // 补上 nd 就应当进表
  S3.learn.signals[0].nd = { hit: false, limitUp: false };
  const a4 = new Function('S', parts.join('\n') + '\nreturn { empTable };')(S3);
  // 注意：单条样本仍会因证据不足而 locked，这里验的是"进没进表"，不是"校不校准"
  ok('补了 nd 才进表', !!a4.empTable()['未启动类|55-64'] && a4.empTable()['未启动类|55-64'].n === 1,
    JSON.stringify(Object.keys(a4.empTable())));
}

sec('⑨ 校准表内容自解释');
{
  const t = api.empTable();
  const k = '未启动类|55-64';
  ok('档内有 n/hit/rate/days', t[k].n === 40 && t[k].hit === 28 && t[k].rate === 70 && t[k].days === 12, JSON.stringify(t[k]));
  ok('证据足的档 locked 为 null', t[k].locked === null);
  ok('有全部|档 的兜底行', !!t['全部|55-64']);
  ok('有次日真涨停率 luRate', t[k].luRate === 0, JSON.stringify(t[k].luRate));
}

sec('⑩ 空数据不炸');
{
  const S2 = { learn: { signals: [] } };
  const a2 = new Function('S', parts.join('\n') + '\nreturn { empTable, empProb, effProb };')(S2);
  ok('无信号时 empProb 返回 null', a2.empProb(70, 'histzt') === null);
  ok('无信号时 effProb 回落原值', a2.effProb(70, 'histzt') === 70);
  ok('无信号时 effProb(非法值) = -1', a2.effProb(NaN, 'histzt') === -1);
}

sec('⑪ server.js 接线（不接上等于没做）');
{
  // ⚠️ 2026-10-01 升级为「学习融合」：实测标定 + 自学形态修正合成一个数，
  //    门槛与排序必须共用它（各算一次会出现"排序用一个数、放行用另一个数"）。
  ok('闸门用 fusedProb 判门槛（实测+自学）', /const _fz = fusedProb\(code,[\s\S]{0,120}type, prob\)/.test(SRC));
  ok('闸门用融合后的值比较', /useProb < mp/.test(SRC));
  ok('排序也用同一个 fusedProb（高分追高票不再排最前）', /return fusedProb\(c,[\s\S]{0,120}type, v\)\.prob/.test(SRC));
  ok('拦截原因说明"实测"多少', /同档实测/.test(SRC));
  ok('融合常量：自学修正有上下限，不会单方面定生死', /const LA_DELTA_CAP = 12/.test(SRC));
  ok('融合按【原始模型估值及事件】查实测档（不能拿修正数二次查档）', /const ei = empInfo\(out\.model, type, event\)/.test(SRC));
  ok('回验落地立刻失效标定缓存（学了就要马上改推送）', /if \(changed\) \{ _empCache\.t = 0/.test(SRC));
  ok('学习库更新后清推理缓存（否则学完了还拿旧答案推）', /laRefresh\(\);[\s\S]{0,200}_laCache = new Map\(\)/.test(SRC));
  ok('logSignal 登记融合值（否则无法验证学习有没有用）', /fused: _fz\.prob, laP: _fz\.la, empP: _fz\.emp/.test(SRC));
  ok('有学习进化自检接口', /'\/api\/learn-fused'/.test(SRC));
  ok('state 暴露 emp 表供面板核对', /emp: empTable\(\)/.test(SRC));
  ok('三级证据常量都在', /EMP_MIN_N = 20, EMP_MIN_DAYS = 5/.test(SRC)
    && /EMP_BIG_N = 150, EMP_BIG_DAYS = 3/.test(SRC) && /EMP_REFU_N = 80/.test(SRC));
  ok('有 resolveNextDay 补次日口径', /function resolveNextDay/.test(SRC));
  ok('resolveSignals 里真的调用了它', /if \(resolveNextDay\(sig/.test(SRC));
  ok('历史回测那批直接认作 nd', /mode === '历史回测' && !sig\.nd/.test(SRC));
}

sec('⑫ B1 轮：prob 三代刻度断裂 —— 退役样本不进桶、auczt 不借「全部」池');
{
  // 背景（2026-10-17 实测 stats.json）：auczt 非 void 198 条全是退役刻度（prob 30~56），
  // 诚实刻度（ig 起 9/20）样本 n=0 —— 按 prob 分桶的校准表对新信号完全是另一套尺子。
  // 布局：auczt 与 histzt 同样造 200 条/跨 3 日/60 中的 prob=70 样本。
  //   · auczt 造的是 resolved（当日封板口径，hx 例外）；histzt 造的是 nd（次日口径）。
  //   · 若退役过滤失效 → 未启动类|65-74 会是 400 条；若 auczt 还喂全部池 → 全部|65-74 也是 400 条。
  const aucztSigs = Array.from({ length: 200 }, (_, i) => ({
    type: 'auczt', prob: 70, void: false,
    date: '202609' + String((i % 3) + 1).padStart(2, '0'),
    resolved: { hit: i < 60, limitUp: i < 60, maxGain: 6.5 },
  }));
  const SB = { learn: { signals: [...aucztSigs, ...sigs('histzt', 70, 200, 60, 3)] } };
  const aB = new Function('S', parts.join('\n') + '\nreturn { empTable, empProb, _skipTally, empKeysOf };')(SB);
  const tB = aB.empTable();
  ok('auczt 用自有类型键（不共用族群键）', aB.empKeysOf(70, 'auczt')[0] === 'auczt|65-74', aB.empKeysOf(70, 'auczt')[0]);
  ok('退役刻度 auczt 不进概率桶（未启动类|65-74 只有 histzt 的 200 条）',
    tB['未启动类|65-74'] && tB['未启动类|65-74'].n === 200, JSON.stringify(tB['未启动类|65-74'] && tB['未启动类|65-74'].n));
  ok('auczt 不喂「全部」池（全部|65-74 同样只有 200 条）',
    tB['全部|65-74'] && tB['全部|65-74'].n === 200, JSON.stringify(tB['全部|65-74'] && tB['全部|65-74'].n));
  ok('跳过原因已登记且计数可见（未登记会被 skipAdd 丢弃）',
    aB._skipTally.by.empRetiredScale === 200, JSON.stringify(aB._skipTally.by));
  ok('次日口径类型的校准不受影响（histzt 70 → 实测 30%）', aB.empProb(70, 'histzt') === 30, String(aB.empProb(70, 'histzt')));
  ok('auczt 查档不借「全部」池 → null（诚实刻度样本积累前不校准）',
    aB.empProb(70, 'auczt') === null && aB.empProb(9, 'auczt') === null,
    String(aB.empProb(70, 'auczt')) + '/' + String(aB.empProb(9, 'auczt')));
  // 旧写法反证：没有退役过滤时，200 条 prob=70 的 auczt 会把 65-74 档填到 400 条、
  // 且当日封板率 30% 会被当成 auczt 的校准值读出来（拿当日尺子校准当日、还混着退役刻度）。
  const oldN = tB['未启动类|65-74'].n + tB['全部|65-74'].n;
  ok('反证锚点：过滤后两表合计 400（旧写法会是 800）', oldN === 400, String(oldN));
  // 诚实刻度临界：prob=20 是 honest 上限，≤20 不算退役（将来积累样本后要能进桶）
  const SC = { learn: { signals: Array.from({ length: 200 }, (_, i) => ({
    type: 'auczt', prob: 20, void: false,
    date: '202609' + String((i % 3) + 1).padStart(2, '0'),
    resolved: { hit: i < 60, limitUp: i < 60, maxGain: 6.5 },
  })) } };
  const aC = new Function('S', parts.join('\n') + '\nreturn { empTable };')(SC);
  ok('prob=20（诚实刻度上限）不算退役，可进 auczt 自己的档', !!aC.empTable()['auczt|<45'] && aC.empTable()['auczt|<45'].n === 200,
    JSON.stringify(aC.empTable()['auczt|<45'] && aC.empTable()['auczt|<45'].n));
  ok('诚实刻度 auczt 也不喂「全部」池', !aC.empTable()['全部|<45'], JSON.stringify(Object.keys(aC.empTable())));
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
