'use strict';
// The existing dated membership table also owns optional dated security-master
// evidence. There is no second current-constituents table projected backwards.
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
const label=s=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=128&&!/[\x00-\x1f\x7f]/.test(s);
const open=date=>Date.parse(date+'T09:30:00+08:00');
function validateSecurityMaster(row){
 const s=row.securityMaster;
 if(s===undefined)return;
 if(!s||Array.isArray(s)||!label(s.source)||!label(s.dataVersion)||!stamp(s.knownAt)||!stamp(s.availableAt)||
    Date.parse(s.knownAt)>Date.parse(s.availableAt)||!validDate(s.listedOn)||
    s.delistedOn!==null&&(!validDate(s.delistedOn)||s.delistedOn<s.listedOn)||
    !['main','chinext','star','bse'].includes(s.board)||typeof s.isST!=='boolean'||typeof s.suspended!=='boolean'||
    !Number.isFinite(s.limitPct)||s.limitPct<=0||s.limitPct>100||s.priceBasis!=='unadjusted'||
    !['none','recorded'].includes(s.corporateActionStatus)||!Array.isArray(s.actionIds)||s.actionIds.length>1000||
    s.actionIds.some(id=>!label(id))||new Set(s.actionIds).size!==s.actionIds.length||
    (s.corporateActionStatus==='none')!==(s.actionIds.length===0)||!label(s.feeVersion)||
    !/^[a-f0-9]{64}$/.test(s.evidenceHash||''))throw Error('历史证券主数据缺少上市、退市、ST、停牌、板块、复权、公司行为或费用版本证据');
 if(row.eligible&&(row.from<s.listedOn||s.delistedOn!==null&&row.through>=s.delistedOn))
  throw Error('历史股票池把上市前或退市后区间标为可选');
}
function validateUniverseHistory(rows){
 if(rows==null)return;
 if(!Array.isArray(rows)||!rows.length||rows.length>100000)throw Error('历史股票池无效');
 const groups=new Map(),hasMaster=rows.some(row=>row?.securityMaster!==undefined);
 for(const row of rows){
  if(!row||!/^\d{6}$/.test(row.symbol)||!validDate(row.from)||!validDate(row.through)||row.from>row.through||
     typeof row.eligible!=='boolean'||!label(row.source)||!stamp(row.knownAt))throw Error('历史股票池缺少日期、来源或已知时点');
  if(row.sector!==undefined&&(typeof row.sector!=='string'||!row.sector||row.sector.length>80))throw Error('行业分类无效');
  if(hasMaster&&row.securityMaster===undefined)throw Error('历史证券主数据覆盖不完整，禁止混用完整与缺失记录');
  validateSecurityMaster(row);
  if(!groups.has(row.symbol))groups.set(row.symbol,[]);groups.get(row.symbol).push(row);
 }
 for(const list of groups.values()){
  list.sort((a,b)=>a.from.localeCompare(b.from));
  for(let i=1;i<list.length;i++)if(list[i].from<=list[i-1].through)throw Error('历史股票池区间重叠');
 }
}
function universeObservation(rows,symbol,date,{at='close'}={}){
 if(rows==null)return {eligible:true,verified:false,sector:null};
 if(!validDate(date)||!['open','close'].includes(at))throw Error('股票池决策日期无效');
 const decisionAt=Date.parse(date+(at==='open'?'T09:30:00+08:00':'T15:00:00+08:00')),
  row=rows.find(r=>r.symbol===symbol&&r.from<=date&&date<=r.through&&Date.parse(r.knownAt)<=decisionAt);
 if(!row)return {eligible:false,verified:false,sector:null,reason:'NO_POINT_IN_TIME_MEMBERSHIP'};
 const base={eligible:row.eligible,verified:false,sector:row.sector||null,source:row.source,knownAt:row.knownAt},s=row.securityMaster;
 if(s===undefined)return rows.some(r=>r.securityMaster!==undefined)?{...base,eligible:false,reason:'MISSING_POINT_IN_TIME_SECURITY_MASTER'}:base;
 validateSecurityMaster(row);
 const reason=Date.parse(s.availableAt)>decisionAt?'SECURITY_MASTER_NOT_AVAILABLE':date<s.listedOn?'NOT_YET_LISTED':
  s.delistedOn!==null&&date>=s.delistedOn?'DELISTED':s.suspended?'HISTORICAL_SUSPENSION':s.isST?'HISTORICAL_ST':null;
 return {...base,eligible:base.eligible&&!reason,reason,securityMaster:{...s},securityCoverage:'declared-unverified'};
}

/** Validate a declared complete PIT dataset at the original import/backtest
 * boundary. Legacy files still run as explicitly unknown research. A caller
 * requiring PIT must set requirePointInTime; missing coverage then fails closed.
 * This checks supplied evidence consistency, never certifies a vendor.
 */
