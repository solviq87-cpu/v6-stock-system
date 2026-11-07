// 守门 · dn 轮：系统里「同一件事的两个名字」—— 同义异名与同名异义
//   上一轮（dm）收的是「陈旧有五种说法」，再往外一层就是名字本身：
//   全项目里「这个池本轮产出几条」实测有 **4 个名字、2 条代码路径**：
//     · 面板侧：items.length（大单/埋伏/补涨龙）· count（自定义规则）· cand（次日计划）
//               · zpg.total / _tsp.total（涨停前形态/趋势扫描）· su.length（连续收涨）
//     · 任务侧：taskSet(..., { n }) —— 同一个池的条数在同一时刻被**数了两遍**
//   两边都没有错（各自都是自己那一瞬间的真实值），所以**谁也不会报错、谁也不会发现**，
//   用户只会看到同一个模块显示两个不一样的条数。
//   修法：OUT_N 登记表（每个池只登记一次「条数从哪来」）+ outN() 唯一出口
//        + outWhy()（「0 条的原因」不许再数第二遍）+ 前端 poolN() 只读后端下发的同一个数。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：EMPTY_WHY（dl 轮）+ OUT_N（dn 轮）整块切出来真跑 ──
const EMPTY_SRC = cut(SV, 'const EMPTY_WHY = {', 'const PUSH_DONE = {');
const OUT_SRC = cut(SV, 'const OUT_N = {', '// ─── 「失败」的说法登记表');
const _errs = [];
const F = new Function('console', 'S', '_zpProg', '_tsProg', '_kbfProg',
  EMPTY_SRC + '\n' + OUT_SRC +
  '\nreturn { EMPTY_WHY, emptyWhyOf, OUT_N, OUT_SHOWN, outN, outWhy, outNShown, outNState, _s, _outNMem };'
)({ error: (...a) => _errs.push(a.join(' ')), log: () => {} }, undefined, undefined, undefined, undefined);

// ════════ 【A】登记表：每个池的「条数」只登记一次 ════════
console.log('【A】OUT_N：同一个池的条数不许有两个名字');
{
  const ks = Object.keys(F.OUT_N);
  ok('登记表非空', ks.length >= 8, '实得 ' + ks.length);
  for (const k of ks) {
    const d = F.OUT_N[k];
    ok(k + ' 有中文名 label', typeof d.label === 'string' && d.label.length > 0);
    ok(k + ' 有取数来源 from（函数）', typeof d.from === 'function');
  }
  // ⛔ 同名异义：两个池不许共用同一个中文名（否则面板上分不清说的是谁）
  const labels = ks.map(k => F.OUT_N[k].label);
  const dup = labels.filter((x, i) => labels.indexOf(x) !== i);
  ok('⛔ 没有两个池共用同一个中文名', dup.length === 0, dup.join(','));
  // 关键池必须登记（面板上会显示条数的那些）
  for (const p of ['bigmoney', 'pre', 'myrules', 'nextplan', 'steadyUp', 'ztpre', 'trendScan']) {
    ok('面板会显示条数的池已登记: ' + p, !!F.OUT_N[p]);
  }
}

