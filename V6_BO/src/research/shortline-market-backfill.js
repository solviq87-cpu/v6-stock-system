'use strict';

const {fetchReviewLimitPool}=require('../core/public-market-context');
const {requestResearchBytes}=require('../core/research-curl-bytes');
const {normalizeDay}=require('../core/limit-reason-evidence');

const asDay=value=>normalizeDay(value);
const positive=n=>Number.isSafeInteger(n)&&n>0;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const symbol=s=>typeof s==='string'&&/^\d{6}$/.test(s);
const pct=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000;
const round=n=>Math.round(n*100)/100;
const cnTime=t=>new Date(t+28800000).toISOString().slice(0,16).replace('T',' ');
const closeGate=day=>Date.parse(day+'T15:10:00+08:00');
const validDay=day=>typeof day==='string'&&asDay(day)===day&&![0,6].includes(new Date(day+'T12:00:00Z').getUTCDay());
const dayOf=t=>new Date(t+28800000).toISOString().slice(0,10);
const numPct=s=>typeof s==='string'&&/^[+-]?\d+(?:\.\d+)?%?$/.test(s.trim())?Number(s.trim().replace('%','')):typeof s==='number'?s:NaN;
const htmlText=s=>s.replace(/<[^>]*>/g,' ').replaceAll('&nbsp;',' ').replaceAll('&amp;','&').replace(/\s+/g,' ').trim();
const thsScope='同花顺沪深主板、创业板和科创板池';
const emScope='东财涨停专题统计池';
const aguScope='Agu 收盘短线统计池（剔除 ST、退市与北交所）';
const keys={upLimit:'涨停家数',downLimit:'跌停家数',breakRate:'炸板率',height:'连板高度',leader:'昨日最高板收盘反馈',diffusion:'题材扩散度',premium:'昨日涨停溢价'};
const avg=values=>round(values.reduce((a,b)=>a+b,0)/values.length);

