// Extra discretionary-pattern evidence. Every emitted condition records the
// original measurements and the explicit operational definition used.
const finite = Number.isFinite;
const known = x => x != null && x !== '' && x !== '缺失';
const avg = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const change = (a,b) => finite(a)&&finite(b)&&b>0 ? (a/b-1)*100 : null;
const fmt = n => finite(n) ? Number(n.toFixed(2)) : '缺失';
const dateOf = x => String(x||'').slice(0,10);
const maxOf = xs => xs.length ? Math.max(...xs) : null;
const catalogKeys = new WeakMap();
function factorKeys(catalog){
  if(!catalogKeys.has(catalog))catalogKeys.set(catalog,new Set(catalog.flatMap(c=>c.factors.map((_,i)=>c.id+':'+i))));
  return catalogKeys.get(catalog);
}

function time(value,close=false) {
  if(Number.isSafeInteger(value) && value>0)return value;
  if(typeof value!=='string')return null;
  const s=value.replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return close?Date.parse(s+'T15:00:00+08:00'):null;
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(s))return Date.parse(s+'+08:00');
  if(/(?:Z|[+-]\d{2}:\d{2})$/.test(s))return Date.parse(s);
  return null;
}
function visible(row,cutoff) {
  if(!row || !finite(cutoff))return false;
  const inputs=[row.availableAt,row.knownAt].filter(known);
  if(!inputs.length)return finite(time(row.date,true))&&time(row.date,true)<=cutoff;
  return inputs.every(x=>finite(time(x,true))&&time(x,true)<=cutoff);
}
function previousWeekday(date) {
  const t=Date.parse(date+'T00:00:00Z');
  if(!finite(t))return '';
  const d=new Date(t);
  do {d.setUTCDate(d.getUTCDate()-1);}while([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
function priorDay(rows,day) {
  const prior=rows.filter(r=>r.date<day.date).at(-1);
  const expected=day.previousDay||previousWeekday(day.date);
  return prior?.date===expected?prior:null;
}
function uniqueTheme(m,name) {
  const rows=(Array.isArray(m?.themes)?m.themes:[]).filter(t=>t && typeof t==='object' && t.name===name);
  return rows.length===1?rows[0]:null;
}
function members(g) {
  if(!g || !Array.isArray(g.members) || g.members.length!==g.count ||
     !g.members.every(r=>/^\d{6}$/.test(r.code)) || new Set(g.members.map(r=>r.code)).size!==g.count)return null;
  return g.members;
}
function identity(rows,ref) {
  if(!ref||!rows)return null;
  const hits=rows.filter(r=>r.code===ref||r.name===ref);
  return hits.length===1?hits[0]:null;
}
function marketPatterns({b,f,market,sector,marketSeries,stage,cutoff},set) {
  const day=dateOf(b.date);
  const days=(marketSeries||[]).filter(r=>r && r.date<=day && visible(r,cutoff)).sort((a,b)=>a.date.localeCompare(b.date));
  const prev=priorDay(days,{...market,date:day}),old=prev&&priorDay(days,prev);
  const cycle=[old,prev,market];
  if(['冰点','发酵','高潮','分歧','退潮'].includes(stage) && cycle.every(m=>known(m?.theme)&&m.themeType==='主线'&&finite(m.indexChange)&&known(m.trend))){
    const cumulative=100*(cycle.reduce((v,m)=>v*(1+m.indexChange/100),1)-1);
    const rotated=new Set(cycle.map(m=>m.theme)).size;
    set('26:3',true,stage==='分歧'&&rotated===3&&cycle.every(m=>m.trend==='震荡')&&Math.abs(cumulative)<=1.5,
      '已判定阶段 '+stage+'；三个连续交易日主线 '+cycle.map(m=>m.theme).join(' / ')+'，全A趋势 '+cycle.map(m=>m.trend).join(' / ')+'、累计涨跌 '+fmt(cumulative)+'%（仅判横盘轮动特征）');
  }
  const g=uniqueTheme(market,b.sector), p=uniqueTheme(prev,b.sector), q=uniqueTheme(old,b.sector);
  const rows=members(g), prevRows=members(p), chair=identity(rows,g?.leader), priorChair=identity(prevRows,p?.leader);
  const main=g?.type==='主线',core=chair?.code===b.code;
  const top=rows?.every(r=>Number.isInteger(r.level)&&r.level>0)?maxOf(rows.map(r=>r.level)):null;
  const member=rows?.find(r=>r.code===b.code);
  const priorPhase=prev?.stage??prev?.emotion?.stage;
  const recent=[old,prev,market];
  const item=g?.name||b.sector||'板块';
  set('17:0 23:1',main&&finite(top),top>=3,item+' 最高 '+top+' 板，空间门槛为三板');
  set('17:1',g&&known(f.position)&&chair,main&&!core&&f.position==='低位',item+' 龙头 '+chair?.code+'，标的位置 '+f.position);
  set('17:3',typeof g?.ladderComplete==='boolean',g?.ladderComplete,item+' 全部封板股梯队 '+(g?.ladder||''));
  set('23:0',g&&typeof g.ladderComplete==='boolean',main&&g?.ladderComplete,item+' '+g?.type+'，梯队 '+g?.ladder);
  set('23:3',member&&finite(top)&&finite(member.level),top-member?.level>=2,'最高 '+top+' 板，个股 '+member?.level+' 板，至少两板高度差');
  set('23:5',chair&&member&&!core&&finite(top)&&finite(member.level),member?.level<top,'标的 '+b.code+' 与龙头 '+chair?.code+' 层级 '+member?.level+' / '+top);
  set('17:4',chair&&priorChair&&finite(chair.level)&&finite(priorChair.level),
    chair?.code===priorChair?.code&&chair?.level===priorChair?.level+1,'前交易日龙头 '+priorChair?.code+' '+priorChair?.level+'板，当日 '+chair?.code+' '+chair?.level+'板');
  if(prevRows&&rows){
    const before=new Set(prevRows.map(r=>r.code)),first=rows.filter(r=>r.level===1&&!before.has(r.code)&&r.code!==b.code);
    set('12:3',rows.every(r=>Number.isInteger(r.level)),first.length>0,item+' 新增同题材首板助攻 '+first.map(r=>r.code).join('、'));
  }
  const first=rows?.filter(r=>r.level===1);
  set('18:2',Array.isArray(market.themes)&&market.themes.length&&market.themes.every(t=>members(t)?.every(r=>Number.isInteger(r.level))),
    market.themes?.some(t=>t.members?.some(r=>r.level===1)),'当日已归类完整封板池的首板数，逐代码去重 '+new Set((market.themes||[]).flatMap(t=>(t.members||[]).filter(r=>r.level===1).map(r=>r.code))).size);
  set('8:3',first&&first.every(r=>known(r.code))&&member?.level===1 && known(b.firstSealTime) &&
    rows.filter(r=>r.code!==b.code).every(r=>/^\d{6}$/.test(r.firstSealTime)),rows?.some(r=>r.code!==b.code&&r.firstSealTime<b.firstSealTime),
    item+' 标的首封 '+b.firstSealTime+'，比较同题材首封时刻');
  set('18:1 39:1',finite(prev?.downLimit)&&finite(market.downLimit),market.downLimit<prev?.downLimit,
    '连续交易日跌停数量 '+prev?.downLimit+' → '+market.downLimit);
  set('39:2',finite(prev?.breakRate)&&finite(market.breakRate),market.breakRate<prev?.breakRate,
    '连续交易日炸板率 '+fmt(prev?.breakRate)+'% → '+fmt(market.breakRate)+'%');
  set('39:0',recent.every(m=>finite(m?.premium)&&finite(m?.leader)),recent.every(m=>m?.premium<0 && m?.leader<0),
    '连续三日昨日封板溢价 '+recent.map(m=>fmt(m?.premium)).join(' / ')+'%，高标反馈 '+recent.map(m=>fmt(m?.leader)).join(' / ')+'%');
  set('39:3',finite(market.firstBoardPremium)&&finite(prev?.firstBoardPremium),
    market.firstBoardPremium>0 && market.firstBoardPremium>prev?.firstBoardPremium,
    '昨日首板全样本收盘溢价 '+fmt(prev?.firstBoardPremium)+'% → '+fmt(market.firstBoardPremium)+'%');
  set('29:0',known(priorPhase)&&priorPhase!=='未判定'&&finite(prev?.breakRate),priorPhase==='分歧'&&finite(prev?.breakRate)&&prev.breakRate>=35,
    '前交易日情绪 '+priorPhase+'，炸板率 '+fmt(prev?.breakRate)+'%（大分歧门槛35%）');
  set('12:0',p&&q&&finite(p.count)&&finite(q.count),p?.count<q?.count,
    item+' 最近两次连续交易日封板家数 '+q?.count+' → '+p?.count);
  const sectorUp=finite(sector.change)&&sector.change>0,prevChange=p?.change??prev?.themeChanges?.[b.sector];
  set('10:3 29:4 34:3',finite(prevChange)&&finite(sector.change)&&finite(p?.count)&&finite(g?.count),
    prevChange<0&&sectorUp&&g?.count>p?.count,item+' 板块指数 '+fmt(prevChange)+'% → '+fmt(sector.change)+'%，封板 '+p?.count+' → '+g?.count);
  set('25:1',finite(sector.change)&&rows,sector.change>=2 && g?.count>=2,item+' 板块指数涨幅 '+fmt(sector.change)+'%，封板 '+g?.count+' 只');
  set('2:3',finite(sector.change)&&finite(sector.loss5Pct)&&finite(sector.coverage)&&sector.coverage===1,
    sector.change>=-1 && sector.loss5Pct<=10,item+' 全成员覆盖，跌幅超过5%的成员占 '+fmt(sector.loss5Pct)+'%，板块涨跌 '+fmt(sector.change)+'%');
  const prevMain=uniqueTheme(prev,prev?.theme),oldLeader=identity(members(prevMain),prevMain?.leader);
  const fullToday=Array.isArray(market.themes) && market.themes.length>0 && market.themes.every(t=>members(t));
  const currentCodes=fullToday?new Set(market.themes.flatMap(t=>t.members.map(r=>r.code))):null;
  set('35:0',oldLeader&&prevMain.type==='主线'&&currentCodes&&market.upLimit===currentCodes.size,
    !currentCodes?.has(oldLeader?.code),'前交易日主线龙头 '+oldLeader?.code+' 对照今日完整封板池');
  const hasOldGroups=Array.isArray(prev?.themes)&&prev.themes.length&&prev.themes.every(t=>members(t));
  set('35:2',hasOldGroups&&first&&rows.every(r=>Number.isInteger(r.level)),!p&&first?.length>=2,
    '前交易日题材榜'+(p?'包含':'未见')+item+'，当日首板 '+(first?.length??'缺失')+' 只');
  const oldNow=uniqueTheme(market,prevMain?.name);
  set('35:3',prevMain?.type==='主线' && oldNow && finite(oldNow.change),oldNow?.count<prevMain?.count&&oldNow?.change<0,
    prevMain?.name+' 上日封板 '+prevMain?.count+'，当日 '+oldNow?.count+'，指数涨跌 '+fmt(oldNow?.change)+'%');
  set('35:1 31:2',main && prevMain && prevMain.name!==item && finite(g?.netInflow)&&finite(oldNow?.netInflow) &&
    known(g?.flowSource)&&g?.flowSource===oldNow?.flowSource,g?.netInflow>0&&oldNow?.netInflow<0,
    '同源板块净额（元） '+item+' '+fmt(g?.netInflow)+'，'+prevMain?.name+' '+fmt(oldNow?.netInflow));
  const earlierMain=uniqueTheme(old,old?.theme);
  const previousOld=uniqueTheme(prev,earlierMain?.name);
  set('31:0',earlierMain?.type==='主线'&&finite(previousOld?.change)&&finite(previousOld?.count),
    previousOld?.change<0 && previousOld?.count<earlierMain?.count,
    '前一交易日 '+earlierMain?.name+' 板块指数 '+fmt(previousOld?.change)+'%，封板 '+earlierMain?.count+' → '+previousOld?.count);
  if(currentCodes && market.upLimit===currentCodes.size){
    const allMembers=[...new Map(market.themes.flatMap(t=>t.members.map(r=>[r.code,r]))).values()];
    const complete=allMembers.length>0&&allMembers.every(r=>Number.isInteger(r.level)&&r.level>=1);
    if(complete && finite(market.height)){
      const leaders=allMembers.filter(r=>r.level===market.height),unique=market.height>=4&&leaders.length===1;
      set('26:0',true,unique,'当日完整封板池最高 '+market.height+' 板，同高度 '+leaders.length+' 只（稀缺门槛四板）');
      if(unique && leaders[0].code===b.code&&allMembers.every(r=>finite(r.sealedFundsCny)&&r.sealedFundsCny>=0)){
        const sum=allMembers.reduce((x,r)=>x+r.sealedFundsCny,0),share=sum>0?100*leaders[0].sealedFundsCny/sum:null;
        set('26:2',finite(share),share>=25,'唯一高标收盘封单占全池 '+fmt(share)+'%（25%门槛）');
      }
    }
  }
  if(main && g && finite(g.change)){
    const other=(market.themes||[]).filter(t=>t.name!==item);
    set('26:1',other.length>=2&&other.every(t=>finite(t.change)&&finite(uniqueTheme(prev,t.name)?.count)),
      other.every(t=>t.change<=0 && t.count<=uniqueTheme(prev,t.name)?.count),
      '除主线外 '+other.length+' 个同期板块指数均与零比较，封板数与上一交易日比较');
  }
  if(rows && prevRows){
    const previousCodes=new Set(prevRows.map(r=>r.code));
    const lowStarters=rows.filter(r=>r.level===1&&!previousCodes.has(r.code)&&r.position==='低位');
    set('43:1',rows.every(r=>r.level!==1||known(r.position)),lowStarters.length>=2,
      item+' 至少两只新进低位首板，已确认 '+lowStarters.map(r=>r.code).join('、'));
    const lastHigh=identity(prevRows,p?.leader);
    const highQuote=(sector.memberQuotes||[]).find(r=>r.code===lastHigh?.code&&dateOf(r.date)===day&&visible(r,cutoff));
    set('43:0',finite(lastHigh?.level)&&lastHigh.level>=3&&finite(highQuote?.change)&&finite(highQuote?.volumeRatio),
      highQuote?.change<=1&&highQuote?.volumeRatio>=1.3,'前日高标 '+lastHigh?.code+' 当前涨跌 '+fmt(highQuote?.change)+'%，量比 '+fmt(highQuote?.volumeRatio));
    set('43:2',finite(highQuote?.netInflow)&&lowStarters.length>=2&&lowStarters.every(r=>finite(r.netInflow)&&known(r.flowSource)&&r.flowSource===highQuote?.flowSource),
      highQuote?.netInflow<0&&lowStarters.every(r=>r.netInflow>0),'同源资金净额：高标 '+fmt(highQuote?.netInflow)+' 元，低位新板 '+lowStarters.map(r=>fmt(r.netInflow)).join(' / ')+' 元');
  }
  set('27:4',chair&&rows?.length>=2,core,
    '研究标的 '+b.code+' 与该题材独立识别的龙头 '+chair?.code+' 核对');
  if(g&&p&&known(f.position)&&Array.isArray(prev?.themes)&&prev.themes.length>=3&&
      prev.themes.every(t=>finite(t.amount)&&t.amount>=0)){
    const levels=prev.themes.map(t=>t.amount).sort((a,b)=>a-b),median=levels[Math.floor(levels.length/2)];
    set('31:1',true,f.position==='低位'&&p.count<=1&&p.amount<median,
      item+' 上日封板 '+p.count+' 只、板内封板成交额 '+fmt(p.amount)+' 元，对比题材中位 '+fmt(median)+' 元，标的位置 '+f.position);
  }
  // Overlapping constituents alone do not establish a parent/sub-theme relationship.
  const sub=uniqueTheme(market,b.branchTheme||b.sector),parent=uniqueTheme(market,sub?.parentTheme);
  if(sub && parent && parent!==sub && known(sub.classificationSource) && members(sub)?.some(r=>r.code===b.code)){
    set('50:0',true,parent.type==='主线','提供方 '+sub.classificationSource+' 的题材层级 '+parent.name+' / '+sub.name);
    const subLeader=identity(members(sub),sub.leader),parentLeader=identity(members(parent),parent.leader);
    set('50:3',subLeader&&parentLeader,subLeader?.code===b.code&&subLeader?.code!==parentLeader?.code,
      '分支龙头 '+subLeader?.code+'，主线龙头 '+parentLeader?.code);
    set('50:2',subLeader?.code===b.code&&finite(sub.change)&&finite(parent.change),
      sub.change>0&&sub.change-parent.change>=2,'分支 '+fmt(sub.change)+'%，主线 '+fmt(parent.change)+'%，领先门槛2个百分点');
    const events=(b.sectorAnnouncements||[]).filter(n=>n.sector===sub.name&&n.type==='独立催化'&&known(n.eventId)&&known(n.source)&&time(n.publishedAt)>0&&
      time(n.knownAt??n.receivedAt)>=time(n.publishedAt)&&time(n.knownAt??n.receivedAt)<=cutoff&&new Date(time(n.publishedAt)+8*36e5).toISOString().slice(0,10)===day);
    if(events.length)set('50:1',true,true,sub.name+' 来源明确的分支催化 '+events[0].eventId+' · '+events[0].source);
  }
  if(rows && rows.every(r=>finite(r.change)) && chair && core && rows.length>=3){
    const following=rows.filter(r=>r.code!==chair.code);
    const avgFollower=avg(following.map(r=>r.change));
    set('27:0 27:2',true,chair.change>0 && avgFollower<0,item+' 龙头涨幅 '+fmt(chair.change)+'%，其余同期成员平均 '+fmt(avgFollower)+'%');
    set('27:1',finite(sector.change),chair.change>=3&&chair.change-sector.change>=3,
      '龙头涨幅 '+fmt(chair.change)+'%，板块 '+fmt(sector.change)+'%，领先门槛3个百分点');
  }
  if(Array.isArray(market.themes)&&market.themes.every(t=>members(t))){
    const themes=market.themes.filter(t=>t.type==='主线'&&t.members.some(r=>r.code===b.code));
    set('38:0',market.themes.length>0,themes.length>=2,'完整主线归属 '+themes.map(t=>t.name).join('、'));
    set('38:1',themes.length>=2&&themes.every(t=>finite(t.change)),themes.every(t=>t.change>0),
      '重叠主线的同期板块涨幅 '+themes.map(t=>t.name+' '+fmt(t.change)+'%').join('、'));
    set('38:2',themes.length>=2&&themes.every(t=>known(t.leader)),themes.some(t=>identity(t.members,t.leader)?.code===b.code),
      '重叠主线龙头 '+themes.map(t=>t.name+' '+t.leader).join('、'));
    set('38:3',themes.length>=2&&themes.every(t=>finite(t.netInflow)&&known(t.flowSource)&&t.flowSource===themes[0].flowSource),themes.every(t=>t.netInflow>0),
      '重叠主线的同源净额（元） '+themes.map(t=>fmt(t.netInflow)).join(' / '));
  }
}

function sameMinute(a,b){
  const before=time(a.date),after=time(b.date);
  return finite(before)&&finite(after)&&after-before===60000;
}
function minuteRows(series,b,cutoff,role='stock'){
  const day=dateOf(b.date);
  const rows=series.filter(r=>dateOf(r?.date)===day && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(r.date) &&
    (r.role||'stock')===role && (role==='stock'?r.code===b.code:role==='sector'?(r.sector||r.code)===b.sector:true) &&
    time(r.date)<=Math.min(time(b.date,true),cutoff) && visible(r,cutoff) &&
    [r.open,r.high,r.low,r.close].every(v=>finite(v)&&v>0)&&r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close));
  const partitions=new Map();
  for(const row of rows){
    const k=row.period||'1m';
    if(!partitions.has(k))partitions.set(k,[]);
    partitions.get(k).push(row);
  }
  const selected=[...partitions.values()].sort((a,b)=>b.length-a.length)[0]||[];
  selected.sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(selected.map(r=>r.date)).size!==selected.length)return [];
  return selected;
}
function intraPatterns(b,history,f,sector,intraday,cutoff,set) {
  if(!Array.isArray(intraday)||!intraday.length)return;
  const seq=minuteRows(intraday,b,cutoff);
  if(!seq.length)return;
  const secs=minuteRows(intraday,b,cutoff,'sector'),sBy=new Map(secs.map(r=>[r.date,r]));
  const last=seq.at(-1),span=last.date.slice(11),daily=b.date.length===10;
  if(daily ? span!=='15:00' : last.date!==b.date)return;
  let tail=[last];
  for(let i=seq.length-2;i>=0&&tail.length<30;i--){
    if(!sameMinute(seq[i],seq[i+1]))break;
    tail.unshift(seq[i]);
  }
  const recovery=(block)=>{
    if(block.length<8)return null;
    const index=block.reduce((lowest,row,i)=>row.low<block[lowest].low?i:lowest,0);
    if(index===0||index>=block.length-2)return null;
    const open=block[0].open,low=block[index].low,close=block.at(-1).close;
    return {low,fall:change(low,open),rise:change(close,low),position:(close-low)/(open-low||1)};
  };
  const pull=recovery(tail);
  set('5:1 24:3',pull&&tail.length>=15,pull?.fall<=-1&&pull?.rise>=1&&pull?.position>=.65,
    '连续 '+tail.length+' 分钟先回落 '+fmt(pull?.fall)+'%，低点后反弹 '+fmt(pull?.rise)+'%，收回跌幅 '+fmt(pull?.position*100)+'%');
  const core=f.sectorLeader===b.code||f.sectorLeader===b.name;
  set('16:1',pull&&known(f.sectorLeader)&&tail.length>=15,core&&pull?.fall<=-2&&pull?.position>=.75,
    '板块龙头 '+f.sectorLeader+'，近期低点后收回跌幅 '+fmt(pull?.position*100)+'%');
  const split=Math.floor(tail.length/2),r1=recovery(tail.slice(0,split)),r2=recovery(tail.slice(split));
  set('34:1',r1&&r2,r1?.fall<=-.5&&r1?.rise>=.5&&r2?.fall<=-.5&&r2?.rise>=.5,'连续两段回落后反弹 '+fmt(r1?.rise)+'% / '+fmt(r2?.rise)+'%');
  if(tail.length>=8 && tail.every(r=>finite(r.volume)&&r.volume>=0)){
    const base=avg(tail.slice(-8,-3).map(r=>r.volume));
    const latest=tail.slice(-3),ratio=base>0?avg(latest.map(r=>r.volume))/base:null;
    const gain=change(last.close,latest[0].open);
    set('7:0',finite(ratio),ratio>=1.5&&gain>=1,'连续三分钟上涨 '+fmt(gain)+'%，均量较前五分钟 '+fmt(ratio)+' 倍');
  }
  if(tail.length>=15){
    const basis=tail[0],a=sBy.get(basis.date),z=sBy.get(last.date);
    const stock=change(last.close,basis.open),sectorMove=z&&a?change(z.close,a.open):null;
    set('2:4 44:2',finite(sectorMove),sectorMove<=-1&&stock>=-.25 && stock-sectorMove>=1,
      basis.date+' 至 '+last.date+'，个股 '+fmt(stock)+'%，板块 '+fmt(sectorMove)+'%');
    set('24:1',finite(sectorMove)&&finite(b.indexChange??sector.indexChange),sectorMove<=-1 && stock<=-1 && (b.indexChange??sector.indexChange)<=-2,
      '同期指数 '+fmt(b.indexChange??sector.indexChange)+'%，板块 '+fmt(sectorMove)+'%，个股 '+fmt(stock)+'%（同步下跌观测）');
  }
  if(tail.length>=15 && secs.length>=15 && f.sectorLeader && [b.code,b.name].includes(f.sectorLeader)){
    const peer=tail.map(r=>sBy.get(r.date));
    if(peer.every(Boolean)){
      const stockLow=tail.reduce((at,r,i)=>r.low<tail[at].low?i:at,0),groupLow=peer.reduce((at,r,i)=>r.low<peer[at].low?i:at,0);
      const rebound=change(last.close,tail[stockLow].low);
      set('12:2',true,stockLow>=1&&stockLow<groupLow&&groupLow<tail.length-1&&rebound>=1,
        '板块龙头 '+b.code+' 区间低点 '+tail[stockLow].date+'，板块低点 '+peer[groupLow].date+'，个股低点反弹 '+fmt(rebound)+'%');
    }
  }
  if(secs.length>=8){
    const block=secs.slice(-8),base=avg(block.slice(0,5).map(r=>r.volume)),v=avg(block.slice(-3).map(r=>r.volume));
    const rise=change(block.at(-1).close,block.at(-3).open),volumeRatio=base>0?v/base:null;
    const buy=b.sectorActiveBuyPct??sector.activeBuyPct;
    if(block.every((r,i)=>finite(r.volume)&&r.volume>0&&(!i||sameMinute(block[i-1],r))) &&
       block.at(-1).date===last.date && finite(buy) && Math.abs(buy)<=100){
      set('12:1',finite(volumeRatio)&&finite(rise),buy>0&&buy<=10&&volumeRatio>=1.3&&rise>=.5&&rise<=2.5,
        '板块尾三分钟相较前五分钟均量 '+fmt(volumeRatio)+' 倍，上涨 '+fmt(rise)+'%，截至判定时板块主动净买占成交 '+fmt(buy)+'%');
    }
  }
  const minuteLimit=(rows,lim)=>{
    if(!finite(lim)||lim<=0)return null;
    let sealed=false,opened=false;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(i && !sameMinute(rows[i-1],r)){sealed=false;opened=false;}
      if(sealed && r.close<lim)opened=true;
      if(opened && r.close===lim)return r.date;
      if(r.close===lim)sealed=true;
    }
    return null;
  };
  const returned=minuteLimit(seq,b.limitUp);
  set('47:1',returned&&finite(b.netActiveBuy),b.netActiveBuy>0,'按分钟收盘先封、开板再回封于 '+returned+'，主动买卖净额 '+fmt(b.netActiveBuy)+' 元');
  if(secs.length>=8){
    const block=secs.slice(-15);
    if(block.every((r,i)=>!i||sameMinute(block[i-1],r))){
      const worst=change(Math.min(...block.map(r=>r.low)),block[0].open);
      set('47:0',finite(worst),worst<=-1.5,'板块连续 '+block.length+' 分钟相对起点最大下探 '+fmt(worst)+'%');
    }
  }
  if(returned&&known(b.sector)){
    const at=time(returned),codes=new Set(intraday.filter(r=>r.role!=='sector'&&r.role!=='index'&&r.sector===b.sector&&r.code!==b.code).map(r=>r.code));
    const peers=[];
    for(const code of codes){
      const series=minuteRows(intraday,{...b,code},cutoff);
      const lim=series.at(-1)?.limitUp;
      const when=time(minuteLimit(series,lim));
      if(finite(when)&&Math.abs(when-at)<=3*60000)peers.push(code);
    }
    if(peers.length)set('47:2',true,true,'本股 '+returned+' 回封，三分钟内同题材回封 '+peers.join('、'));
  }
  if(daily && span==='15:00'){
    const p=history.at(-1)?.close,sessions=[['09:31','11:30'],['13:01','15:00']];
    const complete=sessions.every(([from,to])=>{
      const part=seq.filter(r=>r.date.slice(11)>=from&&r.date.slice(11)<=to);
      return part.length===120&&part.every((r,i)=>!i||sameMinute(part[i-1],r));
    });
    if(complete && finite(p)&&p>0){
      const changes=seq.map(r=>change(r.close,p)),positive=changes.filter(n=>n>=0).length/changes.length;
      set('9:0',true,positive>=.9&&change(last.close,p)>=1&&Math.min(...changes)>=-1,
        '两段完整分钟线：位于昨收以上 '+fmt(positive*100)+'%，盘中最低收盘涨幅 '+fmt(Math.min(...changes))+'%，日末 '+fmt(changes.at(-1))+'%');
    }
  }
}

