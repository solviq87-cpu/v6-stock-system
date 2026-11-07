// 守门：退市整理期股不计入涨停家数（2026-10-28 用户定调「不计入」）
// ────────────────────────────────────────────────────────────────────────────────
// 背景：002731 萃华退 10-28 收 0.28 真封板（腾讯+东财双源逐字段吻合），池子 74 只里含它。
//   媒体口径的「今日涨停 N 只」不含退市整理期股（它们已不属正常交易生态），用户定调「不计入」。
// 钉的语义（⛔ 一条都不许放松）：
//   ① countsInZtTally：名带「退」→ false；*ST / 普通票 / 空名 → true（判不出不误杀，ST 进池不进推荐是另一条口径）
//   ② 口径实现走「唯一集合法」：S.ztPool 不含退市整理期股 → 面板家数/复盘首行/板块强度/连板梯队/
//      一进二分母/抽查脚本全部自动同口径，不存在两套数字打架
//   ③ 所有「全A快照找封板」的产生点必须同源挡掉（deriveLimitUpMissed / 巡检② / 审计脚本），
//      否则前面剔一只、后面当漏票补一只，巡检还天天报假告警
//   ④ 剔除留痕：S.ztExcluded 下发 /api/state + 面板显示「另剔退市 N」，少的那只去哪了必须说得出来
//   ⑤ 反证：同一只票改回普通名字必须照常算涨停家数（证明是台账口径而非常量关掉）
'use strict';
const fs = require('fs');
const A = require('./analysis.js');
const audit = require('./_audit_zt_pool.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');

const srvSrc = fs.readFileSync('server.js', 'utf8');
const htmlSrc = fs.readFileSync('public/index.html', 'utf8');
const mobSrc = fs.readFileSync('public/mobile.html', 'utf8');

