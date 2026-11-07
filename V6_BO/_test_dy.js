// 守门：dy 轮 —— 补救动作的入口覆盖
// 工作记忆角度：「只有一半入口会走到的补救动作」
// 手动入口替自动入口「兜底」成功了，但 remedy 台账不知道 → 自动侧继续认为「还没补上」。
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// 按花括号配对取块（从锚点开始）
function blockFrom(anchor) {
  const i = SRC.indexOf(anchor);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
}

console.log('\n=== 补救动作入口覆盖（dy 轮）守门 ===\n');

// ---------- ① reviewBoot：手动补发也要留痕 ----------
console.log('【① reviewBoot（复盘重启补发）】');
const reviewBlk = blockFrom("if (p === '/api/review-digest'");
ok('存在 /api/review-digest 手动入口', reviewBlk.length > 200);
ok('⛔ 手动补发成功后登记 remedyDone(reviewBoot)',
  /remedyDone\('reviewBoot'/.test(reviewBlk),
  '手动补发完成但 remedy 台账仍显示「没补上」');
// ⛔ 2026-10-13 gn 轮改判据：置位的是【复盘数据日】_rdd，不是无条件 todayStr()。
//    开盘前/跨午夜补发覆盖的是上一交易日（reviewDataDay 口径）；若置 todayStr，
//    15:30 的自动复盘会被 pushedToday(/每日复盘/) 判「今天已发过」直接跳过
//    —— 补发一条，当天反而丢一条（10-12 00:01 新闻补发同款坑）。
ok('⛔ 手动补发成功后置位 reviewSentDate，且置的是覆盖日 _rdd（不是无条件 todayStr）',
  /reviewSentDate = _rdd;/.test(reviewBlk) && /const _rdd = /.test(reviewBlk),
  '闭锁必须跟着复盘数据日走，否则补发昨天的复盘会挡掉今天的自动复盘');
ok('覆盖日 ≠ 今天时消息首行带「📌 补发 · 数据日」标记',
  /'📌 补发 · 数据日 ' \+ _rdd/.test(reviewBlk));
ok('⛔ 手动补发失败时也登记 remedyDone(reviewBoot, {ok:false})',
  /remedyDone\('reviewBoot',\s*\{\s*ok:\s*false/.test(reviewBlk),
  '失败只进 catch/流水，remedy 不知道「这次机会用完了」');

// ---------- ② bootScan：手动扫描虽不等同启动首扫，但应留痕 ----------
console.log('\n【② bootScan（启动首扫）】');
const trendBlk = blockFrom("if (p === '/api/trend-scan'");
ok('存在 /api/trend-scan POST 手动入口', trendBlk.length > 200);
// ⛔ 注：bootScan 自动入口扫三个池（trend+steady+zpre），手动入口只扫 trend。
//    因此手动入口不应设 _bootScanDone（否则 steady/zpre 永不被扫），
//    但 remedy 仍应记录「趋势扫描已完成」，让台账知道手动兜底过。
ok('⛔ 手动扫描成功后登记 remedyDone(bootScan)',
  /remedyDone\('bootScan'/.test(trendBlk),
  '手动扫描完成但 remedy 台账仍显示「没补上」');
ok('手动扫描判了 running（不会重复启动）',
  /if \(r && r\.running\)/.test(trendBlk));

// ---------- ③ bootSeed：手动样本补录也要留痕 ----------
console.log('\n【③ bootSeed（启动补样本）】');
const learnBlk = blockFrom("if (p === '/api/learn-status'");
ok('存在 /api/learn-status 手动入口（含 seed 参数）', learnBlk.length > 200);
ok('⛔ 手动 seed 成功后登记 remedyDone(bootSeed)',
  /remedyDone\('bootSeed'/.test(learnBlk),
  '手动补样本完成但 remedy 台账仍显示「没补上」');
ok('手动 seed 失败时也登记 remedyDone(bootSeed, {ok:false})',
  /remedyDone\('bootSeed',\s*\{\s*ok:\s*false/.test(learnBlk),
  '失败只进 catch，remedy 不知道「这次机会用完了」');

// ---------- ④ klineBackfill：手动入口与自动入口共享状态 ----------
console.log('\n【④ klineBackfill（K线回填）】');
const kbfBlk = blockFrom("if (p === '/api/kline-backfill'");
ok('存在 /api/kline-backfill 手动入口', kbfBlk.length > 100);
// K线回填是日常无限循环任务，不属于「机会有限的补救」，不进 REMEDY_RULE 可接受。
// 但必须与自动入口共享同一套 busy 锁和进度对象。
ok('手动入口检查 _kbfBusy（共享 busy 锁）',
  /_kbfBusy/.test(kbfBlk),
  '手动和自动各用各的锁 → 并发写盘/重复补齐');

// ---------- ⑤ 反证：旧写法的危害 ----------
console.log('\n【⑤ 反证：手动成功但台账不知道的可观测量】');
// 场景：自动探测 30 次全失败了（bad=true），用户手动点了一下 /api/trend-scan，扫出来了。
// 旧写法：手动入口不碰 remedyDone → remedyState().bootScan 仍是 {ok:null, bad:true}
// 新写法期待：手动入口调 remedyDone('bootScan', {ok:true}, n) → remedyState().bootScan = {ok:true, n, bad:false}
ok('手动入口不把「running」当「完成」',
  !/remedyDone\('bootScan',\s*\{\s*running:\s*true/.test(trendBlk),
  '手动入口若把 running 当完成，等于「根本没启动却算补好了」');

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
