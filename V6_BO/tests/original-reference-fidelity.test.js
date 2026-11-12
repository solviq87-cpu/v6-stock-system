'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mobile=read('public/mobile.html'),desktop=read('public/index.html');
const css=read('public/assets/original-reference-fidelity.css');
const shell=read('public/assets/terminal-dashboard.js');
const guide=read('docs/ORIGINAL_UI_REFERENCE_ACCEPTANCE_20261109.md');
const href='<link rel="stylesheet" href="/assets/original-reference-fidelity.css?v=20261109fidelity4">';
test('owner original desktop/mobile photographs, not mockups, are canonical acceptance targets',()=>{
 assert.match(guide,/7165\.jpeg/);
 assert.match(guide,/E419BE1D-AB04-4D50-A482-8676AE7FB869\(1\)\.jpeg/);
 assert.match(guide,/1:1真机视觉验收未完成/);
 assert.match(guide,/天枢智策/);
});
test('new fidelity CSS loaded LAST on both real dashboards, after old override layers',()=>{
 for(const [name,html] of [['desktop',desktop],['mobile',mobile]]){
  assert.ok(html.includes(href),name+' missing final fidelity CSS');
  const i=html.indexOf('reference-match.css?v='),j=html.indexOf(href);
  assert.ok(i>=0&&j>i,name+' fidelity CSS lost cascade precedence');
  assert.ok(html.includes('/assets/terminal-dashboard.js?v=20261109fidelity4'),name+' JS cache not invalidated');
 }
});
test('mobile narrow landscape: 3 index tiles then readable mood/environment/risk, not vertically squeezed',()=>{
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.vx-market-strip>.*?vx-index-grid.*?grid-column:1\/-1/s);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/\.vx-market-strip>.*?vx-mood.*?grid-column:span 3/s);
 assert.match(css,/\.vx-market-strip>.*?vx-environment.*?grid-column:span 3/s);
 assert.match(css,/\.vx-market-strip>.*?vx-risk-panel.*?grid-column:1\/-1/s);
 assert.match(css,/\.vx-market-strip>.*?vx-push-panel.*?order:4.*?grid-column:1\/-1/s);
 assert.match(css,/\.vx-risk-panel dl>div.*?font-size:11px/s);
 assert.doesNotMatch(css,/\.vx-risk-panel\s*\{\s*display:none/);
});
test('small-screen ranking keeps actual code, quote, percent, score and action while suppressing stale timestamp clutter',()=>{
 assert.match(css,/table-layout:fixed/);
 assert.match(css,/td:nth-child\(3\)>small.*?display:block!important/s);
 assert.match(css,/td:nth-child\(4\)>small.*?display:none!important/s);
 assert.match(css,/\.vx-dashboard \.vx-row-open.*?min-height:32px/s);
 assert.match(shell,/id="vx-rows"/);
 assert.match(shell,/id="vx-score"|class="vx-score"/);
 assert.match(shell,/quoteDescription\(row\)/);
});
test('iPhone detail chart and explanation stack at narrow width with legible text, no half-width mini-chart',()=>{
 assert.match(css,/\.vx-detail-column\{display:grid;grid-template-columns:1fr!important/);
 assert.match(css,/\.vx-chart-empty\{min-height:205px!important/);
 assert.match(css,/\.vx-explanation>div\{font-size:13px!important/);
 assert.match(css,/\.vx-research-pill\{font-size:11px!important/);
 assert.match(css,/\.vx-mobile-dock\{display:grid!important;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
 assert.match(css,/\.vx-mobile-dock a\{[^}]*white-space:nowrap/);
 assert.match(css,/safe-area-inset-bottom/);
});
test('desktop preserves left rail, six top cards, four overview cards and 2:1 ranking/detail split',()=>{
 assert.match(css,/@media\(min-width:1101px\)/);
 assert.match(css,/\.vx-sidebar\{top:66px;.*?width:208px/s);
 assert.match(css,/\.vx-market-strip\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\) minmax\(125px,\.85fr\) minmax\(182px,1\.3fr\)/);
 assert.match(css,/\.vx-overview-grid\{grid-template-columns:1\.42fr 1\.05fr 1fr 1\.1fr/);
 assert.match(css,/\.vx-content-grid\{grid-template-columns:minmax\(0,1\.94fr\) minmax\(310px,1fr\)/);
});
test('supplemental risk/news evidence stays available, but no longer displaces the original first-screen market cards',()=>{
 assert.match(shell,/dashboard\.append\(riskCard\)/);
 assert.doesNotMatch(shell,/dashboard\.prepend\(riskCard\)/);
 assert.match(shell,/id="vx-risk-evidence"/);
 assert.match(shell,/addEventListener\('v6-dashboard-data',/);
 assert.match(shell,/const dashboard=document\.createElement\('section'\)/);
});
test('phone and 1024px reference-style ranking show a compact price without losing quote provenance',()=>{
 assert.ok(css.includes('body.vx-mobile .vx-dashboard td:nth-child(4)>small{display:none!important}'));
 assert.ok(shell.includes('title="${esc(quoteDescription(r))}"'));
 assert.ok(shell.includes('quoteDescription(row)'));
});
test('original 1024px reference stock-detail card fits above the mobile dock',()=>{
 assert.ok(css.includes('@media(min-width:1001px) and (max-width:1100px)'));
 assert.ok(css.includes('height:312px;'));
 assert.ok(css.includes('body.vx-mobile #vx-ranking'));
 assert.ok(css.includes('max-height:208px;'));
 assert.ok(css.includes('body.vx-mobile .vx-detail-column .vx-explanation'));
 assert.ok(css.includes('overflow-y:auto;'));
 const browser=read('scripts/ui-reference-browser-check.js');
 assert.ok(browser.includes("b.chart.bottom<=b.dock.top-12"));
});
test('stock title preserves original quote time without showing a long timestamp above the chart',()=>{
 assert.ok(shell.includes("node.title=provenance"));
 assert.ok(shell.includes("node.setAttribute('aria-label',brief+' · '+provenance)"));
 assert.ok(css.includes('.vx-detail-column .vx-stock-title>span'));
 assert.ok(css.includes('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'));
});
test('feature parity and safety: original strategy, charts, permissions and cloud refresh not removed',()=>{
 for(const v of ['id="vx-indices"','id="vx-counts"','id="vx-strategies"','id="vx-rows"','id="vx-chart"','id="vx-explanation"'])assert.ok(shell.includes(v),v);
 assert.match(mobile,/function manualMobileRefresh\(\)/);
 assert.match(desktop,/id="btnCloudRefresh"/);
 assert.match(shell,/研究观察 · 非交易指令/);
 assert.match(guide,/绝对不能将示例价格\/分数\/信号写死到线上/);
});
