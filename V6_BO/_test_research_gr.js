// 守门测试：gr 轮「采纳」候选条件实证落地（2026-10-13 早盘后）
// 168 项「采纳」里 kline 可算的 17 项按 gq 同款口径（涨停日切片 n=2562、剔一字板、次日触板结局、
// 两半窗方向一致 + 共线性交叉检验）批量复测，最终新接入 3 个因子（详见 analysis.js nextDayLimitProb）：
//   ① I5 缩量涨停（量比 volRatio<0.8）→ +0.4z（每档绝对换手内 +13~17pp，阈值 0.4~1.0 同向）
//   ② K1 市场极热（涨跌家数比 mktUpRatio≥75%）→ -0.25z（每档市值内 -4~7pp，与缩量互不解释）
//   ③ M6 断板反包（limitUpCount≥2 且 brkEngulf）→ -0.5z（连板群内 -14.7pp，两半窗同向）
// 被否决留痕（结论在版本注释 + _research_gr_out.json）：M7 创新高(与市值/连板共线)、J13 试攻(跨市值符号翻转)、
//   P2 MACD底背离(同 P5 再度否决)、P4 KDJ(<20 薄样本)、K12 金叉布林/P6 布林收口/Q14 光头(无差异)、
//   R12/J9/J8 换手激增/洗盘/平台(无差异或方向反)。H1 连板基因：模型已有连板高度项，方向一致不重复计入。
// 守门：抽 nextDayLimitProb 原样真跑（同 gq/_test_model_factor 端点切割法），验证三因子。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
function cut(src, startStr, endStr) {
  const a = src.indexOf(startStr);
  if (a < 0) throw new Error('找不到起点：' + startStr);
  const b = endStr ? src.indexOf(endStr, a) : -1;
  if (endStr && b < 0) throw new Error('找不到终点：' + endStr);
  return src.slice(a, b < 0 ? undefined : b);
}
const AVS = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
const SVS = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const IHS = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// ⛔ mv 轮（2026-10-29）：版本注释链只留近 3 轮，更早历史归档 CHANGELOG.md —— 留痕判据认两处，两处皆无才红
const ARCHIVE = SVS + fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const FND = 'function nextDayLimitProb(';
const fnSrc = cut(AVS, FND, '// ---------- 选股技术因子');
const nextDayLimitProb = new Function(fnSrc + '\n; return nextDayLimitProb;')();
ok('函数可被原样切出真跑', typeof nextDayLimitProb === 'function');
ok('签名含 volRatio / brkEngulf / mktUpRatio 三新形参', /function nextDayLimitProb\(\{[^}]*volRatio[^}]*brkEngulf[^}]*mktUpRatio/.test(fnSrc));

// 基准（不含三因子）—— 首板、普通封单、非极热、无反包
const base = { limitUpCount: 1, sealRatio: 0.3, sealStrength: 0.4, breakCount: 1, sectorZT: 3, turnover: 8, aboveMa5: true, capYi: 80, rangePos: 80 };
const pBase = nextDayLimitProb(base);

console.log('\n【1】I5 缩量涨停（量比 volRatio<0.8 → +0.4z）');
{
  const pShrink = nextDayLimitProb({ ...base, volRatio: 0.6 });
  const pNormal = nextDayLimitProb({ ...base, volRatio: 1.5 });
  ok('缩量(0.6) > 常轨(1.5)', pShrink > pNormal, `${pShrink}/${pNormal}`);
  const d = pShrink - pNormal;
  ok('效应温和（不独大，+0.4z ≈ +6~13pp）', d > 3 && d < 16, 'Δ=' + d);
  // 边界 0.8（不含）
  const pAt = nextDayLimitProb({ ...base, volRatio: 0.8 });
  const pJust = nextDayLimitProb({ ...base, volRatio: 0.81 });
  ok('边界：0.8 不罚、0.81 不罚（<0.8 才罚）', pAt === pJust, `${pAt}/${pJust}`);
  // 判不出不判：null/0
  const pNull = nextDayLimitProb({ ...base, volRatio: null });
  const pZero = nextDayLimitProb({ ...base, volRatio: 0 });
  ok('缺数据(null) 不罚', pNull === pNormal, `${pNull}/${pNormal}`);
  ok('0 不罚（_n 归零）', pZero === pNormal, `${pZero}/${pNormal}`);
}

console.log('\n【2】K1 市场极热（mktUpRatio≥75 → -0.25z）');
{
  const pHot = nextDayLimitProb({ ...base, mktUpRatio: 80 });
  const pCold = nextDayLimitProb({ ...base, mktUpRatio: 40 });
  ok('极热(80) < 非极热(40)', pHot < pCold, `${pHot}/${pCold}`);
  const d = pCold - pHot;
  ok('效应温和（-0.25z ≈ +4~7pp）', d > 2 && d < 12, 'Δ=' + d);
  // 边界 75（含）
  const p75 = nextDayLimitProb({ ...base, mktUpRatio: 75 });
  const p74 = nextDayLimitProb({ ...base, mktUpRatio: 74 });
  ok('边界：75 罚、74 不罚', p75 < p74, `${p75}/${p74}`);
  ok('判不出不判（null/0）', nextDayLimitProb({ ...base, mktUpRatio: null }) === pCold && nextDayLimitProb({ ...base, mktUpRatio: 0 }) === pCold);
}

