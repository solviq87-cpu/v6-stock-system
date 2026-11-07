// 状态锁守门测试（本轮角度：状态锁的获取与释放是否对称）。
// 两类故障都不报错、不崩，只是"那一块从此不动了"或"同一件事被并发跑两遍"：
//   ① 手写锁 `XBusy = true` 之后，释放语句不在 finally 里 —— try 里有 return、
//      或 await 的 Promise 永远不 settle，释放就被跳过，锁永久停在 true；
//   ② 同一个重函数挂在【不同的 guard 名】下 —— guard 是按名字加锁的，
//      两个名字 = 两把互不相认的锁，到点就是并发跑两遍。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src);
const lines = src.split('\n');
const codeLines = code.split('\n');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
function grabFn(re) {
  const m = re.exec(src);
  if (!m) throw new Error('未找到函数: ' + re);
  const s = src.indexOf('{', m.index);
  let d = 0;
  for (let i = s; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (!d) return src.slice(m.index, i + 1); }
  }
  throw new Error('括号未闭合');
}

async function main() {
// ══ [1] 手写锁：释放必须在 finally 里 ═══════════════════════════════════════
group('[1] 手写锁的释放必须在 finally 里');
const locks = [];
for (let i = 0; i < lines.length; i++) {
  const cl = codeLines[i] || '';
  const m = /(\w*[Bb]usy)\s*=\s*true/.exec(cl);
  if (!m) continue;
  const name = m[1];
  // 向后找该变量的释放点
  let rel = -1;
  for (let j = i + 1; j < Math.min(i + 400, lines.length); j++) {
    if (new RegExp(name + '\\s*=\\s*false').test(codeLines[j] || '')) { rel = j; break; }
  }
  if (rel < 0) { locks.push({ name, line: i + 1, rel: -1, inFinally: false }); continue; }
  const cur = lines[rel].trim();
  // ⛔ 2026-10-28 改：原来只看「释放行本身」和「紧邻上一行」——
  //    finally 里面先写一段注释再写复位（这是本项目最常见的写法，注释要讲清为什么必须 finally）
  //    就会被判「不在 finally」假红。现在向上回溯，跳过纯注释/空行再判，最多回溯 6 行，
  //    判据不变：复位语句必须落在 `} finally {` 这个块的开头附近（而不是 try 末尾或 catch 里）。
  let inFinally = false;
  for (let k = rel; k >= Math.max(0, rel - 6); k--) {
    const t = lines[k].trim();
    if (k > rel) {
      if (!t) continue;                                  // 空行
      if (/^\/\//.test(t) || /^\*/.test(t) || /^\/\*/.test(t)) continue;  // 注释行
    }
    if (/finally\s*\{/.test(t)) { inFinally = true; }
    if (k > rel) break;                                  // 只看紧邻的那个非注释块头
  }
  locks.push({ name, line: i + 1, rel: rel + 1, inFinally });
}
ok(`⛔ 共 ${locks.length} 处手写锁，每一处都在 finally 里释放（且有释放点）`,
  locks.length >= 12 && locks.every(x => x.rel > 0 && x.inFinally));
for (const l of locks.filter(x => !x.inFinally || x.rel < 0))
  console.log(`  ⚠️ 行 ${l.line} ${l.name} → 释放点 行 ${l.rel}${l.inFinally ? '' : '（不在 finally）'}`);
ok('竞价实时刷新那处锁已改为 finally（12 处里原本唯一不对称的一处）',
  /finally \{ auctionLiveBusy = false; \}/.test(src));
// 反证：try 里有 return 时，写在 try/catch 之后的释放会被跳过
{
  let released = false;
  const demo = () => { try { return 'early'; } catch { } released = true; };
  demo();
  ok('反证：释放写在 try/catch 之后、try 里提前 return → 释放被跳过（锁永久卡住）', released === false);
  let released2 = false;
  const demo2 = () => { try { return 'early'; } catch { } finally { released2 = true; } };
  demo2();
  ok('⛔ 放进 finally 则一定会释放', released2 === true);
}

// ══ [2] 同一个重函数不许挂在两个 guard 名下 ══════════════════════════════════
group('[2] guard 按名字加锁 → 同一重函数必须同名');
const HEAVY = ['runLearnallIngest', 'seedLearnFromHistory', 'resolveSignalsDeep', 'computeBreadth', 'refreshSectorsZT', 'rebuildPool', 'refreshGlobal', 'klineBackfill', 'runLearnCycle'];
const byFn = new Map();
const offOf = i => src.split('\n').slice(0, i).join('\n').length + 1;   // 第 i 行（0基）首字符的偏移
for (let i = 0; i < lines.length; i++) {
  const gm = /guard\('([^']+)'/.exec(lines[i]);   // ⚠️ 用原始行：stripNoise 会把字符串字面量涂掉
  if (!gm) continue;
  let body = '';
  const ref = /guard\('[^']+',\s*(\w+)\s*\)/.exec(lines[i]);
  if (ref) {
    body = ref[1];                                  // guard(name, fnRef)：直接传函数引用
  } else {
    // ⛔ 必须按括号配对取这个 guard 回调的**真实块**——用固定行数窗口会串到相邻的
    //    setInterval(guard(...)) 上（实测会把 refreshGlobal 误判成被 7 把锁包裹）。
    const st = offOf(i);
    const s = code.indexOf('{', st);
    if (s < 0) continue;
    let d = 0, e = -1;
    for (let k = s; k < code.length; k++) {
      if (code[k] === '{') d++;
      else if (code[k] === '}') { d--; if (!d) { e = k; break; } }
    }
    if (e < 0) continue;
    body = src.slice(st, e + 1);
  }
  for (const h of HEAVY.concat(['_bootSeed'])) {
    if (new RegExp('\\b' + h + '\\s*\\(').test(body)) {
      if (!byFn.has(h)) byFn.set(h, new Set());
      byFn.get(h).add(gm[1]);
    }
  }
}
let multi = 0;
for (const [h, names] of byFn) {
  if (names.size > 1) { multi++; console.log(`  ⚠️ ${h} 被 ${names.size} 个 guard 名包裹：${[...names].join(' / ')}`); }
}
ok(`⛔ ${byFn.size} 个受 guard 保护的重函数，无一被两把不同的锁包裹`, multi === 0);
ok('启动补样本三路共用 guard("learn-boot")',
  (src.match(/guard\('learn-boot', _bootSeed\)/g) || []).length === 3);
ok('⛔ 全量回填与日常入库共用 guard("learnall")（两者跑的是同一个 runLearnallIngest）',
  (src.match(/guard\('learnall'/g) || []).length >= 2);
ok('runLearnallIngest 本身没有内部锁（所以只能靠 guard 名统一）',
  !/async function runLearnallIngest\(\) \{[\s\S]{0,200}?Busy/.test(src));

// ══ [3] guard 自身契约：catch + finally 都要有 ══════════════════════════════
group('[3] guard 包装器自身');
ok('guard 有 catch（否则 setInterval 回调一抛错就是 unhandledRejection，周期任务静默停摆）',
  /try \{ return await fn\(\.\.\.a\); \}[\s\S]{0,80}?catch \(e\) \{/.test(src));
ok('guard 在 finally 里释放锁', /finally \{ _taskBusy\.delete\(name\); \}/.test(src));
ok('锁带 15 分钟兜底（任务崩了/挂了也不会永久占着）',
  /if \(at && Date\.now\(\) - at < 15 \* 60 \* 1000\) return;/.test(src));

// ══ [4] 用真实 guard 实现跑一遍：两个名字 vs 一个名字 ═══════════════════════
group('[4] 行为验证：两把锁 vs 一把锁');
{
  const SRC = grabFn(/function guard\(name, fn\) \{/);
  const _taskBusy = new Map();
  const mkGuard = new Function('_taskBusy', 'console', SRC + '\nreturn guard;')(_taskBusy, { error() { } });
  let ranA = 0, ranB = 0, ranC = 0;
  const hang = () => new Promise(() => { });          // 永不 settle，模拟"任务还在跑"
  const g1 = mkGuard('learn-boot1', async () => { ranA++; await hang(); });
  const g2 = mkGuard('learn-boot2', async () => { ranB++; await hang(); });
  g1(); g2();
  ok('反证：两个不同的 guard 名 → 两把锁互不相认，第二个照样跑（并发）', ranA === 1 && ranB === 1);
  const g3 = mkGuard('learn-boot1', async () => { ranC++; await hang(); });
  g3();
  ok('⛔ 同名 guard → 前一个还在跑时后一个被挡住（不并发）', ranC === 0);
  // 跑完之后锁应被释放，下一次可以再跑（async：CommonJS 里不能顶层 await）
  const _taskBusy2 = new Map();
  const mkGuard2 = new Function('_taskBusy', 'console', SRC + '\nreturn guard;')(_taskBusy2, { error() { } });
  let n = 0;
  const g = mkGuard2('learn-boot', async () => { n++; });
  await g(); await g();
  ok('跑完之后锁释放，下一轮可以再跑（"启动后多试几次"的意图不变）', n === 2);
}     // ← 关掉 [4] 的裸块

// ══ [5] 单一槽位的复用锁：只能清自己那一轮 ══════════════════════════════════
//    holdings.js 的 compute() 用 _inflight 做「进行中复用」，一个模块级**单槽位**。
//    写操作会 bump 世代戳 → 新一轮启动并**覆盖**这个槽位；此时旧一轮若无条件把槽位置空，
//    抹掉的却是新一轮的锁 → 下一次强制重算看到"没有进行中的"→ 又开一轮 → N 次操作并发 N 轮。
group('[5] 单槽位复用锁：旧一轮不许抹掉新一轮的锁');
{
  const hsrc = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');
  const st = hsrc.indexOf('  let _inflight = null;');
  const en = hsrc.indexOf('\n  async function _computeCore');
  ok('取到 holdings.js 的 compute() 源码块', st >= 0 && en > st);
  const BLOCK = hsrc.slice(st, en);

  // 沙箱：注入 _cache 与可控的 _computeCore，把 _inflight / _gen 暴露出来观察
  const mk = new Function('_cache', '_computeCore', BLOCK + `
    return {
      compute,
      peek: () => _inflight,
      bump: () => { _gen++; }
    };`);

  const stalled = [];   // 每一轮重算的 resolve 句柄，由测试决定何时"算完"
  const core = () => new Promise(r => stalled.push({ r, tag: stalled.length }));
  const box = mk({ data: null, t: 0 }, core);

  // ① 第一轮（世代 0）启动
  const pA = box.compute(true);
  ok('第一轮启动 → 槽位里有锁', !!box.peek());
  // ② 用户点了一次写操作（世代 +1）→ 第二轮启动，覆盖槽位
  box.bump();
  const pB = box.compute(true);
  ok('跨代后第二轮启动 → 槽位换成新一轮（gen=1）', box.peek() && box.peek().gen === 1);
  // ③ 让【旧】一轮先算完
  stalled[0].r('A-done');
  await pA;
  ok('⛔ 旧一轮算完【不会】把新一轮的锁抹掉（槽位仍是第二轮）', !!box.peek() && box.peek().gen === 1);
  // ④ 再来一次强制重算（**期间没有写操作**，世代不变）：必须复用第二轮，不许开第三轮。
  //    ⚠️ 这里绝不能 bump —— bump 代表"期间发生过写操作"，那份结果已经脏了，
  //    本来就该另起一轮（跨代复用才是 bug）；判别式必须是"同世代 + 旧一轮刚算完"。
  const pC = box.compute(true);
  // ⚠️ compute 是 async 函数，return _inflight.p 会被再包一层新 promise ——
  //    所以不能比 `pC === pB`，只能看有没有【第三次】进 _computeCore（stalled 没变长）。
  ok('⛔ 第二轮仍在跑时，同世代的强制重算复用同一个 promise（没开第三轮）', stalled.length === 2);
  stalled[1].r('B-done');
  const vB = await pB, vC = await pC;
  ok('两次请求最终拿到同一份结果（确实复用了同一次重算）', vB === vC && vC === 'B-done');
  // ⑤ 都算完之后锁释放
  ok('算完之后锁释放（槽位清空）', box.peek() === null);
  ok('⛔ 源码用 token 认领，只清自己那一轮',
    /const tok = \{\}/.test(BLOCK) && /_inflight\.tok === tok/.test(BLOCK));

  // 反证：无条件清空（修之前的写法）会让旧一轮抹掉新一轮的锁
  const OLD = `let _inflight = null; let _gen = 0;
    async function compute(force) {
      if (_inflight && _inflight.gen === _gen) return _inflight.p;
      const g = _gen;
      const p = _computeCore(g).then(r => { _inflight = null; return r; },
                                     e => { _inflight = null; throw e; });
      _inflight = { gen: g, p };
      return p;
    }`;
  const stalledOld = [];
  const coreOld = () => new Promise(r => stalledOld.push(r));
  const boxOld2 = new Function('_cache', '_computeCore', OLD + `
    return { compute, peek: () => _inflight, bump: () => { _gen++; } };`)({ data: null, t: 0 }, coreOld);
  const qA = boxOld2.compute(true);
  boxOld2.bump();
  const qB = boxOld2.compute(true);
  stalledOld[0]('A');
  await qA;
  ok('反证：旧写法下旧一轮算完把槽位置空（新一轮的锁被抹）', boxOld2.peek() === null);
  // 同样不加 bump：B 明明还在跑，槽位却被 A 抹成了空 → 又开一轮 C，B 与 C 并发
  const qC = boxOld2.compute(true);
  ok('反证：于是下一次强制重算又开了一轮（B 还在跑却无人可复用 = 并发重算）', stalledOld.length === 3);
  stalledOld[1]('B'); stalledOld[2]('C');
  await qB; await qC;
}
}     // ← 关掉 main()

main().then(() => {
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
});
