// 守门：占了模块日额度却没票可推 → 名额必须还回去（cx 轮 · 角度「说了两种结果、其实只有一种会被执行」）
//
// 模块日额度有两个出口：① **推了但发送失败** → 退回（2026-10-06 已修，pushAll 的 modDay 参数）
// ② **占了名额却一只票都没选出来** → 从来没退过。
// 第②条才是常态：盘中标的池稳定时连续几轮没有新增标的（或全被 60 分钟 / 2 小时去重挡掉），
// 每轮白扣一条；pool 一天就 4 条，几轮见底，之后真有票也被「本模块已达上限」拦下 ——
// 而 pushLog 只写"已达上限"，看不出是被自己空占掉的。
//
// 本套件把 modDayTake / modDayRelease / modDayKeepOrDrop 原样抠进沙箱**真跑**，
// 用"连跑 N 轮空结果"复现额度被吃光的过程，并用旧写法做反证。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('✓ ' + m); } else { fail++; console.log('✗ ' + m); } };

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });

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
    return body;
  }
  throw new Error('没找到: ' + re);
}
const S_TAKE = grab(/^function modDayTake\(/m);
const S_REL = grab(/^function modDayRelease\(/m);
const S_KOD = grab(/^function modDayKeepOrDrop\(/m);

// 沙箱依赖：MOD_DAY_CAP / MOD_DAY_DEFAULT / _modDay / savePushGov / todayStr
const CAP = { buzhang: 6, fastin: 8, similar: 6, bigmoney: 8, bigmoney_repeat: 4,
  pre: 4, pool: 4, trendsig: 4, ztprob: 6, auczt: 4, buzhang_repeat: 2, steadyup: 3,
  sector: 6, trend: 4 };
const MOD_DAY_DEFAULT = 12;
const _modDay = { day: '', n: {} };
let saveN = 0;
const savePushGov = () => { saveN++; };
const todayStr = () => '2026-10-07';

const F = new Function('MOD_DAY_CAP', 'MOD_DAY_DEFAULT', '_modDay', 'savePushGov', 'todayStr',
  S_TAKE + '\n' + S_REL + '\n' + S_KOD + '\n' +
  'return { modDayTake, modDayRelease, modDayKeepOrDrop };');
const M = F(CAP, MOD_DAY_DEFAULT, _modDay, savePushGov, todayStr);

console.log('=== 真跑：占了名额却没票 → 必须还回去 ===');
ok(M.modDayTake('pool') === true && _modDay.n.pool === 1, '① modDayTake 成功记账（pool=1）');
const kept = M.modDayKeepOrDrop('pool', [{ code: '000001' }]);
ok(Array.isArray(kept) && kept.length === 1 && _modDay.n.pool === 1,
  '② 有票可推 → 原样返回，名额留着（不该退）');
const dropped = M.modDayKeepOrDrop('pool', []);
ok(Array.isArray(dropped) && dropped.length === 0, '③ 没票 → 返回空数组（调用方照旧 `if (!x.length) return`）');
ok(_modDay.n.pool === 0, '④ 没票 → 刚占的名额已退回（pool 回到 0）');
ok(M.modDayKeepOrDrop('trend', null) !== null && Array.isArray(M.modDayKeepOrDrop('trend', null)),
  '⑤ 传 null / undefined 也不炸，且是数组（不能被当成"有票"）');

// ── 事故场景：连跑 N 轮"占了却没票" ────────────────────────────────
console.log('\n=== 事故场景：盘中连续多轮没有新增标的 ===');
function replay(rounds, wrap) {
  _modDay.day = ''; _modDay.n = {};
  let pushed = 0;
  for (let i = 0; i < rounds; i++) {
    if (!M.modDayTake('pool')) continue;                 // 额度已满 → 本轮连票都不筛
    const arr = [];                                       // 模拟 govFilter 一只都没放行
    const got = wrap ? M.modDayKeepOrDrop('pool', arr) : arr;   // ⛔ 反证：不包一层 = 旧写法
    if (got.length) pushed++;
  }
  return { left: 4 - (_modDay.n.pool || 0), used: _modDay.n.pool || 0 };
}
const old = replay(10, false);
ok(old.used === 4 && old.left === 0,
  `⑥ 反证：旧写法连跑 10 轮空 → pool 的 4 条额度**全被空占**（用掉 ${old.used}），真有票时已被"已达上限"拦下`);
const now = replay(10, true);
ok(now.used === 0 && now.left === 4,
  `⑦ 新写法连跑 10 轮空 → 额度一条没少（还剩 ${now.left}/4），真有票时照样推得出去`);

// ── 静态：五处出口都要接上收口 ─────────────────────────────────────
console.log('\n=== 五处接线 ===');
const used = [...SV.matchAll(/modDayKeepOrDrop\('(\w+)'/g)].map(m => m[1]);
for (const mod of ['sector', 'pool', 'trend', 'similar', 'pre']) {
  ok(used.includes(mod), `⑧ 模块 '${mod}' 的"没票"出口已接 modDayKeepOrDrop`);
}
ok(used.length === 5, `⑨ 恰好 5 处（新增同类出口要一并接上；实测 ${used.length}）`);

// ⑩ 每个 modDayTake 成功点，后面必须有一条"退"的路径：要么交给 pushAll 的 modDay，要么走收口
const takeSites = [...SV.matchAll(/if \(!modDayTake\('(\w+)'\)\)/g)].map(m => m[1]);
const ternary = [...SV.matchAll(/modDayTake\('(\w+)'\)\s*\?/g)].map(m => m[1]);
const allMods = new Set([...takeSites, ...ternary, ...used]);
let covered = 0;
for (const m of allMods) {
  const inPushAll = new RegExp("modDay: *'?" + m + "'?").test(SV);
  const inKeep = used.includes(m);
  if (inPushAll || inKeep) covered++;
}
ok(covered === allMods.size,
  `⑩ 所有占用模块（${[...allMods].join('/')}）都有退回路径：pushAll 的 modDay 或 modDayKeepOrDrop（${covered}/${allMods.size}）`);

// ⑪ 收口函数必须真的调 modDayRelease（别写成只返回空数组）
ok(/modDayRelease\(mod\)/.test(S_KOD), '⑪ modDayKeepOrDrop 内部必须真调 modDayRelease，不是只返回空数组');
// ⑫ 反证：把释放那行去掉，事故场景就该复现
const broken = S_KOD.replace(/modDayRelease\(mod\);/, '/* removed */;');
const F2 = new Function('MOD_DAY_CAP', 'MOD_DAY_DEFAULT', '_modDay', 'savePushGov', 'todayStr',
  S_TAKE + '\n' + S_REL + '\n' + broken + '\nreturn { modDayTake, modDayKeepOrDrop };');
const M2 = F2(CAP, MOD_DAY_DEFAULT, _modDay, savePushGov, todayStr);
_modDay.day = ''; _modDay.n = {};
for (let i = 0; i < 10; i++) { if (M2.modDayTake('pool')) M2.modDayKeepOrDrop('pool', []); }
ok((_modDay.n.pool || 0) === 4,
  `⑫ 反证：去掉释放那一行 → 额度照样被吃光（${_modDay.n.pool}/4），证明这条断言盯的是真东西`);

// ⑬ 只增不减的兜底：日切重置不能被动到（跨天清零是另一条规则，不许顺手改坏）
_modDay.day = '2026-10-06'; _modDay.n = { pool: 4 };
M.modDayTake('pool');
ok(_modDay.day === '2026-10-07' && _modDay.n.pool === 1, '⑬ 跨天自动清零仍在（没被这次改动改坏）');

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail ? 1 : 0);
