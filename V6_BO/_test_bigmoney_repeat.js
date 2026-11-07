// 🔁 持续大单流入特别提醒 单测（_test_bigmoney_repeat.js）
// 背景：用户原话「大单重复流入也可以特别提醒」—— 同一只票一天内反复被大单扫货
// = 主力持续吸筹，比单次更强，值得单独再发一条。
// 本测试验证纯判定逻辑（独立于 server.js 的运行时），并检查 server.js 源码确实接线。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
function sec(t) { console.log('\n' + t); }

// ── 纯判定函数（镜像 server.js 里 takeRepeat + fastinNo 的核心决策） ──────────
// 输入：state = { fastinNo, lastRepeatTs, repeatSent, now } + cfg
// 输出：{ emit: bool, why }
// 设计要点：
//   ① 第 2 次及以上才发（fastinNo >= 2）
//   ② 距上次特别提醒 ≥ 30 分钟（独立节流，不走 govTake 90 分钟冷却）
//   ③ 每票每日上限 3 条
//   ④ 仍占每日总名额（quota）
function judge(state, cfg) {
  const c = cfg || {};
  const now = state.now;
  const minGap = c.minGap != null ? c.minGap : 30 * 60 * 1000;
  const maxRepeat = c.maxRepeat || 3;
  const quota = c.quota;                 // Infinity = 不限
  const total = c.total || 0;
  if (state.fastinNo < 2) return { emit: false, why: '首次大单流入，不算持续' };
  if (state.lastRepeatTs && now - state.lastRepeatTs < minGap)
    return { emit: false, why: '30 分钟内已发过持续流入提醒' };
  if ((state.repeatSent | 0) >= maxRepeat) return { emit: false, why: '该票今日持续流入提醒已达上限(' + maxRepeat + ')' };
  if (Number.isFinite(quota) && total >= quota) return { emit: false, why: '当日名额已用尽' };
  return { emit: true };
}

const MIN = 60 * 1000;

// ① 首次不发
sec('① 首次大单流入不发持续提醒');
ok(judge({ fastinNo: 1, lastRepeatTs: 0, repeatSent: 0, now: 0 }).emit === false, 'fastinNo=1 不发');

// ② 第 2 次且距上次够久 → 发
sec('② 第 2 次且距上次≥30分钟 → 发');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 31 * MIN }).emit === true, '31 分钟后第 2 次发');
ok(judge({ fastinNo: 2, lastRepeatTs: 1000, repeatSent: 0, now: 1000 + 31 * MIN }).emit === true, '距上次提醒 31 分钟发');

// ③ 30 分钟内第 2 次不发（独立节流）
sec('③ 30 分钟内重复不发');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 5 * MIN }).emit === true, '从未发过 → 第 2 次立刻发');
// 已发过 1 条，距上次 10 分钟 → 应拦
ok(judge({ fastinNo: 3, lastRepeatTs: 90 * MIN, repeatSent: 1, now: 100 * MIN }).emit === false, '距上次 10 分钟 → 拦');
// 已发过 1 条，距上次 29 分钟 → 仍拦（< 30 分钟）
ok(judge({ fastinNo: 3, lastRepeatTs: 71 * MIN, repeatSent: 1, now: 100 * MIN }).emit === false, '距上次 29 分钟 → 仍拦');

// ④ 每票每日上限 3 条
sec('④ 每票每日上限 3 条');
ok(judge({ fastinNo: 4, lastRepeatTs: 0, repeatSent: 3, now: 999 * MIN }).emit === false, '已发 3 条 → 拦');
ok(judge({ fastinNo: 4, lastRepeatTs: 0, repeatSent: 2, now: 999 * MIN }).emit === true, '已发 2 条 → 第 3 条放行');

// ⑤ 占总名额：名额满了不发
sec('⑤ 占总名额，名额满则不发');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 999 * MIN }, { quota: 350, total: 350 }).emit === false, 'total=quota → 拦');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 999 * MIN }, { quota: 350, total: 349 }).emit === true, 'total=349 还差 1 → 放行');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 999 * MIN }, { quota: Infinity, total: 9999 }).emit === true, '不限量时再多也放行');

// ⑥ 跨日重置：新交易日 lastRepeatTs 归零（判定层面：state.lastRepeatTs=0 即可发）
sec('⑥ 跨日重置后可立刻发');
ok(judge({ fastinNo: 2, lastRepeatTs: 0, repeatSent: 0, now: 0 }).emit === true, '新交易日首条持续提醒可立刻发');

// ⑦ 源码接线检查：server.js 必须有这些关键串
sec('⑦ 源码接线检查');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
ok(src.indexOf("fastinRepeat: new Map()") >= 0, 'S.fastinRepeat 状态已声明');
ok(src.indexOf("🔁 持续大单流入") >= 0, '特别提醒类型串已定义');
ok(src.indexOf("takeRepeat") >= 0, '独立节流函数 takeRepeat 已定义');
ok(src.indexOf("a.fastinNo >= 2") >= 0, '触发条件 fastinNo>=2 已接线');
ok(src.indexOf("bigmoney_repeat") >= 0, '学习样本类型 bigmoney_repeat 已登记');
ok(/持续大单流入.*主力持续吸筹/.test(src), '文案含「主力持续吸筹」语义');
ok(src.indexOf("30*60*1000") >= 0, '30 分钟独立节流常量存在');

console.log('\n──────────────────────────────');
console.log(`持续大单流入测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
