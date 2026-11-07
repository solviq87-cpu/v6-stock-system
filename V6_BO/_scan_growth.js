// 扫描器（cm 轮 · 系统里"只增不减"的东西）。
// 流水、缓存、去重表、样本库、归档都在持续累积，而清理逻辑是不同时期写的、口径不一
// （有的按条数、有的按天数、有的按 IP 归并）。查两件事：
//   ① 一直累加却没有任何裁剪点的容器（只增不减 → 长跑必爆）
//   ② 同类容器之间裁剪口径是否一致（badAll 按 3 天 + 300 条，goodAll 只有 200 条 → 不自洽）
// 只读，不改任何东西。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function stripComments(src) {
  return src.split('\n').map(l => {
    let out = '', inS = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inS) { out += c; if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; out += c; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      out += c;
    }
    return out;
  }).join('\n');
}
const CLEAN = stripComments(SV);

// 收集容器声明：const X = [] / new Map() / new Set()；S.xxx = [] / new Map() / new Set()；对象字面量里的 key: []
const boxes = [];
// ⛔ 只取【模块级】声明（行首无缩进）—— 函数内的局部容器随调用结束就回收，报出来全是噪声
for (const m of CLEAN.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(\[\]|new Map\(\)|new Set\(\))/gm)) {
  boxes.push({ name: m[1], kind: m[2], decl: m[0].trim() });
}
for (const m of CLEAN.matchAll(/\bS\.([A-Za-z_$][\w$]*)\s*=\s*(\[\]|new Map\(\)|new Set\(\))/g)) {
  if (!boxes.some(b => b.name === 'S.' + m[1])) boxes.push({ name: 'S.' + m[1], kind: m[2], decl: m[0].trim() });
}

const count = (name, re) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = new RegExp(esc.replace(/\\\$/g, '$') + re, 'g');
  return (CLEAN.match(r) || []).length;
};
// 短名的直接成员（S.x.push 形式已包含在 name 里）；对 const 名还需认 `X.push`
const addOps = (name, kind) => {
  const base = name + '.';
  let n = 0;
  if (kind === 'new Map()') n += count(name, '\\.set\\(') + count(name, '\\.delete\\(') * 0;
  if (kind === 'new Set()') n += count(name, '\\.add\\(');
  if (kind === '[]') n += count(name, '\\.push\\(') + count(name, '\\.unshift\\(');
  return n;
};
const delOps = (name) => count(name, '\\.delete\\(') + count(name, '\\.clear\\(') +
  count(name, '\\.shift\\(') + count(name, '\\.splice\\(') + count(name, '\\.pop\\(');
// 长度裁剪：X.length = N / X = X.slice( / X.slice(0,N) 赋回 / X = X.filter(
const trimOps = (name) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$/g, '$');
  let n = 0;
  n += (CLEAN.match(new RegExp(esc + '\\.length\\s*=\\s*\\d+', 'g')) || []).length;
  n += (CLEAN.match(new RegExp(esc + '\\s*=\\s*' + esc + '\\.(slice|filter|splice)', 'g')) || []).length;
  n += (CLEAN.match(new RegExp(esc + '\\s*=\\s*[^\\n;]*' + esc + '[^\\n;]*\\.slice\\(', 'g')) || []).length;
  return n;
};

console.log('\n【⛔ 只增不减的容器】有累加( push/set/add )却既没有删除也没有长度裁剪的');
let grow = 0;
for (const b of boxes) {
  const a = addOps(b.name, b.kind);
  const d = delOps(b.name);
  const t = trimOps(b.name);
  if (a >= 1 && d === 0 && t === 0) {
    grow++;
    console.log(`  ⛔ ${b.name.padEnd(26)} 累加 ${a} 次 | 删除 0 | 裁剪 0   ← ${b.decl}`);
  }
}
if (!grow) console.log('  ✅ 没有发现纯累加的容器');

console.log('\n【⛔ 同类容器裁剪口径不一致】同一个语义的多个归档，裁剪规则不同');
{
  const rules = [
    ['S.news.badAll', /S\.news\.badAll\s*=\s*S\.news\.badAll\.filter\([^)]*\)\.slice\(0,\s*(\d+)\)/],
    ['S.news.goodAll', /S\.news\.goodAll[^;\n]*slice\(0,\s*(\d+)\)/],
    ['S.news.neutralAll', /S\.news\.neutralAll[^;\n]*slice\(0,\s*(\d+)\)/],
  ];
  const seen = {};
  for (const [nm, re] of rules) {
    const m = re.exec(CLEAN);
    seen[nm] = m ? m[1] : '(未找到显式裁剪)';
    console.log(`  ${nm.padEnd(20)} 上限 ${seen[nm]}`);
  }
  const within3 = /S\.news\.badAll\s*=\s*S\.news\.badAll\.filter\(x => within3Days/.test(CLEAN);
  console.log(`  ⛔ badAll 有"仅保留3日"过滤 = ${within3}；goodAll / neutralAll 有吗？`);
  for (const nm of ['goodAll', 'neutralAll']) {
    const has = new RegExp('S\\.news\\.' + nm + '\\s*=\\s*S\\.news\\.' + nm + '\\.filter\\(').test(CLEAN);
    console.log(`     ${nm}: ${has ? '有' : '⛔ 没有 —— 与 badAll 口径不一致，旧闻会一直躺在归档里'}`);
  }
  // 落盘时的上限
  const saveM = /atomicWrite\(NEWS_FILE, JSON\.stringify\(\{ badAll: S\.news\.badAll\.slice\(0, (\d+)\), goodAll: S\.news\.goodAll\.slice\(0, (\d+)\), neutralAll: S\.news\.neutralAll\.slice\(0, (\d+)\)/.exec(CLEAN);
  if (saveM) console.log(`  落盘上限：badAll ${saveM[1]} / goodAll ${saveM[2]} / neutralAll ${saveM[3]}  ← 三个数不一样，本身就是口径不一`);
}

console.log('\n【落盘容器的上限自洽性】写入时的上限 vs 载入时的上限，是否一致');
{
  const pairs = [
    ['PUSH_LOG', /PUSH_LOG\.slice\(0, (\d+)\)/g],
    ['news 归档', /\.slice\(0, (\d+)\)/g],
  ];
  const pl = [...CLEAN.matchAll(/PUSH_LOG\.slice\(0, (\d+)\)/g)].map(m => m[1]);
  console.log('  PUSH_LOG slice 上限出现的值：', [...new Set(pl)].join(', '),
    [...new Set(pl)].length === 1 ? '✅ 一致' : '⛔ 不一致（写与读的上限不同 → 每次重启都会再砍一刀）');
  const lenCap = /PUSH_LOG\.length > (\d+)\) PUSH_LOG\.length = (\d+)/.exec(CLEAN);
  if (lenCap) console.log(`  内存上限 ${lenCap[1]} → 截到 ${lenCap[2]}`, lenCap[1] === lenCap[2] ? '✅' : '⛔');
}

console.log('\n【其它已知累加点】');
{
  const pts = [
    ['KLINE 缓存目录', /KLINE_CACHE/],
    ['.holdings_ops.json', /OPS_FILE|ops\.json/],
    ['learn_history', /learn_history/],
    ['stats.json 信号', /S\.learn\.signals/],
    ['撤销名单 revoked', /_revokedBag|revoked/],
  ];
  for (const [nm, re] of pts) {
    const n = (CLEAN.match(re) || []).length;
    console.log(`  ${nm.padEnd(22)} 出现 ${n} 次`);
  }
}
