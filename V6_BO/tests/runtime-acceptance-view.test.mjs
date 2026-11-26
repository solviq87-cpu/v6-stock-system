import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRuntimeObservationCoverage} from '../public/nova/deep-research.js';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.text='';}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(key,value){this.attrs[key]=value;}
 get textContent(){return this.text+this.children.map(child=>child instanceof Element?child.textContent:String(child)).join(' ');}
 set textContent(value){this.text=String(value);this.children=[];}
}
function render(t,observation){
 const saved={document:globalThis.document,Node:globalThis.Node};
 globalThis.Node=Element;globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 t.after(()=>{globalThis.document=saved.document;globalThis.Node=saved.Node;});return renderRuntimeObservationCoverage(observation).textContent;
}
const day='2026-11-26';
const held={scope:'original-monitor-held-symbols-v1',attemptedMinutes:3,observedMinutes:2,missingMinutes:1,observedExpectedSymbolMinutes:442,observedFreshSymbolMinutes:440,fullMarketCertified:false};
const account={scope:'original-paper-local-joint-reconciliation-v1',attempted:3,verifiedLocal:1,unsuccessful:1,unknown:1,verifiedExternal:false};
test('runtime coverage page labels missing receipt minutes and does not promote a partial quote population to full coverage',t=>{
 const text=render(t,{elapsedTradingDays:1,elapsedTradingDaysComplete:false,calendar:{omittedAttemptDays:[day],versionMismatchDays:[day]},days:[{day,heldMonitorCoverage:held,accountReconciliation:account}]});
 assert.match(text,/完整范围待核/);assert.match(text,/2 \/ 3（缺 1）/);assert.match(text,/440 \/ 442 · 99\.55%/);assert.match(text,/本地一致 1 · 未成功 1 · 未知 1/);assert.match(text,/不代表全市场覆盖或外部券商对账/);
});
test('empty or malformed counts display unknown rather than perfect or zero coverage',t=>{
 const text=render(t,{elapsedTradingDays:1,days:[{day,heldMonitorCoverage:{...held,observedFreshSymbolMinutes:999},accountReconciliation:{...account,verifiedLocal:4}}]});
 assert.match(text,/完整范围待核/);assert.doesNotMatch(text,/999|225\.\d+%|本地一致 4/);assert.ok((text.match(/未知/g)||[]).length>=3);
});
test('no original observations shows the explicit empty state',t=>{
 const text=render(t,{elapsedTradingDays:0,elapsedTradingDaysComplete:null,days:[]});assert.match(text,/尚无真实观察回执/);assert.doesNotMatch(text,/100\.00%|本地一致 0/);
});
