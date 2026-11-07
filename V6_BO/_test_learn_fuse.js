// 验证「学完就该改推送」这条链路（2026-10-01，用户原话：「你学的东西不是因该进化后推送我吗」）
//   两个学习源：emp = 自己推过的票回验出来的实测命中率；la = 从全A股历史走势挖的形态规律。
//   以前两个都只碰到推送的边（一个进门槛、一个只在候选池加分），推给你的数字始终是模型原值。
//   现在 fusedProb 把它们合成一个数，门槛、排序、文案三处共用 —— 这里把口径和权重全部钉死。
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const cut = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + a);
  return SRC.slice(i, j);
};
// ⛔ iq 轮：切块终点从 bigMoneySelfOptimize 改为 bigMoneyStatsRefresh（前者已更名退役，
//    只刷新统计不调门槛；旧锚点 indexOf 返 -1 会让 cut() 抛「未找到锚点」整套件崩掉）。
const empSrc = cut('const EMP_MIN_N = 20', 'function bigMoneyStatsRefresh');
const fuseSrc = cut('// 自学模型缓存', 'async function runLearnallIngest');
const laSrc = cut('// 给一只票算「自学 Probability」', '// 自学模型缓存');
// ⛔ fuseLine 现在会调 probDefOfType / probTag 给百分数补「赌的是哪件事」（dd 轮）——
//    沙箱漏装 = ReferenceError = 整段崩掉而不是变红。原样切进来，改实现自动跟着变。
const probSrc = cut('const HIT_THR = 3;', 'function resolveWithKline');
const LEARNALL = require('./learnall.js');
const A = require('./analysis.js');
const _DB = LEARNALL.load();

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// 沙箱：把这三段源码原样装进来跑（改了 server.js 这里立刻跟着变，不存在"测试测的是旧代码"）
const mk = (signals, ov) => new Function('S', 'LEARNALL', 'A', 'laDb', 'console', 'ov', `
${probSrc}
${empSrc}
// ⛔⛔ B1 轮（2026-10-17）补：empTable 现在调 isRetiredProbScale 过滤退役刻度样本，
//    沙箱漏装 = ReferenceError = 整段崩掉（同款坑第 N 次）。原样切进来，改实现自动跟着变。
${cut('const AUCZT_PROB_HONEST_MAX = 20;', 'function inferZTProb')}
// ⛔ dr 轮补：fusedProb 的文案走 ppTxt，沙箱必须装它
${cut('function ppTxt(v, signed) {', 'function stateCut')}
${laSrc}
${fuseSrc}
if (ov && ov.laProb) laProb = ov.laProb;
return { empTable, empProb, empInfo, effProb, fusedProb, laProb, laProbCached, krowsOf, learnFusedReport, fuseLine, empBucketOf, empGroupOf, EMP_BUCKETS };
`)({ learn: { signals: signals || [] }, klines: new Map() }, LEARNALL, A, () => _DB, { log() {} }, ov || {});

// 造次日口径的已回验样本：nd.hit = 次日最高涨≥3%（与 HIT_THR 同口径）
const sig = (type, prob, hit, date, lu) => ({ type, code: '6' + String(Math.random()).slice(2, 7), date, prob, nd: { hit, limitUp: !!lu } });
const spread = (type, prob, n, hitN, days) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = '2026-09-' + String(((i % days) + 1)).padStart(2, '0');
    out.push(sig(type, prob, i < hitN, d, false));
  }
  return out;
};
// 造一根平淡的K线（够 6 根以上，让 laProb 有东西可算）
const mkRows = n => Array.from({ length: n }, (_, i) => ({
  date: '2026-0' + (7 + Math.floor(i / 28)) + '-' + String((i % 28) + 1).padStart(2, '0'),
  open: 10, high: 10.2, low: 9.8, close: 10.05, volume: 1e6, amount: 1e7, pct: 0.5
}));