// 把 server.js 的 deriveLimitUpMissed 抽出来真跑（注入真实 analysis，不手写复刻 —— 复刻就是第二把尺子）
function extractFn(src, sig) {
  const re = new RegExp('function ' + sig + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const m = src.match(re);
  return m ? m[0] : null;
}

group('[1] 判据 countsInZtTally：只认「退」，不扩大成 ST');
{
  ok(A.countsInZtTally('萃华退') === false, '萃华退 → 不计入（退市整理期股）');
  ok(A.countsInZtTally('退市海润') === false, '退市海润 → 不计入');
  ok(A.countsInZtTally('*ST和科') === true, '*ST和科 → 计入（ST 是正常交易标的，进池不进推荐是另一条口径）');
  ok(A.countsInZtTally('ST康美') === true, 'ST康美 → 计入');
  ok(A.countsInZtTally('平安银行') === true, '平安银行 → 计入');
  ok(A.countsInZtTally('') === true, '空名 → 计入（判不出不误杀）');
  ok(A.countsInZtTally(undefined) === true, 'undefined → 计入（判不出不误杀）');
  ok(A.countsInZtTally(null) === true, 'null → 计入（判不出不误杀）');
  // 反证：与 isDelistingName 同源，不是各写一份
  ok(A.countsInZtTally('萃华退') === !A.isDelistingName('萃华退'), '反证：countsInZtTally ⟺ !isDelistingName（同一把尺子）');
  ok(A.countsInZtTally('*ST和科') === !A.isDelistingName('*ST和科'), '反证：ST 在两条判据里也不分叉');
}

group('[2] 池 → 家数口径子集（唯一集合法的纯函数）');
{
  const pool = [
    { code: '002731', name: '萃华退', pct: 12 },
    { code: '002816', name: '*ST和科', pct: 9.99 },
    { code: '600000', name: '浦发银行', pct: 10 },
  ];
  const tally = A.ztTallyOf(pool), drop = A.ztDroppedOf(pool);
  ok(tally.length === 2 && drop.length === 1, '3 只池 → 家数 2 只 / 剔除 1 只');
  ok(drop[0].code === '002731', '剔除的正是萃华退');
  ok(tally.map(z => z.code).join(',') === '002816,600000', '家数口径保留 ST 与普通票，顺序不变');
  ok(pool.length === 3, '反证：原池未被就地修改（纯函数，别把调用方的池改了）');
  ok(A.ztTallyOf(null).length === 0 && A.ztTallyOf(undefined).length === 0, '非数组输入 → 空数组（不抛错）');
  ok(A.ztTallyOf([{ code: '1', name: '萃华退' }]).length === 0, '全员被剔 → 空数组（不返回 undefined）');
  ok(A.ztDroppedOf([null, { code: '2', name: '平安银行' }]).length === 0, 'null 元素不被当成"被剔除"');
  // 真实数据复核：本地 10-28 快照 74 → 73（这就是用户看到的 74 vs 73 那只差）
  try {
    const snap = JSON.parse(fs.readFileSync('ztPool_snapshot.json', 'utf8'));
    if (Array.isArray(snap.pool) && snap.pool.length) {
      const t = A.ztTallyOf(snap.pool), d = A.ztDroppedOf(snap.pool);
      ok(t.length === snap.pool.length - d.length, `真实快照 ${snap.pool.length} 只 → 家数 ${t.length} 只 / 剔除 ${d.length} 只`);
      ok(d.every(z => /退/.test(String(z.name || ''))) || d.length === 0, '真实快照里被剔除的全部是名带「退」的票');
    }
  } catch { /* 快照不存在时跳过（不制造假红） */ }
}

group('[3] deriveLimitUpMissed（巡检/补漏/重建的共同源头）：退市股不许当漏票');
{
  const fnSrc = extractFn(srvSrc, 'deriveLimitUpMissed');
  ok(!!fnSrc, '能从 server.js 抽出 deriveLimitUpMissed 函数体');
  if (fnSrc) {
    ok(/A\.countsInZtTally\(s\.name\)/.test(fnSrc), '函数体内确有 countsInZtTally 闸门（不是靠别处挡的）');
    const derive = new Function('A', 'return ' + fnSrc)(A);
    // 快照夹具：真封板的三只 —— 退市股 / ST / 普通票；另加一只触板未封
    const mk = (code, name, price, preClose) => ({ code, name, price, preClose, pct: +((price / preClose - 1) * 100).toFixed(2), open: preClose, high: price, low: preClose * 0.98, amount: 1e7, floatCap: 5e9 });
    const stocks = [
      mk('002731', '萃华退', 0.28, 0.25),     // 低价股分币舍入：pct 12%，但价格就是涨停价
      mk('002816', '*ST和科', 11.00, 10.00),  // ST 真封板
      mk('600999', '普通票', 11.00, 10.00),   // 普通真封板
      mk('603699', '触板未封', 38.39, 34.91), // 收 38.39 / 涨停价 38.40
    ];
    const out = derive(stocks, []);
    const codes = out.map(x => x.code);
    ok(!codes.includes('002731'), '退市整理期股（真封板）不出现在漏票里 —— 不计家数，池里没有是设计如此');
    ok(codes.includes('002816'), 'ST 真封板照常算漏票（口径没误伤 ST）');
    ok(codes.includes('600999'), '普通票真封板照常算漏票');
    ok(!codes.includes('603699'), '触板未封仍不算漏票（严尺子没被这次改动顶掉）');
    // 反证：同一价格、名字去掉「退」→ 必须出现（证明是台账口径，不是把判据整体关掉）
    const out2 = derive([mk('002731', '萃华珠宝', 0.28, 0.25)], []);
    ok(out2.map(x => x.code).includes('002731'), '⛔ 反证：同价同代码、名字去掉「退」→ 必须算漏票（判据没被整体关掉）');
    // 反证：改动前的实现（无 countsInZtTally）确实会返回它
    const oldSrc = fnSrc.replace(/\s*if \(!A\.countsInZtTally\(s\.name\)\) continue;/, '');
    ok(oldSrc !== fnSrc, '反证夹具：能构造出「改动前」的实现用于对照');
    const oldDerive = new Function('A', 'return ' + oldSrc)(A);
    ok(oldDerive(stocks, []).map(x => x.code).includes('002731'), '⛔ 反证：改动前实现确实把萃华退算成漏票（这就是会天天假告警的旧行为）');
  }
}

group('[4] 抽查脚本同一把尺子（auditMissedBySnapshot）');
{
  const mk = (code, name, price, preClose) => ({ code, name, price, preClose, pct: +((price / preClose - 1) * 100).toFixed(2), open: preClose, high: price, low: preClose * 0.98, amount: 1e7, floatCap: 5e9 });
  const stocks = [mk('002731', '萃华退', 0.28, 0.25), mk('600999', '普通票', 11.00, 10.00)];
  const r = audit.auditMissedBySnapshot(stocks, []);
  const codes = r.missed.map(x => x.code);
  ok(!codes.includes('002731'), '审计「全A漏票」不含退市整理期股（否则每天假 WARN）');
  ok(codes.includes('600999'), '审计照常报普通票真封板缺口');
  const r2 = audit.auditMissedBySnapshot([mk('002731', '萃华珠宝', 0.28, 0.25)], []);
  ok(r2.missed.map(x => x.code).includes('002731'), '⛔ 反证：审计对同价普通名照常报（口径没被整体关掉）');
}

group('[5] 生产接线：剔除发生在落库前 + 留痕可查 + 面板说得出');
{
  // ① 池落库前剔除，且顺序在 S.ztPool = zt 之前（晚一步就有几秒两套数字）
  const iFilter = srvSrc.indexOf('A.ztDroppedOf(zt)');
  // 注意：L3422 有一条历史注释里也写着 `S.ztPool = zt;`，所以取最后一次真实赋值，别被注释骗了
  const iAssign = srvSrc.lastIndexOf('S.ztPool = zt;');
  ok(iFilter > 0 && iAssign > iFilter, 'refreshSectorsZT：剔除流程在 S.ztPool = zt 之前');
  ok(/zt = A\.ztTallyOf\(zt\);/.test(srvSrc), '剔除用的是共享纯函数 A.ztTallyOf（不是就地再写一份 filter）');
  ok(/S\.ztExcluded = \{ day: _ztDay/.test(srvSrc), '剔除结果写进 S.ztExcluded 留痕（含归属日）');
  ok(/退市整理期股不计入涨停家数：剔除/.test(srvSrc), '剔除时打日志（谁被剔了必须能查）');
  // ② 巡检②同口径
  const iMon = srvSrc.indexOf('function runDataAccuracyMonitor');
  const monBlock = iMon > 0 ? srvSrc.slice(iMon, iMon + 12000) : '';
  ok(/A\.countsInZtTally\(s\.name\)/.test(monBlock), '巡检②漏票检查同口径（否则每天一条退市股假漏票）');
  // ③ 快照恢复同口径（旧进程写的快照可能还是旧口径）
  ok(/S\.ztPool = _bp\.length \? _bp : z\.pool;/.test(srvSrc), '冷启动快照恢复也过一遍家数口径');
  // ④ 状态与面板留痕
  ok(/ztExcluded: \(S\.ztExcluded && typeof S\.ztExcluded === 'object'\)/.test(srvSrc), '/api/state 下发 ztExcluded（数字少了能查）');
  ok(/excluded: \(S\.ztExcluded && \+S\.ztExcluded\.count\) \|\| 0/.test(srvSrc), '手机速览 digest 带 excluded 只数');
  ok(/另剔退市 \$\{_ztEx\.count\}/.test(htmlSrc), '桌面面板涨停数旁标「另剔退市 N」（不藏数字）');
  ok(/剔退市 ' \+ z\.excluded/.test(mobSrc), '手机速览同标注');
  // ⑤ 不许在池里"留着再过滤"：S.ztPool.length 仍必须是家数口径（防有人改成双集合）
  ok(!/S\.ztAll\s*=/.test(srvSrc), '没有引入 S.ztAll 这类第二集合（避免两套数字打架）');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
