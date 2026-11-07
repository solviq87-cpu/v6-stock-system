// 守门：K线当日行校正（settleKlineDayCache）不许把面板卡死，也不许整天重扫
// ────────────────────────────────────────────────────────────────────────────────
// 事故（2026-10-28 ms 轮，本机副本 22:12 启动实测）：
//   ① settleKlineDayCache 的 for 循环里全是同步 readFileSync/writeFileSync，5567 只跑完 95.7 秒，
//      期间 /api/* 一条都不响应 → 面板白屏（用户看到的是「服务挂了」）。
//   ② 锁日判据「真改到东西 or 确无缺口」在缺口永远补不上时不成立：停牌股本就不在全A快照里，
//      appendDayRow 每轮都计 unverified → _gap 恒 >0 → 每 10 分钟全量重扫一次（每次都卡 ~1 分钟）。
// 钉的语义：
//   ① 循环每 20 只必须让出事件循环（await setImmediate），且让出点在处理文件之前；
//   ② 锁日判据：有实际改动 → 立刻锁；确无缺口 → 锁；只有缺口 → 最多重试 3 轮（retry 0/1/2），
//      用尽即锁并留 reason=retry-exhausted（缺口明细仍在 em.dayGuardStats，可查不隐藏）；
//   ③ 缺口消失时不许误判成「重试用尽」（clean 优先）。
'use strict';
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');

const srvSrc = fs.readFileSync('server.js', 'utf8');
function extractFn(src, sig) {
  const re = new RegExp('function ' + sig + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const m = src.match(re);
  return m ? m[0] : null;
}

group('[1] 锁日判据 kdcLockDecision：重试上限 3 轮，用尽即锁');
{
  const fnSrc = extractFn(srvSrc, 'kdcLockDecision');
  ok(!!fnSrc, '能从 server.js 抽出 kdcLockDecision 函数体');
  if (fnSrc) {
    const dec = new Function('return ' + fnSrc)();

    const r1 = dec({ fixed: 1, gap: 9, retry: 0 });
    ok(r1.lock === true && r1.reason === 'changed', '有实际改动 → 立刻锁（不等缺口补齐）');
    ok(r1.retry === 0, '锁日时重试计数归零');

    const r2 = dec({ fixed: 0, appended: 0, dropped: 0, gap: 0, retry: 0 });
    ok(r2.lock === true && r2.reason === 'clean', '确无缺口 → 锁（reason=clean）');

    const a = dec({ gap: 3, retry: 0 });
    const b = dec({ gap: 3, retry: 1 });
    const c = dec({ gap: 3, retry: 2 });
    ok(a.lock === false && a.retry === 1, '缺口第 1 轮 → 不锁，retry 0→1');
    ok(b.lock === false && b.retry === 2, '缺口第 2 轮 → 不锁，retry 1→2');
    ok(c.lock === true && c.reason === 'retry-exhausted' && c.retry === 0, '缺口第 3 轮 → 锁（retry-exhausted），计数归零');

    // 反证：旧判据（changed || gap===0）在「缺口恒在、无改动」时永远不锁 → 每 10 分钟全量重扫
    const oldLock = o => ((+o.fixed || 0) + (+o.appended || 0) + (+o.dropped || 0)) > 0 || Math.max(0, +o.gap || 0) === 0;
    ok([0, 1, 2, 3, 4].every(r => oldLock({ gap: 3, retry: r }) === false),
      '⛔ 反证：旧判据在缺口恒在时确实永远不锁（这就是整天重扫的根因）');
    ok([0, 1, 2].filter(r => dec({ gap: 3, retry: r }).lock).length === 1,
      '⛔ 反证：新判据在同一场景下第 3 轮必定锁住（不再无限重扫）');

    // 边界：缺口消失时不许误判成重试用尽
    const d = dec({ gap: 0, retry: 2 });
    ok(d.lock === true && d.reason === 'clean', '⛔ 缺口已消失（gap=0）→ reason=clean，不许记成 retry-exhausted');
    // 边界：脏输入不许放大
    const e = dec({ gap: -5, retry: -1 });
    ok(e.lock === true && e.reason === 'clean', '负缺口夹到 0（-5 → clean 锁，不抛错）');
    const f = dec({});
    ok(f.lock === true && f.reason === 'clean', '空入参 → clean 锁（不抛错、不无限重试）');
    const g = dec({ fixed: '2', gap: 'x' });
    ok(g.lock === true && g.reason === 'changed', '字符串数字/脏 gap 不抛错（fix=2 → changed）');
  }
}

group('[2] settleKlineDayCache：循环必须让出事件循环（否则面板白屏）');
{
  const fnSrc = extractFn(srvSrc, 'settleKlineDayCache');
  ok(!!fnSrc, '能从 server.js 抽出 settleKlineDayCache 函数体');
  if (fnSrc) {
    ok(/await new Promise\(r => setImmediate\(r\)\)/.test(fnSrc), '循环体内确有 await setImmediate 让出点');
    ok(/__YIELD_EVERY__/.test(fnSrc) === false, '（占位符残留检查）');
    // 让出点必须在写文件之前：把 yield 挪到循环末尾也不算数 —— 一个 tick 里仍要处理整批
    const iYield = fnSrc.indexOf('setImmediate(r)');
    const iGuard = fnSrc.indexOf('em.guardDayRow(');
    const iAppend = fnSrc.indexOf('em.appendDayRow(');
    ok(iYield > 0 && iGuard > iYield && iAppend > iYield, '让出点位于 guardDayRow / appendDayRow 之前（每个 tick 才被切碎）');
    ok(/\(\+\+_i % 20\) === 0/.test(fnSrc) && /let scanned = 0, fixed = 0, dropped = 0, appended = 0, _i = 0/.test(fnSrc),
      '每 20 只让出一次（计数器 _i 每轮自增一次；400 只一批实测每批 ~7s 仍超时，不许放大）');
    // ⛔ 反证：批太大就等于没让出 —— 显式挡住「把 20 改回 100/400」的回归
    ok(!/% (100|200|400|500|1000)\) === 0/.test(fnSrc), '⛔ 批大小没被放大回 100/400（单批耗时必须 <1s 量级）');
    ok(/async function settleKlineDayCache/.test(srvSrc), '函数本身是 async（await 合法）');
    // 反证：旧实现没有 await setImmediate（同步到底）
    const oldSrc = fnSrc.replace(/[^\n]*await new Promise\(r => setImmediate\(r\)\);[^\n]*\n/, '');
    ok(!/setImmediate\(r\)/.test(oldSrc), '⛔ 反证：改动前实现确实没有任何让出点（95.7s 全程独占事件循环）');
  }
}

