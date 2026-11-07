// 守门测试：当日推送闸门不许只活在内存里（2026-10-06）
//
// 本轮新角度：**改了内存但没落盘**。这类故障不报错、不崩，只是「闸门悄悄失效」——
// 而它守的恰恰是用户最反感的那件事（2026-10-01 原话「你推送的太多了啊跟菜市场一样全是票」）。
//
// PUSH_GOV（今日已推几只 / 每只票今天推过几次 / 冷却到几点）与
// _modDay（每个模块今天还剩几条额度）原来是纯内存 const，从不落盘 → 一重启全部归零：
//   · 今天已推 80 只 → 重启 → 名额"满了"又能再推 80 只
//   · 某票今天已推 2 次（到上限）或 30 分钟前刚推过 → 重启 → 次数与冷却全忘，立刻再推一遍
//   · 某模块今天已用满额度 → 重启 → 从头再来一轮
// 而**线上实例会被平台回收后冷启动**（不发版也会发生），这道闸每次冷启动后都要失效一次。
//
// 这里做**真实往返测试**：save → load，断言 Set/Map 能还原成能用的对象，
// 以及跨日必须判为过期（否则会把昨天的计数当今天的，反而把闸门关死）。
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');
const CODE = stripNoise(SRC, { keepStrings: true });
let makeEnv = null;   // 下面 [2] 里构造，[3] 也要用（块作用域的 const 出去就访问不到）