function historicalUniverseCoverage(data){
 if(data?.requirePointInTime!==undefined&&typeof data.requirePointInTime!=='boolean')throw Error('历史时点覆盖要求必须为布尔值');
 const rows=data?.universeHistory,declared=rows?.some(row=>row.securityMaster!==undefined);
 const unknown={status:'unknown',complete:false,verifiedExternal:false,canTrade:false,
  missing:['缺少完整逐时点证券主数据、公司行为和费用来源覆盖；旧股票池不是完整历史成分股证明']};
 if(!declared){if(data?.requirePointInTime)throw Error('缺少完整历史时点证券主数据覆盖，拒绝要求PIT的回测');return unknown;}
 validateUniverseHistory(rows);
 if(!Array.isArray(data.stocks)||!data.stocks.length)throw Error('历史证券主数据缺少对应行情');
 if(data.priceBasis!=='unadjusted'&&data.priceAdjustment?.mode!=='unadjusted')throw Error('历史证券主数据要求明确未复权执行口径');
 require('./historical-execution-price-basis').assertUnadjustedExecutionPriceBasis(data);
 require('./trading-fees').validateFeeSchedules(data.feeSchedules);
 if(!Array.isArray(data.feeSchedules)||!data.feeSchedules.length||data.feeSchedules.some(row=>!label(row.source)||!stamp(row.knownAt)))
  throw Error('历史证券主数据缺少逐生效日期的费率来源和已知时点');
 const grouped=new Map();for(const row of rows){if(!grouped.has(row.symbol))grouped.set(row.symbol,[]);grouped.get(row.symbol).push(row);}
 for(const list of grouped.values())list.sort((a,b)=>a.from.localeCompare(b.from));
 let checkedBars=0;
 for(const stock of data.stocks){
  const symbol=String(stock.symbol||stock.code||''),history=grouped.get(symbol)||[];
  for(const bar of stock.bars||[]){
   const row=history.find(row=>row.from<=bar.date&&bar.date<=row.through),s=row?.securityMaster,at=open(bar.date);
   if(!validDate(bar.date)||!row||Date.parse(row.knownAt)>at||Date.parse(s.availableAt)>at)
    throw Error('历史证券主数据缺少开盘前已知的完整日期覆盖: '+symbol);
   if(bar.isST!==s.isST||bar.suspended!==s.suspended||bar.limitPct!==s.limitPct||stock.market!==s.board||
      bar.priceBasis!==undefined&&bar.priceBasis!=='unadjusted')throw Error('历史行情与逐日ST、停牌、板块或涨跌幅证据不一致: '+symbol);
   if((bar.date<s.listedOn||s.delistedOn!==null&&bar.date>=s.delistedOn)&&bar.volume!==0)
    throw Error('上市前或退市后行情不能冒充正常成交');
   const fee=data.feeSchedules.filter(row=>row.effectiveFrom<=bar.date).at(-1);
   if(!fee||fee.version!==s.feeVersion||Date.parse(fee.knownAt)>at)throw Error('历史费用版本与证券主数据交易日期或已知时点不一致');
   const events=(data.settlements||[]).filter(event=>event.symbol===symbol&&event.effectiveDate===bar.date);
   const action=bar.corporateAction;
   for(const id of [...events.map(event=>event.eventId),...(action?[action.actionId]:[])]){
    if(!label(id)||s.corporateActionStatus!=='recorded'||!s.actionIds.includes(id))throw Error('历史公司行为缺少原证券主数据事件关联');
   }
   checkedBars++;
  }
  for(const row of history)for(const id of row.securityMaster.actionIds){
   const event=(data.settlements||[]).find(event=>event.symbol===symbol&&event.eventId===id&&event.effectiveDate>=row.from&&event.effectiveDate<=row.through),
    bar=stock.bars.find(bar=>bar.date>=row.from&&bar.date<=row.through&&bar.corporateAction?.actionId===id);
   if(!event&&!bar)throw Error('历史证券主数据声明的公司行为缺少原始结算或逐日事件');
   if(Date.parse((event||bar.corporateAction).publishedAt)>Date.parse(row.securityMaster.knownAt))
    throw Error('历史证券主数据提前引用尚未公布的公司行为');
  }
  const delistDates=[...new Set(history.map(row=>row.securityMaster.delistedOn).filter(Boolean))];
  for(const delistedOn of delistDates)if(delistedOn>=stock.bars[0]?.date&&delistedOn<=stock.bars.at(-1)?.date&&
    !(data.settlements||[]).some(event=>event.symbol===symbol&&event.kind==='delisting-cash'&&event.effectiveDate>=delistedOn&&event.effectiveDate<=stock.bars.at(-1).date))
   throw Error('历史退市区间缺少原始清算结算，权益状态未知');
 }
 return {status:'declared-coverage-validated',complete:true,verifiedExternal:false,canTrade:false,checkedBars,
  coverageScope:'provided-symbols-and-dates-only',fullHistoricalUniverseVerified:false,
  memberships:rows.length,feeVersions:data.feeSchedules.map(row=>row.version),missing:[],
  note:'仅验证所给历史覆盖与时间一致性；不认证供应商，也不证明输入已包括全部退市证券。'};
}
module.exports={validateUniverseHistory,universeObservation,historicalUniverseCoverage};
