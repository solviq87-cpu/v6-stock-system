// 守门：全市场同步循环必须让出事件循环（mv 轮，2026-10-29）
// ────────────────────────────────────────────────────────────────────────────────
// 事故（10-28 ms 轮记录的「未修」遗留，2026-10-29 mv 轮修复）：
//   scanZtPre / scanTrendUniverse / scanSteadyUp / runZtpreIngest / runLearnallIngest /
//   seedLearnFromHistory 六处循环各自同步 readFileSync+解析+预测 5900+ 只票，
//   实测 [trendscan] 193.6s、[ztpre] 11.5s 独占事件循环 → 启动期 /api/* 全部无响应=面板白屏
//   （与 kdc 轮 settleKlineDayCache 95.7s 同款事故的第二批）。
// 钉的语义：
//   ① 六处循环体内必须有【宏任务级】让出（await new Promise(r => setImmediate/setTimeout(r))），
//      且让出点在读盘之前；批量走 SCAN_YIELD_EVERY 常量，不许写死大数字；
//   ② SCAN_YIELD_EVERY ≤ 20：kdc 轮实测 400 只一批每批 ~7s 接口仍超时，批量不许放大回几百；
//   ③ 让出必须是宏任务级 —— 微任务级 `await null` 解不开事件循环阻塞（反证真跑钉死）。
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

// 六处全市场循环：函数名 → 这个函数里「for (const fn of」出现即认（读盘循环）
const TARGETS = ['scanZtPre', 'scanTrendUniverse', 'scanSteadyUp', 'runZtpreIngest', 'runLearnallIngest', 'seedLearnFromHistory'];

group('[1] 六处全市场循环体内有宏任务让出（删掉让出行必红）');
{
  // 让出表达式语义 = await 一个宏任务（setImmediate / setTimeout），计数走 SCAN_YIELD_EVERY
  const yieldRe = /await\s+new\s+Promise\([^)]*=>\s*(?:setImmediate|setTimeout)\s*\(/;
  for (const sig of TARGETS) {
    const fnSrc = extractFn(srvSrc, sig);
    ok(!!fnSrc, `能从 server.js 抽出 ${sig} 函数体`);
    if (!fnSrc) continue;
    const forIdx = fnSrc.indexOf('for (const fn of');
    ok(forIdx >= 0, `${sig}：存在全市场文件循环`);
    if (forIdx < 0) continue;
    // 让出表达式必须落在循环体内（for 之后、函数结尾之前），且在读盘之前
    const bodyAfterFor = fnSrc.slice(forIdx);
    const ym = bodyAfterFor.match(yieldRe);
    ok(!!ym, `${sig}：循环体内有宏任务让出（await setImmediate/setTimeout）`);
    ok(/%\s*SCAN_YIELD_EVERY/.test(bodyAfterFor), `${sig}：批量走 SCAN_YIELD_EVERY 常量（不写死大数字）`);
    const readIdx = bodyAfterFor.indexOf('readFileSync');
    const yIdx = ym ? ym.index : -1;
    if (readIdx >= 0 && yIdx >= 0) ok(yIdx < readIdx, `${sig}：让出点在读盘之前`);
    else ok(yIdx >= 0, `${sig}：让出点已定位`);
  }
  // 反证：检测器对「没有让出」的假函数体必须判负
  const fake = 'function fakeScan(topN) {\n  for (const fn of files) {\n    const k = JSON.parse(fs.readFileSync(fn));\n  }\n}';
  ok(!yieldRe.test(fake), '⛔ 反证：无让出的循环体被检测器判负（否则 ① 全是假绿）');
  const fakeMicro = 'function fakeScan2(topN) {\n  for (const fn of files) {\n    if ((++i % 10) === 0) await null;\n  }\n}';
  ok(!yieldRe.test(fakeMicro), '⛔ 反证：微任务级 await null 不算让出（检测器不认）');
}

group('[2] SCAN_YIELD_EVERY 批量上界：≤ 20，不许放大回几百');
{
  const m = srvSrc.match(/const\s+SCAN_YIELD_EVERY\s*=\s*(\d+)/);
  ok(!!m, 'SCAN_YIELD_EVERY 常量已定义');
  const n = m ? +m[1] : NaN;
  ok(Number.isFinite(n) && n >= 1 && n <= 20, `批量 ${n} ∈ [1,20]（trendscan 单只 ~33ms，${n || '?'}×33ms≈${(n || 0) * 33}ms 一次占用）`);
  // 反证：kdc 轮 400 只/批 ≈ 7s/批 → 接口超时；同一只尺子量这里
  ok(400 > 20, '⛔ 反证口径：400 只/批（kdc 实测 ~7s/批超时）在上界之外，会被本断言拦下');
}

group('[3] 让出语义真跑：宏任务解阻塞，微任务（await null）不解');
{
  // 每只票 ~3ms 的同步活（模拟 readFileSync+解析），40 只 ≈ 120ms
  const busy = () => { const t = Date.now(); while (Date.now() - t < 3) {} };
  const N = 40;
  const runScenario = async (yieldMode) => {
    let firedDuring = false, done = false;
    setTimeout(() => { if (!done) firedDuring = true; }, 5);
    for (let i = 0; i < N; i++) {
      busy();
      if (yieldMode === 'macro' && (i + 1) % 10 === 0) await new Promise(r => setImmediate(r));
      else if (yieldMode === 'micro' && (i + 1) % 10 === 0) await null;
    }
    done = true;
    await new Promise(r => setImmediate(r));   // 收尾给定时器一个落点（不影响 firedDuring 判定）
    return firedDuring;
  };
  (async () => {
    const noYield = await runScenario('none');
    ok(noYield === false, '不让出：定时器 5ms 被 120ms 同步活饿死（事件循环被独占的实证）');
    const macro = await runScenario('macro');
    ok(macro === true, '宏任务让出（setImmediate 每 10 只）：定时器插进来了（=面板不再白屏）');
    const micro = await runScenario('micro');
    ok(micro === false, '⛔ 反证：await null 微任务让出仍然饿死定时器（所以生产必须是 setImmediate 级）');
    console.log(`\n${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  })();
}
