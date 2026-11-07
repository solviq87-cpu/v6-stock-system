// 侦察 · dn 轮：同一件事在系统里是不是有「两个名字」（同义异名 / 同名异义）
// 前两轮的积累：dl「成功」有四种说法、dm「陈旧」有五种写法（kStale/pxStale/reviewStale/stale/staleBoard）。
// 这一轮往外一层，系统性扫**命名**：
//   ① 同义异名 —— 同一件事在不同模块里叫不同的名字（产出条数 n/total/count/items.length…）
//   ② 同名异义 —— 同一个字段名装的不是同一个东西（time 在各池里分别是算出时刻/沿用时刻/生成时刻）
//   ③ 同一键被赋成不同类型（一会儿数组一会儿对象一会儿数字）
//   ④ 改名只改一半留下的双轨（新旧名并存，读的人不知道该读哪个）
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const L = SV.split('\n');

console.log('=== ① 「产出条数」有几个名字（同义异名） ===');
{
  const NAMES = ['\\bn\\b', '\\btotal\\b', '\\bcount\\b', '\\bcnt\\b', '\\bnum\\b', '\\bsize\\b', '\\bkept\\b',
    '\\bscanned\\b', '\\badded\\b', '\\bhit\\b', '\\buniverseN\\b', '\\bmissKline\\b', '\\blen\\b', '\\bN\\b'];
  const bag = {};
  L.forEach((l, i) => {
    const m = l.match(/(\w+)\s*:\s*(?:\w+\.)?(?:list|out|items|arr|picked|cands|res)\.length/);
    if (m) (bag[m[1]] = bag[m[1]] || []).push(i + 1);
  });
  Object.keys(bag).sort((a, b) => bag[b].length - bag[a].length).forEach(k =>
    console.log('  ' + String(bag[k].length).padStart(3) + '×  ' + k + '.length   L' + bag[k].slice(0, 5).join(',')));
  console.log('  ── 裸字段名的出现处数 ──');
  ['n:', 'total:', 'count:', 'scanned:', 'kept:', 'universeN:', 'added:', 'hit:', 'days:'].forEach(k => {
    const c = L.filter(l => l.indexOf(k) >= 0).length;
    if (c) console.log('    ' + String(c).padStart(3) + '   ' + k);
  });
}

console.log('\n=== ② 同一个 time 字段，装的是不是同一个东西（同名异义） ===');
{
  const rows = [];
  L.forEach((l, i) => {
    if (!/\btime\s*:/.test(l)) return;
    const ctx = L.slice(Math.max(0, i - 3), i + 2).join(' ');
    let kind = '?';
    if (/toLocaleTimeString/.test(l)) kind = '当前时刻(算出时间)';
    else if (/Date\.now\(\)|new Date\(\)/.test(l) && !/toLocale/.test(l)) kind = '时间戳';
    else if (/\.time\b|dataTime|tradeKey|d\.time/.test(l)) kind = '数据自带时刻';
    else if (/null/.test(l)) kind = '空/未产出';
    else kind = '其它';
    rows.push({ line: i + 1, kind, text: l.trim().slice(0, 96) });
  });
  const byKind = {};
  rows.forEach(r => (byKind[r.kind] = byKind[r.kind] || []).push(r.line));
  Object.keys(byKind).forEach(k => console.log('  ' + String(byKind[k].length).padStart(3) + '×  ' + k + '   L' + byKind[k].slice(0, 6).join(',')));
  console.log('  （合计 ' + rows.length + ' 处 time: 赋值）');
}

console.log('\n=== ③ 同一个键被赋成不同类型（找 name 相同的两处赋值，类型不同） ===');
{
  const bag = {};
  L.forEach((l, i) => {
    // 只看对象字面量里的 `键: 值`
    const ms = l.match(/([A-Za-z_]\w*)\s*:\s*([^,}\n]+)/g) || [];
    ms.forEach(x => {
      const m = /([A-Za-z_]\w*)\s*:\s*([^,}\n]+)/.exec(x);
      if (!m) return;
      const k = m[1], v = m[2].trim();
      let t = '?';
      if (/^\[/.test(v)) t = '数组';
      else if (/^\{/.test(v)) t = '对象';
      else if (/^'|^"|^`/.test(v)) t = '字符串';
      else if (/^-?\d/.test(v)) t = '数字';
      else if (/^(true|false)$/.test(v)) t = '布尔';
      else if (/^null$/.test(v)) t = 'null';
      else return;
      (bag[k] = bag[k] || {});
      (bag[k][t] = bag[k][t] || []).push(i + 1);
    });
  });
  const bad = Object.keys(bag).filter(k => Object.keys(bag[k]).length >= 3 &&
    ['数组', '对象', '字符串', '数字'].filter(t => bag[k][t]).length >= 3);
  bad.slice(0, 22).forEach(k => {
    console.log('  ' + k.padEnd(16) + Object.keys(bag[k]).map(t => t + '×' + bag[k][t].length).join(' / ') +
      '   L' + Object.values(bag[k]).flat().slice(0, 4).join(','));
  });
  console.log('  （多型键 ' + bad.length + ' 个）');
}

console.log('\n=== ④ 改名只改一半留下的双轨（新旧名并存） ===');
{
  const PAIRS = [['ztPool', 'ztCodes'], ['S.pre', 'S.preselect'], ['stale', 'reviewStale'],
    ['candidatePool', 'preselect'], ['pushAll', 'pushWecom'], ['total', 'count'], ['n', 'total']];
  PAIRS.forEach(([a, b]) => {
    const na = L.filter(l => l.indexOf(a) >= 0).length;
    const nb = L.filter(l => l.indexOf(b) >= 0).length;
    if (na && nb) console.log('  ' + String(na).padStart(4) + ' / ' + String(nb).padStart(4) + '   ' + a + '  vs  ' + b);
  });
}

console.log('\n=== ⑤ 前端读的「条数」字段有几种写法 ===');
{
  const HL = HV.split('\n');
  const pats = ['.length', '.n', '.total', '.count', '.scanned', '.kept', '.items'];
  pats.forEach(p => {
    const n = HL.filter((l, i) => l.indexOf(p) >= 0 && i !== 1452).length;
    if (n) console.log('  ' + String(n).padStart(4) + '   ' + p);
  });
}

console.log('\n=== ⑥ /api/state 下发键里，同名而类型可能不同的（抽查） ===');
{
  const i = SV.indexOf('/api/state');
  const seg = SV.slice(i, i + 9000);
  const keys = {};
  (seg.match(/([A-Za-z_]\w*)\s*:/g) || []).forEach(x => {
    const k = x.replace(/\s*:$/, '').trim();
    keys[k] = (keys[k] || 0) + 1;
  });
  console.log('  state 段内出现的键 ' + Object.keys(keys).length + ' 个');
}
