// 守门：同一天内不许同方向二次加码（cw 轮 · 角度「只有一种输入会走到」）
//
// 上轮（cv）加的复核闸有个致命缺口：**「新样本不足 → 放行」这个出口，恰恰在事故场景里
// 是唯一会走到的出口**。一天内反复触发闭环时，新样本一条都还没回验出来 → fresh 恒为 0
// → `fresh.length < minFresh` → 放行 → 继续加码。9/28 一天灌 1373 条 → 连调 10 次把阈值
// 从 0.82 顶到 0.90「几乎什么都不推」，正是这么发生的：那道闸在最需要它的时候是摆设。
//
// 修法：adjRemember 记下"这次调整发生在哪一天"，adjReview 收到 todayKey 后 ——
//       **上次调整就在今天 → 不许再往同方向加码**（同一批样本再判一次只会重复加码）。
//
// 本套件的证据方式：把 adjSnapshot / adjRemember / adjReview / adjReviewWhy 原样抠进沙箱
// 真跑，模拟"一天内连调 10 次"与"跨日后再调"，并用**不传 todayKey** 做反证。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m); } };

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });

// ── 抠函数体（花括号配对；先跳形参表，防默认参数骗计数）─────────────────
function grab(re) {
  const lines = SV.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    let depth = 0, body = '';
    for (let j = i; j < lines.length; j++) {
      body += lines[j] + '\n';
      for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && j >= i) break;
    }
    // 形参表里的花括号会让首行就归零 → 从第一个 '{' 之后重新配平
    const head = lines[i];
    const p = head.indexOf('{');
    if (p < 0) return body;
    return head.slice(0, p) + body.slice(body.indexOf('{'));
  }
  throw new Error('没找到: ' + re);
}
const S_SNAP = grab(/^function adjSnapshot\(/m);
const S_REM = grab(/^function adjRemember\(/m);
const S_REV = grab(/^function adjReview\(/m);
const S_WHY = grab(/^function adjReviewWhy\(/m);

// ── 沙箱：注入 S / saveLearn / todayStr（今天可改，用来模拟跨日）────────
let TODAY = '2026-10-07';
let saved = 0;
const state = { learn: {} };
const saveLearn = () => { saved++; return true; };
const todayStr = () => TODAY;

const F = new Function('S', 'saveLearn', 'todayStr',
  S_SNAP + '\n' + S_REM + '\n' + S_REV + '\n' + S_WHY + '\n' +
  'return { adjSnapshot, adjRemember, adjReview, adjReviewWhy };');
const A = F(state, saveLearn, todayStr);

const mkSamples = (n, goodN, t0) => Array.from({ length: n }, (_, i) => ({
  ts: t0 + i, resolved: { hit: i < goodN, limitUp: i < goodN }
}));

console.log('=== 同一天内不许同方向二次加码 ===');

// ① 首次调整：没有快照 → 不拦
ok(A.adjReview(mkSamples(50, 20, 1000), null, s => s.resolved.hit, 8, TODAY).stop === false,
  '① 首次调整（无快照）不拦');

// ② 上次调整就在今天 → 拦，且标记为 sameDay
const t0 = Date.now();
A.adjRemember('bigmoney', { ts: t0, from: 50, to: 55, rate: 8, n: 200 });
ok(state.learn.adj.bigmoney.day === TODAY,
  '② adjRemember 必须记下"这次调整发生在哪一天"（否则无从识别同一天）');
const r2 = A.adjReview(mkSamples(50, 20, t0 + 1), A.adjSnapshot('bigmoney'), s => s.resolved.hit, 8, TODAY);
ok(r2.stop === true && r2.sameDay === true,
  '③ 上次调整就在今天 → 拦下（stop=true, sameDay=true）');

// ④ 拦下的理由要看得懂（cj 轮：系统对自己说的话负责）
const why2 = A.adjReviewWhy(r2);
ok(/今天/.test(why2) && /同一批样本|重复加码/.test(why2),
  '④ 拦下理由说清"同一批样本再判一次只会重复加码"，不是一句"暂不调整"');
ok(/下一个交易日|新证据/.test(why2), '⑤ 理由要给出"什么时候可以再议"，而不是只说不');

// ⑥ 跨日之后 → 不再走 sameDay 出口，回到"看新样本效果"
TODAY = '2026-10-08';
const r6 = A.adjReview(mkSamples(50, 20, t0 + 1), A.adjSnapshot('bigmoney'), s => s.resolved.hit, 8, TODAY);
ok(r6.sameDay !== true, '⑥ 跨日后不再走 sameDay 出口（有真实新证据才谈得上效果）');
ok(r6.stop === false && r6.rate === 40 && r6.before === 8,
  '⑦ 跨日后新样本达标率 40% > 调整前 8% = 真改善 → 放行（cv 轮原有保护未被破坏）');

// ⑧ 跨日后没改善 → 拦（cv 轮的原有保护仍在）
const r8 = A.adjReview(mkSamples(50, 2, t0 + 1), A.adjSnapshot('bigmoney'), s => s.resolved.hit, 8, TODAY);
ok(r8.stop === true && r8.rate === 4 && r8.before === 8,
  '⑧ 跨日后新样本达标率 4% ≤ 调整前 8% → 拦下（cv 轮原有保护未被破坏）');

// ⑨ 跨日后新样本不足 → 不拦（没证据不判死，别把正常调整卡死）
const r9 = A.adjReview(mkSamples(3, 1, t0 + 1), A.adjSnapshot('bigmoney'), s => s.resolved.hit, 8, TODAY);
ok(r9.stop === false && r9.fresh === 3, '⑨ 跨日后新样本不足 → 不拦（证据不足不下结论）');

// ── 事故场景复现：一天内连调 10 次（9/28 真出过：0.82 → 0.90）────────────
console.log('\n=== 事故场景复现：一天内连续触发闭环 ===');
function replayDay(times, passToday) {
  state.learn.adj = {};
  let cur = 50;                       // 模拟 2026-09-28 事故当天的自学习起点（旧 bigMoneyProbGate 默认 50，iq 轮已退役；此处只复现"一天连调"场景，不碰真闸门）
  const log = [];
  for (let i = 0; i < times; i++) {
    const snap = A.adjSnapshot('bigmoney');
    let stop = false;
    if (snap && snap.to > snap.from) {
      const rv = A.adjReview(mkSamples(0, 0, Date.now()), snap, s => s.resolved.limitUp, 10,
        passToday ? TODAY : undefined);   // ⛔ 反证：不传 todayKey = 旧版行为
      if (rv.stop) stop = true;
    }
    if (!stop) {
      const nv = Math.min(70, cur + 5);
      if (nv !== cur) { const from = cur; cur = nv; A.adjRemember('bigmoney', { ts: Date.now(), from, to: nv, rate: 8 }); log.push(nv); }
    }
  }
  return { cur, n: log.length };
}
TODAY = '2026-10-07';
const withGate = replayDay(10, true);
ok(withGate.n === 1 && withGate.cur === 55,
  `⑩ 一天内连调 10 次 → 只上调 1 次（50→${withGate.cur}），不再是 50→70 顶死`);

const noGate = replayDay(10, false);   // 反证：旧版（不认同一天）
ok(noGate.n === 4 && noGate.cur === 70,
  `⑪ 反证：不认"同一天"时，一天内照样一路顶到上限（${noGate.cur}）—— 证明这道闸真的在起作用`);

// ── 静态：两处闭环都必须把"今天"传进去，且拦下时必须留档 ────────────────
// ⛔ iq 轮（2026-10-17）：大单涨停闭环整条退役（bigMoneySelfOptimize→bigMoneyStatsRefresh），
//   adjReview 调用点从 3 处减到 2 处（相似 + 趋势）—— 计数跟着改，语义不变：
//   现存每一处自学习闭环都必须接 todayKey，新增闭环也要一并接闸。
console.log('\n=== 两处闭环接线 ===');
const calls = [...SV.matchAll(/adjReview\(([^;]*?)\)\s*;/g)].map(m => m[1]);
const wired = calls.filter(c => /todayStr\(\)/.test(c));
ok(wired.length === 2, `⑫ 两处 adjReview 调用点都传了 todayStr()（实测 ${wired.length}/2）`);
ok(calls.length === 2, `⑬ adjReview 调用点恰好 2 处（iq 轮大单闭环退役后 3→2；新增闭环要一并接闸；实测 ${calls.length}）`);

const stops = [...SV.matchAll(/if \(rv\.stop\) \{/g)];
let noted = 0;
for (const m of stops) {
  const seg = SV.slice(m.index, m.index + 400);
  if (/noteLearnChange\(/.test(seg) && /adjReviewWhy\(rv\)/.test(seg)) noted++;
}
ok(noted === 2, `⑭ 两处拦下分支都留档且用统一口径 adjReviewWhy（实测 ${noted}/2）`);

// ⑮ 只拦"上次也是加码"的方向：放宽方向不进闸
const srcRev = S_REV;
ok(!/sameDay/.test(srcRev.split('const fresh')[0].split('// ⛔⛔')[0]) === false ||
  /to > _snap\.from/.test(SV),
  '⑮ sameDay 闸只在 `to > from`（上次也是加码）时进入 —— 放宽方向不受影响');

// ⑯ 快照缺 day（旧数据）时不得误拦：day 为空 → 走原逻辑
state.learn.adj = { similar: { ts: t0, from: 62, to: 67, rate: 20 } };
const r16 = A.adjReview(mkSamples(50, 20, t0 + 1), A.adjSnapshot('similar'), s => s.resolved.hit, 8, TODAY);
ok(r16.sameDay !== true && r16.stop === false,
  '⑯ 老快照没有 day 字段 → 不误拦（升级兼容，走原来的"看效果"逻辑）');

// ⑰ 落盘往返：实例每次发布/回收都重启（bt 轮老坑），重启后必须还认得出"今天调过"
//    S.learn 是整份 JSON.stringify 落 stats.json 的，day 是普通字符串 → 不会丢
A.adjRemember('bigmoney', { ts: t0, from: 50, to: 55, rate: 8 });
const round = JSON.parse(JSON.stringify({ learn: state.learn }));
ok(round.learn.adj.bigmoney && round.learn.adj.bigmoney.day === TODAY,
  `⑰ 落盘往返后 day 仍在（重启/冷启动后同一天不会重复加码，实测 ${round.learn.adj.bigmoney && round.learn.adj.bigmoney.day}）`);
ok(/^\d{4}-\d{2}-\d{2}$/.test(round.learn.adj.bigmoney.day || ''),
  '⑱ day 是可读的日期串 —— 时间戳表达不了"同一天"这个语义');

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail ? 1 : 0);
