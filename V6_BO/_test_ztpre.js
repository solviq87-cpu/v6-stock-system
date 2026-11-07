// 锁死「涨停前形态学习」：分箱不重叠、标签只用未来数据、模型真有区分度
const fs=require('fs'),path=require('path');
const ZP=require('./ztpre.js');
const A=require('./analysis.js');
const KLINE=path.join(__dirname,'.kline_cache');
let pass=0,fail=0;
const ok=(c,n,g)=>{ if(c){pass++;console.log('  ✅ '+n+(g!==undefined?'  → '+g:''));} else {fail++;console.log('  ❌ '+n+'  → '+g);} };
const sec=t=>console.log('\n'+t);

sec('① 分箱：整数分类码必须一值一档（2026-10-01 踩过）');
{
  // 事故：bins 写成 [-1e9,0) 时，值 0 不满足 0<0 → 掉进 [0,1) 档，
  //      于是 0 和 1 挤在同一档 → 该维度 n 恒等于全库样本数，等于这一维没学。
  const intDims={ run:[0,1,2,3], maBull:[0,1,2], kdj:[0,1,2], macd:[0,1,2], fx:[-1,0,1], cons:[0,1], brk:[0,1] };
  const ZERO_IS_NONE=new Set(['run','maBull','kdj','macd','cons','brk']);
  for(const [k,vals] of Object.entries(intDims)){
    const di=ZP.DIMS.findIndex(d=>d.key===k);
    ok(di>=0, `维度 ${k} 存在`);
    const idx=vals.map(v=>{
      const b=ZP.DIMS[di].bins;
      for(let i=0;i<b.length;i++) if(v>=b[i][0]&&v<b[i][1]) return i;
      return b.length-1;
    });
    const uniq=new Set(idx);
    ok(uniq.size===vals.length, `${k} 的 ${vals.length} 个值落到 ${vals.length} 个不同档`, `${vals.join(',')} → ${idx.join(',')}`);
    // 值 0 必须落在第 0 档（"无/否"类）
    if(vals.includes(0) && ZERO_IS_NONE.has(k)) ok(idx[vals.indexOf(0)]===0, `${k}: 值0 落在第0档`, idx[vals.indexOf(0)]);
  }
}

sec('② 特征不偷看未来');
{
  const rows=JSON.parse(fs.readFileSync(path.join(KLINE,'002913.json'),'utf8')).rows;
  const i=rows.length-2;
  const f1=ZP.extract(rows,i);
  const f2=ZP.extract(rows.slice(0,i+1),i);   // 截掉明天
  ok(!!f1 && !!f2, '两条路都算出特征');
  ok(JSON.stringify(f1.keys)===JSON.stringify(f2.keys), '截掉未来数据后特征完全一致（没用到 i+1）', f1&&f1.keys.join(','));
  ok(ZP.extract(rows, 5)===null, '数据不足 → null（不返回假特征）');
  const fLast=ZP.extract(rows, rows.length-1);
  ok(!!fLast, '⚠️ 最后一根 K 线能算出特征（每日实时扫描要用）', fLast&&fLast.txt.slice(0,1).join(''));
  ok(ZP.extract(rows, rows.length)===null, '越界 → null');
  const lb=ZP.labelOf(rows,i,{isLimitUp:p=>p>=9.8});
  ok(lb && typeof lb.zt==='boolean' && typeof lb.hit==='boolean', '标签只含次日封板/次日涨≥3%', lb&&JSON.stringify(lb));
}

sec('③ 涨停限幅按板块（不能写死 9.8）');
{
  ok(A.limitPctOf('300750','')>=19.5, '创业板 300750 限幅≈20%', A.limitPctOf('300750',''));
  ok(A.limitPctOf('688981','')>=19.5, '科创板 688981 限幅≈20%', A.limitPctOf('688981',''));
  ok(Math.abs(A.limitPctOf('600000','')-10)<0.6, '主板 600000 限幅 10%', A.limitPctOf('600000',''));
  // 20cm 票的 12% 不算涨停，10% 算；反过来主板 10% 就算
  const lim=A.limitPctOf('300750','');
  ok(!(12>=lim-0.5) && (19.8>=lim-0.5), '按板块限幅判定：12%不算、19.8%算', lim);
}

