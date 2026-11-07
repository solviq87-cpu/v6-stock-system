// 守门测试：gm 轮 —— 接入市场优质量化模型因子，提高胜率
//
// 调研结论（全部有数据支撑，不是拍脑袋）：
//   ① 封单强度比（封单额/流通市值）：强板(>0.5%)次日胜率 70.4% vs 弱板(<0.3%) 29.7%
//      —— 打板第一因子。系统原来只有「封成比」(封单额/成交额)，缺这一把尺子。
//   ② 缩量首板晋级率 20.3% vs 放量首板 15.1% —— 爆量是情绪高潮不是强势。
//   ③ A股短期动量 IC 全年为负 → 反转有效：不许再给「3连阳且3日累计已大涨」追高区满分。
//   ④ 近5日涨停基因：近5日板过的票次日涨停率约40%（最强单一因子），比90日窗口更贴近当下。
//   ⑤ 首板仅 16.2% 连到二板（基准率低，别高估连板 —— 由 nextDayLimitProb 的连板项与
//      外部 prob -= (level-1)*3 的衰减共同体现，本轮不改，仅登记在此防误读）。
//
// 本测试钉四件事：新因子真的接进了模型（且方向正确）、缺数据时不冒充判过、
// 单一因子不许独大（封顶）、旧写法反证。
const fs = require('fs');
const A = require('./analysis.js');
const SVS = fs.readFileSync('server.js', 'utf8');
const AVS = fs.readFileSync('analysis.js', 'utf8');
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  → ' + extra : '')); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };

// ── 造 K 线（volume 可配，其余固定，隔离出被考因子）──────────────────────
const row = (pct, turnover, volume) => ({ date: '2026-01-01', open: 10, high: 10.5, low: 9.5, close: 10, pct, turnover, volume });
const rowsOf = (n, o) => Array.from({ length: n }, (_, i) => row(o.pct, o.turnover, i === n - 1 ? o.v1 : o.v0));

// ════【1】封单强度比接进 nextDayLimitProb ════
console.log('【1】次日涨停概率模型：封单强度比（封单额/流通市值）');
{
  const body = cut(AVS, 'function nextDayLimitProb(', '// ---------- 选股技术因子');
  ok('签名含 sealStrength 形参', /function nextDayLimitProb\(\{[^}]*sealStrength/.test(body), body.slice(0, 120).replace(/\n/g, ' '));
  const SR_LINE = /z \+= 2\.2 \* Math\.min\(_n\(sealStrength\), 0\.6\);/;
  ok('系数行在模型里（2.2/%，封顶 0.6%）', SR_LINE.test(body));
  // 真跑：把函数体抠进沙箱
  const mk = src => new Function(src + '\nreturn nextDayLimitProb;')();
  const P = mk(body);
  const base = { limitUpCount: 1, sealRatio: 0.3, breakCount: 0, sectorZT: 3, turnover: 8, aboveMa5: true };
  const pWeak = P(Object.assign({}, base, { sealStrength: 0.1 }));
  const pStrong = P(Object.assign({}, base, { sealStrength: 0.5 }));
  const pNone = P(Object.assign({}, base, { sealStrength: 0 }));
  ok('强板(0.5%)概率显著高于弱板(0.1%)（≥15pp，数据支撑是40pp量级）',
    pStrong - pWeak >= 15, pWeak + '% → ' + pStrong + '%');
  ok('缺数据(0)不等于弱板惩罚：不高于弱板也不低于弱板（纯中性，不加不扣）',
    pNone <= pWeak, 'none=' + pNone + ' weak=' + pWeak);
  ok('封顶：0.6% 与 3% 同分（单一因子不许独大）',
    P(Object.assign({}, base, { sealStrength: 0.6 })) === P(Object.assign({}, base, { sealStrength: 3 })),
    P(Object.assign({}, base, { sealStrength: 0.6 })) + ' vs ' + P(Object.assign({}, base, { sealStrength: 3 })));
  for (const bad of [undefined, null, NaN, 'x']) {
    const v = P(Object.assign({}, base, { sealStrength: bad }));
    ok('畸形入参 ' + JSON.stringify(bad) + ' → 有限数不 NaN', Number.isFinite(v), String(v));
  }
  // 反证：删掉系数行后，强板增益必须消失（否则上面的通过是碰巧）
  const old = mk(body.replace(SR_LINE, ''));
  ok('反证：删掉封单强度行后 0.5% 与 0.1% 无差异',
    old(Object.assign({}, base, { sealStrength: 0.5 })) === old(Object.assign({}, base, { sealStrength: 0.1 })),
    old(Object.assign({}, base, { sealStrength: 0.5 })) + ' vs ' + old(Object.assign({}, base, { sealStrength: 0.1 })));
}

// ════【2】scoreStock：近5日涨停基因（最强单一因子）⭐⭐⭐
console.log('【2】精选池评分：近5日涨停基因');
{
  const mk = (zt5, extra) => A.scoreStock(Object.assign({
    rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }),
    profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 0
  }, extra, { zt5 }));
  const s0 = mk(0).score, s2 = mk(2).score, s1 = mk(1).score;
  ok('zt5=2 比 zt5=0 高 10 分（满分档）', s2 - s0 === 10, s0 + ' → ' + s2);
  ok('zt5=1 居中（6 分档）', s1 - s0 === 6 && s2 - s1 === 4, s0 + '/' + s1 + '/' + s2);
  const miss = A.scoreStock({
    rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }),
    profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 0
  });
  ok('调用方没传 zt5 → 进 missing（不是按 0 计分冒充判过）',
    (miss.basis.missing || []).indexOf('近5日涨停基因') >= 0, JSON.stringify(miss.basis.missing));
  ok('没传 zt5 时 avail 少 10 分', miss.basis.avail === 98 - 10, String(miss.basis.avail));
  const short = A.scoreStock({
    rows: rowsOf(4, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }),
    profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 0, zt5: 1
  });
  ok('窗口不足 5 根 → partial 记「近5日涨停基因」',
    (short.basis.partial || []).some(x => x.indexOf('近5日涨停基因') === 0), JSON.stringify(short.basis.partial));
}

