'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public/nova'),url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const parserSource=fs.readFileSync(path.join(root,'workbook.js'),'utf8'),parserUrl=url(parserSource),api=import(parserUrl);

test('native imported list preserves code identity and never confuses portfolio columns with codes',async()=>{
 const {parseStockList}=await api;
 const result=parseStockList('名称,数量,代码,价格\n甲,600519,000001,600000\n乙,0,600000,0\n另名,3,SZ000001,0');
 assert.deepEqual(result.items.map(item=>item.code),['000001','600000']);
 assert.equal(result.items[0].exchange,'SZ');assert.equal(result.duplicates[0].nameConflict,true);
 for(const code of ['SH000001','000001.SH','600000.SZ','920001','510300','1','6E5','=600000'])assert.equal(parseStockList(code).items.length,0,code);
 assert.throws(()=>parseStockList('code,symbol\n600519,000001'),/唯一/);
 assert.throws(()=>parseStockList('code,name\n600519,"bad'),/引号/);
 assert.throws(()=>parseStockList('股'.repeat(35000)),/100 KB/);
});

test('native JSON lists reject numeric guessing, report duplicates and enforce UTF-8 and symbol caps',async()=>{
 const {parseStockJson}=await api;
 const result=parseStockJson(JSON.stringify(['000001',{code:'SH600519',name:'<img onerror=x>'},600000,{code:'000001',name:'另一名'}]));
 assert.deepEqual(result.items.map(item=>item.code),['000001','600519']);
 assert.equal(result.rejected.length,1);assert.equal(result.duplicates.length,1);assert.equal(result.items[1].identityVerified,false);
 assert.throws(()=>parseStockJson('{"code":"600519"}'),/数组/);
 assert.throws(()=>parseStockJson(JSON.stringify(Array.from({length:101},(_,i)=>String(600000+i)))),/100 只/);
 assert.throws(()=>parseStockJson(JSON.stringify([{code:'600519',name:'坏\u0000字符'}])),/无效/);
});

test('native workbook payload preserves binary bytes and selected sheet within the server contract',async()=>{
 const {workbookPayload,MAX_WORKBOOK_BYTES}=await api;
 assert.deepEqual(workbookPayload(new Uint8Array([80,75,3,4,0,255]),'清单'),{base64:'UEsDBAD/',sheet:'清单'});
 assert.deepEqual(workbookPayload(new Uint8Array([1])),{base64:'AQ=='});
 assert.throws(()=>workbookPayload(new Uint8Array(MAX_WORKBOOK_BYTES+1)),/512KB/);
 assert.throws(()=>workbookPayload(new Uint8Array()),/512KB/);
});

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.files=[];this.value='';this.hidden=false;this.disabled=false;this._text='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
 set innerHTML(_){throw Error('must use text nodes');}
 setAttribute(key,value){this[key]=value;}
 addEventListener(name,fn,options={}){(this.handlers[name]??=[]).push(fn);options.signal?.addEventListener('abort',()=>{this.handlers[name]=this.handlers[name].filter(x=>x!==fn);},{once:true});}
 async fire(type){for(const fn of [...this.handlers[type]||[]])await fn({type,target:this});}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
async function setup(request){
 global.Node=Node;global.document={createElement:tag=>new Node(tag),createTextNode:text=>{const node=new Node('#text');node.textContent=text;return node;}};global.window=new Node('window');
 const uiUrl=url(fs.readFileSync(path.join(root,'ui.js'),'utf8'));
 const source=fs.readFileSync(path.join(root,'workbook-view.js'),'utf8').replace("'./ui.js'",JSON.stringify(uiUrl)).replace("'./workbook.js'",JSON.stringify(parserUrl));
 const {renderWorkbookImport}=await import(url(source));const controller=new AbortController(),selected=[],calls=[];
 const panel=renderWorkbookImport({role:'edit',signal:controller.signal,api:async(p,o)=>{calls.push({p,o});return request(p,o);},selectStock:code=>selected.push(code)});
 const nodes=descendants(panel),find=predicate=>nodes.find(predicate);
 return {panel,calls,selected,controller,text:find(n=>n.tagName==='textarea'),file:find(n=>n.tagName==='input'),sheet:find(n=>n.tagName==='select'),preview:find(n=>n.tagName==='button'&&n.textContent==='预览清单'),clear:find(n=>n.tagName==='button'&&n.textContent==='清空')};
}

test('native XLSX preview requires an explicit click and submits the exact sheet payload',async()=>{
 const {parseStockList}=await api;let count=0;
 const s=await setup(async()=>++count===1?{result:{sheets:[{name:'甲',available:true},{name:'隐藏',available:false}],selected:null,preview:null}}:{result:{sheets:[{name:'甲',available:true}],selected:'甲',preview:parseStockList('600519')}});
 s.file.files=[{name:'stocks.xlsx',size:4,arrayBuffer:async()=>new Uint8Array([80,75,3,4]).buffer}];
 await s.file.fire('change');assert.equal(s.calls.length,0);
 await s.preview.fire('click');assert.deepEqual(s.calls[0].o.body,{base64:'UEsDBA=='});assert.equal(s.calls[0].p,'/api/research/import-workbook');
 s.sheet.value='甲';await s.sheet.fire('change');await s.preview.fire('click');assert.deepEqual(s.calls[1].o.body,{base64:'UEsDBA==',sheet:'甲'});
 const select=descendants(s.panel).find(n=>n.tagName==='button'&&n.textContent==='选择研究');await select.fire('click');assert.deepEqual(s.selected,['600519']);assert.equal(s.calls.length,2,'selection never triggers capture');
 s.text.value='000001';await s.text.fire('input');await select.fire('click');assert.deepEqual(s.selected,['600519'],'old preview selection invalidated');
 s.controller.abort();
});

test('native imports fence stale file reads and network previews after input, clear, and navigation',async()=>{
 const {parseStockList}=await api;
 for(const action of ['input','clear','abort']){
  let finish;const s=await setup(()=>new Promise(resolve=>finish=resolve));
  s.file.files=[{name:'stocks.xlsx',size:4,arrayBuffer:async()=>new Uint8Array([80,75,3,4]).buffer}];await s.file.fire('change');
  const pending=s.preview.fire('click');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,1);
  if(action==='input'){s.text.value='000001';await s.text.fire('input');}else if(action==='clear')await s.clear.fire('click');else s.controller.abort();
  assert.equal(s.calls[0].o.signal.aborted,true,action);
  finish({result:{sheets:[{name:'旧表',available:true}],selected:'旧表',preview:parseStockList('600519')}});await pending;
  assert.equal(descendants(s.panel).some(n=>n.tagName==='button'&&n.textContent==='选择研究'),false,action);
  s.controller.abort();
 }
 let read;const s=await setup(()=>{throw Error('stale file must not upload');});s.file.files=[{name:'stocks.xlsx',size:4,arrayBuffer:()=>new Promise(resolve=>read=resolve)}];await s.file.fire('change');const pending=s.preview.fire('click');await s.clear.fire('click');read(new Uint8Array([80,75,3,4]).buffer);await pending;assert.equal(s.calls.length,0);s.controller.abort();
});
