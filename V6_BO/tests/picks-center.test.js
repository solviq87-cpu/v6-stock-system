'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('public/picks.html'),js=read('public/assets/picks-center.js'),css=read('public/assets/picks-center.css');
const {catalog}=require('../public/assets/picks-rule-catalog.js');
test('selection results hub exists as a real responsive page with unique and accessible controls',()=>{
 for(const id of ['pickCards','stockDetail','detailBody','chartCanvas','cloudStatus','refreshPicks','stockSearch','sortPicks','ruleCards','snapshotDay'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/aria-live="polite"/);
 assert.match(html,/href="\/research\.html#decisionWorkspace"/);
 assert.match(html,/picks-rule-catalog\.js\?v=/);
 assert.match(html,/picks-center\.js\?v=/);
 assert.match(html,/候选股票/);
 assert.doesNotMatch(html,/<tr>.*\d{6}.*<\/tr>/s,'no hard-coded stock rows');
});
test('selection cards are read-only cloud projections, not an independent scan, order or notification source',()=>{
 assert.match(js,/fetch\('\/api\/quant-picks\?max=100'/);
 assert.match(js,/fetch\('\/api\/kline\?code='/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/cache:'no-store'/);
 assert.doesNotMatch(js,/method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
 assert.doesNotMatch(js,/force=1|\/api\/order|\/api\/push|\/api\/paper\/trade/i);
 assert.match(js,/!Array\.isArray\(d\.items\)/);
 assert.match(js,/d\.simulated===true\|\|d\.isMock===true/);
 assert.match(js,/entries=\[\];selectedKey=null;hadResponse=false/);
 assert.match(js,/el\('totalVisible'\)\.textContent='—'/);
});
test('filters, selection, quote provenance and late Kline responses fail closed',()=>{
 for(const t of ["riskInfo(r)","quoteProof(r)","normalizedRecord(r,key)","reasonsOf(r)","document.hidden","reason","risk.blocked","r.proof"])
  assert.ok(js.includes(t),'missing '+t);
 assert.match(js,/if\(current!==seq\)return/);
 assert.match(js,/AbortController/);
 assert.match(js,/scrollIntoView\(/);
 assert.match(js,/Date\.now\(\)/);
 assert.match(js,/报价原始时点或来源未知/);
 assert.match(js,/报价原始时点异常/);
 assert.match(js,/选股扫描日期 · 非行情原始时点/);
});
test('main desktop and mobile screens link directly to one cloud results URL without removing original research',()=>{
 for(const p of ['public/index.html','public/mobile.html','public/research.html','public/assets/terminal-dashboard.js']){
  const s=read(p);
  assert.ok(s.includes('/picks.html'),'missing results navigation in '+p);
  assert.ok(s.includes('/research.html'),'original research was removed from '+p);
 }
 const terminal=read('public/assets/terminal-dashboard.js');
 for(const label of ['十四条选股','八字口诀','GPT 五策略','Python 三轮筛选'])
  assert.ok(terminal.includes(label),'old strategy filtered UI removed '+label);
});
test('mobile and desktop scroll fluidly with reduced motion, no nested page height traps',()=>{
 assert.match(css,/scroll-behavior:smooth/);
 assert.match(css,/overscroll-behavior-x:contain/);
 assert.match(css,/\.bottom\{position:fixed/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/\.layout\{grid-template-columns:minmax\(0,1fr\)/);
});
test('public rule discovery is research metadata only: do not invent hit symbols or production abilities',()=>{
 assert.ok(catalog.length>=9);
 const ids=new Set(catalog.map(x=>x.id));
 assert.equal(ids.size,catalog.length);
 for(const rule of catalog){
  assert.ok(rule.name&&rule.logic&&rule.needs,rule.id);
  assert.equal(rule.production,false,rule.id);
  assert.equal(rule.verifiedLive,false,rule.id);
  assert.equal(rule.canTrade,false,rule.id);
  assert.equal(rule.autoWeight,false,rule.id);
  const url=new URL(rule.source);assert.equal(url.protocol,'https:');
 }
 assert.ok(catalog.find(x=>x.id==='opening-range-rvol').status.includes('尚未接入'));
 assert.ok(catalog.find(x=>x.id==='three-black-crows').name.includes('看跌'));
 assert.ok(catalog.find(x=>x.id==='donchian20-liquidity').logic.includes('此前20日'));
 assert.match(js,/命中条目可能属于同一研究家族，不自动重复加权/);
});
test('browser-level QA executes actual user interactions and rejects unauthorized persistence',()=>{
 const script=read('scripts/ui-picks-browser-check.js'),workflow=read('../.github/workflows/v6-ui-browser.yml');
 assert.match(script,/320,700/);
 assert.match(script,/390,844/);
 assert.match(script,/1536,864/);
 assert.match(script,/unauthorized=true/);
 assert.match(script,/page\.locator\('button\.stock'\)\.nth\(1\)\.click\(\)/);
 assert.match(script,/XSS|untrusted/);
 assert.match(workflow,/node scripts\/ui-picks-browser-check\.js/);
});
