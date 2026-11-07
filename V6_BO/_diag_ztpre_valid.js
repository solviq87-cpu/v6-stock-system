// 留出验证：每只票前 70% 根训练、后 30% 根测试，看模型是否真有区分度
const fs=require('fs'),path=require('path');
const ZP=require('./ztpre.js');
const A=require('./analysis.js');
const KLINE='.kline_cache';
const files=fs.readdirSync(KLINE).filter(f=>/^\d{6}\.json$/.test(f));
// 训练库：临时文件，避免污染正式库
const TMP=path.join(__dirname,'.ztpre_tmp.json');
try{fs.unlinkSync(TMP)}catch{}
const db=ZP.newDb();
const byCode={},names={};
for(const fn of files){
  const code=fn.slice(0,6);
  try{const j=JSON.parse(fs.readFileSync(path.join(KLINE,fn),'utf8'));
    if(!j||!j.rows||j.rows.length<50) continue;
    byCode[code]=j.rows; names[code]=j.name||'';}catch{}
}
const codes=Object.keys(byCode);
console.log('票数',codes.length);
// 训练
let trN=0;
for(const code of codes){
  const rows=byCode[code];
  const cut=Math.floor(rows.length*0.7);
  const lim=A.limitPctOf(code,names[code]||'');
  for(let i=30;i<cut-1;i++){
    const f=ZP.extract(rows,i); if(!f) continue;
    const lb=ZP.labelOf(rows,i,{isLimitUp:pct=>pct>=lim-0.5}); if(!lb) continue;
    for(const k of f.keys){ let e=db.stat[k]; if(!e) e=db.stat[k]=[0,0,0]; e[0]++; if(lb.zt)e[1]++; if(lb.hit)e[2]++; }
    db.n++; if(lb.zt)db.zt++; if(lb.hit)db.hit++; trN++;
  }
}
db.baseZt=db.n?db.zt/db.n:0; db.baseHit=db.n?db.hit/db.n:0;
db.rules=ZP.mineRules(db);
console.log(`训练 ${trN} 条，基准封板 ${(db.baseZt*100).toFixed(2)}%`);
// 测试
const recs=[];
for(const code of codes){
  const rows=byCode[code];
  const cut=Math.floor(rows.length*0.7);
  const lim=A.limitPctOf(code,names[code]||'');
  for(let i=Math.max(30,cut);i<rows.length-1;i++){
    const f=ZP.extract(rows,i); if(!f) continue;
    const lb=ZP.labelOf(rows,i,{isLimitUp:pct=>pct>=lim-0.5}); if(!lb) continue;
    const p=ZP.predict(f,db); if(!p) continue;
    recs.push({p:p.p,zt:lb.zt,hit:lb.hit,code});
  }
}
console.log('测试样本',recs.length,'实际封板',recs.filter(r=>r.zt).length,'=',(recs.filter(r=>r.zt).length/recs.length*100).toFixed(2)+'%');
// 分档
const buckets=[[0,3],[3,5],[5,8],[8,15],[15,100]];
console.log('\n预测档位 → 实际次日封板率:');
for(const [a,b] of buckets){
  const g=recs.filter(r=>r.p>=a&&r.p<b);
  if(!g.length){console.log(`  ${a}~${b}%: 无样本`);continue;}
  const zt=g.filter(r=>r.zt).length, hit=g.filter(r=>r.hit).length;
  console.log(`  ${a}~${b}%: n=${g.length}  封板 ${(zt/g.length*100).toFixed(1)}%  涨≥3% ${(hit/g.length*100).toFixed(1)}%`);
}
// AUC
const pos=recs.filter(r=>r.zt).length, neg=recs.length-pos;
if(pos&&neg){
  const sorted=recs.slice().sort((x,y)=>x.p-y.p);
  let rank=0,sum=0;
  sorted.forEach((r,i)=>{ rank+= (r.zt?1:0); if(r.zt) sum+=rank; });
  const auc=(sum - pos*(pos+1)/2)/(pos*neg);
  console.log(`\nAUC(次日封板) = ${auc.toFixed(4)}`);
}
// 每日挑 5 只的效果
const byDate={};
console.log('\n（说明：按预测分降序，取前 N 只的实际封板率）');
for(const N of [5,10,20,50]){
  const g=recs.slice().sort((a,b)=>b.p-a.p).slice(0,N);
  console.log(`  前${N}只: 封板 ${(g.filter(r=>r.zt).length/N*100).toFixed(1)}%  涨≥3% ${(g.filter(r=>r.hit).length/N*100).toFixed(1)}%`);
}
