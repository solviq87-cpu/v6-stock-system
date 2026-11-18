'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const bridge=require('../public/assets/mobile-review-bridge');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('mobile entry links into actual shared V6 desktop modules, not a separate account',()=>{
 const links=bridge.ROUTES;
 assert.deepEqual(links.map(x=>x[1]),['/#v6-review','/#sectors','/#holdSec1','/#workspace-settings']);
 const home=read('public/index.html');
 for(const [,href] of links)assert.ok(home.includes('id="'+href.split('#')[1]+'"'),href);
});
test('mobile review preview only mirrors actual digest text; never fabricates total or evidence',()=>{
 const x=bridge.model({status:'⏸ 休市 · 显示 2026-11-17 数据',
  zt:'最近交易日 · 37只',sector:'前5强 · 48秒前',
  sectorRows:['算力 +1.50%','储能 +0.80%','芯片 +0.70%']});
 assert.equal(x.zt,'最近交易日 · 37只');
 assert.equal(x.sector,'前5强 · 48秒前');
 assert.deepEqual(x.rows,['算力 +1.50%','储能 +0.80%','芯片 +0.70%']);
 assert.match(x.source,/非实时/);
 const empty=bridge.model({});
 assert.match(empty.zt,/尚未就绪/);
 assert.equal(empty.hasData,false);
 assert.equal(empty.rows.length,0);
});
test('stale and disconnected screens never label retained market data live',()=>{
 for(const label of ['⚠️ 云端暂时断开 · 上次画面（非实时）','⏸ 休市','离线','最近交易日快照']){
  assert.match(bridge.model({status:label}).source,/非实时/);
 }
 assert.match(bridge.model({status:'🟢 交易中 · 更新 09:36:50'}).source,/逐股核验/);
});
test('rank list is bounded, normalizes plain text and never interprets HTML as markup',()=>{
 const x=bridge.model({sectorRows:Array.from({length:30},(_,i)=>'行业 '+i+' <img src=x>')});
 assert.equal(x.rows.length,5);
 assert.match(x.rows[0],/<img src=x>/);
 assert.equal(bridge.clean('  x \n  y  '),'x y');
 assert.equal(bridge.clean('z'.repeat(300)).length,120);
});
test('additive mobile loader respects original login and DOM; API and order writes remain untouched',()=>{
 const loader=read('public/assets/original-workspace.js');
 const js=read('public/assets/mobile-review-bridge.js');
 const css=read('public/assets/mobile-review-bridge.css');
 assert.match(loader,/data-v6-mobile-review-loader/);
 assert.match(loader,/mobile-review-bridge\.js\?v=20261118review1/);
 assert.match(loader,/mobile-review-bridge\.css\?v=20261118review1/);
 assert.match(js,/getElementById\('app'\)/);
 assert.match(js,/getElementById\('moodCard'\)/);
 assert.match(js,/getElementById\('ztMeta'\)/);
 assert.match(js,/getElementById\('secBody'\)/);
 assert.match(js,/MutationObserver/);
 assert.doesNotMatch(js,/\bfetch\s*\(|XMLHttpRequest|\/api\/|localStorage|sessionStorage|\/api\/order|\/api\/trade/);
 assert.match(css,/min-width:390px/);
 assert.match(css,/max-width:430px/);
 const mobile=read('public/mobile.html');
 assert.match(mobile,/id="gate"/);
 assert.match(mobile,/id="app"/);
 assert.match(mobile,/original-workspace\.js/);
});
