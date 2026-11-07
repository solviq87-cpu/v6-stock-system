// 守门测试：gs 轮「采纳」待处理项实证落地（2026-10-13 午后）
// 167 项「采纳」待处理项按 gr 同款口径（涨停日切片 n=2866、剔一字板、次日触板结局、
// 两半窗方向一致 + 三层市场环境分层 dow/side/up 交叉检验）批量复测，最终新接入 3 个因子：
//   ① Q15 真突破 ≡ 今日跳空高开(gapUp>1%) → +0.2z（n=1136，+4.2pp，两半窗同向、三环境全正，与现有因子不共线）
//   ② J11 月初效应（信号日≤5号）→ +0.2z（n=351，+5.2pp，两半窗同向、三环境全正，日期确定型）
//   ③ J12 周五效应（信号日周五）→ +0.25z（n=509，+5.3pp，同向全正）；J12 周一效应 → -0.15z（n=684，-3.3pp，同向全负）
// 被否决/挂起留痕（结论在版本注释 + _research_gs_out.json）：
//   共线不接：I4 板位(=limitUpCount 连板高度)、K4(=市场环境轴,与 K1 共线)、P9 缩量低位(与 I5 volRatio 共线)、H13 冰点(与 K1/市场态共线)
//   假设不成立/无效应：H4 弱转强(效应为负)、L9/N6/N9/L2(无差异)、M1/M3/N5(弱且半窗背离)
//   环境分层否决：P8 换手异常(普跌 -8.4pp 显著变差)
//   半窗 n<30 挂起(时间聚集、无法确认一致性)：N8 地量(<20% 仅 n=116，且与 I5/P9 共线)
//   样本不足：J10 近端次新(n=0，需补次新全量 kline)
// 守门：抽 nextDayLimitProb / reviewFlags 原样真跑（同 gq/gr 端点切割法），验证三因子接线 + 缺数据不判。
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
  ok('签名含 gapUp / sigDate 两新形参', /function nextDayLimitProb\(\{[^}]*gapUp[^}]*sigDate/.test(fnSrc));
  ok('gs 轮版本注释记录三因子', /gs 轮（2026-10-13 午后）167 项/.test(AVS) && /跳空高开收板（Q15 真突破/.test(AVS) && /月初效应（J11/.test(AVS) && /周五效应（J12/.test(AVS));
  ok('实证注释含「两半窗一致性 + 三层市场环境分层」方法', /两半窗一致性 \+ 三层市场环境分层/.test(AVS));
  global.__fnSrc = fnSrc;
}

const nextDayLimitProb = new Function(global.__fnSrc + '\n; return nextDayLimitProb;')();
// reviewFlags 引用顶层辅助 _tN（rangePos IIFE 内），注入时一并提供
const RF = 'function reviewFlags(';
const rfSrc = cut(AVS, RF, 'function buildZTReason(');
const _tN = 'const _tN = (r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };';
const reviewFlags = new Function(_tN + '\n' + rfSrc + '\n; return reviewFlags;')();
ok('reviewFlags 可被原样切出真跑', typeof reviewFlags === 'function');

// 基准（不含 gs 三因子）：首板、普通封单、非极热、无反包、常轨量、无跳空、无信号日
const base = { limitUpCount: 1, sealRatio: 0.3, sealStrength: 0.4, breakCount: 1, sectorZT: 3, turnover: 8, aboveMa5: true, capYi: 80, rangePos: 80, volRatio: 1.2, brkEngulf: false, mktUpRatio: 50, gapUp: false, sigDate: null };
const pBase = nextDayLimitProb(base);
ok('基准概率可算(0~100)', pBase > 0 && pBase < 100, 'pBase=' + pBase);