sec('④ 库：学得出规律，且维度真的被拆开');
{
  const d=ZP.db();
  ok(d && d.n>50000, '样本量 >5万', d&&d.n);
  ok(d.baseZt>0 && d.baseZt<0.2, '次日封板基准在合理区间', d&&(d.baseZt*100).toFixed(2)+'%');
  ok((d.rules||[]).length>0, '挖出了规律', (d.rules||[]).length);
  // ⚠️ 关键：任何单一维度的样本数都不该等于全集（等于那一维没区分度）
  const byDim={};
  for(const k of Object.keys(d.stat)){
    const m=/^S:(\d+):/.exec(k); if(!m) continue;
    const di=+m[1]; byDim[di]=(byDim[di]||0)+(d.stat[k][0]);
  }
  // ⚠️ 真正要防的不是"某一档占比高"（稀有标记天然就高，如"刚突破20日高"只占 2.6%），
  //    而是**另一档根本不存在** —— 那才是分箱退化（事故时 S:10:1 的 n 就等于全库）。
  const dead=[], thin=[];
  for(const di of Object.keys(byDim)){
    const keys=Object.keys(d.stat).filter(k=>k.startsWith('S:'+di+':'));
    if(keys.length<2){ dead.push(ZP.DIMS[+di].name); continue; }
    const ns=keys.map(k=>d.stat[k][0]).sort((a,b)=>b-a);
    if(ns[1] < 500) thin.push(ZP.DIMS[+di].name+' 次档仅'+ns[1]);
  }
  ok(dead.length===0, '每个维度都至少有 2 个非空档（分箱没退化）', dead.join(',')||'无');
  ok(thin.length===0, '每个维度的次档样本 ≥500（不是只靠一档撑着）', thin.join(',')||'无');
  const top=(d.rules||[])[0];
  ok(top && top.lift>0, 'TOP 规律相对基准有正溢价', top&&`${top.name}=${top.bin} 封板${top.rate}% +${top.lift}pp`);
}

sec('⑤ 预测：有区分度（留出集）');
{
  const files=fs.readdirSync(KLINE).filter(f=>/^\d{6}\.json$/.test(f)).slice(0,600);
  const db2=ZP.newDb();
  const byCode={},names={};
  for(const fn of files){
    const code=fn.slice(0,6);
    try{const j=JSON.parse(fs.readFileSync(path.join(KLINE,fn),'utf8'));
      if(!j||!j.rows||j.rows.length<50) continue;
      byCode[code]=j.rows; names[code]=j.name||'';}catch{}
  }
  const codes=Object.keys(byCode);
  const limOf=c=>A.limitPctOf(c,names[c]||'');
  for(const code of codes){
    const rows=byCode[code], cut=Math.floor(rows.length*0.7), lim=limOf(code);
    for(let i=30;i<cut-1;i++){
      const f=ZP.extract(rows,i); if(!f) continue;
      const lb=ZP.labelOf(rows,i,{isLimitUp:p=>p>=lim-0.5}); if(!lb) continue;
      for(const k of f.keys){ let e=db2.stat[k]; if(!e) e=db2.stat[k]=[0,0,0]; e[0]++; if(lb.zt)e[1]++; if(lb.hit)e[2]++; }
      db2.n++; if(lb.zt)db2.zt++; if(lb.hit)db2.hit++;
    }
  }
  db2.baseZt=db2.n?db2.zt/db2.n:0;
  const recs=[];
  for(const code of codes){
    const rows=byCode[code], cut=Math.floor(rows.length*0.7), lim=limOf(code);
    for(let i=Math.max(30,cut);i<rows.length-1;i++){
      const f=ZP.extract(rows,i); if(!f) continue;
      const lb=ZP.labelOf(rows,i,{isLimitUp:p=>p>=lim-0.5}); if(!lb) continue;
      const p=ZP.predict(f,db2); if(!p) continue;
      recs.push({p:p.p,zt:lb.zt,hit:lb.hit});
    }
  }
  ok(recs.length>3000, '留出集样本 >3000', recs.length);
  const pos=recs.filter(r=>r.zt).length;
  ok(pos>0, '留出集里有真实封板样本', pos);
  // 预测分不应该全挤在一个值上
  const pv=new Set(recs.map(r=>Math.round(r.p*2)/2));
  ok(pv.size>=5, '预测分有 ≥5 个不同取值（不是常数）', pv.size);
  // AUC（正确公式：升序排列，每个正例统计排在它前面的负例数）
  if(pos>0 && pos<recs.length){
    const sorted=recs.slice().sort((a,b)=>a.p-b.p);
    let negSeen=0,sum=0;
    for(const r of sorted){ if(r.zt) sum+=negSeen; else negSeen++; }
    const auc=sum/(pos*(recs.length-pos));
    ok(auc>0.5, 'AUC > 0.5（真有区分度，不是倒挂）', auc.toFixed(4));
    ok(auc<1.0, 'AUC < 1（没有偷看未来造成的信息泄漏）', auc.toFixed(4));
  }
  // 高分档的实际封板率必须高于基准
  const base=recs.filter(r=>r.zt).length/recs.length*100;
  const sorted=recs.slice().sort((a,b)=>b.p-a.p);
  for(const N of [50,200]){
    const g=sorted.slice(0,N);
    const r=g.filter(x=>x.zt).length/N*100;
    ok(r>=base, `按分排序前${N}只的封板率 ≥ 大盘基准`, `${r.toFixed(1)}% vs ${base.toFixed(1)}%`);
  }
}