function pricePatterns(b,history,f,market,set){
  const before=history.slice(-20);
  if(before.length===20 && before.every(x=>finite(x.high)&&finite(x.low)&&x.high>=x.low&&x.low>0) && finite(b.low)&&finite(b.high)&&finite(b.close)){
    const hi=Math.max(...before.map(x=>x.high)),lo=Math.min(...before.map(x=>x.low)),width=hi-lo;
    const box=width>0&&hi/lo<=1.12;
    if(box){
      const touches=before.concat(b);
      const floorTest=touches.find(r=>r.low<=lo+.15*width && r.low>=lo*.985 && r.close>=lo+.3*width);
      const ceilingTest=before.find(r=>r.high>=hi-.15*width && r.close<=hi-.3*width);
      set('28:1',true,!!floorTest,'前20根箱底 '+fmt(lo)+'，箱顶 '+fmt(hi)+'；下沿企稳观测 '+(floorTest?.date||'未出现'));
      set('28:2',true,!!ceilingTest,'箱体上沿 '+fmt(hi)+'，区间内触及上沿后回落观测 '+(ceilingTest?.date||'未出现'));
      set('28:3',finite(f.ratio),b.close>hi&&f.ratio>=1.3,'箱顶 '+fmt(hi)+'，收盘 '+fmt(b.close)+'，相对五根均量 '+fmt(f.ratio)+' 倍');
    }
  }
  if(before.length===20&&before.every(x=>finite(x.chipPeak)&&x.chipPeak>0&&finite(x.chipPeakShare))){
    const peaks=before.map(x=>x.chipPeak),concentration=avg(before.map(x=>x.chipPeakShare));
    set('21:0',true,Math.max(...peaks)/Math.min(...peaks)<=1.05&&concentration>=50,
      '连续20日筹码峰价差 '+fmt(change(Math.max(...peaks),Math.min(...peaks)))+'%，峰区筹码平均占比 '+fmt(concentration)+'%');
  }
  const prev=history.at(-1);
  set('19:2',finite(prev?.breakCount)&&finite(b.breakCount)&&finite(prev?.streak)&&finite(b.streak)&&finite(b.sealRatio),
    prev?.breakCount>=1 && b.breakCount===0 && b.streak===prev?.streak+1 && b.sealRatio>=3,
    '连续板开板次数 '+prev?.breakCount+' → '+b.breakCount+'，当日封单占成交额 '+fmt(b.sealRatio)+'%');
  set('16:2',finite(b.netActiveBuy),b.netActiveBuy>0,'按来源记录的主动买卖净额 '+fmt(b.netActiveBuy)+' 元');
  set('8:4',finite(b.lockedRatio)&&before.length===20&&before.every(x=>finite(x.high)),
    b.lockedRatio<=10&&b.close>=Math.max(...before.map(x=>x.high)),
    '突破前20根最高价，上方套牢盘 '+fmt(b.lockedRatio)+'%（不超过10%）');
  set('21:4',finite(b.activeSellPct)&&finite(b.lockedRatio)&&b.activeSellPct>=0&&b.activeSellPct<=100,
    b.activeSellPct<=40&&b.lockedRatio<=15,'供应商主动卖出成交占比 '+fmt(b.activeSellPct)+'%，上方套牢盘 '+fmt(b.lockedRatio)+'%');
  const frozen=b.frozenPlan;
  if(frozen && frozen.code===b.code && finite(frozen.entryPrice)&&finite(frozen.stopPrice)&&finite(frozen.targetPrice)&&
      frozen.entryPrice>frozen.stopPrice&&frozen.targetPrice>frozen.entryPrice){
    set('10:0',time(frozen.frozenAt)<time(dateOf(b.date)+' 09:25')&&finite(frozen.expectedAuctionGap)&&finite(b.auctionGap),
      b.auctionGap<frozen.expectedAuctionGap,'冻结计划预期竞价 '+fmt(frozen.expectedAuctionGap)+'%，实际 '+fmt(b.auctionGap)+'%');
    const reward=(frozen.targetPrice-frozen.entryPrice)/(frozen.entryPrice-frozen.stopPrice);
    set('18:3',true,reward>=2,'冻结计划以入场 '+frozen.entryPrice+'、止损 '+frozen.stopPrice+'、止盈 '+frozen.targetPrice+' 测得风险收益比 '+fmt(reward));
    set('48:4',known(frozen.exitStyle),frozen.exitStyle==='反弹止盈','冻结离场规则 '+frozen.exitStyle);
  }
}

