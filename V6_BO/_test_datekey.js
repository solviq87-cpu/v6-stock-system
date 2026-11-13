// 守门测试：日期口径必须统一为本地时间（2026-10-06 新增角度）
// 项目里所有日期键（todayStr / dayKeyOf / normDate / 新闻 x.t，都是 toLocaleString 本地时间）
// 清一色本地口径。within3Days 原来用 toISOString()（UTC）算下界：
//   北京时间 UTC+8，每天 00:00–08:00 这 8 小时里 UTC 日期比本地晚一天 → min 少一天
//   →「近3日归档」实际留了 4 天，面板口径跟文案对不上。当下界只是多留，
//     一旦有人拿它当上界就会把当天整漏掉。
// 本测试把时钟拨到「北京时间 10-06 05:00 / UTC 10-05 21:00」这个正好差一天的时刻来验证。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

console.log('\n=== 日期口径守门 ===\n');

// ---------- 抓出 within3Days ----------
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) return '';
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const SRC = grab(/^function within3Days\(t\) \{/m);
ok('能抓到 within3Days 源码', SRC.length > 0);

console.log('【① 源码层面：不许再用 UTC 算日期键】');
// 剥掉注释再判（函数头那大段注释里就写着 toISOString）
const bodyOnly = SRC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
ok('within3Days 里不再出现 toISOString', !/toISOString/.test(bodyOnly));
ok('统一调用中国自然日窗口和来源时间解析器', /newsIsCurrent/.test(bodyOnly) && /sourceTime/.test(bodyOnly));

console.log('\n【② 行为层面：拨到北京凌晨 5 点（UTC 与本地差一天）】');
// ⚠️ 必须在 new Date() 之前设置，Node 的 Date 会读它
process.env.TZ = 'Asia/Shanghai';
// 北京时间 2026-10-06 05:00  ==  UTC 2026-10-05 21:00
const NOW = Date.UTC(2026, 9, 5, 21, 0, 0);
// 把源码里的 Date.now() 换成注入的 __now，做成可测的函数
// ⚠️ __now 必须由外层工厂**先传进去**再返回闭包：
//    直接 `new Function('__now', …)()` 不传参的话，__now 是 undefined →
//    new Date(NaN) → min 变成 'NaN-NaN-NaN'，所有比较恒 false（第一版就这么红的）。
const fnSrc = SRC.replace(/function within3Days/, 'function _w3d').replace(/Date\.now\(\)/g, '__now');
const w3d = new Function('__now', 'require', fnSrc + '\n; return (t) => _w3d(t);')(NOW, require);

const utcMin = new Date(NOW - 2 * 86400000).toISOString().slice(0, 10);      // 旧口径
const locDt = new Date(NOW - 2 * 86400000);
const locMin = locDt.getFullYear() + '-' + String(locDt.getMonth() + 1).padStart(2, '0') + '-' + String(locDt.getDate()).padStart(2, '0');
console.log('   该时刻 → UTC口径下界 ' + utcMin + ' / 本地口径下界 ' + locMin);
ok('两种口径在这个时刻确实不同（测试场景有效）', utcMin !== locMin, utcMin + ' vs ' + locMin);
ok('本地口径下界 = 2026-10-04（北京 10-06 往前 2 天）', locMin === '2026-10-04', locMin);

ok('10-04 算作近3日内（下界当天要留）', w3d('2026-10-04 08:00:00') === true);
ok('10-03 不算近3日内（旧 UTC 口径会误留它）', w3d('2026-10-03 23:00:00') === false);
ok('10-06 当然算', w3d('2026-10-06 05:00:00') === true);
ok('未来时间拒绝', w3d('2026-10-06 05:00:01') === false);
ok('空值返回 false', w3d('') === false && w3d(null) === false);

console.log('\n【③ 全项目：日期键索引格式统一】');
// S.marketBeta / S.breadth 的键都是 normDate() 出来的 'YYYY-MM-DD'（见 L405/459/468/541）
// ⛔ 判代码必须剥注释（项目纪律，踩过 10 次）：中文注释里会逐字引用代码写法，
//    扫 `S.breadth[...]` 这类索引表达式时会把注释里的举例一起算成"裸索引"。
let _strip = null;
try { _strip = require('./_codescan.js').stripNoise; } catch { }
const SV = _strip ? _strip(src, { keepStrings: true }) : src;
const betaIdx = [...SV.matchAll(/S\.marketBeta\[([^\]]+)\]/g)].map(m => m[1]);
const breadthIdx = [...SV.matchAll(/S\.breadth\[([^\]]+)\]/g)].map(m => m[1]);
const allIdx = [...betaIdx, ...breadthIdx];
// ⚠️ 匹配结果 m[1] 是**索引表达式本身**（如 `normDate(todayStr())` 或 `d`），不是整个 `S.x[...]`，
//    所以 `[d]` 这种写法要按 `x === 'd'` 判，别写 `/\[d\]/`（第一版就这么漏的）。
// ⛔ 2026-10-27：`bestK` 是「遍历 S.breadth 键、且键本身已被 /^\d{4}-\d{2}-\d{2}$/ 筛过」的最近日期回退，
//    格式天然是 normDate 口径（fw 轮加的"最近一份宽度"兜底），属已规范键、不是裸索引。
const OK_IDX = new Set(['d', 'bestK']);
const rawIdx = allIdx.filter(x => !/normDate/.test(x) && !OK_IDX.has(x.trim()));
ok('S.marketBeta / S.breadth 的索引全部走 normDate 或已规范的 byDay 键（' + allIdx.length + ' 处）',
  rawIdx.length === 0, '裸索引: ' + rawIdx.join(', '));
ok('dayStats 的 byDay 键是 normDate(s.date)（与上面同口径）', /const d = normDate\(s\.date\);\s*\n\s*if \(!byDay\[d\]\)/.test(src));

console.log('\n【④ 业务时间字段不得用 UTC】');
// 允许：**时间戳字段**（展示时会 new Date(x).toLocaleString 转回本地，不做日期键比较）——
//   setAt/boundAt/boundBy 是老名单；2026-10-27 补 updatedAt（漏网学习文件落盘戳）
//   与 ts/t（客户端异常日志的时间戳），它们都不是「按天索引」用的日期键。
const bad = [];
src.split('\n').forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*')) return;
  if (!/\.toISOString\(\)/.test(l)) return;
  if (/setAt|boundAt|boundBy|updatedAt|\bts:|\bt:/.test(l)) return;
  bad.push('L' + (i + 1) + ' ' + t.slice(0, 100));
});
ok('除 setAt/boundAt 时间戳外，没有别处用 toISOString 当日期键', bad.length === 0, bad.join(' | '));

console.log('\n日期口径守门：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
