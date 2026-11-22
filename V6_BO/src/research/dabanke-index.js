'use strict';
const {parseHTML,classes,byClass,byId,tags,text,one,named,clean,dayOk,stamp,number,stockLink}=require('./dabanke-html');
const {marketDistribution}=require('./shortline-breadth-fallback');
const patterns=['一字板','T字板','烂板回封','尾盘板','地天板','反包板','大长腿','放量突破','缩量加速','天地板','炸板大面','高开低走'];
const origin='https://www.dabanke.com';
const dayUrl=day=>origin+'/index-'+day.replaceAll('-','')+'.html';
const unique=rows=>new Set(rows.map(x=>x.code)).size===rows.length;
const nStocks=s=>{const m=/^(\d+)只$/.exec(s.replaceAll(' ',''));return m?+m[1]:null;};
const numberPct=s=>/^[+-]?\d+(?:\.\d+)?%$/.test(s)?number(s):null;
function parseMarket(node,day,at,intraday){
  const meta=named(node,'home-market-meta'),state=byClass(node,'home-market-state');
  const quoteAt=stamp(day,/更新时间[：:]\s*(\d\d:\d\d)/.exec(meta)?.[1],at);
  if(!node||!meta.startsWith(day)||!quoteAt||(!intraday)!==text(state).includes('收盘'))return null;
  const cutoff=Date.parse(day+'T15:00:00+08:00');
  if(intraday?(quoteAt>=cutoff||at-quoteAt>15*60000):quoteAt<cutoff)return null;
  const indices=classes(node,'home-index-item').map(x=>({name:one(x,'span'),change:numberPct(one(x,'strong'))})).filter(r=>r.change!==null);
  const turnover=byClass(node,'home-turnover-total'),amountLabel=one(turnover,'span'),amountText=one(turnover,'strong');
  const comparisons=tags(byClass(node,'home-turnover-summary'),'div').map(x=>[one(x,'dt'),numberPct(one(x,'dd'))]).filter(([k,v])=>k&&v!==null);
  return indices.length?{quoteAt,indices,amount:amountLabel==='沪深北成交额'?number(amountText):null,amountText,amountLabel,comparisons,
    tone:clean(one(turnover,'small')),summary:clean(named(node,'home-market-overview-note'))}:null;
}
function parseEco(node,day){
  if(!node||!one(node,'header').includes(day)||!one(node,'header').includes('不含 ST'))return null;
  const metrics=[];
  for(const card of tags(node,'article')){
    const label=one(card,'span'),display=one(card,'strong'),note=clean(one(card,'small'));
    if(label==='最高板'&&/^\d+板$/.test(display)){metrics.push({label,display,note});continue;}
    const m=/^(\d+)\/(\d+)只$/.exec(display);
    if(!m||+m[1]>+m[2]||+m[2]>20000)continue;
    const ratio=/率\s*(\d+(?:\.\d+)?)%/.exec(note);
    if(ratio&&(!+m[2]||Math.abs(+ratio[1]-+m[1]*100/+m[2])>0.11))continue;
    metrics.push({label,display,note,success:+m[1],total:+m[2]});
  }
  return metrics.length?metrics:null;
}
function parseTiers(root,day){
  const result=[],seen=new Set();
  for(const tier of classes(byId(root,'home-ladder'),'ladder-view-tier')){
    const header=byClass(tier,'ladder-view-tier-heading'),name=one(header,'h3');
    const tally=/(?:晋级|封住)\s*(\d+)\s*\/\s*(\d+)\s*只/.exec(one(header,'p'));
    if(!/^(?:首板|\d+进\d+)$/.test(name)||!tally||+tally[1]>+tally[2])continue;
    const members=[];
    for(const node of classes(tier,'stock-line')){
      const code=stockLink(byClass(node,'stock-detail-link'),day),status=/\bstatus-(success|opened|failed|suspended)\b/.exec(node.attrs.class)?.[1];
      if(!code||!node.attrs['data-symbol']?.startsWith(code+'.')||!status)continue;
      const details=byClass(node,'ladder-stock-reason'),p=tags(details,'p')[0],reasonDay=/资料日期\s*·\s*(\d{4}-\d\d-\d\d)/.exec(one(p,'small'))?.[1];
      const reason=dayOk(reasonDay)&&reasonDay<=day?clean((p?.children||[]).filter(n=>typeof n==='string').join(' ')):'';
      const performance=byClass(node,'ladder-performance'),firstSeal=/首封\s*(\d\d:\d\d:\d\d)/.exec(performance?.attrs.title||'')?.[1];
      const outcome=status==='failed'&&text(performance)==='炸板'?'炸板':({success:'封住',opened:'炸板',failed:'未晋级',suspended:'停牌'})[status];
      members.push({code,name:named(node,'stock-name'),status:outcome,change:numberPct(named(node,'stock-change')),
        ...(performance?{performance:text(performance)}:{}),...(firstSeal?{firstSeal}:{}),...(reason?{reason,reasonDay}:{}),
        ...(/10日\d+板/.test(named(node,'ladder-history'))?{history:named(node,'ladder-history')}:{}),
        ...(named(node,'ladder-new-high')==='60日新高'?{newHigh:true}:{})});
    }
    const eligible=members.filter(r=>r.status!=='停牌');
    if(!unique(members)||members.some(r=>seen.has(r.code))||eligible.length!==+tally[2]||eligible.filter(r=>r.status==='封住').length!==+tally[1])continue;
    members.forEach(r=>seen.add(r.code));result.push({name,success:+tally[1],total:+tally[2],members});
  }
  return result.length?result:null;
}
function parseThemes(root,day){
  const node=byId(root,'market-concepts'),declared=/选出\s*(\d+)\s*个活跃题材/.exec(named(node,'concept-intro'));
  if(!node||one(byId(node,'concept-title'),'strong')!==day||!declared)return null;
  const result=[];
  for(const row of tags(node,'tr')){
    const head=byClass(row,'concept-name'),name=named(head,'concept-detail-link'),summary=text(head);
    const tally=/(\d+)\s*只\s*·\s*活跃\s*(\d+)\s*只\s*·\s*([\d.]+)%/.exec(summary);
    const stats=/封板\s*(\d+)\s*只\s*·\s*中位\s*([+-]?[\d.]+)%/.exec(summary);
    if(!name||!tally||!stats||+tally[2]>+tally[1]||+stats[1]>+tally[2])continue;
    const members=classes(row,'concept-stock').map(n=>({code:stockLink(n,day),name:one(n,'a'),change:number(named(n,'concept-change-number'))}));
    if(members.some(r=>!r.code||r.change===null)||members.length!==+tally[2]||!unique(members))continue;
    const level=/最高\s*(\d+)\s*板/.exec(summary);
    result.push({name,total:+tally[1],active:+tally[2],activePct:+tally[3],sealed:+stats[1],median:+stats[2],height:level?+level[1]:null,
      alignment:clean(named(head,'concept-reason-alignment')),members});
  }
  return result.length===+declared[1]?result:null;
}
function parseSignals(root,day,at,intraday){
  const node=byClass(root,'overview-board'),intro=named(node,'overview-intro');
  const time=/最后更新时间[：:]\s*(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)/.exec(intro);
  const totals=/当日\s*(\d+)\s*类有信号\s*·\s*(\d+)\s*只股票\s*·\s*共出现\s*(\d+)\s*次/.exec(intro);
  const quoteAt=time&&stamp(time[1],time[2],at);
  if(!totals||time?.[1]!==day||!quoteAt||!intraday&&time[2]<'15:00:00')return null;
  const groups=[];
  for(const row of tags(node,'tr')){
    const head=byClass(row,'overview-type'),name=one(head,'span'),n=nStocks(one(head,'small'));
    if(!patterns.includes(name)||n===null)continue;
    const members=classes(row,'overview-stock').map(s=>({code:stockLink(s,day),name:named(s,'overview-name'),
      change:numberPct(named(s,'overview-change').replace(/[[\]\s]/g,'')),theme:clean(named(s,'overview-reason')).replace(/^—$/,'')}));
    if(members.some(r=>!r.code)||members.length!==n||!unique(members))return null;
    groups.push({name,negative:patterns.indexOf(name)>=9,members});
  }
  const records=groups.flatMap(g=>g.members);
  if(groups.length!==patterns.length||new Set(groups.map(g=>g.name)).size!==patterns.length||
    groups.filter(g=>g.members.length).length!==+totals[1]||new Set(records.map(r=>r.code)).size!==+totals[2]||records.length!==+totals[3])return null;
  return {quoteAt,active:+totals[1],stocks:+totals[2],appearances:records.length,groups};
}
function parseIndex(html,day,knownAt,{intraday=false}={}){
  if(!dayOk(day)||!Number.isSafeInteger(knownAt))return null;
  const root=parseHTML(html);
  if(text(byId(root,'page-title'))!==day+' 连板梯队')return null;
  const market=parseMarket(byClass(root,'home-market-overview'),day,knownAt,intraday);
  const distribution=marketDistribution(html,day,knownAt,{intraday});
  if(!market&&!distribution)return null;
  return {day,knownAt,source:'打板客连板复盘',url:dayUrl(day),mode:intraday?'盘中':'收盘',market,distribution,
    ecology:parseEco(byClass(root,'home-limit-up-ecosystem'),day),tiers:parseTiers(root,day),themes:parseThemes(root,day),signals:parseSignals(root,day,knownAt,intraday)};
}
module.exports={parseIndex,dayUrl,origin,numberPct};
