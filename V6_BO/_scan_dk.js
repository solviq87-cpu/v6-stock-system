// dk 轮侦察：同一个「失败」，在系统里到底有几种说法
// ① 失败出口的写法种类：return null / return {ok:false} / return [] / return false /
//    console.error 后继续 / 空 catch 静默 / 直接抛 —— 各多少处
// ② 同一类事件（外部数据源拿不到）在不同模块留下的痕迹是不是一样
// ③ 面板上各区块「本轮跑没跑成」的状态字段是不是齐的（有的有 ok/error，有的完全没有）
// ④ 用户视角：出现失败时，看到的是「空白 / 旧数据 / 明确的失败 / 毫无痕迹」哪一种
const fs = require('fs');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const SVS = strip(SV).split('\n');
const EMV = fs.existsSync(__dirname + '/em.js') ? strip(fs.readFileSync(__dirname + '/em.js', 'utf8')).split('\n') : [];

// ── ① 失败出口写法统计 ──────────────────────────────────────────────────
console.log('【① 失败出口的写法种类】');
const PAT = [
  ['return null',            /return\s+null\s*;?\s*$/],
  ['return { ok:false }',    /return\s*\{\s*ok:\s*false/],
  ['return []',              /return\s*\[\s*\]\s*;/],
  ['return false',           /return\s+false\s*;/],
  ['console.error',          /console\.(error|warn)\(/],
  ['空 catch',               /\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/],
  ['catch 里只打日志',        /\}\s*catch/],
  ['throw new Error',        /throw\s+new\s+Error/],
  ['pushLog ❌',             /pushLog\(\s*['"`]❌/],
];
for (const [nm, re] of PAT) {
  let n = 0;
  for (const l of SVS) { if (l.length > 400) continue; if (re.test(l)) n++; }
  console.log('  ' + nm.padEnd(22) + String(n).padStart(4) + ' 处');
}

// ── ② 外部数据拿不到时，各模块留什么痕迹 ──────────────────────────────
console.log('\n【② 外部数据拿不到 → 各处留什么痕迹（看 catch 块里写了什么）】');
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i];
  if (l.length > 400) continue;
  if (!/\}\s*catch/.test(l)) continue;
  // 往后看 3 行
  const seg = SVS.slice(i, i + 3).join(' ').trim().slice(0, 150);
  const kind = /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(l) ? '⛔静默'
    : /console\.(error|warn)/.test(seg) ? '日志'
    : /return\s+null/.test(seg) ? '返回null'
    : /return\s*\{\s*ok:\s*false/.test(seg) ? '返回ok:false'
    : /pushLog/.test(seg) ? '记流水'
    : /return/.test(seg) ? '其它return' : '其它';
  console.log('  L' + String(i + 1).padStart(5) + ' [' + kind.padEnd(10) + '] ' + seg.slice(0, 120));
}

// ── ③ 各池子「本轮跑没跑成」的状态字段 ────────────────────────────────
console.log('\n【③ 各区块的进度/状态对象（有 ok/error 才知道「这一轮跑没跑成」）】');
const PROG = ['_zpProg', 'trendScanProg', 'ztPreProg', 'poolBasis', 'trendBasis', 'bigMoneyProg', 'newsReady', 'zpProgSet'];
for (const p of PROG) {
  const hits = [];
  for (let i = 0; i < SVS.length; i++) if (SVS[i].length <= 400 && SVS[i].includes(p)) hits.push(i + 1);
  console.log('  ' + p.padEnd(16) + String(hits.length).padStart(3) + ' 处   L' + hits.slice(0, 6).join(',L'));
}

// ── ④ em.js 各 fetch 失败时的返回值 ────────────────────────────────────
console.log('\n【④ em.js 外部取数函数的失败返回值（同一类事件，返回口径是否一致）】');
for (let i = 0; i < EMV.length; i++) {
  const l = EMV[i];
  if (l.length > 400) continue;
  const m = /(?:async\s+)?function\s+(fetch\w*)|const\s+(fetch\w*)\s*=/.exec(l);
  if (!m) continue;
  const nm = m[1] || m[2];
  // 往后 40 行内找 return null / return [] / return { ok:false }
  const seg = EMV.slice(i, i + 45).join('\n');
  const outs = [];
  if (/return\s+null/.test(seg)) outs.push('null');
  if (/return\s*\[\s*\]/.test(seg)) outs.push('[]');
  if (/return\s*\{\s*ok:\s*false/.test(seg)) outs.push('{ok:false}');
  if (/return\s+false/.test(seg)) outs.push('false');
  if (/return\s*\{\s*ok:\s*true/.test(seg)) outs.push('{ok:true}');
  if (/console\.(error|warn)/.test(seg)) outs.push('日志');
  console.log('  ' + nm.padEnd(26) + ' 失败出口: ' + (outs.join(' / ') || '（未见显式失败出口）'));
}
