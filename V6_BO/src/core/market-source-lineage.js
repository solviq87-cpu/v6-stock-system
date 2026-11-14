'use strict';
/**
 * Source IDs are transport/adapters, not votes. The mapping below is a
 * reviewed upstream-family classification, NOT an audit of network ownership
 * or data licensing. Unknown wrappers must not gain independent-source credit.
 *
 * efinance/Choice/AKShare's Eastmoney endpoints share Eastmoney as their
 * underlying supplier. Ashare/AKShare without endpoint-specific provenance
 * stay unknown: these clients can use more than one upstream.
 */
const UPSTREAM_BY_PROVIDER=Object.freeze({
  eastmoney:'eastmoney',
  'eastmoney-public-history':'eastmoney',
  'eastmoney-public-kline':'eastmoney',
  'eastmoney-public-quote':'eastmoney',
  efinance:'eastmoney',
  choice:'eastmoney',
  'akshare-em':'eastmoney',
  'akshare-eastmoney':'eastmoney',
  'akshare:stock_zh_a_hist':'eastmoney',
  'akshare:stock_zh_a_hist_min_em':'eastmoney',
  'stock_zh_a_hist':'eastmoney',
  tencent:'tencent',
  'tencent-public-history':'tencent',
  'tencent-public-quote':'tencent',
  'akshare-tx':'tencent',
  'akshare-tencent':'tencent',
  'easyquotation-tencent':'tencent',
  sina:'sina',
  'easyquotation-sina':'sina',
  baostock:'baostock',
  'baostock-eod-research-export-v1':'baostock',
  ifind:'ifind',
  tdx:'tdx',
  mootdx:'tdx'
});
const validLabel=(x,name)=>{
 if(typeof x!=='string'||!x||x.length>128||x!==x.trim()||
   /[\x00-\x1f\x7f]/.test(x))throw Error(name+'字段无效');
 return x.toLowerCase();
};
function labelRoot(label){return UPSTREAM_BY_PROVIDER[validLabel(label,'来源身份')]??null;}
function inspectOne(feed){
 const fromProvider=labelRoot(feed.provider);
 const declared=feed.upstream===undefined?null:labelRoot(feed.upstream);
 if(feed.upstream!==undefined&&declared===null)
  throw Error('上游声明未登记或包含多个供应商，必须逐实际响应标注');
 if(fromProvider&&declared&&fromProvider!==declared)
  throw Error('供应商包装接口与声明上游冲突，拒绝伪造来源身份');
 return {provider:feed.provider,knownRoot:fromProvider,effectiveRoot:fromProvider??declared};
}
function inspectMarketSourceLineage(primary,secondary,{requireKnownDistinct=false}={}){
 if(typeof requireKnownDistinct!=='boolean')throw Error('来源独立性要求无效');
 const a=inspectOne(primary),b=inspectOne(secondary);
 if(a.effectiveRoot&&b.effectiveRoot&&a.effectiveRoot===b.effectiveRoot)
  throw Error('两路行情共享同一上游供应商：'+a.effectiveRoot+'，不得冒充独立双源');
 const knownDistinct=Boolean(a.knownRoot&&b.knownRoot&&a.knownRoot!==b.knownRoot);
 if(requireKnownDistinct&&!knownDistinct)
  throw Error('双源独立性证据不足：必须使用两个已登记且不同的原生上游来源');
 return {primaryUpstreamFamily:a.effectiveRoot,secondaryUpstreamFamily:b.effectiveRoot,
  knownDistinctUpstreamFamilies:knownDistinct,
  actualUpstreamIndependenceVerified:false,
  status:knownDistinct?'different-registered-upstream-families-not-certified':'unverified-upstream-identity',
  warning:'只认仓库来源映射中的上游类别，不证明物理线路独立、第三方许可或交易所真实性'};
}
module.exports={inspectMarketSourceLineage,labelRoot};