// Use positive, dated publication evidence only. No results or missing times
// cannot certify the absence of adverse disclosures or regulatory warnings.
function disclosureType(n) {
  const t=n.title.replace(/\s/g,'');
  if(/终止|否认|取消|澄清|撤回|撤销|未收到|未被|不存在|未实施|不涉及|不再|拟终止|未予|风险提示|更正|问询函回复|回复函|完成减持|减持.*(?:完成|届满|结束)/.test(t))return null;
  if(known(n.type))return n.type;
  // Source's native export supplies neutral titles. A generic earnings
  // forecast, board resolution or inquiry reply is insufficient evidence.
  if(/(?:被|收到|接到).*(?:立案告知书|立案调查通知书)|公司被.*立案调查/.test(t))return '立案调查';
  if(/(?:收到|接到).*(?:监管)?问询函/.test(t))return '问询函';
  if(/(?:股东|实际控制人|董事|监事|高级管理人员|董监高).{0,32}减持(?:股份)?计划(?:的)?(?:预披露)?公告/.test(t))return '减持计划';
  if(/(?:季度|半年度|年度|年度前三季度)业绩预增(?:的)?公告/.test(t))return '业绩预增';
  if(/(?:完成|签署).{0,15}资产注入|资产注入(?:协议(?:签署|生效)|实施完成)/.test(t))return '资产注入';
  if(/重大资产重组(?:实施完成|实施情况报告书|交割完成)/.test(t))return '重组';
  if(/(?:签订|签署|获得).{0,15}重大(?:经营合同|销售合同|订单)/.test(t))return '重大订单';
  return null;
}
function disclosurePatterns(b,cutoff,set){
  const publications=Array.isArray(b.announcements)?b.announcements:[];
  const day=dateOf(b.date);
  const items=publications.filter(n=>{
    const published=time(n?.publishedAt),received=time(n?.knownAt??n?.receivedAt);
    return (n?.code??n?.symbol)===b.code && known(n.source) && known(n.title) &&
      finite(published)&&finite(received)&&published<=received&&received<=cutoff &&
      new Date(published+8*36e5).toISOString().slice(0,10)===day;
  });
  const rules=[
    ['41:0 25:0 48:2',['业绩预增','重组','资产注入']],
    ['25:0 48:2',['重大订单','政策利好']],
    ['56:0',['减持计划','减持公告']],
    ['56:1',['问询函']],
    ['56:2',['立案调查']],
    ['56:3',['业绩暴雷']],
    ['49:0',['重点监控']],
    ['49:2',['监管公告']],
  ];
  for(const [keys,types] of rules){
    const hit=items.find(n=>types.includes(disclosureType(n)));
    if(hit)set(keys,true,true,'同日已收到的分类公告 '+hit.source+' · '+hit.title+' · 发布时间 '+hit.publishedAt+' · 观测 '+(hit.knownAt??hit.receivedAt)+(hit.verified===false&&!hit.source.includes('未独立核验')?' · 原文未独立核验':''));
  }
  // "板块持续有催化" requires dated events on more than one session,
  // independently tied to this sector; multiple articles about one event count once.
  const observations=(b.sectorAnnouncements||[]).filter(n=>{
    const p=time(n?.publishedAt),r=time(n?.knownAt??n?.receivedAt);
    return known(b.sector)&&n?.sector===b.sector&&known(n.source)&&known(n.eventId)&&
      ['政策利好','重大订单','产业利好'].includes(n.type)&&finite(p)&&finite(r)&&p<=r&&r<=cutoff&&
      cutoff-p<=7*86400000;
  });
  const events=new Map(observations.map(n=>[n.eventId,n]));
  const dates=new Set([...events.values()].map(n=>new Date(time(n.publishedAt)+8*36e5).toISOString().slice(0,10)));
  if(dates.has(day)&&dates.size>=2)set('33:3',true,true,b.sector+' 近7自然日有 '+events.size+' 个来源独立标识的催化事件，发布时间分布 '+[...dates].sort().join('、'));
}

