// 扫描器：dy 轮 —— 「只有一半入口会走到的补救动作」
// 系统里每个「补救」动作通常有两个入口：
//   · 自动入口（启动链/定时器）：机会有限，失败后要留痕、计数、判 bad
//   · 手动入口（面板/API）：用户发现没收到，点一下补发
// 危险模式：手动入口成功了，但 remedy 台账没更新 → 自动侧以为「还没补上」，
//           继续重试/告警；或者手动入口失败了，自动侧的机会早已耗尽，没人兜底。
//
// 查三类：
//   ① 已登记 REMEDY_RULE 的动作，手动入口是否也调 remedyDone/remedySkip
//   ② 有手动入口的补救动作，是否压根没进 REMEDY_RULE
//   ③ 两个入口是否共享同一套闭锁（机会计数/日期标记）
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== dy 轮：补救动作的入口覆盖扫描 ===\n');

// ── 辅助：按花括号配对取块 ──
function blockFrom(anchor) {
  const i = SRC.indexOf(anchor);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
}

// ── ① 已登记的 remedy 动作 ──
const REMEDY_NAMES = [...SRC.matchAll(/remedyDone\('(\w+)'/g)].map(m => m[1]);
const UNIQUE = [...new Set(REMEDY_NAMES)];
console.log('【已登记进 REMEDY_RULE 的补救动作】' + UNIQUE.join('、'));

// 每个动作：在哪些函数/路由里被调用
const CALLS = {};
for (const name of UNIQUE) CALLS[name] = { auto: [], manual: [] };

const lines = SRC.split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const md = l.match(/remedyDone\('(\w+)'/);
  const ms = l.match(/remedySkip\('(\w+)'/);
  const name = md ? md[1] : (ms ? ms[1] : null);
  if (!name) continue;
  let ctx = 'unknown';
  for (let j = i; j >= 0; j--) {
    const lj = lines[j];
    if (/if \(p === '\/api\/\w+'/.test(lj)) { ctx = 'manual:' + lj.match(/'\/api\/(\w+)'/)?.[1]; break; }
    if (/const _\w+ = \(\) =>/.test(lj) || /async function \w+\(/ .test(lj) || /function \w+\(/.test(lj)) {
      const fn = lj.match(/(?:const |function |async function )(_?\w+)/)?.[1];
      if (fn) { ctx = 'auto:' + fn; break; }
    }
    if (/setTimeout\(|setInterval\(/.test(lj)) { ctx = 'auto:timer'; break; }
  }
  const bucket = ctx.startsWith('manual') ? 'manual' : 'auto';
  if (!CALLS[name][bucket].includes(ctx)) CALLS[name][bucket].push(ctx);
}

console.log('\n【每个动作的入口分布（remedyDone/remedySkip 调用点）】');
let issues = 0;
for (const name of UNIQUE) {
  const c = CALLS[name];
  const hasAuto = c.auto.length > 0;
  const hasManual = c.manual.length > 0;
  const status = hasAuto && hasManual ? '✅ 双入口都登记' : (hasAuto ? '⛔ 只有自动入口登记' : (hasManual ? '⛔ 只有手动入口登记' : '❌ 无入口'));
  console.log(`  ${name}: ${status}`);
  if (hasAuto && !hasManual) {
    console.log(`     → 自动入口: ${c.auto.join(', ')}`);
    console.log(`     → ⛔ 手动入口存在，但没调 remedyDone/remedySkip！手动补发后台账仍显示「没补上」`);
    issues++;
  }
  if (!hasAuto && hasManual) {
    console.log(`     → 手动入口: ${c.manual.join(', ')}`);
    console.log(`     → ⛔ 自动入口没登记 remedy！启动链上的失败/重试全进不了台账`);
    issues++;
  }
  if (hasAuto && hasManual) {
    console.log(`     → 自动: ${c.auto.join(', ')}`);
    console.log(`     → 手动: ${c.manual.join(', ')}`);
  }
}

// ── ② 有手动入口、但没进 REMEDY_RULE 的「补救」动作 ──
console.log('\n【② 有手动入口、但未登记进 REMEDY_RULE 的补救动作】');
const KNOWN_MANUAL = [
  { route: '/api/review-digest',  action: 'reviewBoot',    label: '复盘手动补发' },
  { route: '/api/trend-scan',     action: 'bootScan',      label: '趋势扫描手动触发' },
  { route: '/api/kline-backfill', action: 'klineBackfill', label: 'K线手动补齐' },
  { route: '/api/learn-status',   action: 'bootSeed',      label: '学习样本手动补录（/api/learn-status?seed=1）' },
];
for (const k of KNOWN_MANUAL) {
  const hasRoute = SRC.includes("if (p === '" + k.route);
  const inRemedy = UNIQUE.includes(k.action);
  const hasManualRemedy = CALLS[k.action] && CALLS[k.action].manual.length > 0;
  if (!hasRoute) continue;
  if (!inRemedy) {
    console.log(`  ⛔ ${k.label} (${k.route}) → 动作 '${k.action}' 未进 REMEDY_RULE`);
    issues++;
  } else if (!hasManualRemedy) {
    console.log(`  ⛔ ${k.label} (${k.route}) → 已登记 '${k.action}'，但手动入口没调 remedyDone/remedySkip`);
    issues++;
  } else {
    console.log(`  ✅ ${k.label} (${k.route}) → 已登记且手动入口也留痕`);
  }
}

// ── ③ 闭锁共享检查：手动入口是否碰了自动侧的日期/计数变量 ──
console.log('\n【③ 闭锁共享：手动入口是否更新了自动侧的「已补」标记】');
const MANUAL_VARS = [
  { route: '/api/review-digest',  anchor: "if (p === '/api/review-digest'",   varRe: /reviewSentDate\s*=\s*todayStr\(\)/,     name: 'reviewSentDate', desc: '当天复盘已发标记' },
  { route: '/api/auction-digest', anchor: "if (p === '/api/auction-digest'",  varRe: /auctionSentDate\s*=\s*todayStr\(\)/,     name: 'auctionSentDate', desc: '当天竞价已发标记' },
  { route: '/api/trend-scan',     anchor: "if (p === '/api/trend-scan'",      varRe: /_bootScanDone\s*=\s*true/,               name: '_bootScanDone', desc: '启动首扫完成标记' },
  { route: '/api/learn-status',   anchor: "if (p === '/api/learn-status'",    varRe: /remedyDone\('bootSeed'/,                  name: 'remedyDone(bootSeed)', desc: '启动补样本 remedy 登记' },
];
for (const mv of MANUAL_VARS) {
  const blk = blockFrom(mv.anchor);
  if (!blk) {
    console.log(`  ⚠️ ${mv.route} 路由体未找到（可能路由名不对）`);
    continue;
  }
  const hasVar = mv.varRe.test(blk);
  if (hasVar) {
    console.log(`  ✅ ${mv.route} 更新了 ${mv.name}（${mv.desc}）`);
  } else {
    console.log(`  ⛔ ${mv.route} 没更新 ${mv.name}（${mv.desc}）→ 自动侧不知道手动已经补过了`);
    issues++;
  }
}

console.log(`\n【结论】发现 ${issues} 处入口覆盖问题`);
process.exit(issues ? 1 : 0);
