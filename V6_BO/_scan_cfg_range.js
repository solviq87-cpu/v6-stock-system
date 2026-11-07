// 配置项取值域体检扫描器（本轮角度：配置项的取值域与量纲）。
// 守门测试 _test_cfg_range.js 只钉住已确认修复的那一个入口；这个扫描器负责列全：
//   A. 所有被读取的数值型配置键（_govCfg / S.config.X）→ 默认值是多少
//   B. 哪些键登记进了 CFG_RANGE（有上界），哪些没有（越界无人拦）
//   C. /api/config 写入端实际收哪些键，与 CFG_RANGE 是否一一对应
//   D. 自动调参（SelfOptimize）写回的阈值是否自带钳制
//   E. 量纲：0~1 的比例键 与 0~100 的百分数键各有哪些（混在一个接口里最容易填错）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src, { keepStrings: true });
const L = code.split('\n');

// CFG_RANGE 先解析（A 段要拿 def 当默认值展示）。
// ⛔ iq 轮修：dh 轮给每个键加了 `def:` 字段后，旧正则 `\{\s*min:` 一个都匹配不上 →
//   本扫描器一直打印「登记 0 个」（假事实，比不打印更坏）。改成允许 def 在 min 之前。
const rs = /const CFG_RANGE = \{([\s\S]*?)\n\};/.exec(src);
const range = {};
if (rs) {
  for (const m of rs[1].matchAll(/(\w+):\s*\{[^}]*?min:\s*([-\d]+),\s*max:\s*([^,]+),/g)) range[m[1]] = { min: +m[2], max: m[3].trim() };
  for (const m of rs[1].matchAll(/(\w+):\s*\{\s*def:\s*([-\d.]+),/g)) if (range[m[1]]) range[m[1]].def = +m[2];
}

// ---- A. 所有被读取的数值型配置键 ----
console.log('═══ A. 被读取的数值型配置键（_govCfg / S.config.X）═══');
// ⛔ iq 轮修：dg 轮把 _govCfg 从双参 (k, def) 收成单参 (k)（默认值进 CFG_RANGE.def），
//   旧正则还在匹配 `_govCfg('k', 52)` → 数值键全部漏检、只剩字符串键（假事实）。
const reads = new Map();   // key -> Set(默认值)
for (const l of L) {
  let m = /_govCfg\('([^']+)'\)/.exec(l);
  if (m) {
    if (!reads.has(m[1])) reads.set(m[1], new Set());
    reads.get(m[1]).add(range[m[1]] && range[m[1]].def !== undefined ? String(range[m[1]].def) : '(表里无 def)');
    continue;
  }
  m = /S\.config\.(\w+)/.exec(l);
  if (m && !/S\.config\.\w+\s*=/.test(l)) {
    if (!reads.has(m[1])) reads.set(m[1], new Set());
    reads.get(m[1]).add('(直读)');
  }
}
for (const [k, defs] of [...reads].sort()) console.log(`  ${k.padEnd(22)} 默认值 ${[...defs].join(' / ')}`);

// ---- B. CFG_RANGE 覆盖情况 ----
console.log('\n═══ B. CFG_RANGE 覆盖情况（无上界 = 越界无人拦）═══');
for (const [k, defs] of [...reads].sort()) {
  const r = range[k];
  console.log(`  ${k.padEnd(22)} ${r ? `✅ ${r.min}~${r.max}` : '— 未登记（多数是字符串型或只在代码里自动调，非用户输入）'}`);
}
console.log(`  小计：登记 ${Object.keys(range).length} 个 / 读取 ${reads.size} 个`);

// ---- C. /api/config 写入端收哪些键 ----
console.log('\n═══ C. /api/config 写入端 vs CFG_RANGE ═══');
const i = src.indexOf("p === '/api/config' && req.method === 'POST'");
const blk = i >= 0 ? src.slice(i, i + 12000) : '';
const takesNum = /for \(const k of Object\.keys\(CFG_RANGE\)\) if \(c\[k\] !== undefined/.test(blk);
console.log(`  ${takesNum ? '✅' : '⚠️'} 数值键统一由 CFG_RANGE 驱动（加键=加校验，不会漏）`);
// ⛔ 只拿【走 _govCfg 读取】的键做漏项筛查 —— 那才是数值型闸门。
//    按命名规则（/^push/）筛会把 pushRole 这种字符串键也算进来（实测误报）。
const numericKeys = [...reads.entries()].filter(([, defs]) => ![...defs].includes('(直读)')).map(([k]) => k);
const missed = numericKeys.filter(k => !range[k]);
console.log(`  ${missed.length ? '⚠️ 数值型闸门里没登记的：' + missed.join(', ') : `✅ ${numericKeys.length} 个 _govCfg 数值键全部登记（无漏项）`}`);
// 直读的数值键：没走 _govCfg，也不在 /api/config 白名单里 —— 只能是手改 config.json，列出备查
const directNum = [...reads.entries()].filter(([k, defs]) => [...defs].includes('(直读)') && /Hours|Threshold|Pct|Gate|Prob/i.test(k) && !range[k]);
console.log(`  备查：直读且未登记的数值键 ${directNum.length ? directNum.map(([k]) => k).join(', ') : '无'}（改它只能手改 config.json，不是接口风险）`);

// ---- D. 自动调参是否自带钳制 ----
console.log('\n═══ D. 自动调参写回阈值时是否自带钳制 ═══');
// ⛔ iq 轮（2026-10-17）：bigMoneySelfOptimize 更名 bigMoneyStatsRefresh 后只剩统计刷新、
//    不写回任何阈值（prob 对这一类是反指标，整条退役）—— 自学习闭环从 3 个缩到 2 个。
for (const fn of ['trendSelfOptimize', 'similarSelfOptimize']) {
  const at = src.indexOf('function ' + fn + '(');
  if (at < 0) { console.log(`  ${fn} 未找到`); continue; }
  const body = src.slice(at, at + 2600);
  const writes = /S\.config\.(\w+)\s*=\s*(nv|Math)/.test(body);
  const clamped = /Math\.(min|max)\(/.test(body);
  console.log(`  ${fn.padEnd(22)} 写回 ${writes ? '有' : '无'} / 钳制 ${clamped ? '✅ 有' : '❌ 无'}`);
}
{
  const at = src.indexOf('function bigMoneyStatsRefresh(');
  const body = at >= 0 ? src.slice(at, at + 400) : '';
  console.log(`  ${'bigMoneyStatsRefresh'.padEnd(22)} 写回 ${/S\.config\./.test(body) ? '有（⛔ 不该有）' : '无（✅ 已退役，只刷新统计）'}`);
}

// ---- E. 量纲分组 ----
console.log('\n═══ E. 量纲分组（同一个接口里两种量纲并存，是最容易填错的地方）═══');
const pctish = Object.keys(range).filter(k => range[k].max === '100');
const ratio = Object.keys(range).filter(k => range[k].max === '1');
const other = Object.keys(range).filter(k => !pctish.includes(k) && !ratio.includes(k));
console.log('  0~100 百分数：' + (pctish.join(', ') || '无'));
console.log('  0~1   比例  ：' + (ratio.join(', ') || '无') + '   ← 填 82 会被判成 8200%');
console.log('  其它量纲    ：' + (other.map(k => `${k}(0~${range[k].max})`).join(', ') || '无'));

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由 _test_cfg_range.js 钉死。）');
