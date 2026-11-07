// 侦察 · dn 轮第二遍：确认「条数」与「time」这两个名字底下到底压着几种东西
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const L = SV.split('\n');

console.log('=== ① 「本轮产出几条」在各处叫什么（同义异名实测） ===');
{
  const CASES = [
    ['ztpre 返回', /return \{ ok: true, scanned: files\.length, total: out\.length/],
    ['trendScan 返回', /return \{ ok: true, total: out\.length/],
    ['steadyUp 返回', /return \{ ok: true, total: out\.length, items/],
    ['taskSet 状态', /taskSet\('(\w+)', \{[^}]*n: /],
    ['myrules', /count: r\.count, scanned: list\.length/],
    ['nextplan', /cand: cands\.length, universeN:/],
    ['breadth', /\{ days: 0, n: 0, hit: 0/],
  ];
  CASES.forEach(([n, re]) => {
    const m = re.exec(SV);
    const i = m ? SV.slice(0, m.index).split('\n').length : -1;
    console.log('  ' + n.padEnd(16) + (i > 0 ? 'L' + i + '  ' + m[0].slice(0, 78) : '未找到'));
  });
}

console.log('\n=== ② n: 这个字段名底下压着几种东西（同名异义实测） ===');
{
  const bag = {};
  L.forEach((l, i) => {
    const m = /(?<![\w.])\bn\s*:\s*([^,}\n]{1,40})/.exec(l);
    if (!m) return;
    const v = m[1].trim();
    let k = '其它';
    if (/^out\.length|^list\.length|^\w+\.length$/.test(v)) k = '产出条数';
    else if (/^\d+$/.test(v)) k = '数字常量(窗口/阈值)';
    else if (/WIN_RULE|NEED_RULE|needOf|winOf|\.n\b/.test(v)) k = '窗口/门槛长度';
    else if (/taskSet|_zpProg|_tsProg|_kbfProg/.test(l)) k = '任务条数';
    else if (/^\w+$/.test(v)) k = '变量传递';
    bag[k] = (bag[k] || []).push(i + 1) && bag[k];
    if (!bag[k]) bag[k] = [i + 1];
  });
  Object.keys(bag).sort((a, b) => bag[b].length - bag[a].length).forEach(k =>
    console.log('  ' + String(bag[k].length).padStart(4) + '×  ' + k + '   L' + bag[k].slice(0, 6).join(',')));
  console.log('  （n: 合计 ' + Object.values(bag).reduce((s, x) => s + x.length, 0) + ' 处）');
}

console.log('\n=== ③ time: 的四种语义，各在哪些池（同名异义实测） ===');
{
  const rows = [];
  L.forEach((l, i) => {
    if (!/(?<![\w.])time\s*:/.test(l)) return;
    let k = '其它';
    if (/toLocaleTimeString/.test(l)) k = 'A 当前时刻（这一轮算出来的）';
    else if (/\b(null|''|\"\")/.test(l)) k = 'D 空/未产出';
    else if (/Date\.now\(\)/.test(l)) k = 'C 时间戳';
    else if (/\.time\b|dataTime|\bt\b\s*\|\||from|pubTime/.test(l)) k = 'B 数据自带时刻（不是算出来的）';
    rows.push({ k, line: i + 1, t: l.trim().slice(0, 80) });
  });
  const g = {};
  rows.forEach(r => (g[r.k] = g[r.k] || []).push(r.line));
  Object.keys(g).sort().forEach(k => {
    console.log('  ' + String(g[k].length).padStart(3) + '×  ' + k);
    console.log('        L' + g[k].slice(0, 8).join(', L'));
  });
}

console.log('\n=== ④ 前端：同一个「条数」读的键有几种 ===');
{
  const HL = HV.split('\n');
  const pats = [/\.n\b/, /\.total\b/, /\.count\b/, /\.scanned\b/, /\.kept\b/, /\.items\.length/, /\.length\b/];
  pats.forEach(p => {
    const ls = HL.map((l, i) => p.test(l) && i !== 1452 ? i + 1 : 0).filter(Boolean);
    console.log('  ' + String(ls.length).padStart(4) + '   ' + p + '   L' + ls.slice(0, 5).join(','));
  });
}

console.log('\n=== ⑤ taskSet 的 n 与各池自己字段的对照（同一件事两个名字） ===');
{
  const pools = { bigMoney: 'items', pre: 'items', buzhang: 'items', myrules: 'count', nextplan: 'cand', steadyUp: '数组长度' };
  Object.keys(pools).forEach(p =>
    console.log('  ' + p.padEnd(12) + ' 面板读条数 → ' + pools[p] + ' ／ taskState 读条数 → n'));
}
