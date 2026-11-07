// 守门测试：缓存与失效（2026-10-06）
//
// 背景（本轮新角度：**缓存坏了不报错、不崩，值还是旧的或每次都重算，看着完全正常**）：
//
// ① 缓存的「命中键」和「写入键」不是同一个东西 —— 涨停题材缓存 _ztReasonCache 只有一个 date 字段，
//    写进去的是 used（回退之后**实际**取到数据的那天），读的时候却和 d0（**目标**交易日）比。
//    一旦走上回退分支（早盘当天池子还没出、节假日、接口延迟），used = d0-1…d0-4，永远 ≠ d0
//    → 缓存永不命中 → 每 8 分钟重跑一遍最多 5 次网络请求。
//    而这段缓存存在的唯一理由就是注释里那句「同花顺对高频请求会限流」——
//    等于**最该生效的时候（接口拉空、正在限流）恰恰失效**，自己把自己往死里打。
//    修法：缓存里存两个日期，forDay（目标日，作命中键）+ used（实到日，只用于诊断与定 TTL）。
//
// ② 空结果不进缓存 —— empTable 的命中条件是 `Object.keys(map).length`（结果非空才算缓存过），
//    于是算出空表时永远不进缓存，而空表恰恰出现在 S.learn.signals 最多的时候
//    （ba 版剔除事后样本后，新实例初期一条实盘样本都没有）→ 每次调用整扫上千条样本。
//    empProb 又在 fusedProb 里给每只候选每次排序各调一遍 → 冷启动那几小时最慢。
//    空结果也是结果，照样该缓存。修法：加 done 标记，别用"结果非空"当"算过了"。
//
// ③ 缓存时间戳取在函数开头（await 之前）—— 隔着几次 await，慢的时候几十秒，
//    用开头的时间戳等于把 TTL 起点提前到请求发出之前，数据到手时已经"老"了。
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');
const CODE = stripNoise(SRC, { keepStrings: true });

// 从源码里按大括号配对摘出一个函数声明
function grabFn(name) {
  const k = SRC.indexOf('function ' + name + '(');
  if (k < 0) return '';
  // ⛔ 必须把前面的 `async ` 一起带上：只从 `function` 开始切，摘出来的是同步函数，
  //    丢进 new Function 里跑会因为 `await 只在 async 函数中有效` 直接 SyntaxError。
  const i = SRC.slice(Math.max(0, k - 6), k) === 'async ' ? k - 6 : k;
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { d++; started = true; }
    else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
}

