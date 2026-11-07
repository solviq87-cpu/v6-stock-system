// 守门测试（cv 轮 · 角度：说过一次就不再复核的结论）
// 两处自适应闭环都是"命中率不好 → 把门槛往上调"。但调完没人回头看：
// 下次判定要不要继续调，用的仍是**调整之前就产生的旧样本**（历史几百条 vs 新增几十条，
// 新证据被稀释）→ 同方向一路加码到上限（相似 85 / 推送阈值 0.86），
// 模块从此推不出票，而系统永远不会说"是我自己把门槛顶死的"。
// 修法：每次调整存决策快照，下次继续加码前先看上次调整**之后的新样本**有没有改善。
// ⛔ iq 轮（2026-10-17）：第三处闭环「大单涨停」（bigMoneySelfOptimize→bigMoneyProbGate）
//   整条退役 —— prob 对这一类是反指标（实盘 150 样本 prob≥80 档收≥3% 仅 7.1%），
//   自学习调一个没人读的 knob 比没有更糟。更名 bigMoneyStatsRefresh 只刷新统计，
//   本节同时钉死它不写配置、不调门槛（防复活）。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });

function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let pe = i;
  if (/^function\s/.test(sig)) {
    let p = src.indexOf('(', i), pd = 0;
    for (pe = p; pe < src.length; pe++) {
      const c = src[pe];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
  }
  let j = src.indexOf('{', pe), d = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return '';
}

console.log('【一】真跑复核逻辑 adjReview');
const rvBody = fnBody(NOC, 'function adjReview(');
ok('[自检] 取到 adjReview 函数体', rvBody.indexOf('minFresh') >= 0);
// ⛔ 形参也要进注入清单（漏一个 = 整个套件崩掉，踩过 5 次）
// ⛔ 新增形参 todayKey 必须同步进注入清单（cw 轮踩：漏了 → ReferenceError 整个套件崩掉，不是变红）
const review = new Function('samples', 'snap', 'good', 'minFresh', 'todayKey',
  rvBody + ' return adjReview(samples, snap, good, minFresh, todayKey);');
const mk = (n, goodN, baseTs) => Array.from({ length: n }, (_, i) => ({
  ts: baseTs + i, resolved: { hit: i < goodN, limitUp: i < goodN }
}));
// 场景：上次把门槛从 50 调到 55，当时统计的达标率是 20%
const snap = { ts: 1000, from: 50, to: 55, rate: 20, n: 300 };
// ① 调整后新增 20 条，达标率仍是 20%（没改善）→ 应当停手
ok('★ 上次调高后新样本没改善 → 停手（不再继续加码）', review(mk(20, 4, 1001), snap, s => s.resolved.hit, 10).stop === true);
// ② 新样本达标率降到 10%（更差）→ 更要停手
ok('★ 新样本反而更差 → 停手', review(mk(20, 2, 1001), snap, s => s.resolved.hit, 10).stop === true);
// ③ 新样本达标率升到 50%（真的改善了）→ 允许继续按新证据调
ok('★ 新样本确实改善 → 放行（不把正常调整卡死）', review(mk(20, 10, 1001), snap, s => s.resolved.hit, 10).stop === false);
// ④ 新样本不够 → 证据不足，不拦（别把正常调整卡死）
ok('★ 新样本不足以下结论 → 不拦（没证据就不判死）', review(mk(3, 0, 1001), snap, s => s.resolved.hit, 10).stop === false);
// ⑤ 没有快照（首次调整）→ 不拦
ok('★ 首次调整（无快照）→ 不拦', review(mk(20, 0, 1001), null, s => s.resolved.hit, 10).stop === false);
// ⑥ 只统计快照之后的样本（ts 更小的旧样本不算数）
const mixed = mk(10, 0, 900).concat(mk(10, 8, 1001));   // 旧 10 条全差 + 新 10 条全好
const r6 = review(mixed, snap, s => s.resolved.hit, 10);
ok('★ 只统计上次调整**之后**的新样本（旧证据不算数）', r6.fresh === 10 && r6.stop === false);
// ⑦ 反向：下调（放宽）不受这道闸约束（它不会把模块憋死）
ok('ⓘ 复核只拦"往上加码"方向（放宽方向不拦）', /_snap\.to > _snap\.from/.test(NOC));

console.log('\n【二】两处闭环都必须接上复核');
for (const [name, sig, key, field] of [
  ['相似跟随闭环', 'function similarSelfOptimize(', 'similar', 'simGate'],
  ['趋势失败率控制', 'function trendSelfOptimize(', 'trend', 'probThreshold'],
]) {
  const b = fnBody(NOC, sig);
  ok('[自检] 取到 ' + name, b.length > 100);
  ok('★ ' + name + ' 会取复核快照', b.indexOf("adjSnapshot('" + key + "')") >= 0);
  ok('★ ' + name + ' 会做复核（adjReview）', /adjReview\(/.test(b));
  ok('★ ' + name + ' 调整后会记住快照（下次才有得复核）', b.indexOf("adjRemember('" + key + "'") >= 0);
  ok('★ ' + name + ' 复核未通过会留档说明（不是静默 return）', /noteLearnChange\([\s\S]{0,80}复核/.test(b));
}

console.log('\n【三】复核不能破坏原有保护');
const sim = fnBody(NOC, 'function similarSelfOptimize(');
ok('★ 普跌日/指数失真日仍然不罚模型（没被复核顶掉）', /isBearDay\(todayBeta\(\)\) \|\| isDistortDay\(\)/.test(sim));
ok('★ 相似门槛的样本不足仍然不动门槛', /st\.n < 10 \|\| st\.days < MIN_LEARN_DAYS/.test(sim));
const ts = fnBody(NOC, 'function trendSelfOptimize(');
ok('★ 趋势阈值的 ≥5 交易日门槛仍在', /st\.days < MIN_LEARN_DAYS/.test(ts));
ok('★ 趋势阈值的普跌日保护仍在', /isBearDay\(todayBeta\(\)\) \|\| isDistortDay\(\)/.test(ts));
ok('★ bearDominated 那道保护的函数仍在（大单闭环退役时没被顺手删，别处还在用）',
  /function bearDominated\(/.test(NOC) && (NOC.match(/bearDominated\(/g) || []).length >= 2);
// ⛔ iq 轮：退役侧钉死 —— bigMoneyStatsRefresh 只剩统计，不许偷偷回到"调门槛"的老路
const bms = fnBody(NOC, 'function bigMoneyStatsRefresh(');
ok('[自检] 取到 bigMoneyStatsRefresh 函数体', bms.length > 20);
ok('⛔ 大单闭环已退役：不写任何配置（没有 S.config 写点）', !/S\.config\./.test(bms));
ok('⛔ 大单闭环已退役：不调门槛（无 adjSnapshot/adjReview/adjRemember/noteLearnChange）',
  !/adjSnapshot\(|adjReview\(|adjRemember\(|noteLearnChange\(/.test(bms));

console.log('\n【四】反证：撤掉快照，复核就无从谈起');
const noSnap = sim.replace(/adjRemember\('similar'[^;]*;\s*/, '');
ok('[自检] 反证确实改了代码', noSnap !== sim);
ok('★ 反证：不记快照的话，下次复核拿不到上次调整的时刻与当时水平', !/adjRemember\('similar'/.test(noSnap));

console.log('\n────────────────────────────────────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
