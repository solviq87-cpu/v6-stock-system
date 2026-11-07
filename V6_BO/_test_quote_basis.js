// 守门测试：系统里那些「只在某一个时刻成立、换个时刻就错了」的快照（2026-10-08 da 轮）
//
// 本轮角度：同一个数在盘中/收盘后/休市日取到，含义完全不同，而调用方以为拿到的是同一个东西。
// 落点：全市场行情快照 S.stocks 只在 isDataWindow()（9:15–15:40）内刷新，休市日一次都不刷，
// 于是它在不同时刻代表不同的东西：
//   · 盘中 10:00 → 此刻实时行情，"当前市场宽度 / 我的总资产"成立；
//   · 休市日 / 开盘前 / 收盘后 → 它冻在【上一个交易日收盘】，而下游照旧按"今天"算并对外说。
// 铁证（breadth.json 实测）：2026-10-01/02/03/05/06/07 六条**一字不差** ——
//   n=5559 avg=-0.1 up=2346/down=2713 upRatio=46，全是 9/30 收盘那一份。
//   国庆七天里系统每天都在用 9/30 的行情对外宣称"今天的市场宽度"，且没有任何标注。
// 修法：① 给快照打拉取时刻 S.stocksAt（唯一入口 setAllStocks）
//      ② quoteDayOf(at) 判定这份快照属于哪个交易日（⛔ 锚是拉取时刻，不是"现在"）
//      ③ computeBreadth 加闸：不是今天的行情就不许写成"今天"（宁可留旧记录，也不造假）
//      ④ 面板/文案把"截至 X 日"说出来。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
let strip = null;
try { strip = require('./_codescan.js').stripNoise; } catch { }
const SV = strip ? strip(src, { keepStrings: true }) : src;

console.log('\n=== 行情快照基准时刻（da 轮）守门 ===\n');

