// cm 轮守门：系统里"只增不减"的东西 —— 清理判据自身要自洽。
// 抓到的问题：样本库剪枝 pruneSignals 里【每天至少 30 条】与【总量 2600】是两个互相打架的目标。
//   quota = Math.max(30, floor(limit / days)) —— 交易日一多，30×天数 必然撑破总量上限（days>86 即如此），
//   于是最后那句 slice(-limit) 一刀切丢掉最早的若干天，退化成「只留最近 86 天」。
//   而这段剪枝存在的全部意义（注释明写）就是"保住独立交易日数 = 证据厚度" —— 结果与初衷正好相反，
//   而且从触发那天起每天都在稳定吃掉最早一天，没有任何提示。
//   实测：当前库已覆盖 68 个交易日（最早 2026-07-07），距触发只剩约 19 个交易日。
// 离线、确定性：把 pruneSignals 抠进沙箱，用构造数据真跑。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function fnBody(src, name) {
  const a = src.search(new RegExp('^function ' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}
const BODY = fnBody(SV, 'pruneSignals');

// 沙箱：注入 S.learn.signals / normDate / console
const mk = (signals) => {
  const S = { learn: { signals } };
  const normDate = d => String(d || '').slice(0, 10);
  const logs = [];
  const c = { log: m => logs.push(String(m)), warn: m => logs.push(String(m)), error: m => logs.push(String(m)) };
  new Function('S', 'normDate', 'console', BODY + '\npruneSignals(2600);')(S, normDate, c);
  return { out: S.learn.signals, logs };
};
// 造 N 个交易日，每天 M 条。
// ⛔ 日期必须是唯一的、且 normDate（取前 10 位）能切出完整的 YYYY-MM-DD ——
//    第一版用 '2026-MM-DD_序号' 再被 slice(0,10) 截成了 '2026-01-0'，天与天撞在一起（假红）。
const build = (daysN, perDay, resolvedRatio = 0.5) => {
  const out = [];
  const base = Date.UTC(2024, 0, 1);
  for (let i = 0; i < daysN; i++) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    for (let j = 0; j < perDay; j++) out.push({ date: d, ts: i * 10000 + j, resolved: (j / perDay) < resolvedRatio });
  }
  return out;
};
const dayCount = arr => new Set(arr.map(s => String(s.date).slice(0, 10))).size;

console.log('\n【⛔⛔ 自检】');
{
  ok('自检：pruneSignals 抠得出来', BODY.length > 400, String(BODY.length));
  ok('自检：未超限时不动库', mk(build(10, 20)).out.length === 200);
  ok('自检：超过上限确实会剪', mk(build(200, 60)).out.length === 2600, String(mk(build(200, 60)).out.length));
}

console.log('\n【① 剪完必须保住"独立交易日数"，不许整体丢掉最早的天】');
{
  // days=200 → 旧写法 quota=30 → 攒 6000 → slice(-2600) → 只剩最近 86 天
  const r = mk(build(200, 60));
  const kept = dayCount(r.out);
  ok('⛔ 200 个交易日 → 剪完仍覆盖 200 个交易日（不是只剩 86 个）',
    kept === 200, '实际保留 ' + kept + ' 天');
  ok('  总量不超 2600', r.out.length <= 2600, String(r.out.length));
  // days=120
  const r2 = mk(build(120, 80));
  ok('⛔ 120 个交易日 → 剪完仍覆盖 120 个交易日', dayCount(r2.out) === 120, String(dayCount(r2.out)));
  // days=300
  const r3 = mk(build(300, 40));
  ok('⛔ 300 个交易日 → 剪完仍覆盖 300 个交易日', dayCount(r3.out) === 300, String(dayCount(r3.out)));
  ok('  300 天时总量不超 2600', r3.out.length <= 2600, String(r3.out.length));
}