function timelyEvent(row,cutoff,day) {
  const at=time(row?.publishedAt),knownAt=time(row?.knownAt);
  return known(row?.source)&&known(row?.reference)&&finite(at)&&finite(knownAt)&&
    at<=knownAt&&knownAt<=cutoff&&new Date(at+8*36e5).toISOString().slice(0,10)===day;
}
function verifiedPatterns(b,sector,market,cutoff,set){
  const day=dateOf(b.date),shock=b.sectorClarification;
  if(known(b.sector) && shock?.sector===b.sector && timelyEvent(shock,cutoff,day) && known(shock.claim) &&
     known(shock.finding) && known(shock.evidenceText)){
    const decline=b.sectorDrawdownPct??sector.drawdownPct,losers=b.sectorDeclinersPct??sector.declinersPct,
      recovered=b.sectorRecoveryPct??sector.recoveryPct;
    const eligible=finite(decline)&&decline<=0&&finite(losers)&&losers>=0&&losers<=100&&finite(recovered)&&recovered>=0;
    set('16:0',eligible,shock.finding==='负面消息核心事实不实'&&decline<=-3&&losers>=70&&recovered>=1,
      b.sector+' 当日板块下探 '+fmt(decline)+'%，下跌家数占比 '+fmt(losers)+'%，低点后反弹 '+fmt(recovered)+'%。'+
      shock.source+' 针对“'+shock.claim+'”的核实结论：'+shock.finding+'（'+shock.reference+'）');
  }
  const t=b.thesisEvidence;
  if(t?.code===b.code && timelyEvent(t,cutoff,day) && known(t.planId) && Array.isArray(t.conditions) && t.conditions.length>0 && t.conditions.length<=16){
    const frozen=time(t.frozenAt),checks=t.conditions;
    const compare={'>=':(v,x)=>v>=x,'>':(v,x)=>v>x,'<=':(v,x)=>v<=x,'<':(v,x)=>v<x,'=':(v,x)=>v===x};
    const eligible=finite(frozen)&&frozen<=time(day+' 09:15')&&
      checks.every(r=>known(r?.criterion)&&Object.hasOwn(compare,r.operator)&&finite(r.observed)&&finite(r.threshold)&&known(r.source)&&
        finite(time(r.observedAt))&&time(r.observedAt)>=frozen&&finite(time(r.knownAt))&&time(r.knownAt)>=time(r.observedAt)&&time(r.knownAt)<=time(t.knownAt));
    if(eligible)set('24:2',true,checks.every(r=>compare[r.operator](r.observed,r.threshold)),
      '冻结计划 '+t.planId+' 事前阈值复核：'+checks.map(r=>r.criterion+'='+fmt(r.observed)+'，要求 '+r.operator+fmt(r.threshold)+'，'+r.source).join('；')+'（'+t.reference+'）');
  }
  const c=b.classificationEvidence;
  if(c?.code===b.code && timelyEvent(c,cutoff,day) && known(c.parent)&&known(c.branch)&&c.parent!==c.branch&&c.parent===market.theme&&market.themeType==='主线'){
    set('50:0',true,true,c.source+' 对 '+b.code+' 的分类：'+c.parent+' / '+c.branch+'（'+c.reference+'）');
    set('50:3',/^\d{6}$/.test(c.branchLeader||'')&&/^\d{6}$/.test(c.parentLeader||''),c.branchLeader===b.code&&c.branchLeader!==c.parentLeader,
      '分类来源的分支龙头 '+c.branchLeader+'，主线龙头 '+c.parentLeader+'（'+c.reference+'）');
    set('50:2',c.branchLeader===b.code&&finite(c.branchChange)&&finite(c.parentChange),c.branchChange>0&&c.branchChange-c.parentChange>=2,
      '同日 '+c.branch+' '+fmt(c.branchChange)+'%，'+c.parent+' '+fmt(c.parentChange)+'%；领先门槛2个百分点（'+c.reference+'）');
    const catalyst=(b.sectorAnnouncements||[]).find(e=>e.sector===c.branch&&e.type==='独立催化'&&known(e.eventId)&&timelyEvent(e,cutoff,day));
    if(catalyst)set('50:1',true,true,'独立分支 '+c.branch+' 公告 '+catalyst.eventId+'，来源 '+catalyst.source+'（'+catalyst.reference+'）');
  }
}

