// 守门：「收盘贴住涨停价」这把严尺子（A.sealedAtLimit）+ 板块归因守卫（A.canOverrideSector）
// ────────────────────────────────────────────────────────────────────────────────
// 事故（2026-10-28 mq 轮，用户「每个数字可信」）：
//   ① 巡检「疑似漏票」用 pct ≥ 限幅-0.05 → 603699 纽威股份 收 38.39 / 涨停价 38.40（最高触到后
//      回落 1 分钱 = 触板未封）每天被报成漏票；当日真漏票 0 只 → 假告警把「漏票」二字稀释成噪音。
//   ② 002731 萃华退 收 0.28 = round(0.25×1.10,2)，pct 显示 12%（低价股分币舍入）—— 用 pct 判会
//      得出「超 10% 限幅 = 数据异常」的错结论；用价格判才稳定。
//   ③ 板块归因：萃华退 被东财概念「电池技术」抢成主线「电池·储能」（珠宝股配了 4 个电池 peers），
//      「基金增仓」5 只也被当主线展示 —— 风格/资金类伪板块必须挡在归因之外。
// 钉的语义：
//   ① sealedAtLimit：收盘价 == round(前收×(1+限幅),2) 才算封板；触板未封（差 1 分）一律 false
//   ② 限幅走 A.limitPctOf（主板 10 / 创业科创 20 / 北交所 30），低价股舍入不误判
//   ③ 新股无限制期（hasNoLimit）→ 永远不算封板
//   ④ canOverrideSector：退市整理期股 / 伪板块 / 家数<2 / 热度不更高 / 过宽 → 一条不满足就 false
'use strict';
const A = require('./analysis.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');

group('[1] 触板未封 vs 封板：同一只票两把尺子必须分得开');
{
  // 603699 纽威股份 2026-10-28 实况：前收 34.91、涨停价 38.40、最高 38.40、收盘 38.39
  const pre = 34.91, price = 38.39, pct = 9.968;
  ok(A.sealedAtLimit('603699', '纽威股份', price, pre) === false, '收 38.39 / 涨停价 38.40 → 不算封板（触板未封）');
  ok(A.isLimitUp('603699', '纽威股份', pct) === true, '反证：旧宽尺子 isLimitUp(9.97%) 判 true —— 所以巡检用它会天天误报');
  const oldRuler = pct >= A.limitPctOf('603699', '纽威股份') - 0.05;   // 巡检改动前的判据原样复刻
  ok(oldRuler === true, '反证：改动前的 `pct ≥ 限幅-0.05` 判据确实把这只触板未封判成漏票');
  ok(A.sealedAtLimit('603699', '纽威股份', 38.40, pre) === true, '同一只票真封在 38.40 时才判封板');
}

group('[2] 低价股分币舍入：pct 12% 但价格正好是涨停价');
{
  // 002731 萃华退 2026-10-28 实况：前收 0.25、涨停价 round(0.275)=0.28、收盘 0.28、pct 12.00%
  ok(A.sealedAtLimit('002731', '萃华退', 0.28, 0.25) === true, '收 0.28 = round(0.25×1.10,2) → 封板（pct 显示 12% 也照样是板）');
  ok(A.sealedAtLimit('002731', '萃华退', 0.27, 0.25) === false, '收 0.27（板下 1 分）→ 不算封板');
  ok(Math.abs(0.28 / 0.25 - 1) > 0.1, '反证：这只票的涨幅确实超过 10%（若用「超限幅=异常」的判据会误杀）');
}

group('[3] 分板块限幅：20cm / 30cm / 缺数据');
{
  ok(A.sealedAtLimit('300750', '宁德时代', 12.00, 10) === true, '创业板 前收 10 → 12.00 封板');
  ok(A.sealedAtLimit('300750', '宁德时代', 11.99, 10) === false, '创业板 11.99 差 1 分 → 不算封板');
  ok(A.sealedAtLimit('830799', '艾融软件', 13.00, 10) === true, '北交所 前收 10 → 13.00 封板');
  ok(A.sealedAtLimit('688981', '中芯国际', 24.00, 20) === true, '科创板 前收 20 → 24.00 封板');
  ok(A.sealedAtLimit('600000', '浦发银行', 11.00, 10) === true, '主板 前收 10 → 11.00 封板');
  ok(A.sealedAtLimit('600000', '浦发银行', 0, 10) === false && A.sealedAtLimit('600000', '浦发银行', 11, 0) === false,
    '价格/前收缺失 → false（判不出不猜）');
}

