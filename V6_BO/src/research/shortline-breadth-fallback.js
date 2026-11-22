'use strict';

// All inputs here are public market quotes or dated public membership evidence.
// A provider's trade date, its quote time and the local receipt time are distinct.
const {fetchEastmoneySnapshot}=require('../core/eastmoney-market-snapshot');
const {marketRequests}=require('../core/market-request-governor');
const {createResearchRequest,requestResearchBytes}=require('../core/research-curl-bytes');
const {aShareCalendarDate,assessDailyBarFinality}=require('../core/a-share-calendar');
const {CLS_LIMIT_POOL_URL,normalizeClsLimitPool}=require('../core/cls-limit-up-pool');

const INDEXES={sh000001:['1.000001','上证指数'],sz399001:['0.399001','深证成指']};
const FS='m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const SCOPE='沪深京 A 股报价列表';
const EM='东方财富沪深京 A 股逐股行情', TX='腾讯原始收盘行情', SINA='新浪原始收盘行情';
const codeOk=c=>typeof c==='string'&&/^(?:60[0135]|68[89]|00[0123]|30[01])\d{3}$|^(?:43|83|87|88|92)\d{4}$/.test(c);
const marketCode=c=>c[0]==='6'?'sh':/^(?:43|83|87|88|92)/.test(c)?'bj':'sz';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(v)?Number(v):NaN;
const dated=(t,day,now)=>Number.isSafeInteger(t)&&t>=Date.parse(day+'T15:00:00+08:00')&&t<=now&&aShareCalendarDate(t)===day;
const sectorNameOk=s=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=60&&!/[<>\x00-\x1f]/.test(s);
const hasClose=(day,now)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&assessDailyBarFinality(day,{now,observedAt:now}).usable;
function observed(rows,day,source,scope,total,knownAt,kind='breadth') {
  if(!Number.isSafeInteger(total)||total<1||total>20000||!Number.isSafeInteger(knownAt))return null;
  const seen=new Set();let adv=0,dec=0,flat=0,amountCny=0,withAmount=0,changes=0;
  for(const q of rows){
    if(!codeOk(q.code)||!dated(q.quoteAt,day,knownAt)||!Number.isSafeInteger(q.receivedAt)||
       q.receivedAt<q.quoteAt||q.receivedAt>knownAt||q.tradeDate!==day||!Number.isFinite(q.pct)||q.pct< -100||
       !Number.isFinite(q.price)||q.price<=0||q.pct>1000)continue;
    if(seen.has(q.code))return null;
    seen.add(q.code);changes+=q.pct;
    if(q.pct>0)adv++;else if(q.pct<0)dec++;else flat++;
    if(Number.isFinite(q.amount)&&q.amount>0){withAmount++;amountCny+=q.amount;}
  }
  if(!seen.size||seen.size>total)return null;
  return {kind,scope,source,day,knownAt,total,observed:seen.size,complete:seen.size===total,
    adv,dec,flat,...(withAmount===seen.size?{amountCny}:{}),meanChange:changes/seen.size};
}
function parseSina(raw,day,receivedAt,wanted) {
  const rows=[],seen=new Set();
  for(const m of new TextDecoder('gbk').decode(raw).matchAll(/var hq_str_((?:sh|sz|bj)\d{6})="([^"]*)";/g)){
    const key=m[1],f=m[2].split(',');
    if(!wanted.has(key)||f.length<32||f[30]!==day||!/^\d\d:\d\d:\d\d$/.test(f[31]))continue;
    if(seen.has(key))throw Error('重复报价');
    seen.add(key);
    const quoteAt=Date.parse(day+'T'+f[31]+'+08:00'),price=number(f[3]),preClose=number(f[2]),amount=number(f[9]);
    if(!dated(quoteAt,day,receivedAt)||!(price>0&&preClose>0))continue;
    if(INDEXES[key]){
      if(f[0]===INDEXES[key][1]&&amount>0)rows.push({code:INDEXES[key][0],tradeDate:day,quoteAt,receivedAt,amount});
    }else rows.push({code:key.slice(2),price,tradeDate:day,receivedAt,quoteAt,pct:100*(price/preClose-1),amount});
  }
  return rows;
}
function indexAmount(rows,day,now,source){
  const amounts=new Map();let knownAt=0;
  for(const r of rows||[]){
    if(!Object.values(INDEXES).some(([id])=>id===r.code)||r.tradeDate!==day||!dated(r.quoteAt,day,now)||
       !Number.isSafeInteger(r.receivedAt)||r.receivedAt<r.quoteAt||r.receivedAt>now)continue;
    const n=number(r.amount??r.turnoverAmountYuan);
    if(!(n>0&&n<Number.MAX_SAFE_INTEGER))continue;
    if(amounts.has(r.code))return null;
    amounts.set(r.code,n);knownAt=Math.max(knownAt,r.receivedAt);
  }
  if(!amounts.size)return null;
  const scope=amounts.size===2?'沪深两市成交额':amounts.has('1.000001')?'沪市成交额':'深市成交额';
  return {kind:'amount',scope,source,day,knownAt,observed:amounts.size,total:2,complete:amounts.size===2,
    amountCny:[...amounts.values()].reduce((a,b)=>a+b,0)};
}
function makeSample(list){
  const all=[...new Set(list.filter(codeOk))].sort();
  return all.length<=60?all:Array.from({length:60},(_,i)=>all[Math.round(i*(all.length-1)/59)]);
}
function boardBar(payload,day,code,name,knownAt){
  const d=payload?.data;
  if(payload?.rc!==0||d?.market!==90||d.code!==code||d.name!==name||!Array.isArray(d.klines))return null;
  const rows=d.klines.filter(v=>typeof v==='string').map(v=>v.split(',')).filter(v=>v[0]===day);
  if(rows.length!==1)return null;
  const [,o,c,h,l,v,a,,p]=rows[0],open=number(o),close=number(c),high=number(h),low=number(l),volumeLots=number(v),amountCny=number(a),change=number(p);
  if(![open,close,high,low].every(x=>x>0)||high<Math.max(open,close)||low>Math.min(open,close)||
     !Number.isSafeInteger(volumeLots)||volumeLots<=0||!(amountCny>0))return null;
  return {date:day,code,name,knownAt,open,high,low,close,volumeLots,amountCny,source:'东方财富未复权板块日K',...(Number.isFinite(change)?{change}:{})};
}
// CLS publishes style screens and geographical groups alongside industries.
// Only the automatic hot-industry ranking excludes these screen labels.
const screen=/^(?:昨日|今日|百日新|创(?:历史|年内|阶段)新|高股息|高换手|近期新高|近期新低)|^(?:北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
function clsBoard(json,day,g,received){
  if(json?.code!==200||!Array.isArray(json.data)||json.data.length>5)return null;
  const rows=json.data.filter(r=>String(r?.date)===day.replaceAll('-',''));
  if(rows.length!==1)return null;
  const row=rows[0],knownAt=Math.max(received,g.knownAt);
  if(row.secu_code!==g.code||!Number.isSafeInteger(knownAt))return null;
  const [open,high,low,close,prev,volumeShares,amountCny]=[row.open_px,row.high_px,row.low_px,row.close_px,row.preclose_px,row.business_amount,row.business_balance].map(number);
  if(![open,high,low,close,prev].every(v=>v>0)||high<Math.max(open,close)||low>Math.min(open,close)||
     !Number.isSafeInteger(volumeShares)||volumeShares<=0||!Number.isFinite(amountCny)||amountCny<=0)return null;
  return {code:g.code,name:g.name,date:day,knownAt,open,high,low,close,volumeShares,amountCny,change:100*(close/prev-1),
    source:'财联社原始板块日K',priceBasis:'unadjusted'};
}
function sectorCoverage(bar,day){
  return {kind:'sector',scope:bar.name+' · '+bar.code+' 板块指数',day,source:bar.source,knownAt:bar.knownAt,
    observed:1,total:1,complete:true,amountCny:bar.amountCny,...(Number.isFinite(bar.change)?{change:bar.change}:{})};
}
function clsCohort(state,day,now,requestedName){
  const meta=state.ztReviewPoolMeta?.sources?.find(s=>s.source==='cls'&&s.status==='available'&&s.providerComplete===true&&
    s.tradeDate===day&&Number.isSafeInteger(s.receivedAt)&&s.receivedAt>=Date.parse(day+'T15:00:00+08:00')&&s.receivedAt<=now);
  if(!meta||!Array.isArray(state.ztReviewPool))return null;
  const rows=state.ztReviewPool.filter(r=>r?.sources?.includes('cls')&&!r.heldRecord&&r.tradeDate===day&&
    r.clsObservation?.tradeDate===day).map(r=>({...r,receivedAt:r.clsObservation.receivedAt}));
  return rankedPool(rows,day,now,meta.receivedAt,requestedName);
}
function rankedPool(rows,day,now,poolAt,requestedName){
  const groups=new Map(),close=Date.parse(day+'T15:00:00+08:00');
  if(!Number.isSafeInteger(poolAt)||poolAt<close||poolAt>now)return null;
  for(const r of rows){
    if(!codeOk(r.code)||r.tradeDate!==day||!Number.isSafeInteger(r.receivedAt)||r.receivedAt<close||r.receivedAt>now)continue;
    for(const {name,code} of Array.isArray(r.plates)?r.plates.filter(Boolean):[]){
      if(!sectorNameOk(name)||(requestedName?requestedName!==name:screen.test(name)))continue;
      if(!groups.has(name))groups.set(name,{name,members:new Set(),ids:new Set(),knownAt:poolAt});
      const g=groups.get(name);g.members.add(r.code);if(/^cls\d{5}$/.test(code))g.ids.add(code);g.knownAt=Math.max(g.knownAt,r.receivedAt);
    }
  }
  const first=[...groups.values()].filter(g=>g.ids.size<2).sort((a,b)=>b.members.size-a.members.size||a.name.localeCompare(b.name))[0];
  return first&&{name:first.name,code:[...first.ids][0],knownAt:first.knownAt,members:[...first.members],source:'财联社同日涨停池题材成员',day};
}
async function defaultSnapshot(clock,governor){
  const snapshot=await fetchEastmoneySnapshot({clock,now:clock(),maxPages:30,requestGovernor:governor||marketRequests,
    fetchImpl:(target,options)=>{const url=new URL(target);url.searchParams.set('fs',FS);return globalThis.fetch(url,options);}});
  return {...snapshot,scope:SCOPE};
}
const LEGU='https://www.legulegu.com/stockdata/market-activity';
function marketDistribution(html,day,knownAt){
  const block=html.match(/<h2 id="home-market-distribution-title">全市场涨跌分布<\/h2>([\s\S]*?)<\/section>/)?.[1];
  if(!block||!block.includes('沪深京 A 股 · 含 ST')||!/<strong class="home-market-state is-final">\s*收盘数据\s*<\/strong>/.test(block))return null;
  const head=block.split('</header>')[0],stamp=/截至 (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/.exec(head);
  const size=/有效\s*(\d+)\s*\/\s*(\d+)/.exec(head);
  const quoteAt=stamp&&Date.parse(stamp[1]+'T'+stamp[2]+'+08:00');
  if(!head.includes('<span>'+day+'</span>')||stamp?.[1]!==day||!dated(quoteAt,day,knownAt)||!size)return null;
  const observed=Number(size[1]),total=Number(size[2]);
  const headline=name=>{const m=block.match(new RegExp('class="market-total-'+name+'">[^<]*<strong>(\\d+)</strong>'));return m?Number(m[1]):null;};
  const adv=headline('rise'),flat=headline('flat'),dec=headline('fall');
  if([adv,flat,dec].includes(null)||observed!==adv+flat+dec||total<3000||total>20000||observed>total||!observed)return null;
  const bins=new Map();
  for(const m of block.matchAll(/class="short-pool-bar-row market-bucket-(\w+)"[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*<strong>(\d+)<\/strong>/g)){
    if(bins.has(m[1]))return null;
    bins.set(m[1],Number(m[2]));
  }
  const sum=keys=>keys.reduce((n,key)=>n+(bins.get(key)??NaN),0);
  if(bins.size!==11||bins.get('flat')!==flat||sum(['limit_up','over_7','up_5_7','up_3_5','up_0_3'])!==adv||
    sum(['limit_down','below_7','down_5_7','down_3_5','down_0_3'])!==dec)return null;
  return {kind:'market-distribution',scope:'沪深京 A 股（含 ST）',source:'打板客收盘涨跌分布',day,knownAt,quoteAt,
    observed,total,adv,dec,flat,upLimit:bins.get('limit_up'),downLimit:bins.get('limit_down')};
}
function leguWidth(html,day,knownAt){
  const times=[...html.matchAll(/<span class="market-activity-time">([^<]*)<\/span>/g)];
  const summary=/<meta name="description" content="(\d{4}-\d\d-\d\d)，A股赚钱效益分布，[^"]*?(\d+)家上涨，(\d+)家下跌，/.exec(html);
  if(!summary||summary[1]!==day||times.length!==1||!html.includes('即沪深两市上涨个股所占比例'))return null;
  const time=times[0][1];
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(time)||!dated(Date.parse(time.replace(' ','T')+'+08:00'),day,knownAt))return null;
  const table=/<tr>\s*<td>上涨<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td>下跌<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td>平盘<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<\/tr>/.exec(html);
  if(!table)return null;
  const [adv,dec,flat]=table.slice(1).map(Number),n=adv+dec+flat;
  if(n<3000||n>12000||adv!==Number(summary[2])||dec!==Number(summary[3]))return null;
  return {kind:'breadth',scope:'沪深两市交易股票（乐咕乐股口径）',source:'乐咕乐股收盘赚钱效应',day,knownAt,
    quoteAt:Date.parse(time.replace(' ','T')+'+08:00'),observed:n,total:n,complete:true,adv,dec,flat};
}
function createBreadthFallback({clock=Date.now,request=requestResearchBytes,requestGovernor,fetchSnapshot,
    fetchIndex=()=>require('../../em').fetchIdxRt(),fetchBatchQuotes,fetchSectorBars}={}){
  const send=createResearchRequest(request,requestResearchBytes,requestGovernor);
  const cache=new Map();
  async function once(key,task){
    const t=clock(),existing=cache.get(key);
    if(existing&&(existing.pending||t-existing.time<300000))return existing.promise;
    for(const [k,v] of cache)if(!v.pending&&(t-v.time>=300000||cache.size>=24))cache.delete(k);
    if(cache.size>=24)return null;
    const slot={time:t,pending:true};
    slot.promise=Promise.resolve().then(task).catch(()=>null).finally(()=>{slot.pending=false;});
    cache.set(key,slot);return slot.promise;
  }
  async function wire(target){return (await send(target,{timeoutMs:6000,processTimeoutMs:7000,maxBytes:400000})).raw;}
  async function fetchSubset(codes,day,scope,total,kind){
    if(!codes.length)return null;
    const key=codes.join(','),wanted=new Set(codes.map(c=>marketCode(c)+c));
    const tx=await once('tx/'+day+'/'+key,async()=>{
      if(fetchBatchQuotes)return fetchBatchQuotes(codes);
      // Native batch mapping is unsuitable for BSE 92xxxx, so bind each vendor
      // response to the exact exchange-prefixed symbol in the original request.
      const raw=await wire('https://qt.gtimg.cn/q='+[...wanted].join(','));
      const now=clock(),rows=[];
      const text=new TextDecoder('gbk').decode(raw);
      for(const r of text.matchAll(/v_((?:sz|sh|bj)\d{6})="([^"]*)";/g)){
        if(!wanted.has(r[1]))continue;
        const f=r[2].split('~'),stamp=f[30]||'',code=r[1].slice(2);
        if(f[2]!==code||!/^\d{14}$/.test(stamp))continue;
        const date=stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8);
        const time=stamp.slice(8).replace(/(\d\d)(\d\d)(\d\d)/,'$1:$2:$3');
        const parts=(f[35]||'').split('/'),amount=parts.length===3?number(parts[2]):NaN;
        rows.push({code,price:number(f[3]),pct:number(f[32]),amount,tradeDate:date,
          quoteAt:Date.parse(date+'T'+time+'+08:00'),receivedAt:now,quoteSource:'tencent'});
      }
      return rows;
    });
    const q=(Array.isArray(tx)?tx:[]).filter(r=>r?.quoteSource==='tencent'&&codeOk(r.code)&&wanted.has(marketCode(r.code)+r.code));
    const first=observed(q,day,TX,scope,total,Math.max(...q.map(r=>r.receivedAt).filter(x=>Number.isSafeInteger(x)&&x<=clock())),kind);
    if(first?.observed===codes.length&&first.amountCny>0)return first;
    const second=await once('sina/'+day+'/'+key,async()=>{
      const raw=await wire('https://hq.sinajs.cn/list='+[...wanted].join(','));
      return parseSina(raw,day,clock(),wanted);
    });
    const alt=observed(second||[],day,SINA,scope,total,Math.max(...(second||[]).map(r=>r.receivedAt)),kind);
    return !first||alt&&(alt.observed>first.observed||alt.observed===first.observed&&alt.amountCny!=null)?alt:first;
  }
  async function breadth(day,state,live){
    const rows=Array.isArray(state.stocks)?state.stocks:[],out=[];
    for(const provider of ['eastmoney','tencent','sina']){
      const eligible=rows.filter(s=>s.quoteSource===provider&&Number.isSafeInteger(s.receivedAt)&&s.receivedAt<=clock());
      if(!eligible.length)continue;
      const basis=observed(eligible,day,'V6 已收录 '+provider+' 逐股行情','V6 行情覆盖样本',new Set(rows.map(r=>r.code).filter(codeOk)).size,
        Math.max(...eligible.map(r=>r.receivedAt)));
      if(basis)out.push(basis);
    }
    if(!live)return {coverage:out};
    const [snap,legu]=await Promise.all([
      once('em/'+day,async()=> (fetchSnapshot||(()=>defaultSnapshot(clock,requestGovernor)))()),
      once('legu/'+day,async()=>leguWidth((await wire(LEGU)).toString('utf8'),day,clock()))
    ]);
    let full;
    if(snap?.scope===SCOPE&&snap.source==='eastmoney-clist-unverified-live'&&Array.isArray(snap.stocks)){
      const t=Date.parse(snap.retrievedAt),n=snap.universeSize;
      if(Number.isSafeInteger(t)&&t<=clock()&&Number.isInteger(n)&&n>=3000&&n<=12000&&snap.stocks.length<=n){
        const points=snap.stocks.map(s=>({code:s.code,price:s.latestPrice,pct:s.pctChange,amount:s.amount,quoteAt:s.vendorQuoteAt,receivedAt:t,
          tradeDate:Number.isSafeInteger(s.vendorQuoteAt)?aShareCalendarDate(s.vendorQuoteAt):null}));
        const c=observed(points,day,EM,SCOPE,n,t);
        if(c){out.push(c);if(c.complete&&new Set(points.map(r=>marketCode(r.code))).size===3)full=c;}
      }
    }
    if(legu)out.push(legu);
    if(!full&&!legu&&!out.some(c=>c.observed>=60)){
      let codes=makeSample(rows.map(r=>r.code)),scope='V6 股票列表抽样';
      if(!codes.length){
        codes=await once('universe/'+day,async()=>{
          const raw=await wire('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=60&sort=symbol&asc=1&node=hs_a');
          const rows=JSON.parse(raw);
          return Array.isArray(rows)?makeSample(rows.slice(0,60).filter(r=>codeOk(r?.code)&&r.symbol===marketCode(r.code)+r.code).map(r=>r.code)):[];
        })||[];
        scope='新浪 A 股代码排序首页样本';
      }
      const subset=await fetchSubset(codes,day,scope,codes.length,'breadth');
      if(subset)out.push(subset);
    }
    return {coverage:out,full};
  }
  async function amount(day,live){
    if(live){
      const main=await once('index/'+day,async()=>indexAmount(await fetchIndex(),day,clock(),'腾讯沪深指数成交额'));
      if(main?.complete)return [main];
      const alt=await once('sina-index/'+day,async()=>{
        const raw=await wire('https://hq.sinajs.cn/list=sh000001,sz399001');
        const rows=parseSina(raw,day,clock(),new Set(Object.keys(INDEXES)));
        return indexAmount(rows,day,clock(),'新浪沪深指数成交额');
      });
      if(alt?.complete)return [alt];
      if(alt||main)return [main,alt].filter(Boolean);
    }
    // The SSE product table is in CNY 100 million. Product 00 includes
    // non-equities and is intentionally ineligible as an equity total.
    const limited=await once('sse/'+day,async()=>{
      const target='https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C&PRODUCT_CODE=01&SEARCH_DATE='+day;
      const json=JSON.parse(await wire(target)),rows=json?.result;
      if(!Array.isArray(rows)||rows.length!==1)return null;
      const r=rows[0],v=number(r.TRADE_AMT);
      if(r.PRODUCT_CODE!=='01'||r.TRADE_DATE!==day.replaceAll('-','')||!(v>0&&v<1e7))return null;
      return {kind:'amount',scope:'上交所股票成交日概况 · 产品 01',day,source:'上海证券交易所',knownAt:clock(),
        amountCny:Math.round(v*1e8),observed:1,total:1,complete:true};
    });
    return limited?[limited]:[];
  }
  function publicReasonPool(day){
    return once('cls-pool/'+day,async()=>{
      const json=JSON.parse(await wire(CLS_LIMIT_POOL_URL));
      return normalizeClsLimitPool(json,{requestedDate:day,receivedAt:clock()});
    });
  }
  async function publicPool(day,sectorName){
    const pool=await publicReasonPool(day);
    return pool?.complete&&pool.status==='available'&&pool.tradeDate===day
      ?rankedPool(pool.items,day,clock(),pool.receivedAt,sectorName):null;
  }
  async function sector(day,state,live,sectorCode,sectorName,provided){
    const validGroup=p=>p?.day===day&&sectorNameOk(p.name)&&(!sectorName||p.name===sectorName)&&Array.isArray(p.members)&&p.members.length<=12000&&
      sectorNameOk(p.source)&&Number.isSafeInteger(p.knownAt)&&p.knownAt>=Date.parse(day+'T15:00:00+08:00')&&p.knownAt<=clock();
    let g=validGroup(provided)?provided:clsCohort(state,day,clock(),sectorName);
    // Cold public replicas may not yet have V6's in-memory sector membership.
    // The native CLS parser dates every item and checks the declared pool total.
    if(!g&&live&&!sectorName)g=await publicPool(day);
    const name=sectorName||g?.name;
    if(!sectorNameOk(name))return {};
    const code=sectorCode||(Array.isArray(state.sectors)?state.sectors.find(s=>s.name===name&&/^BK\d{4}$/.test(s.code))?.code:null);
    const bar=typeof code==='string'&&/^BK\d{4}$/.test(code)?await once('board/'+day+'/'+code+'/'+name,async()=>{
      const target='https://push2his.eastmoney.com/api/qt/stock/kline/get?'+new URLSearchParams({secid:'90.'+code,klt:'101',fqt:'0',
        end:day.replaceAll('-',''),lmt:'1',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59'});
      const raw=fetchSectorBars?await fetchSectorBars({code,name,day}):JSON.parse(await wire(target));
      return boardBar(raw,day,code,name,clock());
    }):null;
    if(bar)return {bar,coverage:sectorCoverage(bar,day)};
    if(live&&!g&&sectorName)g=await publicPool(day,sectorName);
    if(!validGroup(g))return {};
    if(/^cls\d{5}$/.test(g.code)){
      const cls=await once('board/'+day+'/'+g.code+'/'+g.name,async()=>{
        const target='https://x-quote.cls.cn/quote/stock/kline?'+new URLSearchParams({app:'CailianpressWeb',os:'web',sv:'8.4.6',
          secu_code:g.code,type:'d1',limit:'3'});
        const json=JSON.parse(await wire(target));
        return clsBoard(json,day,g,clock());
      });
      if(cls){
        // The public sector reader can choose the identified CLS benchmark.
        // An explicit BK request must never receive a different vendor's index.
        return {bar:sectorCode&&sectorCode!==cls.code?null:cls,coverage:sectorCoverage(cls,day)};
      }
    }
    if(!live)return {};
    const members=[...new Set(g.members.map(r=>typeof r==='string'?r:r?.code).filter(codeOk))];
    if(!members.length)return {};
    const sample=await fetchSubset(makeSample(members),day,name+(/涨停/.test(g.source)?' · 同日涨停池成员样本':' · 同日已核实成员样本'),members.length,'sector');
    if(sample){sample.knownAt=Math.max(g.knownAt,sample.knownAt);sample.source=g.source+' / '+sample.source;}
    return {coverage:sample};
  }
  return async function read({day,latestClosedDay,state={},needBreadth=true,needAmount=true,includeDistribution=false,sectorCode,sectorName,sectorMembers}={}){
    const result={market:{},sector:null,coverage:[],fieldSources:{},sources:[],evidence:[],missing:[],knownAt:null};
    if(!hasClose(day,clock())){result.missing.push('已收盘交易日');return result;}
    const live=latestClosedDay===day;
    const [br,am,se,distribution]=await Promise.all([
      needBreadth?breadth(day,state,live):null,needAmount?amount(day,live):[],sector(day,state,live,sectorCode,sectorName,sectorMembers),
      includeDistribution?once('distribution/'+day,async()=>marketDistribution((await wire('https://www.dabanke.com/index-'+day.replaceAll('-','')+'.html')).toString('utf8'),day,clock())):null
    ]);
    result.coverage.push(...(br?.coverage||[]),...am,...(se.coverage?[se.coverage]:[]));
    if(distribution)result.coverage.push(distribution);
    if(includeDistribution&&live){
      const pool=await publicReasonPool(day);
      result.closeReasons=(pool?.items||[]).filter(r=>r.reasonDateStatus==='matched'&&r.reasonTradeDate===day&&r.reason)
        .map(r=>({code:r.code,text:r.reason,source:'财联社',day}));
    }
    if(br?.full){
      for(const key of ['adv','dec']){
        result.market[key]=br.full[key];result.fieldSources[key]={source:br.full.source,scope:br.full.scope,knownAt:br.full.knownAt};
      }
    }else if(needBreadth)result.missing.push('沪深京全量同日收盘宽度');
    const exchanges=am.find(c=>c.scope==='沪深两市成交额'&&c.complete);
    if(exchanges){
      result.market.amount=exchanges.amountCny/1e8;
      result.fieldSources.amount={source:exchanges.source+'（沪深两市）',scope:exchanges.scope,knownAt:exchanges.knownAt};
    }else if(needAmount)result.missing.push('沪深两市同日成交额');
    result.sector=se.bar||null;
    if(sectorName&&!se.bar)result.missing.push(sectorName+' 板块指数原始日K');
    result.knownAt=result.coverage.length?Math.max(...result.coverage.map(r=>r.knownAt)):null;
    result.evidence=result.coverage.map(r=>r.source+' · '+r.scope+' · '+r.observed+'/'+r.total);
    result.sources=result.coverage.map(r=>({name:r.source,status:'available'}));
    return result;
  };
}
module.exports={createBreadthFallback,marketDistribution};
