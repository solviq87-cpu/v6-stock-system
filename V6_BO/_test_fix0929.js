// 验证 az+ 两处修复：① A股T+1 当日不可卖 ② 持仓建议感知利好（三峡新材场景）
const fs = require('fs'), path = require('path');
const lines = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').split('\n');
const findIdx = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('未找到: ' + re); return i; };
const grabBlock = (startRe, endRe) => {
  const a = findIdx(startRe); let b = a + 1;
  while (b < lines.length && !endRe.test(lines[b])) b++;
  return lines.slice(a, b).join('\n');
};
const todayStrSrc = (() => {
  const s = findIdx(/^const todayStr = /); let e = s;
  while (e < lines.length && lines[e] !== '};') e++;
  return lines.slice(s, e + 1).join('\n');
})();
// T+1 相关三个函数（hr 轮 dayKeyOf 改为 function 声明，锚点两种写法都认）
const t1Src = grabBlock(/^(?:const dayKeyOf = ts =>|function dayKeyOf\()/, /^function paperSell\(/) +
  grabBlock(/^function paperT1Locked\(/, /^function paperCheck\(/);

const T = new Function(`${todayStrSrc}\n${t1Src}\nreturn { dayKeyOf, paperT1Locked, todayStr };`)();

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✓ ' + n + (got ? '  → ' + got : '')); } else { fail++; console.log('  ✗ ' + n + '  → ' + got); } };

console.log('\n===== ① A股 T+1：当日买入当日不得卖出 =====');
const now = Date.now();
// ⚠️ 夹具锚定「今天 12:00」而不是 now-1h：深夜/凌晨跑测试时 now-1h 会跨自然日，
//    「当天买入」变成昨天买入 → 误报。中午 12:00 在全天任意时刻跑都落在当天。
const _todayNoon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const todayBuy = { buyTs: _todayNoon };                              // 今天买入（中午）
const yesBuy   = { buyTs: _todayNoon - 26 * 3600 * 1000 };           // 昨天买入（昨天上午10点）
const weekAgo  = { buyTs: now - 7 * 24 * 3600 * 1000 };
ok(T.paperT1Locked(todayBuy) === true, '当天买入 → 锁定（不可卖）', 'T+1 OK');
ok(T.paperT1Locked(yesBuy) === false, '昨天买入 → 已解禁（可卖）', 'T+1 OK');
ok(T.paperT1Locked(weekAgo) === false, '一周前买入 → 可卖');
// 临界：今天 00:01 买入，也应算当日
const midnight = new Date(); midnight.setHours(0, 1, 0, 0);
ok(T.paperT1Locked({ buyTs: midnight.getTime() }) === true, '今天凌晨买入也算当日', T.dayKeyOf(midnight.getTime()));
// 边界：买入时间戳缺失不应崩
ok(T.paperT1Locked({}) === false, '无买入时间戳时不崩');

console.log('\n===== ② 持仓建议：重大利好要能把减仓降级 =====');
const hsrc = fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8');
const GOOD_MAJOR_RE = (() => {
  const m = hsrc.match(/const GOOD_MAJOR_RE = (\/.*?\/);/);
  return eval(m[1]);
})();
const cases = [
  ['三峡新材：筹划购买电池电解液公司珠海赛纬司不低于53.14%股份 股票停牌', true],
  ['昌红科技：拟1亿元-2亿元回购股份', true],
  ['某某：股东拟增持公司股份', true],
  ['某某中标新能源项目', true],
  ['某某：预计前三季度业绩预增', true],
  ['某某：股价异动，无重大事项', false],
  ['某某：日常经营性公告', false],
];
for (const [t, exp] of cases) {
  ok(GOOD_MAJOR_RE.test(t) === exp, `${exp ? '重大利好' : '普通消息'}识别：${t.slice(0, 28)}…`);
}
// holdings.js 必须同时读 goodCodes 和 badCodes
ok(/goodCodes\s*&&\s*S\.news\.goodCodes\.has\(code\)/.test(hsrc) || /goodCodes.*has\(code\)/.test(hsrc),
   'holdings.js 已接入 goodCodes（原来只有 badCodes）');
ok(/majorGood/.test(hsrc) && /downgrade/.test(hsrc), '重大利好触发建议降级逻辑存在');
ok(/停牌/.test(hsrc), '识别停牌状态（量价失效）');

console.log('\n===== ③ 端到端：verdict 真实跑一遍「停牌+收购」场景 =====');
// 用 mock 依赖装载 holdings.js，直接调用导出的 verdict，验证不再是"回撤止盈/减仓"
const realFs = require('fs');
const HOLD_RAM = {
  capital: 100000, stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90,
  items: [{ code: '600293', name: '三峡新材', cost: 3.862, shares: 10000, tags: [], locked: false }]
};
const mockFs = {
  readFileSync: (p, enc) => String(p).endsWith('holdings.json')
    ? JSON.stringify(HOLD_RAM) : realFs.readFileSync(p, enc),
  writeFileSync: () => {}, existsSync: () => true
};
const mkS = (good, title) => ({
  news: {
    badCodes: new Set(), badAll: [], goodAll: [], neutralAll: [],
    goodCodes: good ? new Set(['600293']) : new Set(),
    ...(good ? { goodAll: [{ id: 'x', t: '2026-09-28 19:51', title, stocks: [], codes: ['600293'] }] } : {})
  }
});
// rows：近 10 日 K 线，高点 4.15（停牌前的高点，用来构造"回撤 5.3%"）
const rows = Array.from({ length: 12 }, (_, i) => ({ close: i === 11 ? 3.93 : 3.8 + i * 0.03, high: i === 5 ? 4.15 : 3.85 + i * 0.03 }));
const snap = { price: 3.93, pct: 0, mainInflow: -1200000, mainPct: -2.1 };
const run = (S) => require('./holdings')({
  fs: mockFs, path: require('path'), dir: __dirname, S, em: {},
  sseSend: () => {}, sseSendEdit: () => {}, pushAll: () => {}
}).verdict('600293', snap, rows, { positionPct: 30 });

// A. 停牌 + 收购 → 只能有「停牌中/复牌待办」，绝不能再出现任何技术面买卖建议
{
  const v = run(mkS(true, '三峡新材：筹划购买电池电解液公司珠海赛纬司不低于53.14%股份 股票停牌'));
  const types = v.acts.map(a => a.type);
  ok(v.suspended === true, '识别为停牌股', 'suspended=' + v.suspended);
  ok(types.every(t => t === '停牌中' || t === '复牌待办'),
     '停牌时不给任何技术面买卖建议（原来会催回撤止盈）', types.join('/'));
  ok(!types.some(t => /回撤|止盈|止损|减仓|清仓/.test(t)), '回撤止盈/减仓/止损全部屏蔽');
}
// B. 重大利好但不停牌 → 回撤止盈降级为「持有观察」
{
  const v = run(mkS(true, '某某股份：拟回购公司股份，金额不低于2亿元'));
  const types = v.acts.map(a => a.type);
  ok(types.includes('持有观察'), '重大利好把回撤止盈降级为持有观察', types.join('/'));
  ok(!types.includes('回撤止盈') && !types.includes('回撤提醒'), '不再催分批止盈');
  ok(types.includes('利好在案'), '卡片上明示当日利好来源');
}
// C. 无利好 → 原逻辑不变，该催还得催
{
  const v = run(mkS(false));
  const types = v.acts.map(a => a.type);
  ok(types.some(t => /回撤|止损|减仓/.test(t)), '无利好时保持原的风控灵敏度', types.join('/'));
  ok(!v.goodNews, '未误报利好');
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
process.exit(fail ? 1 : 0);
