// 锁死「推送降噪」：单模块不许把全天名额吃光
// 背景（2026-10-01 用户原话）：「你推送的太多了啊跟菜市场一样全是票」
//   查实 9/30 全天 250 条飞书推送里，**补涨龙一个模块独占 ~110 条（44%）**。
//   根因：① 每只票单独 pushAll 一条 ② 30 分钟去重是按【票】不是按【模块】
//        ③ 完全没有单模块每日上限。
// 这里锁三件事：上限表存在且合理、modDayTake 真的会封顶、补涨龙里它的位置在 logSignal 之前。
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// 抽出 modDayTake 与常量，独立跑一遍（不启动服务）
function cut(name, kind) {
  const i = SRC.indexOf(kind + ' ' + name);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { d++; started = true; }
    else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
}

sec('① 单模块每日上限表');
{
  const capSrc = cut('MOD_DAY_CAP', 'const');
  ok(!!capSrc, 'MOD_DAY_CAP 存在');
  const cap = eval('(' + capSrc.replace('const MOD_DAY_CAP =', '').replace(/;$/, '') + ')');
  ok(typeof cap === 'object', '是对象');
  ok(cap.buzhang != null && cap.buzhang <= 8, '补涨龙单日 ≤8 条（9/30 实测 110 条）', cap.buzhang);
  ok(cap.steadyup != null, '连续收涨模块也有上限', cap.steadyup);
  const vals = Object.values(cap);
  ok(vals.every(v => v > 0 && v <= 12), '所有模块的日上限都在 1~12 之间', JSON.stringify(cap));
  ok(Object.keys(cap).length >= 10, '覆盖的模块数 ≥10', Object.keys(cap).length);
}

sec('② modDayTake：真的会封顶、按天重置');
{
  // ⚠️ 2026-10-06 补：modDayTake 现在会在计数后调 savePushGov()（bi 版加的当日额度落盘），
  //    单独摘这个函数求值时要给它一个空替身，否则 ReferenceError 把整个套件打崩。
  //    这里测的是"封顶与按天重置"，落盘是副作用，替身不影响被测行为。
  const src = cut('modDayTake', 'function') + '\n' + cut('MOD_DAY_CAP', 'const') + '\nconst MOD_DAY_DEFAULT = 12;\nconst _modDay = { day: "", n: {} };\nfunction todayStr(){ return "2026-10-01"; }\nfunction savePushGov(){}\n';
  let modDayTake;
  try { modDayTake = new Function(src + '; return modDayTake;')(); } catch (e) { ok(false, 'modDayTake 可独立求值', e.message); }
  if (modDayTake) {
    const cap = eval('(' + cut('MOD_DAY_CAP', 'const').replace('const MOD_DAY_CAP =', '').replace(/;$/, '') + ')');
    let n = 0;
    for (let i = 0; i < 50; i++) if (modDayTake('buzhang')) n++;
    ok(n === cap.buzhang, `连调 50 次只放行 ${cap.buzhang} 次（封顶生效）`, n);
    ok(modDayTake('buzhang') === false, '封顶后再调返回 false');
    ok(modDayTake('other_module') === true, '未配置的模块走默认值、且不受别的影响');
    // 跨天重置
    const src2 = src.replace('return "2026-10-01";', 'return global.__DAY;');
    const f2 = new Function(src2 + '; return modDayTake;')();
    global.__DAY = '2026-10-01';
    for (let i = 0; i < 50; i++) f2('pre');
    ok(f2('pre') === false, '同一天额度耗尽');
    global.__DAY = '2026-10-02';
    ok(f2('pre') === true, '换一天后额度重置');
  }
}

