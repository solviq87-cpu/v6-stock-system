'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../public/nova/fayo.css'),'utf8');
const app=fs.readFileSync(path.resolve(__dirname,'../public/nova/app.js'),'utf8');
const marker='/* FAYO shared pink-purple interaction palette (desktop + phone).';
const block=()=>{const i=css.lastIndexOf(marker);assert.ok(i>=0,'shared palette missing');return css.slice(i);};
const value=(name)=>block().match(new RegExp('--fy-action-'+name+':(#[a-f0-9]{6});'))?.[1];
function luminance(hex){
 return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
}
function contrast(a,b){return (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);}
test('pink-purple primary and selected control tokens meet 4.5:1 text contrast',()=>{
 for(const name of ['fill','hover','active']){
  const color=value(name),text=value('text');assert.ok(color&&text);
  assert.ok(contrast(color,text)>=4.5,name);
 }
 assert.ok(contrast(value('border'),value('active'))>=3,'selected indicator contrast');
 assert.ok(contrast(value('focus'),value('fill'))>=3,'focus indicator contrast');
});
test('one shared scoped palette covers existing desktop, mobile and review navigation',()=>{
 const s=block();for(const name of ['fy-reference-topnav','fy-business-nav','fy-workspace-nav','fy-dock','fy-subnav','fy-tabs'])
  assert.ok(s.includes('.'+name),name);
 assert.match(app,/class:'fy-dock'/);assert.match(app,/class:'fy-reference-topnav'/);
 assert.match(s,/background:var\(--fy-action-active\);color:var\(--fy-action-text\)/);
 assert.match(s,/\[aria-current="page"\]/);assert.match(s,/\[data-current="true"\]/);
 assert.match(s,/\.fy-reference-shell\[data-terminal-view\]/);
});
test('palette is additive and preserves semantic colors, geometry and visible focus',()=>{
 const s=block();
 assert.doesNotMatch(s,/\.fy-positive|\.fy-negative|data-risk-severity|data-weather|display\s*:|font-size\s*:|(?:min-|max-)?(?:width|height)\s*:/);
 assert.match(s,/\.fy-decision-actions \.primary/);
 assert.match(s,/\.fy-home-opportunity>header \.fy-button\.primary/);
 assert.match(s,/:focus-visible\s*\{\s*outline:2px solid var\(--fy-action-focus\)/);
 assert.match(css,/strong\.fy-positive\{color:#ff7188/);
 assert.match(css,/strong\.fy-negative\{color:#45e0ad/);
});
