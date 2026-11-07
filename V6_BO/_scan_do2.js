// 扫描器 · do 轮第二遍：精准查「同一个键在不同分支里被赋成不同类型」
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const L = SV.split('\n');
const near = i => L.slice(Math.max(0, i - 2), i + 3).join(' ⏎ ').replace(/\s+/g, ' ').slice(0, 200);

// ── A. time 被赋成数字时间戳的那几处：会不会下发面板 ──
console.log('【A】time 字段被赋成「数字/时间戳」的地方');
L.forEach((l, i) => {
  if (!/time\s*:/.test(l)) return;
  const v = (l.match(/time\s*:\s*([^,\n}]*)/) || [])[1] || '';
  if (/^\s*Date\.now\(\)\s*$/.test(v) || /^\s*\d{9,}\s*$/.test(v)) {
    console.log('   L%d: %s', i + 1, l.trim().slice(0, 110));
    console.log('        上下文: ' + near(i));
  }
});

// ── B. /api/holdings 的六个出口各返回什么 ──
console.log('\n【B】/api/holdings 各出口返回类型');
{
  let s0 = -1, s1 = -1;
  const re = /if \(p === '\/api\/holdings'/g;
  const a = re.exec(SV);
  if (a) {
    s0 = a.index;
    const rest = SV.slice(s0 + 10);
    const b = /if \(p === '\/api\//.exec(rest);
    s1 = b ? s0 + 10 + b.index : Math.min(SV.length, s0 + 5000);
  }
  if (s0 >= 0) {
    const blk = SV.slice(s0, s1);
    blk.split('\n').forEach(l => {
      if (/json\(res,/.test(l)) console.log('   ' + l.trim().slice(0, 130));
    });
  }
}

// ── C. 前端怎么读 /api/holdings 的返回 ──
console.log('\n【C】前端读 /api/holdings 的用法');
{
  const re = /\/api\/holdings[\w\/]*/g;
  let m; const seen = new Set();
  while ((m = re.exec(HV))) {
    const line = HV.slice(0, m.index).split('\n').length;
    if (seen.has(line)) continue; seen.add(line);
    const l = HV.split('\n')[line - 1];
    console.log('   html:%d  %s', line, l.trim().slice(0, 130));
  }
  // 后端也有调用（同步转发）
  const re2 = /\/api\/holdings[\w\/]*/g;
  let m2; const seen2 = new Set();
  while ((m2 = re2.exec(SV))) {
    const line = SV.slice(0, m2.index).split('\n').length;
    if (line === 46 || seen2.has(line)) continue; seen2.add(line);
    console.log('   srv:%d  %s', line, L[line - 1].trim().slice(0, 130));
  }
}

// ── D. 「同一个键，成功分支 vs 兜底分支」类型是否一致（只看下发面板的池） ──
console.log('\n【D】结果池：成功分支 vs marketReady 失败分支，赋的是不是同一种东西');
{
  const pools = ['bigMoney', 'pre', 'buzhang', 'myrules', 'nextplan', 'review', 'sectors',
                 'steadyUp', 'trendScan', 'ztPre', 'similar', 'ztPool', 'pool', 'trendPool'];
  for (const p of pools) {
    const re = new RegExp('\\bS\\.' + p + '\\s*=(?!=)\\s*([^;\\n]*)', 'g');
    const vals = [];
    let m;
    while ((m = re.exec(SV))) vals.push(m[1].trim().slice(0, 70));
    if (vals.length < 2) continue;
    const uniq = [...new Set(vals)];
    // 类型粗判
    const kinds = new Set(uniq.map(v => /^\[/.test(v) ? '数组' : /^\{/.test(v) ? '对象' :
      /^(null|''|"")$/.test(v) ? '空' : /^-?\d/.test(v) ? '数字' : /^['"`]/.test(v) ? '字符串' : '表达式'));
    if (kinds.size > 1) {
      console.log('   ⚠ S.' + p + ' → ' + [...kinds].join(' / '));
      uniq.slice(0, 4).forEach(v => console.log('        ' + v));
    }
  }
}

// ── E. 前端把同一个键既当字符串又当数字用的地方（+ / %s 拼接 vs 算术） ──
console.log('\n【E】前端把后端字段既做算术又做字符串拼接');
{
  const keys = ['cand', 'count', 'scanned', 'kept', 'universeN', 'added', 'total', 'n'];
  for (const k of keys) {
    const re = new RegExp('\\.(' + k + ')\\b', 'g');
    let m; let arith = 0, str = 0;
    while ((m = re.exec(HV))) {
      const after = HV.slice(m.index, m.index + 40);
      if (/[*/%]\s*\d|-\s*\d|\+\s*\d/.test(after)) arith++;
      else if (/\}|\$\{|\+ *['"`]/.test(after.slice(0, 12))) str++;
    }
    if (arith && str) console.log('   .%s 算术 %d 次 / 拼接 %d 次', k, arith, str);
  }
}
