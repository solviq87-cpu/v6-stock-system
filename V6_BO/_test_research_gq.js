// 守门测试：gq 轮「先调研」项实证落地（2026-10-13）
// 用户 10-12 决策表 95 项「先调研」中，按「数据可得 + 有实测支撑 + 离胜率近」筛出 5 项做实：
//   ① I6 市值U型/M4 小盘衰减/V13 微盘 → 合一为「流通市值分档」实证后接入模型（大市值惩罚）
//   ② I7 底部首板效应 → 实证后接入模型（中位/半山腰惩罚；「底部更强」的假设被数据否定）
//   ③ H9 换手率区间 → 实证无区分度，不新增因子（结论登记在版本注释与研究产物里）
//   ④ P5 RSI超卖底背离 → 实证无edge（背离组触板率反而低于普通超卖），不采纳
//   ⑤ Y7 ATR动态止损 → 实证后接入模拟盘（混合规则：ATR2× 钳[-10%,用户底线]）
// 另修 go 轮 C2 的收尾：推送统计脚注的胜率门改显当前生效值（偏冷时不再一屏两个数）。
// 实证产物：_research_gq.js / _research_gq2.js / _research_gq_out.json（研究脚本不入发布包）。
// 不依赖网络：模型/止损函数从源码原样切出真跑；接线用源码语义断言。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// 剥注释取函数体（防版本注释里的同款字样误命中；括号配平，不固定行号）
function cut(src, startStr, endStr) {
  const a = src.indexOf(startStr);
  if (a < 0) throw new Error('找不到起点：' + startStr);
  const b = endStr ? src.indexOf(endStr, a) : -1;
  if (endStr && b < 0) throw new Error('找不到终点：' + endStr);
  return src.slice(a, b < 0 ? undefined : b);
}
function grabFn(src, startRe) {
  const m = startRe.exec(src);
  if (!m) throw new Error('找不到锚点 ' + startRe);
  const i = m.index;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}

const AVS = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
const SVS = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const IHS = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// ⛔ mv 轮（2026-10-29）：版本注释链按 AGENTS.md 只留近 3 轮，更早历史原样归档 CHANGELOG.md。
//    「研究结论/被否决项留痕」的语义不变、只是换了家 —— 判据认两处（链内 或 归档内），两处皆无才红。
const ARCHIVE = SVS + fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const LA = require(path.join(ROOT, 'learnall.js'));

console.log('=== gq 轮守门：实证因子 / ATR 动态止损 / 胜率门显示口径 ===\n');

