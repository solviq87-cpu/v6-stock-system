/**
 * 守门测试：复盘链路加固（2026-10-28）—— 六个「会静默丢掉一整条复盘」的坑
 *
 * 病根共性：复盘是每天必达的那一条，而下面每一处都能让它【静默消失】——
 *   定时器只 console.error 一句、用户手机上什么都没有，且当天再也不会重试。
 *
 *   ① pct 缺失 → `z.pct.toFixed(1)` 抛 TypeError → 整轮 _computeReviewInner 当场中断，当天复盘全丢
 *   ② prob 缺失 → 比较器返回 NaN 被当成 0 → items 排序整体失效（复盘正是按次日涨停概率降序给人看的）
 *   ③ review.json 落盘失败 → 异常打断后面紧接的三条推送（pushYiEr / pushLianbanRelay / 好标的挖掘）
 *   ④ reviewTries 从不按交易日重置 → 前一日耗尽额度后，次日「数据源没回来 ≠ 今天真没涨停」这条防护跨天失效
 *   ⑤ 手动补发用 reviewIsStale()（date≠今天）当闸门 → 「📌 补发 · 数据日 X」分支永远不可达（盘前/跨午夜补发实为死代码）
 *   ⑥ 手动补发只判 held 仍不够 → computeReview 因 _crBusy 直接返回旧 S.review、或中途抛错被吞掉时，
 *      旧内容会被当成今天发出去（判据补 _crErr + 归属日对齐 _rvMisaligned）
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// 剥注释取真实代码（与 _test_review_empty.js / _test_review_dedup.js 同口径）
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 复盘链路加固守门（六处「静默丢复盘」的坑）===\n');

/* ───────────────── ① pct 缺失不许抛错 ───────────────── */
console.log('【① 涨停股 pct 缺失时不许抛 TypeError（抛了当天整条复盘就没了）】');
ok(!/z\.pct\.toFixed\(/.test(SRC), '全文件已无裸写的 `z.pct.toFixed(...)`（复盘 items + 一进二 + 连板三处都改掉了）');
ok((SRC.match(/pct: \(z\.pct != null && isFinite\(Number\(z\.pct\)\)\)/g) || []).length >= 3,
  '三处构建器都走同一套空值安全写法（缺一处就等于留一个炸点）');
const _pctExpr = (SRC.match(/\(z\.pct != null && isFinite\(Number\(z\.pct\)\)\) \? \+Number\(z\.pct\)\.toFixed\(1\) : null/) || [''])[0];
ok(!!_pctExpr, '能取到 pct 的空值安全表达式');
if (_pctExpr) {
  const pctOf = new Function('z', 'return (' + _pctExpr + ');');
  ok(pctOf({ pct: 3.14159 }) === 3.1, '动态：pct=3.14159 → 3.1（正常四舍五入到 1 位）');
  ok(pctOf({ pct: '5.55' }) === 5.5, '动态：字符串 "5.55" → 5.5（接口给字符串也吃得下；5.55 二进制浮点本就舍到 5.5）');
  ok(pctOf({ pct: 0 }) === 0, '动态：pct=0 → 0（判得出的 0 就是 0，不当缺失）');
  ok(pctOf({ pct: null }) === null, '动态：pct=null → null（判不出就显式 null，不拿 0 冒充）');
  ok(pctOf({}) === null, '动态：pct 缺失 → null（原来这里直接 TypeError）');
  ok(pctOf({ pct: 'abc' }) === null, '动态：pct 非数字 → null（不硬判）');
  // 病根实证：旧写法在这组输入下必抛
  let threw = false;
  try { +({}).pct.toFixed(1); } catch (e) { threw = true; }
  ok(threw, '病根实证：旧写法 `+z.pct.toFixed(1)` 在 pct 缺失时确实抛 TypeError');
}

/* ───────────────── ② prob 缺失不许毁掉排序 ───────────────── */
console.log('\n【② 拿 null 概率排序不许退化为未排序】');
ok(!/items\.sort\(\(a, b\) => b\.prob - a\.prob\)/.test(SRC), '旧的裸减法比较器已消除');
const _sortExpr = (SRC.match(/\(Number\(b\.prob\) \|\| 0\) - \(Number\(a\.prob\) \|\| 0\)/) || [''])[0];
ok(!!_sortExpr, '能取到排序比较器的空值安全表达式');
if (_sortExpr) {
  const cmp = new Function('a', 'b', 'return (' + _sortExpr + ');');
  const arr = [{ n: 'A', prob: null }, { n: 'B', prob: 80 }, { n: 'C', prob: 50 }, { n: 'D', prob: undefined }];
  const got = arr.slice().sort((a, b) => cmp(a, b)).map(x => x.n).join('');
  ok(got === 'BCAD', '动态：null/undefined 概率不参与捣乱，真概率按降序在前（期望 BCAD，实得 ' + got + '）');
  // 病根实证：旧比较器遇到 undefined 返回 NaN（null 会被隐式转 0，所以真正致命的是 undefined）
  ok(Number.isNaN(undefined - 80), '病根实证：旧比较器 b.prob-a.prob 遇到 undefined 返回 NaN（比较器返回 NaN 被当 0，排序整体失效）');
}

/* ───────────────── ③ 落盘失败不许吞掉后续推送 ───────────────── */
console.log('\n【③ review.json 落盘失败不许打断后续三条推送】');
const _awBlock = (SV.match(/try \{ atomicWrite\(path\.join\(__dirname, 'review\.json'\)[\s\S]{0,320}?catch \(e\) \{[^\n]*\}/) || [''])[0];
ok(!!_awBlock, '能取到落盘段（try/catch 包住 atomicWrite）');
ok(/catch \(e\) \{[^}]*console\.error\('\[复盘\] review\.json 落盘失败/.test(SV),
  '落盘失败有明确留痕（console.error 里点明「内存已更新，重启将丢失」）');
ok(!!_awBlock && !/throw/.test(_awBlock), '落盘失败只留痕、不再向上抛（后面三条推送照常发）');

/* ───────────────── ④ reviewTries 必须按交易日归零 ───────────────── */
console.log('\n【④ 重试额度必须按交易日重置（不许跨天累积）】');
ok(/let reviewBusy = false, reviewTries = 0, _rtDay = '';/.test(SRC), '已引入 _rtDay 记录"额度属于哪一天"');
const _rtStmt = (SRC.match(/if \(_rtDay !== ds\) \{ _rtDay = ds; reviewTries = 0; \}/) || [''])[0];
ok(!!_rtStmt, '能取到换日归零语句');
if (_rtStmt) {
  const run = new Function('rtIn', 'dayIn', 'ds',
    'let reviewTries = rtIn; let _rtDay = dayIn;' + _rtStmt + ' return { tries: reviewTries, day: _rtDay };');
  const a = run(5, '20261027', '20261027');
  ok(a.tries === 5 && a.day === '20261027', '动态：同一交易日内不重置（额度不被中途刷回）');
  const b = run(5, '20261027', '20261028');
  ok(b.tries === 0 && b.day === '20261028', '动态：换交易日 → 额度归零（次日重试机会独立）');
  const c = run(0, '', '20261028');
  ok(c.tries === 0 && c.day === '20261028', '动态：首次进入（_rtDay 为空）→ 正确记下当天');
}

/* ───────────────── ⑤⑥ 手动补发的闸门语义 ───────────────── */
console.log('\n【⑤⑥ 手动补发：📌 补发分支必须可达，且旧内容不许顶包】');
ok(/const _rdd = \(typeof reviewDataDay === 'function'\) \? reviewDataDay\(\) : todayStr\(\);/.test(SRC),
  '📌 前缀仍按 reviewDataDay() 取"该发的数据日"');
ok(/'📌 补发 · 数据日 ' \+ _rdd/.test(SRC), '「📌 补发 · 数据日 X」消息分支仍然存在');
ok(!/if \(reviewIsStale\(\)\) \{\s*pushLog\('⏳ 复盘数据未就绪/.test(SRC),
  '手动补发已不再用 reviewIsStale()（否则上面那条分支永远走不到）');
ok(/let _crErr = '';/.test(SRC) && /_crErr = \(e && e\.message\) \|\| String\(e\)/.test(SRC),
  'computeReview 抛错被记进 _crErr（不再只是 console.error 后就往下走）');

const _gateSrc = (SRC.match(/const _rvStale = \(typeof staleOf === 'function'\)[\s\S]{0,700}?const _rvMisaligned = [^\n]*;/) || [''])[0];
ok(!!_gateSrc, '能取到手动补发的闸门判据（_rvStale/_rvDate/_rdd0/_rvMisaligned）');
if (_gateSrc) {
  const gate = new Function('S', 'staleOf', 'reviewDataDay', 'todayStr', '_crErr',
    _gateSrc + '\nreturn (_crErr || _rvStale === "held" || !_rvDate || _rvMisaligned);');
  const T = '20261028', Y = '20261027';
  const mk = o => gate({ review: o.date === undefined ? null : { date: o.date } },
    () => o.stale || '', () => o.rdd, () => T, o.err || '');
  ok(mk({ date: Y, stale: 'fresh', rdd: Y, err: '' }) === false,
    '盘前/跨午夜补发上一交易日：fresh + 归属日对上 → 放行（📌 分支可达，原判据在这里必拦）');
  ok(mk({ date: T, stale: 'fresh', rdd: T, err: '' }) === false, '收盘后补发当天：放行');
  ok(mk({ date: T, stale: 'fresh', rdd: Y, err: '' }) === false,
    '盘中重算（内容已是今天的，reviewDataDay 仍指上一交易日）：放行，不被误杀');
  ok(mk({ date: Y, stale: 'held', rdd: Y, err: '' }) === true, '沿用旧档 held → 拦（数据没回来不冒充）');
  ok(mk({ date: undefined, stale: '', rdd: T, err: '' }) === true, '无归属日 → 拦');
  ok(mk({ date: '20261020', stale: 'fresh', rdd: T, err: '' }) === true,
    '归属日 8 天前对不上 → 拦（旧内容绝不冒充今天）');
  ok(!!mk({ date: T, stale: 'fresh', rdd: T, err: 'K线超时' }) === true, '本轮计算失败(_crErr) → 拦（不用旧内容顶包）');
  ok(mk({ date: Y, stale: 'empty', rdd: Y, err: '' }) === false,
    '确认空(empty)且有归属日 → 放行（"今日无涨停"是结论不是缺失）');
}

/* ───────────────── ⑦ 好标的挖掘：先发后置位 + 兜底不静默 ───────────────── */
console.log('\n【⑦ 好标的挖掘推送：先发后置位、失败不许静默】');
ok(/if \(pushAll\(msg, false, \{ private: true \}\) !== false\) S\.reviewGoodPushedDate = todayStr\(\);/.test(SRC),
  '当日闭锁按 pushAll 返回值置位（原来写在 pushAll 之前 → 被拦下也判"已发"，当天永久消失）');
ok(!/S\.reviewGoodPushedDate = todayStr\(\);\s*\n\s*const inf = v =>/.test(SRC),
  '旧的"先置位后发送"顺序已消除');
ok(/console\.error\('\[复盘\] 好标的挖掘推送失败/.test(SV),
  '该段兜底有留痕（原来裸 catch {} 静默吞掉，用户少一条、日志一个字都没有）');
ok(!/\n  \} catch \{\}\n\}\s*\n\n\/\/ ---------------- 一进二模块/.test(SV),
  '复盘主函数尾部不再是裸 catch {}');

console.log('\n合计 ' + (pass + fail) + ' 项：通过 ' + pass + '、失败 ' + fail);
process.exit(fail ? 1 : 0);
