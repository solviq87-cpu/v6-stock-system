// ①-4 竞价复盘 · 守门测试
// 抽 server.js 内纯函数 computeNdOutcome（nd 口径：次日最高价触板/达+3%/收涨）做单测，
// 并做结构断言：/api/auction-log + /api/auction-review 路由、logAuctionSignals 已接入 captureAuction。
// 注：computeNdOutcome 内调 A.limitPctOf 取涨跌幅限制；独立 eval 时无 A → try 兜底默认 10%，
//     故本测试只验主板 10% 路径（nd_limit 核心口径），创业板/科创的 20% 由线上真实 A 生效
//     （ST 已于 2026-04 起与主板同限幅 ±10%，兜底默认值恰好覆盖）。
// dy 轮 #290（2026-10-17，用户决策表议题1·推荐A）：追加前端「双口径聚合头」守门——
//   198 条 auczt 实证竞价信号是日内型（次日最高≥3% 39.9% vs 收盘≥3% 17.7%/收跌 64.1%/
//   中位 -1.42%），旧 UI 把日内/持股混成一个徽章（nd_limit 还标「次日涨停」名不副实），
//   用户观感被持股口径证伪。聚合头两口径分开摆 + prob 档小表 + 定位文案 + 徽章拆高/收双列。
//   守法：① 结构断言；② 四个纯函数从 index.html 抠出来 eval 真跑（合成数据钉语义）。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  const ob = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = ob; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('括号不配对 ' + name);
  return src.slice(start, end + 1);
}
const computeNdOutcome = eval('(' + extractFn(SRC, 'computeNdOutcome') + ')');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }

// 构造日K：rows[i]=信号日，rows[i+1]=次日
const mk = (signalClose, nx) => ([
  { date: '20261013', open: signalClose, high: signalClose, low: signalClose, close: signalClose, volume: 1 },
  Object.assign({ date: '20261014' }, nx),
]);

// ── 主板 10%：次日触板 ──
const r1 = computeNdOutcome(mk(10, { open: 10.2, high: 11.1, low: 9.8, close: 10.6 }), '20261013', '600000', '测试');
ok(r1.pending === false, 'A: 有次日K → 非pending');
ok(Math.abs(r1.openGap - 0.02) < 1e-6, 'A: 开盘跳空 +2%');
ok(Math.abs(r1.highPct - 0.11) < 1e-6, 'A: 次日最高 +11%');
ok(r1.nd_limit === true, 'A: 最高触板(≥10%) → nd_limit=true');
ok(r1.nd_p3 === true, 'A: 最高≥+3% → nd_p3=true');
ok(r1.closeUp === true, 'A: 收盘>+0% → closeUp=true');
ok(r1.limitPct === 10, 'A: 默认涨跌幅限制 10%（独立eval无A兜底）');

// ── 主板 10%：次日未触板但≥+3% ──
const r2 = computeNdOutcome(mk(10, { open: 10.1, high: 10.4, low: 9.9, close: 10.2 }), '20261013', '600000', '测试');
ok(r2.nd_limit === false, 'B: 最高+4%<10% → nd_limit=false');
ok(r2.nd_p3 === true, 'B: 最高+4%≥+3% → nd_p3=true');
ok(r2.closeUp === true, 'B: 收涨 → closeUp=true');

// ── 主板 10%：次日收跌（未达+3%）──
const r3 = computeNdOutcome(mk(10, { open: 10.0, high: 10.2, low: 9.7, close: 9.7 }), '20261013', '600000', '测试');
ok(r3.nd_limit === false, 'C: 最高+2%<10% → nd_limit=false');
ok(r3.nd_p3 === false, 'C: 最高+2%<+3% → nd_p3=false');
ok(r3.closeUp === false, 'C: 收跌 → closeUp=false');

// ── pending 各类 ──
ok(computeNdOutcome([{ date: '20261013', open:10, high:10, low:10, close:10 }], '20261013', 'X', 'Y').pending === true, 'D: 无次日K → pending');
ok(computeNdOutcome([{ date: '20261013', close: 10 }], '20261099', 'X', 'Y').pending === true, 'E: 信号日不在K线 → pending');
ok(computeNdOutcome([], '20261013', 'X', 'Y').pending === true, 'F: 空K线 → pending');
ok(computeNdOutcome([{ date: '20261013', open: 0, high: 0, low: 0, close: 0 }, { date: '20261014', close: 5 }], '20261013', 'X', 'Y').pending === true, 'G: 信号日收盘缺失 → pending');

