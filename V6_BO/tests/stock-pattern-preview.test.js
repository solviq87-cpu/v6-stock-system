'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const preview=require('../public/assets/stock-pattern-preview');
const {detectPatterns}=require('../src/strategy/a-share-patterns');
function bars(n=35){
  return Array.from({length:n},(_,i)=>({
    date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),
    open:10,high:10.2,low:9.8,close:10,volume:1000000,amount:120000000
  }));
}
const candle=(old,o,c,l,h,v=1000000)=>({...old,open:o,close:c,low:l,high:h,volume:v});
function assertParity(xs){
  const browser=preview.evaluate(xs),server=detectPatterns({symbol:'600001',bars:xs});
  assert.equal(browser.usable,true);
  assert.equal(server.usable,true);
  for(const check of browser.checks){
    const expected=server.checks.find(c=>c.id===check.id);
    assert.ok(expected,'server pattern missing '+check.id);
    assert.equal(check.status,expected.status,check.id);
    assert.equal(check.side,expected.side,check.id);
  }
  return browser;
}
test('six preview rules are in agreement with server-side independent research rules',()=>{
  const neutral=bars();
  assertParity(neutral);
  const red=bars();red.splice(-3,3,
    candle(red.at(-3),9.8,10.1,9.7,10.15),
    candle(red.at(-2),9.95,10.3,9.8,10.35),
    candle(red.at(-1),10.1,10.5,9.9,10.55));
  assert.ok(assertParity(red).positive.some(x=>x.id==='red_three_soldiers'));
  const crow=bars();crow.splice(-3,3,
    candle(crow.at(-3),10.2,9.9,9.85,10.25),
    candle(crow.at(-2),10,9.7,9.65,10.05),
    candle(crow.at(-1),9.8,9.5,9.45,9.85));
  assert.ok(assertParity(crow).risks.some(x=>x.id==='three_black_crows'));
  const engulf=bars();engulf[engulf.length-2]=candle(engulf.at(-2),10,9.8,9.7,10.1);
  engulf[engulf.length-1]=candle(engulf.at(-1),9.7,10.5,9.6,10.55);
  assert.ok(assertParity(engulf).positive.some(x=>x.id==='bullish_engulfing'));
  const breakdown=bars();breakdown[breakdown.length-1]=candle(breakdown.at(-1),10,9,8.9,10.1,2500000);
  assert.ok(assertParity(breakdown).risks.some(x=>x.id==='breakdown20_volume'));
  assert.ok(assertParity(breakdown).risks.some(x=>x.id==='heavy_distribution'));
});
test('invalid, duplicate or absent dates do not become confident technical evidence',()=>{
  const incomplete=bars(3);
  assert.equal(preview.evaluate(incomplete).checks.find(x=>x.id==='breakdown20_volume').status,'insufficient_data');
  const duplicate=bars();duplicate.at(-1).date=duplicate.at(-2).date;
  assert.equal(preview.evaluate(duplicate).usable,false);
  const invalid=bars();invalid.at(-1).high=1;
  assert.equal(preview.evaluate(invalid).usable,false);
  const impossible=bars();impossible.at(-1).date='2026-02-31';
  assert.equal(preview.evaluate(impossible).usable,false);
  const fractional=bars();fractional.at(-1).volume=100.2;
  assert.equal(preview.evaluate(fractional).usable,false);
  assert.equal(preview.evaluate([{open:10,close:11}]).usable,false);
});
test('risk and bullish evidence remain separate; displayed provenance is escaped',()=>{
  const red=bars();red.splice(-3,3,
    candle(red.at(-3),9.8,10.1,9.7,10.15),
    candle(red.at(-2),9.95,10.3,9.8,10.35),
    candle(red.at(-1),10.1,10.5,9.9,10.55));
  const r=preview.evaluate(red);
  assert.equal(r.risks.length,0);
  assert.ok(r.positive.length>0);
  assert.ok(!Object.hasOwn(r,'finalScore'));
  const html=preview.render(r,{asOf:'2026-02-04',source:'<img onerror=alert(1)>'});
  assert.match(html,/看涨形态/);
  assert.match(html,/看跌风险形态/);
  assert.match(html,/&lt;img/);
  assert.ok(!html.includes('<img'));
  assert.match(html,/非实时盯盘/);
});
test('desktop and mobile load research preview before main chart controller',()=>{
  for(const name of ['index.html','mobile.html']){
    const html=fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
    const mod=html.indexOf('/assets/stock-pattern-preview.js');
    const chart=html.indexOf('/assets/terminal-dashboard.js');
    assert.ok(mod>=0&&chart>mod,name);
  }
  const js=fs.readFileSync(path.join(__dirname,'../public/assets/terminal-dashboard.js'),'utf8');
  assert.match(js,/V6PatternPreview\.evaluate/);
  assert.match(js,/访问已失效：已清除历史形态预览/);
  assert.match(js,/连接中断：历史形态预览不再有效/);
});
