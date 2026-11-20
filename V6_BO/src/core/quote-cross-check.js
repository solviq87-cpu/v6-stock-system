'use strict';

const {createPublicMarket}=require('./public-market');
const {projectProbe}=require('./public-quote-probe');
const {fuseMultiSourcePrices}=require('./multi-source-price-consensus');
const {session}=require('./quote-dual-source-diagnostic');
const {marketRequests}=require('./market-request-governor');

const PROVIDERS=['tencent','eastmoney','sina'];
const INTERVAL_MS=30000;
const supportsQuoteCheck=code=>typeof code==='string'&&/^(?:60|68|00|30)\d{4}$/.test(code);

function createQuoteCrossCheck({isOpenDay, clock=Date.now, governor=marketRequests, fetchImpl=globalThis.fetch}) {
  let active=null, last=null, nextStart=0;
  const open=at=>session(at)&&isOpenDay(at);
  const status=(code,state,at)=>({code,status:state,checkedAt:new Date(at).toISOString(),
    sourceStatuses:[],referencePrice:null,canTrade:false,canNotify:false});

  async function compare(code) {
    const capture=await createPublicMarket({code,providers:PROVIDERS,clock,timeoutMs:5500,
      fetchImpl:(url,options)=>governor.run(url,async()=>{
        options.signal.throwIfAborted();
        if(!open(clock()))throw Error('Outside market session');
        const response=await fetchImpl(url,options);
        governor.checkResponse(url,response.status,response.headers);
        return response;
      })}).sync();
    const at=clock();
    if(!open(at))return status(code,'session-closed',at);
    const projected=projectProbe({...capture,code,mode:'public-quote-probe',probeOnly:true,paidServicesUsed:false},at);
    return fuseMultiSourcePrices({code,now:at,sources:projected.sources});
  }

  return async function check(code) {
    if(!supportsQuoteCheck(code))throw Error('需要沪深A股六位代码');
    const at=clock();
    if(!open(at))return status(code,'session-closed',at);
    if(active?.code===code)return active.promise;
    if(last?.code===code&&at<last.reuseUntil)return last.result;
    if(active||at<nextStart)return status(code,'rate-limited',at);
    nextStart=at+INTERVAL_MS;
    const promise=compare(code).catch(()=>status(code,'unavailable',clock())).then(result=>{
      last={code,result,reuseUntil:nextStart};
      return result;
    }).finally(()=>{active=null;});
    active={code,promise};
    return promise;
  };
}

module.exports={createQuoteCrossCheck,supportsQuoteCheck};
