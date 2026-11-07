// 守门 · do 轮：/api/state 里「截断下发的数组」必须同时下发真实总数
//   上一轮（dn）收的是「同一件事两个名字」—— 面板读 items.length / count / cand，
//   任务状态读 n，同一个池的条数被数了两遍。补发时又发现「本轮产出」与「池里存了几条」
//   是两个量（ztpre 4612/20、trendScan 2289/30、steadyUp 66/12），加了 OUT_SHOWN。
//   但那套只覆盖了 taskSet 登记的 10 个池 —— **/api/state 里还有一批数组是截断后才下发的**，
//   它们的真实总数压根没下发：
//     trendPool: (S.trendPool || []).slice(0, 50)   ← S.trendPool 是无上限 push 出来的
//     sectors / ztTopics / learnHistory / smallyang.items(slice(0,15))
//   于是**同一个键名在后端是完整池、在接口里是截断快照**，两个值共用一个名字；
//   面板却直接拿截断后的 .length 当真实总数报：`共 ${s.trendPool.length} 只`
//   —— 池里 60 只时也只说 50 只，而且一声不吭。（精选池没这问题：它有独立的 poolSize。）
//   修法：STATE_CUT 登记表（cap 上限 + total 真实总数来源）+ stateCut() 唯一出口
//        + 前端 cutN/cutShown 只读它，poolCut 在截断时明写「列出前 M 只」。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

const EMPTY_SRC = cut(SV, 'const EMPTY_WHY = {', 'const PUSH_DONE = {');
const OUT_SRC = cut(SV, 'const OUT_N = {', '// ─── 「失败」的说法登记表');
const mk = (S) => new Function('console', 'S', '_zpProg', '_tsProg', '_kbfProg',
  EMPTY_SRC + '\n' + OUT_SRC +
  '\nreturn { OUT_N, OUT_SHOWN, outN, outNShown, outNState, STATE_CUT, stateCut };'
)({ error: () => {}, log: () => {} }, S, undefined, undefined, undefined);

// ════════ 【A】登记表 ════════
console.log('【A】STATE_CUT：截断下发的数组必须登记上限与真实总数来源');
{
  const F = mk(undefined);
  const ks = Object.keys(F.STATE_CUT);
  ok('登记表非空', ks.length >= 5, String(ks.length));
  for (const k of ks) {
    const d = F.STATE_CUT[k];
    ok(k + ' 有中文名', typeof d.label === 'string' && d.label.length > 0);
    ok(k + ' 有上限 cap（数字）', typeof d.cap === 'number');
    ok(k + ' 有总数来源 total（函数）', typeof d.total === 'function');
    ok(k + ' 的 cap 非负', d.cap >= 0, String(d.cap));
  }
  // 会咬人的那一个必须在表里
  ok('⛔ 趋势票池已登记（无上限 push、接口却 slice(0,50)）', !!F.STATE_CUT.trendPool);
  ok('趋势票池上限=50，与 /api/state 的 slice 一致', F.STATE_CUT.trendPool.cap === 50);
  ok('/api/state 确有 slice(0, 50)', /trendPool:\s*\(S\.trendPool \|\| \[\]\)\.slice\(0,\s*50\)/.test(SV));
}

// ════════ 【B】stateCut：total 是真实总数，shown 是实际列出 ════════
console.log('【B】stateCut：总数与列出数是两个量，且都算得对');
{
  const S = { trendPool: new Array(60), sectors: new Array(35), ztTopics: new Array(8),
              learnHistory: new Array(97), candidatePool: new Array(30), ztPool: new Array(52),
              smallyang: { kept: 25, items: new Array(15) } };
  const F = mk(S);
  const c = F.stateCut();
  ok('⛔ 趋势池真实 60 只 → total=60（不是截断后的 50）', c.trendPool.total === 60, String(c.trendPool.total));
  ok('  趋势池实际列出 50 只（cap=50）', c.trendPool.shown === 50, String(c.trendPool.shown));
  ok('⛔ 趋势池被标记为截断（shown < total）', c.trendPool.shown < c.trendPool.total);
  ok('板块真实 35 → total=35 / shown=20', c.sectors.total === 35 && c.sectors.shown === 20);
  ok('涨停题材 8 未触顶 → shown=total=8', c.ztTopics.total === 8 && c.ztTopics.shown === 8);
  ok('学习留档 97 未触顶 → shown=97', c.learnHistory.total === 97 && c.learnHistory.shown === 97);
  ok('连阳 kept=25 但只列 15 → total=25 / shown=15',
    c.smallyang.total === 25 && c.smallyang.shown === 15, JSON.stringify(c.smallyang));
  ok('精选池 30 未触顶 → shown=30', c.pool.total === 30 && c.pool.shown === 30);
  ok('⛔ cap=0 表示不截断 → shown 必须等于 total', c.ztPool.shown === c.ztPool.total, JSON.stringify(c.ztPool));
  ok('stateCut 覆盖全部登记键', Object.keys(c).length === Object.keys(F.STATE_CUT).length);
  ok('每键都带 label/cap/total/shown 四个字段',
    Object.keys(c).every(k => ['label', 'cap', 'total', 'shown'].every(f => f in c[k])));
}

