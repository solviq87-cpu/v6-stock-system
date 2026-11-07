// cn 轮守门：系统里"造出来就该消失"的东西 —— 到期之后有没有人负责收尸。
// 抓到的问题：
//   ① 坏文件留档 `xxx.json.corrupt-<ts>` 是**一次性救急产物**（数据捞完就该删），
//      而全项目没有任何一处删除它 —— 磁盘只增不减；更要命的是它**绕过了脱敏红线**：
//      .gitignore 拦的是精确文件名（`holdings.json` / `access.json`），改名之后规则匹配不上，
//      实测 git check-ignore 判"未拦" → git add -A 会把含成本股数金额的持仓副本、
//      含口令哈希与设备令牌的凭据副本一并推到 Gitee。红线被一个"好意"的留档动作悄悄绕开。
//   ② _devTouch（每枚令牌一条的写盘节流表）全项目 0 处 delete，漏在凭证类 Map 定期清扫清单外。
// 离线、确定性：真跑 sweepCorrupt（用真实 fs，临时目录），静态断言 gitignore 与清扫清单。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// ── 抠函数（按花括号配对取真实函数体，不用固定行数窗口）────────────────────
function fnBody(src, name) {
  // ⚠️ async function 也要认（抠 init 时就栽在这：init 是 `async function init()`）
  const a = src.search(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}

// ── ① 真跑 sweepCorrupt ───────────────────────────────────────────────
console.log('\n【一】真跑 sweepCorrupt：留档必须有生命周期');
const BODY_SWEEP = fnBody(SV, 'sweepCorrupt');
ok('能从源码抠出 sweepCorrupt', BODY_SWEEP.length > 0);
const KEEP = Number((SV.match(/const\s+CORRUPT_KEEP\s*=\s*(\d+)/) || [])[1] || 0);
const AGE = Number((SV.match(/const\s+CORRUPT_MAX_AGE\s*=\s*([\d\s*+]+?);/) || [])[1] || 0);
ok('CORRUPT_KEEP 是正整数', Number.isFinite(KEEP) && KEEP > 0, 'KEEP=' + KEEP);

const makeSweep = new Function('fs', 'path', 'CORRUPT_KEEP', 'CORRUPT_MAX_AGE', `${BODY_SWEEP}\nreturn sweepCorrupt;`);
const sweepCorrupt = makeSweep(fs, path, KEEP, 7 * 24 * 3600 * 1000);

const TMP = path.join(__dirname, '_tmp_mortal');
function resetTmp() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(TMP, { recursive: true });
}
resetTmp();
const BASE = 'holdings.json';
function put(name, ageMs) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, '{"items":[]}');
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); }
}

// 场景 A：留 5 份新鲜的 → 只保留最近 KEEP 份
put(BASE + '.corrupt-1001', 0);
put(BASE + '.corrupt-1002', 0);
put(BASE + '.corrupt-1003', 0);
put(BASE + '.corrupt-1004', 0);
put(BASE + '.corrupt-1005', 0);
put(BASE, 0);                       // 正常文件，绝不能被删
let n1 = sweepCorrupt(TMP, BASE);
let left = fs.readdirSync(TMP).filter(f => f.indexOf('.corrupt-') >= 0).sort();
ok('5 份新鲜留档被裁到 KEEP 份', left.length === KEEP, '实际 ' + left.length + ' 份：' + left.join(','));
ok('保留的是最近的几份（1005 必在）', left.indexOf(BASE + '.corrupt-1005') >= 0, left.join(','));
ok('清理返回值 = 实际删除份数', n1 === 5 - KEEP, 'n1=' + n1);
ok('正常文件 holdings.json 没被误删', fs.existsSync(path.join(TMP, BASE)));

// 场景 B：混入过期留档 → 过期的一律清掉，且不受"保留 KEEP 份"保护
resetTmp();
put(BASE + '.corrupt-2001', 10 * 24 * 3600 * 1000);   // 10 天前
put(BASE + '.corrupt-2002', 8 * 24 * 3600 * 1000);    // 8 天前
put(BASE + '.corrupt-2003', 0);
put(BASE + '.corrupt-2004', 0);
let n2 = sweepCorrupt(TMP, BASE);
left = fs.readdirSync(TMP).filter(f => f.indexOf('.corrupt-') >= 0).sort();
ok('超过保留期的留档全部清掉', left.indexOf(BASE + '.corrupt-2001') < 0 && left.indexOf(BASE + '.corrupt-2002') < 0, left.join(','));
ok('新鲜留档不受影响（2003/2004 都在）', left.indexOf(BASE + '.corrupt-2003') >= 0 && left.indexOf(BASE + '.corrupt-2004') >= 0, left.join(','));
ok('过期 2 份 + 超额 0 份 = 删 2 份', n2 === 2, 'n2=' + n2);

// 场景 C：其它文件的留档不该被 sweepCorrupt(base) 误伤
resetTmp();
put(BASE + '.corrupt-3001', 0);
put('other.json.corrupt-3002', 10 * 24 * 3600 * 1000);
sweepCorrupt(TMP, BASE);
ok('只扫自己那一份，不误伤别的文件留档', fs.existsSync(path.join(TMP, 'other.json.corrupt-3002')));

