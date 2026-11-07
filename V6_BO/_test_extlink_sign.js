/**
 * _test_extlink_sign.js —— 守门测试：外围联动（refreshExtLink）必须真能算出结果
 *
 * 背景（2026-10-02 静态扫描发现）：
 *   server.js 的 refreshExtLink() 第 203 行用了 sign(s.pct)，但顶层从来没定义过 sign。
 *   该调用在函数内的 try 里，ReferenceError 被 catch 吞掉，只打一行 [extlink] 日志 ——
 *   结果 S.extLink 永远算不出来：面板「外围联动」恒空、该模块的推送永远不发。
 *   这是"不报错但功能整个是死的"的静默失败，node --check 和语法检查都发现不了。
 *
 * 做法：从 server.js **抽取真实的 refreshExtLink 源码**在沙箱里跑（与 test_build_report.js 同一路子），
 *       做 A/B 对照：
 *         场景① 注入顶层 sign（= 修复后）  → 必须成功，S.extLink 有值，推送文案带 +x%
 *         场景② 不注入 sign（= 修复前）    → 必须抛错被吞、S.extLink 拿不到值（证明 bug 真实存在）
 *   场景② 是"疫苗"：哪天有人又把 sign 删了，这条会立刻炸出来。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

// ── 从 server.js 抽取 refreshExtLink 源码（大括号配对）──────────────
function extractFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const fnSrc = extractFn(SRC, 'async function refreshExtLink() {');
if (!fnSrc) { console.log('❌ 未能从 server.js 抽取 refreshExtLink'); process.exit(1); }

// ⛔ lj 轮起 refreshExtLink 的选股过滤里调了 capTooSmall（全模块 <40亿 不选）。
//    沙箱必须把真实实现一起注进去，否则 ReferenceError 被函数内的 try 吞掉，
//    症状跟"sign 没定义"一模一样（S.extLink 恒空 + 一行 [extlink] 日志）—— 又是假红。
const capSrc = extractFn(SRC, 'function capTooSmall(s) {');
const CAP_TOO_SMALL = capSrc ? new Function(capSrc + '\nreturn capTooSmall;')() : (() => false);

// 顶层 sign 是否真的定义了（修复点本身）
const hasTopLevelSign = /^const sign = /m.test(SRC);

function runCase(withSign) {
  const S = {
    global: [{ code: 'usIXIC', name: '纳指', pct: 1.5 }],
    extCache: { at: 0, sectors: null, stocks: new Map() },
    extPushed: new Map()
  };
  const em = {
    fetchExtQuotes: async () => [{ code: 'usIXIC', name: '纳斯达克', pct: 2.4 }],
    fetchSinaSectors: async () => [{ node: 'n1', name: '半导体', pct: 3.1 }],
    fetchSinaSectorStocks: async () => [
      { code: '600001', name: '测试科技', price: 10.5, pct: 2.5, turnover: 5 },
      { code: '600002', name: 'ST垃圾', price: 3, pct: 5, turnover: 9 }   // 应被 ST 过滤
    ]
  };
  const EXT_MAP = [{ name: '科技', exts: ['usIXIC'], keys: ['半导体'] }];
  const EXT_PUSH_GAP = 0;
  const isTradingTime = () => true;
  const pushed = [];
  const pushAll = (t) => pushed.push(t);
  const logs = [];
  const console2 = { error: (...a) => logs.push(a.join(' ')) };

  const body = (withSign ? "const sign = v => (v > 0 ? '+' : '') + v;\n" : '') +
    fnSrc + '\n;return refreshExtLink();';
  // ⚠️ A（analysis.js）必须注入：2026-10-06 起 ST/退市过滤统一走 A.isJunkName，
  //    refreshExtLink 里内联的 /ST|退/ 正则已换成它；漏注入 → ReferenceError 被内部 catch 吞掉，
  //    表现为"S.extLink 拿不到值"，会被误判成功能坏了（与 sign 那个历史 bug 症状一模一样）。
  const f = new Function('S', 'em', 'EXT_MAP', 'EXT_PUSH_GAP', 'isTradingTime', 'pushAll', 'console', 'A', 'capTooSmall', body);
  return { S, pushed, logs, run: () => f(S, em, EXT_MAP, EXT_PUSH_GAP, isTradingTime, pushAll, console2, require('./analysis.js'), CAP_TOO_SMALL) };
}

console.log('══ 外围联动 refreshExtLink 守门测试 ══\n');

// 场景①：修复后（有顶层 sign）
(async () => {
  const a = runCase(true);
  await a.run();
  ok(hasTopLevelSign, 'server.js 顶层存在 sign 定义（修复点）');
  ok(!!a.S.extLink, '①修复后：S.extLink 被成功赋值（外围联动能算出结果）');
  ok(a.logs.length === 0, '①修复后：没有 [extlink] 错误日志（无静默失败）');
  ok(a.pushed.length > 0, '①修复后：触发了外围联动推送');
  if (a.pushed.length) {
    ok(/\+\d/.test(a.pushed[0]), '①修复后：推送文案里的涨幅带 + 号（sign 生效）');
    ok(!/ST垃圾/.test(a.pushed[0]), '①修复后：ST 股被正确过滤');
  }

  // 场景②：修复前（无顶层 sign）—— 对照，证明这个 bug 是真的
  const b = runCase(false);
  await b.run();
  ok(!b.S.extLink, '②修复前对照：S.extLink 拿不到值（证明该缺陷真实存在，功能原本是死的）');
  ok(b.logs.some(x => /is not defined|sign/.test(x)),
    '②修复前对照：catch 吞掉了 ReferenceError（只打日志，不报错 → 静默失败）');

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
