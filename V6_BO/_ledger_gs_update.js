// gs 轮台账刷新（2026-10-13 午后）：把 167 项 pending「采纳」全部往前推。
//  · 18 个本地日线可算因子族：按 _research_gs.js 实证结论给 done/reject/partial-scan(挂起) 处置。
//  · 其余 149 项：逐条标注处置——需外部数据源(标具体源) 或 本地日线可算但本轮未纳入实证脚本(需补测)，不静默丢、不假实现。
const fs = require('fs');
const F = '决策台账_20261013.json';
const j = JSON.parse(fs.readFileSync(F, 'utf8'));
const arr = j.items || [];

// ── 18 个 gs 实测因子族处置 ──
const V = {
  Q15: { status: 'done', note: 'gs 轮实证：跳空高开收板(真突破) n=1136 次日触板 30.9% vs 无缺口 23.9%（+4.2pp，两半窗同向、三环境 dow/side/up 全正，与缩量/反包/市值/连板不共线）→ 已接入 nextDayLimitProb：gapUp>1% +0.2z（系数取实测 log-odds 差保守端）。' },
  J11: { status: 'done', note: 'gs 轮实证：月初1-5号 n=351 次日触板 31.9% vs 基数 26.7%（+5.2pp，两半窗同向、三环境全正）→ 已接入 nextDayLimitProb：信号日≤5号 月初效应 +0.2z（日期确定型）。' },
  J12: { status: 'done', note: 'gs 轮实证：周五 n=509 32.0%（+5.3pp，同向全正）/ 周一 n=684 23.4%（-3.3pp，同向全负）→ 已接入 nextDayLimitProb：周五 +0.25z / 周一 -0.15z（日期确定型）。' },
  H4:  { status: 'reject', note: 'gs 轮实证：弱转强(前日阴+今涨停) 次日触板 24.1% < 非弱转强 29.0%（Δ-2.6pp）；假设"弱转强更强"不成立，效应为负 → 不接入。' },
  I4:  { status: 'reject', note: 'gs 轮实证：板位分层(首板23.2%/2板34.5%/≥3板38.9%) 与现有 limitUpCount 连板高度项完全共线 → 不重复计。' },
  K4:  { status: 'reject', note: 'gs 轮实证：新高新低差 = 市场环境轴(普跌/震荡/普涨)，与现有 mktUpRatio(K1) 共线 → 不重复计。' },
  L9:  { status: 'reject', note: 'gs 轮实证：量价背离 27.0% vs 非背离 26.6%（Δ+0.3pp，噪声内，半窗背离）→ 无效应不接入。' },
  M1:  { status: 'reject', note: 'gs 轮实证：低波分档效应弱(<2%空样本 / 2-3.5% +2.2pp 半窗背离 / >5% -2.2pp) → 不稳健不接入。' },
  M3:  { status: 'reject', note: 'gs 轮实证：5日反转各档挤在噪声内(±2.2pp) → 无效应不接入。' },
  N5:  { status: 'reject', note: 'gs 轮实证：均线多头 27.9% vs 非多头 25.2%（+1.2pp，半窗背离）→ 弱且不稳健不接入。' },
  N6:  { status: 'reject', note: 'gs 轮实证：均线粘合各档 ±1.5pp 噪声内 → 无效应不接入。' },
  N9:  { status: 'reject', note: 'gs 轮实证：量价四象限无稳定差异 → 无效应不接入。' },
  P8:  { status: 'reject', note: 'gs 轮实证：换手异常>1.2 在普跌环境 -8.4pp（显著变差），违反「任一层显著变差即否决」→ 不接入。' },
  P9:  { status: 'reject', note: 'gs 轮实证：缩量低位(量比<0.8 且量能<50分位) +14.5pp，但与 I5 volRatio<0.8 共线(缩量低位⊂缩量) → 重复计不接入。' },
  L2:  { status: 'reject', note: 'gs 轮实证：封板率近似各档 ±1.1pp 噪声内 → 无效应不接入。' },
  N8:  { status: 'partial-scan', note: 'gs 轮实证：地量<20% 次日触板 48.3%(+21.6pp) 信号强，但半窗 n<30(时间聚集、无法确认一致性) 且与 I5/P9 缩量共线 → 挂起待更大样本复测确认，本轮不接入。' },
  H13: { status: 'partial-scan', note: 'gs 轮实证：涨停家数<30冰点 +5.3pp，但与 K1/mktUpRatio 市场态共线且半窗 n<30 → 挂起不接入。' },
  J10: { status: 'partial-scan', note: 'gs 轮实证：近端次新(上市<1年) 涨停日切片 n=0（本地 kline 缺次新全量样本）→ 标注待补次新全量 kline 后复测，本轮不接入。' },
};
const measured = new Set(Object.keys(V));

