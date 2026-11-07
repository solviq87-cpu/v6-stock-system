// 全市场趋势扫描（离线版，与 server.js scanTrendUniverse 同逻辑）
// 用学习模型把全市场有K线的票全算一遍，看它挑出来的是些什么票
const fs = require('fs'), path = require('path');
const L = require('./learnall.js');
const A = require('./analysis.js');
const KLINE = path.join(__dirname, '.kline_cache');
const DB = L.load();
console.log(`学习库 ver=${DB.ver} n=${DB.n} 覆盖${Object.keys(DB.prog || {}).length}只 zt基准=${(DB.baseZt * 100).toFixed(2)}%`);

const files = fs.readdirSync(KLINE).filter(f => /^\d{6}\.json$/.test(f));
const out = [];
let skipZt = 0, skipLb = 0, skipRow = 0;
for (const fn of files) {
  const code = fn.slice(0, 6);
  let k;
  try { k = JSON.parse(fs.readFileSync(path.join(KLINE, fn), 'utf8')); } catch { continue; }
  const rows = k && k.rows;
  if (!rows || rows.length < 25) { skipRow++; continue; }
  const i = rows.length - 1, name = k.name || code;
  const limitPct = A.limitPctOf(code, name);
  const lastPct = +(rows[i].pct || 0);
  if (lastPct >= limitPct - 0.5) { skipZt++; continue; }
  let lb = 0;
  for (let j = i; j >= 1; j--) { if ((rows[j].pct || 0) >= limitPct - 0.5) lb++; else break; }
  if (lb >= 4) { skipLb++; continue; }
  const f = L.extractFeatures(rows, i, { limitPct });
  if (!f) continue;
  const pz = L.predictML(f, DB, 'zt');
  const pu = L.predictML(f, DB, 'up3');
  if (!pz && !pu) continue;
  const ztP = pz ? pz.p * 100 : 0, bz = pz ? pz.base * 100 : 0;
  out.push({
    code, name, price: rows[i].close, pct: +lastPct.toFixed(2), lb,
    ztP: +ztP.toFixed(1), upP: pu ? +(pu.p * 100).toFixed(1) : 0,
    lift: +(ztP - bz).toFixed(1), why: pz && pz.rules ? pz.rules.slice(0, 2).map(r => `${r.txt}(${r.n}例→${r.rate}%)`).join('、') : '',
    maBull: f.maBull, ma20slope: f.ma20slope, dd60: f.dd60, runUp: f.runUp, zt60: f.zt60
  });
}
out.sort((a, b) => (b.lift - a.lift) || (b.ztP - a.ztP));
console.log(`扫描 ${files.length} 只 → 有效 ${out.length} 只（已封板跳过 ${skipZt}，连板≥4 跳过 ${skipLb}，K线不足跳过 ${skipRow}）`);

console.log('\n═══ TOP 20：学习模型认为"最可能封板"的票（溢价降序）═══');
console.log('名次 名称(代码)        现价   今涨%  封板%  溢价  形态(均线/中期斜率/回撤/连涨/60日板)');
out.slice(0, 20).forEach((x, i) => {
  console.log(`${String(i + 1).padStart(3)}  ${(x.name + '(' + x.code + ')').padEnd(16)} ${String(x.price).padStart(7)} ${String(x.pct).padStart(6)} ${String(x.ztP).padStart(6)} ${String(x.lift).padStart(5)}   ${x.maBull}/${x.ma20slope}/${x.dd60}/${x.runUp}/${x.zt60}`);
});
console.log('\n═══ 用户点名的四只，模型给多少分 ═══');
const WANT = ['002913', '600825', '000678', '000011'];
for (const c of WANT) {
  const x = out.find(o => o.code === c);
  if (x) console.log(`  ${x.name}(${c}) 封板${x.ztP}% 溢价${x.lift} 排名${out.indexOf(x) + 1}/${out.length} | ${x.why}`);
  else console.log(`  ${c} 未进入有效池（已封板/连板≥4/K线不足）`);
}
console.log('\n═══ 全市场分布 ═══');
const seg = (lo, hi) => out.filter(x => x.ztP >= lo && x.ztP < hi).length;
console.log(`封板概率 ≥10%: ${out.filter(x => x.ztP >= 10).length} 只 | 5~10%: ${seg(5, 10)} 只 | 3~5%: ${seg(3, 5)} 只 | <3%: ${out.filter(x => x.ztP < 3).length} 只`);
console.log(`溢价 >2 倍基准的: ${out.filter(x => x.lift >= (DB.baseZt * 100)).length} 只`);
