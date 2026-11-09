'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const page=read('public/picks.html'),controller=read('public/assets/picks-page.js'),
 plugin=read('public/assets/picks-detail.js'),css=read('public/assets/picks-enhance.css');
const {catalog}=require('../public/assets/picks-rule-catalog.js');
test('keep merged picks page and all existing cloud controls, seven mobile navigation items intact',()=>{
 for(const id of ['candidates','total','visible','explained','reload','search','board','sort','day'])
  assert.ok(page.includes('id="'+id+'"'),'removed merged UI ID '+id);
 assert.equal((page.match(/class="bottom"/g)||[]).length,1,'exactly one original seven-link dock');
 assert.equal((page.match(/<a href="[^"]+"[^>]*><b>.*?<\/b>/g)||[]).length,7);
 assert.match(page,/href="\/research.html#decisionWorkspace"/);
 assert.match(page,/href="\/m"/);
});
test('linked detail and catalog are genuinely accessible on both screens, without replacing the main page',()=>{
 for(const id of ['pickDetailPanel','pickDetailName','pickDetailInfo','pickDetailReasons',
  'pickDetailRisk','pickDetailProvenance','pickKline','picksRuleCatalog'])
  assert.ok(page.includes('id="'+id+'"'),'missing linked detail '+id);
 assert.match(page,/picks-enhance\.css/);
 assert.match(page,/picks-rule-catalog\.js/);
 assert.match(page,/picks-detail\.js/);
 assert.match(page,/picks-page\.js/);
 assert.ok(page.indexOf('picks-detail.js')<page.indexOf('picks-page.js'));
});
test('controller continues to use existing read-only cache, not new scanning or trading endpoint',()=>{
 assert.match(controller,/\/api\/quant-picks\?/);
 assert.match(controller,/method: 'GET'/);
 assert.doesNotMatch(controller,/force=1|\/api\/paper\/submit|\/api\/order\/place|\/api\/push\/send/);
 assert.match(controller,/v6:picks-select/);
 assert.match(controller,/v6:picks-unauthorized/);
 assert.match(controller,/clearProtectedState\(\)/);
 assert.match(controller,/state\.items = \[\]; state\.hasData = false/);
 assert.match(controller,/formatAt\(item\.vendorQuoteAt \|\| item\.quoteAt\)/);
});
test('linked chart prevents wrong-stock late results and refuses absent or mock price data',()=>{
 assert.match(plugin,/generation\+\+/);
 assert.match(plugin,/if\(aborter\)aborter\.abort\(\)/);
 assert.match(plugin,/if\(request!==generation\)return/);
 assert.match(plugin,/\/api\/kline\?code=/);
 assert.match(plugin,/method:'GET'/);
 assert.match(plugin,/data\.isMock===true\|\|data\.simulated===true/);
 assert.match(plugin,/!plot\(data\.rows\)/);
 assert.doesNotMatch(plugin,/force=1|\/api\/paper\/submit|\/api\/push/);
});
test('catalog remains research-only, unique and sourced; bearish pattern never promoted to bullish',()=>{
 assert.ok(catalog.length>=8);
 assert.equal(new Set(catalog.map(x=>x.id)).size,catalog.length);
 for(const rule of catalog){
  assert.ok(rule.id&&rule.name&&rule.logic&&rule.needs);
  assert.equal(rule.production,false);
  assert.equal(rule.verifiedLive,false);
  assert.equal(rule.canTrade,false);
  assert.equal(rule.autoWeight,false);
  assert.equal(new URL(rule.source).protocol,'https:');
 }
 assert.ok(catalog.find(x=>x.id==='three-black-crows').name.includes('看跌'));
 assert.ok(catalog.find(x=>x.id==='opening-range-rvol').status.includes('尚未接入'));
});
test('scroll, safe area and reduced-motion semantics retained in additive UI',()=>{
 assert.match(css,/scroll-padding-top/);
 assert.match(css,/scroll-margin-top/);
 assert.match(css,/safe-area-inset-bottom|@media\(max-width:550px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/\.picks-rule-grid/);
 assert.match(css,/#pickKline svg/);
 assert.match(read('../.github/workflows/v6-ui-browser.yml'),/ui-picks-extended-browser-check\.js/);
});
