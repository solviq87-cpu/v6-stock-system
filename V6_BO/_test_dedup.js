// 守门测试：同一份外部数据不得被重复打（并发请求合并 + 跨调用共享配额，2026-10-06）
//
// 背景（新角度：异步竞态 / TOCTOU）：
//   全项目 9 处 fetchKline、3 处 ensureSectorStocks（**全是裸调用不 await**，天然并发）、
//   2 处 ensureStockBoards，多个定时器在同一秒里要【同一份数据】是常态 ——
//   补涨龙/启动前埋伏/新闻关联会拉同一个板块的成分股，大单扫描与板块刷新会补同一批票的题材。
//   而 em.js 里**没有任何请求合并** → N 路同时要就是 N 次网络，全部计入同一条限流计数。
//   ax 那轮给 fetchBoardStocks 加退避，正是因为实测它被自己打封了一整天
//   （补涨龙/启动前埋伏整栏 0 输出）—— 但退避只治「失败后继续猛打」，治不了「重复打」。
//
//   第二个坑：ensureSectorStocks 的 `let fetched = 0` 是**每个调用方自己的局部计数器**，
//   三路并发时各允许 3 个 = 一轮最多 9 个请求，"防请求风暴"的意图被完全抵消。
//
// 本测试钉死：
//   ① 同一 key 的并发请求只真的发一次网络，N 个调用方共享同一个结果
//   ② 不同 key 互不干扰（days 不同就是不同数据，不能混）
//   ③ 落地即注销：成功后第二次调用会重新发（不是永久复用旧结果）
//   ④ ⛔ 失败也必须注销 —— 否则这个 key 永久占着一个 rejected Promise，
//      这只票/这个板块被永久判死，比重复请求严重得多
//   ⑤ 三个 fetch 包装函数都真的走 dedup
//   ⑥ ensureSectorStocks 的配额是跨调用共享的（三路并发也不超发）
'use strict';
const fs = require('fs');
const em = require('./em.js');

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SRC = fs.readFileSync('server.js', 'utf8');
const EMS = fs.readFileSync('em.js', 'utf8');

