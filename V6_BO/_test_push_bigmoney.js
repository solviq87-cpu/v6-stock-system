// 守门测试：大单流入(bigmoney / bigmoney-B) 推送必达修复（gs 轮，2026-10-13）
// 根因：scanBigMoneyPush 用 type='bigmoney'/'bigmoney-B'，但 govTake 的 forcePush 豁免名单只有 'fastin'，
//       于是大单股被全局 limit-up 胜率门(pushMinProb≈55) 一律拦下（大单股涨停概率天然 8~66），
//       日志实证 `[gov] bigmoney: 0 通过 / 6 条被拦（其中 6 条因预估胜率不足）`。
// 修复：forcePush 纳入 bigmoney / bigmoney-B，与 fastin 一致豁免质量门（胜率门 + D5 实测命中率门），
//       仍受名额/冷却/每只上限/模块日配额约束。
// 守门：抽 govTake 原样真跑（注入其引用的全部顶层符号为可控桩），验证：
//   ① type='bigmoney' 低胜率(13%) → 通过(ok:true)，不再被胜率门拦
//   ② type='bigmoney-B' 低胜率(13%) → 通过(ok:true)
//   ③ type='ztprob' 低胜率(13%) → 拦下(ok:false, why 含「低于门槛」) —— 对照组证明门仍生效
//   ④ type='fastin' 低胜率(13%) → 通过(ok:true) —— 原有豁免不被破坏
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

const SVS = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function cut(src, startStr, endStr) {
  const a = src.indexOf(startStr);
  if (a < 0) throw new Error('找不到起点：' + startStr);
  const b = src.indexOf(endStr, a);
  if (b < 0) throw new Error('找不到终点：' + endStr);
  return src.slice(a, b);
}

console.log('【0】源码可切出 + 修复点就位');
{
  ok('server.js 含 bigmoney/bigmoney-B 豁免', /forcePush = \(type === 'fastin' \|\| type === 'bigmoney' \|\| type === 'bigmoney-B'\)/.test(SVS));
  // ⛔ iq 轮（2026-10-17）：「bigmoney 专属门槛仍在生效：bigMoneyProbGate(涨停候选)、score≥1…」
  //    那句已随 prob 闸门退役改写为「bigmoney 专属门槛现为因子组合≥2…」—— 判据认新文案，
  //    锚的仍是同一处豁免注释块（根因「预估胜率不足」原文未动）。
  ok('豁免注释含根因「预估胜率不足」', /预估胜率不足/.test(SVS) && /bigmoney 专属门槛现为/.test(SVS));
}

// 抽取 govTake 函数体（到下一个 function 起点为止）
const govTakeSrc = cut(SVS, 'function govTake(', 'function govRelease(');
ok('govTake 可被原样切出', govTakeSrc.includes('function govTake('));

// 注入 govTake 引用的全部顶层符号为可控桩（与 gs 轮同款 new Function 沙箱法）
const prelude = `
const PUSH_GOV = { codes: new Map(), total: 0, lowProb: 0, noScore: 0, follow: 0, dropped: 0 };
const NO_SCORE_TYPES = new Set();
const PUSH_GOV_RESERVE = 0.15;
const S = { klines: new Map() };
function govResetIfNewDay(){}
function ztFollowOf(){ return null; }
function _govCfg(k){ return (k === 'pushCooldownMin' || k === 'pushMaxPerCode') ? 0 : 0; }
function pushMinProbEff(){ return 55; }
function pushMinProb(){ return 55; }
function fusedProb(code, name, krows, type, prob){ return { prob: prob, emp: null, empN: 0, delta: 0, empDays: 0 }; }
function todayStr(){ return '2026-10-13'; }
function pushQuota(){ return 120; }
function savePushGov(){}
function krowsOf(){ return undefined; }
`;
let govTake, gov;
try {
  const injected = new Function(prelude + govTakeSrc + '\n; return { govTake, gov: () => PUSH_GOV };')();
  govTake = injected.govTake;
  gov = injected.gov;
} catch (e) {
  console.log('  ❌ govTake 注入失败：' + e.message);
  process.exit(1);
}
ok('govTake 注入可调用', typeof govTake === 'function');

console.log('\n【1】大单流入豁免质量门（低胜率也应通过）');
{
  const r1 = govTake('600894', 'bigmoney', false, 13);
  ok("type='bigmoney' 低胜率(13%) → 通过", r1.ok === true, JSON.stringify(r1));
  const r2 = govTake('600894', 'bigmoney-B', false, 13);
  ok("type='bigmoney-B' 低胜率(13%) → 通过", r2.ok === true, JSON.stringify(r2));
  const r3 = govTake('600894', 'fastin', false, 13);
  ok("type='fastin' 低胜率(13%) → 通过（原有豁免不被破坏）", r3.ok === true, JSON.stringify(r3));
}

console.log('\n【2】对照组：非大单类型仍受胜率门约束');
{
  const r = govTake('600894', 'ztprob', false, 13);
  ok("type='ztprob' 低胜率(13%) → 拦下", r.ok === false, JSON.stringify(r));
  ok("拦下原因含「低于门槛」", r.ok === false && /低于门槛/.test(String(r.why)), JSON.stringify(r.why));
}

console.log('\n【3】大单仍受名额/冷却约束（防刷屏不变）');
{
  // 把当日普通名额耗满（ceiling = round(120*0.85)=102；模拟已推满）
  gov().total = 120;
  const r = govTake('600001', 'bigmoney', false, 13);
  ok('名额耗尽时大单也被拦（仍受总额度约束）', r.ok === false, JSON.stringify(r));
  // 复位后测去重
  gov().total = 0;
  gov().codes.clear();
  const a = govTake('600002', 'bigmoney', false, 50);
  ok('首次可推', a.ok === true, JSON.stringify(a));
  const b = govTake('600002', 'bigmoney', false, 50);
  ok('同只票当天重复 → 拦下（去重仍在）', b.ok === false, JSON.stringify(b));
  gov().codes.clear();
  gov().total = 0;
}

console.log(`\n=== 大单推送必达守门：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
