// Bounded original-text clues only. No security-master or trading qualification.
export function projectSecurityIdentity(e,{active=true}={}){
  const flags={sourceVerified:false,canQualify:false,canTrade:false,canTrain:false,canNotify:false};
  const labels={'ordinary-a-share':'普通股A股','preferred-share':'优先股',etf:'ETF基金','convertible-bond':'可转换债券'};
  const unknown=()=>({status:'unknown',rows:[],note:'原文范围或证券关联无效',...flags});
  if(!e||typeof e.body!=='string'||e.body.length>50000||!Array.isArray(e.securities)||e.securities.length>100||
    Array.from(e.securities,(c,i)=>!Object.hasOwn(e.securities,i)||typeof c!=='string'||!/^\d{6}$/.test(c)).some(Boolean)||new Set(e.securities).size!==e.securities.length)return unknown();
  if(e.title!=null&&(typeof e.title!=='string'||e.title.length>1000))return unknown();
  const body=e.body,title=typeof e.title==='string'?e.title:'',claims=new Map();
  const add=(symbol,type,quote)=>{
    if(!e.securities.includes(symbol))return;
    if(!claims.has(symbol))claims.set(symbol,[]);
    claims.get(symbol).push({type,quote:quote.trim().slice(0,240)});
  };
  // A type on one row cannot be assigned to other codes in the same document.
  if(/股票种类[ \t]+股票上市交易所[^\n]{0,200}股票代码/.test(body)){
    for(const match of body.matchAll(/^(普通股[ \t]*A[ \t]*股|优先股)[ \t]{2,}[^\n]{0,180}?[ \t]{2,}(\d{6})(?:[ \t]{2,}|$)/gm)){
      const end=body.indexOf('\n',match.index),line=body.slice(match.index,end<0?body.length:end);
      const codes=[...line.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map(m=>m[1]);
      if(codes.length===1)add(match[2],match[1].startsWith('普通股')?'ordinary-a-share':'preferred-share',line);
    }
  }
  for(const match of body.matchAll(/^[ \t]*(优先股代码|转债代码|可转换公司债券代码)[：:][ \t]*([^\n]{1,100}(?:\n[ \t]*\d{6}[ \t]*){0,3})/gm)){
    const value=match[2].split(/(?:优先股简称|转债简称|证券简称|公告编号)[：:]/,1)[0];
    const tokens=value.trim().split(/[\s、,，;；]+/);
    if(tokens.length&&tokens.length<=10&&tokens.every(c=>/^\d{6}$/.test(c)))
      for(const code of tokens)add(code,match[1]==='优先股代码'?'preferred-share':'convertible-bond',match[0]);
  }
  const fundDocument=/交易型开放式指数证券投资基金/.test(title.replace(/\s/g,''))&&
    /交易型开放式指数证券投资基金/.test(body.slice(0,2000).replace(/\s/g,''));
  const funds=[...new Set([...body.matchAll(/基金(?:主)?代码[：:]?[ \t]*(\d{6})(?!\d)/g)].map(m=>m[1]))];
  if(fundDocument&&funds.length===1)add(funds[0],'etf',title+'\n'+body.match(/[^\n]*基金(?:主)?代码[^\n]*/)?.[0]);
  const ambiguousFund=fundDocument&&funds.length>1;
  const review=/传闻|谣言|澄清|否认|撤回|更正/.test(title);
  const rows=e.securities.map(symbol=>{
    const found=claims.get(symbol)||[],types=[...new Set(found.map(x=>x.type))];
    const conflict=types.length>1||ambiguousFund&&funds.includes(symbol);
    const type=types.length===1&&!conflict?types[0]:null;
    return {symbol,type,label:conflict?'类型冲突，待核对':type?labels[type]:'未从该文档绑定类型',
      status:!active?'inactive':conflict?'conflict':review?'manual-review':type?'source-claim':'unknown',
      quotes:[...new Set(found.map(x=>x.quote))].slice(0,3)};
  });
  return {status:!active?'inactive':rows.some(x=>x.type)?'source-mentions':'unknown',rows,
    note:'仅该版本的原文类型字样；未核实交易所、板块、生效区间或交易资格。摘要/节选须核对完整原文。',...flags};
}

// Read-only, point-in-time view of existing news journal receipts. No trade or notification API.
export function projectNewsEvents(rows,asOf,now=Date.now(),{currentView=false}={}){
  const validTime=(v)=>Number.isSafeInteger(v)&&v>0&&v<=now;
  const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
  if(!validTime(asOf)||!Array.isArray(rows)||rows.length>200)return {status:'unknown',rows:[],missing:['截点或新闻证据范围无效'],canTrade:false};
  const seen=new Map(),conflicted=new Set();let excluded=0;
  for(const row of rows){
    const e=row?.evidence;
    if(!e||!hash(row.eventHash)||!Number.isSafeInteger(row.sequence)||row.sequence<1||
      typeof e.source!=='string'||!e.source||typeof e.eventId!=='string'||!e.eventId||
      !['original','revised','retracted'].includes(e.kind)||!validTime(e.receivedAt)||!validTime(row.recordedAt)||
      row.recordedAt<e.receivedAt||row.recordedAt>asOf||
      [e.publishedAt,e.revisedAt].some(v=>v!=null&&(!validTime(v)||v>e.receivedAt))||
      !Array.isArray(e.securities)||e.securities.some(s=>typeof s!=='string'||!/^\d{6}$/.test(s))){
      excluded++;continue;
    }
    const key=JSON.stringify([e.source,e.eventId]);
    if(!seen.has(key))seen.set(key,new Map());
    const versions=seen.get(key);
    if(versions.has(row.sequence)){conflicted.add(key);continue;}
    versions.set(row.sequence,row);
  }
  const projected=[];
  for(const [key,versions] of seen){
    if(conflicted.has(key)){excluded+=versions.size;continue;}
    const chain=[...versions.values()].sort((a,b)=>a.sequence-b.sequence);
    const row=chain.at(-1),e=row.evidence;
    // A returned page is a bounded archive slice, not a complete event history.
    const chainComplete=chain[0].evidence.kind==='original'&&chain[0].evidence.supersedes===null&&
      chain.slice(1).every((v,i)=>v.evidence.kind!=='original'&&chain[i].evidence.kind!=='retracted'&&
        v.evidence.supersedes===chain[i].eventHash&&v.recordedAt>=chain[i].recordedAt&&v.evidence.publishedAt===chain[i].evidence.publishedAt);
    const body=typeof e.body==='string'?e.body:'',title=typeof e.title==='string'?e.title:'';
    const clueText=title+'\n'+body;
    const clues=[
      ['否认线索',/不属实|并无此事|否认|澄清|不存在上述/],
      ['传闻线索',/传闻|网传|据传|市场消息|未经证实/],
      ['披露字样（未核实）',/公告|正式披露|董事会决议|交易所披露/],
      ['进展字样',/已完成|已签署|正在推进|终止|延期|变更|修订/],
      ['事件类型线索',/重大合同|订单|中标|并购|重组|回购|减持|增持|业绩预告|立案|处罚|停牌|复牌|分红/]
    ].flatMap(([label,re])=>{const match=clueText.match(re);return match?[{label,quote:match[0]}]:[];});
    const amounts=[...body.matchAll(/[+-]?\d+(?:\.\d+)?\s*(?:亿元|万元|元|万股|亿股|%|％)/g)].slice(0,8).map(m=>m[0]);
    const officialHosts=new Set(['cninfo.com.cn','www.cninfo.com.cn','sse.com.cn','www.sse.com.cn','szse.cn','www.szse.cn','bse.cn','www.bse.cn']);
    let originalHost='';try{originalHost=new URL(e.url).hostname;}catch{}
    const disclosure=officialHosts.has(originalHost)&&e.bodyScope==='declared-body'?'正式披露来源声明（未独立核实）':'未独立核实';
    const declaredDates=e.bodyScope==='declared-body'?[...body.matchAll(/(?:自\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:起)?(?:生效|实施|执行)|(?:生效日期|生效日|实施日期)[：:]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日)/g)].map(m=>{const d=(m[1]||m[4])+'-'+(m[2]||m[5]).padStart(2,'0')+'-'+(m[3]||m[6]).padStart(2,'0');return Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?{date:d,quote:m[0]}:null;}).filter(Boolean):[];
    const effective=new Set(declaredDates.map(d=>d.date)).size===1?declaredDates[0]:null;
    const missing=['独立正式披露核验、主体名称及行业归属待核对','金额与有效时间必须由原文语境核验，不能由关键词认定','持仓、冻结计划及交易状态未接入本新闻投影'];
    if(!chainComplete)missing.push('返回范围内缺少完整修订链');
    if(row.current===false)missing.push('此版本在服务器所选截点已被后续版本替代；不能作为该截点的新催化');
    if(row.associated===false)missing.push('该截点的最新修订已移除此证券关联');
    if(!e.publishedAt)missing.push('原始发布时间未知');
    if(!body||e.bodyScope==='provider-summary')missing.push('完整原文待核对');
    projected.push({row,versions:chain,knownAt:row.recordedAt,subjects:[...e.securities],clues,amounts,
      securityIdentity:projectSecurityIdentity(e,{active:chainComplete&&row.current!==false&&row.associated!==false&&e.kind!=='retracted'}),
      effectiveAt:null,effectiveDate:effective?.date??null,effectiveQuote:effective?.quote??null,formalDisclosure:disclosure,chainComplete,missing,
      revisionStatus:row.current===false?'已被后续版本替代':row.associated===false?'证券关联已移除':e.kind==='retracted'?'已撤稿':e.kind==='revised'?'已修订':'原始记录',
      researchOnly:true,canTrade:false,canNotify:false});
  }
  return {status:'bounded-evidence',rows:projected.sort((a,b)=>b.row.sequence-a.row.sequence),excluded,
    missing:['仅使用本次返回的档案版本；不代表全部新闻或完整历史'],canTrade:false};
}
