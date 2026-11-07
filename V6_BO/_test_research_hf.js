// 守门测试：hf 轮 kline 可算候选因子实证落地（2026-10-14）
// 6 个候选按 gs 同款口径（_research_hf.js，涨停日切片 n=551、剔一字板/ST/北交所/新股，
// 结局=次日触板，两半窗方向一致 + 三层市场环境 dow/side/up 分层）批量实证，结论：
//   ✅ 接入：P11 CCI(14) —— >150 40.1%(n=274,Δ+2.5) / 50~150 36.5%(n=192,Δ-1.1) / ≤50 31.8%(n=85,Δ-5.8)，
//      三档全部两半窗同向、三层环境无显著变差（>150 档 down -1.0/side +1.2/up +6.9），单调结构。
//      系数取实测 log-odds 保守端：>150 +0.105→+0.1z／≤50 -0.257→-0.2z（单一因子不独大）。
//   ❌ 实证否决（留痕，不接）：P1 GMMA 张力（正档 Δ+3.2 但半窗背离，无稳健方向）、
//      P3 MACD 柱体（唯一正档 0~0.5 Δ+6.6 但半窗 n<30 样本不足）、
//      Q2 岛形反转（有孤岛 n=38 半窗 n<30）、J16 主升浪（正档半窗背离：down -4.0 vs up +6.9）、
//      U8 ADX 趋势强度（正档半窗背离）。
// 守门：抽 nextDayLimitProb / reviewFlags 原样真跑（同 gq/gr/gs 端点切割法），
//   验证 CCI 公式真值 + 单调性 + 边界 + 缺数据不判 + 单一因子不独大 + 剥块反证 + 三处真实接线。
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

