'use strict';
// 守门：大单推送精准化（iq 轮，2026-10-17 用户决策表议题4·推荐A「全部按推荐来」第一项）
// 用户原话：「怎么改他才能精准推动，而不是一直在做无用功推送困难」
// 背景实证（stats.json 150 个实盘样本·次日收盘口径，2026-10-17 本地复算，与决策表逐项吻合）：
//   全样本收≥3% 12.0% / 收跌 59.3% / 均 -0.65%（全场基线 22.6% / -0.12%，无超额）；
//   prob≥80 档（14 个）收≥3% 7.1% / 均 -2.86%，prob≥90 档 0% / -3.37% → prob 是反指标；
//   时段：9 点 15.2%/+0.02% 最好 → 10 点 10.5%/-0.91% → 11 点 9.1%/-2.79% → 12 点 0%/-3.80% 最差。
// 本轮语义（⛔ 全部拿真函数在沙箱里跑，不是看注释）：
//   ① 热门路径（涨停候选）= 因子组合 ≥2：位置/板块热/启动信号/早盘窗，缺数据不计分、不默认通过
//   ② normalCand ≥1 → ≥2（对齐 2026-10-08 只改一半的注释）
//   ③ 14:30 后大单只上面板不推送（判据在 logSignal 之前，没推的不进学习库）
//   ④ bigMoneyProbGate 整条退役：bmHotZeroFallback / bigMoneySelfOptimize / CFG_RANGE / config / api 全清
//   ⑤ 推送脚注诚实标注：次日收盘口径实盘数 + prob≥80 档反证 + 当前门槛说明（两个口径各写各的名字）
//   ⑥ D5 沉默诊断行改因子口径
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到起始标记: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束标记: ' + end);
  return SRC.slice(i, j + end.length);
}
// 活代码 = 剥掉一切注释后的源码（版本链/历史说明/行尾注释里允许出现退役名词，活的代码一行不许有）
// ⛔ iq 轮补：第一版只剥整行注释，把「APP_VER 行尾的版本注释」误判成活代码残留 → 必须有状态扫描
//    （跨行模板字面量/块注释都不误伤；URL 的 // 在字符串里，不算注释起点）。
function stripComments(src) {
  let out = '', q = null, i = 0;
  while (i < src.length) {
    const c = src[i];
    if (q) {
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      if (c === q) q = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const LIVE = stripComments(SRC);

// ── ① prob 门槛整条退役（源码级钉死，防复活）──
ok(!/bmHotZeroFallback/.test(LIVE), '① D3 零候选回退机制已删除（不存在第二条 prob 调整通道）');
ok(!/bigMoneyProbGate/.test(LIVE), '① bigMoneyProbGate 在活代码里零残留（自学习/读取/回滚/api 全清）');
ok(!/bigMoneySelfOptimize/.test(LIVE), '① bigMoneySelfOptimize 已更名 bigMoneyStatsRefresh（只剩统计刷新，不调门槛）');
ok(/function bigMoneyStatsRefresh\(\) \{[\s\S]{0,200}?S\.learn\.bigMoney = bigMoneyStats\(\);/.test(LIVE), '① 统计刷新仍在（面板「学习闭环」与推送脚注的数据源不能断）');
ok(!/S\.config\.bigMoneyProbGate/.test(LIVE), '① 没有任何路径再写这个配置键');
{
  const CFG = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  ok(!('bigMoneyProbGate' in CFG), '① config.json 里该键已移除（线上发版后同步消失）');
}
{
  const m = LIVE.match(/const CFG_RANGE = \{[\s\S]*?\n\};/);
  ok(!!m, '① 取到 CFG_RANGE 表');
  const n = m ? (m[0].match(/^\s{2}\w+:\s*\{/gm) || []).length : -1;
  ok(n === 10, `① CFG_RANGE 剩 10 个数值键（原 11，退役 1；实得 ${n}）`);
}
ok(/gates: \{ simGate: _govCfg\('simGate'\) \}/.test(LIVE), '① /api/state 的 gates 只剩 simGate（不再暴露一个没人读的门槛）');

// ── ② 因子组合闸门（沙箱真跑）──
{
  const body = [
    'const BM_HOT_FACTOR_MIN = 2;',
    'const BM_EARLY_END_MIN = 10 * 60;',
    'const BM_PUSH_END_MIN = 14 * 60 + 30;',
    grab('const bmEarlyWin = now => {', '};'),
    grab('function bmHotFactors(x, now) {', '\n}'),
  ].join('\n');
  const F = new Function(body + '\nreturn { bmHotFactors, bmEarlyWin, BM_HOT_FACTOR_MIN, BM_EARLY_END_MIN, BM_PUSH_END_MIN };')();
  const T1030 = new Date(2026, 9, 19, 10, 30, 0).getTime();   // 周一 10:30（非早盘窗）
  const T0940 = new Date(2026, 9, 19, 9, 40, 0).getTime();    // 周一 09:40（早盘窗内）
  const mk = o => Object.assign({ ctx: null, heat: null, startSignal: false }, o);
  const pos = { ctx: { flowKind: '趋势中加仓' } };
  const posBad = { ctx: { flowKind: '下跌途中接盘' } };
  const heat = { heat: { hot: true } };
  ok(F.BM_HOT_FACTOR_MIN === 2 && F.BM_EARLY_END_MIN === 600 && F.BM_PUSH_END_MIN === 870,
    '② 三个常量=用户批准值（因子≥2 / 早盘窗至 10:00 / 推送截止 14:30）');
  // 因子逐个计分
  ok(F.bmHotFactors(mk(pos), T1030) === 1, '② 位置好（趋势中加仓）=1 分');
  ok(F.bmHotFactors(mk({ ctx: { flowKind: '回踩承接' } }), T1030) === 1, '② 回踩承接=1 分（与趋势中加仓同权）');
  ok(F.bmHotFactors(mk({ ctx: { flowKind: '高位放量' } }), T1030) === 0, '② 高位放量不计位置分（它不是正向因子）');
  ok(F.bmHotFactors(mk(heat), T1030) === 1, '② 板块热=1 分');
  ok(F.bmHotFactors(mk({ startSignal: true }), T1030) === 1, '② 启动信号=1 分');
  ok(F.bmHotFactors(mk({}), T1030) === 0, '② 缺数据（ctx/heat 全无）=0 分，绝不默认通过');
  ok(F.bmHotFactors(mk(posBad), T1030) === 0, '② 下跌途中接盘不计位置分（它不是承接）');
  // 组合 ≥2 才进热门路径
  ok(F.bmHotFactors(mk(Object.assign({}, pos, heat)), T1030) === 2, '② 位置+板块热=2 → 达到门槛');
  ok(F.bmHotFactors(mk(Object.assign({}, pos, { startSignal: true })), T1030) === 2, '② 位置+启动=2 → 达到门槛');
  ok(F.bmHotFactors(mk(Object.assign({}, heat, { startSignal: true })), T1030) === 2, '② 板块热+启动=2 → 达到门槛');
  // 早盘窗口本身算 1 分（时段因子），但不能独力过关
  ok(F.bmHotFactors(mk({}), T0940) === 1, '② 早盘窗内但零股票级因子=1 → 进不了热门路径（时段不是证据）');
  ok(F.bmHotFactors(mk(pos), T0940) === 2, '② 早盘窗内+位置=2 → 进（窗口只要求再中 1 个）');
  ok(F.bmEarlyWin(new Date(2026, 9, 19, 9, 30, 0).getTime()) === true, '② 早盘窗边界：09:30 整算窗口内');
  ok(F.bmEarlyWin(new Date(2026, 9, 19, 9, 29, 59).getTime()) === false, '② 早盘窗边界：09:29:59 不算');
  ok(F.bmEarlyWin(new Date(2026, 9, 19, 10, 0, 0).getTime()) === false, '② 早盘窗边界：10:00 整不算');
  // ⛔ 反证：旧 prob 写法会把这只票放进去（prob 95、零因子），新写法必须挡住
  const richProbPoorFactors = mk({ prob: 95, fused: 95 });
  ok(F.bmHotFactors(richProbPoorFactors, T1030) === 0, '② 反证：prob 95 但零因子=0 分（旧 `prob>门槛` 会进，新写法不进）');
  ok(F.bmHotFactors(mk({ prob: 30 }), T1030) === 0, '② 反证：prob 30 也不额外扣分（prob 根本不参与热门因子）');
}

// ── ③ 热门路径接线 + normalCand ≥2 + 14:30 截止（源码级）──
ok(/const hotAll = list\.filter\(x => bmHotFactors\(x, now\) >= BM_HOT_FACTOR_MIN && aged\(x, 15\) && !badCtx\(x\) && !ctxUnknown\(x\)\);/.test(LIVE),
  '③ hotAll 用因子闸门（≥2）且保留 aged/接盘/位置未判定三道老闸');
ok(!/\(x\.prob \|\| 0\) > hotGate/.test(LIVE), '③ 旧 prob 门槛比较式已不存在');
ok(/\.sort\(\(a, b\) => \(bmHotFactors\(b, now\) - bmHotFactors\(a, now\)\) \|\| \(\(b\.prob \|\| 0\) - \(a\.prob \|\| 0\)\)\)/.test(LIVE),
  '③ A 组排序改因子分优先、prob 只作 tiebreak（prob 不再是主排序键）');
// ⛔ 2026-10-27：门槛从函数内 `return score >= 2` 提到常量 BM_HOT_FACTOR_MIN（hotAll 里比较），
//    旧断言钉的是老写法 → 假红。钉语义：阈值 = 2（且绝不低于 2）。
ok(/const BM_HOT_FACTOR_MIN = 2;/.test(LIVE) && !/const BM_HOT_FACTOR_MIN = 1;/.test(LIVE),
  '③ normalCand 门槛 = 2（BM_HOT_FACTOR_MIN，与 2026-10-08 注释对齐）');
{
  const iCut = LIVE.indexOf('if (!_pushWin)');
  const iLog = LIVE.indexOf('for (const x of fresh)');
  const iPanel = LIVE.indexOf("sseSend('bigmoney'");
  ok(iCut > 0 && iLog > 0 && iCut < iLog, '③ 14:30 截止判据在 logSignal 之前（没推的不进学习库）');
  ok(iPanel > 0 && iPanel < iCut, '③ 面板 SSE 更新在截止之前（截止后面板照常刷新）');
  ok(/已过 14:30 大单推送截止/.test(LIVE), '③ 截止时 SSE 带明确 note（不是静默 return）');
  ok(/const _pushWin = new Date\(now\)\.getHours\(\) \* 60 \+ new Date\(now\)\.getMinutes\(\) < BM_PUSH_END_MIN;/.test(LIVE), '③ 截止判据是单个命名常量（改档期是一行）');
  // 截止边界（同尺子复算，源码正则已钉死真身）
  const inWin = new Function('now', 'BM_PUSH_END_MIN', 'return new Date(now).getHours() * 60 + new Date(now).getMinutes() < BM_PUSH_END_MIN;');
  ok(inWin(new Date(2026, 9, 19, 14, 29, 59).getTime(), 870) === true, '③ 边界：14:29:59 仍可推送');
  ok(inWin(new Date(2026, 9, 19, 14, 30, 0).getTime(), 870) === false, '③ 边界：14:30 整起只上面板');
}

// ── ④ 推送脚注诚实标注（双口径）──
ok(/【诚实标注·次日收盘口径/.test(LIVE), '⑤ 脚注含次日收盘口径（买入后拿到次日收盘，实盘 outcomes）');
{
  const b = grab('function bmCloseHist() {', '\n}');
  ok(b.length > 100, '⑤ 取到 bmCloseHist 函数体');
  ok(/s\.type === 'bigmoney' && s\.nd &&(?: !s\.void &&)? isLiveSample\(s\) && Number\.isFinite\(s\.nd\.closeGain\)/.test(b),
    '⑤ 收盘口径过滤与 bigMoneyStats 完全同源（type/nd/实盘样本三条件一致）');
  ok(/res\.length < 5/.test(b), '⑤ 样本不足 5 个不出这一行（宁缺勿错）');
  ok(/\(res\[i\]\.prob \|\| 0\) >= 80/.test(b), '⑤ 脚注带 prob≥80 档反证（分越高实盘越差，说给用户听）');
}
ok(/【当前门槛】因子组合≥\$\{BM_HOT_FACTOR_MIN\}/.test(LIVE), '⑤ 脚注写明当前门槛（因子组合≥2 + 14:30 截止），不再是"概率门槛由学习校准"');
ok(!/当前推送门槛/.test(LIVE), '⑤ 旧脚注「当前推送门槛 X% 由学习自动校准」已删除（那个门槛不存在了）');

// ── ⑥ D5 沉默诊断行（沙箱真跑）──
{
  const body = [
    'const BM_HOT_FACTOR_MIN = 2;',
    grab('function _diagSentN(ds, titleRe) {', '\n}'),
    "let _modSilenceDiagDay = '';",
    grab('function modSilenceDiag() {', '\n}'),
  ].join('\n');
  const PUSH_LOG = [
    { ts: 1780000000000, status: '✅ 已送达', title: '大单流入 · 甲' },
    { ts: 1780000000000, status: '🚫 条数闸门', title: '大单流入 · 乙' },     // 拦截不算推送
    { ts: 1780000000000, status: '✅ 已送达', title: '竞价预览 · 丙' },
    { ts: 1770000000000, status: '✅ 已送达', title: '大单流入 · 昨天那条' },  // 非今天
    { ts: 1780000000000, status: '⚠️ 送达结果未知', title: '相似走势 · 丁' },  // 未知也算外发过
  ];
  const DS = '20261016';
  // 「未推原因」只在今日推送 0 条时才拼进行文本（modSilenceDiag：n === 0 才追加）——
  // 所以问「为什么没推」的场景必须让该模块今天 0 条送达，不能复用上面那条已送达的大单。
  const PUSH_LOG_NO_BM = PUSH_LOG.filter(r => !/大单流入/.test(r.title || ''));
  const mkS = bm => ({ bmScanStat: bm, auction: { validCount: 180, time: '09:25:31' },
    yierList: [1], lianbanList: [], buzhang: { items: [] }, pre: { items: [] }, trendScan: [], steadyUp: [], similar: [] });
  const run = (bm, day, trade, log) => {
    const written = [];
    // ⛔ 铁律③：沙箱抠出来的块每多引用一个外部符号，就必须同步补进参数表。
    //    modSilenceDiag 里引用了 AUC_FINAL_TITLE_RE（竞价定稿标题正则），此前没注入 →
    //    整个 ⑥ 段 ReferenceError 崩掉（不是变红，是整套不跑）。这里从源码里抠出真常量再注入。
    const _aucRe = SRC.match(/const AUC_FINAL_TITLE_RE = (\/[^;]*\/[a-z]*);/);
    if (!_aucRe) throw new Error('抠不到 AUC_FINAL_TITLE_RE 定义');
    const AUC_FINAL_TITLE_RE = eval(_aucRe[1]);
    const sb = new Function('todayStr', 'isTradeDay', 'PUSH_LOG', 'pushIsOutStatus', 'dayKeyOf', 'S', 'pushLog', 'console', 'AUC_FINAL_TITLE_RE',
      body + '\nreturn { modSilenceDiag, get day(){return _modSilenceDiagDay;} };')(
      () => day, () => trade, log || PUSH_LOG,
      st => { const s = String(st == null ? '' : st); return !!s && s.indexOf('未发送') < 0 && (s.indexOf('✅') === 0 || s.indexOf('送达结果未知') >= 0); },
      ts => ts === 1780000000000 ? DS : '20261015', mkS(bm),
      (status, text) => written.push({ status, text }), { log: () => {} }, AUC_FINAL_TITLE_RE);
    sb.modSilenceDiag();
    return { written, sb };
  };
  {
    const { written } = run({ total: 12, hotAll: 0, maxProb: 44, pushWin: true }, DS, true);
    const diags = written.filter(w => w.status === '🩺 每日沉默诊断');
    ok(diags.length === 9, `⑥ 九个模块各一行诊断（实测 ${diags.length} 行）`);
    const bigmoney = diags.find(d => /大单流入/.test(d.text));
    ok(bigmoney && /今日推送 1 条/.test(bigmoney.text), '⑥ 大单行：今日 1 条（只数真送达，拦截与昨天都不算）');
    ok(bigmoney && /因子≥2候选0·扫描12只\(最高概率44%\)/.test(bigmoney.text), '⑥ 大单行带因子候选数/扫描数/最高概率（可解释，不再是"门槛X%"）');
    const auc = diags.find(d => /竞价定稿/.test(d.text));
    ok(auc && /今日推送 0 条/.test(auc.text) && /未推原因：/.test(auc.text), '⑥ 竞价定稿 0 条时给出未推原因');
    const sim = diags.find(d => /相似走势/.test(d.text));
    ok(sim && /今日推送 1 条/.test(sim.text), '⑥ 「送达结果未知」计入已外发（与 pushedToday 同口径）');
  }
  {
    // 大单今日 0 条送达 → 行文本里才拼「未推原因」
    const { written } = run({ total: 12, hotAll: 0, maxProb: 44, pushWin: true }, DS, true, PUSH_LOG_NO_BM);
    const bm = written.filter(w => w.status === '🩺 每日沉默诊断').find(d => /大单流入/.test(d.text));
    ok(bm && /今日推送 0 条/.test(bm.text) && /未推原因：无 2 因子共振候选（位置\/板块热\/启动信号\/早盘窗至少中2个，缺数据不计分）/.test(bm.text),
      '⑥ 零候选时原因是因子口径（位置/板块热/启动/早盘窗至少中 2 个）');
  }
  {
    const { written } = run({ total: 12, hotAll: 3, maxProb: 44, pushWin: false }, DS, true, PUSH_LOG_NO_BM);
    const bm = written.filter(w => w.status === '🩺 每日沉默诊断').find(d => /大单流入/.test(d.text));
    ok(bm && /已过14:30截止/.test(bm.text) && /13-14 点档/.test(bm.text), '⑥ 过了 14:30：诊断行写明截止与实证原因（有候选也不推，不是"没候选"）');
  }
  {
    const { written, sb } = run({ total: 12, hotAll: 0, maxProb: 44, pushWin: true }, DS, true);
    written.length = 0;
    sb.modSilenceDiag();
    ok(written.length === 0 && sb.day === DS, '⑥ 同一天只跑一次（_modSilenceDiagDay 闭锁）');
    const r2 = run({}, '20261017', false);
    ok(r2.written.length === 0, '⑥ 非交易日不写诊断（模块本就不该推）');
  }
  ok(/t >= 16 \* 60 \+ 30 && t < 24 \* 60\) modSilenceDiag\(\);/.test(SRC), '⑥ 16:30 后每分钟自查补跑（容器回收也不丢诊断）');
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