// ── 结构断言：复盘功能已接入生产代码 ──
ok(/p === '\/api\/auction-log' && req\.method === 'GET'/.test(SRC), '路由 /api/auction-log(GET) 已注册');
ok(/p === '\/api\/auction-review' && req\.method === 'GET'/.test(SRC), '路由 /api/auction-review(GET) 已注册');
ok(/logAuctionSignals\(_tickMap\)/.test(SRC), 'captureAuction 已调用 logAuctionSignals(_tickMap)');
ok(/_tickMap\.set\(x\.code, tk\)/.test(SRC), 'captureAuction 把竞价分时收入 _tickMap 供留档');
ok(/function computeNdOutcome\(/.test(SRC), 'computeNdOutcome 已定义');
ok(/function loadAuctionLog\(\)/.test(SRC), 'loadAuctionLog 已定义');
ok(/function saveAuctionLog\(\)/.test(SRC), 'saveAuctionLog 已定义');
ok(/auction_log\.json/.test(SRC), '竞价信号留档路径 auction_log.json');

// ═══ dy 轮 #290：前端双口径聚合头（index.html 纯前端聚合，/api/auction-log 契约零改动）═══
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
// ① 结构断言
ok(/function arAggregate\(items\)/.test(HTML), '前端 arAggregate(items) 已定义');
ok(/function arOutcomeBadges\(o\)/.test(HTML), '前端 arOutcomeBadges(o) 已定义（列表/弹窗共用一份）');
ok(/function arMedian\(/.test(HTML), '前端 arMedian 已定义');
ok(/function arPctFmt\(/.test(HTML), '前端 arPctFmt 已定义');
ok(HTML.includes('日内型信号 · 冲高兑现，非次日持股依据'), '聚合头带定位文案（日内型信号）');
ok(/el\.innerHTML = '[^']*竞价复盘[^']*' \+ arAggregate\(r\.items\)/.test(HTML), 'loadAuctionReview 标题后即渲染聚合头');
ok(/arOutcomeBadges\(x\.outcome\)/.test(HTML), '列表条目徽章走高/收双列（arOutcomeBadges）');
ok(/const badge = o\.pending \?[^;]*arOutcomeBadges\(o\);/.test(HTML), '详情弹窗复用同一 helper（⛔ 同一概念两份实现）');
ok((HTML.match(/高·触板/g) || []).length === 1, '「触板」徽章只有 arOutcomeBadges 一处实现（防第二份口径）');
ok(HTML.includes('次日最高触板:'), '次日归因块改称「次日最高触板」（⛔ 不再写「nd 涨停」冒充收盘封板）');
ok(!HTML.includes('nd 涨停'), '旧「nd 涨停(最高触板)」误导措辞已移除');
ok(!HTML.includes('次日涨停 ✓'), '旧「次日涨停 ✓」徽章已移除（nd_limit 是最高触板、不是收盘涨停，名不副实）');
ok(!HTML.includes('次日收涨'), '旧「次日收涨」单列徽章已移除（已拆高/收双列）');
ok(/rs = list\.filter\(x => !x\.outcome\.pending\)/.test(HTML), '聚合统计剔除 pending（⛔ 判不出不当通过、不按 0 命中算）');
ok(/样本 &lt;10，比率噪声大/.test(HTML), '样本 <10 显式标注噪声大');
ok(/窗口 ' \+ win \+ ' 共 ' \+ list\.length/.test(HTML), '聚合头写明窗口起止与留档条数（不偷换口径）');

// ② 纯函数真跑：从 index.html 抠出四个函数装进工厂（⛔ 沙箱外符号一概不引，一引就 ReferenceError）
function extractFromHtml(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html 未找到函数 ' + name);
  const ob = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = ob; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('括号不配对 ' + name);
  return src.slice(start, end + 1);
}
const ARF = eval('(function(){' + ['arMedian', 'arPctFmt', 'arOutcomeBadges', 'arAggregate'].map(n => extractFromHtml(HTML, n)).join('\n') + '\nreturn { arMedian, arPctFmt, arOutcomeBadges, arAggregate };})')();
const { arMedian, arPctFmt, arOutcomeBadges, arAggregate } = ARF;

// arMedian / arPctFmt 单测
ok(arMedian([1, 2, 3]) === 2, 'arMedian 奇数取中');
ok(arMedian([1, 2, 3, 4]) === 2.5, 'arMedian 偶数取中间两值均值');
ok(arMedian([]) === null, 'arMedian 空数组 → null（⛔ 不返回 0 冒充）');
ok(arMedian([null, 'x', 3]) === 3, 'arMedian 过滤非法值');
ok(arPctFmt(null) === '—' && arPctFmt(undefined) === '—', 'arPctFmt 缺失 → —（⛔ 不显示 0.00% 冒充有数据）');
ok(arPctFmt(0.05) === '+5.00%', 'arPctFmt 正数带 +');
ok(arPctFmt(-0.0142) === '-1.42%', 'arPctFmt 负数两位小数');
ok(arPctFmt(0) === '0.00%', 'arPctFmt 零不吞符号位');

// 徽章双列单测（⛔ 判不出不猜）
ok(arOutcomeBadges(null).includes('次日待生成'), '徽章：outcome 缺失不崩 → 次日待生成');
ok(arOutcomeBadges({ pending: true }).includes('次日待生成'), '徽章：pending → 次日待生成');
ok(arOutcomeBadges({ pending: false, nd_limit: true, closePct: 0.11 }).includes('高·触板'), '徽章：最高触板 → 高·触板');
ok(arOutcomeBadges({ pending: false, nd_p3: true, closePct: 0.01 }).includes('高·+3%'), '徽章：最高+3% → 高·+3%');
ok(arOutcomeBadges({ pending: false, closePct: -0.02 }).includes('高·&lt;3%'), '徽章：最高<3% → 高·<3%');
ok(arOutcomeBadges({ pending: false, nd_p3: true, closePct: 0.04 }).includes('收·+3%'), '徽章：收盘≥+3% → 收·+3%');
ok(arOutcomeBadges({ pending: false, nd_p3: true, closePct: 0.008 }).includes('收·涨'), '徽章：收盘小涨 → 收·涨');
ok(arOutcomeBadges({ pending: false, nd_p3: true, closePct: -0.02 }).includes('收·跌'), '徽章：收盘跌 → 收·跌');
ok(arOutcomeBadges({ pending: false, nd_p3: true }).includes('收·?'), '徽章：closePct 缺失 → 收·?（⛔ 不猜方向）');

// 聚合头真跑：合成 6 条（日内强/日内强收跌/双口径弱/pending 但当日封板已知/prob 未记录/当日封板判不出）
// ⛔ dz+ 轮（决策表 D3）：outcome 必须带 sameDayLimit —— prob 表改成「prob 档 vs 当日封板率」，
//    没有这个字段整张表就是空的（这也是本轮最容易「看起来改好了其实没数据」的地方）。
const mkIt = (date, prob, o) => ({ date, code: '600000', name: '测试', prob, outcome: o });
const IT = [
  mkIt('20261013', 42, { pending: false, closePct: 0.11, highPct: 0.11, nd_limit: true, nd_p3: true, closeUp: true, sameDayLimit: true }),
  mkIt('20261013', 35, { pending: false, closePct: -0.0142, highPct: 0.045, nd_limit: false, nd_p3: true, closeUp: false, sameDayLimit: false }),
  mkIt('20261014', 30, { pending: false, closePct: 0.008, highPct: 0.012, nd_limit: false, nd_p3: false, closeUp: true, sameDayLimit: false }),
  // pending 但当日封板已知 —— 这正是 D3 的意义：当日口径不该被「次日还没出」拖住
  mkIt('20261015', 26, { pending: true, reason: '次日K线未生成', sameDayLimit: true }),
  mkIt('20261015', null, { pending: false, closePct: -0.05, highPct: 0.02, nd_limit: false, nd_p3: false, closeUp: false, sameDayLimit: false }),
  // 判不出当日封板（缺前收/缺信号日K线）→ null，单独计数、不进分母
  mkIt('20261015', 55, { pending: true, reason: 'x', sameDayLimit: null }),
];
const agg = arAggregate(IT);
ok(agg.includes('共 6 条留档，其中 4 条已出次日结果'), '样本口径：6 条留档 / 4 条已出结果（pending 剔除）');
ok(agg.includes('窗口 10-13 ~ 10-15'), '窗口起止按实际数据写明');
ok(agg.includes('最高≥+3% <b style="color:#c92a2a">50.0%</b> <span class="muted">(2/4)</span>'), '日内最高≥3% = 2/4 = 50.0%');
ok(agg.includes('最高触板 <b>25.0%</b> <span class="muted">(1/4)</span>'), '日内触板 = 1/4 = 25.0%');
ok(agg.includes('收盘≥+3% <b>25.0%</b> <span class="muted">(1/4)</span>'), '持股收盘≥3% = 1/4 = 25.0%（⛔ 不把高点算进持股口径）');
ok(agg.includes('收跌 <b style="color:#0ca678">50.0%</b> <span class="muted">(2/4)</span>'), '持股收跌 = 2/4 = 50.0%');
ok(agg.includes('收盘中位收益 <b class="down">-0.31%</b>'), '收盘中位 = (-1.42%+0.80%)/2 = -0.31%（两口径不混算）');
ok(agg.includes('样本 &lt;10，比率噪声大'), 'n<10 标注噪声大');
// D9：样本来源必须写明（否则「强势池命中率」会被读成「全市场竞价命中率」）
ok(agg.includes('样本来源：每日 09:25 竞价强势池'), '聚合头写明样本来源（决策表 D9）');
ok(agg.includes('不是全市场基线'), '样本来源声明点名「不是全市场基线」');
// D3：prob 表改成当日封板率（同口径）
ok(agg.includes('prob 档位 vs 当日封板'), 'prob 表已改为「prob 档 vs 当日封板」（决策表 D3）');
ok(agg.includes('<b>同口径</b>：prob 就是「当日封板」的预测值'), 'prob 表注明与 prob 同口径');
ok(!agg.includes('次日最高≥3%</td>'), 'prob 表不再拿次日结果列与 prob 并排（口径错配）');
// 当日封板率算得对：<40 档 n=3（35/30/26），其中 26 那条封板 → 1/3 = 33%
ok(agg.includes('&lt;40</td><td>3</td><td>1</td><td><b>33%</b>'), '当日封板率 &lt;40 档 = 1/3 = 33%（含 pending 但当日封板已知的那条）');
ok(agg.includes('40-49</td><td>1</td><td>1</td><td><b>100%</b>'), '当日封板率 40-49 档 = 1/1 = 100%');
ok(/50-59<\/td><td class="muted">0</.test(agg), 'prob 档 50-59：空档显 0（⛔ 不造假行）');
ok(agg.includes('1 条 prob 未记录不计入'), 'prob 缺失单独计数、不硬塞档位');
ok(agg.includes('1 条判不出当日封板'), '判不出当日封板单独计数（⛔ 不按未封板算进分母）');
// 全 pending：次日比率一条都不出，但**当日封板表照常出**（当日口径不依赖次日 —— D3 的核心）
const aggP = arAggregate([mkIt('20261015', 26, { pending: true, sameDayLimit: true }), mkIt('20261015', 30, { pending: true, reason: 'x', sameDayLimit: false })]);
ok(aggP.includes('暂无已出次日结果的样本'), '全 pending：次日比率不出');
ok(aggP.includes('prob 档位 vs 当日封板') && aggP.includes('<b>50%</b>'), '全 pending：当日封板表照常出（1/2=50%）');
ok(!aggP.includes('0.0%'), '全 pending：⛔ 不出现 0/0 算出的 0.0%');
// 空/坏输入不崩
ok(arAggregate([]).includes('暂无已出次日结果的样本'), '空 items 不崩');
ok(arAggregate(null).includes('暂无已出次日结果的样本'), 'null items 不崩');
ok(arAggregate(IT.filter(x => !x.outcome)).includes('暂无已出次日结果的样本'), '无 outcome 字段不崩');

// ③ 渲染层：字符串断言看不见 DOM 解析结果（hj 轮教训：文本对≠页面对）→ 真塞进 jsdom 再看一眼
//    ⛔ 加载不了 jsdom 直接红，不静默跳过（判不出不当通过）。
let JSDOMX;
try { ({ JSDOM: JSDOMX } = require('jsdom')); }
catch (_) { ({ JSDOM: JSDOMX } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
const domX = new JSDOMX('<div id="aggx">' + agg + '</div>');
const box = domX.window.document.getElementById('aggx');
const txtX = box.textContent || '';
ok(txtX.includes('<40'), '渲染层：prob 档 <40 在真实 DOM 文本里仍在');
ok(box.querySelectorAll('table tr').length === 7, '渲染层：prob 小表 7 行（1 表头 + 6 档）', box.querySelectorAll('table tr').length + ' 行');
ok(txtX.includes('日内型信号 · 冲高兑现，非次日持股依据'), '渲染层：定位文案在 DOM 里');
ok(!/undefined|NaN/.test(txtX), '渲染层：无 undefined / NaN 漏到页面');

console.log(`[auction_review] ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