// An optional CSV JSON column carries original, auditable source fields.
// Arbitrary strings are never interpreted as passed factors or executable code.
export function parsePatternColumns(row){
  const extra={};
  for(const k of ['activeSellPct','chipPeakShare','sectorActiveBuyPct','sectorDrawdownPct','sectorDeclinersPct','sectorRecoveryPct']){
    const raw=row[k];
    if(raw==null||raw==='')continue;
    if(!['number','string'].includes(typeof raw)||!String(raw).trim()||!Number.isFinite(Number(raw)))throw Error(k+' 数值无效');
    const v=Number(raw),min=['sectorDrawdownPct','sectorActiveBuyPct'].includes(k)?-100:0,max=k==='sectorDrawdownPct'?0:100;
    if(v<min||v>max)throw Error(k+' 百分比超出范围');
    extra[k]=v;
  }
  for(const k of ['thesisEvidence','sectorClarification','classificationEvidence','sectorAnnouncements','announcements']){
    const raw=row[k];if(raw==null||raw==='')continue;
    if(typeof raw!=='string'||raw.length>8192)throw Error(k+' 须为最多8192字符的 JSON');
    let v;try{v=JSON.parse(raw);}catch{throw Error(k+' 不是有效 JSON');}
    const array=k==='sectorAnnouncements'||k==='announcements';
    if(array ? !Array.isArray(v)||v.length>20||v.some(x=>!x||typeof x!=='object'||Array.isArray(x)) :
      !v||typeof v!=='object'||Array.isArray(v))throw Error(k+' 结构无效');
    extra[k]=v;
  }
  return extra;
}