sec('③ 补涨龙：modDayTake 必须在 logSignal 之前');
{
  const i = SRC.indexOf('async function computeBuZhang');
  const j = SRC.indexOf('\n}\n', SRC.indexOf('pushAll(`═══ 🔥 补涨龙', i));
  const body = SRC.slice(i, j > 0 ? j : i + 6000);
  const iTake = body.indexOf("modDayTake('buzhang')");
  const iLog = body.indexOf("logSignal('buzhang'");
  const iPush = body.indexOf('pushAll(`═══ 🔥 补涨龙');
  ok(iTake > 0, '补涨龙里用了 modDayTake');
  ok(iLog > 0, '补涨龙里用了 logSignal');
  ok(iTake < iLog, '⚠️ modDayTake 在 logSignal 之前（写反会每 tick 重复登记、污染标定）', `take@${iTake} < log@${iLog}`);
  ok(iTake < iPush, 'modDayTake 也在 pushAll 之前');
  // 额度用尽时必须顺手把 bzLastPush 设上，否则下个 tick 又重进循环
  const seg = body.slice(iTake, iTake + 120);
  ok(/S\.bzLastPush\s*=\s*now/.test(seg), '额度用尽时设置 bzLastPush（否则下个 tick 又进来一次）', seg.trim().slice(0, 60));
  ok(/S\.bzLastPush\s*\|\|/.test(body), '存在 30 分钟模块级节流（不是按票去重）');
  ok(/catch\s*\{\}\s*$|try\s*\{/.test(body), '整段在 try 里（异常不影响面板）');
  // 合并推送：一条消息里带多只，而不是每只一条
  ok(/slice\(0,\s*4\)/.test(body), '一轮最多带 4 只（合并成一条消息）');
}

sec('④ 连续收涨模块：存在且受限');
{
  ok(/async function scanSteadyUp/.test(SRC), 'scanSteadyUp 存在');
  ok(/function pushSteadyUp/.test(SRC), 'pushSteadyUp 存在');
  ok(/modDayTake\('steadyup'\)/.test(SRC), '连续收涨也走单模块上限');
  ok(/'\/api\/steady-up'/.test(SRC), '有 /api/steady-up 可手动触发');
  ok(/scanSteadyUp\(/.test(SRC), '定时链路里真的调了 scanSteadyUp');
  ok(/pushSteadyUp\(\)/.test(SRC), '定时链路里真的调了 pushSteadyUp');
  // 判据：连涨≥3、每天温和上涨、站上20日线且向上
  const si = SRC.indexOf('async function scanSteadyUp');
  // ⚠️ 窗口别钉太小：判据 `if (run < 3) continue` 在函数里偏后的位置，
  //    前面每加一段代码（如 bv 那轮加的基准日采集）就会把它挤出窗口 → 假红灯。
  //    取到函数结尾而不是固定字符数（下一个顶层 function 之前）。
  const _nx = SRC.indexOf('\nfunction ', si + 10);
  const sb = SRC.slice(si, _nx > 0 ? _nx : si + 8000);
  ok(/run\s*<\s*3|run\s*>=\s*3|runUp\s*>=\s*3|连涨/.test(sb), '判据含"连涨≥3天"');
  ok(/ma20/i.test(sb), '判据含 20 日线');
}

sec('⑤ 全市场趋势扫描存在');
{
  ok(/scanTrendUniverse/.test(SRC), 'scanTrendUniverse 存在（不依赖候选集）');
  ok(/pushTrendScan/.test(SRC), 'pushTrendScan 存在');
  ok(/'\/api\/trend-scan'/.test(SRC), '有 /api/trend-scan');
  ok(/trendScan/.test(SRC), 'S.trendScan 已挂到 state');
}


sec('⑥ 名称回退：不能把代码当名字显示');
{
  // 线上实测：全市场扫描 Top1 显示成「600383 600383」——
  // 根因 `const name = k.name || code`：K线缓存的 name 常是**空字符串**，
  // 于是 name 直接变成 code（真值），后面的 nameOfCode 永远轮不到。
  ok(/const nm = k\.name \|\| nameOfCode\(code\) \|\| code;/.test(SRC), '历史学习入库：用 nm 回退，不再 `k.name || code`');
  ok(/const name = k\.name \|\| nameOfCode\(code\) \|\| code;/.test(SRC), '全市场扫描：name 走 nameOfCode 回退');
  ok(/const i = rows\.length - 1, name = k\.name \|\| nameOfCode\(code\) \|\| code;/.test(SRC), '连续收涨：同样走 nameOfCode 回退');
  // 曾经的写法必须消失（留着就还会出现代码当名字）
  ok(!/name: k\.name \|\| code/.test(SRC), '已无 `name: k.name || code` 残留');
  ok(!/isLimitUp\(code, k\.name \|\| code/.test(SRC), 'isLimitUp 不再拿 code 当名字（否则 ST/20cm 的限幅判不出）');
  // nameOfCode 建了索引：全市场 4000 只 × S.stocks 5559 不能是 O(n) 线性扫
  ok(/_nameIdx = new Map\(\)/.test(SRC), 'nameOfCode 用 Map 索引（不是每只票线性扫 S.stocks）');
}

console.log(`\n${fail === 0 ? '🎉' : '💥'} 推送降噪测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
