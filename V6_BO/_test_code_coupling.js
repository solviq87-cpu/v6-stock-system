// 代码联动守门测试（2026-10-03 用户：「不是外围联动，是代码联动」）
//
// 治的是这一类事故：**单个模块自己测都是绿的，拼起来上线就崩。**
//   ① 新增 xxx.js → server.js require 了 → 忘了加进 _publish.py 的 CODE_FILES
//      → 本地跑得好好的，线上启动第一行 require 就 MODULE_NOT_FOUND（犯过 4 次）
//   ② 前端 post('/api/foo')，服务端路由叫 '/api/bar' → 面板"点了没反应"，
//      而且浏览器 Network 里是 404，只有到线上点一下才发现
//   ③ index.html 改了 APP_VER，server.js 忘了改（或反之）→ 页面无限 reload
//   ④ 传递依赖漏包：bazi.js require analysis.js，只发了 bazi.js → 同样炸
//
// 本测试全部是**静态分析**，不联网、不起服务，跑得快，可以随便加到发布前清单里。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

const SV = read('server.js');
const HTML = read('public/index.html');
const PUB = read('_publish.py');

// 剥离器：注释里写的 require('./y') 这种示例文字不能被当成真实依赖（实测踩过）
const stripNoise = require('./_codescan.js').stripNoise;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
function head(t) { console.log('\n' + t); }

