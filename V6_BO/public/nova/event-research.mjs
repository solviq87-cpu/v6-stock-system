// Bounded original-text clues only. No security-master or trading qualification.
export function projectSecurityIdentity(e,{active=true,inactiveReasons=[]}={}){
  const flags={sourceVerified:false,canQualify:false,canTrade:false,canTrain:false,canNotify:false};
  const labels={'ordinary-a-share':'普通股A股','preferred-share':'优先股',etf:'ETF基金','convertible-bond':'可转换债券'};
  const reasonLabels={superseded:'该截点已被后续版本替代','association-removed':'本次查询的证券关联已移除',retracted:'来源已撤稿','incomplete-chain':'本页修订链不完整，待核对',unconfirmed:'使用条件未确认，待核对'};
  const codes=active?[]:[...new Set((Array.isArray(inactiveReasons)?inactiveReasons.slice(0,8):[]).filter(c=>typeof c==='string'&&Object.hasOwn(reasonLabels,c)))];
  if(!active&&!codes.length)codes.push('unconfirmed');
  const reasons=codes.map(code=>({code,label:reasonLabels[code]}));
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
    return {symbol,type,typeConflict:conflict,label:conflict?'类型冲突，待核对':type?labels[type]:'未从该文档绑定类型',
      status:!active?'inactive':conflict?'conflict':review?'manual-review':type?'source-claim':'unknown',
      quotes:[...new Set(found.map(x=>x.quote))].slice(0,3)};
  });
  return {status:!active?'inactive':rows.some(x=>x.type)?'source-mentions':'unknown',rows,inactiveReasons:reasons,
    note:'仅该版本的原文类型字样；未核实交易所、板块、生效区间或交易资格。摘要/节选须核对完整原文。',...flags};
}