// ───────────────────── ⑦ 组合统计 + 标定（2026-10-01）─────────────────────
// 教训：单看「刚突破」8%、「明显放量」4.9%，可两者同时满足是 **19%** ——
//   只存单维统计永远学不到这种交互。而且老融合算法把 11 维对数几率取平均，
//   给这种票只报 3.1%（低估 6 倍）。这两条一起锁死。
console.log('\n【⑦ 组合统计与概率标定】');
{
  const real = ZP.load();
  const keys = Object.keys(real.stat || {});
  const pairs = keys.filter(k => k.charAt(0) === 'P');
  ok(pairs.length >= 100, `库里存了二维组合统计 ${pairs.length} 个（不止单维）`);
  const pk = pairs.find(k => /^P:2:4:10:1$/.test(k));            // 明显放量 × 刚突破20日高
  if (pk) {
    const e = real.stat[pk];
    const rate = e[1] / e[0] * 100;
    ok(rate > 15, '「明显放量 × 刚突破20日高」实测封板 > 15%', rate.toFixed(2) + '% (n=' + e[0] + ')');
  } else ok(false, '存在「明显放量 × 刚突破20日高」组合键');

  ok(!!real.calib && typeof real.calib.lam === 'number', '库里有标定系数 lam', real.calib && real.calib.lam);
  ok(real.calib && real.calib.lam > 0.2 && real.calib.lam < 0.8,
    'lam 在 0.2~0.8 之间（太小=低估强信号，太大=高估）', real.calib && real.calib.lam);

  const D = ZP.DIMS, DK = D.map(d => d.key);
  const bi = (di, v) => { const b = D[di].bins; for (let i = 0; i < b.length; i++) if (v >= b[i][0] && v < b[i][1]) return i; return b.length - 1; };
  const mk = v => { const f = Object.assign({}, v); f.keys = DK.map((k, di) => 'S:' + di + ':' + bi(di, f[k])); return f; };
  const strong = ZP.predict(mk({ run: 3, sum5: 12, volR: 2.0, dd20: 0.5, maBull: 2, kdj: 1, macd: 2, fx: 1, amp: 8, cons: 0, brk: 1 }), real);
  ok(strong && strong.p >= 15, '强组合（突破+放量）预测 ≥ 15%（老算法只给 3.1%）', strong && strong.p + '%');
  const weak = ZP.predict(mk({ run: 0, sum5: 1, volR: 0.8, dd20: 6, maBull: 1, kdj: 1, macd: 1, fx: 0, amp: 2, cons: 1, brk: 0 }), real);
  ok(weak && weak.p <= 1.5, '缩量横盘整理预测 ≤ 1.5%（这类实测只有 0.45%）', weak && weak.p + '%');
  ok(strong && weak && strong.p > weak.p * 10, '强弱形态的概率区分度 > 10 倍');

  const rs = (real.rules || []);
  ok(rs.some(r => r.key.charAt(0) === 'S') && rs.some(r => r.key.charAt(0) === 'P'),
    'rules 里单维与组合都有（分名额，别让组合把单维挤光）',
    `单维 ${rs.filter(r => r.key.charAt(0) === 'S').length} / 组合 ${rs.filter(r => r.key.charAt(0) === 'P').length}`);
}

console.log(`\n${fail===0?'🎉':'💥'} 涨停前学习测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail?1:0);