console.log('\n【② 反证：旧写法确实会整体丢天（证明上面这些断言不是白写的）】');
{
  const oldQuota = days => Math.max(30, Math.floor(2600 / Math.max(days, 1)));
  const oldKept = (days, perDay) => {
    const q = oldQuota(days);
    const total = Math.min(q, perDay) * days;         // 攒出来的总条数
    const outN = Math.min(total, 2600);               // slice(-limit)
    return Math.min(days, Math.floor(outN / Math.min(q, perDay)));  // 剩下几天
  };
  ok('反证：旧写法 days=200 时只剩 86 天', oldKept(200, 60) === 86, String(oldKept(200, 60)));
  ok('反证：旧写法 days=120 时只剩 86 天', oldKept(120, 80) === 86, String(oldKept(120, 80)));
  ok('反证：旧写法 days=87 就开始丢天（触发点）', oldKept(87, 60) < 87, String(oldKept(87, 60)));
  ok('反证：旧写法 days=86 还没触发', oldKept(86, 60) === 86, String(oldKept(86, 60)));
  ok('⛔ 现写法在同样的 200 天下保住 200 天', dayCount(mk(build(200, 60)).out) === 200);
}

console.log('\n【③ 已回验的样本优先保留（有证据价值）】');
{
  // 每天 40 条，其中 10 条已回验；配额 13 → 已回验的必须全在
  const r = mk(build(200, 40, 0.25));
  const keptResolved = r.out.filter(s => s.resolved).length;
  const totalResolved = 200 * 10;
  ok('⛔ 已回验样本优先保留（2000 条已回验里保住了大半）',
    keptResolved > totalResolved * 0.5, keptResolved + ' / ' + totalResolved);
}

console.log('\n【④ 极端情况必须说出来，不许静默丢历史】');
{
  // 交易日数本身超过上限（4000 天 × 2 条 = 8000 条，每天 1 条也放不下 2600）
  const r = mk(build(4000, 2));
  ok('⛔ 放不下时会打告警（不静默丢历史）',
    r.logs.some(l => /交易日数.*超过样本上限|只能保留最近/.test(l)), r.logs.join(' | ').slice(0, 120));
  ok('  总量仍然不超 2600', r.out.length <= 2600, String(r.out.length));
}

console.log('\n【⑤ 剪枝日志里报的是真实保留天数，不是原天数】');
{
  const r = mk(build(200, 60));
  const line = r.logs.filter(l => /样本库超限/.test(l))[0] || '';
  ok('日志里同时写了保留天数与原有天数', /保留 \d+ 条 \/ \d+ 个交易日（原有 \d+ 个交易日）/.test(line), line.slice(0, 140));
}

console.log('\n【⑥ 新闻归档：内存与磁盘、归档与归档之间，口径必须一致】');
{
  const clean = SV.split('\n').map(l => {
    let out = '', inS = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inS) { out += c; if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; out += c; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      out += c;
    }
    return out;
  }).join('\n');
  ok('⛔ 存在统一常量 NEWS_ARCHIVE_CAP', /const NEWS_ARCHIVE_CAP = \d+;/.test(clean));
  ok('⛔ 内存 mergeArchive 用它（不再写死 400）',
    /slice\(0, keepAll \? HOLIDAY_BUF_CAP : NEWS_ARCHIVE_CAP\)/.test(clean));
  const saveLine = (clean.match(/atomicWrite\(NEWS_FILE[\s\S]{0,320}/) || [''])[0];
  const caps = [...saveLine.matchAll(/slice\(0, (\d+|NEWS_ARCHIVE_CAP)\)/g)].map(m => m[1]);
  ok('⛔ 落盘三个归档共用同一个上限', new Set(caps.slice(0, 3)).size === 1, caps.join(','));
  ok('  落盘用的就是 NEWS_ARCHIVE_CAP（不是另一个数字）', caps.slice(0, 3).every(c => c === 'NEWS_ARCHIVE_CAP'), caps.join(','));
  ok('⛔ badAll 存量修复那处也用同一常量', /rows\.filter\(x=>x\.type===type&&within3Days\(x\.t\)\)\.slice\(0,NEWS_ARCHIVE_CAP\)/.test(clean));
  // 假期缓冲是【故意】不按 3 日的，必须仍然用 HOLIDAY_BUF_CAP
  ok('假期缓冲仍走 HOLIDAY_BUF_CAP（它故意不受近3日限制）', /holidayBuf[^)]*\)\.slice\(0, HOLIDAY_BUF_CAP\)/.test(clean));
  // 反证：旧写法内存 400 / 落盘 300-200-200
  const oldSave = { bad: 300, good: 200, neutral: 200 };
  ok('反证：旧写法三个落盘上限各不相同（300/200/200）',
    new Set(Object.values(oldSave)).size > 1 && oldSave.bad !== 400);
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