// ════════ 【B】outN：唯一出口 ════════
console.log('【B】outN：未登记的池一律拒绝，本轮值优先，坏值不许穿透');
{
  const S = { bigMoney: { items: [1, 2, 3] }, pre: { items: [1] }, buzhang: { items: [1, 2, 3, 4] },
              myrules: { count: 5 }, nextplan: { cand: 9 }, steadyUp: [1, 2], similar: [1, 2, 3] };
  const G = new Function('console', 'S', '_zpProg', '_tsProg', '_kbfProg',
    EMPTY_SRC + '\n' + OUT_SRC + '\nreturn { outN, outWhy, outNShown, outNState };'
  )({ error: (...a) => _errs.push(a.join(' ')), log: () => {} }, S, { total: 11 }, { total: 22 }, { added: 33 });

  // ⛔ 反证：老写法（自己数一遍）与新写法必须给出同一个数 —— 否则就是又分叉了
  ok('bigmoney 与 items.length 同源', G.outN('bigmoney') === 3, String(G.outN('bigmoney')));
  ok('pre 与 items.length 同源', G.outN('pre') === 1, String(G.outN('pre')));
  ok('buzhang 与 items.length 同源', G.outN('buzhang') === 4, String(G.outN('buzhang')));
  ok('myrules 与 count 同源', G.outN('myrules') === 5, String(G.outN('myrules')));
  ok('nextplan 与 cand 同源', G.outN('nextplan') === 9, String(G.outN('nextplan')));
  ok('steadyUp 与数组长度同源', G.outN('steadyUp') === 2, String(G.outN('steadyUp')));
  ok('similar 与数组长度同源', G.outN('similar') === 3, String(G.outN('similar')));
  ok('ztpre 与 _zpProg.total 同源', G.outN('ztpre') === 11, String(G.outN('ztpre')));
  ok('trendScan 与 _tsProg.total 同源', G.outN('trendScan') === 22, String(G.outN('trendScan')));
  ok('kbf 与 _kbfProg.added 同源', G.outN('kbf') === 33, String(G.outN('kbf')));

  // ⛔ 顺序要紧：记忆化之后 outN('pre') 会一直返回登记过的本轮值，
  //    所以「没传值时回落表里来源」必须在登记之前验（另起一个干净沙箱）。
  ok('传 null 时回落表里的来源', G.outN('pre', null) === 1, String(G.outN('pre', null)));
  ok('传 undefined 时回落表里的来源', G.outN('pre', undefined) === 1);
  ok('⛔ 坏值（NaN）不许穿透成 NaN', G.outN('pre', 'abc') === 0, String(G.outN('pre', 'abc')));
  const G2 = new Function('console', 'S', '_zpProg', '_tsProg', '_kbfProg',
    EMPTY_SRC + '\n' + OUT_SRC + '\nreturn { outN };'
  )({ error: () => {}, log: () => {} }, S, { total: 11 }, { total: 22 }, { added: 33 });
  ok('⛔ 传了本轮值就用本轮值（不许再落回表）', G2.outN('pre', 7) === 7, String(G2.outN('pre', 7)));

  // 未登记：拒绝 + 报错 + 给 0（不许静默返回 undefined 让面板显示 "undefined 只"）
  _errs.length = 0;
  ok('未登记的池返回 0 而不是 undefined', G.outN('notAPool') === 0, String(G.outN('notAPool')));
  ok('⛔ 未登记的池会报错（不静默）', _errs.join(' ').indexOf('notAPool') >= 0, _errs.join(' '));
}

// ════════ 【C】缺数据时不许崩（沙箱友好） ════════
console.log('【C】S 缺失 / 字段缺失时 outN 不许抛异常');
{
  ok('S 未注入时全池返回 0', Object.keys(F.OUT_N).every(k => F.outN(k) === 0));
  const H = new Function('console', 'S', EMPTY_SRC + '\n' + OUT_SRC + '\nreturn { outN };'
  )({ error: () => {}, log: () => {} }, { bigMoney: { items: null }, pre: {}, myrules: {}, nextplan: {} });
  ok('items 为 null 时不崩且为 0', H.outN('bigmoney') === 0);
  ok('count 缺失时为 0', H.outN('myrules') === 0);
  ok('cand 缺失时为 0', H.outN('nextplan') === 0);
  ok('steadyUp 缺失时为 0', H.outN('steadyUp') === 0);
}

// ════════ 【D】outWhy：「0 条的原因」不许再数第二遍 ════════
console.log('【D】outWhy：原因由同一个 n 派生');
{
  ok('0 条 → 给出原因', F.outWhy(0) === F.EMPTY_WHY.justNone, F.outWhy(0));
  ok('有货 → 不给原因', F.outWhy(3) === '');
  ok('null 当 0 处理', F.outWhy(null) === F.EMPTY_WHY.justNone);
  ok('字符串数字也算数', F.outWhy('3') === '');
  ok('⛔ 脏字符串不当成有货', F.outWhy('abc') === F.EMPTY_WHY.justNone);
}