async function main() {
console.log('\n[1] 涨停题材缓存：回退之后缓存仍要能命中（行为测试）');
{
  const fnSrc = grabFn('shiftDate') + '\n' + grabFn('ztReasonCached');
  ok(/async function ztReasonCached/.test(fnSrc) && /function shiftDate/.test(fnSrc), '摘出 ztReasonCached 与 shiftDate');

  // 造一个受控环境：目标日 20260930（当天池子空），回退到 20260929 才拿到数据
  const makeEnv = src => {
    let calls = [];
    const em = { fetchZtReason: async d => { calls.push(d); return d === '20260929' ? new Map([['600000', { reason: '测试题材' }]]) : new Map(); } };
    const build = new Function('em', 'dataTradeDay', 'lastTradeDay', `
      let _ztReasonCache = { forDay: '', used: '', t: 0, ttl: 0, map: null };
      ${src}
      return { ztReasonCached, peek: () => _ztReasonCache };
    `);
    const api = build(em, async () => '2026-09-30', () => '20260930');
    return { api, calls };
  };

  const A = makeEnv(fnSrc);
  const m1 = await A.api.ztReasonCached();
  const n1 = A.calls.length;
  ok(m1 && m1.size === 1, '第一次：目标日拉空 → 回退到前一天拿到数据', 'size=' + (m1 && m1.size));
  ok(n1 === 2, `第一次：打了 2 次网络（目标日 + 回退 1 天）`, '实际 ' + n1 + ' 次: ' + A.calls.join(','));

  const m2 = await A.api.ztReasonCached();
  ok(m2 && m2.size === 1 && A.calls.length === n1,
    '⚠️ 第二次：命中缓存，不再打网络（回退分支的缓存必须照样生效）',
    '网络次数 ' + n1 + ' → ' + A.calls.length);

  const p = A.api.peek();
  ok(p.forDay === '20260930', '⚠️ 缓存的命中键记的是【目标日】20260930', 'forDay=' + p.forDay);
  ok(p.used === '20260929', '⚠️ 实际取到的是 20260929（回退结果另存，不参与命中比较）', 'used=' + p.used);
  ok(p.ttl > 0 && p.ttl < 10 * 60 * 1000, '⚠️ 回退来的数据用短 TTL（别把当天新池子压着 10 分钟）', 'ttl=' + p.ttl);

  // 换日必须失效
  const B = makeEnv(fnSrc);
  await B.api.ztReasonCached();
  B.api.peek().forDay = '20260929';     // 模拟：目标日变了（新交易日）
  const before = B.calls.length;
  await B.api.ztReasonCached();
  ok(B.calls.length > before, '⚠️ 目标日一变就重新拉（换日必须失效）', before + ' → ' + B.calls.length);

  // 反证：把命中键改回 used（旧写法），第二次必须重新打网络 —— 说明上面那条断言真的能分辨
  const oldSrc = fnSrc.replace('forDay: d0', 'forDay: used');
  ok(oldSrc !== fnSrc, '反证前提：旧写法（forDay 记 used）已构造出来');
  const C = makeEnv(oldSrc);
  await C.api.ztReasonCached();
  const cn1 = C.calls.length;
  await C.api.ztReasonCached();
  ok(C.calls.length > cn1, '⚠️ 反证：旧写法第二次真的重打了网络（' + cn1 + ' → ' + C.calls.length + ' 次）');
}

console.log('\n[2] 命中键与写入键必须是同一个字段（源码：不许再出现"只存一个 date"的写法）');
{
  // ⛔ 匹配缓存对象字面量必须用 `[^;]*` 不能用 `[^}]*`：对象里嵌套 `map: {}` / `map: null`
  //    会让 `[^}]*` 提前截断（_empCache 那句就是这样被截掉的），甚至只匹配到声明行。
  const decl = (SRC.match(/let _ztReasonCache = \{[^;]*\};/) || [''])[0];
  ok(/forDay/.test(decl) && /used/.test(decl), '⚠️ _ztReasonCache 同时有 forDay（命中键）与 used（实到日）', decl);
  const hitLine = (CODE.match(/if \(_ztReasonCache\.map && _ztReasonCache\.\w+ === d0[^\n]*/) || [''])[0];
  ok(/_ztReasonCache\.forDay === d0/.test(hitLine), '⚠️ 命中判断比的是 forDay（目标日），不是 used', hitLine);
  // ⛔ 别用 `_ztReasonCache = \{ forDay: [^;]*` 去取：声明行 `let _ztReasonCache = { forDay: '' ... }`
  //    同样满足这个模式，会先命中声明、拿到空串。直接按 **值** 匹配（声明里是 ''，写入处才是 d0）。
  const writeLine = (CODE.match(/_ztReasonCache = \{ forDay: d0[^;]*;/) || [''])[0];
  ok(/forDay: d0\b/.test(writeLine) && /used,/.test(writeLine), '⚠️ 写入时 forDay 存 d0（目标日）、used 单存', writeLine);
  ok(!/_ztReasonCache = \{ forDay: used/.test(CODE), '⚠️ 不许再出现 forDay 记 used 的旧写法');
}

console.log('\n[3] 空结果也要进缓存（empTable 不许拿"结果非空"当"算过了"）');
{
  const decl = (SRC.match(/let _empCache = \{[^;]*\};/) || [''])[0];
  ok(/done/.test(decl), '⚠️ _empCache 有 done 标记', decl);
  const hit = (CODE.match(/if \(_empCache\.[^\n]*\) return _empCache\.map;/) || [''])[0];
  ok(/_empCache\.done/.test(hit), '⚠️ 命中条件用 done，不再用 Object.keys(map).length', hit);
  ok(!/Object\.keys\(_empCache\.map\)\.length/.test(CODE), '⚠️ 源码里已无「结果非空才算缓存过」的写法');
  ok(/t: now, map: m, done: true/.test(CODE), '⚠️ 写缓存时 done 置为 true（空表也置）');
  // 行为：抽出来的命中表达式，空表 + done=true 必须命中
  const expr = (CODE.match(/if \((_empCache\.done && now - _empCache\.t < 5 \* 60 \* 1000)\)/) || [])[1];
  ok(!!expr, '摘出命中表达式');
  const evalHit = done => {
    const now = Date.now();
    const _empCache = { t: now, map: {}, done };
    // eslint-disable-next-line no-new-func
    return new Function('_empCache', 'now', 'return (' + expr + ');')(_empCache, now);
  };
  ok(evalHit(true) === true, '⚠️ 空表 + done=true → 命中（不再每次整扫样本）');
  ok(evalHit(false) === false, '⚠️ done=false → 不命中（还没算过，该算）');
  // 失效仍然有效：t=0 时无论 done 都必须重算
  const stale = { t: 0, map: {}, done: true };
  ok(new Function('_empCache', 'now', 'return (' + expr + ');')(stale, Date.now()) === false,
    '⚠️ t=0（被 if(changed) 作废）时照样重算 —— 失效通道没被 done 堵死');
}

console.log('\n[4] 缓存时间戳不许取在 await 之前');
{
  // 找所有 async 函数：函数体内先 `const now = Date.now()`、中间有 await、最后写 `t: now`
  const bad = [];
  const lines = CODE.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/async function\s+\w+/.test(lines[i])) continue;
    // 函数体到下一个顶层 function 为止
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) { if (/^(async )?function\s+\w+/.test(lines[j])) { end = j; break; } }
    const body = lines.slice(i, end);
    const joined = body.join('\n');
    if (!/const now = Date\.now\(\);/.test(joined)) continue;
    if (!/\bt: now\b/.test(joined)) continue;
    const iNow = joined.indexOf('const now = Date.now();');
    const iAwait = joined.indexOf('await ');
    if (iAwait > iNow) bad.push((i + 1) + ': ' + lines[i].trim().slice(0, 60));
  }
  ok(bad.length === 0, '⚠️ 没有「先取 now、再 await、最后把 now 写成缓存时间戳」的写法', bad.join(' | '));
  ok(/t: Date\.now\(\), map \}/.test(CODE), '⚠️ 龙虎榜缓存写的是写入时刻 Date.now()');
  // ⛔ 长度上限别给太小：函数体 20 来行中文注释一撑就超过 900 字符，
  //    截断后既匹配不到 await 也匹配不到写缓存那行，会变成假红。
  const lhb = (SRC.match(/async function lhbMapCached[\s\S]{0,3000}?\n\}/) || [''])[0];
  ok(/await /.test(lhb) && /_lhbCache = \{ date: d \|\| '', t: Date\.now\(\), map \}/.test(lhb),
    '⚠️ lhbMapCached 体内确有 await，且时间戳改成了写入时刻');
}

