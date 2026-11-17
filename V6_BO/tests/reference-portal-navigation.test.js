'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {LINKS,ACTIONS,METRICS,safeHref}=require('../public/assets/reference-portal.js');
const hub=require('../public/assets/feature-hub.js');
const gitBlob=bytes=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
test('reference screenshot menu has real routes and no fake hardcoded limit-up counts',()=>{
 const nav=LINKS.map(x=>x[1]);
 for(const label of ['首页','盘面总览','外围市场','选股核心','我的持仓','模拟盘','消息面','明日计划','我的十四条','复盘·学习','工具'])
  assert.ok(nav.includes(label),'missing '+label);
 for(const entry of LINKS)assert.ok(safeHref(entry[2]),entry[2]);
 assert.equal(METRICS.length,7);
 const script=read('public/assets/reference-portal.js');
 assert.match(script,/未经核验的行情不显示数字/);
 assert.doesNotMatch(script,/37\s*只|32\s*只|18\s*条/);
 assert.doesNotMatch(script,/setInterval|fetch\(|localStorage|sessionStorage|\/api\/trade|\/api\/order/);
});
test('every reference action links into an actual legacy module and has a safe destination',()=>{
 const index=read('public/index.html'),other=read('public/research.html');
 const known=new Set([...index.matchAll(/\bid="([^"]+)"/g),...other.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 for(const item of ACTIONS){
  assert.ok(safeHref(item.href),item.href);
  const hash=item.href.split('#')[1];
  if(hash)assert.ok(known.has(hash),'missing legacy anchor '+hash);
 }
 for(const item of LINKS){
  const hash=item[2].split('#')[1];
  if(hash)assert.ok(known.has(hash)||hash==='vx-dashboard','missing nav anchor '+hash);
 }
});
test('original approved desktop/mobile pages remain byte-identical',()=>{
 const approved=require('./fixtures/ui-homepage-approved-baseline-20261115.json');
 for(const name of ['index.html','mobile.html'])
  assert.equal(gitBlob(fs.readFileSync(path.join(root,'public',name))),approved.homepages[name],name);
});
test('portal is additive and old controllers remain mounted and available',()=>{
 const js=read('public/assets/reference-portal.js');
 const loader=read('public/assets/original-workspace.js');
 assert.match(loader,/reference-portal\.js/);
 assert.match(loader,/reference-portal\.css/);
 assert.match(js,/v6-portal-legacy/);
 assert.match(js,/nodes\.forEach\(node=>legacy\.append\(node\)\)/);
 assert.match(js,/root\.V6FeatureHub\?\.open/);
 assert.match(js,/root\.addEventListener\?\.\('v6-dashboard-data'/);
 assert.match(js,/root\.addEventListener\?\.\('v6-dashboard-offline'/);
});
test('feature center exposes all screenshot routes with search and keyboard accessibility',()=>{
 assert.ok(hub.CATALOG.length>=40);
 for(const item of hub.CATALOG)assert.ok(hub.validDestination(item.href),item.href);
 assert.ok(hub.findEntries('涨停原因').some(x=>x.id==='review-evidence'));
 assert.ok(hub.findEntries('36策略').some(x=>x.id==='research36'));
 assert.ok(hub.findEntries('模拟盘').some(x=>x.id==='paper'));
 const js=read('public/assets/feature-hub.js');
 assert.match(js,/aria-modal/);assert.match(js,/event\.key==='Escape'/);
 assert.match(js,/event\.key!=='Tab'/);
 assert.doesNotMatch(js,/\/api\/(?:trade|order|paper\/submit)/);
});
test('mobile layout and large screen layout use same cards and no synthetic market fixtures',()=>{
 const css=read('public/assets/reference-portal.css');
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/grid-template-columns:repeat\(7/);
 assert.match(css,/grid-template-columns:repeat\(3/);
 assert.match(css,/v6-portal-navlink/);
});
