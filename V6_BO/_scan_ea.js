// 扫描器：ea 轮 —— 「时间边界条件」
// 查五类时间相关风险：
//   ① 该用基准日（reviewDataDay/quoteDayOf）的地方用了 todayStr()
//   ② isTradeDay(new Date()) 在凌晨/开盘前的调用——日期已切但数据未切
//   ③ 日期键格式混用：YYYY-MM-DD vs YYYYMMDD 直接比较
//   ④ nextTradeDay/prevTradeDay 返回空串时调用方未处理
//   ⑤ 定时器时间窗口与 isTradeDay 的竞态
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ea 轮：时间边界条件扫描 ===\n');

// ── ① todayStr() 与基准日函数混用 ──
console.log('【① 该用基准日却用了 todayStr()】');
// 已知应该用 reviewDataDay 的场景：复盘标题、复盘面板、复盘推送
const reviewCtx = [...SRC.matchAll(/todayStr\(\)/g)];
let ea1 = 0;
for (const m of reviewCtx) {
  const line = SRC.slice(0, m.index).split('\n').length;
  // 取前后 3 行上下文
  const ctx = SRC.split('\n').slice(Math.max(0, line - 4), line + 2).join('\n');
  // 复盘相关上下文里用 todayStr() = 风险
  if (/review|复盘|作战计划|nextplan/.test(ctx)) {
    // 排除已经改用 reviewDataDay 的
    if (!/reviewDataDay\(\)|quoteDayOf/.test(ctx)) {
      console.log(`  ⛔ 行${line}: 复盘/计划相关代码仍用 todayStr() → 跨天时会标错日期`);
      ea1++;
    }
  }
}
if (!ea1) console.log('  ✅ 未发现复盘/计划路径混用 todayStr()');

// ── ② isTradeDay(new Date()) 的调用场景 ──
console.log('\n【② isTradeDay(new Date()) 调用场景（凌晨风险）】');
const tradeDayCalls = [...SRC.matchAll(/isTradeDay\(new Date\(\)\)/g)];
let ea2 = 0;
for (const m of tradeDayCalls) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 5), line + 3).join('\n');
  // 如果在定时器/循环里直接调，凌晨有风险
  const inTimer = /setInterval|setTimeout/.test(ctx);
  const inLoop = /while|for\s*\(/.test(ctx);
  if (inTimer || inLoop) {
    console.log(`  ⚠️ 行${line}: isTradeDay(new Date()) 在定时器/循环中 —— 凌晨 00:00 后日期已切、数据可能未切`);
    ea2++;
  }
}
if (!ea2) console.log('  ✅ 无定时器中的 isTradeDay(new Date())');

// ── ③ 日期键格式混用 ──
console.log('\n【③ 日期键格式混用（YYYY-MM-DD vs YYYYMMDD）】');
let ea3 = 0;
// 搜 "day === todayStr()" 或类似直接比较
const cmpPattern = /(day|date|ds)\s*===?\s*todayStr\(\)/g;
for (const m of SRC.matchAll(cmpPattern)) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 3), line + 2).join('\n');
  // 如果 todayStr() 返回 YYYYMMDD，而左边是 YYYY-MM-DD，会恒 false
  if (/replace\(/g.test(ctx)) continue; // 已经做了 replace 转换
  console.log(`  ⚠️ 行${line}: 日期直接比较，需确认格式一致`);
  ea3++;
}
// 更直接的：搜 "replace(/-/g, '')" 看哪些地方需要转换
const replaceDash = [...SRC.matchAll(/replace\(-\/g,\s*''\)/g)];
if (replaceDash.length) {
  console.log(`  ℹ️ 发现 ${replaceDash.length} 处 replace(/-/g,'') 转换 —— 说明存在格式混用（已处理）`);
}
if (!ea3) console.log('  ✅ 未发现未处理的日期格式混用');

// ── ④ nextTradeDay/prevTradeDay 空串处理 ──
console.log('\n【④ nextTradeDay/prevTradeDay 返回空串的处理】');
let ea4 = 0;
for (const fn of ['nextTradeDay', 'prevTradeDay']) {
  const calls = [...SRC.matchAll(new RegExp(fn + '\\([^)]*\\)', 'g'))];
  for (const m of calls) {
    const line = SRC.slice(0, m.index).split('\n').length;
    const ctx = SRC.split('\n').slice(Math.max(0, line - 2), line + 4).join('\n');
    // 检查返回值是否被判空
    const hasGuard = /if\s*\(|\|\||\?\?|\?\s*['"`]/.test(ctx);
    if (!hasGuard) {
      console.log(`  ⛔ 行${line}: ${fn}() 返回值未做空串保护`);
      ea4++;
    }
  }
}
if (!ea4) console.log('  ✅ nextTradeDay/prevTradeDay 调用均有空串保护');

// ── ⑤ 时间窗口与 isTradeDay 竞态 ──
console.log('\n【⑤ 时间窗口与交易日判断的竞态】');
let ea5 = 0;
// 搜 "wd >= 1 && wd <= 5" 与 isTradeDay 的组合
const wdChecks = [...SRC.matchAll(/wd\s*>=?\s*1.*wd\s*<=?\s*5/g)];
for (const m of wdChecks) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 3), line + 5).join('\n');
  const alsoIsTrade = /isTradeDay/.test(ctx);
  if (!alsoIsTrade) {
    console.log(`  ⛔ 行${line}: 只判了 weekday(1-5)，没调 isTradeDay —— 国庆假期里的周五会被误判为交易日`);
    ea5++;
  }
}
if (!ea5) console.log('  ✅ 无孤立的 weekday 判断（均配合 isTradeDay）');

const total = ea1 + ea2 + ea3 + ea4 + ea5;
console.log(`\n【结论】发现 ${total} 处时间边界风险`);
process.exit(total ? 1 : 0);
