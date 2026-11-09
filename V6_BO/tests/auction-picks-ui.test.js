'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'public/assets/auction-picks-page.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/auction-picks.html'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('new auction page is reachable from mobile and desktop; static shell is whitelisted but data remains gated',()=>{
 for(const file of ['public/index.html','public/mobile.html','public/picks.html','public/research.html'])
  assert.match(fs.readFileSync(path.join(root,file),'utf8'),/href="\/auction-picks\.html"/);
 assert.match(html,/id="results"/);
 assert.match(html,/id="search"/);
 assert.match(html,/id="reload"/);
 assert.match(html,/assets\/auction-picks-page\.js/);
 assert.match(html,/grid-template-columns:repeat\(7,/);
 assert.match(html,/逐票原始报价/);
 assert.match(server,/const isAsset = [^\n]*p === '\/auction-picks\.html'/);
 assert.doesNotMatch(script,/fetch\(['"]\/api\/state|\bPOST\b|force=1|localStorage\.setItem/);
 assert.match(script,/fetch\('\/api\/auction-resonance\?'/);
 assert.match(script,/method:'GET'/);
});
test('auction research view retains stale snapshot on outage, clears on 403/locked and never invents price time',async()=>{
 class Element {
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.className='';
   this.listeners=Object.create(null);this.value='';this.disabled=false;}
  append(...elements){this.children.push(...elements);}
  replaceChildren(...elements){this.children=elements;}
  addEventListener(name,callback){this.listeners[name]=callback;}
 }
 const ids=Object.fromEntries(['reload','search','board','sort','status','synced','total','visible','explained','results']
  .map(id=>[id,new Element('div')]));
 ids.board.value='all';ids.sort.value='original';
 const replies=[
  {ok:true,json:async()=>({asOf:Date.parse('2026-11-09T09:25:20+08:00'),
   items:[{code:'000001',name:'Test',score:'0x10',auctionPct:'   ',pct:null,
     reasons:['本接口原有共振条件'],sector:'设备'}]})},
  Error('offline'),
  {ok:false,status:403},
  {ok:true,json:async()=>({items:[{code:'000002',name:'Resumed',score:72,reasons:[]}],asOf:Date.now()})},
  {ok:true,json:async()=>({locked:true,items:[]})}
 ];
 const calls=[];
 const fetch=async(url,opts)=>{calls.push({url,opts});const next=replies.shift();if(next instanceof Error)throw next;return next;};
 const ctx={document:{hidden:false,getElementById:id=>ids[id],createElement:t=>new Element(t),
  createDocumentFragment:()=>new Element('fragment'),addEventListener(){}},
  window:{addEventListener(){},setInterval(){}},localStorage:{getItem:()=>''},
  Date,Number,Math,URLSearchParams,AbortController,fetch};
 vm.runInNewContext(script,ctx);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ids.total.textContent,1);
 assert.match(ids.status.textContent,/9:20\/9:25新战法仍需原始时点/);
 assert.match(ids.synced.textContent,/不是逐票原始报价时点/);
 const texts=[];
 function walk(el){if(typeof el?.textContent==='string')texts.push(el.textContent);
  for(const child of el?.children||[])walk(child);}
 walk(ids.results);
 assert.ok(texts.some(x=>x.includes('竞价涨幅 未知')));
 assert.ok(texts.includes('—'));
 assert.ok(texts.some(x=>x.includes('逐票竞价原始报价时间：未知')));
 await ids.reload.listeners.click();
 assert.equal(ids.total.textContent,1);
 assert.match(ids.status.textContent,/保留上次结果（非实时）/);
 await ids.reload.listeners.click();
 assert.equal(ids.total.textContent,'—');
 assert.match(ids.synced.textContent,/查看权限已撤销/);
 await ids.reload.listeners.click();
 assert.equal(ids.total.textContent,1);
 await ids.reload.listeners.click();
 assert.equal(ids.total.textContent,'—');
 assert.match(ids.status.textContent,/需要重新授权/);
 assert.equal(calls.length,5);
 for(const call of calls){
  assert.match(call.url,/\/api\/auction-resonance\?board=all&max=40/);
  assert.equal(call.opts.method,'GET');
  assert.doesNotMatch(call.url,/force|POST/);
 }
});
