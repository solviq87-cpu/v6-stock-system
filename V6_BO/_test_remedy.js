// 守门：dw 轮 —— 补救动作的「完成」判据
// 以前「补救完成」的判据是「跑过了」而不是「补出来了」：被并发锁挡下（{running:true}）、
// 抛异常被 catch 吞掉、产出 0 条 —— 三种情况全都算完成，有限的机会立刻归零，且一个字都不说。
// 最典型的分叉：同一个 scanTrendUniverse，手动入口 /api/scan-trend 判了 r.running，
// 启动首扫那条路却把返回值赋给 `const r` 后再没看过。
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// 按花括号配对取函数体（⛔ 不许固定字符窗口）
function grab(startRe) {
  const i = SRC.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
// 取一整段「登记表 + 出口」（REMEDY_RULE 起到 _empCache 之前）
const b0 = SRC.indexOf('const REMEDY_RULE = {');
const b1 = SRC.indexOf('let _empCache = { t: 0, map: {}, done: false };');
const BLOCK = (b0 > 0 && b1 > b0) ? SRC.slice(b0, b1) : '';

console.log('\n=== 补救动作的完成判据（dw 轮）守门 ===\n');

// ---------- ① 登记表 ----------
console.log('【① 补救动作必须登记】');
ok('存在 REMEDY_RULE 登记表', /const REMEDY_RULE = \{/.test(SRC));
ok('存在 REMEDY_WHY（补失败有几种说法）', /const REMEDY_WHY = \{/.test(SRC));
ok('存在 REMEDY_SKIP（这次机会被跳过的原因）', /const REMEDY_SKIP = \{/.test(SRC));
ok('存在唯一出口 remedyDone', /function remedyDone\(name, r, outN\)/.test(SRC));
ok('存在 remedySkip（补救跳过要留痕）', /function remedySkip\(name, why\)/.test(SRC));
ok('存在 remedyState（交出去）', /function remedyState\(\)/.test(SRC));
ok('启动首扫登记了机会数 30', /bootScan:\s*\{ tries: 30/.test(SRC));
ok('复盘重启补发登记了机会数 2', /reviewBoot:\s*\{ tries: 2/.test(SRC));

// ---------- ② 判据：沙箱真跑 ----------
console.log('\n【② 「跑过」≠「补好了」（沙箱真跑）】');
ok('抽出补救区块', BLOCK.length > 500, String(BLOCK.length));
const errs = [];
const mk = () => {
  const f = new Function('console', BLOCK + '\n; return { remedyDone, remedySkip, remedyState, remedyNote, remedyWhyOf, REMEDY_RULE };');
  return f({ error: m => errs.push(String(m)), warn: () => {}, log: () => {} });
};
const A = mk();
ok('正常跑出 12 条 → 算补好了', A.remedyDone('bootScan', { ok: true }, 12) === true);
ok('  …且不留 why', A.remedyState().bootScan.why === '', A.remedyState().bootScan.why);
{
  const B = mk();
  ok('⛔ 被并发锁挡下（running:true）→ 不算完成', B.remedyDone('bootScan', { running: true }, 7) === false);
  const st = B.remedyState().bootScan;
  ok('  …且说清是被并发锁挡下（本次根本没启动）', st.why === 'busy' && /根本没启动/.test(st.whyLabel), st.whyLabel);
  ok('  …机会已消耗 1 次，还剩 29', st.used === 1 && st.left === 29, st.used + '/' + st.left);
  ok('  …bad=true（补救确实没补上，应提醒）', st.bad === true, String(st.bad));
}
{
  const C = mk();
  ok('⛔ 返回 ok:false（出错/未就绪）→ 不算完成', C.remedyDone('bootScan', { ok: false, error: '学习库为空' }, 0) === false);
  ok('  …why = err', C.remedyState().bootScan.why === 'err', C.remedyState().bootScan.why);
}
{
  const D = mk();
  ok('⛔ 调用方连返回值都没有 → 不算完成', D.remedyDone('bootScan', null, 5) === false);
  ok('  …why = noRet（无从判断补没补上）', D.remedyState().bootScan.why === 'noRet', D.remedyState().bootScan.why);
}
{
  const E = mk();
  // ⛔ 关键区分：跑完了但 0 条 —— 算「跑过」（不再重试，免得把 K 线缓存白扫 30 遍），但必须留痕
  ok('⛔ 跑完了但 0 条 → 算跑完（不再重试）', E.remedyDone('bootScan', { ok: true }, 0) === true);
  ok('  …但必须留痕 why=zero', E.remedyState().bootScan.why === 'zero', E.remedyState().bootScan.why);
  ok('  …note 里写明「0 条」', /0 条/.test(E.remedyNote('bootScan')), E.remedyNote('bootScan'));
}
{
  const F = mk();
  const n0 = errs.length;
  ok('⛔ 未登记的补救名 → 丢弃并返回 false', F.remedyDone('nope', { ok: true }, 1) === false);
  ok('⛔ 未登记的跳过原因 → 丢弃并返回 0', F.remedySkip('bootScan', 'nopeWhy') === 0);
  ok('  …且都报了错（不是静默）', errs.length - n0 >= 2, String(errs.length - n0));
}
{
  const G = mk();
  G.remedySkip('reviewBoot', 'reviewNoPool');
  const st = G.remedyState().reviewBoot;
  ok('补救跳过要留原因（涨停池为空 = 数据没回来）', st.why === 'reviewNoPool' && /数据没回来/.test(st.whyLabel), st.whyLabel);
  ok('  …机会 1/2，剩 1', st.used === 1 && st.left === 1, st.used + '/' + st.left);
  ok('  …数据缺口跳过一次，机会还没尽 → 暂不判失败（bad=false）', st.bad === false, String(st.bad));
  G.remedySkip('reviewBoot', 'reviewBusy');
  ok('  …再跳一次 → 机会用尽（left=0）', G.remedyState().reviewBoot.left === 0);
  ok('  …ok=null（是「跳过」不是「失败」）', G.remedyState().reviewBoot.ok === null);
  ok('⛔ …卡在数据缺口且机会已尽 → bad=true（今天复盘没补上）', G.remedyState().reviewBoot.bad === true);
}
{
  const H = mk();
  // 反例：休市日两次都按设计跳过 → 不算补救失败（bad=false），别在国庆假期弹「补救未成」
  H.remedySkip('reviewBoot', 'reviewNotTrade');
  H.remedySkip('reviewBoot', 'reviewNotTrade');
  ok('⛔ 休市日按设计跳过、机会用尽 → bad=false（不该弹）', H.remedyState().reviewBoot.bad === false);
}
{
  const I = mk();
  I.remedyDone('reviewBoot', { ok: true }, 12);
  const st = I.remedyState().reviewBoot;
  ok('补发成功要登记（remedyState 分得清「成了」）', st.ok === true && st.n === 12 && st.bad === false, st.ok + '/' + st.n);
}

// ---------- ③ 反证：旧写法把「跑过」当「补好了」 ----------
console.log('\n【③ 反证：旧写法的可观测量差异】');
const oldDecide = () => true;                       // 旧：catch 之后无条件 `_bootScanDone = true`
const newDecide = (rs, out) => {
  const agg = rs.some(x => x && x.running) ? { running: true }
    : (rs.some(x => x && x.ok === false) ? { ok: false, error: (rs.filter(x => x && x.error)[0] || {}).error } : { ok: true });
  return mk().remedyDone('bootScan', agg, out);
};
ok('反证：撞上并发锁时旧写法照样宣告完成', oldDecide() === true);
ok('⛔ 新写法：撞上并发锁时不算完成（保留机会）', newDecide([{ running: true }], 0) === false);
ok('⛔ 新写法：抛异常时不算完成', newDecide([{ ok: false, error: 'boom' }], 0) === false);
ok('新写法：真扫出来了才算完成', newDecide([{ ok: true }, { ok: true }, { ok: true }], 25) === true);

// ---------- ④ 接线 ----------
console.log('\n【④ 接线：两个入口都得判】');
const bs0 = SRC.indexOf('const _bootScan = () => {');
const bs1 = SRC.indexOf('const _bootScanTimer = setInterval(');
const bootBody = (bs0 > 0 && bs1 > bs0) ? SRC.slice(bs0, bs1) : '';
ok('取到 _bootScan', bootBody.length > 200, String(bootBody.length));
ok('⛔ 启动首扫的完成判定走 remedyDone（不再无条件置位）',
  /if \(remedyDone\('bootScan', _agg, _out\)\) _bootScanDone = true;/.test(bootBody));
ok('⛔ 源码里不再有 catch 之后的裸 `_bootScanDone = true;`',
  !/^\s*_bootScanDone = true;\s*$/m.test(bootBody));
ok('启动首扫把三路返回值都收进 _rs（不再赋给 const r 就丢掉）',
  /_rs\.push\(r, rs\)/.test(bootBody) && /_rs\.push\(rz\)/.test(bootBody));
ok('手动入口 /api/scan-trend 判了 r.running（两入口同口径）', /if \(r && r\.running\)/.test(SRC));

const rs0 = SRC.indexOf('const _reviewStartupCheck = () => {');
const rs1 = SRC.indexOf('setTimeout(_reviewStartupCheck,');
const revBody = (rs0 > 0 && rs1 > rs0) ? SRC.slice(rs0, rs1) : '';
ok('取到 _reviewStartupCheck', revBody.length > 300, String(revBody.length));
{
  const rets = (revBody.match(/return;/g) || []).length;
  const skips = (revBody.match(/remedySkip\('reviewBoot'/g) || []).length;
  ok('⛔ 复盘启动补发 5 个静默 return 全部带留痕', rets === 6 && skips === 6, 'return=' + rets + ' skip=' + skips);
  ok('  …休市日与「数据没回来」分开登记（不是同一个 why）',
    /reviewNotTrade/.test(revBody) && /reviewNoPool/.test(revBody));
}
ok('启动补样本补 0 条也留痕', /remedyDone\('bootSeed', \{ ok: true \}, \(r && r\.added\) \|\| 0\)/.test(SRC));
ok('⛔ 启动补样本抛异常也登记补救失败（catch 不再只 console.error）',
  /catch \(e\) \{ console\.error\('\[learn\] 启动补样本失败:', e && e\.message\); remedyDone\('bootSeed', \{ ok: false, error: e && e\.message \}, 0\); \}/.test(SRC));
ok('复盘补发成功也登记（remedyState 分得清「成了」）', /remedyDone\('reviewBoot', \{ ok: true \}, it\.length\)/.test(SRC));
ok('⛔ 复盘算出 0 条也登记（跑完了但 0 条，留痕告警）', /remedyDone\('reviewBoot', \{ ok: true \}, 0\)/.test(SRC));
ok('/api/state 下发 remedy', /remedy: remedyState\(\),/.test(SRC));
ok('前端读了 s.remedy', /const rm = s\.remedy \|\| \{\};/.test(HTML));
ok('⛔ 前端直接读服务端算好的 bad（不再自己拼 ok/why 过滤，防漏数据缺口跳过）', /rm\[k\] \&\& rm\[k\]\.bad/.test(HTML));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