// ════════════【1】nextDayLimitProb：市值分档 + 位置分档（实证后接入）════════════
console.log('【1】模型：大市值惩罚 + 中位（半山腰）惩罚');
{
  // ⛔ 形参是解构对象（{...}），花括号配平会提前收在形参上 —— 用端点切割（同 _test_model_factor）
  const fnSrc = cut(AVS, 'function nextDayLimitProb(', '// ---------- 选股技术因子');
  const nextDayLimitProb = new Function(fnSrc + '\n; return nextDayLimitProb;')();
  ok('签名含 capYi / rangePos 形参', /function nextDayLimitProb\(\{[^}]*capYi[^}]*rangePos/.test(fnSrc));

  const base = { limitUpCount: 2, sealRatio: 0.3, sealStrength: 0.4, breakCount: 1, sectorZT: 3, turnover: 8, aboveMa5: true };
  const p0 = nextDayLimitProb(base);
  const pSmall = nextDayLimitProb({ ...base, capYi: 50 });
  const pMid = nextDayLimitProb({ ...base, capYi: 150 });
  const pBig = nextDayLimitProb({ ...base, capYi: 600 });
  ok('同样入参：小市值(50亿) ≥ 中市值(150亿) ≥ 大市值(600亿)，单调递减', pSmall >= pMid && pMid >= pBig, `${pSmall}/${pMid}/${pBig}`);
  ok('≥100亿 确实被罚（150亿 < 不传）', pMid < p0, `${pMid} vs ${p0}`);
  ok('≥500亿 罚得更重（600亿 < 150亿）', pBig < pMid, `${pBig} vs ${pMid}`);
  ok('<100亿 不加分也不罚（50亿 == 不传）', pSmall === p0, `${pSmall} vs ${p0}`);
  // 判不出 ≠ 判了不行：缺市值与「传 0」必须同结果（0 不在任何惩罚档）
  ok('capYi 缺失/0/NaN/null 一律不判（与不传同结果）',
    nextDayLimitProb({ ...base, capYi: 0 }) === p0
    && nextDayLimitProb({ ...base, capYi: NaN }) === p0
    && nextDayLimitProb({ ...base, capYi: null }) === p0
    && nextDayLimitProb({ ...base, capYi: undefined }) === p0);
  // 档位边界（闭区间语义：100 与 500 是「达到即罚」）
  ok('档位边界：99.9亿不罚 / 100亿罚 / 499亿不加重 / 500亿加重',
    nextDayLimitProb({ ...base, capYi: 99.9 }) === p0
    && nextDayLimitProb({ ...base, capYi: 100 }) === pMid
    && nextDayLimitProb({ ...base, capYi: 499 }) === pMid
    && nextDayLimitProb({ ...base, capYi: 500 }) === pBig);

  const pTop = nextDayLimitProb({ ...base, rangePos: 90 });
  const pMidPos = nextDayLimitProb({ ...base, rangePos: 50 });
  const pBot = nextDayLimitProb({ ...base, rangePos: 10 });
  ok('位置分档：顶部/底部不罚，中位(30~70)被罚', pTop === p0 && pBot === p0 && pMidPos < p0, `顶${pTop}/中${pMidPos}/底${pBot} vs ${p0}`);
  ok('位置边界闭区间：30 与 70 罚、29 与 71 不罚',
    nextDayLimitProb({ ...base, rangePos: 30 }) === pMidPos
    && nextDayLimitProb({ ...base, rangePos: 70 }) === pMidPos
    && nextDayLimitProb({ ...base, rangePos: 29 }) === p0
    && nextDayLimitProb({ ...base, rangePos: 71 }) === p0);
  ok('rangePos 缺失/0/null 一律不判（0=贴在20日最低，不是中位）',
    nextDayLimitProb({ ...base, rangePos: 0 }) === p0
    && nextDayLimitProb({ ...base, rangePos: null }) === p0
    && nextDayLimitProb({ ...base, rangePos: undefined }) === p0);

  // 单一因子不许独大：最大市值惩罚(-1.0z)必须小于模型里最大的既有正向因子
  //   （连板高度封顶 +2.2z：limitUpCount 1→5）—— 用满量程正向因子做基准，不是增量
  const pLbMax = nextDayLimitProb({ ...base, limitUpCount: 5 });
  ok('最大市值惩罚压不过最大既有正向因子（单一因子不许独大）', (p0 - pBig) < (pLbMax - p0), `罚 ${(p0 - pBig).toFixed(1)}pp vs 连板高度抬 ${(pLbMax - p0).toFixed(1)}pp`);

  // 兜底契约：任何输入都返回 0~100 的有限数
  const junk = [{}, { capYi: 'x', rangePos: 'y' }, { capYi: Infinity, rangePos: -Infinity }, { capYi: 1e9, rangePos: 1e9 }, { limitUpCount: 'a', sealRatio: null, turnover: undefined }];
  ok('垃圾/极端输入仍返回 0~100 有限数', junk.every(j => { const v = nextDayLimitProb(j); return Number.isFinite(v) && v >= 0 && v <= 100; }));
}