console.log('【0】版本号 / 函数可切出');
{
  ok('server.js APP_VER 符合 ^\\d{8}[a-z]{2}$', /const APP_VER = '\d{8}[a-z]{2}'/.test(SVS));
  ok('index.html APP_VER 符合 ^\\d{8}[a-z]{2}$', /const APP_VER = '\d{8}[a-z]{2}'/.test(IHS));
  const FND = 'function nextDayLimitProb(';
  const fnSrc = cut(AVS, FND, '// ---------- 选股技术因子');
  ok('nextDayLimitProb 可被原样切出真跑', fnSrc.includes('function nextDayLimitProb('));
  ok('签名含 cci 新形参', /function nextDayLimitProb\(\{[^}]*cci/.test(fnSrc));
  ok('hf 轮版本注释记录 CCI 实证口径', /hf 轮（2026-10-14）6 个 kline 可算候选因子实证/.test(AVS) && /只有 CCI\(14\) 过全部稳健关/.test(AVS));
  ok('实证注释含「两半窗同向 + 三层市场环境」方法', /两半窗同向、三层市场环境无显著变差/.test(AVS));
  global.__fnSrc = fnSrc;
}

const nextDayLimitProb = new Function(global.__fnSrc + '\n; return nextDayLimitProb;')();
// reviewFlags 引用顶层辅助 _tN（rangePos/CCI 两处 IIFE 内），注入时一并提供
const RF = 'function reviewFlags(';
const rfSrc = cut(AVS, RF, 'function buildZTReason(');
const _tN = 'const _tN = (r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };';
const reviewFlags = new Function(_tN + '\n' + rfSrc + '\n; return reviewFlags;')();
ok('reviewFlags 可被原样切出真跑', typeof reviewFlags === 'function');

// 基准（不含 CCI）：首板、普通封单、非极热、无反包、常轨量、无跳空、无信号日
const base = { limitUpCount: 1, sealRatio: 0.3, sealStrength: 0.4, breakCount: 1, sectorZT: 3, turnover: 8, aboveMa5: true, capYi: 80, rangePos: 80, volRatio: 1.2, brkEngulf: false, mktUpRatio: 50, gapUp: false, sigDate: null };
const pBase = nextDayLimitProb(base);
ok('基准概率可算(0~100)', pBase > 0 && pBase < 100, 'pBase=' + pBase);

console.log('\n【1】P11 CCI(14) 双端阈值（>150 +0.1z / ≤50 -0.2z）');
{
  const pHot = nextDayLimitProb({ ...base, cci: 200 });
  const pMid = nextDayLimitProb({ ...base, cci: 100 });
  const pLow = nextDayLimitProb({ ...base, cci: 0 });
  ok('强档(>150) > 中档(50~150)', pHot > pMid, `${pHot}/${pMid}`);
  ok('中档(50~150) = 基准（不传 cci 与传中档值等价）', pMid === pBase, `${pMid}/${pBase}`);
  ok('弱档(≤50) < 基准', pLow < pBase, `${pLow}/${pBase}`);
  ok('单调：强 > 中 > 弱', pHot > pBase && pBase > pLow, `${pHot}/${pBase}/${pLow}`);
  const dHot = pHot - pBase, dLow = pBase - pLow;
  ok('强档效应温和（+0.1z ≈ +2pp，不独大）', dHot > 0 && dHot <= 5, 'Δ=' + dHot);
  ok('弱档效应温和（-0.2z ≈ -4pp，不独大）', dLow > 0 && dLow <= 8, 'Δ=' + dLow);
  // 极端值不放大：系数是定档的，CCI=1e9 与 CCI=151 同档
  const pHuge = nextDayLimitProb({ ...base, cci: 1e9 });
  const pNega = nextDayLimitProb({ ...base, cci: -1e9 });
  ok('极端大值不放大效应（=151 档）', pHuge === pHot, `${pHuge}/${pHot}`);
  ok('极端小值不放大效应（=0 档）', pNega === pLow, `${pNega}/${pLow}`);
}

console.log('\n【2】边界（150/151、50/51）与缺数据不判');
{
  const p150 = nextDayLimitProb({ ...base, cci: 150 });
  const p151 = nextDayLimitProb({ ...base, cci: 151 });
  const p50 = nextDayLimitProb({ ...base, cci: 50 });
  const p51 = nextDayLimitProb({ ...base, cci: 51 });
  ok('150 归中档（=基准）', p150 === pBase, `${p150}/${pBase}`);
  ok('151 归强档（>基准）', p151 > pBase, `${p151}/${pBase}`);
  ok('51 归中档（=基准）', p51 === pBase, `${p51}/${pBase}`);
  ok('50 归弱档（<基准）', p50 < pBase, `${p50}/${pBase}`);
  // ⛔ 缺数据三形态都必须不判：null/undefined/NaN
  //   （⛔ Number(null)===0 会落进 ≤50 弱档，所以必须显式判 null —— 这条就是钉这个坑的）
  const pNull = nextDayLimitProb({ ...base, cci: null });
  const pUndef = nextDayLimitProb({ ...base, cci: undefined });
  const pNaN = nextDayLimitProb({ ...base, cci: NaN });
  const pNoKey = nextDayLimitProb({ ...base });
  ok('cci=null 不判（=基准，不被当成弱档）', pNull === pBase, `${pNull}/${pBase}`);
  ok('cci=undefined 不判（=基准）', pUndef === pBase, `${pUndef}/${pBase}`);
  ok('cci=NaN 不判（=基准）', pNaN === pBase, `${pNaN}/${pBase}`);
  ok('不传 cci 键 = 基准', pNoKey === pBase, `${pNoKey}/${pBase}`);
}

console.log('\n【3】reviewFlags 产出 cci（公式真值 + 判出不判）');
{
  // 手算真值：窗口 14 根 TP = 13×1 + 1×2 → MA=15/14, MD=26/196,
  //   CCI=(2-15/14)/(0.015×26/196)=466.666…→toFixed(1)=466.7；镜像递减 → -466.7
  function mkRows(lastTp, opt) {
    const rows = [];
    for (let i = 0; i < 26; i++) {
      const tp = i === 25 ? lastTp : 1;
      rows.push({ date: '2026-09-' + String(10 + i).padStart(2, '0'), open: tp, high: tp, low: tp, close: tp, volume: 1000 });
    }
    if (opt && opt.dropHighIdx != null) delete rows[opt.dropHighIdx].high;
    if (opt && opt.shortName) for (const r of rows) { r.h = r.high; r.l = r.low; r.c = r.close; delete r.high; delete r.low; delete r.close; }
    return rows;
  }
  const fUp = reviewFlags(mkRows(2), 2);
  ok('递增末根 CCI=466.7（手算真值）', fUp && fUp.cci === 466.7, 'cci=' + (fUp && fUp.cci));
  const fDn = reviewFlags(mkRows(0.5), 0.5);
  ok('递减末根 CCI=-466.7（手算真值）', fDn && fDn.cci === -466.7, 'cci=' + (fDn && fDn.cci));
  const fFlat = reviewFlags(mkRows(1), 1);
  ok('MD=0（14 根 TP 全同）→ cci=null 不判（CCI=0 是中性值，不进弱档）', fFlat && fFlat.cci === null, 'cci=' + (fFlat && fFlat.cci));
  const fMiss = reviewFlags(mkRows(2, { dropHighIdx: 20 }), 2);
  ok('窗口内任一根缺 high → cci=null（半根数据算出的是错值）', fMiss && fMiss.cci === null, 'cci=' + (fMiss && fMiss.cci));
  const fShort = reviewFlags(mkRows(2, { shortName: true }), 2);
  ok('短名字段(h/l/c)兼容（_tN 多名字）', fShort && fShort.cci === 466.7, 'cci=' + (fShort && fShort.cci));
  ok('K 线不足 25 根 → 整体 null（判出不编）', reviewFlags(mkRows(2).slice(0, 20), 2) === null);
}

console.log('\n【4】单一因子不独大 / 垃圾输入仍返回 0~100 有限数');
{
  const junk = [
    { ...base, cci: 'abc' }, { ...base, cci: {} }, { ...base, cci: [] }, { ...base, cci: true },
    { ...base, cci: Infinity }, { ...base, cci: -Infinity }, { ...base, cci: '150' },
    { limitUpCount: 'x', sealRatio: null, cci: null }, {}, { ...base, cci: 1e-9 },
  ];
  ok('垃圾/极端输入仍返回 0~100 有限数', junk.every(j => { const v = nextDayLimitProb(j); return Number.isFinite(v) && v >= 0 && v <= 100; }));
  const pInf = nextDayLimitProb({ ...base, cci: Infinity });
  ok('cci=Infinity 不判（isFinite 拦下，=基准）', pInf === pBase, `${pInf}/${pBase}`);
  const pStr = nextDayLimitProb({ ...base, cci: '150' });
  ok('cci="150"（数字字符串）按 150 中档处理', pStr === pBase, `${pStr}/${pBase}`);
  const pTiny = nextDayLimitProb({ ...base, cci: 1e-9 });
  ok('cci=1e-9（>0 且 ≤50）归弱档', pTiny < pBase, `${pTiny}/${pBase}`);
}

console.log('\n【5】剥块反证（没有 cci 因子块时高低档必须无差别）');
{
  // 按花括号配对从「const _cci = Number(cci);」起删掉整个语句块，得到改动前的等价实现
  function stripBlock(src, marker) {
    const i = src.indexOf(marker);
    if (i < 0) return null;
    const j = src.indexOf('{', i);
    if (j < 0) return null;
    let depth = 0;
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(0, i) + src.slice(k + 1); }
    }
    return null;
  }
  const oldSrc = stripBlock(global.__fnSrc, 'const _cci = Number(cci);');
  ok('cci 因子块可被定位剥出（反证前提）', typeof oldSrc === 'string' && !oldSrc.includes('_cci'));
  if (oldSrc) {
    const oldFn = new Function(oldSrc + '\n; return nextDayLimitProb;')();
    const oHot = oldFn({ ...base, cci: 200 });
    const oLow = oldFn({ ...base, cci: 0 });
    ok('剥掉后：强档=弱档=基准（证明判别力来自新块，不是别处）', oHot === oLow && oHot === oldFn(base), `${oHot}/${oLow}/${oldFn(base)}`);
    ok('剥掉后与现版基准一致（只差 cci 一项，其余口径未动）', oldFn(base) === pBase, `${oldFn(base)}/${pBase}`);
  }
}

console.log('\n【6】server.js 三处真实调用点接线');
{
  const wC = (SVS.match(/cci: flags \? flags\.cci : null/g) || []).length;
  ok('cci 三处真实调用点全接（复盘/一进二/二进三）', wC === 3, 'wC=' + wC);
  // 预览调用点(432 行 sectorSurge)不应带 cci（无 kline 可算，带上就是假数据）
  const previewSeg = SVS.slice(SVS.indexOf('sectorSurge'), SVS.indexOf('sectorSurge') + 4000);
  ok('预览调用点不带 cci（无 kline 不编数据）', !/cci:/.test(previewSeg.slice(0, previewSeg.indexOf('nextDayLimitProb') + 200)));
}

console.log(`\n=== hf 轮守门：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
