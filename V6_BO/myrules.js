'use strict';
// 用户的「十四条」选股体系 myrules.js
// 用户原话（2026-10-01）：「我要的从来都不是票，是你能否提前发现那些能涨停、
//   而且我买了以后会盈利、同时还能规避风险」，随后给出自己的 14 条条件。
//
// 设计原则（与 nextplan.js 同一套）：
//   1) 每条单独判，输出实际数值 + 计算式。算不出的一律标 unknown，**绝不能当成"不满足"**——
//      把"没数据"显示成"不符合条件"，会让人平白错过一只票（这个坑项目里踩过不止一次）。
//   2) 排除项与加分项分开：第⑪条是"不要"，命中直接出局；其余是"符合加分"。
//   3) 阈值全部可配置（cfg），你的尺子你自己能调。
//
// 数据可得性（2026-10-01 逐条 curl 实测，不是猜的）：
//   可算：① ② ③ ④ ⑤ ⑥ ⑧ ⑨ ⑩ ⑪ ⑬
//   ⑫ 已接入：东财龙虎榜（RPT_BILLBOARD_DAILYDETAILSBUY）。
//      判据 = 知名席位名录 × 净买额 × 该席位3日上涨概率，三者都写出来可核对。
//      ⚠️ 龙虎榜收盘后才出，盘中只能看到上一交易日的榜 → 用于次日作战，不用于当日实时。
//   ⑦⑭ 已接入：东财竞价分时 trends2/get?iscr=1（2026-10-09 实测可取 09:15–09:25 每分钟价/量；
//      成交额恒为 0，但价与量(手)每分钟都有 → ⑦用「每分钟价 vs 昨收」近似红绿柱、⑭用尾盘价上翘+量放大）。
//      取数失败时（东财限流）auctionTicksFor 不缓存 → ⑦⑭ 退化为 unknown，绝不算成"不符合"。

const A = require('./analysis.js');

const finite = v => typeof v === 'number' && Number.isFinite(v);
const positive = v => finite(v) && v > 0;
const nonnegative = v => finite(v) && v >= 0;
const count = v => Number.isSafeInteger(v) && v >= 0;
const pct = v => finite(v) && v >= -100;
const usableBars = (rows,n,key,valid) => Array.isArray(rows) && rows.length >= n &&
  rows.slice(-n).every(r=>r && valid(r[key]));
const amountOK = (row,key,valid) => row && valid(row[key]) &&
  [row.amountUnit,row.currency].every(u=>u==null||['CNY','yuan','元'].includes(u));
function auctionBars(tk,volumeRequired=false){
 if(!tk||!Array.isArray(tk.bars)||!tk.bars.length||tk.bars.length>11)return null;
 let prev='';
 const out=[];
 for(const b of tk.bars){
  if(!b||typeof b.t!=='string'||!/^09:(?:1[5-9]|2[0-5])$/.test(b.t)||b.t<=prev||!positive(b.price))return null;
  const values=[b.vol,b.volume].filter(x=>x!=null);
  if(volumeRequired&&(!values.length||!values.every(nonnegative)||values.some(x=>x!==values[0])))return null;
  out.push({t:b.t,price:b.price,volume:values[0]??null});prev=b.t;
 }
 return out;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n1 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(1));
const n2 = v => (v == null || !isFinite(v) ? null : +(+v).toFixed(2));
const yi = v => {
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return String(Math.round(v));
};

