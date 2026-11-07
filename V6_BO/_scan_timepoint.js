// cp 轮扫描器：全项目「时间点语义」普查。
// 角度：系统里那些"以为是一回事、其实是两回事"的时间点。
// 主要抓三类错位：
//   ① 自然日当交易日（说"N 日"却在数 86400000 的整除个数，而中间可能隔着休市日）
//   ② 事件时间当记录时间（ts 是"发生时刻"还是"写库时刻"）
//   ③ 同一概念两把尺子（A 处按交易日、B 处按自然日）
// 输出候选清单供人工判断，不自动改代码。
const fs = require('fs');
const path = require('path');
const FILES = fs.readdirSync(__dirname).filter(f => /^[a-z][a-zA-Z0-9_]*\.js$/.test(f) && !f.startsWith('_test') && !f.startsWith('_scan'));

// 剥注释（中文注释会逐字引用旧代码，判代码必须剥）
const strip = src => src.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');

// 命中"天数/时长"计算的行
const PAT = [
  { re: /86400000|864e5|24\s*\*\s*3600\s*\*\s*1000/, tag: '自然日换算' },
  { re: /Date\.now\(\)\s*-\s*\w+/, tag: '时间差' },
  { re: /\b(days|Days|daysAgo|idleMs|ageMs|span|period)\b/, tag: '天/时长命名' },
  { re: /setDate\([^)]*-\s*\d+|getDate\(\)\s*-\s*\d+/, tag: '按日回溯' },
];

// 已知合理的自然日场景（不该报警）
const WHITE = [
  /CORRUPT_MAX_AGE/,                    // 坏文件留档 7 天：与交易无关
  /listedDaysAgo/,                      // 上市至今自然日：注释明写
  /within3Days/,                        // 新闻近 3 个自然日归档
  /holidaySpanUpToToday|fmtD8/,         // 假期跨度本身就是数休市日
  /tradeIdleMs|viewIdleKeys/,           // 只读闲置：内部已按交易日折算
  /CORRUPT_KEEP|Math\.round\(CORRUPT/,
];

let n = 0;
const rows = [];
for (const f of FILES) {
  const raw = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const src = strip(raw);
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const hit = PAT.filter(p => p.re.test(L));
    if (!hit.length) continue;
    if (WHITE.some(w => w.test(L))) continue;
    // 附近 6 行内若出现 isTradeDay / tradeDaysSince，判为"已按交易日处理"
    const ctx = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
    const tradeAware = /isTradeDay|tradeDaysSince|nextTradeDay|prevTradeDay|dataTradeDay/.test(ctx);
    rows.push({ f, line: i + 1, tags: hit.map(h => h.tag).join('+'), tradeAware, text: L.trim().slice(0, 150) });
    n++;
  }
}

console.log('=== 时间点语义候选清单（需人工判断口径） ===');
console.log(`扫描文件 ${FILES.length} 个，候选 ${n} 条\n`);
const byAware = [[], []];
for (const r of rows) byAware[r.tradeAware ? 0 : 1].push(r);
console.log(`【A】附近出现交易日判定（大概率已按交易日处理）${byAware[0].length} 条`);
for (const r of byAware[0]) console.log(`  ${r.f}:${r.line} [${r.tags}] ${r.text}`);
console.log(`\n【B】★ 附近没有交易日判定（重点人工复核）${byAware[1].length} 条`);
for (const r of byAware[1]) console.log(`  ${r.f}:${r.line} [${r.tags}] ${r.text}`);

// ── 专项：找"说 N 日却按自然日整除"的判据 ──
console.log('\n=== 专项：把时间差整除 86400000 当成"天数"的判据 ===');
// ⛔ 别用 [^)]* 抠参数：`Number(pos.buyTs)` 自带右括号，会把半截表达式吞掉（实测漏报）
const divPat = /Math\.floor\([^;\n]*86400000/;
let dn = 0;
for (const f of FILES) {
  const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  src.split('\n').forEach((L, i) => {
    if (divPat.test(L)) { console.log(`  ${f}:${i + 1}  ${L.trim().slice(0, 160)}`); dn++; }
  });
}
console.log(`  共 ${dn} 处（每处都要问一句：这里的"天"指的是交易日还是自然日？）`);

// ── 专项：同一概念的两把尺子（按变量名分组，看是否一处走交易日一处不走）──
console.log('\n=== 专项：同一名字在两处口径是否一致 ===');
const NAMES = ['days', 'natDays', 'idleMs', 'ageMs', 'expireDays', 'holdDays', 'spanDays'];
for (const nm of NAMES) {
  const where = [];
  for (const f of FILES) {
    const src = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    src.split('\n').forEach((L, i) => {
      if (new RegExp('\\b' + nm + '\\b').test(L)) {
        const ctx = src.split('\n').slice(Math.max(0, i - 4), i + 5).join('\n');
        where.push(`${f}:${i + 1}${/isTradeDay|tradeDaysSince/.test(ctx) ? '(交易日)' : '(自然日?)'} ${L.trim().slice(0, 90)}`);
      }
    });
  }
  if (where.length > 1) {
    const kinds = new Set(where.map(w => w.indexOf('(交易日)') >= 0 ? 'T' : 'N'));
    console.log(`  ${nm}：${where.length} 处，口径${kinds.size > 1 ? '★ 不一致' : '一致'}`);
    where.slice(0, 8).forEach(w => console.log(`      ${w}`));
  }
}
console.log('\n（扫描器只列候选，不自动判定；改之前先读上下文）');
