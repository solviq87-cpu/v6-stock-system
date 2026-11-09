'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/assets/picks-page.js'), 'utf8');

test('cloud timeout retains a labeled stale view; permission revocation clears cached candidates', async () => {
  class Element {
    constructor(tag) {
      this.tag = tag; this.textContent = ''; this.children = []; this.className = '';
      this.listeners = Object.create(null); this.value = ''; this.disabled = false;
    }
    append(...elements) { this.children.push(...elements); }
    replaceChildren(...elements) { this.children = elements; }
    addEventListener(eventName, listener) { this.listeners[eventName] = listener; }
  }
  const ids = Object.fromEntries(
    ['reload','board','sort','search','candidates','status','cloudSync','total','visible','explained','day']
      .map(id => [id, new Element('div')])
  );
  ids.board.value = 'all';
  ids.sort.value = 'original';
  const results = [
    {ok:true, json:async()=>({items:[{code:'000001',name:'Test candidate',score:'0x10',pct:'   ',hit:['valid signal']}],snapshotDay:'2026-11-06'})},
    Error('network offline'),
    {ok:false,status:403},
    {ok:true,json:async()=>({items:[{code:'000002',name:'Fresh candidate'}],snapshotDay:'2026-11-09'})},
    {ok:true,json:async()=>({locked:true,items:[]})}
  ];
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({url,options});
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result;
  };
  const context = {
    document: {
      hidden:false,
      getElementById:id=>ids[id],
      createElement:tag=>new Element(tag),
      createDocumentFragment:()=>new Element('fragment'),
      addEventListener(){}
    },
    window:{addEventListener(){},setInterval(){}},
    localStorage:{getItem:()=>''},
    fetch:fakeFetch,
    URLSearchParams,AbortController,Date,Number,String,Array,RegExp,Error
  };
  vm.runInNewContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.total.textContent,1);
  assert.equal(ids.day.textContent,'2026-11-06');
  assert.equal(ids.explained.textContent,1);
  const texts = [];
  function collect(el) {
    if (typeof el?.textContent === 'string') texts.push(el.textContent);
    for (const child of el?.children || []) collect(child);
  }
  collect(ids.candidates);
  assert.ok(texts.includes('涨跌未知'), 'blank percent cannot be coerced to 0%');
  assert.ok(texts.includes('—'), 'hex score cannot be coerced to 16');

  await ids.reload.listeners.click();
  assert.equal(ids.total.textContent,1,'keep previous result on transport failure');
  assert.match(ids.status.textContent,/保留本页上次读取结果（非实时）/);
  assert.equal(ids.day.textContent,'2026-11-06');

  await ids.reload.listeners.click();
  assert.equal(ids.total.textContent,'—','403 clears the prior result');
  assert.equal(ids.explained.textContent,'—');
  assert.equal(ids.day.textContent,'未知');
  assert.match(ids.cloudSync.textContent,/已清空之前的候选画面/);
  assert.match(ids.status.textContent,/没有只读查看权限/);

  await ids.reload.listeners.click();
  assert.equal(ids.total.textContent,1,'successful reauthorization can repopulate');
  assert.equal(ids.day.textContent,'2026-11-09');

  await ids.reload.listeners.click();
  assert.equal(ids.total.textContent,'—','locked=true also invalidates cached result');
  assert.equal(ids.day.textContent,'未知');
  assert.match(ids.status.textContent,/无权查看候选池/);
  assert.equal(calls.length,5);
  for (const call of calls) assert.equal(call.options.method,'GET');
});