// 找日期：月初非周五/周一（只触发月初 +0.2）；周五(dom>5, 只 +0.25)；周一(dom>5, 只 -0.15)
function findDate(pred) { for (let m = 0; m < 12; m++) for (let d = 1; d <= 28; d++) { const s = '2026-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); const wd = new Date(s + 'T12:00:00').getDay(); if (pred(d, wd)) return s; } return null; }
const earlyTue = findDate((d, wd) => d <= 5 && (wd === 2 || wd === 3 || wd === 4));
const fri = findDate((d, wd) => d > 5 && wd === 5);
const mon = findDate((d, wd) => d > 5 && wd === 1);
ok('测试日期可构造（月初/周五/周一）', !!earlyTue && !!fri && !!mon, earlyTue + '/' + fri + '/' + mon);

console.log('\n【1】Q15 跳空高开收板（gapUp → +0.2z）');
{
  const pGap = nextDayLimitProb({ ...base, gapUp: true });
  ok('跳空高开 > 基准', pGap > pBase, `${pGap}/${pBase}`);
  const d = pGap - pBase;
  ok('效应温和（不独大，+0.2z 在 p≈28% 处 ≈ +4~6pp）', d > 1 && d < 12, 'Δ=' + d);
  const pNull = nextDayLimitProb({ ...base, gapUp: null });
  const pFalse = nextDayLimitProb({ ...base, gapUp: false });
  ok('缺数据(null) 不判（=基准）', pNull === pBase, `${pNull}/${pBase}`);
  ok('false 不判（=基准）', pFalse === pBase, `${pFalse}/${pBase}`);
}

console.log('\n【2】J11 月初效应（信号日≤5号 → +0.2z，非周五/周一隔离）');
{
  const pEarly = nextDayLimitProb({ ...base, sigDate: earlyTue });
  ok('月初 > 基准', pEarly > pBase, `${pEarly}/${pBase}`);
  const d = pEarly - pBase;
  ok('效应温和（+0.2z 在 p≈28% 处 ≈ +4~6pp，仅月初项）', d > 1 && d < 12, 'Δ=' + d);
  const pNull = nextDayLimitProb({ ...base, sigDate: null });
  ok('缺日期(null) 不判（=基准）', pNull === pBase, `${pNull}/${pBase}`);
}

console.log('\n【3】J12 周五效应（信号日周五 → +0.25z） / 周一效应（→ -0.15z）');
{
  const pFri = nextDayLimitProb({ ...base, sigDate: fri });
  ok('周五 > 基准', pFri > pBase, `${pFri}/${pBase}`);
  const dFri = pFri - pBase;
  ok('周五效应温和（+0.25z 在 p≈28% 处 ≈ +5~7pp）', dFri > 1 && dFri < 13, 'Δ=' + dFri);
  const pMon = nextDayLimitProb({ ...base, sigDate: mon });
  ok('周一 < 基准', pMon < pBase, `${pMon}/${pBase}`);
  const dMon = pBase - pMon;
  ok('周一效应温和（-0.15z ≈ +3~4pp 反向）', dMon > 1 && dMon < 12, 'Δ=' + dMon);
  // 月初+周五可叠加：取一个月初且周五的日期
  const earlyFri = findDate((d, wd) => d <= 5 && wd === 5);
  if (earlyFri) {
    const pEF = nextDayLimitProb({ ...base, sigDate: earlyFri });
    ok('月初+周五叠加（>单纯周五）', pEF > pFri, `${pEF}/${pFri}`);
  } else { ok('月初+周五叠加（无此组合，跳过）', true); }
}

console.log('\n【4】reviewFlags 产出 gapUp / sigDate');
{
  function mkRows(gap, date) {
    const rows = [];
    for (let i = 0; i < 26; i++) { const c = 10 + i * 0.1; rows.push({ date: '2026-09-' + String(10 + i).padStart(2, '0'), open: c * 0.99, high: c * 1.02, low: c * 0.98, close: c, volume: 1000 }); }
    rows[25].date = date;
    rows[25].open = gap ? rows[24].close * 1.02 : rows[24].close * 0.99;
    return rows;
  }
  const fGap = reviewFlags(mkRows(true, '2026-10-09'), 12.5);
  ok('跳空日 gapUp=true', fGap && fGap.gapUp === true, 'gapUp=' + (fGap && fGap.gapUp));
  ok('sigDate 透传', fGap && fGap.sigDate === '2026-10-09', 'sigDate=' + (fGap && fGap.sigDate));
  const fFlat = reviewFlags(mkRows(false, '2026-10-12'), 12.5);
  ok('非跳空日 gapUp=false', fFlat && fFlat.gapUp === false, 'gapUp=' + (fFlat && fFlat.gapUp));
  const fNull = reviewFlags(mkRows(true, ''), 12.5);
  ok('日期缺失时 sigDate=null（不判）', fNull && fNull.sigDate === null, 'sigDate=' + (fNull && fNull.sigDate));
}

console.log('\n【5】server.js 三处真实调用点接线');
{
  const wG = (SVS.match(/gapUp: flags \? flags\.gapUp : null/g) || []).length;
  const wS = (SVS.match(/sigDate: flags \? flags\.sigDate : null/g) || []).length;
  ok('gapUp 三处真实调用点全接', wG === 3, 'wG=' + wG);
  ok('sigDate 三处真实调用点全接', wS === 3, 'wS=' + wS);
  // 预览调用点(432)不应带这两个字段（避免影响预览概率口径），确认只在 3 处真实点
  ok('仅 3 处真实调用点（不含预览）', wG === 3 && wS === 3);
}

console.log(`\n=== gs 轮守门：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
