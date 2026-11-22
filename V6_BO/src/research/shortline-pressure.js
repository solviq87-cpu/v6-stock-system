'use strict';
const {createHash}=require('node:crypto');
const {requestResearchBytes,createResearchRequest}=require('../core/research-curl-bytes');
const {validTradingDate}=require('../strategy/cached-kline-adapter');
const {linkIssuerEvents}=require('../strategy/issuer-event-linkage');

const DAY=86400000,MAX_BYTES=1024*1024,GROUP=12;
const reports={
  notices:'公告目录',reduction:'董监高持股变化',unlock:'限售解禁计划',goodwill:'财报商誉'
};
const datacenter='https://datacenter-web.eastmoney.com/api/data/v1/get';
const notices='https://np-anotice-stock.eastmoney.com/api/security/ann';
const finite=Number.isFinite, codeOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const dayOf=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const plus=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const at=x=>{
  if(Number.isSafeInteger(x)&&x>0)return x;
  if(typeof x!=='string'||!validTradingDate(x.slice(0,10)))return NaN;
  if(x.length===10)return Date.parse(x+'T00:00:00+08:00');
  const s=x.replace(' ','T').replace(/(T\d\d:\d\d:\d\d):(\d{3})$/,'$1.$2');
  if(!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)?$/.test(s))return NaN;
  return Date.parse(/Z|[+-]\d\d:\d\d$/.test(s)?s:s+'+08:00');
};
const stamp=(v,cut)=>{const t=at(v);return finite(t)&&t>0&&t<=cut?t:null;};
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
const name=s=>typeof s==='string'&&s.trim().length>0&&s.length<=180&&!/[<>\x00-\x1f]/.test(s)?s.trim():null;
const keywords={减持:/减持/,问询:/问询函|问询回复|问询事项/,监管:/监管函|监管工作函|重点监控|监管措施|立案调查|行政处罚|纪律处分/,解禁:/解除限售|解禁|限售股.*上市流通/,商誉:/商誉/};
const typedLetters={'交易所问询函':'问询','问询函':'问询','交易所监管函':'监管','监管函':'监管'};
function makeUrls(kind,codes,day){
  const list=codes.map(c=>'"'+c+'"').join(',');
  const filter='(SECURITY_CODE in ('+list+'))';
  const q=kind==='notices'?{sr:'-1',page_size:'100',page_index:'1',ann_type:'A',client_source:'web',f_node:'0',s_node:'0',
    stock_list:codes.join(','),begin_time:plus(day,-30),end_time:day}:
    {source:'WEB',client:'WEB',pageSize:'120',pageNumber:'1',columns:'ALL',sortTypes:'-1',...({
      reduction:{reportName:'RPT_EXECUTIVE_HOLD_DETAILS',sortColumns:'CHANGE_DATE',filter:filter+"(CHANGE_SHARES<0)(CHANGE_DATE>='"+plus(day,-30)+"')(CHANGE_DATE<='"+day+"')"},
      unlock:{reportName:'RPT_LIFT_STAGE',sortColumns:'FREE_DATE',filter:filter+"(FREE_DATE>='"+day+"')(FREE_DATE<='"+plus(day,30)+"')"},
      goodwill:{reportName:'RPT_GOODWILL_STOCKDETAILS',sortColumns:'REPORT_DATE',filter:filter+"(NOTICE_DATE<='"+day+"')(REPORT_DATE>='"+plus(day,-400)+"')"}
    })[kind]};
  return (kind==='notices'?notices:datacenter)+'?'+new URLSearchParams(q);
}
function categoryRows(code,row,title,source,url,publishedAt,knownAt,id){
  return Object.entries(keywords).filter(([,regex])=>regex.test(title)).map(([category])=>({
    id:id+'/'+category,code,category,title,source,url,knownAt,publishedAt,eventDay:dayOf(publishedAt),verified:false
  }));
}
function doc(code,row,day,knownAt){
  const title=name(row.title),id=row.art_code,stated=stamp(row.notice_date,knownAt);
  const published=row.display_time?stamp(row.display_time,knownAt):stated;
  if(!title||!/^AN\d{10,30}$/.test(id)||!stated||!published||dayOf(stated)>day||dayOf(stated)<plus(day,-30)||
      dayOf(published)>day||!Array.isArray(row.codes)||!row.codes.some(v=>v.stock_code===code))return {clues:[],facts:[]};
  const source='东方财富公告目录',url='https://data.eastmoney.com/notices/detail/'+code+'/'+id+'.html';
  const clues=categoryRows(code,row,title,source,url,published,knownAt,id),facts=[];
  // A document's structured type confirms only the existence of that dated
  // letter. A company's reply, retraction or correction is not a new issuance.
  const types=(row.columns||[]).map(c=>c?.column_name).filter(t=>Object.hasOwn(typedLetters,t));
  if(types.length&&row.codes.length===1&&!/回复|撤回|撤销|澄清|更正|无[监管问询]|未收到/.test(title)){
    for(const type of new Set(types)){
      const category=typedLetters[type];
      facts.push({id:'type/'+id+'/'+category,code,category,description:'公告目录披露文件，原文类别「'+type+'」',source,url,verified:true,
        eventDay:dayOf(stated),publishedAt:published,knownAt,expires:plus(dayOf(stated),30),riskTag:category+'函披露'});
    }
  }
  return {clues,facts};
}
function financial(code,rows,day,knownAt){
  const eligible=[];
  for(const r of rows){
    const period=stamp(r.REPORT_DATE,knownAt),published=stamp(r.NOTICE_DATE,knownAt);
    if(!period||!published||period>published||dayOf(period)<plus(day,-400)||dayOf(published)>day||
       !finite(r.GOODWILL)||r.GOODWILL<0||!finite(r.SUMSHEQUITY)||r.SUMSHEQUITY<=0)continue;
    const ratio=100*r.GOODWILL/r.SUMSHEQUITY;
    if(!finite(ratio)||!finite(r.SUMSHEQUITY_RATIO)||Math.abs(r.SUMSHEQUITY_RATIO-ratio/100)>1e-5)continue;
    eligible.push({period,published,ratio,r});
  }
  eligible.sort((a,b)=>b.period-a.period||b.published-a.published);
  const first=eligible[0];if(!first)return [];
  if(eligible.some(x=>x.period===first.period&&x.published===first.published&&x.ratio!==first.ratio))return [];
  const p=dayOf(first.period),value=Math.round(first.ratio*100)/100;
  return [{id:'goodwill/'+code,code,category:'商誉',description:'财报商誉 '+first.r.GOODWILL+' 元，占净资产 '+value+'%',source:'东方财富财报商誉明细',
    url:'https://data.eastmoney.com/sy/list.html',eventDay:p,publishedAt:first.published,knownAt,verified:true,expires:plus(p,400),
    value,unit:'%净资产',riskTag:first.ratio>=30?'高商誉（≥30%净资产）':''}];
}
function lift(code,r,day,knownAt){
  const date=String(r.FREE_DATE||'').slice(0,10),update=stamp(r.EUTIME,knownAt),shares=r.ABLE_FREE_SHARES;
  if(!validTradingDate(date)||!finite(at(r.FREE_DATE))||date<day||date>plus(day,30)||!update||dayOf(update)>day||
    !finite(shares)||shares<=0||!name(r.FREE_SHARES_TYPE))return null;
  return {id:'unlock/'+code+'/'+date+'/'+r.FREE_SHARES_TYPE,code,category:'解禁',description:date+' 计划可解禁 '+shares+' 万股（'+r.FREE_SHARES_TYPE+'）',
    source:'东方财富限售解禁计划表',url:'https://data.eastmoney.com/dxf/q/'+code+'.html',eventDay:date,sourceUpdatedAt:update,knownAt,verified:true,
    value:shares,unit:'万股',expires:date,riskTag:'已列入解禁日程',factorCode:'GG-05'};
}
function reduceHolding(code,r,day,knownAt){
  const event=stamp(r.CHANGE_DATE,knownAt),who=name(r.PERSON_NAME);
  if(!who||!event||dayOf(event)>day||dayOf(event)<plus(day,-30)||r.HOLD_TYPE!=='A股'||!Number.isSafeInteger(r.CHANGE_SHARES)||r.CHANGE_SHARES>=0)return null;
  const qty=-r.CHANGE_SHARES,d=dayOf(event);
  return {id:'holding/'+code+'/'+digest([d,who,r.CHANGE_SHARES,r.CHANGE_AFTER_HOLDNUM,r.POSITION_NAME].join('/')),code,category:'减持',
    description:who+' 的A股持股变动记录减少 '+qty+' 股'+(name(r.CHANGE_REASON)?'（'+r.CHANGE_REASON+'）':''),
    source:'东方财富董监高及关联人员持股变动表',url:'https://data.eastmoney.com/executive/'+code+'.html',eventDay:d,knownAt,verified:true,
    value:qty,unit:'股',expires:plus(d,30),riskTag:'董监高关联持股减少',factorCode:r.CHANGE_REASON==='二级市场买卖'?'GG-01':''};
}
function project(kind,code,rows,day,knownAt){
  const ex=rows.filter(r=>r&&r.SECURITY_CODE===code),clues=[],facts=[];
  if(kind==='notices')for(const row of rows){
    if(!row)continue;
    const out=doc(code,row,day,knownAt);clues.push(...out.clues);facts.push(...out.facts);
  }
  if(kind==='goodwill')facts.push(...financial(code,ex,day,knownAt));
  if(kind==='unlock'||kind==='reduction')for(const row of ex){
    const val=(kind==='unlock'?lift:reduceHolding)(code,row,day,knownAt);if(val)facts.push(val);
  }
  return {facts,clues};
}
function existingNotices(stock,code,day,cut){
  const rows=(stock.announcements||[]).filter(a=>a?.code===code&&stamp(a.knownAt??a.receivedAt,cut)&&stamp(a.publishedAt,cut)&&
    at(a.publishedAt)<=at(a.knownAt??a.receivedAt)&&dayOf(at(a.publishedAt))<=day);
  const linked=linkIssuerEvents({symbol:code,announcements:rows,now:cut,maxAgeDays:30});
  return linked.events.flatMap(e=>{
    const matches=rows.filter(a=>a.url===e.url&&a.title===e.title);
    const received=Math.min(...matches.map(a=>at(a.knownAt??a.receivedAt)));
    return finite(received)?categoryRows(code,e,e.title,e.source,e.url,at(e.publishedAt),received,e.id):[];
  });
}
function createShortlinePressureReader({pool=()=>[],now=Date.now,fetchImpl,requestJson=requestResearchBytes,requestGovernor}={}){
  const request=createResearchRequest(requestJson,requestResearchBytes,requestGovernor);
  const cache=new Map();
  async function get(url){
    if(fetchImpl){
      const r=await fetchImpl(url,{signal:AbortSignal.timeout(4500),redirect:'error'});
      if(!r.ok||Number(r.headers?.get('content-length')||0)>MAX_BYTES)throw Error('数据源不可用');
      const bytes=await r.arrayBuffer();
      if(bytes.byteLength>MAX_BYTES)throw Error('响应过大');
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    }
    const {raw}=await request(url,{timeoutMs:4000,processTimeoutMs:4500,maxBytes:MAX_BYTES});
    return JSON.parse(raw.toString('utf8'));
  }
  async function load(codes,day){
    const entries=[];
    for(const [kind,label] of Object.entries(reports)){
      try{
        const pages=[],url=makeUrls(kind,codes,day);
        let truncated=false,expectedCount=null;
        for(let i=1;i<=2;i++){
          const loc=new URL(url);loc.searchParams.set(kind==='notices'?'page_index':'pageNumber',String(i));
          const d=await get(loc.href),knownAt=now(),n=kind==='notices',data=n?d.data?.list:d.result?.data;
          // Eastmoney explicitly reports "no relevant data" with code 9201.
          if(!n&&d.code===9201&&d.result==null&&i===1)break;
          const total=n?d.data?.total_hits:d.result?.count,limit=n?100:120;
          if(!Array.isArray(data)||data.length>limit||!Number.isSafeInteger(total)||total<0||total<data.length||(!n&&d.success!==true)||
             expectedCount!=null&&expectedCount!==total||data.length!==Math.min(limit,total-(i-1)*limit))throw Error('响应格式或分页不完整');
          expectedCount=total;pages.push({data,knownAt});
          truncated=total>limit*i;if(!truncated)break;
        }
        entries.push({kind,label,pages,status:truncated?'仅前两页':'已检索',knownAt:now()});
      }catch{entries.push({kind,label,pages:[],status:'未取得',knownAt:now()});}
    }
    return entries;
  }
  async function shared(codes,day){
    const key=day+'/'+codes.join(','),stamp=now(),old=cache.get(key);
    if(old&&(old.pending||old.until>stamp))return old.task;
    for(const [k,val] of cache)if(!val.pending&&(val.until<=stamp||cache.size>=32))cache.delete(k);
    if(cache.size>=32)return [];
    const entry={pending:true,until:0};
    entry.task=load(codes,day).then(data=>{
      entry.until=now()+(data.some(r=>r.status==='未取得')?15:60)*60000;
      return data;
    }).finally(()=>{entry.pending=false;});
    cache.set(key,entry);return entry.task;
  }
  return async function read({code,day,bars=[],stock={},asOf,recentClose=false}={}){
    if(!codeOK(code)||!validTradingDate(day))throw Error('压力扫描代码或日期无效');
    const start=now(),explicit=asOf!=null?at(asOf):start;
    if(!finite(explicit)||explicit>start)throw Error('压力扫描截止时间无效');
    const readLive=asOf==null&&start>=at(day+' 15:00')&&(dayOf(start)===day||recentClose===true&&day<dayOf(start));
    let all=[];
    if(readLive){
      const codes=[...new Set([...(await pool()||[]).map(v=>typeof v==='string'?v:v?.code).filter(codeOK),code])].sort();
      const group=Math.floor(codes.indexOf(code)/GROUP)*GROUP;
      all=await shared(codes.slice(group,group+GROUP),day);
    }
    const cutoff=readLive?now():explicit;
    const clues=existingNotices(stock,code,day,cutoff),facts=[],coverage=[];
    for(const r of all){
      coverage.push({id:r.kind,code,label:r.label,status:r.status,knownAt:r.knownAt});
      // Resolve financial statements across the entire capped response, so only
      // the latest eligible period for this issuer contributes a risk tag.
      if(r.kind==='goodwill'&&r.pages.length){
        const pages=r.pages,rows=pages.flatMap(p=>p.data);
        const f=project(r.kind,code,rows,day,Math.max(...pages.map(p=>p.knownAt))).facts;
        facts.push(...f);continue;
      }
      for(const p of r.pages){
        const out=project(r.kind,code,p.data,day,p.knownAt);clues.push(...out.clues);facts.push(...out.facts);
      }
    }
    const {chipHistory}=await import('../../public/nova/shortline/pressure.mjs');
    const chipSeries=chipHistory(bars,code,day,cutoff);
    const unique=rows=>[...new Map(rows.map(r=>[r.id,r])).values()];
    return {code,day,name:name(stock.name)||code,knownAt:cutoff,clues:unique(clues),facts:unique(facts),coverage,chipSeries,
      factorCodes:[...new Set(facts.map(f=>f.factorCode).filter(Boolean))],researchOnly:true};
  };
}
module.exports={createShortlinePressureReader};