// 归一化 require 路径：'./em' → 'em.js'，'./analysis' → 'analysis.js'
function norm(spec) {
  let s = spec.replace(/^\.\//, '');
  if (!/\.(js|json|node)$/.test(s)) s += '.js';
  return s;
}

// 取某文件的本地 require 列表（剥掉注释与字符串后只扫真实代码）
function localReqs(file) {
  const src = stripNoise(read(file), { keepStrings: true }), out = new Set();
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m; while ((m = re.exec(src))) out.add(norm(m[1]));
  return out;
}

// 发布清单 CODE_FILES（只取 [_publish.py 里第一段列表字面量]）
function codeFiles() {
  const start = PUB.indexOf('CODE_FILES');
  if (start < 0) return [];
  const lb = PUB.indexOf('[', start), rb = PUB.indexOf(']', lb);
  const body = PUB.slice(lb + 1, rb);
  const out = [];
  const re = /["']([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)["']/g;
  let m; while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

const CF = codeFiles();

// ───────────────────────── ① require 图闭环（含传递依赖） ─────────────────────────
head('【①】require 依赖图闭环（含传递闭包）');
ok(CF.length >= 10, 'CODE_FILES 解析到 ' + CF.length + ' 项（应 ≥10）');

const seen = new Set(), queue = ['server.js'], broken = [];
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  seen.add(f);
  if (!exists(f)) { broken.push(f); continue; }
  for (const dep of localReqs(f)) queue.push(dep);
}
ok(broken.length === 0, '依赖图里所有文件都真实存在' + (broken.length ? '（缺：' + broken.join('、') + '）' : ''));

// 传递闭包里剔除纯数据/清单项，只看代码
const closureCode = [...seen].filter(f => /\.js$/.test(f));
ok(closureCode.includes('server.js'), '闭包含 server.js');
ok(closureCode.length >= 11, 'server.js 的传递依赖共 ' + closureCode.length + ' 个 .js（应 ≥11）');

// 传递依赖必须全部在发布清单里（排除仅本地使用的诊断脚本）
const runtimeDeps = closureCode.filter(f => !f.startsWith('_'));
const notShipped = runtimeDeps.filter(f => !CF.includes(f));
ok(notShipped.length === 0,
  '运行期依赖全部进了 CODE_FILES' + (notShipped.length ? '（漏：' + notShipped.join('、') + '）' : '（共 ' + runtimeDeps.length + ' 个）'));

// ───────────────────────── ② 发布清单完整性 ─────────────────────────
head('【②】发布清单完整性');
ok(CF.includes('server.js'), 'CODE_FILES 含 server.js');
ok(/public[\\/]["']?index\.html|index\.html/.test(PUB.slice(PUB.indexOf('CODE_FILES'))),
  'public/index.html 有单独的同步逻辑（不依赖 CODE_FILES）');
ok(CF.includes('package.json'), 'CODE_FILES 含 package.json（线上 npm 依赖声明）');

// 守门测试自身也随包上线，它的依赖同样必须随包（否则线上跑测试第一行就炸）
const missingTest = CF.filter(f => f.startsWith('_test_') && !exists(f));
ok(missingTest.length === 0, '清单里的守门测试文件都存在' + (missingTest.length ? '（缺：' + missingTest.join('、') + '）' : ''));
{
  const orphanDep = [];
  for (const t of CF.filter(f => /^_test_.*\.js$/.test(f))) {
    if (!exists(t)) continue;
    for (const d of localReqs(t)) if (!CF.includes(d)) orphanDep.push(t + '→' + d);
  }
  ok(orphanDep.length === 0, '随包测试自身的依赖也进了清单' + (orphanDep.length ? '（缺：' + orphanDep.join('、') + '）' : ''));
}

// CODE_FILES 里的每个 .js 都必须能通过语法检查（缺文件也算失败）
// ⚠️ 别用 spawn node --check：本沙箱里 spawn 当前 node.exe 会 EBUSY。
//    改用进程内 vm.Script 编译，等价于 --check 的语法/词法检查，且零子进程。
const vm = require('vm');
const syntaxBad = [];
for (const f of CF.filter(x => /\.js$/.test(x))) {
  if (!exists(f)) { syntaxBad.push(f + '(缺失)'); continue; }
  try {
    // 先给源码套上 CJS 包装再编译，避免 --check 与 vm 在顶层 await/ESM 上的差异误报
    new vm.Script('(function(exports,require,module,__filename,__dirname){' + read(f) + '\n})', { filename: f });
  } catch (e) { syntaxBad.push(f + '(' + String(e.message || '').slice(0, 40) + ')'); }
}
ok(syntaxBad.length === 0, 'CODE_FILES 里全部 .js 通过语法检查' + (syntaxBad.length ? '（语法错：' + syntaxBad.join('、') + '）' : '（共 ' + CF.filter(x => /\.js$/.test(x)).length + ' 个）'));

// ⛔ 以前没人挡的一处：public/index.html 里那 2400 行内联脚本一旦括号没对上，
//    整个页面的按钮/刷新全哑（浏览器控制台一句报错，面板看着就是"数据不动"）。
//    node --check 吃不了 HTML，必须单独把 <script> 抠出来编译。
{
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let mm;
  while ((mm = re.exec(HTML))) blocks.push(mm[1]);
  ok(blocks.length >= 1, 'index.html 里取到 ' + blocks.length + ' 段内联脚本');
  let inlineErr = '';
  try { new vm.Script('(function(){' + (blocks[0] || '') + '\n})', { filename: 'index.html' }); }
  catch (e) { inlineErr = String(e.message || e).slice(0, 80); }
  ok(!inlineErr, 'index.html 内联脚本可通过语法编译（否则整页交互全哑）' + (inlineErr ? '（' + inlineErr + '）' : '（' + String(blocks[0] || '').split('\n').length + ' 行）'));
}

// ───────────────────────── ③ 版本三端一致 ─────────────────────────
head('【③】版本号联动（server.js ↔ public/index.html）');
const vS = (SV.match(/const APP_VER\s*=\s*'([^']+)'/) || [])[1];
const vH = (HTML.match(/const APP_VER\s*=\s*'([^']+)'/) || [])[1];
ok(!!vS && !!vH, '两端都能取到 APP_VER（' + vS + ' / ' + vH + '）');
ok(vS === vH, '两端 APP_VER 一致（不一致会导致前端无限 reload）');
ok(!/\r/.test(SV), 'server.js 无 CR 字符（Edit 偷引 CRLF 会让线上替换错位）');
ok(!/\r/.test(HTML), 'public/index.html 无 CR 字符');

// ───────────────────────── ④ 路由闭环 ─────────────────────────
head('【④】路由闭环（前端调用的路径，服务端必须有）');
// 前端所有 /api/xxx 字面量（注意字符集要含 - ：'pending-list' 曾被截断成 'pending' 造成假警报）
const fe = new Set();
{
  const re = /(["'`])(\/api\/[A-Za-z0-9_\-\/\$\{\}\.]+)\1/g;
  let m;
  while ((m = re.exec(HTML))) {
    const u = m[2].split('?')[0];
    if (!u.includes('${')) fe.add(u);
  }
}
ok(fe.size >= 20, '解析到前端引用的 /api 路径 ' + fe.size + ' 条（应 ≥20）');

// 服务端出现过的所有 /api/xxx 字面量（含 p === '/api/x' 与注释里的路径）
const svPaths = new Set();
{
  const re = /(\/api\/[A-Za-z0-9_\-\/]+)/g;
  let m; while ((m = re.exec(SV))) svPaths.add(m[1]);
}
const dead = [...fe].filter(x => !svPaths.has(x));
ok(dead.length === 0, '前端调用的路径服务端全部存在' + (dead.length ? '（悬空：' + dead.join('、') + '）' : '（' + fe.size + ' 条全通）'));

// 反向也要查：服务端有 GET 路由但前端从没调用 → 多半是改路由名时漏改一边
{
  const getRoutes = new Set();
  const re = /if \(p === '(\/api\/[A-Za-z0-9_\-\/]+)' && req\.method === 'GET'/g;
  let m; while ((m = re.exec(SV))) getRoutes.add(m[1]);
  // 排除纯调试/运维用途、以及前端用模板拼接的路径前缀
  const noise = /push-log|state|health|ping|diag|debug|export|backup|source|\/log$/;
  const orphan = [...getRoutes].filter(x => !noise.test(x) && !fe.has(x));
  console.log('    （提示）服务端有但前端未直接引用的 GET 路由 ' + orphan.length + ' 条' +
    (orphan.length ? '：' + orphan.slice(0, 6).join('、') : ''));
  ok(true, '反向核查已执行（不做硬断言，仅供翻阅）');
}

// ───────────────────────── ⑤ 派生产物 / 机密不得进发布包 ─────────────────────────
head('【⑤】派生产物与机密隔离');
ok(!CF.includes('_block.js'), '_block.js 不得进 CODE_FILES（它是 _locate.js 从 index.html 抽出来的临时语法检查产物）');
{
  const allRequires = new Set();
  for (const f of fs.readdirSync(ROOT).filter(x => /\.js$/.test(x))) {
    if (f === '_block.js') continue;
    for (const d of localReqs(f)) allRequires.add(d);
  }
  ok(!allRequires.has('_block.js'), '没有任何模块 require _block.js（它不参与运行）');
}
ok(!CF.includes('access.json'), 'access.json 不得进 CODE_FILES');
ok(/NEVER_SHIP[\s\S]{0,200}access\.json/.test(PUB), '_publish.py 的 NEVER_SHIP 含 access.json（口令哈希绝不随包上线）');

// ───────────────────────── ⑥ 工具脚本不得写死失效的 node 路径 ─────────────────────────
head('【⑥】本地工具脚本的 node 路径');
// 真事：_locate.js 写死了 .../22.22.2-3/node.exe，运行时升级到 -5 后该路径不存在，
//       语法定位工具直接抛 ENOENT —— 排查语法错时最需要它，结果它先坏了。
if (exists('_locate.js')) {
  // ⚠️ 注释里也会写旧路径做说明，所以必须先把 // 与 /* */ 注释剥掉再判，
  //    否则"描述历史 bug 的注释"会让这条断言永远红。
  const L = read('_locate.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => { const i = l.indexOf('//'); return i < 0 ? l : l.slice(0, i); }).join('\n');
  const hardcoded = /versions[\/\\][\d.]+[^\n]*node\.exe/.test(L);
  ok(!hardcoded, '_locate.js 不得写死 node 版本号（运行时一升级就先坏在自己手里）');
  // 连 spawn 都不要用：spawn 自己的 exe 在沙箱里会 EBUSY，工具会以"没问题"的姿态假失败
  ok(!/require\(\s*['"]child_process['"]\s*\)/.test(L) && !/execFileSync|spawnSync/.test(L),
    '_locate.js 不 spawn 子进程改用进程内 vm 编译（spawn 自身会 EBUSY 静默失败）');
} else {
  ok(true, '_locate.js 不存在，跳过');
}

// ───────────────────────── ⑦ 跨模块导出名一致性 ─────────────────────────
// 事故形态：server.js 写了 A.xxxFn(...)，但 analysis.js 根本没导出它 →
//           线上跑到这里才 TypeError: A.xxxFn is not a function，静态检查一个也查不出来。
// 做法：溪流两端都取权威值 —— 导出名用**运行时 Object.keys(require(...))**（不猜正则），
//       调用点用**剥掉注释与字符串后**的源码（否则 'em.js' 这种文件名会被当成 em.js 的调用）。
head('【⑦】跨模块导出名一致性（防止 A.xxx 是 undefined）');
let stripNoiseTop = stripNoise;
try { stripNoiseTop = require('./_codescan.js').stripNoise; } catch (e) { stripNoiseTop = null; }
ok(!!stripNoiseTop, '能加载 _codescan.js（注释/字符串剥离器）');

if (stripNoiseTop) {
  // 别名 → 模块文件（从 server.js 顶部 const X = require('./y') 抓）
  const alias = {};
  {
    const re = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\('(\.[^']+)'\)/gm;
    let m;
    while ((m = re.exec(SV))) {
      let f = m[2].replace(/^\.\//, '');
      if (!/\.(js|json)$/.test(f)) f += '.js';
      alias[m[1]] = f;
    }
  }
  ok(Object.keys(alias).length >= 9, '解析到命名空间导入 ' + Object.keys(alias).length + ' 个（应 ≥9）');

  const pure = stripNoise(SV);
  ok(pure.length === SV.length, '剥离器输出与原串等长（保证行号可对齐）');
  ok(pure.split('\n').length === SV.split('\n').length, '剥离器保留换行位置');

  let calls = 0;
  const dangling = [];
  for (const ns of Object.keys(alias)) {
    const f = alias[ns];
    if (!/\.js$/.test(f) || !exists(f)) continue;
    let exported;
    try { exported = Object.keys(require('./' + f)); }
    catch (e) { dangling.push(ns + '→' + f + '(加载失败:' + String(e.message).slice(0, 30) + ')'); continue; }
    const re = new RegExp('(?<![A-Za-z0-9_.$])' + ns + '\\.([A-Za-z_$][A-Za-z0-9_$]*)', 'g');
    const used = new Set();
    let m;
    while ((m = re.exec(pure))) used.add(m[1]);
    calls += used.size;
    for (const name of used) if (!exported.includes(name)) dangling.push(ns + '.' + name + '（' + f + ' 未导出）');
  }
  ok(dangling.length === 0,
    '跨模块调用点 ' + calls + ' 个，全部有对应导出' + (dangling.length ? '（悬空：' + dangling.join('、') + '）' : ''));
}

console.log('\n' + '─'.repeat(46));
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