function maOf(rows, n, key) {
  const field=key||'close';
  if(!Number.isSafeInteger(n)||n<1||!usableBars(rows,n,field,field==='close'?positive:finite))return null;
  const value=rows.slice(-n).reduce((s,r)=>s+r[field],0)/n;
  return finite(value)?value:null;
}
// 近 n 日平均成交量（不含最后一根）
function avgVol(rows, n, skipLast) {
  if(!Array.isArray(rows)||!Number.isSafeInteger(n)||n<1)return null;
  const end=rows.length-(skipLast?1:0);
  if(end<n)return null;
  const window=rows.slice(end-n,end);
  if(!window.every(r=>r&&nonnegative(r.volume)))return null;
  const value=window.reduce((s,r)=>s+r.volume,0)/n;
  return finite(value)?value:null;
}
// 简单线性回归斜率与拟合度（判断"上升通道"用）
function linreg(ys) {
  const n = ys.length;
  if(n<5||!ys.every(finite))return {slope:null,r2:null};
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; syy += ys[i] * ys[i]; }
  const den = n * sxx - sx * sx;
  if (!den) return { slope: null, r2: null };
  const slope = (n * sxy - sx * sy) / den;
  const icpt = (sy - slope * sx) / n;
  let ss = 0, sr = 0;
  const my = sy / n;
  for (let i = 0; i < n; i++) { const p = slope * i + icpt; sr += (ys[i] - p) * (ys[i] - p); ss += (ys[i] - my) * (ys[i] - my); }
  return { slope, r2: ss > 0 ? 1 - sr / ss : null };
}

// ── 单条判定：统一返回 {ok:true/false, unknown:true, val, note} ───────────
const R = (ok, val, note) => ({ ok: !!ok, val, note });
const U = note => ({ ok: false, unknown: true, val: null, note });