console.log('\n[1] 源码：每一次「当日闸门状态变更」之后都必须落盘');
{
  ok(/function savePushGov\(\)/.test(CODE), '有 savePushGov()');
  ok(/function loadPushGov\(\)/.test(CODE), '有 loadPushGov()');
  ok(/^\s*loadPushGov\(\);/m.test(CODE), '⚠️ 启动期真的调用了 loadPushGov()（只定义不调用 = 白写）');
  // PUSH_GOV.total++ 共两处（govTake 成功、大单重复流入），每处之后都得落盘
  const totals = [...CODE.matchAll(/PUSH_GOV\.total\+\+;/g)].map(m => CODE.slice(m.index, m.index + 90));
  ok(totals.length === 2, `找到 ${totals.length} 处 PUSH_GOV.total++`);
  ok(totals.every(t => /savePushGov\(\);/.test(t)), '⚠️ 每处 PUSH_GOV.total++ 之后都落盘',
    totals.filter(t => !/savePushGov/.test(t)).join(' | '));
  // codes.set（每票当日次数/冷却）
  const sets = [...CODE.matchAll(/PUSH_GOV\.codes\.set\([^;]*;/g)].map(m => CODE.slice(m.index, m.index + 120));
  ok(sets.length >= 1 && sets.every(t => /savePushGov\(\);/.test(t)), '⚠️ PUSH_GOV.codes.set 之后落盘');
  // _modDay 计数
  const mod = [...CODE.matchAll(/_modDay\.n\[mod\] = n \+ 1;/g)].map(m => CODE.slice(m.index, m.index + 60));
  ok(mod.length === 1 && /savePushGov\(\);/.test(mod[0] || ''), '⚠️ 模块日上限计数之后落盘');
  // 换日重置也要落盘
  const reset = (CODE.match(/PUSH_GOV\.day = d; PUSH_GOV\.codes = new Map\(\)[\s\S]{0,220}/) || [''])[0];
  ok(/savePushGov\(\);/.test(reset), '⚠️ 换日重置之后落盘（否则重启读到昨天的 day，白记一天）');
}

console.log('\n[2] 往返：save → load 必须还原成**能用的** Map / Set');
{
  // 摘出两个函数，注入受控依赖
  const grab = name => {
    const k = SRC.indexOf('function ' + name + '(');
    if (k < 0) return '';
    let d = 0, started = false;
    for (let j = k; j < SRC.length; j++) {
      if (SRC[j] === '{') { d++; started = true; }
      else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(k, j + 1); }
    }
    return '';
  };
  const src = grab('savePushGov') + '\n' + grab('loadPushGov');
  ok(/function savePushGov/.test(src) && /function loadPushGov/.test(src), '摘出 savePushGov 与 loadPushGov');

  makeEnv = (fileContent, day, isReplica) => {
    let written = null;
    const env = {
      isReplica: () => !!isReplica,
      atomicWrite: (f, t) => { written = { f, t }; },
      fs: { readFileSync: () => fileContent },
      PUSH_GOV: { day: '', codes: new Map(), total: 0, dropped: 0, lowProb: 0 },
      _modDay: { day: '', n: {} },
      S: { fastinRepeat: new Map() },
      todayStr: () => day,
      console: { log: () => { }, error: () => { } },
      path: { join: (a, b) => a + '/' + b },
      __dirname: '/x'
    };
    // ⛔ PUSH_GOV_FILE 是定义在函数**外面**的 const，只摘函数体会让它变未定义 →
    //    函数里的 try/catch 一吞，表现就是"什么都没写出来"。必须一起注入。
    // ⛔ isReplica 也要注入：savePushGov 里用它门控「副本不落盘」，
    //    只摘函数体的话它是未定义 —— 而函数里有 try/catch，表现同样是"什么都没写出来"，很难查。
    const build = new Function('atomicWrite', 'fs', 'PUSH_GOV', '_modDay', 'S', 'todayStr', 'console', 'PUSH_GOV_FILE', 'isReplica',
      src + '\nreturn { savePushGov, loadPushGov };');
    const api = build(env.atomicWrite, env.fs, env.PUSH_GOV, env._modDay, env.S, env.todayStr, env.console, '/x/pushgov.json', env.isReplica);
    return { api, env, getWritten: () => written };
  };

  // ① 同一个交易日：save → load 往返
  const A = makeEnv(null, '20261006');
  A.env.PUSH_GOV.day = '20261006';
  A.env.PUSH_GOV.total = 37;
  A.env.PUSH_GOV.codes.set('600000', { n: 2, ts: 111, types: new Set(['bigmoney', 'trend']) });
  A.env.PUSH_GOV.codes.set('300750', { n: 1, ts: 222, types: new Set(['pool']) });
  A.env._modDay = { day: '20261006', n: { bigmoney: 5, sector: 6 } };
  A.env.S.fastinRepeat.set('600001', { d: '20261006', n: 1, lastRepeatTs: 333, repeatSent: 2 });
  // ⚠️ 注意：_modDay 是对象，重新赋值不会进闭包；这里改成原地写
  A.api.savePushGov();
  const w = A.getWritten();
  ok(w && w.t, 'savePushGov 写出了内容');

  const B = makeEnv(w.t, '20261006');
  B.api.loadPushGov();
  ok(B.env.PUSH_GOV.total === 37, '⚠️ 今日已推条数被还原（37）', '实际 ' + B.env.PUSH_GOV.total);
  ok(B.env.PUSH_GOV.codes.get('600000') && B.env.PUSH_GOV.codes.get('600000').n === 2,
    '⚠️ 每票当日次数被还原');
  // ⛔ 关键：types 必须还原成 Set —— JSON 化后天然变数组，若不还原，
  //    govTake 里的 `rec.types.has(type)` 会直接 TypeError，闸门不是失效而是崩。
  const ty = B.env.PUSH_GOV.codes.get('600000').types;
  ok(ty instanceof Set, '⚠️ types 还原成了 Set（不是数组）', Object.prototype.toString.call(ty));
  ok(typeof ty.has === 'function' && ty.has('bigmoney') === true, '⚠️ 还原后的 Set 真的能 .has()');
  ok(B.env.PUSH_GOV.codes.get('300750') && B.env.PUSH_GOV.codes.get('300750').types.has('pool'), '第二只票的 types 也还原了');
  ok(B.env.S.fastinRepeat.get('600001') && B.env.S.fastinRepeat.get('600001').repeatSent === 2,
    '⚠️ 大单重复流入的当日计数也还原');

  // ② 跨日：文件里是昨天的 → 必须判为过期，不能拿昨天的计数当今天的
  const C = makeEnv(w.t, '20261007');
  C.api.loadPushGov();
  ok(C.env.PUSH_GOV.total === 0 && C.env.PUSH_GOV.codes.size === 0,
    '⚠️ 跨日：昨天的存档被判过期，不恢复（否则会把昨天用满的额度当成今天的，闸门被关死）',
    'total=' + C.env.PUSH_GOV.total);
  ok(C.env.PUSH_GOV.day === '', '⚠️ 跨日：day 保持为空，交给 govResetIfNewDay 自己初始化');

  // ③ 反证：load 若不判 day（旧行为），昨天的计数会被当成今天的 → 闸门被错误关死
  const badSrc = src.replace('if (!d || !o || o.day !== d) return;', '');
  const D = makeEnv(w.t, '20261007');
  const badBuild = new Function('atomicWrite', 'fs', 'PUSH_GOV', '_modDay', 'S', 'todayStr', 'console', 'PUSH_GOV_FILE', 'isReplica',
    badSrc + '\nreturn { savePushGov, loadPushGov };');
  const badApi = badBuild(D.env.atomicWrite, D.env.fs, D.env.PUSH_GOV, D.env._modDay, D.env.S, D.env.todayStr, D.env.console, '/x/pushgov.json', D.env.isReplica);
  badApi.loadPushGov();
  ok(D.env.PUSH_GOV.total === 37,
    '⚠️ 反证：不判 day 就会把昨天的 37 条当成今天的（证明这条断言真的能分辨）',
    'total=' + D.env.PUSH_GOV.total);
}

console.log('\n[3] 副本（pushRole=replica）不许落盘');
{
  ok(/typeof isReplica === 'function' && isReplica\(\)\) return;/.test(CODE), '⚠️ savePushGov 里有副本门控');
  // 发布是**整目录上传**的：副本那份 pushgov.json 若跟着上到线上，
  // 线上启动会读到「今天 = 副本记的 0 条」→ 当天已推计数被冲成 0 → 今天推过的再推一遍。
  const R = makeEnv(null, '20261006', true);
  R.env.PUSH_GOV.day = '20261006'; R.env.PUSH_GOV.total = 5;
  R.api.savePushGov();
  ok(R.getWritten() === null, '⚠️ 副本调用 savePushGov 什么都不写（发布时就根本没这个文件，污染链从根上断掉）');
  const P = makeEnv(null, '20261006', false);
  P.env.PUSH_GOV.day = '20261006'; P.env.PUSH_GOV.total = 5;
  P.api.savePushGov();
  ok(P.getWritten() !== null, '⚠️ 主实例照常落盘（门控不能把主实例也一起关掉）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