export function addPatternEvidence({b,history=[],f={},market={},stage,sector={},catalog=[],intraday=[],marketSeries=[],asOf},facts){
  const cutoff=time(asOf??b?.decisionAt??b?.date,true);
  if(!b || !finite(cutoff) || !facts || !visible(b,cutoff))return facts;
  const allowed=factorKeys(catalog);
  function set(keys,available,pass,source){
    if(!available)return;
    for(const key of keys.split(' ')){
      if(!allowed.has(key)||facts.has(key))continue;
      facts.set(key,{pass:!!pass,source});
    }
  }
  const day=dateOf(b.date),hist=history.filter(r=>r?.code===b.code && r.date<b.date && visible(r,cutoff)).sort((a,b)=>a.date.localeCompare(b.date));
  const m=market?.date===day&&visible(market,cutoff)?market:{};
  const s=(!sector.date||dateOf(sector.date)===day&&visible(sector,cutoff))?sector:{};
  marketPatterns({b,f,market:m,sector:s,marketSeries,stage,cutoff},set);
  intraPatterns(b,hist,f,s,intraday,cutoff,set);
  // K-line windows and plan times are independently gated for each observation.
  const plan=b.frozenPlan,freeze=time(plan?.frozenAt);
  pricePatterns({...b,frozenPlan:finite(freeze)&&freeze<=cutoff?plan:null},hist,f,m,set);
  disclosurePatterns(b,cutoff,set);
  verifiedPatterns(b,s,m,cutoff,set);
  return facts;
}