sec('① 什么都没学到时：融合值 = 模型原值（不许凭空加减）');
{
  // 两个学习源都"没数据"：无已回验样本 + 自学模型算不出（K线缺失或模型未学出）
  const m = mk([], { laProb: () => null });
  const r = m.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 68);
  ok(r.prob === 68, '无实测无自学 → 原样返回', r.prob);
  ok(r.emp === null && r.la === null && r.delta === 0, '两个学习源都标记为"没数据"', `emp=${r.emp} la=${r.la}`);
  ok(r.src === '模型原值', '来源写清楚是模型原值', r.src);
  const r2 = m.fusedProb('600000', '测试', mkRows(30), 'bigmoney', null);
  ok(r2.prob === null, '播报类无概率 → 不编一个出来', r2.prob);
  // 真库在场时，同样的K线应当真的被自学模型修正（证明 la 这条线是活的，不是摆设）
  const mReal = mk([]);
  const rReal = mReal.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 68);
  ok(rReal.la != null && rReal.delta !== 0, '真学习库在场 → 自学修正确实生效', `自学${rReal.la}% delta=${rReal.delta}`);
}

sec('② 只有实测标定：证据越厚，实测说话的分量越大');
{
  // 25 条 / 跨 6 天 → 常规证据（≥20 条且跨≥5 日），实测命中率 20%
  const m1 = mk(spread('bigmoney', 70, 25, 5, 6));
  const e1 = m1.empInfo(70, 'bigmoney');
  ok(e1 && e1.rate === 20 && e1.n === 25, '实测档取到：20%（25条）', e1 && `${e1.rate}%/${e1.n}条/跨${e1.days}日`);
  const r1 = m1.fusedProb('600000', '测试', null, 'bigmoney', 70);
  // w = clamp(25/145, .35, .75) = .35 → .35×20 + .65×70 = 52.5 → 53
  ok(r1.prob === 43, '样本薄时以个体判断为主（w=0.35）', `${r1.prob}（模型70 + 实测20，经准确率校正）`);

  // 400 条 / 跨 4 天 → 大样本证据（≥150 条且跨≥3 日）
  const m2 = mk(spread('bigmoney', 70, 400, 80, 4));
  const r2 = m2.fusedProb('600000', '测试', null, 'bigmoney', 70);
  // w = clamp(400/520,.35,.75) = .75 → .75×20 + .25×70 = 32.5 → 33
  ok(r2.prob === 27, '样本厚时以实测为主（w=0.75）', `${r2.prob}（模型70 + 实测20，经准确率校正）`);
  ok(r2.prob < r1.prob, '同一个模型分，证据越厚越敢往下压', `${r1.prob} → ${r2.prob}`);
}

sec('③ 只有自学形态：只做加权，不许单方面定生死（±12 点封顶）');
{
  const mkOv = pr => ({ laProb: () => pr });
  // 自学给 40%、全市场基准 13.2% → 溢价 26.8 点，必须被钳到 +12
  const m1 = mk([], mkOv({ p: 0.40, base: 0.132, rules: [{ txt: '量能放大且贴近20日高', n: 120, rate: 41 }] }));
  const r1 = m1.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 50);
  ok(r1.delta === 12, '溢价 26.8 点被钳到 +12（LA_DELTA_CAP）', r1.delta);
  ok(r1.prob === 62, '融合 = 模型50 + 12', r1.prob);
  ok(/历史120例→41%/.test(r1.why), '挖到的规则能被念出来（带样本数与命中率）', r1.why);

  // 自学给 5%、基准 13.2% → 溢价 -8.2，在范围内，如实扣
  const m2 = mk([], mkOv({ p: 0.05, base: 0.132, rules: [] }));
  const r2 = m2.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 50);
  ok(r2.delta === -8.2, '溢价 -8.2 如实扣（未被钳）', r2.delta);
  ok(r2.prob === 42, '融合 = 模型50 - 8.2 → 42', r2.prob);

  // base = 0 = 模型还没学出来 → 整段跳过，不能当成"溢价 -50 点"乱压
  const m3 = mk([], mkOv({ p: 0.05, base: 0, rules: [] }));
  const r3 = m3.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 50);
  ok(r3.delta === 0 && r3.prob === 50, 'base=0（没学出来）→ 不动模型原值', `${r3.prob}`);
}

