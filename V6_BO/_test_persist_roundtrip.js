// ci 轮守门：同一个数写进磁盘再读回来，还是不是同一个东西。
// 钉两件事：
//   ① 落盘的「当日快照」必须把"这是哪一天的"一起写进去 —— 只存 HH:MM:SS 的话，
//      重启读回来的旧档会被当成刚刚算的（复盘 review.json 就是唯一漏掉的一个）。
//   ② Map / Set / Infinity / NaN 进 JSON 会被静默吞掉（{} / null），
//      落盘时要么摊开、要么根本不该存 —— 守门把这条理论依据也钉死，防止后人以为 JSON 能存 Map。
// 离线、确定性：不碰真实数据文件，全部用构造对象跑 JSON 往返。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HT = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// 取真实函数体：先跳过形参表再配对花括号，并跳过字符串里的花括号
function fnBody(src, name) {
  const a = src.search(new RegExp('^(async\\s+)?function ' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}
const BODY_MK = fnBody(SV, 'mkReviewShell');
const BODY_STALE = fnBody(SV, 'reviewIsStale');

console.log('\n【⛔⛔ 自检】');
{
  ok('自检：mkReviewShell 抠得出来', BODY_MK.length > 80, String(BODY_MK.length));
  ok('自检：reviewIsStale 抠得出来', BODY_STALE.length > 80, String(BODY_STALE.length));
  // 反向：JSON 真的吞掉 Map/Set/Infinity/NaN（本轮的理论依据，必须先证明它成立）
  const rt = JSON.parse(JSON.stringify({ m: new Map([['a', 1]]), s: new Set([1, 2]), i: Infinity, n: NaN, u: undefined }));
  ok('自检：JSON 往返把 Map 变成 {}', rt.m && typeof rt.m.has !== 'function', JSON.stringify(rt.m));
  ok('自检：JSON 往返把 Set 变成 {}', rt.s && typeof rt.s.add !== 'function', JSON.stringify(rt.s));
  ok('自检：JSON 往返把 Infinity 变成 null', rt.i === null, String(rt.i));
  ok('自检：JSON 往返把 NaN 变成 null', Number.isNaN(rt.n) === false && rt.n === null, String(rt.n));
  ok('自检：JSON 往返直接丢掉 undefined', !('u' in rt), Object.keys(rt).join(','));
}

console.log('\n【① 复盘快照必须把日期一起落盘】');
{
  // ⛔ 钉语义不钉字符串：日期必须来自一个"日期口径函数"（reviewDataDay，缺则回退 todayStr），
  //    别钉死 todayStr 这几个字 —— ck 轮把日期从"今天"改成"数据所属交易日"时它就假红了。
  // kd 轮：优先复用 S.ztDay，所以 date 字段以 (S.ztDayProbed === true && S.ztDay) 开头。
  ok('mkReviewShell 写了 date',
    /date:\s*\(S\.ztDayProbed === true && S\.ztDay\)/.test(BODY_MK),
    (BODY_MK.match(/date:[^\n]*/) || [''])[0].slice(0, 120));
  // ⛔ 三个构造点都必须走同一个入口，不许各写一份字面量（写一份漏两份 = 又分叉）
  const literal = /S\.review\s*=\s*\{\s*time:/.test(SV);
  ok('⛔ S.review 不再有各自写一份的字面量（统一走 mkReviewShell）', !literal);
  ok('空池兜底那处也走 mkReviewShell', /S\.review = mkReviewShell\(\[\]\)/.test(SV));
  ok('正常落盘那处也走 mkReviewShell', /S\.review = Object\.assign\(mkReviewShell\(items\)/.test(SV));
  // ⛔ 事后在内存里补 date 是治不好的：内存里有、磁盘上没有，重启就没了
  ok('⛔ 不再有 `S.review.date = ` 这种事后补写', !/S\.review\.date\s*=/.test(SV));
  // ⛔ 2026-10-28 硬化：原窗口 200 字，被复盘加固（pct/prob 判不出兜底 + 注释）撑到 332 字 → 假红。
  //    这条断言的本意是「date 跟数据同一份写出、不许事后在内存里补」—— 判据应是「同一函数体内、
  //    顺序在构造之后」，与中间塞了多少加固代码无关。窗口放宽到 800 字（仍能保证在同一个落盘路径内），
  //    并保留「只认 Object.assign(mkReviewShell(items)) 构造 + 紧随 atomicWrite(review.json)」的意图。
  ok('review.json 的落盘紧跟在构造之后（date 跟数据同一份写出）',
    /S\.review = Object\.assign\(mkReviewShell\(items\)[\s\S]{0,800}atomicWrite\([\s\S]{0,120}review\.json/.test(SV));
}

console.log('\n【② 真跑往返：写进磁盘再读回来，日期还在】');
{
  const todayStr = () => '20261007';
  const reviewDataDay = () => '20261007';
  // kd 轮：mkReviewShell 优先用 S.ztDay（探测可信时），次选 reviewDataDay。
  const S = { ztPool: new Array(48), ztDayProbed: true, ztDay: '20261007' };
  const mk = new Function('S', 'todayStr', 'reviewDataDay', BODY_MK + '\nreturn mkReviewShell;')(S, todayStr, reviewDataDay);
  const r = mk([{ code: '600000' }]);
  ok('构造时就带上了 date', r.date === '20261007', String(r.date));
  ok('items / ztN 一起定格（同一份快照）', r.items.length === 1 && r.ztN === 48, JSON.stringify({ i: r.items.length, z: r.ztN }));
  // 模拟「落盘 → 重启 → 读回」
  const back = JSON.parse(JSON.stringify(r));
  ok('⛔ 往返之后 date 还在（这是本轮修的核心）', back.date === '20261007', String(back.date));
  ok('往返之后 time 也在', typeof back.time === 'string' && back.time.length > 0, String(back.time));
  ok('往返之后 items 条数不变', back.items.length === 1, String(back.items.length));
}

console.log('\n【③ reviewIsStale 不许把旧档判成新鲜】');
{
  // ⚠️ 末尾必须是 `return reviewIsStale();` —— 少了那对括号拿到的是函数本身，
  //    四条断言会一起"失败"得莫名其妙（踩过一次，别再省这对括号）
  const run = (review, today) => new Function('S', 'todayStr', BODY_STALE + '\nreturn reviewIsStale();')({ review }, () => today);
  ok('今天的复盘 → 不标陈旧', run({ date: '20261007', time: '15:41:30' }, '20261007') === false);
  ok('昨天的复盘 → 标陈旧', run({ date: '20261006', time: '15:41:30' }, '20261007') === true);
  ok('⛔ 旧档没有 date → 标陈旧（不能判成"新鲜"）', run({ time: '15:41:30' }, '20261007') === true);
  ok('没有复盘 → 不算陈旧（面板本来也不显示）', run(null, '20261007') === false);
  // 反向：如果按"缺 date 就当今天"的旧逻辑写，上面第三条会是 false —— 这条断言能失败
  const oldLogic = (r, t) => (r && r.date) ? r.date !== t : false;
  ok('反向验证：旧逻辑（缺 date 当新鲜）确实会把旧档判成新鲜 → 所以必须改', oldLogic({ time: 'x' }, '20261007') === false);
}

console.log('\n【④ 面板必须把日期显示出来】');
{
  ok('前端读了 reviewStale', /s\.reviewStale/.test(HT));
  ok('前端把 date 渲染进 rvTime', /s\.review\.date/.test(HT));
  // ⚠️ 别用 indexOf 锚定：'rvTime' 在 h2 标签里先出现一次，锚到的是那处、不含渲染代码
  const rvRender = HT.slice(HT.indexOf("getElementById('rvTime')") - 500, HT.indexOf("getElementById('rvTime')") + 300);
  ok('非当日时有 ⚠️ 提示', /⚠️/.test(rvRender), rvRender.slice(0, 120));
  ok('后端 /api/state 下发了 reviewStale', /reviewStale:\s*reviewIsStale\(\)/.test(SV));
  ok('复盘文案尾部也带上了日期（不然手机上照样只看到 HH:MM:SS）', /_rvDate/.test(SV) && /复盘生成时间 \$\{_rvDate/.test(SV));
}

console.log('\n【⑤ 其它落盘快照的日期口径（同类普查）】');
{
  ok('竞价快照 S.auction 带 date', /date:\s*\(typeof quoteDayOf === 'function'\) \? quoteDayOf\(Date\.now\(\)\)/.test(SV));
  // basisOf 用对象简写（{ day, totalN, ... }），所以查 `day,` 而不是 `day:`
  const _bo = fnBody(SV, 'basisOf');
  ok('形态三池的基准日走 basisOf（带 day 与 stale）', /\bday\b/.test(_bo) && /stale:/.test(_bo), _bo.slice(0, 80));
  ok('marketBeta 按日期键存（不是单个"今天"的值）', /S\.marketBeta\[normDate\(todayStr\(\)\)\]/.test(SV));
  ok('breadth 按日期键存', /S\.breadth\[normDate\(todayStr\(\)\)\]/.test(SV));
  ok('推送额度 pushgov 带 day', /day: PUSH_GOV\.day/.test(SV));
}

console.log('\n【⑥ Map / Set 落盘必须先摊开】');
{
  // 顶层状态里声明为 Map/Set 的字段，不允许被直接 JSON.stringify（那样只会得到 {}）
  const decl = [];
  const re = /(S\.[A-Za-z0-9_]+)\s*[:=]\s*new (Map|Set)\(\)/g;
  let m;
  while ((m = re.exec(SV))) decl.push({ f: m[1], t: m[2] });
  ok('扫到的 Map/Set 状态字段不止一处（扫描器没空转）', decl.length >= 5, String(decl.length));
  const bad = [];
  for (const d of decl) {
    // 直接 stringify：JSON.stringify(S.xxx) 或 JSON.stringify({..., S.xxx ...}) —— 这里只查前者（最典型的漏法）
    const direct = new RegExp('JSON\\.stringify\\(\\s*' + d.f.replace('.', '\\.') + '\\s*[,)]').test(SV);
    if (direct) bad.push(d.f + '(' + d.t + ')');
  }
  ok('⛔ 没有哪个 Map/Set 被直接 JSON.stringify', bad.length === 0, bad.join(','));
  // 已知几处必须摊开
  ok('pushgov 的 codes 摊成数组', /\[\.\.\.PUSH_GOV\.codes\.entries\(\)\]/.test(SV));
  ok('pushgov 的 types 摊成数组', /types: \[\.\.\.\(r\.types \|\| \[\]\)\]/.test(SV));
  ok('pushgov 恢复时建回 Map/Set', /new Map\(\(o\.codes \|\| \[\]\)\.map\([\s\S]{0,120}new Set\(/.test(SV));
  ok('news 的 goodPushed 摊成数组', /goodPushed: \[\.\.\.S\.news\.goodPushed\]/.test(SV));
  ok('news 读回来建回 Set', /S\.news\.goodPushed = new Set\(nj\.goodPushed\)/.test(SV));
  ok('板块码表摊成数组', /JSON\.stringify\(\[\.\.\.S\.secCodeMap\]\)/.test(SV));
  ok('个股题材反查摊成数组', /JSON\.stringify\(\[\.\.\.S\.stockBoards\]\)/.test(SV));
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
