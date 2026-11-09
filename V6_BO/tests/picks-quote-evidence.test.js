'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../public/assets/picks-page.js'), 'utf8');

class Element {
  constructor(tag='div') {
    this.tag=tag; this.children=[]; this.textContent=''; this.className='';
    this.listeners={}; this.value=''; this.disabled=false;
  }
  append(...items){ this.children.push(...items); }
  replaceChildren(...items){ this.children=items; }
  addEventListener(type, listener){ this.listeners[type]=listener; }
  setAttribute(name, value){ this[name]=String(value); }
}
test('candidate cards never label cache/server times as provider quotes, and distinguish stale, cross-day and future source time', async () => {
  const now = Date.parse('2026-11-10T03:00:00Z'); // 11:00 China time
  class FixedDate extends Date { static now(){ return now; } }
  const ids = Object.fromEntries(
    ['reload','board','sort','search','candidates','status','cloudSync','total','visible','explained','day']
      .map(id=>[id,new Element()])
  );
  ids.board.value='all'; ids.sort.value='original';
  const makeItem=(code,more)=>({code,name:code,hit:['实际条件'],...more});
  const items=[
    makeItem('000001',{vendorQuoteAt:now-30000,quoteSource:'eastmoney'}),
    makeItem('000002',{vendorQuoteAt:now-300000}),
    makeItem('000003',{vendorQuoteAt:now-86400000}),
    makeItem('000004',{vendorQuoteAt:now+120000}),
    makeItem('000005',{quoteAt:now,requestedAt:now,updatedAt:now})
  ];
  const calls=[];
  const dom={
    hidden:false,
    getElementById:id=>ids[id],
    createElement:tag=>new Element(tag),
    createDocumentFragment:()=>new Element('fragment'),
    addEventListener(){},dispatchEvent(){}
  };
  const context={
    document:dom,window:{addEventListener(){},setInterval(){}},
    localStorage:{getItem:()=>''},Date:FixedDate,
    URLSearchParams,AbortController,Number,String,Array,Object,Error,RegExp,Math,
    fetch:async(url,options)=>{calls.push({url,options});return {
      ok:true,json:async()=>({items,snapshotDay:'2026-11-10'})
    };}
  };
  vm.runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.total.textContent,5);
  const cards=ids.candidates.children[0].children;
  const proof=card=>card.children.find(x=>x.className==='footnote')?.textContent||'';
  assert.equal(cards.length,5);
  assert.match(proof(cards[0]),/第三方自报报价时点/);
  assert.match(proof(cards[0]),/来源标记：eastmoney（未认证）/);
  assert.match(proof(cards[0]),/仍未经实时认证/);
  assert.match(proof(cards[1]),/超过90秒/);
  assert.match(proof(cards[2]),/与候选快照交易日不一致/);
  assert.match(proof(cards[3]),/未来时间异常/);
  assert.match(proof(cards[4]),/逐票报价原始时点：未知/);
  assert.doesNotMatch(proof(cards[4]),/第三方自报/);
  assert.equal(calls.length,1,'evidence display must not trigger a separate market scan');
  assert.ok(calls.every(x=>x.options.method==='GET' && !/force=1/.test(x.url)));
});
