// 守门测试：排序与截断（2026-10-06）
//
// 背景（新角度：排序与截断 —— 排序坏了**不会报错、不会崩、结果看着也有东西**，
//   只是"最该在前面的没在前面"，用户只会觉得"你推荐的质量不稳定"）：
//
// ① 候选先按【原始概率】截断，再送进 govFilter 按【融合胜率】放行
//    govFilter 内部排序用 _p（fusedProb）、放行用 govTake（内部也算 fusedProb）——
//    这一步早在 2026-10-01 就统一好了，注释明写"排序依据和放行依据是同一个数"。
//    但**候选是外面截断好才送进来的**：板块异动原先 `cands.slice(0, 6)` 按 b.prob（模型原始概率）
//    取前 6 → 融合后最强、但原始概率只排第 7~12 的那只**根本进不了候选**，
//    排序依据与放行依据在 govFilter 看不见的地方又裂开了。
//    现在候选全量送入，由 govFilter 定序+过闸，出口再取前 6（推送条数不变，只是不再漏票）。
//
// ② 比较器返回 NaN：字段为 undefined 时 `b.x - a.x` 得 NaN，
//    V8 把 NaN 比较结果当 0（不交换）→ 数组保持上游拼接顺序 → 排序形同虚设。
//    注意：null 参与算术会转 0（安全），只有 undefined 才是 NaN。
//
// ③ 排序键与展示/放行口径不一致（面板按 A 排、推送按 B 放行）——目前为有意设计，
//    这里只做记录性断言，防止将来悄悄改乱。
'use strict';
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');
const CODE = stripNoise(SRC, { keepStrings: true });
const OTHER = ['analysis.js', 'learnall.js', 'ztpre.js', 'trend.js']
  .map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
const OTHERC = stripNoise(OTHER, { keepStrings: true });

