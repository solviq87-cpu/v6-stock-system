// 扫描器：找「先改内存、后校验、失败就 return」的写接口 —— 即写入端与校验端顺序颠倒的地方。
//
// 与本轮守门测试 _test_write_validate.js 是同一件事的两面：
//   测试只钉住已经修好的 /api/config 一处；这个扫描器负责**找还有没有第二处**。
//
// 判据（按路由块为单位）：
//   1. 块内先把某个全局状态改了（S.xxx = / S.xxx.yyy = / HD.xxx = 之类）
//   2. 之后出现一个"校验不通过就退出"的 return（ok:false / 4xx / 报错文案）
//   3. 且在这两者之间**没有**落盘动作
//   → 命中。此时磁盘是旧的、内存是新的，而接口却回给用户"没改动/保存失败"。
//
// 另外单独列出「整块改了内存但一次都没落盘」的路由（上一轮"改了内存但没落盘"的残留复核）。
//
// ⛔ 这是**扫描器不是测试**：只负责把可疑点摆出来供人工复核，永远 exit 0。
//   误报来源已知：纯内存缓存赋值（S.xxxCache =）、以及 return 命中了"未知的键"这类泛用词。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const CODE = stripNoise(SV);            // 剥注释+字符串+正则 → 大括号配平不会被字符串干扰
const CODE_K = stripNoise(SV, { keepStrings: true });

const lineOf = i => SV.slice(0, i).split('\n').length;

// ── 切路由块：从 `if (p === '/api/xxx'` 的花括号起，做括号配平找到块尾 ──
function routeBlocks() {
  const out = [];
  const re = /\bif \(p === '(\/api\/[^']+)'/g;
  let m;
  // ⛔ 必须用保留字符串的 CODE_K 找路由：默认 CODE 会把 '/api/xxx' 整段涂成空格 → 找到 0 个块（实测踩过）
  while ((m = re.exec(CODE_K))) {
    let b = CODE.indexOf('{', m.index);
    if (b < 0) continue;
    let depth = 0, end = b;
    for (let i = b; i < CODE.length; i++) {
      const c = CODE[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    out.push({ route: m[1], start: b, end, i0: m.index });
  }
  return out;
}

// 落盘动作
const SAVE_RE = /\b(saveCfg|savePaper|saveAccess|saveLearn|saveNews|saveHoldings|saveState|saveSignals|saveKline|save[A-Z]\w*)\s*\(\s*\)/g;
// 改内存（全局状态赋值）。排除纯缓存/临时变量：以 Cache/_ 开头的键噪音太大，单独降级处理
const MUT_RE = /\b(S|HD|CFG|MSG_STAT)\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*\s*=(?!=)/g;
const CACHE_RE = /\bS\.[A-Za-z_$][\w$]*(?:Cache|_bak|Snap|Tmp|Temp)\b/;
// 校验失败就退出
const BADRET_RE = /\breturn\b[^;]*(?:ok:\s*false|status:\s*40[0-9]|\b4[0-9][0-9]\b|错误|不合法|未保存|不通过|拒绝)/g;

const blocks = routeBlocks();
const hits = [];
const noSave = [];

for (const b of blocks) {
  const body = CODE.slice(b.start, b.end);
  const bodyK = CODE_K.slice(b.start, b.end);
  const off = b.start;

  // 赋值/落盘只认活代码（CODE），避免中文报错文案里出现的 "S.xxx" 造成幽灵命中
  const muts = [...body.matchAll(MUT_RE)]
    .map(m => ({ i: m.index, txt: m[0].replace(/\s+/g, ' ') }))
    .filter(x => !CACHE_RE.test(x.txt));
  if (!muts.length) continue;

  const saves = [...body.matchAll(SAVE_RE)].map(m => m.index);
  // 退出语句要在 CODE_K 上找：ok:false 是代码、"配置未保存"是字符串，两边都得看见
  const bads = [...bodyK.matchAll(BADRET_RE)]
    .map(m => ({ i: m.index, txt: (bodyK.slice(m.index, m.index + 90).match(/[^\n]*/) || [''])[0].trim().slice(0, 70) }));

  for (const r of bads) {
    // 这个 return 之前改过内存、且中间没落盘 → 命中
    const before = muts.filter(x => x.i < r.i);
    if (!before.length) continue;
    const savedBetween = saves.some(s => s > before[before.length - 1].i && s < r.i);
    if (savedBetween) continue;
    hits.push({
      route: b.route, line: lineOf(off + r.i), retLine: lineOf(off + r.i),
      mutLine: lineOf(off + before[before.length - 1].i),
      mut: before[before.length - 1].txt, ret: r.txt,
    });
  }

  if (!saves.length) {
    noSave.push({ route: b.route, line: lineOf(off + muts[0].i), mut: muts[0].txt, n: muts.length });
  }
}

console.log('=== 扫描：写接口「先改内存、后校验、失败就跑」 ===');
console.log('路由块总数：' + blocks.length + '（含 GET）\n');

if (!hits.length) {
  console.log('对勾 没有命中：所有"校验失败就退出"的 return 之前都没有未落盘的内存改动。');
} else {
  console.log('⚠️ 命中 ' + hits.length + ' 处（需人工复核，可能是纯缓存/临时量）：\n');
  for (const h of hits) {
    console.log(`  ${h.route}  L${h.retLine}`);
    console.log(`      改内存 @L${h.mutLine}: ${h.mut}`);
    console.log(`      退出   @L${h.retLine}: ${h.ret}`);
  }
}

console.log('\n=== 附：整块改了内存但一次都没落盘的路由（上一轮角度的残留复核） ===');
if (!noSave.length) console.log('对勾 无。');
else for (const h of noSave) console.log(`  ${h.route}  L${h.line}  首次改动: ${h.mut}（共 ${h.n} 处赋值）`);

console.log('\n（扫描器只列可疑点，不做断言，退出码恒为 0）');
process.exit(0);