// A calendar of source statements, not an index master or a fund-flow estimate.
// Keep this inside the existing offline module: evidence reads need no new asset or service.
function projectIndexAdjustment(e,asOf,inactiveReasons){
  if(typeof e.body!=='string'||e.body.length>50000||typeof e.title!=='string'||e.title.length>1000)return null;
  const text=e.title+'\n'+e.body;
  if(!/指数[^\n。]{0,20}(?:样本|成分)[^\n。]{0,12}调整/.test(text))return null;
  const date=(y,m,d)=>{
    const value=y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0');
    return Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
  };
  const dates=[...e.body.matchAll(/(?:于|自)\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(收市后|起)?\s*(?:生效|实施)/g)]
    .map(m=>({date:date(m[1],m[2],m[3]),phase:m[4]==='收市后'?'after-close':'date-only',quote:m[0]}));
  const unique=new Set(dates.map(x=>x.date+'|'+x.phase));
  const declared=dates.length&&dates.every(x=>x.date)&&unique.size===1?dates[0]:null;
  const announced=[...e.body.matchAll(/公告日期[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/g)].map(m=>date(m[1],m[2],m[3]));
  const announcementDate=announced.length&&announced.every(Boolean)&&new Set(announced).size===1?announced[0]:null;
  const review=/澄清|否认|不属实|取消|延期|暂停|撤销|撤回/.test(text);
  const day=new Date(asOf+8*3600000).toISOString().slice(0,10);
  const status=inactiveReasons.length?'inactive':review?'manual-review':!declared?'unknown-date':
    declared.date>day?'future-date':declared.date===day?'date-reached-unverified':'date-passed-unverified';
  const lines=e.body.split(/\r?\n/),headings=[];
  for(let i=0;i<lines.length;i++){
    const m=lines[i].trim().match(/^([\p{Script=Han}A-Za-z0-9 \t]{1,50}指数)\s*(?:样本|成分)调整名单[：:]$/u);
    if(m)headings.push({indexName:m[1].replace(/\s/g,''),line:i});
  }
  const tables=[];
  // Unsupported layouts remain raw evidence. Never guess direction or propagate a table.
  for(let h=0;h<Math.min(headings.length,20);h++){
    const heading=headings[h],block=lines.slice(heading.line+1,headings[h+1]?.line??lines.length).map(s=>s.trim()).filter(Boolean);
    const removals=[],additions=[],seen=new Set();
    let valid=headings.filter(x=>x.indexName===heading.indexName).length===1&&
      block[0]?.replace(/\s/g,'')==='调出名单调入名单'&&block[1]?.replace(/\s/g,'')==='证券代码证券名称证券代码证券名称'&&
      block.length>=3&&block.length<=102&&Array.isArray(e.securities)&&e.securities.length<=100;
    for(const line of valid?block.slice(2):[]){
      const cells=line.split(/\s{2,}|\t+/);
      if(cells.length!==4||![cells[0],cells[2]].every(c=>/^\d{6}$/.test(c)&&e.securities.includes(c)&&!seen.has(c))||
        cells[0]===cells[2]||![cells[1],cells[3]].every(n=>/^[\p{Script=Han}A-Za-z0-9*（）()·\-]{1,40}$/u.test(n))){valid=false;break;}
      seen.add(cells[0]);seen.add(cells[2]);
      removals.push({symbol:cells[0],name:cells[1]});additions.push({symbol:cells[2],name:cells[3]});
    }
    tables.push({indexName:heading.indexName,status:valid?'source-excerpt':'unknown',
      removals:valid?removals:[],additions:valid?additions:[],fullListVerified:false});
  }
  return {status,announcementDate,plannedDate:declared?.date??null,phase:declared?.phase??null,quote:declared?.quote??null,
    effectiveAt:null,tables,inactiveReasons:[...inactiveReasons],implementationConfirmed:false,actualFlow:null,weights:null,trackingAssets:null,
    note:'仅本页已归档材料中的调样计划与名单节选；日期到达不代表实施完成。权重、跟踪规模、实际配置和成交未知。',
    sourceVerified:false,canQualify:false,canTrade:false,canTrain:false,canNotify:false};
}

// Keep financial statements in their declared basis. Never sum cumulative disclosures,
// infer an execution from a plan, or write issuer disclosures into an account ledger.
function projectCapitalActivity(e,asOf,inactiveReasons){
  if(typeof e.body!=='string'||e.body.length>50000||typeof e.title!=='string'||e.title.length>1000)return null;
  const text=e.title+'\n'+e.body;
  const moneyMarket=/逆回购|正回购|债券回购|质押式回购|回购利率/.test(text);
  const shareBuyback=/股份回购|股票回购|回购(?:公司|本公司)?(?:股份|股票|A股|B股)/.test(text);
  const actions=[['buyback',/回购/],['increase',/增持/],['disposal',/减持/],['unlock',/解禁/]]
    .filter(([action,re])=>re.test(text)&&(action!=='buyback'||!moneyMarket||shareBuyback));
  if(!actions.length)return null;
  const flags={independentlyVerified:false,canQualify:false,canTrade:false,canTrain:false,canNotify:false};
  const symbols=Array.isArray(e.securities)?e.securities:[];
  const codes=[...new Set([...e.body.matchAll(/证券代码[：:][ \t]*(\d{6})(?!\d)/g)].map(m=>m[1]))];
  const bound=symbols.length===1&&/^\d{6}$/.test(symbols[0])&&codes.length===1&&codes[0]===symbols[0]&&actions.length===1;
  const declaredDates=[...e.body.matchAll(/截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)].map(m=>{
    const date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    return Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;
  });
  const today=new Date(asOf+8*3600000).toISOString().slice(0,10);
  const badDates=declaredDates.some(d=>!d||d>today)||new Set(declaredDates).size>1;
  const reportedThrough=declaredDates.length&&!badDates?declaredDates[0]:null;
  const noun={buyback:'回购',increase:'增持',disposal:'减持',unlock:'解禁'}[actions[0][0]];
  const completed=bound&&new RegExp(noun+'(?:股份)?(?:计划|方案)?(?:已实施完毕|已完成)|已完成本次'+noun).test(text);
  const unfinished=bound&&new RegExp(noun+'(?:股份)?(?:计划|方案)?(?:尚未|未)实施完毕').test(text);
  const sourceCompletion=completed&&unfinished?'conflict':unfinished?'in-progress':completed?'completed':'unknown';
  const review=badDates||sourceCompletion==='conflict'||/澄清|否认|不属实/.test(text)||/取消|终止|撤销/.test(e.title);
  const status=inactiveReasons.length?'inactive':!bound?'ambiguous-subject':review?'manual-review':'source-claims';
  const allLines=[...new Set(e.body.split(/[。\n]+/).map(s=>s.trim()).filter(Boolean))],lines=allLines.slice(0,100),rows=[];
  let truncated=allLines.length>100;
  for(const [lineIndex,quote] of bound?lines.entries():[]){
    if(quote.length>1600){truncated=true;continue;}
    if(/逆回购|正回购|质押式回购|回购利率|国债|债券|基金份额|再贷款/.test(quote))continue;
    const quantities=[];
    for(const m of quote.matchAll(/(?<![\d.,+\-])((?:\d{1,3}(?:,\d{3})+|0|[1-9]\d*)(?:\.\d+)?)(?![\d.,])\s*(万港元|亿港元|港元\/股|元\/股|亿元|万元|港元|元|亿股|万股|股|%|％|个月)/g)){
      if(m[1].length>24)continue;
      const unit=m[2],money=/元/.test(unit),measure=unit.endsWith('/股')?'price':money?'money':unit.endsWith('股')?'shares':unit==='个月'?'duration':'ratio';
      const prefix=quote.slice(Math.max(0,m.index-12),m.index).replace(/\s/g,'');
      const bound=/(?:不低于|不少于|下限)[：:]?(?:为)?(?:人民币)?$/.test(prefix)?'lower':/(?:不超过|不高于|至多|上限)[：:]?(?:为)?(?:人民币)?$/.test(prefix)?'upper':null;
      quantities.push({text:m[1],unit,measure,bound,currency:/港元/.test(unit)?'HKD':money&&/人民币$/.test(prefix)?'CNY':null});
      if(quantities.length>8){truncated=true;break;}
    }
    if(!quantities.length)continue;
    const plan=/计划|拟|上限|下限|不少于|不低于|不超过|额度|意向/.test(quote),cumulative=/累计/.test(quote),period=/本月|本期|当期|报告期内/.test(quote);
    const negative=/(?:尚未|暂未|未)(?:实施|进行|发生|回购|增持|减持|解禁)(?!完毕)/.test(quote);
    const reported=/已通过|已回购|已增持|已减持|已解禁/.test(quote);
    const role=quantities.length>8?'mixed-or-unknown':negative?'not-executed':Number(plan)+Number(cumulative)+Number(period)>1?'mixed-or-unknown':plan?'plan':cumulative?'cumulative':period?'period':reported?'reported':'mixed-or-unknown';
    rows.push({role,quote,quantities:role==='mixed-or-unknown'?[]:quantities,feeBasis:/不含[^。]{0,30}费用/.test(quote)?'excludes-fees':'unknown'});
    if(rows.length===12){truncated=truncated||lineIndex<lines.length-1;break;}
  }
  return {status,action:actions.length===1?actions[0][0]:null,issuerSymbol:bound?symbols[0]:null,reportedThrough,sourceCompletion,rows,
    inactiveReasons:[...inactiveReasons],truncated,actorVerified:false,periodIncrement:null,actualMarketFlow:null,
    note:'仅本页材料声明；计划、累计、本期及已披露执行分开。金额保留原单位与币种，不加总、不自动差分；不是当日市场净流量或账户成交。',...flags};
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
    const inactiveReasons=[row.current===false?'superseded':null,row.associated===false?'association-removed':null,
      e.kind==='retracted'?'retracted':null,!chainComplete?'incomplete-chain':null].filter(Boolean);
    projected.push({row,versions:chain,knownAt:row.recordedAt,subjects:[...e.securities],clues,amounts,
      securityIdentity:projectSecurityIdentity(e,{active:inactiveReasons.length===0,inactiveReasons}),
      indexAdjustment:projectIndexAdjustment(e,asOf,inactiveReasons),
      capitalActivity:projectCapitalActivity(e,asOf,inactiveReasons),
      effectiveAt:null,effectiveDate:effective?.date??null,effectiveQuote:effective?.quote??null,formalDisclosure:disclosure,chainComplete,missing,
      revisionStatus:row.current===false?'已被后续版本替代':row.associated===false?'证券关联已移除':e.kind==='retracted'?'已撤稿':e.kind==='revised'?'已修订':'原始记录',
      researchOnly:true,canTrade:false,canNotify:false});
  }
  return {status:'bounded-evidence',rows:projected.sort((a,b)=>b.row.sequence-a.row.sequence),excluded,
    missing:['仅使用本次返回的档案版本；不代表全部新闻或完整历史'],canTrade:false};
}
