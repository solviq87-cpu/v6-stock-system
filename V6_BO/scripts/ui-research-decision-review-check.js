#!/usr/bin/env node
'use strict';
// Actual assets and handlers, isolated synthetic API fixtures; no supplier traffic.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {buildDecisionReview,buildHypothesisTimeline,buildScreeningFunnel}=require('../src/core/research-decision-review');
const {compareRuleSystems}=require('../src/strategy/rule-comparison');
const root=path.resolve(__dirname,'../public'),output=process.env.V6_UI_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'v6-review-ui-'));
fs.mkdirSync(output,{recursive:true});
const at=Date.parse('2026-11-12T09:00:00Z'),sha=c=>c.repeat(64);
function result(){
 const h={hypothesisHash:sha('a'),evidenceBundleHash:sha('b'),decisionAt:at,recordedAt:at,targetDate:'2026-11-13',dueAt:at+86400000,prediction:'up',state:'bullish',matchedPatternIds:['synthetic']};
 const r={asOf:at,status:'captured',stock:{symbol:'600000',name:'合成验收样本',source:'tencent',provider:'tencent',priceBasis:'unadjusted',observedAt:at,bars:[{date:'2026-11-12',open:10,close:11,high:12,low:9,volume:100}]},
  history:{source:'tencent',provider:'tencent',tradeDate:'2026-11-12',retrievedAt:at,sourceTimestamp:null},observation:{revision:1,observationHash:sha('c')},
  evidenceBundle:{hash:sha('b'),symbol:'600000',provider:'tencent',priceBasis:'unadjusted',decisionAt:at,recordedAt:at,observationHash:sha('c'),sourceRefs:[]},
  research36:{code:'600000',asOf:at,evaluations:[{id:'growth',name:'<img src=x onerror=window.BAD=1>',checks:[{field:'cashflow',pass:null,missing:'来源未提供'}],invalidation:'等待现金流证据'},
   {id:'trend',name:'合成趋势条件',checks:[{field:'trend',pass:true,value:1,op:'>=',threshold:1}]},{id:'flow',name:'合成资金条件',checks:[{field:'flow',pass:false,value:0,op:'>',threshold:0}]}]},
  readiness:{blockers:['交易状态证据不足']},priceEventResearch:{objective:'synthetic-only',currentHypothesis:h,timeline:buildHypothesisTimeline({hypotheses:[h],outcomes:[],corrections:[]},at),forwardValidation:{evaluated:0,independentTargetDays:0,minIndependentDays:20,rawCandleMatchFrequency:null}}};
 r.hypothesisEvidence=r.evidenceBundle;r.decisionReview=buildDecisionReview(r);return r;
}
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname.startsWith('/api/')){res.writeHead(403,{'Content-Type':'application/json'});res.end('{"ok":false,"error":"合成权限拒绝"}');return;}
 if(pathname!=='/research.html'&&!/^\/assets\/[a-zA-Z0-9.-]+$/.test(pathname)){res.writeHead(404);res.end();return;}
 try{res.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(path.join(root,pathname.slice(1))));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox']});
  for(const width of [320,390,430,1536]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],calls=[];
   page.on('pageerror',e=>errors.push(e.message));
   let rejectCapture=false,delayRule=false,releaseRule,ruleBlockedResolve;
   const ruleBlocked=new Promise(resolve=>{ruleBlockedResolve=resolve;});
   await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());calls.push(url.pathname);
    if(url.pathname==='/api/research/observe-stock')return route.fulfill({status:rejectCapture?403:200,json:rejectCapture?{ok:false,error:'合成权限拒绝'}:{ok:true,result:result()}});
    if(url.pathname==='/api/research/rule-comparison'){
     if(delayRule)await new Promise(resolve=>{releaseRule=resolve;ruleBlockedResolve();});
     return route.fulfill({json:{ok:true,analysis:compareRuleSystems({scores:{trendScore:65}})}}).catch(()=>{});
    }
    return route.fulfill({status:403,json:{ok:false,error:'合成权限拒绝'}});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/research.html');
   assert.equal(calls.includes('/api/research/observe-stock'),false);
   await page.locator('#captureSymbol').fill('600000');await page.locator('#captureRun').click();
   await page.locator('#captureDecision h3').waitFor();
   const text=await page.locator('#captureDecision').innerText();
   for(const word of ['个股判断与证据','条件分歧','冻结研究成绩单','判断变化时间线','研究续接摘要'])assert.ok(text.includes(word),word);
   assert.equal(await page.locator('#captureDecision img').count(),0);assert.equal(await page.evaluate(()=>window.BAD),undefined);
   await page.locator('#captureDecision summary').filter({hasText:'研究续接摘要'}).click();await page.getByRole('button',{name:'生成本次摘要'}).click();
   const summary=await page.getByRole('textbox',{name:'研究续接摘要'}).inputValue();assert.ok(summary.includes('600000'));assert.ok(summary.includes('不下单'));assert.ok(summary.length<=4000);
   await page.locator('#captureDecision').screenshot({path:path.join(output,'decision-review-'+width+'.png')});
   const overflow=await page.locator('#captureDecision').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));assert.ok(overflow.scroll<=overflow.width+1,JSON.stringify({width,...overflow}));
   const before=calls.length;await page.locator('#token').fill('fixture-new-token');assert.equal(await page.locator('#captureDecision').innerText(),'');assert.equal(calls.length,before);
   await page.locator('#captureRun').click();await page.locator('#captureDecision h3').waitFor();
   await page.evaluate(()=>dispatchEvent(new Event('offline')));assert.equal(await page.locator('#captureDecision').innerText(),'');
   rejectCapture=true;await page.locator('#captureRun').click();await page.waitForFunction(()=>document.getElementById('captureStatus').textContent.includes('权限拒绝'));assert.equal(await page.locator('#captureDecision').innerText(),'');
   await page.locator('#rulePayload').fill('{}');await page.locator('#ruleAnalyze').click();await page.getByRole('heading',{name:'四体系条件分歧'}).waitFor();
   delayRule=true;await page.locator('#ruleAnalyze').click();await ruleBlocked;
   await page.locator('#token').fill('fixture-revoked');releaseRule?.();await page.waitForFunction(()=>!document.getElementById('ruleAnalyze').disabled);assert.equal(await page.locator('#ruleDetails').innerText(),'');
   const funnel=buildScreeningFunnel([{symbol:'600000',quality:{usable:false,errors:['合成缺数']}}]);
   await page.evaluate(data=>globalThis.V6DecisionReview.renderFunnel(document.getElementById('summary'),data),funnel);
   assert.ok((await page.locator('#summary').innerText()).includes('来源与数据质量：1 → 0'));
   assert.deepEqual(errors,[]);await page.close();console.log('decision review viewport '+width+' passed');
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