group('[4] 新股无涨跌幅限制期：涨多少都不是封板');
{
  A.setNoLimitFn(c => c === '301999');
  ok(A.sealedAtLimit('301999', 'N新股', 30, 10) === false, '新股无限制期 → 涨 200% 也不算封板');
  ok(A.sealedAtLimit('301998', '老股', 12, 10) === true, '同板块非新股 → 20cm 正常判封板');
  A.setNoLimitFn(null);
  ok(A.sealedAtLimit('301999', 'N新股', 12, 10) === true, '钩子清空后退回按板块判（不再特殊对待）');
}

group('[5] 容差参数：默认 1 分钱，可显式放宽（审计用 0.011 容纳两源小数位）');
{
  ok(A.sealedAtLimit('600000', 'X', 11.01, 10) === false, '默认 tol=0.005：差 1 分不放过');
  ok(A.sealedAtLimit('600000', 'X', 11.01, 10, 0.011) === true, 'tol=0.011：1 分钱以内视为同一价');
}

group('[6] 伪板块识别：只挡风格/资金标签，不误伤真实产业概念');
{
  ok(A.isStyleSector('基金增仓') === true, '「基金增仓」是伪板块（10-28 实测被当主线展示 5 只）');
  ok(A.isStyleSector('低价股') === true && A.isStyleSector('昨日高换手') === true, '低价股 / 昨日高换手 也是伪板块');
  ok(A.isStyleSector('电池技术') === false, '「电池技术」是真实概念 → 不挡（它的问题在退市股身上，不在名字）');
  ok(A.isStyleSector('机器人概念') === false && A.isStyleSector('人形机器人') === false, '真实题材不挡');
}

group('[7] 板块纠偏守卫：四个条件缺一不可');
{
  const base = { name: '某某股份', board: '电池技术', ztCount: 5, heatBest: 50, heatCur: 10, tooBroad: false };
  ok(A.canOverrideSector(base) === true, '正常股 + 真实概念 + ≥2 家 + 热度更高 → 允许纠偏');
  ok(A.canOverrideSector(Object.assign({}, base, { name: '萃华退' })) === false,
    '退市整理期股（名带「退」）→ 一律不纠偏（10-28 假归因根因）');
  ok(A.canOverrideSector(Object.assign({}, base, { board: '基金增仓' })) === false, '伪板块 → 不纠偏');
  ok(A.canOverrideSector(Object.assign({}, base, { ztCount: 1 })) === false, '该概念只有它自己涨停 → 不纠偏');
  ok(A.canOverrideSector(Object.assign({}, base, { heatBest: 10, heatCur: 10 })) === false, '热度不高于原行业 → 不纠偏');
  ok(A.canOverrideSector(Object.assign({}, base, { tooBroad: true })) === false, '吃掉当日 >40% 涨停的过宽概念 → 不纠偏');
  ok(A.canOverrideSector(Object.assign({}, base, { board: '' })) === false, '没有候选板块 → 不纠偏');
  ok(A.canOverrideSector(null) === false && A.canOverrideSector() === false, '入参缺失 → false（不抛异常）');
}

group('[8] 002731 实况回归：两条根因各自单独存在时都必须挡住');
{
  // 当日真实数据：萃华退 官方行业「饰品」，东财概念里挂着「电池技术」，boardStat 电池·储能 5 只
  const live = { name: '萃华退', board: '电池技术', ztCount: 5, heatBest: 50.9, heatCur: 10.96, tooBroad: false };
  ok(A.canOverrideSector(live) === false, '实况入参 → 不允许纠偏（否则复盘写「电池·储能爆发5只涨停」）');
  const noDelistingGuard = live.name === '萃华退' ? false : true;   // 假设没有退市判据
  ok(noDelistingGuard === false && A.isStyleSector('电池技术') === false,
    '反证：只靠伪板块黑名单挡不住它（电池技术不在黑名单），退市判据是必需的那一道');
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