console.log('\n【3】M6 断板反包（lb>=2 且 brkEngulf → -0.5z）');
{
  const pLb2Eng = nextDayLimitProb({ ...base, limitUpCount: 2, brkEngulf: true });
  const pLb2No = nextDayLimitProb({ ...base, limitUpCount: 2, brkEngulf: false });
  ok('连板+反包 < 连板+非反包', pLb2Eng < pLb2No, `${pLb2Eng}/${pLb2No}`);
  const d = pLb2No - pLb2Eng;
  ok('效应温和（-0.5z ≈ +6~13pp）', d > 3 && d < 16, 'Δ=' + d);
  // 首板（lb=1）反包不罚
  const pLb1Eng = nextDayLimitProb({ ...base, limitUpCount: 1, brkEngulf: true });
  const pLb1No = nextDayLimitProb({ ...base, limitUpCount: 1, brkEngulf: false });
  ok('首板反包不罚（须 lb>=2）', pLb1Eng === pLb1No, `${pLb1Eng}/${pLb1No}`);
  ok('判不出不判（brkEngulf 缺省 false）', nextDayLimitProb({ ...base, limitUpCount: 2 }) === pLb2No);
  // 三因子方向互不抵消（同时触发：缩量+极热+断板反包）
  const pAll = nextDayLimitProb({ ...base, limitUpCount: 2, volRatio: 0.6, mktUpRatio: 80, brkEngulf: true });
  ok('三因子同触发仍给出 0~100 内有限值', pAll >= 0 && pAll <= 100 && isFinite(pAll), String(pAll));
}

console.log('\n【4】接线：server.js 三处真实调用点（复盘/一进二/二进三）传入三新字段');
{
  // 调用点共 4 处：432 行预览调用（不带新字段，刻意不同）+ 9908/10007/10176 三处真实接线。
  const calls = (SVS.match(/A\.nextDayLimitProb\(\{/g) || []).length;
  ok('调用点 ≥ 4 处（预览 1 + 真实 3）', calls >= 4, 'calls=' + calls);
  const wired = (SVS.match(/volRatio: flags \? flags\.volRatio : null/g) || []).length;
  const wiredB = (SVS.match(/brkEngulf: flags \? flags\.brkEngulf : false/g) || []).length;
  const wiredM = (SVS.match(/mktUpRatio: \(S\.breadth && S\.breadth\.upRatio\) \|\| null/g) || []).length;
  ok('volRatio 三处真实调用点全接', wired === 3, 'wired=' + wired);
  ok('brkEngulf 三处真实调用点全接', wiredB === 3, 'wiredB=' + wiredB);
  ok('mktUpRatio 三处真实调用点全接', wiredM === 3, 'wiredM=' + wiredM);
}

console.log('\n【5】reviewFlags 产出 volRatio / brkEngulf');
{
  const rfSrc = cut(AVS, 'function reviewFlags(', 'function buildZTReason(');
  const tNSrc = cut(AVS, 'const _tN = ', '\n'); // reviewFlags 引用了顶层辅助 _tN，沙箱需一并注入（cut 已含起始串）
  const reviewFlags = new Function(tNSrc + '\n' + rfSrc + '\n; return reviewFlags;')();
  const rows = [];
  for (let i = 0; i < 25; i++) {
    const close = 10 + i * 0.1;
    rows.push({ date: '2026-01-' + String(i + 1).padStart(2, '0'), open: close - 0.05, high: close + 0.05, low: close - 0.1, close, volume: i < 20 ? 100 : 60 });
  }
  const f1 = reviewFlags(rows, rows[rows.length - 1].close);
  ok('volRatio 为数字', typeof f1.volRatio === 'number' && f1.volRatio > 0, 'volRatio=' + f1.volRatio);
  // 构造断板反包：倒数第3日高、倒数第2日阴、今日收过昨高
  const r = [].concat(rows);
  r[r.length - 2] = { date: 'd', open: 13.5, high: 14, low: 13, close: 13.4 };   // 昨阴
  r[r.length - 3] = { date: 'd', open: 13.6, high: 15, low: 13.5, close: 14.0 };  // 前日更高
  r[r.length - 1] = { date: 'd', open: 13.5, high: 14.5, low: 13.5, close: 14.2 }; // 今收过昨高
  const f2 = reviewFlags(r, 14.2);
  ok('brkEngulf 在「昨阴+今收过昨高」为 true', f2.brkEngulf === true);
  const r3 = [].concat(rows);
  r3[r3.length - 2] = { date: 'd', open: 14.5, high: 15, low: 14, close: 14.8 }; // 昨阳
  r3[r3.length - 1] = { date: 'd', open: 14.9, high: 15.5, low: 14.9, close: 15.2 };
  const f3 = reviewFlags(r3, 15.2);
  ok('brkEngulf 在「昨阳」为 false', f3.brkEngulf === false);
}

console.log('\n【6】版本号 / 注释口径');
{
  ok('server.js APP_VER 符合 ^\d{8}[a-z]{2}$', /const APP_VER = '\d{8}[a-z]{2}'/.test(SVS));
  ok('index.html APP_VER 符合 ^\d{8}[a-z]{2}$', /const APP_VER = '\d{8}[a-z]{2}'/.test(IHS));
  ok('gr 轮三因子留痕在案（版本注释链或 CHANGELOG 归档）', /gr 轮（168 项「采纳」/.test(ARCHIVE) && /新接入缩量涨停\/市场极热\/断板反包三因子/.test(ARCHIVE));
  ok('analysis.js 含三因子实证注释', /缩量涨停（volRatio 量比<0\.8）/.test(AVS) && /市场极端亢奋（mktUpRatio 涨跌家数比≥75%）/.test(AVS) && /连板断板反包（limitUpCount>=2 且 brkEngulf）/.test(AVS));
}

console.log(`\n=== gr 轮守门：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