group('[3] 锁日判定已接进生产（不是写了函数没人用）');
{
  ok(/_kdc\.retry/.test(srvSrc), '_kdc 上保留了重试计数');
  ok(/kdcLockDecision\(\{ fixed, appended, dropped, gap: _gap, retry: _kdc\.retry \}\)/.test(srvSrc),
    'settle 调用 kdcLockDecision 并传入 _kdc.retry（重试状态是跨轮累积的）');
  ok(/retry: _dec\.retry/.test(srvSrc), '判定结果写回 _kdc.retry（下一轮才能续上）');
  ok(/const _kdc = \{[^}]*retry: 0/.test(srvSrc), '_kdc 初始化含 retry: 0');
  ok(/day: _dec\.lock \? today : ''/.test(srvSrc), '锁日才写 _kdc.day（未锁则下一轮继续）');
  ok(/lockReason/.test(srvSrc), '锁日原因留痕（changed/clean/retry-exhausted 可查）');
}

group('[4] 写盘必须同时回灌 S.klines 内存副本（否则下游读昨日 bar、巡检永远报陈旧）');
{
  const fnSrc = extractFn(srvSrc, 'settleKlineDayCache');
  if (fnSrc) {
    // 判据按「行」看：每一处 KLINE_CACHE 写盘那行，同一行里必须跟着 klineSet 回灌。
    // 不钉具体行号/缩进（重构会动），只钉语义：写盘 ≠ 落内存，两者必须同帧发生。
    const writeLines = fnSrc.split('\n').filter(l => /writeFileSync\(path\.join\(KLINE_CACHE/.test(l));
    ok(writeLines.length >= 2, 'settle 里确有「补缺行」与「重建/丢弃」两处写盘（前置事实）');
    ok(writeLines.every(l => /klineSet\(code, k\)/.test(l)),
      '每处写盘同一行都调 klineSet(code, k) 回灌内存（10-29 实测磁盘 39/39 有今日行、内存仍报 6/20 陈旧）');
    // 反证：把这行里的回灌去掉，判据必须转红 —— 证明它真的在查回灌而不是恰好匹配到注释
    const noBackfill = writeLines.map(l => l.replace(/;\s*klineSet\(code, k\);/, ';'));
    ok(!noBackfill.every(l => /klineSet\(code, k\)/.test(l)), '⛔ 反证：去掉回灌后判据确实转红');
    // 唯一入口：内存写只许走 klineSet（顺带维护 _klineAt 时间戳，绕过它会让 TTL 判断失真）
    ok(!/S\.klines\.set\(/.test(fnSrc), 'settle 内没有绕过 klineSet 直写 S.klines');
  }
}

console.log('\n' + (fail === 0 ? '✅ ' : '❌ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
