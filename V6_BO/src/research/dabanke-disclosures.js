'use strict';
const {parseHTML,all,classes,byClass,byId,tags,text,one,named,clean,dayOk,stamp,number,stockLink}=require('./dabanke-html');
const {origin,numberPct}=require('./dabanke-index');
const fullUrl=day=>origin+'/lhb-'+day.replaceAll('-','')+'.html';
function period(label,day){
  if(/^(?:单日榜?|当日|单日披露)$/.test(label)||label===day.slice(5))return {start:day,end:day,multi:false};
  const m=/(\d\d-\d\d)\s*(?:至|—|~)\s*(\d\d-\d\d)/.exec(label);
  if(!m||m[2]!==day.slice(5))return null;
  const start=(Number(day.slice(0,4))-(m[1]>m[2]?1:0))+'-'+m[1];
  if(!dayOk(start)||start>=day)return null;
  return {start,end:day,multi:true};
}
function parseDisclosures(html,day,knownAt){
  if(!dayOk(day))return null;
  const root=parseHTML(html),header=byClass(root,'dragon-intro'),title=one(header,'h1');
  const m=/最后发布时间[：:]\s*(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)/.exec(title);
  const publishedAt=m&&stamp(m[1],m[2],knownAt),totals=/(\d+)\s*条披露\s*·\s*(\d+)\s*只股票\s*·\s*单日榜\s*(\d+)\s*条\s*·\s*多日榜\s*(\d+)\s*条/.exec(text(header));
  if(m?.[1]!==day||!publishedAt||m[2]<'15:00:00'||!totals||+totals[1]!==+totals[3]+ +totals[4])return null;
  const rows=[];
  for(const node of tags(byClass(root,'dragon-summary-list'),'article')){
    const code=stockLink(byClass(node,'dragon-summary-stock'),day,'lhbd'),name=named(node,'dragon-summary-stock');
    const amounts=classes(node,'dragon-summary-amount').map(n=>number(text(n)));
    const span=period(named(node,'dragon-summary-period'),day),reason=clean(named(node,'dragon-summary-reason'));
    if(!code||!name||!reason||!span||amounts.length!==3||amounts.some(n=>n===null)||amounts[0]<0||amounts[1]<0)return null;
    rows.push({code,name,span,reason,theme:clean(named(node,'dragon-summary-concept')),buy:amounts[0],sell:amounts[1],net:amounts[2]});
  }
  if(rows.length!==+totals[1]||new Set(rows.map(r=>r.code)).size!==+totals[2]||rows.filter(r=>r.span.multi).length!==+totals[4])return null;
  return {day,knownAt,publishedAt,source:'打板客 · 交易所龙虎榜披露',url:fullUrl(day),stocks:+totals[2],single:+totals[3],multi:+totals[4],rows};
}
function topDragon(root,day){
  const section=byId(root,'fpb-dev-dragon'),total=/上榜\s*(\d+)只/.exec(named(section,'fpb-dev-meta'));
  if(!total)return null;
  const rows=[];
  for(const item of classes(section,'fpb-dev-dragon-stock')){
    const code=stockLink(byClass(item,'fpb-dev-dragon-detail'),day,'lhbd'),rank=number(named(item,'fpb-dev-card-rank'));
    const spanNode=byClass(item,'fpb-dev-dragon-period'),span=spanNode?period(text(spanNode),day):{start:day,end:day,multi:false};
    const buy=number(one(byClass(item,'fpb-dev-dragon-buy'),'strong')),net=number(one(byClass(item,'fpb-dev-dragon-net'),'strong'));
    if(!code||rank!==rows.length+1||!span||buy===null||buy<0||net===null)return null;
    const seats=[];
    for(const a of tags(byClass(item,'fpb-dev-dragon-seats'),'a')){
      const match=/^(.+?)\s*·\s*买\s*([+\d,.万亿元]+)\s*\/\s*卖\s*([+\d,.万亿元]+)$/.exec(a.attrs.title||'');
      if(!match)continue;
      const seatBuy=number(match[2]),sell=number(match[3]);
      if(seatBuy!==null&&sell!==null)seats.push({name:clean(text(a)),fullName:clean(match[1]),buy:seatBuy,sell});
    }
    rows.push({code,rank,span,name:named(item,'fpb-dev-stock-name'),theme:clean(named(item,'fpb-dev-stock-reason')),change:numberPct(named(item,'fpb-dev-stock-change')),buy,net,seats});
  }
  return rows.length===Math.min(10,+total[1])&&new Set(rows.map(r=>r.code)).size===rows.length?{stocks:+total[1],rows}:null;
}
function parsePocket(html,day,knownAt){
  if(!dayOk(day)||!Number.isSafeInteger(knownAt))return null;
  const root=parseHTML(html),reportDate=byClass(root,'fpb-dev-review-date'),date=tags(reportDate,'time')[0];
  const footer=text(tags(root,'footer')[0]),m=/行情日\s*(\d{4}-\d\d-\d\d)\s*·\s*行情快照\s*(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)/.exec(footer||text(byClass(root,'fpb-dev-footer')));
  if(date?.attrs.datetime!==day||text(date)!==day||!text(reportDate).includes('收盘已确认')||m?.[1]!==day||m?.[2]!==day||m[3]<'15:00:00'||!stamp(day,m[3],knownAt))return null;
  const activity=byId(root,'fpb-dev-activity'),activityStats=/活跃\s*(\d+)只\s*·\s*有效样本\s*(\d+)只/.exec(named(activity,'fpb-dev-meta'));
  const activityRows=classes(activity,'fpb-dev-activity-stock').map(n=>({code:stockLink(n,day),name:one(n,'strong'),rank:number(named(n,'fpb-dev-card-rank')),change:numberPct(named(n,'fpb-dev-activity-change')),amount:number(one(byClass(n,'fpb-dev-activity-amount'),'b'))}));
  const popularity=byId(root,'fpb-dev-popularity'),rankStamp=/观察\s*(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)\s*·\s*行情日\s*(\d{4}-\d\d-\d\d)/.exec(named(popularity,'fpb-dev-popularity-note'));
  const rankedAt=rankStamp&&stamp(rankStamp[1],rankStamp[2],knownAt);
  const ranking=classes(popularity,'fpb-dev-popularity-row').map(n=>{
    const pct=classes(n,'fpb-dev-popularity-change'),theme=byClass(n,'fpb-dev-popularity-theme');
    return {code:stockLink(n,day),name:one(n,'a'),rank:number(named(n,'fpb-dev-popularity-rank')),change:numberPct(text(pct[0])),change10:numberPct(text(pct[1])),
      theme:theme?.attrs['data-reason-date']===day?clean(theme.attrs['data-reason']):''};
  });
  const briefs=[];
  for(const card of classes(root,'fpb-dev-addition')){
    const key=(card.attrs['aria-labelledby']||'').replace(/^fpb-dev-/,'').replace(/-title$/,'');
    if(!['financing','extremes','continuity','structure','times','industries','hotwords','rotation','limit-activity','breaks','interval'].includes(key))continue;
    const title=text(byId(card,'fpb-dev-'+key+'-title')),meta=classes(card,'fpb-dev-meta').map(text),dateNode=tags(card,'time')[0];
    const valueDay=dateNode?.attrs.datetime||day;
    if(!dayOk(valueDay)||valueDay>day||key==='financing'&&!dateNode)continue;
    const entries=[];
    for(const dl of tags(card,'dl'))for(const line of dl.children.filter(n=>n.tag==='div'))entries.push({label:one(line,'dt'),value:[one(line,'dd'),one(line,'small')].filter(Boolean).join(' · ')});
    for(const line of classes(card,'fpb-dev-inline-stats'))for(const n of line.children.filter(n=>n.tag==='span'))entries.push({label:text(n)});
    for(const n of tags(card,'li')){
      const a=tags(n,'a')[0],code=stockLink(a,day),name=one(a,'strong');
      if(code)entries.push({code,label:name,value:clean(text(a).slice(name.length).trim())});
      else if(text(n))entries.push({label:clean(text(n))});
    }
    for(const n of tags(byClass(card,'fpb-dev-rotation-directions'),'div')){const label=one(n,'h4');if(label)entries.push({label,value:one(n,'p')});}
    for(const row of tags(card,'tr')){
      const cells=tags(row,'td').map(n=>number(text(n)));
      if(key==='times'&&cells.length===3&&cells.every(v=>Number.isSafeInteger(v)&&v>=0)&&cells[0]===cells[1]+cells[2]){
        const label=one(row,'th');entries.push({label:label==='时间待确认'?'未列具体时段':label,value:'触板 '+cells[0]+' · 封板 '+cells[1]+' · 炸板 '+cells[2]});
      }
    }
    const intervalCounts=named(card,'fpb-dev-interval-head');if(intervalCounts)meta.push(intervalCounts);
    if(entries.length)briefs.push({key,title,day:valueDay,meta,entries:entries.slice(0,64)});
  }
  return {day,knownAt,quoteAt:stamp(day,m[3],knownAt),source:'打板客复盘宝',url:origin+'/fpb.html',
    dragon:topDragon(root,day),briefs,
    activity:activityStats&&activityRows.length<=10&&activityRows.every((r,i)=>r.code&&r.rank===i+1&&r.amount!==null&&r.change!==null)?{active:+activityStats[1],total:+activityStats[2],rows:activityRows}:null,
    popularity:rankedAt&&rankStamp[3]===day&&ranking.length&&ranking.every((r,i)=>r.code&&r.rank===i+1)?{observedAt:rankedAt,observedDay:rankStamp[1],rows:ranking}:null};
}
module.exports={parsePocket,parseDisclosures,fullUrl};