function fullPool(value,day) {
  if(!value||value.tradeDate!==day||value.complete!==true||!count(value.totalCount)||!Array.isArray(value.records)||value.totalCount!==value.records.length)return;
  const codes=value.records.map(r=>r?.symbol);
  if(codes.every(symbol)&&new Set(codes).size===codes.length)return value;
}
function pool(day,records,source,scope,sourceUrl,extra={}){
  return {tradeDate:day,complete:true,totalCount:records.length,records,source,scope,sourceUrl,...extra};
}
function tags(value){
  if(typeof value!=='string'||value.length>300)return [];
  return [...new Set(value.split(/[+＋、|]/).map(s=>s.trim()).filter(s=>s&&s.length<60&&!/^(其他|其它|未知|未分类|暂无|无|--?|—)$/.test(s)))];
}
function streak(s){
  if(s==='首板')return 1;
  const exact=/^(\d+)天(\d+)板$/.exec(s||'');
  if(exact&&exact[1]===exact[2]&&positive(+exact[1]))return +exact[1];
  const simple=/^(\d+)连板$/.exec(s||'');
  return simple&&positive(+simple[1])?+simple[1]:null;
}
function thsUrl(day,page){
  return 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?'+new URLSearchParams({
    page:String(page),limit:'100',field:'199112,10,9001,330324,133971,133970,1968584,3475914,9002,330329',
    filter:'HS,GEM2STAR',order_field:'330324',order_type:'0',date:day.replaceAll('-','')
  });
}
function thsBook(pages,day){
  if(!pages.length)return;
  const data=pages[0]?.data,p=data?.page;
  if(!p||!count(p.total)||p.limit!==100||p.count!==Math.ceil(p.total/p.limit)||pages.length!==Math.max(1,p.count)||pages.length>10)return;
  const records=[];
  for(const [i,page] of pages.entries()){
    const d=page?.data,meta=d?.page;
    if(page.status_code!==0||asDay(d?.date)!==day||!meta||meta.page!==i+1||meta.count!==p.count||meta.total!==p.total||meta.limit!==p.limit||
      !Array.isArray(d.info)||d.info.length!==Math.min(p.limit,p.total-i*p.limit)||
      JSON.stringify(d.limit_up_count?.today)!==JSON.stringify(data.limit_up_count?.today)||
      JSON.stringify(d.limit_down_count?.today)!==JSON.stringify(data.limit_down_count?.today))return;
    for(const row of d.info){
      const t=Number(row.last_limit_up_time)*1000;
      if(!symbol(row.code)||!positive(t)||dayOf(t)!==day||t>Date.parse(day+'T15:05:00+08:00'))return;
      records.push({symbol:row.code,consecutiveLimits:streak(row.high_days),tags:tags(row.reason_type)});
    }
  }
  const up=data.limit_up_count?.today,down=data.limit_down_count?.today;
  if(!p.total||up?.num!==p.total||new Set(records.map(r=>r.symbol)).size!==p.total)return;
  const sealed=pool(day,records,'同花顺涨停聚焦',thsScope,thsUrl(day,1));
  const totalOK=x=>x&&[x.history_num,x.num,x.open_num].every(count)&&x.num+x.open_num===x.history_num;
  return {sealed,brokenCount:totalOK(up)?up.open_num:null,down:totalOK(down)?down.num:null};
}
function aguBook(html,day,now){
  const url='https://agu-app.com/daily/'+day;
  const ds=day.split('-').map(Number),title=htmlText(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]||'');
  const source=htmlText(/<p class="source">([\s\S]*?)<\/p>/.exec(html)?.[1]||'');
  const stamp=/统计日期 (\d{4}-\d\d-\d\d) 收盘，最近更新 (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(source);
  if(!title.startsWith(ds[0]+'年'+ds[1]+'月'+ds[2]+'日')||!title.includes('A股收盘复盘')||stamp?.[1]!==day)return;
  const updated=Date.parse(stamp[2].replace(' ','T')+':00+08:00');
  if(!positive(updated)||updated<Date.parse(day+'T15:00:00+08:00')||updated>now)return;
  const section=title=>new RegExp('<h2(?: [^>]*)?>'+title+'</h2>([\\s\\S]*?)(?=<h2|$)').exec(html)?.[1]||'';
  const counts=htmlText(section('涨停、炸板与跌停')).match(/涨停 (\d+) 只.*?炸板 (\d+) 只.*?跌停 (\d+) 只/);
  if(!counts||!counts.slice(1).every(s=>count(+s)))return;
  const [,up,broken,down]=counts.map(Number);
  const ladder=section('连板梯队');
  const totals=new Map([...htmlText(ladder).matchAll(/(\d+)板[：:]\s*(\d+)\s*只/g)].map(m=>[+m[1],+m[2]]));
  const ladderNames=new Map([...ladder.matchAll(/（(\d{6})\.(?:SH|SZ|BJ)，(\d+)天(\d+)板）/g)].map(m=>[m[1],m[2]===m[3]&&+m[2]>=2?+m[2]:null]));
  // A "4 days / 3 seals" display can describe a current two-board run.
  // Resolve such a row only when the complete named ladder leaves one
  // possible tier, with exactly its declared number of remaining slots.
  const unspecified=[...ladderNames].filter(([,level])=>level===null);
  const remaining=[...totals].filter(([level])=>level>1).map(([level,n])=>[level,n-[...ladderNames.values()].filter(v=>v===level).length]).filter(([,n])=>n!==0);
  if(unspecified.length&&remaining.length===1&&remaining[0][1]===unspecified.length)
    for(const [code] of unspecified)ladderNames.set(code,remaining[0][0]);
  const declaredFull=[...totals.values()].reduce((n,c)=>n+c,0)===up;
  const namedFull=declaredFull&&![...ladderNames.values()].includes(null)&&[...totals].every(([level,n])=>level===1||[...ladderNames.values()].filter(x=>x===level).length===n);
  const table=section('涨停个股'),head=htmlText(/<thead>([\s\S]*?)<\/thead>/.exec(table)?.[1]||'');
  if(head!=='名称 代码 连板 首次封板 开板次数 题材 成交额'&&up)return;
  const records=[];
  for(const m of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)){
    const c=[...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(x=>htmlText(x[1]));if(!c.length)continue;
    const id=/^(\d{6})\.(?:SH|SZ|BJ)$/.exec(c[1]);if(c.length!==7||!id)return;
    records.push({symbol:id[1],consecutiveLimits:namedFull?(ladderNames.get(id[1])||1):streak(c[2]),tags:tags(c[5])});
  }
  if(records.length!==up||new Set(records.map(r=>r.symbol)).size!==up||[...ladderNames.keys()].some(s=>!records.some(r=>r.symbol===s)))return;
  const checkListed=(name,n)=>{const ids=[...section(name).matchAll(/href="\/daily\/stocks\/(\d{6})\.(?:SH|SZ|BJ)"/g)].map(m=>m[1]);return ids.length===n&&new Set(ids).size===n?ids:null;};
  const brokenIds=checkListed('炸板个股',broken),downIds=checkListed('跌停个股',down);
  const returnText=htmlText(section('短线情绪与主线'));
  const y=/昨日涨停股（剔除 ST、退市与北交所）\s*(\d+) 只，其中 (\d+) 只有收盘价，今日平均 ([+-]?[\d.]+)%/.exec(returnText);
  const prior=/href="\/daily\/(\d{4}-\d\d-\d\d)">上一交易日 \1</.exec(html)?.[1];
  return {previousDay:prior,sealed:pool(day,records,'Agu 每日收盘复盘',aguScope,url,{sourceUpdatedAt:updated}),
    brokenCount:brokenIds&&!brokenIds.some(s=>records.some(r=>r.symbol===s))?broken:null,
    down:downIds?down:null,
    publishedPremium:y&&+y[1]>0&&y[1]===y[2]&&pct(+y[3])?{n:+y[1],value:+y[3],previousDay:prior}:null};
}
function ladderChanges(html,day,now){
  if(!new RegExp(day+'\\s*连板梯队').test(htmlText(html)))return;
  const stamp=/最后更新时间[：:]\s*(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/.exec(htmlText(html));
  if(stamp?.[1]!==day)return;
  const sourceUpdatedAt=Date.parse(day+'T'+stamp[2]+'+08:00');
  if(!positive(sourceUpdatedAt)||sourceUpdatedAt<Date.parse(day+'T15:00:00+08:00')||sourceUpdatedAt>now)return;
  const changes=new Map();
  for(const section of html.matchAll(/<section[^>]* class="ladder-view-tier"[^>]*>([\s\S]*?)<\/section>/g)){
    if(!/<h3>\d+进\d+<\/h3>/.test(section[1]))continue;
    const blocks=section[1].split(/(?=<div class="stock-line )/);
    for(const block of blocks.slice(1)){
      const code=/^<div class="stock-line [^"]+" data-symbol="(\d{6})\.(?:SZ|SH|BJ)">/.exec(block)?.[1];
      if(!code||!block.includes('gupiao-'+code+'.html?review_date='+day+'"'))continue;
      const v=numPct(/class="stock-change[^"]*">\s*([+-]?[\d.]+%)\s*<\/span>/.exec(block)?.[1]);
      if(!pct(v))continue;
      if(changes.has(code))return;
      changes.set(code,v);
    }
  }
  return {changes,source:'打板客收盘连板梯队',sourceUrl:'https://www.dabanke.com/index-'+day.replaceAll('-','')+'.html',sourceUpdatedAt,tradeDate:day};
}
function emUrl(day,kind){
  const endpoint=kind==='down'?'getTopicDTPool':'getYesterdayZTPool';
  return 'https://push2ex.eastmoney.com/'+endpoint+'?'+new URLSearchParams({ut:'7eea3edcaed734bea9cbfc24409ed989',
    dpt:'wz.ztzt',Pageindex:'0',pagesize:'1000',sort:kind==='down'?'fund:asc':'zs:desc',date:day.replaceAll('-','')});
}
async function requestText(url){return (await requestResearchBytes(url,{timeoutMs:4500})).raw.toString('utf8');}
function defaults(clock){
  return {
    async ths(day){
      const first=JSON.parse(await requestText(thsUrl(day,1)));
      const pages=[first],n=first?.data?.page?.count;
      if(!count(n)||n>10||asDay(first.data.date)!==day)return;
      for(let i=2;i<=n;i++)pages.push(JSON.parse(await requestText(thsUrl(day,i))));
      return thsBook(pages,day);
    },
    async agu(day){return aguBook(await requestText('https://agu-app.com/daily/'+day),day,clock());},
    async ladder(day){return ladderChanges(await requestText('https://www.dabanke.com/index-'+day.replaceAll('-','')+'.html'),day,clock());},
    async east(day,kind){
      if(kind==='sealed'||kind==='broken')return fetchReviewLimitPool(day,kind);
      const sourceUrl=emUrl(day,kind),j=JSON.parse(await requestText(sourceUrl)),d=j?.data;
      if(j.rc!==0||asDay(d?.qdate)!==day||!count(d.tc)||!Array.isArray(d.pool)||d.pool.length!==d.tc||!d.pool.every(r=>symbol(r?.c))||new Set(d.pool.map(r=>r.c)).size!==d.tc)return;
      const attrs={source:'东方财富'+(kind==='down'?'跌停池':'昨日涨停表现池'),scope:emScope,sourceUrl,tradeDate:day};
      if(kind==='down')return {...attrs,n:d.tc};
      const changes=new Map(d.pool.filter(r=>pct(r.zdp)).map(r=>[r.c,r.zdp]));
      return {...attrs,changes};
    }
  };
}

function createMarketBackfill({previousTradeDay,clock=Date.now,providers={}}={}){
  const readers={...defaults(clock),...providers},cache=new Map();
  async function read(kind,day,arg){
    const key=[kind,day,arg].join('/'),now=clock(),old=cache.get(key);
    if(old&&(old.pending||old.until>now))return old.promise;
    for(const [k,item] of cache)if(k!==key&&!item.pending&&(item.until+86400000<=now||cache.size>=96))cache.delete(k);
    if(cache.size>=96)return {};
    const slot={pending:true,until:0};
    slot.promise=Promise.resolve().then(()=>readers[kind](day,arg)).then(value=>{
      const receivedAt=clock();
      return value&&positive(receivedAt)&&receivedAt>=now?{value,receivedAt}:{};
    }).catch(()=>({})).then(packet=>{
      slot.pending=false;slot.until=clock()+(packet.value?3600000:180000);
      if(!packet.value&&old?.last)return slot.last=old.last;
      if(packet.value){
        const serialize=v=>JSON.stringify(v,(_,value)=>value instanceof Map?[...value]:value);
        slot.last=old?.last&&serialize(old.last.value)===serialize(packet.value)?old.last:packet;
        return slot.last;
      }
      return packet;
    });
    cache.set(key,slot);return slot.promise;
  }
  return async function backfill({day,review,previousPool,clsPool}={}){
    const start=clock(),evidence=[],missing=[],rows=[];
    if(!positive(start)||!validDay(day)||start<closeGate(day))return {rows,evidence,sources:[],missing:['未确认已收盘的请求日期']};
    const sessions=[day];
    for(let i=0;i<3;i++){
      const current=sessions.at(-1);
      let prev;
      try{prev=asDay(await previousTradeDay?.(current));}catch{/* Try the public archive's dated navigation. */}
      if(!validDay(prev)||prev>=current)prev=(await read('agu',current)).value?.previousDay;
      if(!validDay(prev)||prev>=current){missing.push(current+' 缺可核实的前一交易日');break;}
      sessions.push(prev);
    }
    const books=new Map();
    async function book(d,priorOnly){
      // Current native packets can seed the cache for this read, but cannot
      // certify any earlier receipt time. Other sessions obtain their own pool.
      const rep=review?.day===d?review:null;
      const native=fullPool(rep?.sealed,d)||fullPool(previousPool,d);
      const t=await read('ths',d);
      const ths=fullPool(t.value?.sealed,d)?t.value:null;
      const a=await read('agu',d);
      const agu=fullPool(a.value?.sealed,d)?a.value:null;
      let selected=native||ths?.sealed||agu?.sealed,selAt=native?start:ths?t.receivedAt:a.receivedAt;
      if(!selected){
        const p=await read('east',d,'sealed');selected=fullPool(p.value,d);selAt=p.receivedAt;
      }
      const selectedSource=selected?.source==='eastmoney'||(native&&!native.source)?'东方财富涨停池':selected?.source;
      const ref=(val,receivedAt,scope)=>({source:val?.source==='eastmoney'?'东方财富':val?.source||'东方财富',scope:val?.scope||scope||emScope,
        sourceUrl:val?.sourceUrl||val?.requestUrl||null,tradeDate:d,sourceUpdatedAt:val?.sourceUpdatedAt||null,receivedAt});
      const sel=selected?{...selected,source:selectedSource,scope:selected.scope||emScope}:null;
      const outputs={ths,agu,selected:sel,selMeta:sel&&ref(sel,selAt),ref,t,a};
      if(priorOnly)return outputs;
      if(count(rep?.down))outputs.down={n:rep.down,meta:ref({source:'V6 收盘证据／东方财富跌停池'},start)};
      else if(count(ths?.down))outputs.down={n:ths.down,meta:ref(ths.sealed,t.receivedAt)};
      else {
        const p=await read('east',d,'down');
        if(p.value?.tradeDate===d&&count(p.value.n))outputs.down={n:p.value.n,meta:ref(p.value,p.receivedAt)};
        else if(count(agu?.down))outputs.down={n:agu.down,meta:ref(agu.sealed,a.receivedAt)};
      }
      if(!sel)return outputs;
      const codeSet=new Set(sel.records.map(r=>r.symbol));
      const exact=v=>v?.totalCount===codeSet.size&&v.records.every(r=>codeSet.has(r.symbol));
      const pair=(p,receivedAt)=>fullPool(p,d)&&sel.scope===emScope&&!p.records.some(r=>codeSet.has(r.symbol))&&{n:p.totalCount,meta:ref(p,receivedAt)};
      outputs.broken=pair(rep?.broken,start);
      if(!outputs.broken){
        if(count(ths?.brokenCount)&&exact(ths.sealed))outputs.broken={n:ths.brokenCount,meta:ref(ths.sealed,t.receivedAt)};
        else if(count(agu?.brokenCount)&&exact(agu.sealed))outputs.broken={n:agu.brokenCount,meta:ref(agu.sealed,a.receivedAt)};
        else if(sel.scope===emScope){const p=await read('east',d,'broken');outputs.broken=pair(p.value,p.receivedAt);}
      }
      return outputs;
    }
    // Keep the number of independent dates in flight bounded. Physical HTTP
    // starts (including paging) also use the shared provider-specific governor.
    for(let i=0;i<sessions.length;i+=2)await Promise.all(sessions.slice(i,i+2).map(async(d,k)=>books.set(d,await book(d,i+k===3))));
    function positions(b){
      if(!b?.selected?.records?.length)return;
      const {selected,selMeta,ths,agu,t,a,ref}=b;
      const codes=new Set(selected.records.map(r=>r.symbol));
      for(const [p,meta] of [[selected,selMeta],[agu?.sealed,agu&&ref(agu.sealed,a.receivedAt)],[ths?.sealed,ths&&ref(ths.sealed,t.receivedAt)]]){
        if(!p)continue;
        const matched=p.records.filter(r=>codes.has(r.symbol));
        if(matched.length!==codes.size||!matched.every(r=>positive(r.consecutiveLimits)))continue;
        const height=Math.max(...matched.map(r=>r.consecutiveLimits));
        return {height,meta,leaders:matched.filter(r=>r.consecutiveLimits===height).map(r=>r.symbol),first:matched.filter(r=>r.consecutiveLimits===1).map(r=>r.symbol)};
      }
    }
    for(const [i,d] of sessions.slice(0,3).entries()){
      const b=books.get(d),p=sessions[i+1],old=books.get(p);
      const r={date:d,previousDay:p||null,source:'国内公开收盘历史补采',fieldSources:{},missing:[]};
      function field(key,val,method,sources,extra={}){
        if(!Number.isFinite(val)||!sources.length||sources.some(s=>!s||!s.source||!positive(s.receivedAt)||s.receivedAt>clock()))return;
        r[key]=val;r.fieldSources[key]={source:[...new Set(sources.map(s=>s.source))].join('、'),knownAt:Math.max(...sources.map(s=>s.receivedAt)),method,sources,...extra};
      }
      if(b?.selected){
        const {selected,selMeta,ths,agu,t,a,ref}=b;
        const codes=selected.records.map(x=>x.symbol),h=positions(b);
        field('upLimit',codes.length,'源方总数与逐股代码去重后相符',[selMeta],{n:codes.length});
        if(h)field('height',h.height,'逐股核对当日连续封板天数',[selMeta,h.meta],{n:codes.length});
        if(b.broken&&codes.length+b.broken.n>0)field('breakRate',round(100*b.broken.n/(codes.length+b.broken.n)),'未封炸板数 /（收盘封板数 + 未封炸板数）',[selMeta,b.broken.meta],{sealed:codes.length,broken:b.broken.n});
        const thsTags=ths&&[ths.sealed.records,ref(ths.sealed,t.receivedAt),'同花顺逐股当日题材'];
        const aguTags=agu&&[agu.sealed.records,ref(agu.sealed,a.receivedAt),'Agu 逐股当日题材'];
        let cls;
        if(clsPool?.source==='cls'&&clsPool.complete===true&&clsPool.status==='available'&&clsPool.tradeDate===d&&positive(clsPool.receivedAt)&&clsPool.receivedAt>=closeGate(d)&&clsPool.receivedAt<=clock()&&Array.isArray(clsPool.items)&&clsPool.totalCount===clsPool.items.length){
          const members=clsPool.items.filter(x=>x.tradeDate===d&&!x.heldRecord).map(x=>({symbol:x.code,tags:(x.plates||[]).map(p=>p.name).flatMap(tags)}));
          cls=[members,ref({source:'财联社当日涨停池',scope:'CLS 逐股板块标签',sourceUrl:clsPool.sourceUrl},clsPool.receivedAt),'财联社原池当日板块'];
        }
        for(const entry of [thsTags,cls,aguTags]){
          if(!entry||!codes.length)continue;
          const [items,meta,basis]=entry,map=new Map(items.map(x=>[x.symbol,x.tags])),counts=new Map();
          if(map.size!==items.length||!codes.every(code=>map.get(code)?.length))continue;
          for(const code of codes)for(const tag of new Set(map.get(code)))counts.set(tag,(counts.get(tag)||0)+1);
          const withPeers=codes.filter(code=>map.get(code).some(tag=>counts.get(tag)>=2)).length;
          field('diffusion',round(100*withPeers/codes.length),'完整封板池中具有同题材助攻的比例',[selMeta,meta],{basis,n:codes.length,withPeers});break;
        }
      }
      if(b?.down)field('downLimit',b.down.n,'源方同日跌停统计',[b.down.meta],{n:b.down.n});
      if(old?.selected?.records?.length&&(!b.agu?.previousDay||b.agu.previousDay===p)){
        const prev=old.selected.records.map(x=>x.symbol),h=positions(old),cohorts=[['premium',prev],['leader',h?.height>=2?h.leaders:[]],['firstBoardPremium',h?.first||[]]];
        const settle=(packet)=>{
          const obj=packet.value;if(!obj||obj.tradeDate!==d||!(obj.changes instanceof Map))return;
          for(const [key,ids] of cohorts){
            if(Object.hasOwn(r,key)||!ids.length||!ids.every(id=>pct(obj.changes.get(id))))continue;
            const sources=[old.selMeta,b.ref(obj,packet.receivedAt)];
            if(key!=='premium')sources.push(h.meta);
            field(key,avg(ids.map(id=>obj.changes.get(id))),'上一交易日冻结成分的当日收盘涨幅等权平均',sources,{previousDay:p,n:ids.length,...(key==='leader'?{height:h.height,codes:ids}:{})});
          }
        };
        if(i===0)settle(await read('east',d,'yesterday'));
        if(cohorts.some(([key,ids])=>ids.length&&!Object.hasOwn(r,key)))settle(await read('ladder',d));
        if(!Object.hasOwn(r,'premium')&&old.agu?.sealed&&b.agu?.publishedPremium){
          const y=b.agu.publishedPremium,oldAgu=old.agu.sealed;
          const previousCodes=new Set(oldAgu.records.map(x=>x.symbol));
          if(y.previousDay===p&&y.n===oldAgu.totalCount&&prev.length===y.n&&prev.every(code=>previousCodes.has(code)))
            field('premium',y.value,'同源昨日池全部成员有收盘价并与上日逐股名单完全对应',[old.ref(oldAgu,old.a.receivedAt),b.ref(b.agu.sealed,b.a.receivedAt)],{previousDay:p,n:y.n});
        }
      }
      r.missing=Object.entries(keys).filter(([k])=>!Object.hasOwn(r,k)).map(([,label])=>label);
      missing.push(...r.missing.map(label=>d+' '+label));
      const sources=Object.values(r.fieldSources).flatMap(f=>f.sources),names=[...new Set(sources.map(s=>s.source))];
      if(sources.length){
        r.knownAt=Math.max(...sources.map(s=>s.receivedAt));r.availableAt=cnTime(r.knownAt);
        r.source='历史补采／'+names.join('、');rows.push(r);
        evidence.push(d+' '+Object.keys(r.fieldSources).map(k=>keys[k]||'昨日首板溢价').join('、')+'；来源 '+names.join('、'));
      }
    }
    rows.sort((a,b)=>a.date.localeCompare(b.date));
    const sources=[...new Set(rows.flatMap(row=>Object.values(row.fieldSources).flatMap(x=>x.sources.map(s=>s.source))))].map(name=>({name,status:'available'}));
    return {rows,evidence,missing,sources};
  };
}
module.exports={createMarketBackfill,thsBook,aguBook,ladderChanges};
