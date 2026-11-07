const fs=require('fs'),path=require('path');
const ZP=require('./ztpre.js');
const A=require('./analysis.js');
const KLINE='.kline_cache';
const files=fs.readdirSync(KLINE).filter(f=>/^\d{6}\.json$/.test(f));
const pick=files.slice(0,400);
const byCode={}, names={};
for(const fn of pick){
  const code=fn.slice(0,6);
  try{ const j=JSON.parse(fs.readFileSync(path.join(KLINE,fn),'utf8'));
    if(!j||!j.rows||j.rows.length<45) continue;
    byCode[code]=j.rows; names[code]=j.name||'';
  }catch{}
}
console.log('样本票:',Object.keys(byCode).length);
const t0=Date.now();
const r=ZP.ingestAll(byCode,{ names, isLimitUp:(pct)=>A.isLimitUp('000001','',pct) });
console.log('入库:',JSON.stringify(r),'耗时',((Date.now()-t0)/1000).toFixed(1)+'s');
const d=ZP.db();
console.log('\n基准: 次日封板', (d.baseZt*100).toFixed(2)+'%',' 次日涨≥3%',(d.baseHit*100).toFixed(2)+'%',' 样本',d.n);
console.log('\nTOP 规律（次日封板率 vs 基准的溢价）:');
(d.rules||[]).slice(0,12).forEach(x=>console.log(`  ${x.name}=${x.bin}  n=${x.n}  封板${x.rate}%  溢价+${x.lift}pp  (涨≥3% ${x.hitRate}%)`));
