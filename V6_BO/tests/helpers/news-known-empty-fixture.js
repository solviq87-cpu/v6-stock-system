'use strict';
// Old quote/model/receipt fixtures isolate a successfully checked, empty news
// source. They execute the actual new helpers rather than bypassing production
// review. News failures and revisions are exercised with real temporary journals
// in news-final-recommendation-gate.test.js.
const fs=require('node:fs'),vm=require('node:vm');
const current=fs.readFileSync(require.resolve('../../server.js'),'utf8');
function actual(name){const a=current.indexOf('function '+name+'('),b=current.indexOf('\n}\n',a)+2;if(a<0||b<=a)throw Error('missing actual helper '+name);return current.slice(a,b);}
function install(context,{knownEmpty=true}={}){
 if(!vm.isContext(context))vm.createContext(context);
 if(knownEmpty){
  context.S=context.S||{};context.S.news=context.S.news||{};
  Object.defineProperty(context.S.news,'riskSnapshot',{configurable:true,get:()=>({status:'available',checkedAt:vm.runInContext('Math.max(1,Date.now()-1000)',context),source:'eastmoney-fast-news',columnsComplete:true})});
  const latest=vm.runInContext('new Map()',context);
  context.newsEvidenceCurrent=()=>({unknown:false,latest});
  context.newsRecommendationCache={latest:null,sectorKey:null,rows:[]};
  context.newsIsBad=()=>false; // Never called: this explicitly empty source has no entries.
  vm.runInContext(actual('explicitNewsSectorMatch')+'\n'+actual('reviewRecommendationNews'),context);
 }
 for(const name of ['freezeNewsRecommendationRows','newsRecommendationSendOptions','recommendationNewsReview','nextPlanNewsOptions'])vm.runInContext(actual(name),context);
 return context;
}
module.exports={install};
