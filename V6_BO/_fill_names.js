// 拉取全市场股票名称 → 写入 .code_names.json，并回填 .kline_cache 里为空的 name
const fs=require('fs'),path=require('path');
const em=require('./em.js');
const KLINE='.kline_cache';
const uni=JSON.parse(fs.readFileSync('.universe_cache.json','utf8')).map(String).filter(x=>/^\d{6}$/.test(x));
(async()=>{
  const t0=Date.now();
  const map={};
  const BATCH=60;
  const batches=[];
  for(let i=0;i<uni.length;i+=BATCH) batches.push(uni.slice(i,i+BATCH));
  let done=0;
  async function w(){
    while(batches.length){
      const b=batches.shift();
      try{
        const arr=await em.fetchBatchSnapshotTx(b);
        for(const s of arr) if(s&&s.code&&s.name) map[s.code]=s.name;
      }catch(e){ }
      done++;
      if(done%20===0) console.log(`  进度 ${done}/${Math.ceil(uni.length/BATCH)} 批，已得名称 ${Object.keys(map).length}`);
    }
  }
  await Promise.all(Array.from({length:8},w));
  console.log(`拉到名称 ${Object.keys(map).length}/${uni.length}，耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
  fs.writeFileSync('.code_names.json',JSON.stringify(map));
  // 回填 K 线缓存
  let patched=0, noName=0;
  for(const fn of fs.readdirSync(KLINE)){
    const m=/^(\d{6})\.json$/.exec(fn); if(!m) continue;
    const code=m[1]; const nm=map[code]; if(!nm){ noName++; continue; }
    try{
      const p=path.join(KLINE,fn);
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      if(j && !j.name){ j.name=nm; fs.writeFileSync(p,JSON.stringify(j)); patched++; }
    }catch{}
  }
  console.log(`回填 K 线缓存 ${patched} 个，仍无名称 ${noName} 个`);
  // 校验
  let bad=0,tot=0;
  for(const fn of fs.readdirSync(KLINE)){
    const m=/^(\d{6})\.json$/.exec(fn); if(!m) continue;
    tot++;
    try{ const j=JSON.parse(fs.readFileSync(path.join(KLINE,fn),'utf8')); if(!j||!j.name) bad++; }catch{ bad++; }
  }
  console.log(`缓存 ${tot} 个，其中无名 ${bad} 个（${((tot-bad)/tot*100).toFixed(1)}% 有名称）`);
})();
