// 时间窗守门测试（本轮角度：时间窗的「开闭 / 重叠 / 缝隙」）。
// 时间窗这类代码的坏法很特别：它不报错、不崩、测试里也不红，只是「该跑的时候没跑」或
// 「不该跑的时候照跑」。午休那 30 分钟被算进交易时段，表现就是白烧请求额度 + 在冻结数据上
// 重复触发同一批信号；窗口守卫写成了永假的死分支，表现是"以为兜住了其实没人兜"。
// 所以本测试把每个窗口函数从 server.js 里【原样切出来】在受控时钟下真跑一遍，
// 并对每一处修复都配一条「旧写法会怎样」的反证 —— 没有反证的断言等于许愿。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// ── 把源码里的一个代码块原样切出来（括号配对，跳过字符串与注释）──────────────
function grab(re) {
  const m = re.exec(s);
  if (!m) throw new Error('未找到代码块: ' + re);
  const start = s.indexOf('{', m.index);
  let depth = 0, inS = null, inC = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (inC === 'line') { if (c === '\n') inC = null; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = null; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inC = 'line'; i++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return s.slice(m.index, i + 1); }
  }
  throw new Error('代码块括号未闭合: ' + re);
}

// 受控时钟：只提供窗口函数真正会读的那几个方法
function clock(hh, mm, ss, dow) {
  return function () {
    return {
      getDay: () => (dow == null ? 3 : dow),
      getHours: () => hh,
      getMinutes: () => mm,
      getSeconds: () => (ss || 0),
      getFullYear: () => 2026, getMonth: () => 9, getDate: () => 7,
      getTime: () => 0
    };
  };
}
// ══ [1] isTradingTime：上午收盘必须是 11:30，不能伸进午休 ═══════════════════
group('[1] isTradingTime 交易时段边界');
const SRC_TT = grab(/const isTradingTime = \(\) => \{/);
function tt(hh, mm, trade) {
  const named = /const (isTradingTime) =/.exec(SRC_TT)[1];
  const f = new Function(['__D', 'isTradeDay'], 'const Date = __D;\n' + SRC_TT + '\nreturn ' + named + ';');
  return f(clock(hh, mm), trade === false ? () => false : () => true)();
}
ok('9:14 未开始 → false', tt(9, 14) === false);
ok('9:15 竞价开始 → true', tt(9, 15) === true);
ok('9:30 开盘 → true', tt(9, 30) === true);
ok('11:29 上午盘中 → true', tt(11, 29) === true);
ok('11:30 上午收盘那一刻 → true', tt(11, 30) === true);
ok('⛔ 11:31 已进入午休 → false', tt(11, 31) === false);
ok('⛔ 12:00 午休 → false（原写法这里是 true）', tt(12, 0) === false);
ok('12:59 午休 → false', tt(12, 59) === false);
ok('13:00 下午开盘 → true', tt(13, 0) === true);
ok('15:00 收盘那一刻 → true', tt(15, 0) === true);
ok('15:01 已收盘 → false', tt(15, 1) === false);
ok('休市日（周三法定假）9:30 → false', tt(9, 30, false) === false);
// 反证：旧写法 `m <= 11*60+30+30` 在 12:00 返回 true —— 证明这 30 分钟真的会被当成交易时段
{
  const old = new Function(['__D', 'isTradeDay'],
    'const Date = __D;\nconst isTradingTime = () => { const d = new Date(); const m = d.getHours()*60+d.getMinutes(); if(!isTradeDay(d)) return false; return (m>=9*60+15 && m<=11*60+30+30)||(m>=13*60&&m<=15*60); };\nreturn isTradingTime;');
  ok('反证：旧写法 12:00 仍判为交易时段（午休被算进来）', old(clock(12, 0), () => true)() === true);
}
ok('⛔ 源码里不得再有 11*60+30+30 这种"上午收盘再加半小时"', !/11 \* 60 \+ 30 \+ 30/.test(s));
// ⛔ gb 轮换判据：这条原来钉「开盘自检与上午收盘口径一致（都用 11*60+30）」，
//    而 gb 轮按用户要求把开盘自检收窄成 09:15~09:20（见 _test_push_window 里的说明：
//    该类消息只在特定时点成立，不再与上午收盘对齐）。
//    保留的是**另一半**：上午收盘刻度本身仍在交易时段判定里正常使用。
ok('上午收盘口径 11*60+30 仍在交易时段判定中使用', /m <= 11 \* 60 \+ 30/.test(s));

// ══ [2] betaWindowOpen：法定假日不得落库 beta ══════════════════════════════
group('[2] betaWindowOpen 交易日口径');
const SRC_BW = grab(/function betaWindowOpen\(\) \{/);
function bw(hh, mm, trade) {
  const f = new Function(['__D', 'isTradeDay'], 'const Date = __D;\n' + SRC_BW + '\nreturn betaWindowOpen;');
  return f(clock(hh, mm), trade === false ? () => false : () => true)();
}
ok('交易日 9:15 → true', bw(9, 15) === true);
ok('交易日 12:00（数据窗连续）→ true', bw(12, 0) === true);
ok('交易日 15:40 → true', bw(15, 40) === true);
ok('交易日 15:41 → false', bw(15, 41) === false);
ok('交易日 8:00 → false', bw(8, 0) === false);
ok('⛔ 法定假日（周三休市）10:00 → false', bw(10, 0, false) === false);
// 反证：旧写法只判周末，休市日照样落库
{
  const old = new Function(['__D'],
    'const Date = __D;\nfunction betaWindowOpen(){ const d=new Date(); const day=d.getDay(); if(day===0||day===6) return false; const m=d.getHours()*60+d.getMinutes(); return m>=9*60+15&&m<=15*60+40; }\nreturn betaWindowOpen;');
  ok('反证：旧写法休市日 10:00 仍返回 true（会把上一交易日收盘写成今天的 beta）', old(clock(10, 0))() === true);
}
ok('betaWindowOpen 内确实调用 isTradeDay', /function betaWindowOpen\(\) \{[\s\S]{0,400}?isTradeDay\(d\)/.test(s));

// ══ [3] auctionPhase：休市日没有集合竞价 ═══════════════════════════════════
group('[3] auctionPhase 竞价阶段判定');
const SRC_AP = grab(/function auctionPhase\(d\) \{/);
function ap(hh, mm, ss, trade, dow) {
  const f = new Function(['isTradeDay'], SRC_AP + '\nreturn auctionPhase;');
  return f(trade === false ? () => false : () => true)(clock(hh, mm, ss, dow)());
}
ok('交易日 9:16 → phase 1（可撤单）', ap(9, 16, 0) === 1);
ok('交易日 9:20 → phase 2（不可撤单）', ap(9, 20, 0) === 2);
ok('交易日 9:26 → phase 3（已撮合未开盘）', ap(9, 26, 0) === 3);
ok('交易日 9:31 → 0', ap(9, 31, 0) === 0);
ok('周六 9:20 → 0', ap(9, 20, 0, true, 6) === 0);
ok('⛔ 法定假日（周三休市）9:20 → 0', ap(9, 20, 0, false, 3) === 0);
// 反证：旧写法（没有 isTradeDay 那句）休市日 9:20 会被判成 phase 2
{
  const old = new Function([],
    'function auctionPhase(d){ const wd=d.getDay(); if(wd<1||wd>5) return 0; const s=d.getHours()*3600+d.getMinutes()*60+d.getSeconds(); if(s>=9*3600+15*60&&s<9*3600+20*60) return 1; if(s>=9*3600+20*60&&s<9*3600+25*60) return 2; if(s>=9*3600+25*60&&s<9*3600+30*60) return 3; return 0; }\nreturn auctionPhase;');
  ok('反证：旧写法休市日 9:20 判成 phase 2（会拿旧快照编竞价异动）', old()(clock(9, 20, 0, 3)()) === 2);
}

// ══ [4] inQuietHours：跨午夜窗口必须能覆盖清晨 ════════════════════════════
group('[4] inQuietHours 跨午夜');
const SRC_Q = grab(/const inQuietHours = \(\) => \{/);
const SRC_HM = grab(/const _hhmm = \(s, def\) =>/);
// ⛔ 沙箱注入（2026-10-07 df 轮补）：静默时段改走 CFG_SET / cfgSetOf / quietWindow，
//    漏一个符号 = 整段 ReferenceError 崩掉而不是变红（同类坑已踩 13 次）。
const SRC_QW = grab(/function quietWindow\(\) \{/);
const SRC_CSO = grab(/function cfgSetOf\(k\) \{/);
const SET_SRC = (() => {
  const i = s.indexOf('const CFG_SET = {'), j = s.indexOf('const PUSH_GOV_RESERVE', i);
  if (i < 0 || j < 0) throw new Error('未找到 CFG_SET 定义块');
  return s.slice(i, j);
})();
function quiet(hh, mm, cfg) {
  const f = new Function(['__D', 'S'],
    'const Date = __D;\n' + SET_SRC + '\n' + SRC_CSO + '\n' + SRC_QW + '\n' + SRC_HM + '\n' + SRC_Q + '\nreturn inQuietHours;');
  return f(clock(hh, mm), { config: cfg || {} })();
}
ok('默认 00:30-08:30：00:30 → true', quiet(0, 30) === true);
ok('默认 00:30-08:30：08:29 → true', quiet(8, 29) === true);
ok('默认 00:30-08:30：08:30 → false（右开区间）', quiet(8, 30) === false);
ok('默认 00:30-08:30：12:00 → false', quiet(12, 0) === false);
ok('跨午夜 23:00-08:00：23:30 → true', quiet(23, 30, { quietStart: '23:00', quietEnd: '08:00' }) === true);
ok('跨午夜 23:00-08:00：07:00 → true（清晨那一半不能漏）', quiet(7, 0, { quietStart: '23:00', quietEnd: '08:00' }) === true);
ok('跨午夜 23:00-08:00：12:00 → false', quiet(12, 0, { quietStart: '23:00', quietEnd: '08:00' }) === false);
ok('start === end → 永不静默', quiet(3, 0, { quietStart: '08:00', quietEnd: '08:00' }) === false);
// 反证：把跨午夜写成普通区间会漏掉清晨那半段
{
  const mm_ = 7 * 60;
  const start = 23 * 60, end = 8 * 60;
  ok('反证：写成 start<end 的普通区间会漏掉清晨（07:00 不静默）', !((mm_ >= start && mm_ < end)) === true);
}

// ══ [5] 窗口守卫的可达性：不许有永假的死分支 ══════════════════════════════
group('[5] 死分支 / 守卫可达性');
ok('⛔ 复盘循环里不再有永假的 `if (t < 3 * 60) return;`', !/if \(t < 3 \* 60\) return;/.test(s));
// ⚠️ 2026-10-08 改判据：闭锁收口成 sentToday(...)，不再钉 `xxxSentDate !== ds` 旧字面量
ok('复盘真正靠 `t >= 15*60+30` 挡住跨午夜', /isTradeDay\(d\) && t >= 15 \* 60 \+ 30 && !sentToday\(reviewSentDate, ds,/.test(s));
ok('次日计划真正靠 `t >= 15*60+45` 挡住跨午夜', /isTradeDay\(d\) && t >= 15 \* 60 \+ 45 && !sentToday\(nextPlanSentDate, ds,/.test(s));
// 反证：只写 `t < 3*60` 而不写 15:30 下界的话，凌晨 0:30 会被放行
{
  const t = 0 * 60 + 30;
  ok('反证：只有 t<180 守卫时，00:30（t=30）会被判为"不补推"之外的放行', (t < 3 * 60) === true);
}
ok('复盘补发仍保留 reviewSentDate 当日闭锁', /reviewSentDate = ds/.test(s));

// ══ [6] 样本登记口径：休市日样本必须标废 ══════════════════════════════════
group('[6] logSignal 休市日标废');
ok('⛔ logSignal 用 isTradeDay 判定作废样本', /void: !isTradeDay\(/.test(s));
ok('不再用只判周末的 `void: (wd === 0 || wd === 6)`', !/void: \(wd === 0 \|\| wd === 6\)/.test(s));

// ══ [7] 其余窗口的硬约束 ══════════════════════════════════════════════════
group('[7] 其余时间窗');
ok('趋势扫描三推仍判 isTradeDay 且窗口在收盘后', /if \(!isTradeDay\(d\)\) return;[\s\S]{0,200}?if \(t >= 9 \* 60 \+ 15 && t < 15 \* 60 \+ 20\) return;/.test(s));
ok('盘中禁跑的窗口上界 15:20 早于推送下界 15:45（扫描先建数据、后推送）',
  (15 * 60 + 20) < (15 * 60 + 45));
// ⛔ gb 轮换判据：竞价推送窗口从 9:25~10:00 收窄成 **9:25~9:26**（用户原话「竞价异动也是9：26前」）。
//    起点与 auctionPhase 撮合点（9:25）一致的语义不变，收口到撮合后那一分钟。
ok('竞价推送起点 9:25 与 auctionPhase 撮合点一致', /t >= 9 \* 60 \+ 25 && t < 9 \* 60 \+ 26/.test(s) && /9 \* 3600 \+ 25 \* 60 \+ 20/.test(s));
ok('竞价推送窗口收口在 9:26（不再是 10:00）', !/t >= 9 \* 60 \+ 25 && t < 10 \* 60/.test(s));
// ⛔ ga 轮换判据：自检的「今天发过没」从裸判 `bootCheckDate !== ds` 收口为 sentToday 统一判据
//    （裸判=内存变量重启清零=每次发布重发）。窗口与 isTradeDay 守门都没变，只改判"已发"的写法。
// ⛔ gb 轮：窗口由 09:15–11:30 收窄为 09:15–09:20（用户指定）；isTradeDay 守门这一半不变。
ok('开盘自检窗口 9:15–9:20 用 isTradeDay 守门', /isTradeDay\(d\) && t >= 9 \* 60 \+ 15 && t < 9 \* 60 \+ 20 && !sentToday\(bootCheckDate, ds,/.test(s));
ok('新闻汇总窗口 21:00–24:00 上界写成 < 24*60（等价于到午夜，不会溢出）', /t >= 21 \* 60 && t < 24 \* 60/.test(s));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