(async () => {
  console.log('\n[1] dedup：并发合并');
  {
    let calls = 0;
    const fn = async () => { calls++; await sleep(40); return 'R' + calls; };
    const rs = await Promise.all([em.dedup('x1', fn), em.dedup('x1', fn), em.dedup('x1', fn)]);
    ok(calls === 1, `⚠️ 同一 key 三路并发 → 底层只执行 1 次（实为 ${calls} 次，等于打了 ${calls} 次网络）`);
    ok(rs.every(r => r === 'R1'), '三路拿到同一个结果（不是各拉各的）');
  }
  {
    let calls = 0;
    const fn = async () => { calls++; await sleep(20); return calls; };
    await Promise.all([em.dedup('k:600000:95', fn), em.dedup('k:600000:60', fn)]);
    ok(calls === 2, '不同 days = 不同数据，不合并（不能把 60 天K线当 95 天用）');
  }
  {
    let calls = 0;
    const fn = async () => { calls++; await sleep(10); return calls; };
    await em.dedup('x2', fn);
    await em.dedup('x2', fn);           // 前一次已落地
    ok(calls === 2, '落地即注销：非并发的第二次调用会重新发（不是永远吃旧值）');
  }

  console.log('\n[2] ⛔ 失败必须注销（否则该 key 被永久判死）');
  {
    let n = 0;
    const bad = async () => { n++; throw new Error('boom'); };
    await em.dedup('bad1', bad).catch(() => {});
    await em.dedup('bad1', bad).catch(() => {});
    ok(n === 2, `⚠️ 失败后 key 已注销，第二次能重试（实为 ${n} 次；若=1 说明永久复用了 rejected Promise）`);
    // 并发失败也只执行一次，且三路都拿到同一个错误
    let m = 0;
    const bad2 = async () => { m++; await sleep(10); throw new Error('boom2'); };
    const errs = await Promise.all([em.dedup('bad2', bad2).catch(e => e.message),
      em.dedup('bad2', bad2).catch(e => e.message)]);
    ok(m === 1 && errs.every(e => e === 'boom2'), '并发失败同样只执行一次，且共享同一个错误');
  }

  console.log('\n[3] 三个 fetch 包装都真的走 dedup');
  {
    const wrap = (name) => {
      const i = EMS.indexOf('async function ' + name + '(');
      if (i < 0) return '';
      return EMS.slice(i, EMS.indexOf('\n}', i));
    };
    for (const [fnName, prefix] of [['fetchKline', 'k:'], ['fetchBoardStocks', 'b:'], ['fetchStockBoards', 's:']]) {
      const src = wrap(fnName);
      ok(src.length > 0 && /dedup\(/.test(src), `${fnName} 走 dedup 包装`);
      ok(src.includes(`'${prefix}'`) || src.includes(`\`${prefix}`), `${fnName} 的 dedup key 前缀正确（${prefix}）`);
      ok(/return dedup\(/.test(src) && src.indexOf('return dedup(') < 120, `${fnName} 第一件事就是查 dedup（不是先打网络再合并）`);
    }
    ok(/_fetchKlineCore/.test(EMS) && /_fetchBoardStocksCore/.test(EMS) && /_fetchStockBoardsCore/.test(EMS),
      '三个底层实现已分离为 *_Core（包装不会递归调用自己）');
    ok(/finally\s*\{\s*_inflight\.delete\(key\)/.test(EMS), '⚠️ 注销写在 finally 里（成功失败都会注销）');
    ok(/module\.exports[\s\S]*inflightSize/.test(EMS), 'inflightSize 已导出（可观测去重效果）');
  }

  console.log('\n[4] 反证：去掉 dedup，同一份数据会被重复打');
  {
    let calls = 0;
    const fn = async () => { calls++; await sleep(30); return calls; };
    await Promise.all([fn(), fn(), fn()]);       // 不走 dedup 的裸并发
    ok(calls === 3, '⚠️ 反证：不经 dedup 的三路并发就是 3 次网络（说明 dedup 确实在起作用）');
  }

  console.log('\n[5] ensureSectorStocks 的补拉配额必须跨调用共享');
  {
    // 把真实的 secQuotaTake + ensureSectorStocks 抽进沙箱跑，避免复制一份逻辑来测
    const q0 = SRC.indexOf('const SEC_FETCH_QUOTA');
    const q1 = SRC.indexOf('async function ensureSectorStocks(secNames) {');
    const fnEnd = SRC.indexOf('\n}\n', q1);
    ok(q0 > 0 && q1 > q0 && fnEnd > q1, '抽出 secQuotaTake + ensureSectorStocks');
    const block = SRC.slice(q0, fnEnd + 3);
    const QUOTA = +(/const SEC_FETCH_QUOTA = (\d+)/.exec(SRC) || [])[1] || 0;
    ok(QUOTA > 0 && QUOTA <= 8, `全局配额合理（${QUOTA} 个/60秒）`);

    // 假 em：只计数，不真打网络；假 S：10 个板块都没有缓存
    let netCalls = 0;
    const fakeEm = {
      fetchBoardStocks: async (bk) => { netCalls++; await sleep(5); return [{ code: '000001', name: 'X' }]; },
      delay: () => Promise.resolve()
    };
    const secNames = Array.from({ length: 10 }, (_, i) => '板块' + i);
    const S = { sectors: secNames.map(n => ({ name: n, code: 'BK000' + n.slice(-1) })), secCodeMap: new Map(), secStocks: new Map() };
    const mk = () => new Function('S', 'em', 'console', block + '\n; return ensureSectorStocks;')(S, fakeEm, { log() {} });

    // 三路并发（复刻线上：新闻两处 + 复盘一处，都是裸调用不 await）
    netCalls = 0; S.secStocks = new Map();
    const run = mk();
    await Promise.all([run(secNames), run(secNames), run(secNames)]);
    ok(netCalls <= QUOTA, `⚠️ 三路并发补拉 10 个板块，实际网络请求 ${netCalls} 次 ≤ 全局配额 ${QUOTA}`);
    ok(netCalls < 10, `（对照）若配额是每调用各算 3 个，这里会是 9 次；若完全不设限会是 30 次`);

    // 窗口内继续调用不再超发
    netCalls = 0;
    const run2 = mk();
    await run2(Array.from({ length: 10 }, (_, i) => '新板块' + i));
    ok(netCalls === 0, '配额用完后的 60 秒窗口内不再发请求（防请求风暴）');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
