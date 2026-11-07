// di 轮侦察：同一个「够了 / 达标」，在系统里是不是同一把尺子
// ① K 线（或样本序列）的「够不够」：各处要求几根？
// ② 各类「达标线」：评分 75 / 胜率门 55 / 埋伏门 45 / 大单门 50 / 相似度 62 / 占比 6% / 市值 50 亿 / 样本 ≥5 日
// ③ 运行时：同一只票在不同模块手上，K 线根数与「够不够」的判定是否一致
const fs = require('fs');
const http = require('http');
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV);
const LINES = SVS.split('\n');

// ── ① 序列长度门槛：谁在判「几根才够」 ──────────────────────────────────
console.log('【① 序列长度门槛（K 线 / 样本序列够不够）】');
const LEN_RE = /([A-Za-z_$][\w$.\[\]]*)\s*(?:\.\s*length|\.length)\s*(<=|<|>=|>|===|!==)\s*(\d+)/g;
const lenHits = [];
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  if (l.length > 400) continue;              // 跳过超长版本注释行
  let m;
  LEN_RE.lastIndex = 0;
  while ((m = LEN_RE.exec(l))) {
    const [, v, op, n] = m;
    if (!/row|kline|kl\b|k\b|list|arr|hist|seq|bars|data|candles|days|recent|series|it/i.test(v)) continue;
    lenHits.push({ line: i + 1, v, op, n: +n, raw: l.trim().slice(0, 120) });
  }
}
const byN = new Map();
for (const h of lenHits) {
  const k = h.n + '|' + h.op;
  if (!byN.has(k)) byN.set(k, []);
  byN.get(k).push(h);
}
for (const k of [...byN.keys()].sort((a, b) => (+a.split('|')[0]) - (+b.split('|')[0]))) {
  const arr = byN.get(k);
  const [n, op] = k.split('|');
  console.log('  长度 ' + String(n).padStart(3) + ' ' + op.padEnd(2) + '  ×' + String(arr.length).padStart(2) +
    '  例: L' + arr[0].line + '  ' + arr[0].v + ' ' + op + ' ' + n);
  for (const h of arr.slice(1, 4)) console.log('        └ L' + h.line + '  ' + h.v + ' ' + h.op + ' ' + n);
}

// ── ② 数值达标线：各处「够格」的阈值 ────────────────────────────────────
console.log('\n【② 数值达标线（>= / > 某数 才算够）】');
const THR_RE = /(?:>=|>|<=|<)\s*(\d+(?:\.\d+)?)\s*(%|亿|万)?/g;
const thrHits = [];
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  if (l.length > 400) continue;
  if (!/prob|score|rate|pct|cap|sim|ratio|rise|gain|count|n\b|num|amt|vol/i.test(l)) continue;
  let m;
  THR_RE.lastIndex = 0;
  while ((m = THR_RE.exec(l))) {
    thrHits.push({ line: i + 1, n: m[1], unit: m[2] || '', raw: l.trim().slice(0, 130) });
  }
}
const THR_WATCH = ['75', '55', '45', '50', '62', '6', '3', '5', '20', '60', '100', '120', '200', '0.6', '0.7', '0.85'];
const seen = new Set();
for (const n of THR_WATCH) {
  const arr = thrHits.filter(h => h.n === n);
  if (!arr.length) continue;
  console.log('  阈值 ' + n.padStart(5) + '  ×' + String(arr.length).padStart(3));
  for (const h of arr.slice(0, 5)) {
    if (seen.has(h.line + h.n)) continue;
    seen.add(h.line + h.n);
    console.log('        L' + h.line + '  ' + h.raw);
  }
}

// ── ③ 「够不够」的语义词，看各处的说法 ─────────────────────────────────
console.log('\n【③ 「数据不足 / 至少需要」类说法】');
const WORDS = ['不足', '不够', '太少', '至少需要', '需要至少', '数据够', '不充分', '样本不足', '至少'];
for (let i = 0; i < LINES.length; i++) {
  const l = LINES[i];
  if (l.length > 400) continue;
  for (const w of WORDS) {
    if (l.includes(w)) { console.log('   L' + (i + 1) + ' [' + w + '] ' + l.trim().slice(0, 120)); break; }
  }
}

// ── ④ 运行时：本机 8787 上，同一只票在不同模块手上 K 线根数一致吗 ──────
function get(path) {
  return new Promise(res => {
    const r = http.request({ host: '127.0.0.1', port: 8787, path, method: 'GET' }, x => {
      let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(null); } });
    });
    r.on('error', () => res(null));
    r.end();
  });
}
(async () => {
  const s = await get('/api/state');
  console.log('\n【④ 运行时：各池子票数与 K 线可用性】');
  if (!s) { console.log('   本机 8787 未就绪，跳过'); return; }
  const POOLS = [
    ['pool', s.pool], ['trend', s.trend], ['bigMoney', s.bigMoney], ['similar', s.similar],
    ['buzhang', s.buzhang], ['pre', s.pre], ['ztPre', s.ztPre], ['trendScan', s.trendScan], ['steadyUp', s.steadyUp]
  ];
  for (const [name, v] of POOLS) {
    const list = Array.isArray(v) ? v : ((v || {}).items || []);
    console.log('   ' + name.padEnd(12) + ' ' + String(list.length).padStart(3) + ' 只');
  }
})();
