// dj 轮侦察：同一个「最近 N 日」，在系统里是不是同一个窗口
// ① 所有 slice(-N) / slice(-N, -M)：各处"最近"到底是几根
// ② 窗口的"日"是交易日还是自然日（同一句"近20日"两种算法差 40%）
// ③ 对外文案写的"近N日 / N日内" 与实现里的 slice 长度是不是同一个数
// ④ ⛔ 数据不足时窗口会静默变短（slice(-90) 只有 6 根时实际是 6 日），而文案照写"90日"
const fs = require('fs');
const http = require('http');
const FILES = ['server.js', 'analysis.js', 'ztpre.js', 'learnall.js', 'logic.js'];
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');

// ── ① slice(-N) 全清单 ──────────────────────────────────────────────────
console.log('【① slice(-N)：各处「最近」到底取几根】');
const byN = new Map();
for (const f of FILES) {
  const p = __dirname + '/' + f;
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, 'utf8');
  const S = strip(raw);
  const LINES = S.split('\n');
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i];
    if (l.length > 400) continue;
    let m; const re = /\.slice\(\s*-(\d+)\s*(?:,\s*(-?\d+)\s*)?\)/g;
    while ((m = re.exec(l))) {
      const n = m[1];
      // 往上找所属函数
      let fn = '?';
      for (let k = i - 1; k >= 0; k--) {
        const s2 = LINES[k];
        const a = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(s2)
          || /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?[(\w]/.exec(s2)
          || /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function/.exec(s2);
        if (a) { fn = a[1]; break; }
      }
      if (!byN.has(n)) byN.set(n, []);
      byN.get(n).push({ f, fn, line: i + 1, txt: l.trim().slice(0, 100) });
    }
  }
}
for (const n of [...byN.keys()].sort((a, b) => (+a) - (+b))) {
  const arr = byN.get(n);
  const fns = [...new Set(arr.map(x => x.f + ':' + x.fn))];
  console.log('  最近 ' + String(n).padStart(3) + ' 根  ×' + String(arr.length).padStart(2) +
    '  ← ' + fns.slice(0, 6).join(', ') + (fns.length > 6 ? ' …' : ''));
}

// ── ② 「日」是交易日还是自然日 ──────────────────────────────────────────
console.log('\n【② 窗口的「日」：交易日 vs 自然日】');
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const SVS = strip(SV).split('\n');
const DAYFN = ['tradeDaysSince', 'tradeDaysBetween', 'isTradeDay', 'dataTradeDay', 'dayKeyOf', 'todayStr'];
for (const fn of DAYFN) {
  const hits = [];
  for (let i = 0; i < SVS.length; i++) if (SVS[i].length <= 400 && SVS[i].includes(fn + '(')) hits.push(i + 1);
  console.log('  ' + fn.padEnd(18) + ' 调用 ' + String(hits.length).padStart(3) + ' 处  L' + hits.slice(0, 8).join(',L'));
}
// 自然日算法的窗口（用 Date 相减 / 86400000）
console.log('  —— 用毫秒差算"天"的地方（自然日口径）——');
for (let i = 0; i < SVS.length; i++) {
  const l = SVS[i];
  if (l.length > 400) continue;
  if (/86400|86400000|24\s*\*\s*60\s*\*\s*60/.test(l)) console.log('     L' + (i + 1) + '  ' + l.trim().slice(0, 110));
}

// ── ③ 对外文案里的「近N日 / N日内」 vs 实现 ────────────────────────────
console.log('\n【③ 文案写的「近N日 / N日内」与实现是否同数（⛔ 判文案必须用原始源码）】');
const RAW = SV.split('\n');
const W_RE = /(近|最近)\s*(\d+)\s*(日|天)|(\d+)\s*日内|近\s*(\d+)\s*根|(\d+)\s*日(内|涨停|涨幅|振幅|高点|低点)/;
const seen = new Set();
for (let i = 0; i < RAW.length; i++) {
  const l = RAW[i];
  if (l.length > 400) continue;
  const m = W_RE.exec(l);
  if (!m) continue;
  const key = (i + 1);
  if (seen.has(key)) continue;
  seen.add(key);
  console.log('  L' + String(i + 1).padStart(5) + '  ' + l.trim().slice(0, 130));
}

// ── ④ 运行时：本机各池子 K 线根数分布（多少票的窗口是"不满的"）────────
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
  console.log('\n【④ 运行时：本机 8787 各池子 K 线根数（窗口不满 = 说的和算的不是一回事）】');
  const s = await get('/api/state');
  if (!s) { console.log('   本机未就绪，跳过'); return; }
  const POOLS = [['pool', s.pool], ['trend', s.trend], ['bigMoney', s.bigMoney], ['ztPre', s.ztPre], ['trendScan', s.trendScan]];
  for (const [nm, v] of POOLS) {
    const list = Array.isArray(v) ? v : ((v || {}).items || []);
    if (!list.length) { console.log('   ' + nm.padEnd(10) + ' 0 只'); continue; }
    const zt = list.filter(x => x.zt90 != null).length;
    console.log('   ' + nm.padEnd(10) + String(list.length).padStart(3) + ' 只，带 zt90 字段 ' + zt + ' 只' +
      '（该字段窗口名义 90 根，实际根数未知 → 文案统一写「90日涨停」）');
  }
  const kc = await get('/api/state');
  console.log('   ⓘ 精选池首只示例: ' + JSON.stringify(((s.pool || [])[0] || {})).slice(0, 160));
})();
