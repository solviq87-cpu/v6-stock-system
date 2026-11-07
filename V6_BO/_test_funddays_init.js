// 守门：S.fundDays 必须与 klines/inflowHistory 同款在初始化器里落地（2026-10-28）
//
// 病根（10-28 22:18 日志实证）：S.fundDays 原先只在精选池重建里懒初始化（S.fundDays = S.fundDays || new Map()），
// 启动后池还没重建完，handle 里 /api/trend-pool 等入口就裸调 S.fundDays.get(code) →
// TypeError: Cannot read properties of undefined (reading 'get') 把请求打崩，
// [uncaught] 连环出现后进程 rc=1 退出，看门狗反复拉起 —— 用户视角是「面板时好时坏」。
//
// 判据钉语义不钉字符串字面：
//   ① 初始化器（const S = { … }）里必须有 fundDays: new Map()；
//   ② 精选池重建里的懒初始化保留（幂等兜底，防有人从初始化器删掉后又只剩懒路径）；
//   ③ 无「既不在初始化器、又无懒初始化」的裸用法（用法点必须能追到 Map 容器）；
//   ④ 反证：把初始化行删掉后判据必须红。
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/server.js', 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// 抓 const S = { … } 初始化器块（花括号配对，不靠固定行号/字符窗口 —— 铁律④）
function grabSInit(src) {
  const start = src.indexOf('const S = {');
  if (start < 0) return '';
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const S_INIT = grabSInit(SRC);

ok('① S 初始化器里有 fundDays: new Map()（启动即容器，接口不再撞 undefined）',
  /fundDays:\s*new Map\(\)/.test(S_INIT));
ok('① klines 同款在初始化器（对照组：同病不同修不算修完）',
  /klines:\s*new Map\(\)/.test(S_INIT));
ok('① inflowHistory 同款在初始化器（对照组）',
  /inflowHistory:\s*new Map\(\)/.test(S_INIT));

ok('② 精选池重建里的幂等懒初始化仍保留（初始化器被误删时的第二道）',
  /S\.fundDays = S\.fundDays \|\| new Map\(\)/.test(SRC));

// ③ 用法点：S.fundDays.get( 的裸调用点存在且数量稳定（≥5），它们依赖①的初始化器
const uses = SRC.match(/S\.fundDays\.get\(/g) || [];
ok('③ 存在裸调用点且依赖初始化器（当前 ' + uses.length + ' 处，≥5）', uses.length >= 5);
// 已有的防御式写法样例必须还在（10037 一带）——它证明「判不出不硬判」的写法规范没被抹掉
ok('③ 防御式写法样例仍在（(S.fundDays && S.fundDays.get) 容错）',
  /\(S\.fundDays && S\.fundDays\.get\)/.test(SRC));

// ④ 反证：删掉初始化器里的 fundDays 行，①必须判红（防判据形同虚设）
{
  const broken = S_INIT.replace(/fundDays:\s*new Map\(\),?/, '');
  const stillRed = !/fundDays:\s*new Map\(\)/.test(broken);
  ok('④ 反证：删掉初始化行后判据①必须红（不许静默绿）', stillRed);
}

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exitCode = fail ? 1 : 0;