function check(o, cfg) {
  const { stock, rows, sector, auction, profitRatio } = o;
  const out = [];
  const push = (i, name, r) => out.push({ i, name, ...r });

  // ① 流通市值 50~100 亿（打板最舒服的盘子：太小容易被砸、太大拉不动）
  {
    const raw=positive(stock.floatCap)?stock.floatCap/1e8:null,cap=n2(raw);
    push(1,'流通市值50-100亿',raw===null?U('缺有效流通市值数据'):
      R(raw>=cfg.capLo&&raw<=cfg.capHi,cap,`流通市值 ${cap}亿（原值判定；阈值 ${cfg.capLo}~${cfg.capHi}亿）`));
  }
  // ② 股价 < 40 元
  {
    const p = stock.price;
    push(2, '股价<40元', !positive(p) ? U('缺有效现价')
      : R(p < cfg.priceMax, p, `现价 ${p}元`));
  }
  // ③ 均线多头排列 / 粘合后突破 / 上升通道（三选一即算符合）
  {
    if(!usableBars(rows,60,'close',positive)){push(3,'均线多头/粘合突破/上升通道',U('缺完整60根有效收盘价'));}
    else {
      const c = +rows[rows.length - 1].close;
      const m5 = maOf(rows, 5), m10 = maOf(rows, 10), m20 = maOf(rows, 20), m60 = maOf(rows, 60);
      const bull = m5 > m10 && m10 > m20 && m20 > m60;
      const mx = Math.max(m5, m10, m20), mn = Math.min(m5, m10, m20);
      const spread = mn > 0 ? (mx - mn) / mn * 100 : null;
      const glueBreak = spread != null && spread < cfg.glueSpread && c > mx;
      const lr=linreg(rows.slice(-20).map(r=>r.close));
      const channel = lr.slope != null && lr.slope > 0 && lr.r2 != null && lr.r2 >= cfg.channelR2;
      const ok = bull || glueBreak || channel;
      const why = [bull ? '多头排列' : null, glueBreak ? `粘合突破(均线离散${n1(spread)}%)` : null, channel ? `上升通道(R²${n2(lr.r2)})` : null].filter(Boolean);
      push(3, '均线多头/粘合突破/上升通道', R(ok, ok ? why.join('+') : `离散${n1(spread)}%·R²${n2(lr.r2)}`, ok ? why.join(' + ') : '三者都不满足'));
    }
  }
  // ④ 涨停基因（近 N 日有涨停）+ 堆量（近5日均量 ≥ 前20日 × 倍数）
  {
    if(!Number.isSafeInteger(cfg.geneDays)||cfg.geneDays<1||!usableBars(rows,cfg.geneDays,'pct',pct)){
      push(4,'涨停基因+堆量',U('缺完整涨停基因窗口或原涨幅'));
    }else{
      const days=rows.slice(-cfg.geneDays);
      const ztN=days.filter(r=>r.noPriceLimit!==true&&r.ipoNoLimit!==true&&A.isLimitUp(stock.code,stock.name,r.pct)).length;
      // Preserve the original nested 5/20 window, both excluding the last bar.
      const v5=avgVol(rows,5,true),v20=avgVol(rows,20,true);
      const pile=v5!==null&&positive(v20)?v5/v20:null;
      if(!finite(pile))push(4,'涨停基因+堆量',U('缺完整成交量窗口或20日均量为零'));
      else push(4,'涨停基因+堆量',R(ztN>0&&pile>=cfg.pileRatio,{ztN,pile:n2(pile)},
        `近${cfg.geneDays}日原规则涨停近似 ${ztN} 次 · 5日均量/20日均量（均不含最后一根）= ${n2(pile)}`));
    }
  }
  // ⑤ 热点题材与板块效应
  {
    const zt=count(sector?.ztCount)?sector.ztCount:null,sp=pct(sector?.pct)?sector.pct:null;
    const ok=(zt!==null&&zt>=cfg.secZtMin)||(sp!==null&&sp>=cfg.secPctMin);
    if(!ok&&(zt===null||sp===null))push(5,'热点题材板块效应',U('板块涨停数或涨幅证据不足'));
    else push(5,'热点题材板块效应',R(ok,{zt,sp},`【${sector?.name||'未知'}】涨停 ${zt??'未知'} 只 · 板块涨 ${sp===null?'未知':n1(sp)+'%'}`));
  }
  // ⑥ 集合竞价换手率 0.6~1.5%、涨幅 3~6%
  {
    const aa=auction?.auctionAmount,ap=auction?.auctionPct,cap=stock.floatCap;
    // Original amount / free float capitalization proxy, not direct share turnover.
    if(!amountOK(auction,'auctionAmount',nonnegative)||!pct(ap)||!positive(cap)){
      push(6,'竞价换手0.6-1.5%·涨幅3-6%',U('竞价成交额、涨幅或流通市值证据不足'));
    }else{
      const to=aa/cap*100;
      push(6,'竞价换手0.6-1.5%·涨幅3-6%',finite(to)?
        R(to>=cfg.aucTurnLo&&to<=cfg.aucTurnHi&&ap>=cfg.aucPctLo&&ap<=cfg.aucPctHi,{to:n2(to),ap},
         `竞价换手近似 ${n2(to)}% · 竞价涨幅 ${n1(ap)}%`):U('竞价换手比率无效'));
    }
  }
  // ⑦ 竞价红柱多绿柱少 —— 红绿柱用「每分钟竞价价 vs 昨收」近似（东财竞价段无主动买卖方向）
  {
    const tk=o.aucTicks,bars=auctionBars(tk);
    const candidates=[stock.preClose,tk?.preClose].filter(v=>v!=null);
    const pre=candidates.length&&candidates.every(positive)&&candidates.every(v=>Math.abs(v-candidates[0])<=1e-6)?candidates[0]:null;
    if(!bars||pre===null)push(7,'竞价红柱多绿柱少',U('缺有效竞价分时或同口径昨收'));
    else{
      let red=0,green=0,flat=0;
      for(const b of bars){if(b.price>pre+1e-6)red++;else if(b.price<pre-1e-6)green++;else flat++;}
      push(7,'竞价红柱多绿柱少',R(red>green,{red,green,flat},`红柱 ${red} · 绿柱 ${green} · 平 ${flat}（价格相对昨收近似）`));
    }
  }
  // ⑧ 竞流比>200 · 封流比>3 · 封成比>1 · 竞昨比>8
  {
    const aa=auction?.auctionAmount,cap=stock.floatCap,seal=stock.sealAmount,amt=stock.amount;
    const prior=Array.isArray(rows)?rows.at(-2):null;
    if(!amountOK(auction,'auctionAmount',nonnegative)||!positive(cap)||!nonnegative(seal)||
       !amountOK(stock,'amount',positive)||!amountOK(prior,'amount',positive)){
      push(8,'竞流比/封流比/封成比/竞昨比',U('四项比率需完整原金额；不以成交量代替昨成交额'));
    }else{
      // Original thresholds/units: permyriad, percent, multiple, percent.
      const jingliu=aa/cap*10000,fengliu=seal/cap*100,fengcheng=seal/amt,jingzuo=aa/prior.amount*100;
      const ok=jingliu>cfg.jingliu&&fengliu>cfg.fengliu&&fengcheng>cfg.fengcheng&&jingzuo>cfg.jingzuo;
      const v={竞流比:n1(jingliu),封流比:n1(fengliu)+'%',封成比:n2(fengcheng),竞昨比:n1(jingzuo)+'%'};
      push(8,'竞流比/封流比/封成比/竞昨比',[jingliu,fengliu,fengcheng,jingzuo].every(finite)?
        R(ok,v,`竞流比 ${v.竞流比}(>${cfg.jingliu}) 封流比 ${v.封流比}(>${cfg.fengliu}%) 封成比 ${v.封成比}(>${cfg.fengcheng}) 竞昨比 ${v.竞昨比}(>${cfg.jingzuo}%)`):U('比率无效'));
    }
  }
  // ⑨ 首板 · 上板时间早 · 分时流畅 · 封单大
  {
    const lb=stock.limitUpCount,brk=stock.breakCount;
    const sealR=nonnegative(stock.sealAmount)&&amountOK(stock,'amount',positive)?stock.sealAmount/stock.amount:null;
    if(!count(lb)||!count(brk)||!finite(sealR))push(9,'首板·硬板·封单大',U('缺原始连板数、开板次数或封单/成交金额'));
    else push(9,'首板·硬板·封单大',R(lb===1&&brk===0&&sealR>=cfg.sealRatio,{lb,brk,sealR:n2(sealR)},
      `${lb===0?'未封板':lb===1?'首板':lb+'连板'} · ${brk===0?'全天未开板（近似"上板早且流畅"）':`开板${brk}次`} · 封单/成交 ${n2(sealR)}`));
  }
  // ⑩ 筹码密集区向上突破 / 低位筹码锁定
  {
    if(!Array.isArray(rows)||rows.length<25||!positive(rows.at(-1)?.close)||!rows.slice(-21,-1).every(r=>positive(r?.high))||
      profitRatio!=null&&(!finite(profitRatio)||profitRatio<0||profitRatio>100)){push(10,'筹码密集突破/锁仓',U('缺完整高点、收盘或有效筹码比例'));}
    else {
      const c = +rows[rows.length - 1].close;
      const prev20 = rows.slice(-21, -1);
      const hi = prev20.length ? Math.max(...prev20.map(r => +r.high || 0)) : null;
      const breakout = hi != null && c > hi;
      // 兼容两种口径：analysis.calcProfitRatio 返回 0~1，外部若直接给百分比(0~100)也能吃
      const pr = profitRatio != null ? (profitRatio <= 1 ? profitRatio * 100 : profitRatio) : null;
      // 低位筹码锁定：获利盘不高（抛压未释放）但已突破 → 典型启动形态
      const locked = pr != null && pr <= cfg.profitMax && breakout;
      push(10, '筹码密集突破/锁仓', R(breakout && (locked || pr == null), { breakout, pr: pr == null ? '-' : n1(pr) },
        `突破20日高点 ${breakout ? '是' : '否'} · 获利盘 ${pr == null ? '缺筹码数据' : n1(pr) + '%'}${pr == null ? '（按突破单判）' : ''}`));
    }
  }
  // ⑪ 排除项：近期 4 连板以上不要
  {
    const lb=stock.limitUpCount;
    push(11,'排除4连板以上',!count(lb)?U('连板数未知，暂不能确认排除条件'):
      R(lb<cfg.maxLianBan,lb,lb>=cfg.maxLianBan?`${lb}连板，超过上限 ${cfg.maxLianBan-1} 板 → 出局`:`${lb}板，未超限`));
  }
  // ⑫ 有大游资介入并跟随 —— 东财龙虎榜席位（2026-10-01 接入）
  //    ⚠️ 龙虎榜是【收盘后】才公布的数据，盘中拿不到当天 → 它代表"上一交易日上榜的席位"。
  //       用于次日作战计划是合适的；拿它给当日盘中推送做判据就是拿昨天的账算今天的命。
  {
    const l=o.lhb;
    if(!l||typeof l.whale!=='boolean'||!(l.whale?positive(l.whaleNet):finite(l.netBuy)))push(12,'大游资介入',U('缺有效龙虎榜席位判断或净买金额'));
    else if(l.whale)push(12,'大游资介入',R(true,l.whaleNet,l.why));
    else push(12,'大游资介入',R(false,l.netBuy,l.why));
  }
  // ⑬ 倍量过左峰
  {
    if(!Array.isArray(rows)||rows.length<61||!rows.slice(-61,-1).every(r=>positive(r?.high))||
      !positive(rows.at(-1)?.close)||!nonnegative(rows.at(-1)?.volume)||!positive(rows.at(-2)?.volume)){
      push(13,'倍量过左峰',U('需要完整前60日高点及有效两日成交量'));
    }else{
      const last=rows.at(-1),prev=rows.at(-2),vr=last.volume/prev.volume;
      const hi60=Math.max(...rows.slice(-61,-1).map(r=>r.high)),over=last.close>hi60;
      push(13,'倍量过左峰',finite(vr)?R(vr>=cfg.volRatio&&over,n2(vr),
        `量比昨日 ${n2(vr)}倍（需≥${cfg.volRatio}） · 突破60日高点 ${over?'是':'否'}`):U('量比无效'));
    }
  }
  // ⑭ 竞价尾盘抢筹上翘：09:23–09:25 价格相对 09:15–09:22 上翘且放量（东财竞价段量在，故可判）
  {
    const bars=auctionBars(o.aucTicks,true);
    const early=bars?.filter(b=>b.t<='09:22')||[],late=bars?.filter(b=>b.t>='09:23')||[];
    const sum=arr=>arr.reduce((s,b)=>s+b.volume,0);
    const ev=sum(early),lv=sum(late);
    if(!bars||bars.length<3||!early.length||!late.length||!positive(ev)||!nonnegative(lv)){
      push(14,'竞价尾盘抢筹上翘',U('缺前后竞价价格/量或前段量为零，不能计算尾量倍数'));
    }else{
      const avg=arr=>arr.reduce((s,b)=>s+b.price,0)/arr.length;
      const ea=avg(early),la=avg(late),upPct=(la-ea)/ea*100,volMul=lv/ev;
      const ok=upPct>=0.3&&volMul>=1.2;
      push(14,'竞价尾盘抢筹上翘',finite(upPct)&&finite(volMul)?
        R(ok,{upPct:n1(upPct),volMul:n1(volMul)},`尾盘价 ${upPct>=0?'+':''}${n1(upPct)}% · 尾量/前量 ${n1(volMul)}×${ok?' ✓':' ✗'}`):U('竞价比率无效'));
    }
  }
  return out;
}

