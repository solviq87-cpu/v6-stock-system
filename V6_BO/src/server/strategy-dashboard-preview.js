'use strict';
// Read-only strategy catalogue endpoint for the reference dashboard.
// Does not synthesize signals, stock prices, scores or missing provenance.
const fs=require('node:fs');
const {catalog,matchedIds}=require('../strategy/dashboard-strategy-catalog');
function catalogueFromSnapshot(snapshot={},deps={}){
  if(!snapshot || !Array.isArray(snapshot.stocks))throw new TypeError('snapshot.stocks must be an array');
  const {scanUniverse}=deps.scanUniverse?deps:require('../strategy/universe-scanner');
  const evaluateCandidate=deps.evaluateCandidate||require('../strategy/strategy-service').evaluateCandidate;
  const at=Number.isFinite(Number(snapshot.asOfMs))?Number(snapshot.asOfMs):Date.now();
  const market=snapshot.market||{};
  const scanned=scanUniverse({stocks:snapshot.stocks,market,now:at,requireReal:true,
    maxAgeMs:Number.isFinite(Number(snapshot.maxAgeMs))?Number(snapshot.maxAgeMs):900000});
  const bySymbol=new Map(snapshot.stocks.map(s=>[String(s.symbol||s.code||''),s]));
  const items=(scanned.items||[]).map(item=>{
    const original=bySymbol.get(String(item.symbol));
    let results=null;
    if(item.quality?.usable && original)results=evaluateCandidate({stock:original,market});
    const explicitLegacy=typeof original?.strategy==='string'?original.strategy:
      (typeof original?.strategyName==='string'?original.strategyName:
      typeof original?.strategyKey==='string'?original.strategyKey:typeof original?.source==='string'?original.source:'');
    const evidence={...item,legacyAttribution:explicitLegacy,strategy:{...(item.strategy||{}),strategies:results?.strategies||[],
      playbookAnalysis:results?.playbookAnalysis||item.strategy?.playbookAnalysis}};
    return {symbol:String(item.symbol),name:String(item.name||''),score:Number.isFinite(item.score)?item.score:null,
      asOf:item.patternDate||null,tradable:item.tradable===true,
      dataStatus:item.quality?.fresh===true?'fresh':item.quality?.usable===true?'unverified-or-stale':'unavailable',
      matchedIds:matchedIds(evidence)};
  });
  return {ok:true,source:'verified-snapshot-scan',asOf:new Date(at).toISOString(),catalog,items,
    warning:'只读研究扫描。无新鲜来源不推断；股票池不代表买卖建议。'};
}
function readSnapshot(file){
  if(!file)return null;
  const stat=fs.statSync(file);
  if(stat.size>30*1024*1024)throw Error('snapshot exceeds 30MB');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function createCatalogueHandler(options={}){
  return (req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method!=='GET'||pathname!=='/api/dashboard-strategy-catalog')return false;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    try{
      const snapshot=options.getSnapshot?options.getSnapshot():readSnapshot(options.snapshotPath);
      if(!snapshot){res.writeHead(200);res.end(JSON.stringify({ok:true,source:'unconfigured',
        catalog,items:[],asOf:null,warning:'尚未配置行情快照，不能生成实际命中股票'}));return true;}
      const result=catalogueFromSnapshot(snapshot,options.dependencies||{});
      res.writeHead(200);res.end(JSON.stringify(result));
    }catch(err){
      res.writeHead(503);res.end(JSON.stringify({ok:false,error:'策略快照不可用：'+err.message,
        catalog,items:[]}));
    }
    return true;
  };
}
module.exports={catalogueFromSnapshot,createCatalogueHandler,readSnapshot};
