// 回归验证：新加的「强势通道」能不能选出奥士康这类真趋势票？
// 做法：拿真实K线，逐日回放 —— 站在历史上每一天，用当天及之前的数据跑 trendPoolCheck，
//       看它在哪一天被选中。被选中得越早越好（最好在起爆之前）。
const fs = require('fs'), path = require('path');
const A = require('./analysis.js');
const KLINE = path.join(__dirname, '.kline_cache');

// 用户点名的四只 + 几只对照
const CASES = [
  { code: '002913', name: '奥士康', note: '用户点名的经典趋势票，涨59.7%，系统原判据0条信号' },
  { code: '600825', name: '新华传媒', note: '六连板，5.31→10.35翻倍' },
  { code: '000678', name: '襄阳轴承', note: '四连板' },
  { code: '000011', name: '深物业A', note: '三连板' }
];

const fcap = null;   // 市值数据回放时拿不到 → 按"缺数据不判死"处理

for (const c of CASES) {
  let k;
  try { k = JSON.parse(fs.readFileSync(path.join(KLINE, c.code + '.json'), 'utf8')); }
  catch { console.log(`${c.name}(${c.code}) 无K线缓存`); continue; }
  const rows = k.rows;
  console.log(`\n════ ${c.name}(${c.code}) ════ ${c.note}`);
  const first = [];
  let gentleHit = 0, strongHit = 0, anyHit = 0;
  const marks = [];
  for (let i = 30; i < rows.length; i++) {
    const slice = rows.slice(0, i + 1);
    const price = slice[slice.length - 1].close;
    let r;
    try { r = A.trendPoolCheck({ rows: slice, price, floatCap: fcap }); } catch (e) { continue; }
    if (!r) continue;
    // 温和通道（旧判据单独算：ma5up && nearMa5 && gentle && fundIn && midOk && !jumpy）
    const gentlePass = r.ma5up && r.nearMa5 && r.gentle && r.fundIn && r.midOk && !r.jumpy;
    const strongPass = !!r.strongOk && r.fundIn && r.midOk && !r.jumpy;
    if (gentlePass) gentleHit++;
    if (strongPass) strongHit++;
    if (r.ok) {
      anyHit++;
      if (first.length < 3) first.push(`${slice[slice.length - 1].date}(价${price} 分${r.trendScore} ${r.channel})`);
    }
    // 只在关键节点打点：涨停日 / 通道切换
    const p = rows[i].pct || 0;
    if (p >= 9.5 || (r.channel && (i === rows.length - 1))) {
      marks.push(`  ${slice[slice.length - 1].date} 涨${p.toFixed(2)}% → ${r.ok ? '✅入选(' + r.channel + ')' : '❌未入选'}` +
        `  [温和${gentlePass ? '过' : '×'} 强势${strongPass ? '过' : '×'}${r.strongWhy && r.strongWhy.length ? ' · ' + r.strongWhy.join(',') : ''}]`);
    }
  }
  console.log(`  回放 ${rows.length - 30} 天：旧判据(仅温和)选中 ${gentleHit} 天，强势通道选中 ${strongHit} 天，合计入选 ${anyHit} 天`);
  console.log(`  最早入选：${first.length ? first.join(' / ') : '【从未入选】'}`);
  for (const m of marks.slice(-8)) console.log(m);
  const last = A.trendPoolCheck({ rows, price: rows[rows.length - 1].close, floatCap: fcap });
  console.log(`  最新一日：${last.ok ? '✅入选 ' + last.channel : '❌未入选'} 分${last.trendScore}` +
    ` | ma20=${last.ma20} aboveMa10=${last.aboveMa10} dd60=${last.dd60}% zt60=${last.zt60} 连板${last.lb}`);
}