// ════════ 【E】源码契约：taskSet 的 n 与 empty 必须同源 ════════
console.log('【E】源码：条数与空原因都走同一个出口');
{
  const blockFrom = (src, start) => {
    const i0 = src.indexOf('(', start); if (i0 < 0) return '';
    let d = 0;
    for (let i = i0; i < src.length && i < i0 + 600; i++) {
      const c = src[i];
      if (c === '(') d++;
      else if (c === ')') { d--; if (d === 0) return src.slice(i0 + 1, i); }
    }
    return '';
  };
  const fieldVal = (block, key) => {
    const i = block.indexOf(key + ':'); if (i < 0) return null;
    let j = i + key.length + 1, d = 0;
    for (; j < block.length; j++) {
      const c = block[j];
      if (c === '(' || c === '{' || c === '[') d++;
      else if (c === ')' || c === '}' || c === ']') { if (d === 0) break; d--; }
      else if ((c === ',' || c === '\n') && d === 0) break;
    }
    return block.slice(i + key.length + 1, j).trim();
  };
  const re = /taskSet\(\s*'([A-Za-z]+)'\s*,/g;
  let m; const calls = [];
  while ((m = re.exec(SV))) calls.push({ name: m[1], b: blockFrom(SV, m.index) });
  ok('抓到 taskSet 调用', calls.length >= 9, String(calls.length));

  let nBad = 0, nOut = 0, eBad = 0, eOut = 0;
  for (const c of calls) {
    const nv = fieldVal(c.b, 'n');
    if (nv == null) continue;
    // ⛔ n 只能是「走 outN」或「纯数字常量（失败分支写死 0）」—— 不许再自己数一遍
    if (/^outN\(/.test(nv)) nOut++;
    else if (/^\d+$/.test(nv)) { /* 失败分支 n:0，合法 */ }
    else { nBad++; console.log('      ⚠ taskSet(' + c.name + ') n = ' + nv); }
    const ev = fieldVal(c.b, 'empty');
    if (ev == null) continue;
    if (/^outWhy\(/.test(ev) || /^emptyWhyOf\('(?!justNone)/.test(ev)) eOut++;
    else if (/emptyWhyOf\('justNone'\)/.test(ev)) { eBad++; console.log('      ⚠ taskSet(' + c.name + ') empty 仍在自己数: ' + ev); }
  }
  ok('⛔ 没有 taskSet 绕过 outN 自己数条数', nBad === 0, String(nBad));
  ok('走 outN 的调用点数量正确', nOut === 7, String(nOut));
  ok('⛔ 没有 taskSet 绕过 outWhy 自己数空原因', eBad === 0, String(eBad));

  // 反证：源码里确实不再有「n 走 outN、empty 又数一遍 items.length」的双轨写法
  ok('源码里不再有 S.bigMoney.items.length ? 的 empty 双轨',
    SV.indexOf("(((S.bigMoney || {}).items || []).length ? '' :") < 0);
  ok('源码里不再有 S.pre.items.length ? 的 empty 双轨',
    SV.indexOf("(((S.pre || {}).items || []).length ? '' :") < 0);
}

// ════════ 【F】前端：只读后端下发的同一个数 ════════
console.log('【F】前端 poolN：面板与任务状态必须是同一个数');
{
  ok('poolN 已定义', /function poolN\(s, pool, fallback\)/.test(HV));
  const body = cut(HV, 'function poolN(s, pool, fallback)', 'function staleTime(');
  ok('⛔ poolN 读的是后端下发的 s.outN', body.indexOf('s.outN') >= 0 && body.indexOf('[pool]') >= 0);
  ok('poolN 取的是 .n 字段', /\.n\s*===?\s*['"]number['"]/.test(body) || /typeof v\.n/.test(body));
  ok('⛔ 后端没下发时才回落本地兜底值', body.indexOf('fallback') >= 0);

  // 前端用到的池名必须在后端 OUT_N 里登记过 —— 拼错一个字母就是「静默永远回落本地值」
  const re2 = /poolN\(s,\s*'([A-Za-z]+)'/g;
  let m2; const used = [];
  while ((m2 = re2.exec(HV))) used.push(m2[1]);
  ok('前端有调用点', used.length >= 6, String(used.length));
  for (const p of used) ok('⛔ 前端池名已登记在后端: ' + p, !!F.OUT_N[p], p);

  // 这六个池正是「面板 items.length / count / cand / total」与「任务状态 n」分叉的重灾区
  for (const p of ['bigmoney', 'pre', 'myrules', 'nextplan', 'ztpre', 'trendScan', 'steadyUp']) {
    ok('前端条数展示已改走 poolN: ' + p, used.indexOf(p) >= 0);
  }
}

// ════════ 【G】跨模块：接口下发与idl 一致性 ════════
console.log('【G】跨模块：/api/state 必须下发，且两端说的是同一套键');
{
  ok('/api/state 下发 outN', /outN:\s*outNState\(\)/.test(SV));
  ok('outNState 每键给 {label, n}', /o\[k\]\s*=\s*\{\s*label:/.test(OUT_SRC));
  const st = F.outNState();
  ok('outNState 覆盖全部登记池', Object.keys(st).length === Object.keys(F.OUT_N).length);
  ok('outNState 每键的 n 是数字', Object.keys(st).every(k => typeof st[k].n === 'number'));
  ok('outNState 每键的 label 与登记表一致', Object.keys(st).every(k => st[k].label === F.OUT_N[k].label));

  // ⛔ outN 不许被拿去装别的语义（同名异义）：全项目 outN( 调用点只出现在 taskSet 与 outNState 里
  const uses = [...SV.matchAll(/outN\('([A-Za-z]+)'/g)].map(x => x[1]);
  ok('outN 调用点全部是已登记的池', uses.every(u => !!F.OUT_N[u]), uses.filter(u => !F.OUT_N[u]).join(','));

  // 与上一轮（dm 新鲜度）不冲突：两个表各自独立，键名风格可以不同但不许互相顶替
  ok('OUT_N 与 STALE_RULE 是两张表（不许互相顶替）', SV.indexOf('const STALE_RULE = {') > 0);
}

// ════════ 【H】补发：本轮产出 vs 实际列出，是两个量 ════════
console.log('【H】n 与 shown：扫出 N 只 ≠ 列出 M 只，但 N 只有一个值');
{
  const S = { ztPre: new Array(20), trendScan: new Array(30), steadyUp: new Array(12),
              bigMoney: { items: new Array(9) } };
  const H2 = new Function('console', 'S', '_zpProg', '_tsProg', '_kbfProg',
    EMPTY_SRC + '\n' + OUT_SRC + '\nreturn { outN, outNShown, outNState };'
  )({ error: () => {}, log: () => {} }, S, { total: 4612 }, { total: 2289 }, { added: 0 });

  // ⛔ 线上实测（20261007dn 首版）：taskSet 在扫描时求值 = 66 / 4612 / 2289，
  //    而 outNState 在 /api/state 时才求值 = 12 / 20 / 30 —— 同一个池两个条数。
  //    修法：本轮值登记后即以它为准，第二次求值不许再算一遍。
  H2.outN('steadyUp', 66);
  ok('⛔ 记忆化：登记 66 后再取仍是 66（不再落回 S.steadyUp.length=12）',
    H2.outN('steadyUp') === 66, String(H2.outN('steadyUp')));
  H2.outN('ztpre', 4612);
  ok('⛔ 记忆化：ztpre 登记 4612 后再取仍是 4612', H2.outN('ztpre') === 4612, String(H2.outN('ztpre')));
  H2.outN('trendScan', 2289);
  ok('⛔ 记忆化：trendScan 登记 2289 后再取仍是 2289', H2.outN('trendScan') === 2289);
  // 反证：没有记忆化时（旧行为）两次求值会分叉 —— 直接比较两种取值路径
  const st2 = H2.outNState();
  ok('⛔ outNState.n 与 taskSet 的 n 同源（steadyUp）', st2.steadyUp.n === 66, String(st2.steadyUp.n));
  ok('⛔ outNState.n 与 taskSet 的 n 同源（ztpre）', st2.ztpre.n === 4612, String(st2.ztpre.n));
  ok('⛔ outNState.n 与 taskSet 的 n 同源（trendScan）', st2.trendScan.n === 2289, String(st2.trendScan.n));

  // shown 是另一个量：实际落池 / 列出的条数
  ok('shown 走的是池里真实条数（ztPre 20）', st2.ztpre.shown === 20, String(st2.ztpre.shown));
  ok('shown 走的是池里真实条数（trendScan 30）', st2.trendScan.shown === 30, String(st2.trendScan.shown));
  ok('shown 走的是池里真实条数（steadyUp 12）', st2.steadyUp.shown === 12, String(st2.steadyUp.shown));
  ok('没有截断时 shown 与 n 相等（bigmoney 9）', H2.outN('bigmoney') === 9 && st2.bigmoney.shown === 9);
  ok('⛔ 没有 shown 定义的池返回 null 而不是 0', st2.kbf.shown === null, String(st2.kbf.shown));
  ok('⛔ 没有 shown 定义的池返回 null（nextplan）', st2.nextplan.shown === null);

  // OUT_SHOWN 不许有 OUT_N 之外的孤儿键
  const orphan = Object.keys(F.OUT_SHOWN).filter(k => !F.OUT_N[k]);
  ok('⛔ OUT_SHOWN 没有 OUT_N 之外的孤儿键', orphan.length === 0, orphan.join(','));

  // 前端：poolCut 只在真的被截断时才说话
  ok('前端 poolShown 已定义', /function poolShown\(/.test(HV));
  ok('前端 poolCut 已定义', /function poolCut\(/.test(HV));
  const cb = cut(HV, 'function poolCut(', 'function staleTime(');
  ok('⛔ 没被截断时不许画蛇添足', /shown < n/.test(cb) && /shown > 0/.test(cb));
  ok('被截断时明说「列出前 N 只」', cb.indexOf('列出前') >= 0);
  ok('三处文案已接上 poolCut', (HV.match(/poolCut\(/g) || []).length >= 4,
    String((HV.match(/poolCut\(/g) || []).length));
}

console.log('\n合计 ' + N + ' 项：通过 ' + (N - FAIL) + '、失败 ' + FAIL);
process.exit(FAIL ? 1 : 0);
