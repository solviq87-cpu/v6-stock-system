const A = require('./analysis.js');
const fs = require('fs');
const path = require('path');

function loadK(code){
  const p = path.join('.kline_cache', code + '.json');
  if(!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const rows = Array.isArray(j) ? j : (j.rows || j.data || j.k || null);
    return Array.isArray(rows) ? rows : null;
  } catch(e){ return null; }
}

const targets = [
  ['002913','奥士康'],['600825','新华传媒'],['000678','襄阳轴承'],['000011','深物业A'],
];

for(const [code,name] of targets){
  const rows = loadK(code);
  if(!rows || rows.length < 30){ console.log(`${code} ${name}: K线不足`); continue; }
  const last = rows[rows.length-1];
  const price = last.close;
  // 资金：最近5日主力净流入估算（与线上一致用 fundDays 传）
  const fundDays = rows.slice(-5).map(r=>({ net: 0 }));
  const t = A.trendPoolCheck({ rows, fundDays, price, mainInflow: 0, thsNetAmt: 0, floatCap: null });
  console.log('='.repeat(72));
  console.log(`${code} ${name}  K${rows.length}  最后 ${last.date||'?'} 收 ${price}`);
  if(!t){ console.log('  trendPoolCheck -> null'); continue; }
  console.log(`  入选=${t.ok} 通道=${t.channel} 分=${t.trendScore} hint=${t.trendScoreHint||0} 强势=${t.strongOk}`);
  console.log(`  位置: MA5=${t.ma5} MA20=${t.ma20} MA60=${t.ma60} 上20=${t.aboveMa20} 上60=${t.aboveMa60} 20线上行=${t.ma20up} 回撤60日高=${t.dd60}% r20=${t.r20}%`);
  console.log(`  资金流入=${t.fundIn} 市值=${t.capYi}亿 capOk=${t.capOk} 振幅20=${t.amp20} 摆动=${t.swingDays} jumpy=${t.jumpy}`);
  if(t.kdj) console.log(`  KDJ: ${t.kdj.txt}  [k=${t.kdj.k} d=${t.kdj.d} j=${t.kdj.j} cross=${t.kdj.cross} since=${t.kdj.since} age=${t.kdj.crossAge} state=${t.kdj.state}]`);
  if(t.fenxing) console.log(`  缠论: ${t.fenxing.txt}`);
  if(t.volPrice) console.log(`  量价: ${t.volPrice.kind} — ${t.volPrice.why}  [vr=${t.volPrice.vr} 上影=${t.volPrice.upShadow} 重心上移=${t.volPrice.cgUp}]`);
}