// ════════ 【C】反证：老写法会少报，新写法不会 ════════
console.log('【C】反证：截断场景下老写法与新写法的差别');
{
  const S = { trendPool: new Array(60) };
  const F = mk(S);
  const c = F.stateCut();
  const oldWay = S.trendPool.slice(0, 50).length;      // 老写法：数下发数组的长度
  ok('老写法确实会说 50（池里其实 60）', oldWay === 50, String(oldWay));
  ok('⛔ 新写法 total=60 —— 面板不再少报', c.trendPool.total === 60);
  ok('⛔ 新写法 shown=50 —— 并且能明说「列出前 50 只」', c.trendPool.shown === 50);
  // 池子小的时候两者应当一致（不许为了修 bug 把小池子也改错）
  const F2 = mk({ trendPool: new Array(12) });
  const c2 = F2.stateCut();
  ok('小池子时 total=shown=12（不画蛇添足）', c2.trendPool.total === 12 && c2.trendPool.shown === 12);
}

// ════════ 【D】缺数据时不许崩 ════════
console.log('【D】S 缺失 / 字段缺失时 stateCut 不许抛异常');
{
  const F = mk(undefined);
  const c = F.stateCut();
  ok('S 未注入时全部为 0', Object.keys(c).every(k => c[k].total === 0 && c[k].shown === 0));
  const F2 = mk({ trendPool: null, sectors: undefined, smallyang: {} });
  const c2 = F2.stateCut();
  ok('数组为 null 时不崩且为 0', c2.trendPool.total === 0);
  ok('smallyang 缺 kept 时为 0', c2.smallyang.total === 0);
}

// ════════ 【E】源码契约 ════════
console.log('【E】源码：接口下发、前端不再裸数截断数组');
{
  ok('⛔ /api/state 下发 stateCut', /stateCut:\s*stateCut\(\)/.test(SV));
  ok('前端 cutN 已定义', /function cutN\(s, key, fallback\)/.test(HV));
  ok('前端 cutShown 已定义', /function cutShown\(s, key, fallback\)/.test(HV));
  const cb = cut(HV, 'function cutN(', 'function cutShown(');
  ok('⛔ cutN 读的是后端下发的 s.stateCut', cb.indexOf('s.stateCut') >= 0);
  ok('cutN 取 .total 字段', /\.total/.test(cb));
  ok('后端没下发时才回落本地值', cb.indexOf('fallback') >= 0);

  // 趋势池文案必须改走 cutN（这正是本轮修的那处）
  ok('⛔ 趋势池文案改走 cutN', /tpInfo'\)\.textContent = `共 \$\{cutN\(s, 'trendPool'/.test(HV));
  // ⛔ 判源码必须排除 APP_VER 那行超长版本注释 —— 它逐字引用了被改掉的旧代码字面量
  const codeLines = HV.split('\n').filter(l => !l.startsWith('const APP_VER = '));
  ok('⛔ 趋势池不再裸用 s.trendPool.length 当总数',
    codeLines.every(l => l.indexOf('共 ${s.trendPool.length}') < 0),
    (codeLines.find(l => l.indexOf('共 ${s.trendPool.length}') >= 0) || '').slice(0, 90));
  // 钉语义不钉字面量：这一行必须同时「取真实总数」与「判是否被截断」
  const tpLine = HV.split('\n').find(l => l.indexOf("getElementById('tpInfo')") >= 0) || '';
  ok('趋势池这一行取了真实总数', tpLine.indexOf("cutN(s, 'trendPool'") >= 0, tpLine.slice(0, 60));
  ok('⛔ 趋势池这一行判了截断（poolCut）', tpLine.indexOf('poolCut(') >= 0, tpLine.slice(0, 60));
  ok('连阳文案改走 cutN', /\$\{cutN\(s, 'smallyang'/.test(HV));
}

// ════════ 【F】跨模块：两张表不许互相顶替 ════════
console.log('【F】跨模块：OUT_N（本轮产出）与 STATE_CUT（截断下发）各管一段');
{
  const F = mk(undefined);
  const outKeys = Object.keys(F.OUT_N), cutKeys = Object.keys(F.STATE_CUT);
  // dn 轮那 10 个池的条数由 outN 管，不许再来一份
  for (const k of ['ztpre', 'trendScan', 'steadyUp', 'bigmoney', 'pre']) {
    ok('⛔ ' + k + ' 的条数仍只由 OUT_N 管（STATE_CUT 不重复登记）', cutKeys.indexOf(k) < 0, k);
  }
  ok('两张表都有内容', outKeys.length >= 8 && cutKeys.length >= 5);
  ok('/api/state 同时下发 outN 与 stateCut',
    /outN:\s*outNState\(\)/.test(SV) && /stateCut:\s*stateCut\(\)/.test(SV));
  // 精选池：poolSize（旧总数键）与 stateCut.pool.total 必须一致，不许两个数
  ok('精选池 poolSize 与 stateCut.pool.total 同源',
    /poolSize:\s*S\.candidatePool\.length/.test(SV) && /pool:\s*\{ label: '精选池',\s*cap: 50,\s*total: \(\) => \(\(_s\('candidatePool'\) \|\| \[\]\)\.length\)/.test(SV));
}

console.log('\n合计 ' + N + ' 项：通过 ' + (N - FAIL) + '、失败 ' + FAIL);
process.exit(FAIL ? 1 : 0);
