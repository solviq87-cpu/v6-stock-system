// 扫描器（ck 轮 · 时间线自洽）：全项目「当日快照」的日期标注普查。
// 找两类倒挂：
//   ① 落盘/下发的快照带 time 却不带 date → 跨天（重启、隔夜打开）昨天的被当成今天的
//   ② 前端渲染 time 却不渲染 date（或没有 stale 判据）
// 只读，不改任何东西。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// 按括号深度切出对象字面量里出现的键（先剥注释，行尾注释会污染下一个键名）
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

// 找 S.xxx = { ... } 的对象字面量顶层键
function snapKeys(name) {
  const re = new RegExp('S\\.' + name + '\\s*=\\s*\\{');
  const m = re.exec(CLEAN);
  if (!m) return null;
  let d = 0, i = m.index + m[0].length - 1, keys = {}, cur = '';
  for (; i < CLEAN.length; i++) {
    const c = CLEAN[i];
    if (d === 1 && (c === ',' || c === '\n' || c === '}')) {
      const mm = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(cur);
      if (mm) keys[mm[1]] = true;
      cur = '';
    }
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') { d--; if (d === 0) break; }
    else if (d === 1) cur += c;
  }
  return keys;
}

// /api/state 里下发的快照名
const NAMES = ['review', 'auction', 'nextplan', 'news', 'mainline', 'bigMoney', 'buzhang',
  'pre', 'badNews', 'goodNews', 'preselect', 'extLink', 'myrules', 'similar',
  'ztPool', 'pool', 'trendScan', 'steadyUp', 'ztPre', 'learnall', 'breadth', 'smallyang'];

console.log('\n【后端：快照有没有 date 字段】');
console.log('  名称'.padEnd(12) + 'date'.padEnd(8) + 'time'.padEnd(8) + '判据');
const rows = [];
for (const n of NAMES) {
  const k = snapKeys(n);
  if (!k) { console.log('  ' + n.padEnd(12) + '(未找到 S.' + n + ' = { 字面量)'); continue; }
  const hasDate = !!k.date, hasTime = !!k.time;
  rows.push({ n, hasDate, hasTime });
  console.log('  ' + n.padEnd(12) + String(hasDate).padEnd(8) + String(hasTime).padEnd(8) +
    (hasDate ? 'OK' : (hasTime ? '⛔ 有 time 无 date → 跨天会倒挂' : '-')));
}

console.log('\n【前端：渲染时有没有带日期 / stale 判据】');
const hasStale = t => new RegExp('[Ss]tal|非当日|不是今天|日期').test(
  (HTML.split('\n').filter(l => l.indexOf(t) >= 0).join('\n')));
for (const r of rows) {
  const re = new RegExp('\\b' + r.n + '\\.time\\b|\\b' + r.n + '\\s*&&\\s*' + r.n + '\\.time');
  const shown = re.test(HTML);
  console.log('  ' + r.n.padEnd(12) + '展示time=' + String(shown).padEnd(6) +
    '带日期/stale=' + String(hasStale(r.n)).padEnd(6) +
    (shown && !r.hasDate ? '  ⛔ 展示"更新于"却无 date' : (shown && !hasStale(r.n) ? '  ⚠️ 无 stale 判据' : '')));
}

console.log('\n【推送文案里出现的"今天/明日"类时间词】');
const words = ['今日', '明天', '明日', '次日', '昨天', '昨日', '今天', '当日', '收盘后'];
for (const w of words) {
  const c = (SV.split(w).length - 1);
  if (c) console.log('  ' + w + ' × ' + c);
}
