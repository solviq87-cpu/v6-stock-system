import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function page(overrides=()=>({})){
 const dom=new JSDOM(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),
  {url:'https://v6.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(readFileSync(new URL('../dist/assets/analysis.bundle.js',import.meta.url),'utf8'));
 const original={...w.V6Research};
 w.V6Research={...original,...overrides(original)};
 w.eval(readFileSync(new URL('../dist/assets/research-app.js',import.meta.url),'utf8'));
 return {dom,w,original};
}
const initialize=()=>page(()=>({}));
const submit=w=>w.document.getElementById('strategySimForm').onsubmit(
 new w.Event('submit',{cancelable:true}));

test('strategy-first page shows full rules, honest evidence and three real research results',{timeout:15000},async()=>{
 const {w}=initialize();
 try{
  const doc=w.document;
  assert.equal(doc.getElementById('errorBanner').hidden,true);
  assert.equal(doc.querySelector('[data-page="strategies"]').hidden,false);
  assert.equal(doc.querySelectorAll('#strategyCatalog [data-strategy-id]').length,3);
  assert.ok(doc.getElementById('strategyCatalog').textContent.includes('未核验实盘'));
  for(const strategy of w.V6Research.strategyCatalog){
   const select=doc.getElementById('strategySelect');select.value=strategy.id;
   select.dispatchEvent(new w.Event('change'));
   assert.equal(doc.getElementById('strategyRuleTitle').textContent,strategy.label);
   assert.ok(doc.getElementById('strategyRules').textContent.includes('退出'));
  }
  await submit(w);
  assert.equal(doc.getElementById('strategyRunButton').disabled,false);
  assert.equal(doc.querySelectorAll('#strategyResults tbody tr').length,3);
  assert.ok(doc.getElementById('strategyResults').textContent.includes('模拟胜率'));
  assert.ok(!doc.getElementById('strategyResults').textContent.includes('实盘已验证'));
  assert.equal(doc.getElementById('errorBanner').hidden,true);
 }finally{w.close();}
});

test('manual screener filters do not silently remove the strategy universe',{timeout:15000},async()=>{
 const calls=[];
 const {w,original}=page(engine=>({runStrategyResearch:(input,options)=>{
  calls.push({stocks:input.stocks.length,options});return engine.runStrategyResearch(input,options);
 }}));
 try{
  const doc=w.document;
  doc.getElementById('minAverageTurnover20').value='999999';
  doc.getElementById('filterForm').onsubmit(new w.Event('submit',{cancelable:true}));
  await submit(w);
  assert.equal(calls.length,original.strategyCatalog.length);
  assert.ok(calls.every(call=>call.stocks===original.demoDataset().stocks.length));
  assert.ok(calls.every(call=>!Object.hasOwn(call.options,'modelFilters')));
 }finally{w.close();}
});

test('importing new data while a simulation is pending cancels stale results',{timeout:15000},async()=>{
 let release,first=true;
 const {w,original}=page(engine=>({runStrategyResearch:(input,options)=>{
  if(first){first=false;return new Promise(resolve=>{release=()=>resolve(engine.runStrategyResearch(input,options));});}
  return engine.runStrategyResearch(input,options);
 }}));
 try{
  const running=submit(w);
  for(let i=0;i<200&&!release;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(release,'simulation should have started');
  const imported=original.demoDataset();imported.stocks=imported.stocks.slice(0,2);
  const file=w.document.getElementById('datasetFile');
  Object.defineProperty(file,'files',{configurable:true,value:[{
   name:'new-history.json',size:100,text:async()=>JSON.stringify(imported)
  }]});
  await file.onchange({target:file});
  release();release=null;await running;
  assert.equal(w.document.querySelectorAll('#strategyResults tbody tr').length,0);
  assert.equal(w.document.getElementById('strategyRunButton').disabled,false);
  assert.ok(w.document.getElementById('datasetLabel').textContent.includes('new-history.json'));
 }finally{if(release)release();w.close();}
});