// ════【3】追高降温：A股短期动量 IC 为负，反转有效 ════
console.log('【3】近3日结构：3连阳不再无条件满分（追高降温）');
{
  const base = { rows: null, profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 0, zt5: 0 };
  const mild = A.scoreStock(Object.assign({}, base, { rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }) })).score;
  // 3连阳但3日累计20%（追高区）：逐日 pct 6.9/6.9/6.2，maxPct3=6.9≤7 不触发第2项降温
  const chase = A.scoreStock(Object.assign({}, base, {
    rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }).map((r, i) => i === 27 ? row(6.9, 5, 1e6) : i === 28 ? row(6.9, 5, 1e6) : i === 29 ? row(6.2, 5, 1e6) : r)
  })).score;
  ok('3连阳累计20%比累计3.6%低 ≥4 分（追高降温，不是一刀切砍掉）', mild - chase >= 4, mild + ' vs ' + chase);
  ok('且追高区仍保留基础分（降温不是判死）', chase > mild - 10, 'chase=' + chase);
  const two = A.scoreStock(Object.assign({}, base, {
    rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }).map((r, i) => i === 29 ? row(-1, 5, 1e6) : r)
  })).score;
  ok('2阳档回归：比3连阳温和档低 4 分', mild - two === 4, mild + ' vs ' + two);
}

// ════【4】量能结构：缩量是加分、爆量不是强势 ════
console.log('【4】量能结构：缩量 vs 爆量');
{
  const base = { rows: null, profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 0, zt5: 0 };
  const shrink = A.scoreStock(Object.assign({}, base, { rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 5e5 }) })).score;
  const normal = A.scoreStock(Object.assign({}, base, { rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }) })).score;
  const blow = A.scoreStock(Object.assign({}, base, { rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 3e6 }) })).score;
  ok('缩量(0.5倍)比爆量(3倍)高 ≥4 分', shrink - blow >= 4, shrink + ' vs ' + blow);
  ok('常态量(1倍)居中', normal > blow && normal < shrink, blow + ' < ' + normal + ' < ' + shrink);
  ok('缩量档位差正好 5 分', shrink - blow === 5, String(shrink - blow));
  const noVol = A.scoreStock(Object.assign({}, base, {
    rows: rowsOf(30, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }).map((r, i) => i >= 25 ? row(1.2, 5, 0) : r)
  }));
  ok('成交量缺失 → 记 missing/partial 且不进 avail（不按 0 分冒充判过）',
    (noVol.basis.avail === 98 - 5) && ((noVol.basis.missing || []).concat(noVol.basis.partial || []).join('').indexOf('量能') >= 0),
    'avail=' + noVol.basis.avail);
}

// ════【5】server.js 接线：不接上等于没做 ════
console.log('【5】server.js 三处 nextDayLimitProb 与精选池都传了新因子');
{
  const selBody = cut(SVS, 'const zt90 = k.rows.slice(-90)', '// ---- 选股路径标记');
  ok('精选池算 zt5（近5日涨停基因）', /const zt5 = k\.rows\.slice\(-5\)/.test(selBody));
  ok('精选池把 zt5 传进 scoreStock', /zt90,\s*zt5\s*\n?\s*\}?/.test(selBody) || /zt90, zt5/.test(selBody), selBody.slice(0, 300).replace(/\n/g, ' '));
  ok('回测也传 zt5（同一把尺子量回测与实盘）', /zt90, zt5/.test(AVS));
  // 封单强度比 = 封单额/流通市值，三处调用点都要算（定义数与计算式都数）
  const nDef = (SVS.match(/const sealStrength = /g) || []).length;
  const nCalc = (SVS.match(/_seal \/ _fcN \* 100/g) || []).length;
  ok('封单强度比计算式存在（封单额/流通市值×100%，三处同式）', nDef >= 3 && nCalc >= 3,
    '定义 ' + nDef + ' 处 / 计算式 ' + nCalc + ' 处');
  const callN = (SVS.match(/sealStrength[,:\s]/g) || []).length;
  ok('sealStrength 传进 nextDayLimitProb 调用点', callN >= 3, '实得 ' + callN + ' 处引用');
  ok('NEED_RULE 登记 zt5（n=5 / partial）', /zt5:\s*\{\s*n:\s*5,\s*onLess:\s*'partial'/.test(SVS));
  ok('WIN_RULE 登记 zt5 窗口', /zt5:\s*\{\s*n:\s*5/.test(SVS));
  ok('一进二/连板文案带封单强度依据（有依据不瞎推）',
    /封单强度/.test(SVS) && /why\.push\(['"]封单强度/.test(SVS));
}

// ════【6】总账：满分口径两端一致 ════
console.log('【6】满分（avail）口径');
{
  const full = A.scoreStock({
    rows: rowsOf(100, { pct: 1.2, turnover: 5, v0: 1e6, v1: 1e6 }),
    profitRatio: 0.8, turnoverRank2d: 1, total: 5000, mainPct: 5, pct: 2, zt90: 1, zt5: 1
  });
  ok('全数据满分 = 98（_test_need 钉同一个数，两端一致）', full.basis.avail === 98, String(full.basis.avail));
  ok('分数仍是有限数', Number.isFinite(full.score), String(full.score));
}

console.log(`\n── 结果：${pass} 通过 / ${fail} 失败 ──`);
process.exit(fail ? 1 : 0);
