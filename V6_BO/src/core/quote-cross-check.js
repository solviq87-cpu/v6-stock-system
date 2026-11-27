'use strict';

const {createPublicMarket}=require('./public-market');
const {projectProbe}=require('./public-quote-probe');
const {fuseMultiSourcePrices}=require('./multi-source-price-consensus');
const {session}=require('./quote-dual-source-diagnostic');
const {marketRequests}=require('./market-request-governor');

const PROVIDERS=['tencent','eastmoney','sina'];
const INTERVAL_MS=30000;
const QUOTE_MAX_AGE_MS=15000;
const supportsQuoteCheck=code=>typeof code==='string'&&/^(?:60|68|00|30)\d{4}$/.test(code);

function createQuoteCrossCheck({isOpenDay, clock=Date.now, governor=marketRequests, fetchImpl=globalThis.fetch}) {
  let active=null, last=null, nextStart=0,lastSeenAt=0,clockFaults=0;
  // Request cooldown and original quote freshness are separate constraints.
  // A backwards or malformed clock must not resurrect expired evidence.
  function readClock(){
    let at;try{at=clock();}catch{at=null;}
    if(!Number.isSafeInteger(at)||at<=0||at>8e15||at<lastSeenAt){clockFaults++;return null;}
    lastSeenAt=at;return at;
  }
  function captureClock(){
    const at=readClock();
    if(at===null)throw Error('Invalid or regressing quote check clock');
    return at;
  }
  const open=at=>session(at)&&isOpenDay(at);
  const status=(code,state,at)=>({code,status:state,checkedAt:at===null?null:new Date(at).toISOString(),
    sourceStatuses:[],referencePrice:null,canTrade:false,canNotify:false});

  function reuse(result,at){
    const original=Date.parse(result.checkedAt||'');
    if(!Number.isSafeInteger(original)||original>at)return status(result.code,'clock-invalid',null);
    const eligible=result.sourceStatuses.filter(row=>row?.status==='eligible-for-comparison'||row?.inConsensus===true);
    if(eligible.some(row=>!Number.isSafeInteger(row.quoteAt)||row.quoteAt<=0||row.quoteAt>original||at-row.quoteAt>QUOTE_MAX_AGE_MS)||
       result.referencePrice!==null&&eligible.length<2){
      // Preserve the original check time, not a new receipt or current price.
      // Do not mutate the original report; downstream cannot reuse old votes.
      return {...status(result.code,'cached-evidence-expired',original),cacheEvaluatedAt:new Date(at).toISOString()};
    }
    return result;
  }

  async function compare(code,faultMark) {
    const capture=await createPublicMarket({code,providers:PROVIDERS,clock:captureClock,timeoutMs:5500,
      fetchImpl:(url,options)=>governor.run(url,async()=>{
        options.signal.throwIfAborted();
        if(!open(captureClock()))throw Error('Outside market session');
        const response=await fetchImpl(url,options);
        governor.checkResponse(url,response.status,response.headers);
        return response;
      })}).sync();
    const at=captureClock();
    if(clockFaults!==faultMark)return status(code,'clock-invalid',null);
    if(!open(at))return status(code,'session-closed',at);
    const projected=projectProbe({...capture,code,mode:'public-quote-probe',probeOnly:true,paidServicesUsed:false},at);
    return fuseMultiSourcePrices({code,now:at,sources:projected.sources});
  }

  return async function check(code) {
    if(!supportsQuoteCheck(code))throw Error('需要沪深A股六位代码');
    const at=readClock();
    if(at===null)return status(code,'clock-invalid',null);
    if(!open(at))return status(code,'session-closed',at);
    if(active?.code===code)return active.promise;
    if(last?.code===code&&at<last.reuseUntil)return reuse(last.result,at);
    if(active||at<nextStart)return status(code,'rate-limited',at);
    nextStart=at+INTERVAL_MS;
    const faultMark=clockFaults;
    const promise=compare(code,faultMark).catch(()=>{
      const ended=readClock();
      return ended===null||clockFaults!==faultMark?status(code,'clock-invalid',null):status(code,'unavailable',ended);
    }).then(result=>{
      if(result.status!=='clock-invalid')last={code,result,reuseUntil:nextStart};
      return result;
    }).finally(()=>{active=null;});
    active={code,promise};
    return promise;
  };
}

module.exports={createQuoteCrossCheck,supportsQuoteCheck};
