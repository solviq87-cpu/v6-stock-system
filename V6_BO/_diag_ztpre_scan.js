// 离线复刻 scanZtPre 的核心逻辑，验证联动结果
const fs=require('fs'),path=require('path');
const ZP=require('./ztpre.js'), A=require('./analysis.js');
const KLINE='.kline_cache';
const db=ZP.load();
console.log('模型: n=',db.n,'基准次日封板',(db.baseZt*100).toFixed(2)+'%');
const files=fs.readdirSync(KLINE).filter(f=>/^\d{6}\.json$/.test(f));
const nameOf=new Map();
try{ for(const s of JSON.parse(fs.readFileSync('.universe_cache.json','utf8'))){} }catch{}
const out=[];
const t0=Date.now();
for(const fn of files){
  const code=fn.slice(0,6);
  let j; try{ j=JSON.parse(fs.readFileSync(path.join(KLINE,fn),'utf8')); }catch{ continue; }
  const rows=j&&j.rows; if(!rows||rows.length<40) continue;
  const i=rows.length-1;
  const name=j.name||code;
  if(/ST|退/.test(name)) continue;
  if(!(rows[i].close>=2)) continue;
  const lim=A.limitPctOf(code,name);
  const lastPct=+(rows[i].pct||0);
  if(lastPct>=lim-0.5) continue;
  let lb=0; for(let k=i;k>=1;k--){ if((rows[k].pct||0)>=lim-0.5) lb++; else break; }
  if(lb>=4) continue;
  const f=ZP.extract(rows,i); if(!f) continue;
  const pr=ZP.predict(f,db); if(!pr) continue;
  out.push({code,name,price:rows[i].close,pct:+lastPct.toFixed(2),ztP:pr.p,base:pr.base,lift:pr.lift,feat:f.txt,why:ZTPRE_why(pr,f)});
}
function ZTPRE_why(pr,f){ return ZP.whyText(pr,f); }
out.sort((a,b)=>(b.lift-a.lift)||(b.ztP-a.ztP));
console.log(`扫描 ${files.length} 只 → 有效 ${out.length} 只，耗时 ${Date.now()-t0}ms`);
console.log('\nTOP10（形态溢价最高）:');
out.slice(0,10).forEach((x,i)=>{
  console.log(`${i+1}. ${x.name}(${x.code}) ${x.price} ${x.pct>=0?'+':''}${x.pct}%  封板预判${x.ztP}% (基准${x.base}% +${x.lift}pp)`);
  console.log(`   形态: ${x.feat.slice(0,6).join('、')}`);
});
const badName=out.filter(x=>x.name===x.code).length;
console.log('\n名称=代码残留:',badName);
// 奥士康是否在列（用户点名的趋势票）
const ask=out.find(x=>x.code==='002913');
console.log('奥士康在扫描结果里:',ask?`是（封板预判${ask.ztP}%，溢价+${ask.lift}pp）`:'否（今日已封板或被过滤）');