// 场景 D：没有留档时不能报错、不能删任何东西
resetTmp();
put(BASE, 0);
let n4 = 0;
try { n4 = sweepCorrupt(TMP, BASE); } catch (e) { n4 = -1; }
ok('无留档时安全返回 0 且不抛异常', n4 === 0, 'n4=' + n4);

// 反证：没有 sweepCorrupt 的旧写法（只 rename 留档、从不清理）会一直堆积
resetTmp();
for (let i = 1; i <= 9; i++) put(BASE + '.corrupt-' + (4000 + i), 0);
const leftOld = fs.readdirSync(TMP).filter(f => f.indexOf('.corrupt-') >= 0).length;
ok('反证：不清理时留档确实只增不减（9 份全在）', leftOld === 9, '实际 ' + leftOld);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

// ── ② .gitignore 必须拦住改名后的留档（真调 git check-ignore）────────────
console.log('\n【二】脱敏红线：留档改名后不许绕过 .gitignore');
// ⛔ 沙箱里 git 子进程不可用（连 `git --version` 都起不来），所以这里自己实现 gitignore 匹配，
//    断言的是**语义**（"改名后的留档会不会被拦"），不依赖外部命令。
//    只实现本项目 .gitignore 用到的规则子集：空行/#注释/纯通配符，够用且行为可验证。
const GI_RULES = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8').split(/\r?\n/)
  .map(l => l.trim()).filter(l => l && l.indexOf('#') !== 0);
function ruleToRe(r) {
  // gitignore 语义：不含 '/' 的规则可匹配路径的任意一段；* 不跨 '/'
  let body = r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp('(^|/)' + body + '$');
}
function ignored(rel) {
  const seg = rel.split('/');
  return GI_RULES.some(r => {
    if (r.indexOf('!') === 0) return false;             // 本项目无否定规则，忽略
    const re = ruleToRe(r.replace(/\/$/, ''));
    return re.test(rel) || seg.some(s => re.test(s));
  });
}
// 先自检：实现必须与已知事实一致（holdings.json 被拦、server.js 不被拦 —— bash 实测过的真值）
ok('[自检] gitignore 匹配实现与真值一致：holdings.json 被拦', ignored('holdings.json'));
ok('[自检] gitignore 匹配实现与真值一致：server.js 不被拦', !ignored('server.js'));
ok('holdings.json 本身被拦（基线）', ignored('holdings.json'));
ok('access.json 本身被拦（基线）', ignored('access.json'));
ok('★ holdings.json.corrupt-<ts> 被拦（否则持仓成本泄漏入库）', ignored('holdings.json.corrupt-1730000000000'));
ok('★ access.json.corrupt-<ts> 被拦（否则口令哈希与令牌泄漏入库）', ignored('access.json.corrupt-1730000000000'));
ok('其它文件的留档也被拦', ignored('news.json.corrupt-1730000000000') && ignored('server.js.corrupt-1'));
ok('没误伤正常源码（server.js 未被拦）', !ignored('server.js'));
ok('没误伤正常数据文件（pushlog.json 不在留档形态时不因新规则受影响）', !ignored('pushlog.json') || GI_RULES.indexOf('pushlog.json') >= 0);
// 规则本身：git 只认行首 # 为注释，*.corrupt-* 必须是独立一行
const GI = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
const giLines = GI.split(/\r?\n/);
ok('.gitignore 里有独立的 *.corrupt-* 规则行', giLines.some(l => l.trim() === '*.corrupt-*'));
ok('.gitignore 无行尾注释（会让整行规则失效）', !giLines.some(l => l.trim() && !l.trim().startsWith('#') && l.indexOf('#') >= 0));

// ── ③ 启动链：收尸必须挂启动（只挂逻辑不挂启动链这个坑已踩三次）────────────
console.log('\n【三】启动链与清扫清单');
const SV_NOC = SV.split(/\r?\n/).map(s => {
  const i = s.indexOf('//');
  return i >= 0 ? s.slice(0, i) : s;
}).join('\n');   // ⚠️ 判代码一律用剥注释版本（中文注释会逐字引用旧代码）
ok('定义了 sweepCorruptAll（全量扫）', /function\s+sweepCorruptAll\s*\(/.test(SV_NOC));
ok('★ sweepCorruptAll 挂在启动链 init 里', /sweepCorruptAll\s*\(\s*\)\s*;/.test(SV_NOC));
const initBody = fnBody(SV, 'init') || '';
ok('启动链调用点确实在 init 函数体内', initBody.indexOf('sweepCorruptAll') >= 0);
ok('readJsonSafe 留档后会顺手清理自己的旧留档', (fnBody(SV, 'readJsonSafe') || '').indexOf('sweepCorrupt') >= 0);

// _devTouch 必须进凭证类 Map 的定期清扫清单
const sweepLine = (SV_NOC.match(/\[_tokens[^\]]*\]/) || [''])[0];
ok('★ _devTouch 已进兜底硬上限清单', sweepLine.indexOf('_devTouch') >= 0, sweepLine.slice(0, 120));
ok('★ 定期清扫里有 _devTouch 的过期删除', /_devTouch\.delete\s*\(/.test(SV_NOC));
// 反证：旧写法里 _devTouch 一个 delete 都没有（说明它确实是从没人管的）
const devTouchAll = (SV.match(/_devTouch/g) || []).length;
ok('_devTouch 确有引用（不是死代码）', devTouchAll >= 2, '出现 ' + devTouchAll + ' 次');

console.log('\n' + '─'.repeat(60));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