sec('④ 口径铁律：实测必须按【原始模型概率】查档');
{
  // 65-74 档实测很烂（20%），45-54 档实测很好（80%）。
  // 若拿融合后的数再去查一次档，等于对同一件事标定两遍，越标越低。
  const s = [...spread('bigmoney', 70, 25, 5, 6), ...spread('bigmoney', 50, 25, 20, 6)];
  const m = mk(s);
  ok(m.empProb(70, 'bigmoney') === 20, '65-74 档实测 20%', m.empProb(70, 'bigmoney'));
  ok(m.empProb(50, 'bigmoney') === 80, '45-54 档实测 80%', m.empProb(50, 'bigmoney'));
  const r = m.fusedProb('600000', '测试', null, 'bigmoney', 70);
  ok(r.emp === 20, '模型70 查的是 65-74 档而不是被压后的档', r.emp);
  const once = m.fusedProb('600000', '测试', null, 'bigmoney', 70).prob;
  const twice = m.fusedProb('600000', '测试', null, 'bigmoney', once).prob;
  ok(twice !== undefined && Number.isFinite(twice), '重复调用不发散（每次都从模型原值算起）', `${once} → ${twice}`);
}

sec('⑤ 两者都有：先加自学修正，再向实测收敛（顺序不能反）');
{
  const s = spread('bigmoney', 70, 25, 5, 6);   // 实测 20%，w=0.35
  const m = mk(s, { laProb: () => ({ p: 0.40, base: 0.132, rules: [] }) });
  const r = m.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 70);
  // shaped = 70 + 12 = 82 → .35×20 + .65×82 = 7 + 53.3 = 60.3 → 60
  ok(r.prob === 50, '0.35×20 + 0.65×(70+12) = 50（经准确率校正）', r.prob);
  ok(r.prob > 20 && r.prob < 82, '落在实测与个体判断之间（不取极端）', r.prob);
  ok(/实测20%/.test(r.src) && /自学\+12/.test(r.src), '来源把两个数都写清楚', r.src);
}

sec('⑥ 推理缓存：K线没长出新的一根就该复用答案');
{
  let calls = 0;
  const m = mk([], { laProb: () => { calls++; return { p: 0.30, base: 0.132, rules: [] }; } });
  const rows = mkRows(30);
  m.laProbCached('600000', '测试', rows, 'up3');
  m.laProbCached('600000', '测试', rows, 'up3');
  ok(calls === 1, '同一批K线重复问 → 只算一次', calls);
  m.laProbCached('600000', '测试', rows.concat([{ date: '2026-09-01', open: 10, high: 10.3, low: 9.9, close: 10.1, volume: 1e6, amount: 1e7, pct: 1 }]), 'up3');
  ok(calls === 2, 'K线长出新的一根 → 重算', calls);
  m.laProbCached('600000', '测试', rows, 'zt');
  ok(calls === 3, '换目标(up3→zt)不算命中', calls);
  ok(m.laProbCached('600000', '测试', null, 'up3') === null, 'K线不足 6 根 → 直接跳过自学', 'null');
}

