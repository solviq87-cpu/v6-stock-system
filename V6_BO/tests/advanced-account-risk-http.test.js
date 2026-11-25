'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {aShareCalendarDate}=require('../src/core/a-share-calendar');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const start=server.indexOf("  if (p === '/api/research/risk-center')");
const end=server.indexOf("  if (p === '/api/research/learning-runtime')",start);
assert.ok(start>0&&end>start);
const route=server.slice(start,end);
function request({method='GET',advanced=true,editor=true,replica=false,query=''}={}){
 const state={editor,replica,reads:0,jobs:[],authChecks:0};
 let settle;
 const pending=new Promise(resolve=>{settle=resolve;});
 const response={status:null,headers:{},body:null};
 const res={setHeader:(k,v)=>{response.headers[k]=v;},writeHead:(status,headers)=>{response.status=status;Object.assign(response.headers,headers);},end:body=>{response.body=JSON.parse(body);}};
 const context={p:'/api/research/risk-center',u:new URL('http://localhost/api/research/risk-center?'+(advanced?'advanced=1&':'')+query),
  req:{method,__tok:'existing-session'},res,process:{env:{}},__dirname:path.join(__dirname,'..'),path,aShareCalendarDate,
  PAPER:{},S:{stocks:[],lastPx:new Map()},paperAuthorityCalendar:{isOpen:()=>true},isContinuousTrading:()=>true,
  advancedOriginalPortfolioContext:()=>({plans:{pool:[],pre:[]},planChecks:{pool:{},pre:{}},classifications:{}}),
  centerHistoryDir:()=>path.resolve(__dirname,'../data/intelligence-center-history'),
  isReplica:()=>state.replica,limitPctOfCode:()=>.1,newsEvidenceVisibleState:()=>({}),
  requireEditor:()=>{state.authChecks++;if(state.editor)return true;res.writeHead(403,{'Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,locked:true}));return false;},
  require:name=>{
   if(name==='./src/core/research-risk-center')return {readResearchRiskCenter:()=>{state.reads++;return {mode:'research-risk-center-readonly',canTrade:false,canNotify:false,supports:[],contra:[],missing:[]};}};
   if(name==='./src/core/research-governance-cache')return {read:()=>null};
   if(name==='./src/core/monitor-capacity')return {heldCodes:()=>[]};
   if(name==='./src/core/advanced-account-risk')return {selectAdvancedRiskQuotes:()=>({})};
   if(name==='./src/server/advanced-account-risk-job')return {runAdvancedAccountRiskJob:input=>{state.jobs.push(input);return pending;}};
   throw Error('unexpected route dependency '+name);
  }};
 const done=Promise.resolve(vm.runInNewContext('(function(){'+route+'})()',context));
 const finish=payload=>{settle(payload||{mode:'advanced-account-risk-readonly',status:state.jobs[0]?.replica?'replica':'observed',canTrade:false,writesAccount:false,accounts:state.jobs[0]?.replica?[]:[{account:'pool',cash:12345}]});return done;};
 return {state,response,done,finish};
}
test('original risk endpoint stays compatible and denies unauthorized or non-GET requests before work',async()=>{
 for(const options of [{editor:false},{method:'POST'}]){
  const x=request(options);await x.done;
  assert.equal(x.response.status,options.editor===false?403:405);assert.equal(x.state.reads,0);assert.equal(x.state.jobs.length,0);
 }
 const x=request({advanced:false});await x.done;
 assert.equal(x.response.status,200);assert.equal(x.state.reads,1);assert.equal(x.state.jobs.length,0);
 assert.equal(Object.hasOwn(x.response.body.result,'advancedAccounts'),false);assert.equal(x.response.headers['Cache-Control'],'no-store');
});
test('revoked editor authorization during worker read withholds all private account results',async()=>{
 const x=request();assert.equal(x.state.jobs.length,1);x.state.editor=false;await x.finish();
 assert.equal(x.state.authChecks,2);assert.equal(x.response.status,403);assert.equal(x.response.body.locked,true);
 assert.doesNotMatch(JSON.stringify(x.response.body),/12345|advancedAccounts/);
});
test('in-flight primary to replica transition discards private results and replica never requests primary work',async()=>{
 const x=request();x.state.replica=true;await x.finish();
 const result=x.response.body.result.advancedAccounts;
 assert.equal(result.status,'role-changed');assert.deepEqual(result.accounts,[]);assert.equal(result.canTrade,false);
 assert.doesNotMatch(JSON.stringify(x.response.body),/12345/);
 const copy=request({replica:true});assert.equal(copy.state.jobs[0].replica,true);await copy.finish();
 assert.equal(copy.response.body.result.advancedAccounts.status,'replica');assert.deepEqual(copy.response.body.result.advancedAccounts.accounts,[]);
});
test('caller query values cannot replace server-owned account path, quote context, role or clock',async()=>{
 const x=request({query:'root=%2Ftmp%2Fattacker&historyRoot=%2Ftmp%2Fattacker&portfolioContext=forged&requestAt=1&replica=false&quotes=forged&cash=999999'});await x.finish();
 const input=x.state.jobs[0];
 assert.equal(input.root,path.resolve(__dirname,'../data/order-accounts'));assert.ok(input.requestAt>1);
 assert.equal(input.historyRoot,path.resolve(__dirname,'../data/intelligence-center-history'));
 assert.deepEqual(Object.keys(input.portfolioContext.plans),['pool','pre']);
 assert.equal(input.day,aShareCalendarDate(input.requestAt));assert.deepEqual(Object.keys(input.quotes),[]);
 assert.equal(Object.hasOwn(input,'cash'),false);assert.equal(x.response.status,200);
});