// ---------- ① 源码结构 ----------
console.log('【① 唯一入口与基准时刻】');
ok('S.stocksAt 已声明（快照拉取时刻）', /stocksAt: 0,/.test(SV));
ok('setAllStocks 是唯一写入口且会记时刻', /S\.stocks = rows;/.test(SV) && /S\.stocksAt = Date\.now\(\);/.test(SV));
ok('⛔ 全项目不再有绕过入口的裸赋值', !/S\.stocks = await em\.fetchAllStocks\(\)/.test(SV));
ok('setAllStocks 拒收过短列表（不许把坏数据当快照）', /if \(!Array\.isArray\(rows\) \|\| rows\.length < 100\) return false;/.test(SV));
{
  const cnt = (SV.match(/setAllStocks\(/g) || []).length;
  ok('调用点覆盖全部原赋值处（声明 + 4 处接入）', cnt >= 5, 'setAllStocks( 出现 ' + cnt + ' 次');
}
ok('quoteDayOf 的锚是传入的时刻（不是 now）', /function quoteDayOf\(at\)/.test(SV) && /new Date\(Number\(at\) \|\| Date\.now\(\)\)/.test(SV));
ok('quoteBasis 用快照自己的时刻判定', /const day = at \? quoteDayOf\(at\) : '';/.test(SV));

// ---------- ② 真跑 quoteDayOf / quoteBasis ----------
console.log('\n【② quoteDayOf：这份行情属于哪个交易日】');
// 沙箱：替换 isTradeDay 与 prevTradeDay，构造"10-01~10-07 全休市、9-30 交易日"的国庆场景
const sandboxSrc = [
  grab(/function quoteDayOf\(at\) \{/),
  grab(/function quoteBasis\(maxAgeMs\) \{/),
  'return { quoteDayOf, quoteBasis };'
].join('\n');
const HOLIDAYS = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ymd = d => dstr(d).replace(/-/g, '');
function isTradeDay(d) {
  const s = dstr(d), dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAYS.has(s);
}
function prevTradeDay(from) {
  const base = new Date(from.getTime());
  base.setHours(12, 0, 0, 0);
  for (let i = 1; i <= 30; i++) {
    const t = new Date(base.getTime() - i * 86400000);
    if (isTradeDay(t)) return dstr(t);
  }
  return '';
}
// ⛔ 沙箱注入清单必须含【形参 + 被依赖的下层函数】（踩过 7 次）：quoteBasis 用到 todayStr。
//    同时把 Date.now() 换成可控的 NOW，才能把"现在"拨到盘中/休市日分别验证。
const SANDBOX = sandboxSrc.replace(/Date\.now\(\)/g, 'NOW');
function mkSandbox(S, now) {
  const NOW = now == null ? Date.now() : now;
  const todayStr = () => {
    const d = new Date(NOW);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  return new Function('S', 'isTradeDay', 'prevTradeDay', 'NOW', 'todayStr',
    SANDBOX + '\nreturn { quoteDayOf, quoteBasis };')(S, isTradeDay, prevTradeDay, NOW, todayStr);
}
{
  const S1 = mkSandbox({});
  // 9/30（交易日）盘中 10:00 拉到的 → 属于 9/30
  ok('交易日盘中拉的快照 → 归属当天', S1.quoteDayOf(new Date('2026-09-30T10:00:00').getTime()) === '20260930',
    S1.quoteDayOf(new Date('2026-09-30T10:00:00').getTime()));
  // 9/30 收盘后 20:00 再看这份快照，仍然是 9/30（锚是快照时刻，不是"现在"）
  ok('收盘后回看同一份快照 → 仍归 9/30（锚不是"现在"）', S1.quoteDayOf(new Date('2026-09-30T15:40:00').getTime()) === '20260930');
  // 交易日开盘前 8:00 拉到的（还没开盘，拿到的是昨天收盘）→ 归 9/29
  ok('交易日开盘前拉的快照 → 归上一个交易日', S1.quoteDayOf(new Date('2026-09-30T08:00:00').getTime()) === '20260929',
    S1.quoteDayOf(new Date('2026-09-30T08:00:00').getTime()));
  // 国庆假期里拉到的（实际是 9/30 收盘那份，但拉取时刻是 10/03 12:00）→ 归 9/30
  const hol = S1.quoteDayOf(new Date('2026-10-03T12:00:00').getTime());
  ok('休市日拉到的快照 → 归最近一个已收盘交易日（不是今天）', hol === '20260930', hol);
  // 反证：若拿"现在"当锚（错误写法），休市日 10/03 会被判成下面这样
  //   —— 这正是本轮要防的：让"今天"这个键被旧快照污染
  ok('反证：休市日的快照绝不许归为休市当天', hol !== '20261003', hol);
}

// ---------- ③ quoteBasis 的新鲜度 ----------
console.log('\n【③ quoteBasis：盘中 vs 休市日】');
{
  // 盘中场景：现在 9/30 10:05，快照 10:04 刚拉、属于今天
  const now = new Date('2026-09-30T10:05:00').getTime();
  const b1 = mkSandbox({ stocksAt: now - 60000 }, now).quoteBasis(10 * 60 * 1000);
  ok('盘中刚拉的快照：fresh=true / isToday=true / stale=false', b1.fresh && b1.isToday && !b1.stale, JSON.stringify(b1));
  ok('盘中标注为「今日」', b1.label === '今日', b1.label);

  // 休市日场景：现在 10/03 12:00，快照是 9/30 15:40 拉的（三天前那份）
  const now2 = new Date('2026-10-03T12:00:00').getTime();
  const b2 = mkSandbox({ stocksAt: new Date('2026-09-30T15:40:00').getTime() }, now2).quoteBasis(10 * 60 * 1000);
  ok('休市日的旧快照：stale=true', b2.stale === true, JSON.stringify(b2));
  ok('休市日的旧快照：isToday=false', b2.isToday === false, JSON.stringify(b2));
  ok('休市日的旧快照：归属日 = 20260930', b2.day === '20260930', b2.day);
  ok('标注出「09/30收盘」而不是「今日」', /09\/30收盘/.test(b2.label), b2.label);

  // 反证：新鲜度只看"拉取时刻近不近"是不够的 —— 休市日刚拉过也是旧的
  const now3 = new Date('2026-10-03T12:00:00').getTime();
  const b3 = mkSandbox({ stocksAt: now3 - 30000 }, now3).quoteBasis(10 * 60 * 1000); // 30 秒前刚拉
  ok('反证：只看"刚拉过"会漏掉休市日（fresh=true 但 stale 仍为 true）', b3.fresh === true && b3.stale === true, JSON.stringify(b3));

  // 行情从未就绪
  const b4 = mkSandbox({ stocksAt: 0 }, now2).quoteBasis(10 * 60 * 1000);
  ok('行情未就绪时 label 说"行情未就绪"', /行情未就绪/.test(b4.label), b4.label);
  ok('行情未就绪时 stale=true（不许当成新鲜）', b4.stale === true);
}

// ---------- ④ computeBreadth 的闸门 ----------
console.log('\n【④ computeBreadth：不许用旧快照造假的今天】');
ok('computeBreadth 开头就判基准日', /function computeBreadth\(\)[\s\S]{0,1200}?const _qb = quoteBasis\(/.test(SV));
ok('不是今天的行情直接 return null（不写盘）', /if \(!_qb\.isToday\) return null;/.test(SV));
ok('落盘记录带上归属日与时刻', /time: new Date\(\)\.toLocaleTimeString\('zh-CN'\), day: _qb\.day, at: _qb\.at,/.test(SV));
// ⚠️ 下面几条判的是**含正则字面量**的代码（`.replace(/-/g,'')`），
//    而 stripNoise(keepStrings) 会把正则字面量一并抹掉 → 必须判原始源码 src，不能判 SV。
ok('todayBreadth 把 basisDay/isToday 一起带出去', /basisDay: day, isToday: !!day && day === todayStr\(\)/.test(src));
ok('marketHealthNote 非当日时加「截至 X 收盘」', /截至 \$\{String\(b\.basisDay/.test(SV));
ok('⛔ todayBreadth 比较前把两种日期格式拉齐（normDate 带连字符 vs todayStr 不带）',
  /const tk = normDate\(todayStr\(\)\);/.test(src) && /String\(b\.day \|\| tk \|\| ''\)\.replace\(\/-\/g, ''\)/.test(src));
ok('⛔ 非交易日的历史宽度记录会被启动自净清掉', /function sweepBreadthPhantom/.test(SV) && /if \(!isFinite\(d\.getTime\(\)\) \|\| isTradeDay\(d\)\) continue;/.test(SV));
ok('自净挂在启动链上（不只挂定时器）', /sweepBreadthPhantom\(\); \/\/ ⛔ 先清掉/.test(src));
// ⛔ 2026-10-08 实测踩到的坑：旧记录没有 day 字段 → 回退成今天 → 面板显示"截至 10/07 收盘"，
//    而那份数其实是 9/30 的 —— 标注比不标更糟。这条钉死"格式必须拉齐"。
ok('反证：不许直接拿带连字符的键去比 todayStr', !/isToday: day === todayStr\(\)/.test(SV));

// ---------- ⑤ 模拟盘估值标注 ----------
console.log('\n【⑤ 模拟盘：休市日的资产是上一交易日收盘价估的】');
ok('paperSnap 带出 pxBasis', /pxBasis: Object\.keys\(acc\.positions \|\| \{\}\)\.length \? quoteBasis\(/.test(SV));
ok('无持仓时不标注（避免无谓警示）', /Object\.keys\(acc\.positions \|\| \{\}\)\.length \? quoteBasis/.test(SV));
ok('前端显示「按 X价估值」', /按 \$\{p\.pxBasis\.label\}价估值/.test(html));
ok('前端市场宽度显示「截至 X 收盘」', /截至 \$\{String\(b\.basisDay\)\.slice\(4, 6\)\}/.test(html));

// ---------- ⑥ 真实数据回归：breadth.json ----------
console.log('\n【⑥ 真实数据回归（breadth.json）】');
{
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'breadth.json'), 'utf8'));
  const keys = Object.keys(b).sort();
  console.log('     归档日期: ' + keys.join(', '));
  // ⚠️ 2026-10-08 更新判据：写这条测试时的铁证是 2026-10-01/02/03/05/06/07 六条与 9/30
  //    **一字不差**（n=5559 avg=-0.1 up=2346/down=2713 upRatio=46）。sweepBreadthPhantom
  //    上线后这些假"今天"已被清掉，归档现在只剩 9/30 一条。
  //    ⛔ 判据不能钉"档案里必须还留着脏数据"（那会永远过不了，等于把守门改成纪念碑），
  //       要钉**语义**：归档里的每个键都必须是交易日 —— 闸门一旦退化，这条立刻变红。
  // ⚠️ breadth.json 的键是带连字符的 YYYY-MM-DD（不是 YYYYMMDD）—— 再切一次片会切成 "2026"/"-1"/"0-"，
  //    new Date 拿到 Invalid Date → getDay() 是 NaN → 周末判定失效 → 判据静默放行（实测踩到）。
  const mkey = k => new Date(String(k).replace(/(\d{4})-?(\d{2})-?(\d{2})/, '$1-$2-$3') + 'T12:00:00');
  const bad = keys.filter(k => !isTradeDay(mkey(k)));
  ok('⛔ 归档里不再有非交易日的假"今天"记录（sweepBreadthPhantom 已清干净）', bad.length === 0, bad.join(','));
  const sig = k => { const v = b[k]; return `${v.n}|${v.avg}|${v.up}|${v.down}|${v.upRatio}`; };
  const dup = keys.filter(k => k !== '2026-09-30' && sig(k) === sig('2026-09-30'));
  console.log('     与 9/30 数值完全相同的日期: ' + (dup.join(', ') || '(无)'));
  ok('⛔ 也不再有与上一交易日一字不差的重复记录', dup.length === 0, dup.join(','));
  // 反证用 HOLIDAYS 里的一员（不依赖"这天是不是周末"的推算）：判据本身要抓得住
  ok('反证：判据本身要抓得住 —— 2026-10-06（国庆休市）塞进去必须判不合格',
    !isTradeDay(mkey('2026-10-06')));
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
