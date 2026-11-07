// di 轮侦察 ②：入池门槛 vs 算法自带门槛 —— 同一份 K 线，"够不够"是同一把尺子吗
const fs = require('fs');
const FILES = ['server.js', 'analysis.js', 'ztpre.js', 'learnall.js', 'logic.js', 'bigmoney.js'];
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');

// 取函数体（按花括号配对，先跳过形参表）
function bodyOf(src, headRe) {
  const i = src.search(headRe);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let d = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(open, j + 1); }
  }
  return null;
}

console.log('【算法函数自带的最短序列要求（rows.length < N / slice(-N) / 取前第 N 根）】');
const NAMES = [
  'calcProfitRatio', 'scoreStock', 'calcMACD', 'weeklyCross', 'hengPanFangLiang',
  'calcKDJ', 'findFenxing', 'volPricePattern', 'trendScoreHint', 'trendHygiene',
  'bigMoneyContext', 'extract', 'predict', 'maBull', 'runUp', 'dd60'
];
for (const f of FILES) {
  const p = __dirname + '/' + f;
  if (!fs.existsSync(p)) continue;
  const S = strip(fs.readFileSync(p, 'utf8'));
  for (const n of NAMES) {
    const b = bodyOf(S, new RegExp('(function\\s+' + n + '\\b|const\\s+' + n + '\\s*=|' + n + '\\s*[:]\\s*(async\\s+)?function|' + n + '\\s*\\()'));
    if (!b) continue;
    const hits = [];
    let m;
    const re1 = /(?:rows|k|kl|list|arr|r)\s*(?:\.length)?\s*(?:<=|<|>=|>)\s*(\d+)/g;
    while ((m = re1.exec(b))) hits.push(m[0].trim());
    const re2 = /\.slice\(\s*-(\d+)/g;
    while ((m = re2.exec(b))) hits.push('slice(-' + m[1] + ')');
    if (hits.length)
      console.log('  ' + f.padEnd(13) + ' ' + n.padEnd(18) + ' ' + [...new Set(hits)].join(' , '));
  }
}

console.log('\n【入池 / 扫描门槛（各池子要求几根才算"这份数据能用"）】');
const S = strip(fs.readFileSync(__dirname + '/server.js', 'utf8')).split('\n');
const POOL_RE = /(rows|k\.rows|d\.rows|mem\.rows|refRows|arr)\s*(?:\.length)?\s*(<=|<|>=|>)\s*(\d+)/;
for (let i = 0; i < S.length; i++) {
  const l = S[i];
  if (l.length > 400) continue;
  const m = POOL_RE.exec(l);
  if (!m) continue;
  console.log('  L' + String(i + 1).padStart(5) + '  ' + m[0].padEnd(22) + '  | ' + l.trim().slice(0, 110));
}
