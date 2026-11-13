'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/assets/news-evidence-workbench.js'),'utf8');
class Element{
 constructor(){this.value='';this.textContent='';this.children=[];this.events={};this.disabled=false;}
 appendChild(child){this.children.push(child);}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,fn){(this.events[name]||=[]).push(fn);}
 fire(name){return Promise.all((this.events[name]||[]).map(fn=>fn()));}
}
function fixture(){
 const elements=Object.fromEntries(['newsEvidenceLoad','token','newsEvidenceSymbol','newsEvidenceStatus','newsEvidenceRows'].map(id=>[id,new Element()]));
 elements.token.value='fixture-editor';
 const doc=new Element();doc.hidden=false;doc.getElementById=id=>elements[id];doc.createElement=()=>new Element();
 const calls=[],root=new Element();root.document=doc;
 const fetch=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 vm.runInNewContext(source,{window:root,fetch,URL,Date,Number});
 const reply=(index,title='PRIVATE_NEWS')=>calls[index].resolve({ok:true,json:async()=>({ok:true,result:{summary:{currentEvents:1,retractedEvents:0,unknownEvents:0,eligibleForResearchSupport:1},rows:[{sequence:1,supportStatus:'source-declared-unverified',evidence:{kind:'original',title,body:'private',securities:[]}}]}})});
 return {...elements,doc,root,calls,reply};
}
test('news private results clear on hiding and delayed responses cannot restore them',async()=>{
 const f=fixture(),first=f.newsEvidenceLoad.fire('click');f.reply(0);await first;
 assert.equal(f.newsEvidenceRows.children.length,1);
 const pending=f.newsEvidenceLoad.fire('click');f.doc.hidden=true;await f.doc.fire('visibilitychange');
 assert.equal(f.newsEvidenceRows.children.length,0);f.reply(1);await pending;
 assert.equal(f.newsEvidenceRows.children.length,0);
 f.doc.hidden=false;const third=f.newsEvidenceLoad.fire('click');f.reply(2);await third;
 await f.root.fire('pagehide');assert.equal(f.newsEvidenceRows.children.length,0);
});
test('credential and symbol changes invalidate old news requests without enabling a newer pending request',async()=>{
 const f=fixture(),old=f.newsEvidenceLoad.fire('click');
 f.token.value='new-fixture-editor';await f.token.fire('change');
 const current=f.newsEvidenceLoad.fire('click');assert.equal(f.newsEvidenceLoad.disabled,true);
 f.reply(0,'OLD_PRIVATE');await old;assert.equal(f.newsEvidenceRows.children.length,0);assert.equal(f.newsEvidenceLoad.disabled,true);
 f.reply(1,'CURRENT_PRIVATE');await current;assert.equal(f.newsEvidenceRows.children.length,1);
 const bySymbol=f.newsEvidenceLoad.fire('click');f.newsEvidenceSymbol.value='600000';await f.newsEvidenceSymbol.fire('input');
 f.reply(2);await bySymbol;assert.equal(f.newsEvidenceRows.children.length,0);
 assert.ok(f.calls.every(c=>c.options.cache==='no-store'&&!c.url.includes('token=')));
});
test('news permission failure and offline transition remove already displayed private evidence',async()=>{
 const f=fixture(),first=f.newsEvidenceLoad.fire('click');f.reply(0);await first;
 const denied=f.newsEvidenceLoad.fire('click');f.calls[1].resolve({ok:true,json:async()=>({ok:false,error:'权限不足'})});await denied;
 assert.equal(f.newsEvidenceRows.children.length,0);assert.match(f.newsEvidenceStatus.textContent,/证据未知/);
 const next=f.newsEvidenceLoad.fire('click');f.reply(2);await next;assert.equal(f.newsEvidenceRows.children.length,1);
 await f.root.fire('offline');assert.equal(f.newsEvidenceRows.children.length,0);
});
