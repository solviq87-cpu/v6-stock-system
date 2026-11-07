// 竞价逻辑离线单测：从 server.js 抽出真实函数源码执行，不依赖网络
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8').split('\n');
function grab(name) {
  const i = src.findIndex(l => l.startsWith('function ' + name));
  if (i < 0) throw new Error('未找到函数: ' + name);
  let j = i;
  while (j < src.length && src[j] !== '}') j++;   // 顶层函数结束：行首无缩进的 }
  return src.slice(i, j + 1).join('\n');
}
// auctionBlocked 现在复用顶层 listedDaysAgo 判定上市天数，抽取时必须一起带上，
// 否则 new Function 里缺这个依赖会 ReferenceError（注入清单漏项的典型症状）。
const names = ['listedDaysAgo', 'auctionPhase', 'auctionPxOf', 'auctionBlocked', 'auctionScoreOf'];
const code = names.map(grab).join('\n');

let S = { news: { goodCodes: new Set(['300001']) } };
const ctxObj = { S };
// ⚠️ A（analysis.js）也要注入：2026-10-06 起 ST/退市过滤统一走 A.isJunkName，
//    auctionBlocked 里原本内联的 /ST|退/i 正则已换成它，漏注入会直接 ReferenceError。
// ⚠️ isTradeDay 也要注入：2026-10-06 起 auctionPhase 加了休市日判定（法定假日里的周三
//    没有集合竞价，不能拿星期几当交易日），漏注入会直接 ReferenceError —— 这是「沙箱切片
//    新增外部依赖」的老坑，本会话已第 4 次踩到：症状不是业务断言变红，而是整个套件崩掉。
//    这里注入一个按 2026 法定假日表实现的等价替身（测试日期都落在 9 月底，非假日）。
const isTradeDay = d => {
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dow = d.getDay();
  return !(dow === 0 || dow === 6) && !['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].includes(ds);
};
// ⚠️ ztDayTag 也要注入（2026-10-08 dc 轮）：auctionScoreOf 的板块涨停文案不再写死"昨日"，
//    改成按涨停池归属日 ztDayTag(secZTDay) 说话。漏注入 = 整个套件 ReferenceError 崩掉，
//    症状不是断言变红而是根本跑不到断言（沙箱切片新增外部依赖的第 5 次）。
const ztDayTag = d => (d === '20260928' ? '今日' : (d ? '昨日' : ''));
const fn = new Function('S', 'A', 'isTradeDay', 'ztDayTag', code + '\nreturn {' + names.join(',') + '};');
const A = fn(S, require('./analysis.js'), isTradeDay, ztDayTag);

const ok = (label, cond, got) => console.log((cond ? '✅ ' : '❌ ') + label + (got != null ? '  → ' + got : ''));

console.log('── 1. 竞价阶段判定 ──');
const mk = (h, m, s) => new Date(2026, 8, 28, h, m, s || 0); // 2026-09-28 周一
ok('09:14:59 非竞价', A.auctionPhase(mk(9, 14, 59)) === 0, A.auctionPhase(mk(9, 14, 59)));
ok('09:15:00 可撤单', A.auctionPhase(mk(9, 15, 0)) === 1, A.auctionPhase(mk(9, 15, 0)));
ok('09:19:59 可撤单', A.auctionPhase(mk(9, 19, 59)) === 1, A.auctionPhase(mk(9, 19, 59)));
ok('09:20:00 不可撤单', A.auctionPhase(mk(9, 20, 0)) === 2, A.auctionPhase(mk(9, 20, 0)));
ok('09:25:00 已撮合', A.auctionPhase(mk(9, 25, 0)) === 3, A.auctionPhase(mk(9, 25, 0)));
ok('09:30:00 非竞价', A.auctionPhase(mk(9, 30, 0)) === 0, A.auctionPhase(mk(9, 30, 0)));
ok('周六 09:18 非竞价', A.auctionPhase(new Date(2026, 8, 26, 9, 18)) === 0, A.auctionPhase(new Date(2026, 8, 26, 9, 18)));
// 2026-10-07 是国庆假期里的周三：星期几照样是 3，但没有集合竞价（2026-10-06 补的口径）
ok('法定假日（国庆里的周三）09:18 非竞价', A.auctionPhase(new Date(2026, 9, 7, 9, 18)) === 0, A.auctionPhase(new Date(2026, 9, 7, 9, 18)));

console.log('\n── 2. 竞价取价口径（旧 bug：竞价期 open=0 → 算出 -100%）──');
const s1 = { price: 10.5, open: 0, preClose: 10 };
const p1 = A.auctionPxOf(s1, 1);
ok('竞价中用虚拟匹配价', p1.px === 10.5 && p1.src === '虚拟匹配价', `${p1.px} / ${p1.src} → ${((p1.px - 10) / 10 * 100).toFixed(2)}%`);
const s2 = { price: 10.8, open: 10.6, preClose: 10 };
const p2 = A.auctionPxOf(s2, 3);
ok('撮合后用开盘价', p2.px === 10.6 && p2.src === '开盘价', `${p2.px} / ${p2.src} → ${((p2.px - 10) / 10 * 100).toFixed(2)}%`);
const s3 = { price: 0, open: 10.2, preClose: 10 };
ok('竞价中 price 缺失回退 open', A.auctionPxOf(s3, 2).px === 10.2, A.auctionPxOf(s3, 2).px);
const s4 = { price: 10.9, open: 10.4, preClose: 10 };
ok('盘中(phase0)用真实开盘价', A.auctionPxOf(s4, 0).px === 10.4 && A.auctionPxOf(s4, 0).src === '开盘价', `${A.auctionPxOf(s4, 0).px} / ${A.auctionPxOf(s4, 0).src}`);

console.log('\n── 3. 不该进强势池的票 ──');
ok('ST 股剔除', !!A.auctionBlocked({ name: '*ST海核', code: '000503' }), A.auctionBlocked({ name: '*ST海核', code: '000503' }));
ok('退市股剔除', !!A.auctionBlocked({ name: 'XX退', code: '000504' }), A.auctionBlocked({ name: 'XX退', code: '000504' }));
const recent = new Date(Date.now() - 20 * 86400000);
const ld = recent.getFullYear() * 10000 + (recent.getMonth() + 1) * 100 + recent.getDate();
ok('次新股（上市20天）剔除', !!A.auctionBlocked({ name: '某某新材', listedDate: ld }), A.auctionBlocked({ name: '某某新材', listedDate: ld }));
ok('正常股放行', A.auctionBlocked({ name: '贵州茅台', listedDate: 20010827 }) === '', '放行');

console.log('\n── 4. 竞价强势评分 ──');
// ⛔ secZTDay 必须跟着 secZT 一起给（2026-10-08 dc 轮）：数量词与它所指的那批涨停不能分开走，
//    没有归属日时文案只能闭嘴（ztDayTag('') → ''），不能默认成"昨日"。
const roleOf = new Map([['600000', { role: 'leader', lb: 3, secZT: 5, secZTDay: '20260927', sector: '银行' }]]);
const ctx = { amtRank: new Map([['600000', 3], ['600001', 400]]), n: 5000, amtReliable: true, roleOf };
const mkItem = (code, pct, mainPct, amt, fc) => ({ code, name: code, auctionPct: pct, auctionAmount: amt || 0, mainPct: mainPct || 0, mainInflow: (mainPct || 0) * 1e6, floatCap: fc || 1e10, price: 10 });
const a = A.auctionScoreOf(mkItem('600000', 3.5, 6, 3e8), ctx);
ok('黄金区+额前1%+主力抢筹+龙头3板 → 高分', a.score >= 80, `分 ${a.score}`);
console.log('   因子:', a.factors.join(','));
console.log('   依据:', a.why.join(' + '));
const b = A.auctionScoreOf(mkItem('600001', 9.5, -3, 1e6), ctx);
ok('近一字+主力流出+额靠后 → 低分且有风险', b.score < 25 && b.risk.length >= 2, `分 ${b.score} | ${b.risk.join('|')}`);
const c = A.auctionScoreOf(mkItem('300001', 4, 2, 1e8), ctx);
ok('利好催化加分', c.factors.includes('利好催化'), c.factors.join(','));
const d = A.auctionScoreOf(mkItem('600002', 4, 2, 1e8, 8e11), ctx);
ok('超大流通盘扣分', d.factors.includes('大盘股折价'), `分 ${d.score}`);
const e = A.auctionScoreOf(mkItem('600003', 4, 2, 1e8, 3e9), ctx);
ok('小盘加分', e.factors.includes('小盘易拉'), `分 ${e.score}`);
const ctxBad = { ...ctx, amtReliable: false };
const f1 = A.auctionScoreOf(mkItem('600000', 3.5, 6, 3e8), ctx);
const f2 = A.auctionScoreOf(mkItem('600000', 3.5, 6, 3e8), ctxBad);
ok('非竞价窗口成交额权重减半', f2.score < f1.score, `${f1.score} → ${f2.score}`);
ok('评分恒在 0~100', [a, b, c, d, e, f1, f2].every(x => x.score >= 0 && x.score <= 100), 'OK');

console.log('\n── 5. 竞价分 → 涨停概率映射 ──');
for (const s of [20, 40, 55, 65, 75, 90]) {
  const raw = 18 + s * 0.62;
  const bk = s >= 90 ? null : null;
  console.log(`   竞价分 ${s} → 概率 ${Math.round(raw)}%`);
}