console.log('\n[1] 板块异动：候选不许先按原始概率截断');
{
  const i = CODE.indexOf("govFilter('sector'");
  ok(i > 0, '找到板块异动的 govFilter 调用');
  // ⛔ 别用固定字符窗口（cx 轮踩）：出口那一行可能被收口函数包一层而被推出窗口 → 假红。
  //    取到本段结束（`const top = …` 那一整行）为止，按语义判。
  const seg = CODE.slice(i, i + 320);
  console.log('     ' + seg.split('\n')[0].trim());
  ok(!/govFilter\('sector',\s*cands\.slice/.test(seg), '⚠️ 入参不再按 cands.slice(0, N) 截断（那是原始概率序）');
  ok(/govFilter\('sector',\s*cands\s*,/.test(seg), '⚠️ 候选全量送入 govFilter，由融合胜率定序');
  // ⛔ 2026-10-06：出口截断从 `.slice(0, 6)` 改成了 `govTrim(_gk, 6)` ——
  //    被截掉的那几只在 govFilter 里已经占了坑，直接 slice 会让它们白占一整天名额。
  //    这里钉的是「出口确实限 6 条」，具体实现方式不再钉死。
  ok(/\)\.slice\(0,\s*6\)/.test(seg) || /govTrim\(_gk,\s*6\)/.test(seg),
    '⚠️ 出口限制为 6 条（推送条数与修之前一致，只是不再漏票）');
  // 反证
  const fake = "const top = govFilter('sector', cands.slice(0, 6), null, x => (x.prob || 0) >= 70);";
  ok(/govFilter\('sector',\s*cands\.slice/.test(fake) && !/\)\.slice\(0,\s*6\)/.test(fake),
    '⚠️ 反证：旧写法同时命中"入参截断"且没有出口限制（说明断言真的能分辨两种写法）');
}

console.log('\n[2] 比较器不许在字段可能 undefined 时裸相减');
{
  // 全局扫：找 `b.X - a.X` 且没有 || / Number.isFinite / !=null 兜底的
  const risky = new Map();
  for (const m of CODE.matchAll(/\.sort\(\s*\([^)]*\)\s*=>[^\n]*?\((\w+)\.(\w+)\s*-\s*(\w+)\.(\2)\s*\)/g)) {
    const seg = m[0];
    if (/\|\||Number\.isFinite|==\s*null|!=\s*null/.test(seg)) continue;
    const line = CODE.slice(0, m.index).split('\n').length;
    if (!risky.has(m[2])) risky.set(m[2], line);
  }
  // ⛔ 不再靠人工白名单放行：必须在该字段的**初始化点**上证明它是数值或布尔。
  //    （null 参与算术转 0 是安全的，只有 undefined 才会污染成 NaN，所以要看初值类型）
  // ⚠️ null 也算安全：算术里转 0（不像 undefined 那样变 NaN）。这是本组判据的关键，别搞反。
  const NUMERIC_INIT = /(^|[^\w.])(!!|null\b|Number\(|parseFloat\(|parseInt\(|Math\.|\+ ?\(|[-+]?\d+(\.\d+)?\b)/;
  const BOOL_INIT = /(\|\||&&|!|===|!==|>=|<=|>|<|\?|!!|\.length|\.some\(|\.every\(|\.filter\(|\.includes\()/;
  const initSites = f => {
    const out = [];
    const re = new RegExp('(?:const|let|var)\\s+' + f + '\\s*=\\s*([^;\\n]+)|\\b' + f + '\\s*:\\s*([^,\\n}\\]]+)', 'g');
    for (const src of [CODE, OTHERC]) for (const m of src.matchAll(re)) out.push((m[1] || m[2] || '').trim());
    return out;
  };
  const unverified = [];
  for (const [f, line] of risky) {
    const sites = initSites(f);
    const okType = sites.some(s => NUMERIC_INIT.test(s) || BOOL_INIT.test(s));
    if (!okType) unverified.push(f + ' @ ' + line + '（初值: ' + (sites[0] || '未找到') + '）');
  }
  ok(unverified.length === 0,
    `⚠️ 裸相减的字段都能在初始化点证明是数值/布尔（共 ${risky.size} 个字段）`,
    unverified.join(' ; '));
  ok(risky.size > 0, `确实扫到了裸相减（${risky.size} 个字段），不是空转`);
  // 反证：这个判据真的能抓出坏字段
  const badInit = initSites('__no_such_field__');
  ok(badInit.length === 0 && !NUMERIC_INIT.test('r.pct'), '反证：字段名不存在时判据判"未证明"（不会静默放行）');
  ok(NUMERIC_INIT.test('let runMax = 0') && BOOL_INIT.test('!!t.steadyRun'), '对照：数字初值与 !! 布尔初值都能被认出来');
  ok(Number.isFinite(null - null) && (null - null) === 0, '对照：null 初值在减法里转 0，不会 NaN（bmScore: null 属安全）');
  ok(!Number.isFinite(undefined - undefined), '对照：undefined 初值才会 NaN（这才是要拦的）');
}

console.log('\n[3] 关键聚合字段不许被 undefined 污染成 NaN');
{
  // computeMainline 的 lbSum 曾是最大嫌疑：`g.lbSum += lb` 若 lb 为 undefined → 整个板块的键变 NaN
  const i = SRC.indexOf('function computeMainline');
  const seg = SRC.slice(i, i + 2600);
  ok(/const lb = z\.limitUpCount \|\| 1;/.test(seg), '⚠️ computeMainline 的 lb 有 || 兜底（否则 lbSum 变 NaN，主线排序全废）');
  ok(/g\.lbSum \+= lb;/.test(seg), 'lbSum 确实在累加 lb（兜底位置正确）');
  // 反证
  ok(!Number.isFinite(undefined + 1), '反证前提：undefined 参与加法确实是 NaN（所以兜底不能省）');
  ok(Number.isFinite(null + 1), '对照：null 参与加法转 0，不会 NaN（别把两者搞混）');
}

console.log('\n[4] 排序必须在截断之前（TOP N 取的是排好序的前 N）');
{
  // 精选池降级退路：safe = scored.filter(...).sort(...).slice(0,20)
  const i = CODE.indexOf('const safe = scored.filter');
  ok(i > 0, '找到精选池降级截断');
  const stmt = CODE.slice(i, i + 160).split('\n')[0];
  console.log('     ' + stmt.trim());
  ok(/\.sort\(/.test(stmt) && /\.sort\(/.test(stmt.slice(0, stmt.indexOf('.slice('))),
    '⚠️ 降级退路的 slice(0,20) 之前有 sort（截的是排好序的前 20）');
  // 排序之后不许再改排序键（否则前面白排）
  // ⛔ 只数「降级截断之前」的 scored.sort：2026-10-23 竞价共振模块在文件后部（行~10153）
  //    新增了一处同名局部 scored.sort，若取全局最后一次（Math.max 全部），between 会切成
  //    空数组 → 断言对空串恒真（静默失明，比报错更坏——这正是 _test_learn_wire 同类毛病的
  //    另一处实例，2026-10-23 一并收口）。
  const sliceLine = CODE.slice(0, i).split('\n').length;
  const scoredSortLine = [...CODE.matchAll(/scored\.sort\(/g)].map(m => CODE.slice(0, m.index).split('\n').length).filter(ln => ln < sliceLine);
  const lastSort = scoredSortLine.length ? Math.max(...scoredSortLine) : 0;
  const between = SRC.split('\n').slice(lastSort, sliceLine - 1).join('\n');
  ok(!/\b(c\.)?(score|focused|profitRatio)\s*=[^=]/.test(between),
    '⚠️ scored 排序之后、降级截断之前没有再改排序键（改了必须重排）');
  // S.sectors 的每一处赋值都必须排好序 —— hotSectors = S.sectors.slice(0,10) 依赖这一点
  const assignMs = [...CODE.matchAll(/S\.sectors = ([^;]+);/g)];
  const assigns = assignMs.map(m => m[1].trim());
  ok(assigns.length >= 3, `S.sectors 有 ${assigns.length} 处赋值`);
  // ⛔ 赋的值可能是上一行 `const all = [...].sort(...)`，光看赋值这一行会误报 → 回溯到定义处
  //    ⚠️ 必须**从赋值点往前找最近的那次定义**：`const all` 这种短名在 9000 行里有多处，
  //       从头 match 会命中别处的同名变量，把有序的判成无序（这正是第一轮误报的原因）。
  const resolve = (expr, at) => {
    if (/\.sort\(/.test(expr)) return expr;
    if (/^[\w$]+$/.test(expr)) {
      const before = CODE.slice(0, at);
      const decls = [...before.matchAll(new RegExp('(?:const|let|var)\\s+' + expr + '\\s*=', 'g'))];
      const d = decls[decls.length - 1];
      if (d) return CODE.slice(d.index, d.index + 400).split(';')[0];
      const asg = [...before.matchAll(new RegExp('\\b' + expr + '\\s*=', 'g'))];
      const a = asg[asg.length - 1];
      if (a) return CODE.slice(a.index, a.index + 400).split(';')[0];
    }
    return expr;
  };
  const unsorted = assignMs
    .map(m => ({ expr: m[1].trim(), src: resolve(m[1].trim(), m.index) }))
    .filter(x => !/\.sort\(/.test(x.src));
  // 唯一允许不排序的：从 sectors.json 存档恢复（存档本身就是 all/part 排序后全量落盘的）。
  // ⛔ 2026-10-27：恢复点现在有两处（启动一次 + 定时拉取失败时的兜底一次），旧断言写死「最多一处」
  //    并且拿**赋值表达式本身**去匹配 'sj'（`_rows` 自然不含 sj）→ 恒红。改为判「来源确实是存档」。
  const restored = unsorted.filter(x => /sectors\.json|SECTORS_FILE|\bsj\b|\bsec\b/.test(x.src));
  ok(unsorted.length === restored.length,
    `⚠️ S.sectors 的未排序赋值只能来自 sectors.json 存档恢复（${restored.length}/${unsorted.length} 处）`,
    '未排序: ' + unsorted.map(x => x.expr + (restored.indexOf(x) >= 0 ? '(存档)' : '(非存档!)')).join(' | '));
}

console.log('\n[5] 池内比较器只准有一份（不许降级路径另用一把尺子）');
{
  const i = CODE.indexOf('const byScore =');
  ok(i > 0, '⚠️ 精选池定义了统一的 byScore 比较器');
  ok(/const byFinal =/.test(CODE.slice(i, i + 400)), '⚠️ 精选池定义了统一的 byFinal 比较器（八字分版）');
  // 该作用域内不许再出现内联的 focused 比较器
  const poolFn = CODE.slice(i, CODE.indexOf('S.candidatePool = picked', i) + 40);
  const inline = [...poolFn.matchAll(/\.sort\(\s*\(a,\s*b\)\s*=>[^\n]*focused/g)];
  ok(inline.length === 0, '⚠️ 精选池内不再有内联的 focused 比较器（复制粘贴会再次分叉）',
    inline.map(m => m[0].slice(0, 60)).join(' | '));
  ok(/scored\.sort\(byScore\)/.test(poolFn), '⚠️ scored 排序用的是 byScore');
  ok(/picked\.sort\(byFinal\)/.test(poolFn), '⚠️ picked 排序用的是 byFinal');
  // ⛔ 2026-10-06 补：退路多了一个 !baziUnknown 条件（判不出八字的票不算过闸门），
  //    这里放宽成「可选」，只钉死"排序仍用同一把尺子 byFinal"这件事本身。
  ok(/scored\.filter\(c => !baziBlocked\(c\)(?: && !baziUnknown\(c\))?\)\.sort\(byFinal\)\.slice\(0, 20\)/.test(poolFn),
    '⚠️ 降级退路与正常路径共用 byFinal（否则截的不是同一套顺序）');
  // 反证
  ok(/\.sort\(\s*\(a,\s*b\)\s*=>[^\n]*focused/.test('arr.sort((a, b) => (b.focused - a.focused) || (b.score - a.score));'),
    '反证：内联比较器确实会被这条正则抓到（不是空转）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