const DEFAULTS = {
  capLo: 50, capHi: 100,           // ① 流通市值（亿）
  priceMax: 40,                    // ② 股价上限
  glueSpread: 5, channelR2: 0.6,   // ③ 均线粘合离散度(%) / 上升通道拟合度
  geneDays: 40, pileRatio: 1.5,    // ④ 涨停基因回溯天数 / 堆量倍数
  secZtMin: 2, secPctMin: 1.5,     // ⑤ 板块涨停数 / 板块涨幅
  aucTurnLo: 0.6, aucTurnHi: 1.5,  // ⑥ 竞价换手%
  aucPctLo: 3, aucPctHi: 6,        // ⑥ 竞价涨幅%
  jingliu: 200, fengliu: 3, fengcheng: 1, jingzuo: 8,  // ⑧ 四个比
  sealRatio: 0.3,                  // ⑨ 封单/成交额
  profitMax: 80,                   // ⑩ 获利盘上限（越低越"锁仓"）
  maxLianBan: 4,                   // ⑪ 连板上限（≥此值出局）
  volRatio: 1.8,                   // ⑬ 倍量
  minHits: 6,                      // 至少命中几条才算"符合体系"
};

// 主入口：给一只票打分
function evaluateOne(o, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const items = check(o, c);
  const hits = items.filter(x => x.ok && !x.unknown);
  const miss = items.filter(x => !x.ok && !x.unknown);
  const unknown = items.filter(x => x.unknown);
  // 排除项（⑪）不通过 → 直接出局，不看命中几条
  const exclusion=items.find(x=>x.i===11);
  const excluded=items.filter(x=>x.i===11&&!x.ok&&!x.unknown);
  const exclusionPending=exclusion?.unknown===true;
  const validThreshold=Number.isSafeInteger(c.minHits)&&c.minHits>=1;
  const verdict=excluded.length?'fail':exclusionPending||!validThreshold?'unknown':
    hits.length>=c.minHits?'pass':hits.length+unknown.length<c.minHits?'fail':'unknown';
  const pass=verdict==='pass';
  const known = hits.length + miss.length;   // 可判定的条数（unknown 不计入分母）
  return {
    code: o.stock && o.stock.code, name: o.stock && o.stock.name, price: o.stock && o.stock.price,
    hits:hits.length,known,unknown:unknown.length,pass,verdict,exclusionPending,evaluatorVersion:'v6-fourteen-native-2',
    rate: known ? Math.round(hits.length / known * 100) : null,
    hitList: hits.map(x => x.i), missList: miss.map(x => x.i), unknownList: unknown.map(x => x.i),
    excluded: excluded.length ? excluded.map(x => x.note) : [],
    items,
  };
}

