/* Read-only price observation projection. Never turn current quotes into frozen signals. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.V6PicksFollowup=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const horizons=[1,5,20,60];
  const statuses={
    pending:'待成熟',
    'calendar-incomplete':'交易日历不足',
    'corporate-action-unresolved':'公司行为待核对',
    'missing-or-suspended':'停牌或缺价'
  };
  const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
    !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
  const short=(v,n=70)=>typeof v==='string'?v.slice(0,n):'';
  function project(payload,code){
    const empty={state:'missing',asOf:null,entries:[],observed:0,unresolved:0,
      note:'暂无服务端冻结信号的后续观察记录，不能用本次涨跌幅代替跟踪结果。'};
    if(!/^\d{6}$/.test(String(code||''))||!payload||typeof payload!=='object')return empty;
    if(payload.schemaVersion!==1||payload.mode!=='forward-signal-price-observation'||
      payload.canTrade!==false||payload.verifiedLive!==false||payload.prospectiveCertified!==false||
      payload.executionSimulated!==false||!day(payload.asOf)||
      !sha(payload.cohortFingerprint)||!sha(payload.marketFingerprint)||
      !Array.isArray(payload.records)||payload.records.length>500){
      return {...empty,state:'invalid',note:'跟踪证据协议不完整或不可信，已停止展示收益数值。'};
    }
    const entries=[];
    for(const r of payload.records){
      if(!r||r.symbol!==code||!day(r.signalDate)||r.signalDate>payload.asOf||
        typeof r.signalId!=='string'||!r.signalId.trim()||r.signalId.length>200||
        !Array.isArray(r.windows)||r.windows.length!==horizons.length||
        typeof r.baselineClose!=='number'||!Number.isFinite(r.baselineClose)||r.baselineClose<=0)continue;
      const windows=[];
      for(let i=0;i<horizons.length;i++){
        const w=r.windows[i],h=horizons[i];
        if(!w||w.tradingDays!==h||typeof w.status!=='string'){
          windows.push({days:h,state:'unknown',label:'证据无效',pct:null,date:null});continue;
        }
        const observed=w.status==='observed'&&day(w.targetDate)&&
          w.targetDate>r.signalDate&&w.targetDate<=payload.asOf&&
          typeof w.priceReturnPct==='number'&&Number.isFinite(w.priceReturnPct)&&w.priceReturnPct>-100;
        if(observed){windows.push({days:h,state:'observed',label:'已观察',
          pct:w.priceReturnPct,date:w.targetDate});continue;}
        const plausibleDate=w.targetDate===null||day(w.targetDate)&&w.targetDate>r.signalDate;
        windows.push({days:h,state:statuses[w.status]&&plausibleDate?w.status:'unknown',
          label:statuses[w.status]&&plausibleDate?statuses[w.status]:'证据无效',pct:null,
          date:plausibleDate?w.targetDate:null});
      }
      entries.push({signalId:short(r.signalId,200),date:r.signalDate,
        system:short(r.system,60)||'来源未知',cohort:short(r.cohort,80)||'条件组未知',windows});
    }
    if(!entries.length)return {...empty,asOf:payload.asOf,
      note:'没有与这只股票代码匹配的冻结信号，不能套用其他股票或本次涨跌幅。'};
    const trimmed=entries.slice(0,8);
    return {state:'available',asOf:payload.asOf,entries:trimmed,totalSignals:entries.length,
      observed:entries.reduce((n,r)=>n+r.windows.filter(w=>w.state==='observed').length,0),
      unresolved:entries.reduce((n,r)=>n+r.windows.filter(w=>w.state!=='observed').length,0),
      note:'基于冻结信号日收盘价的未复权价格变化，非可成交净收益；来源与指纹未在浏览器独立认证，不可作为策略有效性结论。'};
  }
  return {project,horizons};
});
