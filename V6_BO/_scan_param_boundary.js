// 扫描器：外部可控参数清单（配合 _test_param_boundary.js 用）
//
// 做法：按路由切块（语义边界 = 下一个顶层 `if (p === '`），把块里所有"来自请求"的取值点抠出来，
// 再看同一个块里有没有针对它的校验动作（钳制 / 切片 / 正则 / 类型判定 / 长度判定 / 白名单）。
// 只报事实，不定对错 —— 未校验的那些要人来判断"这个值越界了会怎样"。
//
// ⛔ 一律在剥掉注释的版本上扫：注释里会逐字引用旧写法来解释历史 bug，扫原文全是噪音。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

const lineOf = i => SV.slice(0, i).split('\n').length;

// 路由切块
const routes = [];
const re = /\n {2}if \(p === '([^']+)'/g;
let m;
while ((m = re.exec(CODE_K))) routes.push({ name: m[1], i: m.index + 1 });
function block(k) {
  const a = routes[k].i;
  const b = k + 1 < routes.length ? routes[k + 1].i : CODE_K.length;
  return CODE_K.slice(a, b);
}

// body 解析出来的对象变量名（JSON.parse(body ...) 的接收者）
const BODY_VARS = new Set(['b', '_b', 'c', '_z', 'b3', '_bt', '_q', 'bb']);
// 校验动作：命中任意一条即认为"这个字段被管过"
// ⛔ 必须做成"函数"而不是带 OBJ.F 占位的正则字面量：占位符在正则源码里写作 OBJ\.F（带反斜杠），
//    用字符串 'OBJ.F' 去 replace 根本匹配不上，会静默地把所有字段都报成"未见校验"。
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GUARDS = [
  [(v, f, s) => new RegExp('_clampInt\\(\\s*' + esc(v + '.' + f)).test(s), '钳制'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '[^\\n]{0,40}\\.slice\\(\\s*0\\s*,').test(s), '切片上限'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '[^\\n]{0,30}\\.trim\\(').test(s), 'trim'],
  [(v, f, s) => new RegExp('\\.test\\(\\s*' + esc(v + '.' + f)).test(s), '正则'],
  [(v, f, s) => new RegExp('typeof\\s+' + esc(v + '.' + f)).test(s), '类型判定'],
  [(v, f, s) => new RegExp('Number\\.isFinite\\([^)]*' + esc(v + '.' + f)).test(s), '有限数判定'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '[^\\n]{0,20}\\.length\\s*[<>]=?').test(s), '长度判定'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '\\s*\\|\\|').test(s), '空值兜底'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '\\s*===\\s*(?:true|false|[\'"\\d])').test(s), '枚举/布尔判定'],
  [(v, f, s) => new RegExp(esc(v + '.' + f) + '\\s*!==\\s*false').test(s), '布尔判定'],
  [(v, f, s) => new RegExp('(?:includes|has)\\(\\s*' + esc(v + '.' + f)).test(s), '白名单'],
];
const guardOf = (v, f, src) => (GUARDS.find(g => g[0](v, f, src)) || [null, ''])[1];

// 人工结论：扫描器看不出、但已逐条读过代码确认安全的（跨模块校验 / 隐式枚举 / 只做探针）。
// 之所以明写在这里而不是改判定规则去"猜"，是因为这类安全性来自**别处的代码**，
// 扫描器看不见，靠正则硬凑只会给出假的安全感。
const NOTES = {
  '/api/feishu/probe|body|secret': '只用于体检一次推送，不入配置；地址另有格式校验',
  '/api/smallyang|query|n': '已钳：Math.max(1, Math.min(60, Number(...)))',
  '/api/lock/pending-status|query|req': '走 _vpGet（只认自有属性）',
  '/api/lock/pending-approve|body|req': '走 _vpGet（只认自有属性）',
  '/api/holdings|body|_noSync': '内部标记，只判真值',
  '/api/holdings|body|capital': 'holdings.js 内 num() 转数并 Math.max(0, …)',
  '/api/holdings|body|tags': 'holdings.js 内 normTags 去重去空、限量 6 个、每个截 6 字',
  '/api/holdings/ops|query|n': '已钳：_clampInt(…, 1, 500, 30)',
  '/api/source|body|content': 'typeof 判字符串 + 非空 + .js 走 vm.Script 语法检查',
  '/api/similar|query|force': '只判 === "1"，其余一律不触发重扫',
  '/api/paper|body|amount': 'Math.round(Number()) + Number.isFinite + 1万~10亿区间',
};

const rows = [];
for (let k = 0; k < routes.length; k++) {
  const src = block(k);
  // 1) 查询串参数
  const seen = new Set();
  for (const g of src.matchAll(/searchParams\.get\('([^']+)'\)/g)) {
    const f = g[1];
    if (seen.has('q:' + f)) continue;
    seen.add('q:' + f);
    let guarded = f === 'token' ? '令牌（另有鉴权）' : guardOf('q', f, src.replace(/searchParams\.get\(/g, 'q.get('));
    // 查询串常写成 `_clampInt((u.searchParams && u.searchParams.get('n')) || 30, …)`，
    //    变量前缀那套判定认不出来，补一条按字段名就近匹配的
    if (!guarded && new RegExp('_clampInt\\([^\\n]{0,140}get\\(\'' + f + '\'\\)').test(src)) guarded = '钳制';
    if (!guarded) guarded = NOTES[routes[k].name + '|query|' + f] || '';
    rows.push({ route: routes[k].name, from: 'query', field: f, guard: guarded });
  }
  // 2) 请求体字段
  // ⛔ 只认本块里**真的由 JSON.parse 赋值**的变量：像 `sort((a, b) => b.ts - a.ts)` 这种
  //    比较器里的形参也叫 b，扫进去全是噪音（/api/state 一类的 GET 路由尤其多）。
  const bodyVars = [...BODY_VARS].filter(v => new RegExp('\\b' + v + '\\s*=\\s*\\(?JSON\\.parse\\(').test(src));
  for (const g of src.matchAll(/\b([a-zA-Z_$]\w*)\.([a-zA-Z_$]\w*)/g)) {
    const v = g[1], f = g[2];
    if (!bodyVars.includes(v)) continue;
    if (seen.has('b:' + f)) continue;
    seen.add('b:' + f);
    let guarded = f === 'token' ? '令牌（另有鉴权）' : guardOf(v, f, src);
    if (!guarded) guarded = NOTES[routes[k].name + '|body|' + f] || '';
    rows.push({ route: routes[k].name, from: 'body', field: f, guard: guarded });
  }
}

const un = rows.filter(r => !r.guard);
console.log('══ 外部可控参数清单 ══');
console.log(`路由 ${routes.length} 个，取值点 ${rows.length} 处，其中未见校验 ${un.length} 处\n`);
for (const r of rows) {
  console.log(`${r.guard ? '  ' : '⚠ '}${r.route}  [${r.from}] ${r.field}  ${r.guard || '（未见校验）'}`);
}
console.log('\n══ 未见校验的（需人工判断越界后果）══');
if (!un.length) console.log('  （无）');
for (const r of un) console.log(`  ${r.route} [${r.from}] ${r.field}`);
console.log('\n注：token 走鉴权链路，不算"未校验"；布尔/枚举类字段由路由分支隐式收敛，也不一定需要显式校验。');
console.log('本轮已收口的六类：请求体体积 / 撤销设备的空 id / 申请号的原型链 / 整数入参 / 口令长度 / 推送正文长度。');
