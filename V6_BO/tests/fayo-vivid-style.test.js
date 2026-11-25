'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../public/nova/fayo.css'),'utf8');
const browser=fs.readFileSync(path.resolve(__dirname,'../scripts/fayo-browser-check.js'),'utf8');
const design=css.slice(css.lastIndexOf('/* V6 compact professional terminal'));
function luminance(hex){
 const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return v[0]*.2126+v[1]*.7152+v[2]*.0722;
}
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('reference iteration favors useful source data and a compact three-panel/table hierarchy',()=>{
 assert.ok(design.length>3000,'compact design must be present');
 assert.doesNotMatch(css,/saturated magenta \/ violet with sapphire/,'old all-purple overlay must be gone');
 for(const token of ['.fy-terminal-index{order:2','.fy-terminal-stats{order:3','.fy-terminal-context{order:5','.fy-terminal-review{order:6'])
  assert.ok(design.includes(token),token);
 assert.match(design,/\.fy-terminal-panels>\.fy-section\{\s*min-height:158px/);
 assert.match(browser,/regions\.market\.bottom<=regions\.opportunity\.top/);
 assert.match(browser,/regions\.more\.top>=regions\.opportunity\.bottom/);
 assert.match(browser,/regions\.retainedRiskInResearch,true/);
});
test('phone keeps eight real counters and risk labels beneath the decision-first fold',()=>{
 assert.match(design,/\.fy-terminal-stats\{order:2;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(design,/\.fy-terminal-priorities\{order:3/);
 assert.match(design,/\.fy-terminal-index\{order:5/);
 assert.match(browser,/regions\.sourceCount,8/);
 // The current user brief puts weather and authoritative plans above the retained risk section.
 assert.match(browser,/regions\.decision\.top>=0&&regions\.weather\.bottom<page\.viewportSize/);
 assert.match(browser,/boxes\[0\]\.top,boxes\[2\]\.top/);
 assert.match(design,/\.fy-terminal-provenance/);
 assert.match(design,/\.fy-terminal-priority-risk/);
});
test('colors carry meaning and readable dates, never blanket pink or hidden unknowns',()=>{
 for(const color of ['#eaf4ff','#b0c8e3','#ff7188','#45e0ad'])
  assert.ok(contrast(color,'#0d2042')>=4.5,'contrast '+color);
 assert.match(design,/strong\.fy-positive\{color:#ff7188/);
 assert.match(design,/strong\.fy-negative\{color:#45e0ad/);
 assert.match(design,/\.fy-terminal-stats \.fy-terminal-stat\.accent/);
 assert.match(design,/\.fy-quote-time/);
 assert.match(design,/\.fy-terminal-provenance/);
 assert.doesNotMatch(design,/filter:\s*(saturate|brightness)/);
 assert.doesNotMatch(design,/\.fy-quote-time[^{}]*\{[^}]*display:\s*none/);
 assert.match(design,/@media\(prefers-reduced-motion:reduce\)/);
});

test('home groups the trading session before research on desktop and phone',()=>{
 assert.match(css,/\.fy-reference-home\.fy-home-layout\s*\{\s*display:grid/);
 assert.match(css,/\.fy-home-research\[open\]>/);
 assert.match(browser,/regions\.summary\.bottom<=regions\.market\.top/);
 assert.match(browser,/regions\.more\.top>=regions\.opportunity\.bottom/);
 assert.match(browser,/\.fy-home-research \.fy-home-risk'\)\.waitFor\(\{state:'visible'\}\)/);
 assert.match(browser,/headlineRisk\.getAttribute\('data-risk-id'\)/);
});