// ════════════【2】reviewFlags：产出 rangePos，且与 learnall 同窗口口径════════════
console.log('\n【2】reviewFlags 产出 rangePos（窗口含当日，与 learnall.rangePos 同口径）');
{
  const fnSrc = grabFn(AVS, /function reviewFlags\(rows, price\) \{/);
  const reviewFlags = new Function('_tN', fnSrc + '\n; return reviewFlags;')((r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; });
  const mkRows = (lastClose) => {
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push({ open: 10, high: 11, low: 9, close: 10, volume: 1e6 });
    rows[24] = { open: 10, high: 11, low: 9, close: lastClose, volume: 1e6 };
    return rows;
  };
  const fTop = reviewFlags(mkRows(11), 11), fMid = reviewFlags(mkRows(10), 10), fBot = reviewFlags(mkRows(9), 9);
  ok('收在20日最高 → rangePos=100', fTop.rangePos === 100, '实际 ' + fTop.rangePos);
  ok('收在20日中位 → rangePos=50', fMid.rangePos === 50, '实际 ' + fMid.rangePos);
  ok('收在20日最低 → rangePos=0', fBot.rangePos === 0, '实际 ' + fBot.rangePos);
  // 跨模块同口径：learnall.extractFeatures(rows, i).rangePos 是 0~1，×100 应一致
  const laTop = LA.extractFeatures(mkRows(11), 24, {}).rangePos;
  const laMid = LA.extractFeatures(mkRows(10), 24, {}).rangePos;
  ok('与 learnall.extractFeatures 的 rangePos 同数值（窗口都是含当日的近20根）',
    Math.abs(laTop * 100 - fTop.rangePos) < 0.05 && Math.abs(laMid * 100 - fMid.rangePos) < 0.05,
    `learnall ${laTop}/${laMid} vs reviewFlags ${fTop.rangePos}/${fMid.rangePos}`);
  ok('K 线不足 25 根 → 整体返回 null（判不出不编，调用处已有 flags 判空）', reviewFlags(mkRows(10).slice(0, 15), 10) === null);
  ok('原有字段不受影响（aboveMa5/brokeHighHold/volPriceUp/ma5 仍在）',
    typeof fMid.aboveMa5 === 'boolean' && typeof fMid.brokeHighHold === 'boolean' && typeof fMid.volPriceUp === 'boolean' && fMid.ma5 === 10);
}

// ════════════【3】接线：三处调用点都传两个新因子；一进二/二进三不再本地重复罚════════════
console.log('\n【3】server.js 接线（不接上等于没做）');
{
  const callN = (SVS.match(/capYi:\s*\(Number\(z\.floatCap\)\s*\|\|\s*0\)\s*\/\s*1e8/g) || []).length;
  ok('三处 nextDayLimitProb 调用点都传 capYi（亿）', callN >= 3, '实得 ' + callN + ' 处');
  const rpN = (SVS.match(/rangePos:\s*flags\s*\?\s*flags\.rangePos\s*:\s*null/g) || []).length;
  ok('三处调用点都传 rangePos', rpN >= 3, '实得 ' + rpN + ' 处');
  ok('一进二/二进三不再本地按市值加减分（模型统一计入，不许双重计数）',
    !/if \(fc > 0 && fc < 5e9\) \{ prob \+=/.test(SVS) && !/else if \(fc > 3e11\) \{ prob -=/.test(SVS));
  ok('一进二/二进二仍出市值依据文案（有依据不瞎推）',
    (SVS.match(/why\.push\('大盘折价\(≥500亿\)'\)/g) || []).length >= 2
    && (SVS.match(/why\.push\('偏大盘\(≥100亿\)'\)/g) || []).length >= 2
    && (SVS.match(/why\.push\('半山腰\(20日中位\)'\)/g) || []).length >= 2);
  ok('复盘路径也传两个新因子（不只是连板模块）',
    /capYi: \(Number\(z\.floatCap\) \|\| 0\) \/ 1e8,\s*\n\s*rangePos: flags \? flags\.rangePos : null/.test(SVS));
}

// ════════════【4】Y7：ATR 动态止损（只放宽不收紧、判出不判、带宽有界）════════════
console.log('\n【4】Y7 ATR 动态止损');
{
  const atrSrc = cut(SVS, 'const ATR_STOP_K = 2.0;', '// 峰值/最新价节流落盘');
  ok('ATR 常量与两个函数都在源码里', /const ATR_STOP_K = 2\.0;/.test(atrSrc) && /function atrStopPctOf\(/.test(atrSrc) && /function effStopOf\(/.test(atrSrc));
  const mkS = klines => new Function('S', atrSrc + '\n; return { atrStopPctOf, effStopOf, ATR_STOP_K, ATR_STOP_MAX_PCT };')(klines ? { klines } : {});
  // 15 根全天 TR=1 的 K 线（high=10.5/low=9.5/close=10），ATR=1
  const rows15 = []; for (let i = 0; i < 15; i++) rows15.push({ high: 10.5, low: 9.5, close: 10 });
  const S = mkS(new Map([['600000', { rows: rows15 }]]));
  const CFG = { tp: 0.08, sl: -0.03 };

  ok('ATR 1 / 价 25（4%）→ 动态线 -8%', Math.abs(S.atrStopPctOf('600000', 25) - (-8)) < 1e-9, '实际 ' + S.atrStopPctOf('600000', 25));
  ok('ATR 1 / 价 100（1%）→ 动态线 -2%（低于用户底线，生效时贴底线）', Math.abs(S.atrStopPctOf('600000', 100) - (-2)) < 1e-9);
  ok('ATR 1 / 价 10（10%）→ 动态线 -20%（超过最宽，生效时钳到 -10%）', Math.abs(S.atrStopPctOf('600000', 10) - (-20)) < 1e-9);

  ok('生效线：中波动(ATR4%) → -8%（带宽内移动）', Math.abs(S.effStopOf(CFG, '600000', 25) - (-0.08)) < 1e-9, '实际 ' + S.effStopOf(CFG, '600000', 25));
  ok('生效线：低波动 → 贴用户底线 -3%（只放宽、不收紧）', S.effStopOf(CFG, '600000', 100) === -0.03, '实际 ' + S.effStopOf(CFG, '600000', 100));
  ok('生效线：高波动 → 钳在 -10%（最宽有界，不变成套牢）', S.effStopOf(CFG, '600000', 10) === -0.10, '实际 ' + S.effStopOf(CFG, '600000', 10));
  ok('生效线：用户底线更宽(-15%)时用户底线赢（绝不收紧用户设置）', S.effStopOf({ tp: 0.08, sl: -0.15 }, '600000', 10) === -0.15);

  ok('判不出不判：K 线缺失 → 维持用户底线', S.effStopOf(CFG, '999999', 25) === -0.03 && S.atrStopPctOf('999999', 25) === null);
  ok('判不出不判：K 线不足 15 根 → 维持用户底线', S.effStopOf(CFG, '600001', 25) === -0.03);
  ok('判不出不判：S.klines 整个缺失 → 维持用户底线（不抛错）', mkS(null).effStopOf(CFG, '600000', 25) === -0.03);
  ok('判不出不判：价格非正 → 维持用户底线', S.effStopOf(CFG, '600000', 0) === -0.03 && S.effStopOf(CFG, '600000', -5) === -0.03);
  ok('配置坏了不猜：sl 非负 → 原样返回', S.effStopOf({ tp: 0.08, sl: 0.05 }, '600000', 25) === 0.05);

  // linkedStop：第三参缺省 = cfg.sl（向后兼容）；peak 保护分支不受基础线影响
  const lsSrc = grabFn(SVS, /function linkedStop\(cfg, peak, baseStop\) \{/);
  const linkedStop = new Function(lsSrc + '\n; return linkedStop;')();
  ok('linkedStop 第三参缺省 → 回 cfg.sl（旧调用点行为不变）', linkedStop(CFG, 0.01) === -0.03);
  ok('linkedStop 第三参生效 → 基础分支用它', linkedStop(CFG, 0.01, -0.08) === -0.08);
  ok('peak 保护分支不受 ATR 基础线影响（≥75%止盈位仍按峰值推）', Math.abs(linkedStop(CFG, 0.07, -0.08) - 0.038) < 1e-9);
  ok('peak 保本分支同样不受影响（≥50%止盈位 → +0.5%）', linkedStop(CFG, 0.05, -0.08) === 0.005);
  ok('paperCheck 接线：stop 由 linkedStop(cfg, pos.peak, effStopOf(...)) 产出',
    /const stop = linkedStop\(cfg, pos\.peak, effStopOf\(cfg, pos\.code, price\)\);/.test(SVS));
  ok('卖出理由：ATR 放宽生效时明确标注（用户看得懂为什么在这里卖）',
    /·ATR2×动态放宽/.test(SVS) && /stop >= 0 \? '收益联动止损' : '止损'/.test(SVS));
}

// ════════════【5】胜率门显示口径（go 轮 C2 收尾：一屏不许两个数）════════════
console.log('\n【5】推送统计脚注：胜率门显当前生效值');
{
  ok('pushGovStat 的 minProb 走 pushMinProbEff（带 typeof 守卫）',
    /minProb: \(typeof pushMinProbEff === 'function'\) \? pushMinProbEff\(\) : pushMinProb\(\)/.test(SVS));
  ok('原始配置值另存 minProbCfg（面板要能说清「配置 X / 生效 Y」）', /minProbCfg: pushMinProb\(\)/.test(SVS));
  ok('前端脚注：生效值高于配置值时标注「偏冷环境·配置 X%」',
    /偏冷环境·配置 ' \+ g\.minProbCfg/.test(IHS) && /g\.minProb > g\.minProbCfg/.test(IHS));
}

// ════════════【6】研究结论登记（没做的事也要有据）════════════
console.log('\n【6】实证产物与被否决项的结论留痕');
{
  const out = JSON.parse(fs.readFileSync(path.join(ROOT, '_research_gq_out.json'), 'utf8'));
  ok('研究产物存在且含四组实测表（市值/换手/位置/止损）',
    out.capOnZt && out.turnOnZt && out.posOnZt && out.y7 && out.y7.length >= 5);
  // H9 换手率区间：涨停日切片中段（3~12%）四档触板率挤在 2pp 内 → 没有「黄金换手区间」，
  //   不新增因子；高换手端（≥18%）的走低由既有「换手过高/巨量分歧」规则覆盖，不重复造轮子。
  const midRates = ['3-5%', '5-8%', '8-12%'].map(k => out.turnOnZt[k]).filter(e => e && e.n >= 100).map(e => e.ztT / e.n * 100);
  const midSpread = Math.max(...midRates) - Math.min(...midRates);
  ok('H9 结论留痕：涨停日切片中段(3~12%)换手率各档差异 <2pp（无黄金区间，不接因子）', midSpread < 2, '极差 ' + midSpread.toFixed(1) + 'pp');
  // P5 RSI 底背离：背离组触板率不高于普通超卖 → 无 edge，不采纳
  ok('P5 结论留痕：底背离组触板率不高于普通超卖组（无 edge，不采纳）',
    out.rsi.divergence.ztT <= out.rsi.oversold.ztT, `背离 ${out.rsi.divergence.ztT}% vs 超卖 ${out.rsi.oversold.ztT}%`);
  // I7 的否定面也留痕：底部首板并无优势（底部 vs 顶部差异在噪声内），真正弱的是中位
  ok('I7 否定面留痕：底部(<30)与顶部(>70)触板率差异 <6pp（「底部更强」不成立）',
    Math.abs(out.posOnZt['底部<30'].ztT / out.posOnZt['底部<30'].n * 100 - out.posOnZt['顶部>70'].ztT / out.posOnZt['顶部>70'].n * 100) < 6);
  ok('I7 肯定面留痕：中位触板率显著低于顶部（半山腰是最弱档）',
    out.posOnZt['中位30-70'].ztT / out.posOnZt['中位30-70'].n * 100 < out.posOnZt['顶部>70'].ztT / out.posOnZt['顶部>70'].n * 100 * 0.75);
  // Y7 结论留痕：混合规则的胜率提升与均盈亏几乎持平都在表里
  const cur = out.y7.find(r => r.name.indexOf('现行') >= 0), blend = out.y7.find(r => r.name.indexOf('ATR2×钳[-10%') >= 0);
  ok('Y7 结论留痕：混合规则胜率显著高于现行、均盈亏差距 <0.2pp',
    blend.winRate > cur.winRate + 10 && Math.abs(blend.avg - cur.avg) < 0.2, `胜率 ${cur.winRate}→${blend.winRate}，均盈亏 ${cur.avg}→${blend.avg}`);
  ok('研究留痕在案（版本注释链或 CHANGELOG 归档，含被否决项与研究口径限制）',
    /const APP_VER = '\d{8}[a-z]{2}'/.test(SVS) && /市值U型/.test(ARCHIVE) && /RSI超卖底背离/.test(ARCHIVE) && /代理/.test(ARCHIVE));
}

console.log('\n══════════════════════════════');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
