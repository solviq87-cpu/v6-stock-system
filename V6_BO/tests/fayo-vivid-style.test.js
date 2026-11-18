'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../public/nova/fayo.css'),'utf8');
const qa=fs.readFileSync(path.resolve(__dirname,'../scripts/fayo-browser-check.js'),'utf8');
const p=css.slice(css.lastIndexOf('/* V6 reference palette'));
function L(hex){const n=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
 .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*n[0]+.7152*n[1]+.0722*n[2];}
const contrast=(a,b)=>(Math.max(L(a),L(b))+.05)/(Math.min(L(a),L(b))+.05);
test('real V6 neon color tokens and key cards share the same desktop/mobile palette',()=>{
 for(const v of ['--fy-neon-blue:#398dff','--fy-neon-violet:#aa6aff','--fy-neon-pink:#ff61ad'])assert.ok(p.includes(v));
 for(const v of ['.fy-terminal-title','.fy-terminal-stats .fy-terminal-stat','.fy-terminal-panels>.fy-section','.fy-terminal-index .fy-market-ticker>div','.fy-dock'])assert.ok(p.includes(v));
 assert.match(p,/@media\(max-width:650px\)/);
 assert.match(qa,/assert\.notEqual\(vivid\.first,vivid\.second/);
});
test('reference palette retains contrast and correct red-up green-down semantics',()=>{
 for(const color of ['#f5f9ff','#b4d5f6','#ff6d83','#43e8ae'])assert.ok(contrast(color,'#0a1e49')>=4.5,color);
 assert.match(p,/\.fy-positive/);assert.match(p,/\.fy-negative/);
 assert.match(p,/\.fy-terminal-flow:has\(>strong\.fy-negative\)/);
});
test('visual-only changes keep quote timestamps visible without global filters',()=>{
 assert.doesNotMatch(p,/filter:\s*(?:saturate|brightness)/);
 assert.doesNotMatch(p,/\.fy-quote-time\s*\{[^}]*display:\s*none/);
 assert.match(p,/\.fy-quote-time/);assert.match(p,/\.fy-terminal-provenance/);
 assert.match(p,/@media\(prefers-reduced-motion:reduce\)/);
});
