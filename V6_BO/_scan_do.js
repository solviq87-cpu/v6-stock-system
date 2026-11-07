// 扫描器 · do 轮第一遍：同一个键（S.xxx / 接口字段 / 前端 s.xxx）在不同分支里
//   是不是被赋成/当成不同类型。上一轮 dn 收的是「同一件事两个名字」，这一轮往里一层 ——
//   同名异义的极端形态：同一个字段名装的不是同一种东西。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const strip = (() => {
  try { return require(D + '/_codescan.js').stripNoise; } catch (e) { return null; }
})();
const code = strip ? strip(SV, { keepStrings: true }) : SV;

// ── ① S.xxx = <expr> ：按 key 归类右值类型 ──
function kindOf(rhs) {
  const t = rhs.trim();
  if (!t) return '空';
  if (/^new Date\(\)/.test(t)) return 'new Date()';
  if (/^new Map\(/.test(t)) return 'Map';
  if (/^new Set\(/.test(t)) return 'Set';
  if (/^\{/.test(t)) return '对象字面量';
  if (/^\[/.test(t)) return '数组字面量';
  if (/^null$/.test(t)) return 'null';
  if (/^undefined$/.test(t)) return 'undefined';
  if (/^(true|false)$/.test(t)) return '布尔';
  if (/^-?\d+(\.\d+)?$/.test(t)) return '数字';
  if (/^['"`]/.test(t)) return '字符串';
  if (/^await\s/.test(t)) return 'await 调用';
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(t)) return '函数调用';
  if (/^[A-Za-z_$][\w$.]*$/.test(t)) return '变量';
  if (/^[A-Za-z_$][\w$.]*\s*\?\?|\|\|/.test(t)) return '兜底表达式';
  return '其它';
}
const assign = new Map();   // key -> Map(kind -> [示例])
{
  const re = /\bS\.([A-Za-z_$][\w$]*)\s*=(?!=)\s*([^;\n]*)/g;
  let m;
  while ((m = re.exec(code))) {
    const k = m[1], rhs = m[2];
    // 复合赋值（+= 之类）跳过
    if (!assign.has(k)) assign.set(k, new Map());
    const g = assign.get(k);
    const kd = kindOf(rhs);
    if (!g.has(kd)) g.set(kd, []);
    if (g.get(kd).length < 2) g.get(kd).push(rhs.trim().slice(0, 60));
  }
}
console.log('【①】S.xxx 被赋成多种类型的键（同名异义候选）');
const multi = [...assign.entries()].filter(([, g]) => g.size > 1);
console.log('   总键数', assign.size, '｜多类型键', multi.length);
for (const [k, g] of multi) {
  const ks = [...g.keys()];
  // 数值类的自然变体（0 / 数字）不算异义
  const norm = ks.filter(x => x !== '数字' && x !== '布尔');
  if (norm.length < 2 && !(ks.includes('对象字面量') && ks.includes('数组字面量'))) continue;
  console.log('   ⚠ S.' + k + '  →  ' + ks.join(' / '));
  for (const [kd, ex] of g) console.log('        ' + kd + ': ' + ex.join('  |  '));
}

// ── ② time 字段：53 处，装了几种语义？哪些下发面板 ──
console.log('\n【②】time 字段的语义分布');
{
  const re = /time\s*:\s*([^,\n}]*)/g;
  let m; const cnt = {};
  while ((m = re.exec(code))) {
    const v = m[1].trim();
    let kd;
    if (/new Date\(\)\.toLocaleTimeString/.test(v)) kd = '当前时刻 HH:MM:SS';
    else if (/new Date\(\)\.toLocaleString/.test(v)) kd = '当前时刻 带日期';
    else if (/Date\.now\(\)/.test(v)) kd = '时间戳(数字)';
    else if (/^null$|^''$|^""$/.test(v)) kd = '空';
    else if (/^['"`]/.test(v)) kd = '字符串常量';
    else if (/\.time\b/.test(v)) kd = '数据自带(上游 time)';
    else if (/^\d+$/.test(v)) kd = '数字';
    else kd = '其它: ' + v.slice(0, 40);
    cnt[kd] = (cnt[kd] || 0) + 1;
  }
  for (const k of Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])) console.log('   %s  %d', k.padEnd(26), cnt[k]);
}

// ── ③ 前端对同一个 s.key 的用法：是数组、对象还是标量？ ──
console.log('\n【③】前端对同一键的多种用法（.length / .items / 直接当值）');
{
  const use = new Map();
  const re = /\bs\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(HV))) {
    const k = m[1];
    const after = HV.slice(m.index, m.index + 60);
    let u = null;
    if (/^s\.[\w$]+\s*\|\|\s*\[\]/.test(after) || /^s\.[\w$]+\.length/.test(after)) u = '当数组(.length)';
    else if (/^s\.[\w$]+\.items/.test(after)) u = '当对象(.items)';
    else if (/^s\.[\w$]+\.count/.test(after)) u = '当对象(.count)';
    else if (/^s\.[\w$]+\.cand/.test(after)) u = '当对象(.cand)';
    else if (/^s\.[\w$]+\s*\)/.test(after)) u = '当标量';
    if (!u) continue;
    if (!use.has(k)) use.set(k, new Set());
    use.get(k).add(u);
  }
  const bad = [...use.entries()].filter(([, s]) => s.size > 1);
  console.log('   前端引用键数', use.size, '｜多用法键', bad.length);
  for (const [k, s] of bad) console.log('   ⚠ s.' + k + ' → ' + [...s].join(' / '));
}

// ── ④ 接口返回值：同一路由不同分支返回不同类型 ──
console.log('\n【④】同一路由 json(res, …) 返回类型是否一致');
{
  // 粗略：按 `if (p === '/api/xxx'` 分块，看块内 json(res, X) 的 X 首字符
  const routes = [];
  const re = /if \(p === '(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(SV))) routes.push([m[1], m.index]);
  for (let i = 0; i < routes.length; i++) {
    const [path, s0] = routes[i];
    const s1 = (i + 1 < routes.length) ? routes[i + 1][1] : Math.min(SV.length, s0 + 4000);
    const blk = SV.slice(s0, s1);
    const outs = [...blk.matchAll(/json\(res,\s*([^\n]{0,40})/g)].map(x => x[1]);
    if (outs.length < 2) continue;
    const kinds = new Set(outs.map(t => {
      const v = t.trim();
      if (/^\{|^Object\.assign\(\{/.test(v)) return '对象';
      if (/^\[/.test(v)) return '数组';
      if (/^(true|false)$/.test(v)) return '布尔';
      if (/^null$/.test(v)) return 'null';
      if (/^-?\d/.test(v)) return '数字';
      if (/^['"`]/.test(v)) return '字符串';
      if (/^[A-Za-z_$][\w$.]*$/.test(v)) return '变量:' + v.split('.')[0];
      return '其它';
    }));
    if (kinds.size > 1) console.log('   ⚠ ' + path + ' → ' + [...kinds].join(' / ') + '   (' + outs.length + ' 处出口)');
  }
}