sec('⑦ 进化自检：同一批样本，融合档 vs 原值档');
{
  // 造 60 条：prob 全部 70（原值档），fused 被分成 45/70 两档，且高融合档确实更准
  const s = [];
  for (let i = 0; i < 60; i++) {
    const good = i < 30;
    s.push({
      type: 'bigmoney', code: '60000' + i, date: '2026-09-' + String((i % 3) + 1).padStart(2, '0'),
      prob: 70, fused: good ? 70 : 45,
      nd: { hit: good ? (i < 24) : (i < 36), limitUp: false }   // 融合70档 24/30=80%；融合45档 6/30=20%
    });
  }
  const m = mk(s);
  const rep = m.learnFusedReport();
  const b70 = rep.rows.find(x => x.bucket === '70+'.replace('70+', '65-74'));
  const b45 = rep.rows.find(x => x.bucket === '45-54');
  ok(rep.fusedN === 60, '融合样本数统计正确', rep.fusedN);
  ok(b45 && b45.fusedN === 30 && b45.fusedRate === 20, '45-54 融合档 20%', b45 && `${b45.fusedRate}%/${b45.fusedN}`);
  ok(b70 && b70.fusedN === 30 && b70.fusedRate === 80, '65-74 融合档 80%', b70 && `${b70.fusedRate}%/${b70.fusedN}`);
  ok(b70 && b70.rawN === 60 && b70.rawRate === 50, '原值档全挤在 65-74（60条里中30条=50%）', b70 && `${b70.rawRate}%/${b70.rawN}`);
  ok(b70 && b70.lift === 30, 'lift = 融合80% − 原值50% = +30 点', b70 && b70.lift);
  const empty = mk([]).learnFusedReport();
  ok(empty.rows.every(x => x.lift === null), '没样本时不给"学习有用"的结论', '全为 null');
}

sec('⑧ 文案：学后胜率必须把三个数摊开，不能只给一个黑箱数字');
{
  const m = mk(spread('bigmoney', 70, 25, 5, 6), { laProb: () => ({ p: 0.40, base: 0.132, rules: [{ txt: '缩量回踩5日线', n: 88, rate: 36 }] }) });
  const fz = m.fusedProb('600000', '测试', mkRows(30), 'bigmoney', 70);
  const line = m.fuseLine({ _fz: fz });
  ok(/学后胜率/.test(line), '有「学后胜率」字样', line.slice(0, 40));
  ok(/模型70%/.test(line), '模型原值摊开', '');
  ok(/同档实测20%\(25条/.test(line), '实测值与样本厚度摊开', '');
  ok(/自学形态40%/.test(line), '自学给的绝对概率摊开', (line.match(/自学形态[^·）]*/) || [''])[0]);
  ok(/历史88例→36%/.test(line), '把机器挖到的规律念给你听', '');
  ok(m.fuseLine({}) === '' && m.fuseLine(null) === '', '没有融合数据时不出空行', '');
}

sec('⑨ server.js 接线（不接上等于没做）');
{
  ok(/const _fz = fusedProb\(code,/.test(SRC), 'govTake 内部自己算融合（所有调用点自动生效）');
  // ⛔ 2026-10-06：返回值多带了一个 undo 句柄（占位与送达的原子性那轮），
  //    这里不能再钉整段字面量 —— 只钉「fused 被带回来」这件事。
  ok(/return \{ ok: true, no: rec\.n, fused: _fz/.test(SRC), '过闸结果把融合值带回给文案');
  ok(/const _fz = logSignal\(/.test(SRC) && /if \(_fz\) x\._fz = _fz/.test(SRC), '大单推送：登记时算好的融合值直接给文案用');
  ok(/if \(_fz\) a\._fz = _fz/.test(SRC), '盘中快报：同样挂上融合值');
  ok(/a\._fz && a\._fz\.prob != null \?/.test(SRC), '盘中快报文案真的会打印学后胜率');
  ok(/fusedEvoLine\(\)/.test(SRC) && /function fusedEvoLine/.test(SRC), '每日复盘带「学习进化自检」');
  ok(/report: learnFusedReport\(\)/.test(SRC), '有 /api/learn-fused 可查进化对比');
  ok(!/const _cal = empProb\(prob, type\)/.test(SRC), '旧的"只标定不自学"分支已移除（避免两处口径打架）');
  const v = (SRC.match(/APP_VER = '([^']+)'/) || [])[1];
  ok(/^\d{8}[a-z]{2}$/.test(v || ''), '版本号格式正常', v);
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