// 一批票：按命中条数降序（同命中数再按"可判定率"降序），排序稳定
function scan(list, cfg) {
  const c = Object.assign({}, DEFAULTS, cfg || {});
  const out = [];
  for (const o of list) {
    let r;
    try { r = evaluateOne(o, c); } catch { continue; }
    if (!r) continue;
    out.push(r);
  }
  out.sort((a, b) => (b.hits - a.hits) || (b.rate - a.rate) || String(a.code).localeCompare(String(b.code)));
  return { count: out.filter(x => x.pass).length, all: out };
}

function formatOne(r) {
  if (!r) return '';
  const L = [`▌${r.name}(${r.code}) ${r.price}元 · 命中 ${r.hits}/${r.known} 条${r.unknown ? `（${r.unknown} 条缺数据未判）` : ''} ${r.pass?'✅符合体系':r.verdict==='unknown'?'待核对（证据不足）':'—未达标'}`];
  for (const x of r.items) {
    if (x.unknown) { L.push(`  ？ [${x.i}] ${x.name}：${x.note}`); continue; }
    L.push(`  ${x.ok ? '✔' : '✘'} [${x.i}] ${x.name}：${x.note}`);
  }
  if (r.excluded.length) L.push(`  ⛔ 出局：${r.excluded.join('；')}`);
  return L.join('\n');
}

module.exports = { evaluateOne, scan, formatOne, DEFAULTS, maOf, linreg };
