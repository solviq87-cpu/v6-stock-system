const round=x=>Number.isFinite(x)?+x.toFixed(2):null;
const dayMs=86400000;
const closeDate=r=>String(r.exitTime||r.exitDate||r.date||'').slice(0,10);
export function sampleWeight(row,policy={}){
  if(!policy.decayEnabled)return 1;
  const end=Date.parse(String(policy.asOf||'').slice(0,10)),observed=Date.parse(closeDate(row)),half=Number(policy.decayHalfLifeDays);
  if(!Number.isFinite(end)||!Number.isFinite(observed)||!(half>0)||observed>end)return 0;
  return 2**-Math.min(1000,(end-observed)/dayMs/half);
}
export function stats(rows,policy={}){
  const sample=rows.filter(t=>t.pnl!=null&&String(t.pnl).trim()&&Number.isFinite(Number(t.pnl))).sort((a,b)=>
    String(a.exitTime||a.exitDate||a.date).localeCompare(String(b.exitTime||b.exitDate||b.date)));
  // A common scaling factor cancels out of weighted rates and Kish's N.
  // Anchor at the most recent eligible realization to preserve old cohorts.
  const eligible=policy.decayEnabled?sample.filter(r=>closeDate(r)<=policy.asOf.slice(0,10)):sample;
  const normalized=policy.decayEnabled&&eligible.length?{...policy,asOf:eligible.map(closeDate).sort().at(-1)}:policy;
  let equity=1,peak=1,drawdown=0,wins=0,losses=0,n=0,total=0,win=0,loss=0,gains=0,cost=0,sumSquares=0,worst=Infinity;
  for(const r of eligible){
    const pnl=Number(r.pnl),w=sampleWeight(r,normalized);if(!w)continue;
    total+=w;sumSquares+=w*w;n++;worst=Math.min(worst,pnl);
    if(pnl>0){wins++;win+=w;gains+=pnl*w;}
    if(pnl<0){losses++;loss+=w;cost+=-pnl*w;}
    const exposure=r.position!=null&&Number.isFinite(+r.position)?+r.position/100:1;
    equity*=Math.max(0,1+pnl/100*exposure);peak=Math.max(peak,equity);
    drawdown=Math.max(drawdown,(peak-equity)/peak*100);
  }
  return {n,wins,losses,effectiveN:sumSquares?round(total*total/sumSquares):0,winRate:total?round(100*win/total):null,
    lossRate:total?round(100*loss/total):null,payoff:win&&loss?round(gains/win/(cost/loss)):null,
    expectedReturn:total?round((gains-cost)/total):null,maxDrawdown:n?round(drawdown):null,worst:n?round(worst):null};
}
export function weightedQuartile(rows,score,policy){
  const ordered=rows.map(r=>({s:score(r),w:sampleWeight(r,policy)})).filter(x=>x.w>0).sort((a,b)=>a.s-b.s);
  if(!ordered.length)return 0;
  if(!policy.decayEnabled)return ordered[Math.floor((ordered.length-1)/4)].s;
  const target=ordered.reduce((s,r)=>s+r.w,0)/4;let w=0;
  for(const r of ordered){w+=r.w;if(w>=target)return r.s;}
  return ordered.at(-1).s;
}
const groups=(rows,keys)=>{
  const m=new Map();
  for(const r of rows)for(const key of new Set(keys(r))){if(!m.has(key))m.set(key,[]);m.get(key).push(r);}
  return m;
};
const trends=['多头','震荡','空头'];
export function groupedPerformance(rows,keys,kind,policy){
  const aggregate=[];
  for(const [name,observations] of groups(rows,keys))for(const trend of trends){
    const sample=observations.filter(t=>t.trend===trend);
    if(sample.length)aggregate.push({[kind]:name,trend,...stats(sample,policy)});
  }
  return aggregate.sort((a,b)=>b.n-a.n||a[kind].localeCompare(b[kind])||trends.indexOf(a.trend)-trends.indexOf(b.trend));
}
function pastMonths(asOf){
  const anchor=new Date(Date.parse(String(asOf).slice(0,7)+'-01T00:00:00Z'));
  return [3,2,1].map(i=>new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()-i,1)).toISOString().slice(0,7));
}
export function decayAlerts(rows,keys,asOf,policyFor){
  const periods=pastMonths(asOf),alerts=[];
  const nextMonth=m=>{const d=new Date(m+'-01T00:00:00Z');return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10);};
  const windows=periods.map(period=>{const end=nextMonth(period);return {period,end,policy:policyFor(new Date(Date.parse(end)-1).toISOString().slice(0,16))};});
  for(const [factor,observations] of groups(rows,keys)){
    const metrics=windows.map(({period,end,policy})=>{
      const sample=observations.filter(r=>closeDate(r).startsWith(period)&&(!r.labelKnownAt||r.labelKnownAt<end));
      const {n,payoff,winRate}=stats(sample,policy);
      return {period,n,payoff,winRate};
    });
    if(metrics.every((v,i)=>v.n>=5&&v.payoff!=null&&(i===0||v.winRate<metrics[i-1].winRate&&v.payoff<metrics[i-1].payoff))){
      alerts.push({id:'factor-decline/'+periods[2]+'/'+factor,factor,periods:metrics,message:factor+'近三个完整月的胜率、盈亏比均逐月下降'});
    }
  }
  return alerts.sort((a,b)=>b.periods[2].n-a.periods[2].n||a.factor.localeCompare(b.factor));
}
export function attributionCloud(rows){
  const maps={profit:new Map(),loss:new Map()};
  for(const r of rows){
    if(!Number.isFinite(+r.pnl)||+r.pnl===0)continue;
    const map=maps[r.pnl>0?'profit':'loss'];
    const tags=[r.attribution,r.labels?.reviewReason,r.pnl>0?r.profitReason:r.lossReason,r.attributionTags].flat()
      .filter(s=>typeof s==='string').flatMap(s=>s.split(/[,，、；;|/\n]+/)).map(s=>s.trim()).filter(s=>s&&s.length<=40&&!['待人工复核','未记录','未判定'].includes(s));
    for(const term of new Set(tags))map.set(term,(map.get(term)||0)+1);
  }
  return Object.fromEntries(Object.entries(maps).map(([k,m])=>[k,[...m].map(([term,count])=>({term,count})).sort((a,b)=>b.count-a.count||a.term.localeCompare(b.term))]));
}
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const value=(n,unit='')=>n==null?'—':esc(n)+unit;
export function renderLearningSnapshot(snapshot,{compact=true}={}){
  if(!snapshot?.totals?.n)return '';
  const cap=compact?3:30,detail=(rows,kind,label)=>'<h4>'+label+'</h4>'+(rows.length?'<div class="table-wrap"><table><thead><tr><th>'+label+'</th><th>环境</th><th>样本</th><th>胜率</th><th>盈亏比</th></tr></thead><tbody>'+
    rows.slice(0,cap).map(row=>'<tr><td>'+esc(row[kind])+'</td><td>'+esc(row.trend)+'</td><td>'+value(row.n)+'</td><td>'+value(row.winRate,'%')+'</td><td>'+value(row.payoff)+'</td></tr>').join('')+'</tbody></table></div>':'<p>尚无带环境标注的样本。</p>');
  const terms=(list,title)=>'<div><strong>'+title+'</strong> '+(list.length?list.slice(0,cap).map((x,i)=>'<span class="tag" style="font-size:'+Math.max(12,17-i)+'px">'+esc(x.term)+' × '+value(x.count)+'</span>').join(' '):'暂无归因标注')+'</div>';
  const warnings=snapshot.alerts.slice(0,cap).map(a=>'<li>'+esc(a.factor)+' · '+a.periods.map(p=>esc(p.period)+' '+value(p.winRate,'%')+' / '+value(p.payoff)+'（'+value(p.n)+'笔）').join(' → ')+'</li>').join('');
  return '<section class="panel learn-panel"><h3>因子与战法绩效</h3><p>截至 '+esc(snapshot.asOf.replace('T',' '))+' · '+value(snapshot.totals.n)+' 个成熟样本 · '+(snapshot.decay.decayEnabled?'时间衰减 '+value(snapshot.decay.decayHalfLifeDays)+' 天':'等权统计')+'</p>'+
    detail(snapshot.factorByTrend,'factor','因子')+detail(snapshot.strategyByTrend,'strategy','战法')+
    '<h4>因子失效预警</h4>'+(warnings?'<ul>'+warnings+'</ul>':'<p>暂无符合条件的因子。</p>')+
    '<p>比较最近三个完整自然月，每月需至少五笔并有盈亏两侧。预警要求胜率、盈亏比逐月同时下降。</p><h4>盈亏归因词云</h4>'+
    terms(snapshot.attribution.profit,'盈利')+terms(snapshot.attribution.loss,'亏损')+'</section>';
}
