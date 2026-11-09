'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const {normalize,aggregate}=require('../public/assets/picks-periods.js');
// Evaluate the exact server route's small pagination expression, not a copy of
// the algorithm, to catch reintroductions of findIndex(date < end).
const anchor="if (p === '/api/kline' && req.method === 'GET')";
const start=server.indexOf(anchor);
assert.ok(start>0,'read-only Kline API route missing');
const route=server.slice(start,start+2400);
const body=route.match(/if \(end\) \{([\s\S]*?)\} else tail = rows\.slice\(-n\);/);
assert.ok(body,'server historic page selection expression changed: review pagination tests');
const paginate=new Function('rows','n','end','let tail; if(end){'+body[1]+'}else tail=rows.slice(-n);return tail;');
const dataset=[
 {date:'2026-02-26'},{date:'2026-02-27'}, {date:'2026-03-02'},
 {date:'2026-03-03'},{date:'2026-03-04'}
];
test('real Kline server paginates strictly before end date, never repeats boundary',()=>{
 assert.deepEqual(paginate(dataset,2,''),dataset.slice(-2));
 assert.deepEqual(paginate(dataset,2,'20260304'),dataset.slice(2,4));
 assert.deepEqual(paginate(dataset,2,'20260302'),dataset.slice(0,2));
 assert.deepEqual(paginate(dataset,2,'20260226'),[]);
 assert.deepEqual(paginate(dataset,2,'20271231'),dataset.slice(-2));
 const next=paginate(dataset,2,'20260302');
 assert.ok(next.every(r=>r.date.replace(/-/g,'')<'20260302'));
});
test('exhausted older history returns empty page safely with null asOf and no MA calculation',()=>{
 assert.match(route,/asOf: tail\.length \? tail\[tail\.length - 1\]\.date : null/);
 assert.match(route,/ma: tail\.length \? klineMaOf\(tail\) : \[\]/);
 assert.match(route,/Math\.min\(240/);
});
test('multi-page daily candles aggregate into monthly/yearly K-lines without duplicate days',()=>{
 const days=[];
 const first=new Date(Date.UTC(2023,0,1));
 for(let i=0;days.length<500&&i<760;i++){
  const date=new Date(first.getTime()+i*86400000);
  if([0,6].includes(date.getUTCDay()))continue;
  const n=days.length,p=10+n*.01;
  days.push({date:date.toISOString().slice(0,10),open:p,close:p+.02,high:p+.08,low:p-.05,volume:100+n});
 }
 const page1=paginate(days,240,''),page2=paginate(days,240,page1[0].date.replace(/-/g,'')),
  page3=paginate(days,240,page2[0].date.replace(/-/g,''));
 assert.deepEqual([page1.length,page2.length,page3.length],[240,240,20]);
 assert.equal(page1.at(-1).date,days.at(-1).date);
 assert.ok(page2.at(-1).date<page1[0].date);
 assert.ok(page3.at(-1).date<page2[0].date);
 const clean=normalize([...page3,...page2,...page1]);
 assert.equal(clean.length,500);
 const years=aggregate(clean,'year');
 assert.ok(years.length>=2);
 assert.equal(years.reduce((s,y)=>s+y.sessions,0),500);
 assert.equal(years.at(-1).close,days.at(-1).close);
});
test('client rejects partial/duplicate history and mismatched stock, never trades',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../public/assets/picks-three-k.js'),'utf8');
 assert.match(js,/const PAGE=240,MAX_PAGES=10/);
 assert.match(js,/if\(merged\.length<=daily\.length\|\|merged\[0\]\.date>=earliest\)/);
 assert.match(js,/const incompleteOldest=period!=='day'&&hasOlder&&bars\.length>1/);
 assert.match(js,/更早数据未正确翻页/);
 assert.match(js,/当前数据不足，不能凭空生成/);
 assert.match(js,/result\.code&&String\(result\.code\)!==code/);
 assert.doesNotMatch(js,/method:'POST'|\/api\/trade|\/api\/push|force=1/);
});