console.log('\n[5] 模型刷新与推理缓存必须配对失效');
{
  const seg = CODE.slice(CODE.indexOf('function runLearnallIngest') > 0 ? CODE.indexOf('function runLearnallIngest') : CODE.indexOf('async function runLearnallIngest'));
  const near = seg.slice(0, 4000);
  ok(/laRefresh\(\);/.test(near), '重灌样本后调用了 laRefresh()（模型换新的）');
  const iR = near.indexOf('laRefresh();');
  const after = near.slice(iR, iR + 400);
  ok(/_laCache = new Map\(\);/.test(after), '⚠️ laRefresh() 之后紧接着清空 _laCache（否则"学完了但不改推送"）');
  const nRefresh = (CODE.match(/laRefresh\(\);/g) || []).length;
  const nClear = (CODE.match(/_laCache = new Map\(\);/g) || []).length;
  ok(nClear >= nRefresh, `⚠️ 清空次数(${nClear}) ≥ 模型刷新次数(${nRefresh}) —— 刷新了就必须失效`);

  // ⑧ K线缓存落盘失败不许静默（2026-10-28 数据源轮）：
  //    .kline_cache 是全项目 K 线的唯一磁盘落点，写失败被 catch{} 空吞 = 该票 K 线永久停在旧版本
  //    且**没有任何日志** —— 运维只看到「K线陈旧」却查不到原因（at 轮同类已修 6 处，这 8 处是漏网的）。
  //    钉语义（有统一留痕函数、无空 catch、留痕限频），不钉死具体行号。
  const wrSites = (CODE.match(/fs\.writeFileSync\(\s*(?:cf|path\.join\(KLINE_CACHE[^)]*\))\s*,\s*JSON\.stringify\(k\)\s*\)/g) || []).length;
  const errCalls = (CODE.match(/_klineWriteErr\(/g) || []).length - 1;   // 减去函数定义自身
  ok(wrSites >= 6, `K线缓存写盘点已识别：${wrSites} 处`);
  ok(errCalls >= wrSites, `写盘点全部接统一留痕 _klineWriteErr（调用 ${errCalls} ≥ 写点 ${wrSites}）`);
  ok(!/writeFileSync\(\s*(?:cf|path\.join\(KLINE_CACHE[^)]*\))\s*,\s*JSON\.stringify\(k\)\s*\);?\s*\}?\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/.test(CODE), 'K线写盘无空 catch（落盘失败不被静默吞掉）');
  ok(/function _klineWriteErr/.test(CODE) && /_klineWrFail\.lastAt\s*>\s*60000/.test(CODE), '留痕做 60 秒限频（磁盘满时不逐票刷爆日志）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
}
main();
