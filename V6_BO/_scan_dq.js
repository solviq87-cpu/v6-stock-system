// dq 轮第一遍：系统里所有「上一次」变量 —— 它是谁的上一次？在什么时点比的？
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const lines = src.split('\n');
const code = lines.filter(l => !l.startsWith('const APP_VER = ')).map(stripC);

// 「上一次」变量名：last / prev / old / prior / before / snap / 上一 / 昨
const NAME_RE = /\b([A-Za-z_$][\w$]*(?:last|Last|prev|Prev|old|Old|prior|Prior|before|Before|snap|Snap|base|Base|anchor|Anchor|ref|Ref)[\w$]*)\b/g;

const stat = {};
code.forEach((l, i) => {
  let m;
  const re = new RegExp(NAME_RE.source, 'g');
  while ((m = re.exec(l)) !== null) {
    const f = m[1];
    if (!stat[f]) stat[f] = { n: 0, defs: [], uses: [] };
    stat[f].n++;
    // 定义：赋值/声明
    if (/(?:const|let|var)\s+/.test(l) || /(^|[^=!<>])=[^=]/.test(l)) {
      if (stat[f].defs.length < 4) stat[f].defs.push(i + 1);
    } else if (stat[f].uses.length < 4) {
      stat[f].uses.push(i + 1);
    }
  }
});

const rows = Object.entries(stat).sort((a, b) => b[1].n - a[1].n);
console.log('=== 「上一次」类变量（按出现次数） ===');
console.log('变量'.padEnd(30) + '次数  定义行 / 使用行');
rows.slice(0, 50).forEach(([f, v]) => {
  console.log(f.padEnd(30) + String(v.n).padEnd(6) + (v.defs.join(',') || '-') + '  /  ' + (v.uses.join(',') || '-'));
});

// ── 差值比较：cur - last / x - prev / now - t ──────────────────────────────
console.log('\n=== A. 做差比较（「比上次多了多少」）===');
let aN = 0;
code.forEach((l, i) => {
  if (/\b(cur|now|v|d|delta|diff)\b\s*-\s*\b\w*(?:last|Last|prev|Prev|old|Old)\w*\b/.test(l) ||
      /\b\w*(?:last|Last|prev|Prev|old|Old)\w*\b\.\w+\s*[-]\s*/.test(l) ||
      /-\s*\w+\.get\(/.test(l) && /last|prev|old/i.test(l)) {
    aN++; if (aN <= 30) console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 155));
  }
});
console.log('A 类合计: ' + aN);

// ── B. Map 缓存型「上一次」（lastXxx = new Map()）──────────────────────────
console.log('\n=== B. Map/Set 型「上一次」缓存（跨 tick 存活，重启即清零）===');
const bHits = [];
code.forEach((l, i) => {
  const m = l.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(Map|Set)\s*\(/);
  if (m && /last|prev|old|seen|sent|pushed|done|fired|cache|_map/i.test(m[1])) {
    bHits.push({ n: i + 1, name: m[1], kind: m[2], line: l.trim().slice(0, 140) });
  }
});
bHits.forEach(h => console.log(String(h.n).padStart(6) + '  [' + h.kind + '] ' + h.name + '   ' + h.line));
console.log('B 类合计: ' + bHits.length);

// ── C. 「上一次」变量是否落盘（重启后还在不在）─────────────────────────────
console.log('\n=== C. B 类里哪些落盘了（grep saveXxx / writeFile）===');
const persistBlobs = code.filter(l => /saveFile|writeFile|saveJSON|save[A-Z]\w*\(/.test(l)).join('\n');
bHits.forEach(h => {
  const persisted = new RegExp('\\b' + h.name + '\\b').test(persistBlobs);
  console.log('  ' + h.name.padEnd(28) + (persisted ? '持久化' : '⛔ 仅内存（重启清零）'));
});

// ── D. 模拟盘 peak / 移动止损锚 ────────────────────────────────────────────
console.log('\n=== D. peak / 移动止损锚 / 成本基准 ===');
code.forEach((l, i) => {
  if (/\bpeak\b|\bbuyPrice\b|\bbasis\b|\bhighSince\b|\bstopPct\b/.test(l) && /(?:const|let|=|\.|\[)/.test(l)) {
    if (i + 1 > 7200 && i + 1 < 7600) console.log(String(i + 1).padStart(6) + '  ' + l.trim().slice(0, 150));
  }
});

// ── E. 跨天/交易日语义：拿「上一次」比的时候有没有判是不是同一天 ───────────
console.log('\n=== E. 做差时有没有判同一天/同一交易日 ===');
const eHits = [];
code.forEach((l, i) => {
  if (!/-/.test(l)) return;
  if (!/last|prev|old|yesterday|上一|昨/i.test(l)) return;
  if (/isTradeDay|sameDay|date\s*===|date\s*!==|todayStr|dataTradeDay/.test(l)) eHits.push({ n: i + 1, ok: true, l });
  else eHits.push({ n: i + 1, ok: false, l });
});
console.log('  判了同一天: ' + eHits.filter(x => x.ok).length + ' / 没判: ' + eHits.filter(x => !x.ok).length);
eHits.filter(x => !x.ok).slice(0, 20).forEach(x => console.log(String(x.n).padStart(6) + '  ' + x.l.trim().slice(0, 150)));
