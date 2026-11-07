// 扫描器 · do 轮第六遍：落盘 JSON 里「同一个字段装着不同类型」
//   代码层干净不代表数据层干净 —— 磁盘上躺着的是**历史上各个版本写进去的**，
//   而补的校验只管新写入的（记忆 §10-15：一张表补校验后要问旧值走不走这道校验）。
const fs = require('fs');
const D = __dirname;
const FILES = ['stats.json', 'learnall.json', 'pushlog.json', 'news.json', 'ztpre.json',
               'paper.json', 'breadth.json', 'holdings.json', 'config.json'];
const tn = v => v === null ? 'null' : Array.isArray(v) ? '数组' :
  typeof v === 'object' ? '对象' : typeof v === 'number' ? '数字' :
  typeof v === 'boolean' ? '布尔' : '字符串';

for (const f of FILES) {
  const p = D + '/' + f;
  if (!fs.existsSync(p)) { console.log('· %s 不存在', f); continue; }
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('· %s 解析失败', f); continue; }
  const types = new Map();   // path -> Map(type -> {n, ex})
  const stack = [[j, '']];
  let guard = 0;
  while (stack.length && guard++ < 400000) {
    const [v, path] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      // 数组：按「元素类型」统计到 path[] 上
      const key = path + '[]';
      if (!types.has(key)) types.set(key, new Map());
      const g = types.get(key);
      for (const el of v.slice(0, 4000)) {
        const t = tn(el);
        if (!g.has(t)) g.set(t, { n: 0, ex: el });
        g.get(t).n++;
      }
      for (const el of v.slice(0, 4000)) {
        if (el && typeof el === 'object') stack.push([el, key]);
      }
      continue;
    }
    for (const k of Object.keys(v)) {
      const el = v[k];
      const key = path + '.' + k;
      if (!types.has(key)) types.set(key, new Map());
      const g = types.get(key);
      const t = tn(el);
      if (!g.has(t)) g.set(t, { n: 0, ex: el });
      g.get(t).n++;
      if (el && typeof el === 'object') stack.push([el, key]);
    }
  }
  const bad = [...types.entries()].filter(([, g]) => {
    const ks = [...g.keys()];
    if (ks.length < 2) return false;
    // null 与别型混用很常见（可选字段），单独看；真正可疑的是「非空类型之间」互混
    const solid = ks.filter(k => k !== 'null');
    return solid.length >= 2;
  });
  console.log('\n【%s】字段路径 %d 个 ｜同字段多类型 %d 个', f, types.size, bad.length);
  for (const [k, g] of bad.sort((a, b) => b[1].size - a[1].size).slice(0, 14)) {
    const desc = [...g.entries()].map(([t, o]) => t + '×' + o.n + (t === '字符串' ? '("' + String(o.ex).slice(0, 18) + '")' : '')).join('  ');
    console.log('   ⚠ %s', k.slice(0, 70));
    console.log('        %s', desc);
  }
  // 单列：null 与某型混用且 null 占比高（可选字段，只提示）
  const nullMix = [...types.entries()].filter(([, g]) => {
    const ks = [...g.keys()];
    return ks.length === 2 && ks.includes('null') && g.get('null').n >= 1;
  });
  if (nullMix.length) {
    console.log('   （可空字段 %d 个，例：%s）', nullMix.length,
      nullMix.slice(0, 3).map(([k, g]) => k.slice(-32) + '=' + [...g.keys()].join('/')).join(' ; '));
  }
}