// ── 149 项外部源/补测 关键词分类 ──
const SRC = [
  [/北向|外资/, '北向资金'], [/两融|融资/, '两融'], [/期权/, '期权'], [/期指|股指期货/, '期指'],
  [/期货/, '期货'], [/财报|业绩|ROE|营收|净利|毛利率/, '财报'], [/宏观|GDP|CPI|利率|PMI|社融/, '宏观'],
  [/舆情|新闻|消息|公告|研报/, '舆情/新闻'], [/龙虎榜/, '龙虎榜'], [/筹码|股东|户数|获利比例|成本分布|单峰密集/, '筹码分布'],
  [/外围|美股|外盘|恒生/, '外围市场'], [/政策/, '政策面'], [/竞价/, '竞价数据'],
  [/封单|撤单|大单|主力|净流入|扫单|万手/, '盘口/逐笔(封单额·主力净流入)'], [/封板时间|开板/, '盘口/逐笔(封板时间)'],
];
const KLINE = ['主升浪','均线','量价','MACD','KDJ','动量','趋势','涨停形态','连板','梯队','板块','题材','情绪'];
function classify(item) {
  const blob = (item.name || '') + (item.note || '') + (item.decision || '') + (item.type || '');
  for (const [re, src] of SRC) if (re.test(blob)) return '需<' + src + '>：本地无数据源，gs 轮不假实现；待接入对应源后复测。';
  const hasKline = KLINE.some(k => blob.includes(k));
  if (hasKline) return '本地日线可算(量/价/均线/形态/连板)，gs 轮未纳入实证脚本，需补进 _research_gs.js 复测。';
  return '需外部数据源(类别待定)，gs 轮不假实现；待明确数据源后复测。';
}

let nDone = 0, nReject = 0, nHold = 0, nOther = 0;
for (const x of arr) {
  if (x.type !== '采纳') continue;
  if (['done', 'reject', 'noop'].includes(x.status)) continue; // 已定论的(gr 轮等)不动
  if (measured.has(x.id)) {
    const v = V[x.id];
    x.status = v.status;
    x.statusNote = v.note;
    if (v.status === 'done') nDone++;
    else if (v.status === 'reject') nReject++;
    else nHold++;
  } else {
    x.statusNote = classify(x);
    nOther++;
  }
}

// 重算 statusSummary
const sum = {};
for (const x of arr) sum[x.status] = (sum[x.status] || 0) + 1;
j.statusSummary = sum;
j.updatedAt = '2026-10-13 午后(gs 轮)';
j.statusNote = (j.statusNote || '') +
  '\n[gs 轮 2026-10-13 午后] 167 项 pending「采纳」全部往前推：18 个本地日线可算因子族经 _research_gs.js 实证(两半窗一致性+三层市场环境分层) → 新接入 3 个稳健因子(Q15 跳空高开/J11 月初/J12 周五·周一，已进 nextDayLimitProb+reviewFlags+三处调用点，版本 20261013gs)；12 个否决(共线 H4/I4/K4/P9/H13/L9/N6/N9/L2/M1/M3/N5 / 普跌变差 P8 / 假设反 H4)；3 个挂起(N8 半窗n<30+共线/J10 样本不足/H13 共线)。其余 149 项逐条标注「需<源>」或「需补测」，不静默丢、不假实现。⛔ 普跌日(upRatio≈34%)按铁律压发：代码/守门/台账全做完，发布待非普跌日或用户「发」。';

fs.writeFileSync(F, JSON.stringify(j, null, 1));
console.log('✅ 台账刷新完成');
console.log('  gs 新接入 done +' + nDone + ' / reject +' + nReject + ' / 挂起(部分扫描) +' + nHold + ' / 其余标注 ' + nOther);
console.log('  statusSummary =', JSON.stringify(sum));
