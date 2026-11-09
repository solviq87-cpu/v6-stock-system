'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {paginateKlineRows}=require('../src/core/kline-read-pagination');
const periods=require('../public/assets/picks-periods');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const client=fs.readFileSync(path.join(root,'public/assets/picks-three-k.js'),'utf8');
function days(n){
 const rows=[];
 for(let i=0;i<n;i++){
  const date=new Date(Date.UTC(2022,0,i+1)).toISOString().slice(0,10);
  const close=10+i*.01;
  rows.push({date,open:close-.02,high:close+.1,low:close-.1,close,volume:1000+i});
 }
 return rows;
}
test('historical exclusive-end cursor returns 240 latest bars then disjoint older pages',()=>{
 const rows=days(650),first=paginateKlineRows(rows,{n:1200});
 assert.equal(first.n,240,'server cap is 240 even when browser asks for 1200');
 assert.equal(first.rows[0].date,rows[410].date);
 assert.equal(first.rows.at(-1).date,rows[649].date);
 assert.equal(first.hasMore,true);
 assert.equal(first.nextEnd,rows[410].date.replace(/-/g,''));
 const second=paginateKlineRows(rows,{n:240,end:first.nextEnd});
 assert.equal(second.n,240);
 assert.equal(second.rows[0].date,rows[170].date);
 assert.equal(second.rows.at(-1).date,rows[409].date);
 assert.ok(second.rows.at(-1).date<first.rows[0].date);
 const third=paginateKlineRows(rows,{n:240,end:second.nextEnd});
 assert.equal(third.n,170);assert.equal(third.hasMore,false);
 assert.equal(third.rows.at(-1).date,rows[169].date);
 const beyond=paginateKlineRows(rows,{end:rows[0].date.replace(/-/g,'')});
 assert.equal(beyond.n,0);assert.equal(beyond.asOf,null);
 assert.equal(beyond.nextEnd,null);
 assert.equal(beyond.hasMore,false);
});
test('historical pagination rejects future leakage, invalid calendar cutoffs and duplicate/unsorted dates',()=>{
 const rows=days(10);
 const boundary=rows[6].date.replace(/-/g,'');
 const slice=paginateKlineRows(rows,{n:20,end:boundary});
 assert.equal(slice.rows.length,6);
 assert.ok(slice.rows.every(x=>x.date<rows[6].date));
 for(const end of ['garbage','20260230','20261301','2026119','20260101z']){
  assert.throws(()=>paginateKlineRows(rows,{end}),/日期/);
 }
 assert.throws(()=>paginateKlineRows([...rows,rows[5]],{}),/重叠|非升序/);
 assert.throws(()=>paginateKlineRows([rows[1],rows[0]],{}),/非升序/);
});
test('server Kline route uses real cursor helper; protected API and both homepage hashes remain locked',()=>{
 assert.match(server,/if \(p === '\/api\/kline' && req\.method === 'GET'\)/);
 const a=server.indexOf("if (p === '/api/kline'");
 const route=server.slice(a,a+1750);
 assert.match(route,/paginateKlineRows/);
 assert.match(route,/\.\.\.page/); // cursor, hasMore and date come from the page object
 assert.doesNotMatch(route,/findIndex\(r => String\(r\.date\).*< end/);
 assert.match(client,/PAGE_SIZE=240,MAX_PAGES=6/);
 assert.match(client,/const hiddenFirst=period!=='day'&&hasMore&&bars.length>0/);
 assert.match(client,/hiddenFirst\?bars\.slice\(1\):bars/);
 assert.match(client,/最早未完整周期已隐藏/);
 assert.match(client,/更早历史未向前推进/);
 assert.match(client,/hasMore=true;/);
 assert.match(client,/最早周期不展示/);
 assert.match(client,/\&end=/);
 assert.doesNotMatch(client,/force=1|method:'POST'/);
});
test('month/year lazy loading asks for more real pages while day-only selection stays at one request',async()=>{
 const data=days(1200),buttons=['day','month','year'].map(period=>({
  dataset:{period},classList:{toggle(){}},setAttribute(){},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}
 }));
 class El{
  constructor(tag='div'){this.tag=tag;this.textContent='';this.children=[];this.attributes={};}
  replaceChildren(...items){this.children=items;}
  append(...items){this.children.push(...items);}
  setAttribute(key,value){this.attributes[key]=value;}
  scrollIntoView(){}
 }
 const els=Object.fromEntries(['pickDetailCode','pickDetailCaption','detailReasons','detailRisk',
  'detailQuote','periodStatus','periodChart','pickDetail'].map(id=>[id,new El()]));
 const listeners={},requests=[];
 const fakeFetch=async url=>{
  requests.push(url);
  const u=new URL(url,'http://localhost');
  const page=paginateKlineRows(data,{n:u.searchParams.get('n'),end:u.searchParams.get('end')||''});
  return {ok:true,json:async()=>({ok:true,code:u.searchParams.get('code'),...page})};
 };
 const context={
  window:{V6PicksPeriods:periods},
  document:{getElementById:id=>els[id],createTextNode:s=>({textContent:s}),
   createElement:name=>new El(name),createElementNS:(_ns,name)=>new El(name),
   querySelectorAll:()=>buttons,addEventListener:(name,cb)=>listeners[name]=cb},
  matchMedia:()=>({matches:false}),fetch:fakeFetch,AbortController,URL,
  Date,Math,String,Number,Array,Error,Object
 };
 vm.runInNewContext(client,context);
 listeners['v6:picks-select']({detail:{code:'000001',name:'Test stock',
  reasons:['服务器确实返回的命中条件'],risk:'unknown'}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1,'day should only need latest 240 rows');
 assert.match(requests[0],/n=240/);
 buttons[1].listeners.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(requests.length>=3,'month should ask for older pages');
 assert.ok(requests.slice(1).every(u=>u.includes('&end=')));
 assert.match(els.periodStatus.textContent,/月K/);
 const afterMonth=requests.length;
 buttons[2].listeners.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(requests.length>=afterMonth,'year reuses cached daily bars');
 assert.match(els.periodStatus.textContent,/年K/);
 assert.ok(els.periodChart.children.some(x=>x.tag==='svg'));
 assert.match(els.periodStatus.textContent,/最新周期可能未结束/);
 listeners['v6:picks-unauthorized']();
 assert.match(els.periodStatus.textContent,/权限已失效/);
 assert.equal(els.periodChart.children[0].textContent,'没有已选择的股票');
});
