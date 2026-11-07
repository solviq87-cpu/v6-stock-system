'use strict';
// jy 轮守门：auczt 题材梯队因子——auctionScoreOf 对龙头/龙二/中军/连板给分，
//   且 inferZTProb 源码中按 themeStrengthOf 对 prob 做梯队调整。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j + end.length);
}

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name); }
}

// ① 静态检查：inferZTProb 中必须存在题材梯队概率调整代码
// ⛔ 2026-10-28 修尺子：旧断言钉的是 jy 轮初版写法 `const thMul = _th.grade === '强'`，
//    而代码早按「判不出不硬判」加了 `!_thKnown ? 1 :` 守卫（主题归不出 → 乘中性 1、不落因子）——
//    断言跟不上代码就成了假红。改为钉语义：①判不出走中性 ②判得出按 强/中/弱 分档。
ok('inferZTProb 含题材梯队乘数且判不出走中性 1（!_thKnown ? 1 :）',
  /const thMul = !_thKnown \? 1 :/.test(SRC) && /_th\.grade === '强'/.test(SRC));
ok('inferZTProb 按题材梯队强弱调整 prob', /prob \*= thMul/.test(SRC));
ok('inferZTProb 把题材梯队因子加入 factors', /题材梯队强/.test(SRC) && /题材梯队弱/.test(SRC));

// ② 真跑 auctionScoreOf：验证角色/连板加分
const parts = [
  grab('function ztDayTag(d) {', '\n}\n'),
  grab('function auctionResonanceAdj(secZT) {', '\n}\n'),
  grab('function auctionTrapOf(ticks, preClose) {', '\n}\n'),
  grab('function auctionScoreOf(x, ctx) {', '\n}\n'),
];
const code = parts.join('\n');
const S = { news: { goodCodes: new Set() } };
const A = {};
function todayStr() { return '20261023'; }
const api = new Function('S', 'A', 'todayStr', code + '\nreturn { auctionScoreOf };')(S, A, todayStr);

function ctxWithRole(role, lb = 1, secZT = 5) {
  const roleOf = new Map();
  if (role) roleOf.set('000001', { role, lb, secZT, secZTDay: '20261023', sector: '金融科技' });
  return { roleOf, amtRank: new Map([['000001', 1]]), n: 100, amtReliable: true };
}
function baseX() {
  return { code: '000001', name: '平安银行', auctionPct: 3.5, mainPct: 2.0, mainInflow: 1e8, floatCap: 2e10 };
}

const noRole = api.auctionScoreOf(baseX(), { roleOf: new Map(), amtRank: new Map(), n: 100, amtReliable: true });
const leader = api.auctionScoreOf(baseX(), ctxWithRole('leader'));
const deputy = api.auctionScoreOf(baseX(), ctxWithRole('deputy'));
const mid = api.auctionScoreOf(baseX(), ctxWithRole('mid'));
const follow = api.auctionScoreOf(baseX(), ctxWithRole('follow'));

ok('无角色基线分 > 0', noRole.score > 0);
ok('板块龙头加分最高', leader.score > deputy.score && deputy.score > mid.score && mid.score > follow.score && follow.score > noRole.score);

const lb2 = api.auctionScoreOf(baseX(), ctxWithRole('leader', 2));
const lb3 = api.auctionScoreOf(baseX(), ctxWithRole('leader', 3));
ok('连板高度越高分越高', lb3.score > lb2.score && lb2.score > leader.score);

const weakSector = api.auctionScoreOf(baseX(), ctxWithRole('leader', 1, 1));
ok('板块共振弱会扣分（孤板）', weakSector.score < leader.score);

console.log(`\n──── 结果：${passed} 通过 / ${failed} 失败 ────\n`);
process.exit(failed ? 1 : 0);
