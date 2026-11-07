import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {demoDataset,analyzeSnapshot} from '../src/analysis.mjs';

for(const mode of ['incomplete','before-close'])test('display, chart and watchlist share completed signal bars: '+mode,()=>{
 const input=demoDataset();
 const last=input.stocks[0].bars.at(-1);
 Object.assign(last,{open:99998,high:100000,low:99997,close:99999});
 if(mode==='incomplete')last.complete=false;
 else{
  input.asOf=Date.parse(last.date+'T09:00:00+08:00');
  for(const stock of input.stocks)stock.feed.timestamp=input.asOf;
 }
 const expected=analyzeSnapshot(input).items[0];
 const dom=new JSDOM(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),
  {url:'https://v6.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 try{
  w.confirm=()=>true;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.eval(readFileSync(new URL('../dist/assets/analysis.bundle.js',import.meta.url),'utf8'));
  w.V6Research={...w.V6Research,demoDataset:()=>input};
  w.eval(readFileSync(new URL('../dist/assets/research-app.js',import.meta.url),'utf8'));
  assert.equal(w.document.getElementById('errorBanner').hidden,true);
  assert.ok(w.document.getElementById('stockDetail').querySelector('svg'));
  assert.ok(!w.document.getElementById('overviewTable').textContent.includes('99,999'));
  assert.ok(!w.document.getElementById('stockDetail').textContent.includes('99,999'));
  const chart=w.document.querySelector('#stockDetail svg');
  const maxAllowed=Math.max(...expected.priceHistory.map(bar=>bar.high));
  const priceTicks=[...chart.querySelectorAll('text')]
   .map(n=>n.textContent.replaceAll(',','')).map(Number).filter(Number.isFinite);
  assert.ok(priceTicks.length>0,'chart should contain price ticks');
  assert.ok(priceTicks.every(price=>price<maxAllowed*2),'excluded high price must not distort chart scale');
  const watch=w.document.querySelector('#overviewTable button[aria-label^="加入观察"]');
  assert.ok(watch);watch.click();
  const saved=JSON.parse(w.localStorage.getItem('v6.research.watchlist.v1')).rows[0];
  assert.equal(saved.date,expected.date);
  assert.equal(saved.price,expected.priceHistory.at(-1).close);
  assert.notEqual(saved.date,last.date);
 }finally{w.close();}
});
