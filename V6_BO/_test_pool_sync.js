// 同一份数据在不同模块里的口径必须一致（本轮新角度 —— 派生集合与主集合要同一个 tick 更新）。
//
// 故障形态：一个池更新了、它的派生集合（代码集 / 分组表 / 上一轮快照）却晚一步更新，
// 中间夹着 await 就有几十毫秒到几秒的不一致窗口。消费方查派生集合时拿到的是【上一轮】的
// 结果，而同一个函数里另一处查主池拿到的是【这一轮】的 —— 一只票在系统里同时"已涨停"和
// "没涨停"。实测：S.ztCodes 排在 `await ztReasonCached()` 之后更新，而 S.ztPool 是立即更新的，
// 这段窗口里模拟盘的封板拦截（paperBuy 里 S.ztCodes.has）查不到刚封板的票，只剩
// A.isLimitUp(c.pct) 一条兜底，结果按涨停价"幻想成交"买进一字板，虚增模拟盘收益。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 取 refreshSectorsZT 里「涨停池落地」那一大段
function seg(fromRe, toRe) {
  const a = SVK.search(fromRe);
  if (a < 0) throw new Error('未找到起点');
  const rest = SVK.slice(a);
  const m = toRe.exec(rest);
  return m ? rest.slice(0, m.index) : rest.slice(0, 4000);
}

group('[1] 涨停池与它的代码集必须同一个 tick 更新');
{
  const s = seg(/if \(zt && zt\.length\) \{/, /ensureStockBoards/);
  const iPool = s.indexOf('S.ztPool = zt;');
  const iCodes = s.indexOf('S.ztCodes = new Set(');
  ok('两者都在「zt 非空」分支里', iPool > 0 && iCodes > 0);
  ok('代码集更新排在涨停池之后（不是之前）', iCodes > iPool);
  // ⛔ 核心：两者之间不能有 await —— 有 await 就意味着中间有一段"主池已更新、代码集还是旧的"
  const between = s.slice(iPool, iCodes);
  ok('两者之间没有 await（不留不一致窗口）', !/\bawait\b/.test(between),
    (between.match(/\bawait[^\n]*/) || [''])[0]);
  // 起点那句 S.ztPool = zt; 本身要排除，只看它之后还有没有别的赋值
  const rest = between.slice('S.ztPool = zt;'.length);
  ok('两者之间没有别的写 S.ztPool / S.ztCodes 的地方',
    (rest.match(/S\.zt(Pool|Codes)\s*=/g) || []).length === 0, (rest.match(/S\.zt(Pool|Codes)\s*=[^\n]*/) || [''])[0]);
}

group('[2] 板块涨停家数：三处口径必须同源');
ok('sectorZTCountFor 读的是 S.ztBySector', /function sectorZTCountFor[\s\S]{0,200}?S\.ztBySector\[sec\]/.test(SV));
ok('preBreakoutInner 的 ztN 也来自 S.ztBySector',
  /for \(const \[sec, arr\] of Object\.entries\(S\.ztBySector\)\)[\s\S]{0,200}?const n = \(arr \|\| \[\]\)\.length/.test(SV));
ok('S.mainline 在 ztBySector 落地之后才算（不早于它）',
  SVK.indexOf('S.ztBySector = bySec;') < SVK.indexOf('S.mainline = computeMainline()'));
ok('日报里的涨停家数走 A.isLimitUp（不写死 9.x）',
  /const limit = rel\.filter\(s => s\.pct != null && A\.isLimitUp\(s\.code, s\.name, s\.pct\)\)\.length;/.test(SV));

group('[3] 上一轮池快照只在池真的落地后才写');
ok('S.prevPoolCodes 的写入与 picked 同源', /S\.prevPoolCodes = new Set\(picked\.map\(c => c\.code\)\);/.test(SV));
ok('不存在「池为空却把 prevPoolCodes 清空」的分支',
  !/S\.prevPoolCodes = new Set\(\s*\)/.test(SV));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
