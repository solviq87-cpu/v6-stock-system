// 守门：回测分片让出事件循环（2026-10-22 ju 轮自查修复）
//
// 背景（三层根因，表象只是 routes_smoke 一条红）：
//   原 /api/backtest 在请求处理器里【同步】跑完整个回测 —— 全市场约 5000 只×35 个交易日
//   ≈17.5 万次评分，实测把事件循环堵死 3 分钟：
//    ① 线上观看设备的 /api/state、/api/mobile-digest、SSE 全部排队 = 面板卡死 3 分钟；
//    ② 冒烟测试（本机回环免检=开发者）打到 /api/backtest 真触发回测，下一个路由
//       /api/backtest/result 排在 3 分钟后面，90 秒超时 → 「连接被关闭，无任何响应」
//       稳定红（真因是事件循环被堵死，不是路由死了）；
//    ③ 测试进程退出后回测还在烧 CPU，拖垮随后时序敏感的套件（_runall 时红时绿的来源之一）。
//   修法：analysis.js 拆成 backtestSteps（生成器核心，唯一算法实现）+ backtest（同步版，
//   语义原样保留）+ backtestAsync（每个 yield 点 await setImmediate 让出循环）；
//   server.js 路由改异步分片跑；冒烟测试把 /api/backtest 列入跳过。
//
// 本套件钉死：
//   ① 异步版与同步版【结果完全一致】（分片不许改语义 —— 改一点回测口径就全歪了）
//   ② 异步版确实让出事件循环（跑的过程中定时器能插进来）
//   ③ 同步版仍然是同步的（一次性脚本/守门真跑依赖它，且它必须阻塞才叫同步）
//   ④ server.js 路由真的改用 backtestAsync，pending 收尾三件套（发声/失败态/finally）不缺
//   ⑤ 冒烟测试跳过 /api/backtest（防回归：谁把 skip 删了，_runall 又会被 3 分钟 CPU 拖）
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const ROOT = __dirname;
const ASRC = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const RS = fs.readFileSync(path.join(ROOT, '_test_routes_smoke.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg, detail) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg + (detail ? '  → ' + detail : '')); } }

// ───────────────────────── 抠函数体 + 配依赖桩真跑 ─────────────────────────
// 花括号配平取函数体（注释先剥掉，防止注释里的括号干扰计数）
function extractFn(src, name) {
  const clean = stripNoise(src, { keepStrings: true });
  const re = new RegExp('(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(');
  const m = re.exec(clean);
  if (!m) return null;
  const j = clean.indexOf('{', m.index);
  if (j < 0) return null;
  let depth = 0;
  for (let k = j; k < clean.length; k++) {
    if (clean[k] === '{') depth++;
    else if (clean[k] === '}') { depth--; if (depth === 0) return clean.slice(m.index, k + 1); }
  }
  return null;
}

// 依赖桩：确定性假函数（同步/异步两版跑同一份桩，等价性比较才有意义）
const STUBS = `
function calcProfitRatio(rows) { return (rows.length % 11) / 10; }
function isLimitUp(code, name, pct) { return pct >= 9.5; }
function scoreStock(o) {
  let s = (o.pct || 0) * 0.5 + (o.profitRatio || 0) * 10 + (o.zt90 || 0) * 2 + (o.zt5 || 0) * 3;
  if (o.turnoverRank2d <= 300) s += 5;
  return { score: Math.round(s * 10) / 10 };
}
`;

const stepsSrc = extractFn(ASRC, 'backtestSteps');
const btSrc = extractFn(ASRC, 'backtest');
const btaSrc = extractFn(ASRC, 'backtestAsync');

// 确定性伪随机 universe（LCG，不依赖 Math.random，保证两次跑同一份数据）
function mkUniverse(n, days) {
  let seed = 20261022;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const out = [];
  for (let s = 0; s < n; s++) {
    const code = '6000' + String(s).padStart(3, '0');
    const rows = [];
    let close = 10 + rnd() * 30;
    for (let d = 0; d < days; d++) {
      const pct = +((rnd() - 0.42) * 14).toFixed(2);
      close = +(close * (1 + pct / 100)).toFixed(2);
      rows.push({
        date: '2026-08-' + String(1 + (d % 28)).padStart(2, '0'),
        code, name: '测' + s,
        open: +(close * (1 - pct / 200)).toFixed(2), close, pct,
        high: +(close * 1.02).toFixed(2), low: +(close * 0.98).toFixed(2),
        turnover: +(rnd() * 25).toFixed(2), volume: 1000 + Math.floor(rnd() * 9000)
      });
    }
    out.push({ code, name: '测' + s, rows });
  }
  return out;
}

(async () => {
  console.log('【1】三个函数都在，且能配桩真跑');
  ok(!!stepsSrc && !!btSrc && !!btaSrc, 'backtestSteps / backtest / backtestAsync 函数体都抠出来了',
    [!!stepsSrc, !!btSrc, !!btaSrc].join(','));
  ok(/function\* backtestSteps/.test(stepsSrc || ''), '核心是生成器（function* backtestSteps）');
  if (!(stepsSrc && btSrc && btaSrc)) {
    console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
    process.exit(1);
  }
  const SB = new Function(stepsSrc + '\n' + btSrc + '\n' + btaSrc + '\n' + STUBS
    + '\nreturn { backtestSteps, backtest, backtestAsync };')();

  console.log('\n【2】异步版与同步版结果完全一致（分片不许改语义）');
  {
    const U = mkUniverse(120, 60);
    const a = SB.backtest(U, 40);
    const b = await SB.backtestAsync(U, 40);
    ok(JSON.stringify(a) === JSON.stringify(b),
      '同一份数据：backtest 与 backtestAsync 输出逐字节相同');
    ok(a && typeof a.then !== 'function', '同步版返回普通对象（不是 Promise）');
    ok(a.股票数 === 120 && a.总样本 > 0 && a.分数段命中率 && a.明细样本.length <= 30,
      '统计口径不变（股票数 120 / 总样本>0 / 四个分桶 / 明细≤30 条）',
      '股票数=' + a.股票数 + ' 总样本=' + a.总样本);
    ok(SB.backtest([], 40).总样本 === 0 && SB.backtest(null, 40).总样本 === 0,
      '空 universe 不炸也不伪造（0 样本，缺数据≠造假数据）');
  }

  console.log('\n【3】异步版真的让出事件循环；同步版真的阻塞');
  {
    const it = SB.backtestSteps(mkUniverse(5, 60), 40);
    let yields = 0;
    let r = it.next();
    while (!r.done) { yields++; r = it.next(); }
    ok(yields === 5, '生成器每算完一只票 yield 一次（5 只→5 次）', 'yields=' + yields);

    // 异步：跑的过程中，并发 setImmediate 链必须能插进来
    const U = mkUniverse(300, 60);
    let ticks = 0, running = true;
    const chain = () => { if (!running) return; ticks++; setImmediate(chain); };
    setImmediate(chain);
    const p = SB.backtestAsync(U, 40);
    await new Promise(res => setTimeout(res, 25));
    const midTicks = ticks;
    const res = await p;
    running = false;
    ok(midTicks >= 20, '回测运行中事件循环是自由的（25ms 内并发定时器 ticks≥20）', 'ticks=' + midTicks);
    ok(res.股票数 === 300 && res.总样本 > 0, '让出循环不影响结果完整性（300 只全部算完）');

    // 同步：跑的过程中定时器一次都跑不了（这才叫阻塞，才需要被修掉）
    let ticks2 = 0, running2 = true;
    const chain2 = () => { if (!running2) return; ticks2++; setImmediate(chain2); };
    setImmediate(chain2);
    const syncRes = SB.backtest(mkUniverse(50, 60), 40);
    const during = ticks2;
    running2 = false;
    ok(during === 0 && syncRes && typeof syncRes.then !== 'function',
      '同步版跑的过程中定时器插不进来（阻塞语义原样保留）', 'during=' + during);
  }

  console.log('\n【4】server.js 路由接线（异步分片 + pending 收尾三件套）');
  {
    const CODE_K = stripNoise(SV, { keepStrings: true });
    const i = CODE_K.indexOf("if (p === '/api/backtest')");
    const j = CODE_K.indexOf("if (p === '/api/backtest/result')");
    ok(i > 0 && j > i, '找到 /api/backtest 路由块');
    const BT = CODE_K.slice(i, j);
    ok(/A\.backtestAsync\(/.test(BT), '路由改用异步分片 A.backtestAsync');
    ok(!/A\.backtest\(/.test(BT), '旧写法（处理器内同步 A.backtest）已不存在');
    ok(/json\(res, \{ pending: true \}\)/.test(BT), '仍是先秒回 pending 再后台跑');
    ok(/S\.backtestPending/.test(BT), '防重入标志 S.backtestPending 仍在');
    ok(/pushLog\('❌ 回测失败'/.test(BT), '失败进推送流水发声（pending 承诺有收尾，_test_pending_promise 同口径）');
    ok(/S\.backtestErr = \(e && e\.message\) \|\| String\(e\);/.test(BT),
      '失败态判据行原样保留（_test_pending_promise 钉死的那一行）');
    ok(/finally\s*\{\s*S\.backtestPending = false;/.test(BT), 'finally 里释放 pending（异常也不永久悬着）');
    ok(/const nameOf = new Map\(\);/.test(BT), 'universe 构建改用一次 Map（不再是逐票 find 的 O(n²)）');
  }

  console.log('\n【5】导出与冒烟测试回归锁');
  {
    const EXP = ASRC.slice(ASRC.lastIndexOf('module.exports'));
    ok(/\bbacktestAsync\b/.test(EXP) && /\bbacktestSteps\b/.test(EXP), 'analysis.js 导出 backtestAsync / backtestSteps');
    ok(/\bbacktest\b/.test(EXP), '同步版 backtest 仍在导出名单里（不许被顺手删掉）');
    ok(/'\/api\/backtest'/.test(RS), '冒烟测试把 /api/backtest 列入跳过（防 _runall 被 3 分钟 CPU 拖）');
    ok(/'\/api\/stream'/.test(RS), '冒烟测试仍跳过 SSE 长连接（回归锁）');
  }

  console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('套件本身崩了：', e); process.exit(1); });
