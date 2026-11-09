'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p));
const text=p=>file(p).toString('utf8');
const blobHash=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const {normalize,aggregate}=require('../public/assets/picks-periods.js');
test('the two owner-approved homepages are IDENTICAL byte-for-byte to prior approved Git blobs',()=>{
 assert.equal(blobHash(file('public/index.html')),'53471292a61871a5d137a53d978cd4a7cfe9a322','DO NOT MODIFY DESKTOP HOMEPAGE');
 assert.equal(blobHash(file('public/mobile.html')),'ee89ef7a27135bfc21b6214c55acfe498c7bf85b','DO NOT MODIFY MOBILE HOMEPAGE');
});
const example=[
 {date:'2025-12-30',open:10,high:11,low:9.5,close:10.5,volume:100},
 {date:'2025-12-31',open:10.5,high:12,low:10,close:11.5,volume:120},
 {date:'2026-01-02',open:12,high:13,low:11.5,close:12.5,volume:140},
 {date:'2026-01-05',open:12.5,high:14,low:12,close:13,volume:160},
 {date:'2026-02-02',open:13.4,high:15,low:13.1,close:14,volume:170},
];
test('month and year OHLC aggregation uses only real completed daily rows, not fabricated prices',()=>{
 const month=aggregate(example,'month');
 assert.equal(month.length,3);
 assert.deepEqual(month[0],{period:'2025-12',date:'2025-12-31',open:10,high:12,low:9.5,close:11.5,volume:220,sessions:2});
 assert.deepEqual(month[1],{period:'2026-01',date:'2026-01-05',open:12,high:14,low:11.5,close:13,volume:300,sessions:2});
 const year=aggregate(example,'year');
 assert.equal(year.length,2);
 assert.deepEqual(year[1],{period:'2026',date:'2026-02-02',open:12,high:15,low:11.5,close:14,volume:470,sessions:3});
 assert.equal(aggregate(example,'day').length,5);
});
test('duplicates, invalid and missing source data are never silently counted as more trading days',()=>{
 const junk=[
 ...example.slice(0,2).reverse(),
 {...example[0]}, // same day would otherwise amplify volume
 {date:'2026-02-29',open:12,high:12,low:12,close:12},
 {date:'2026-03-02',open:0,high:1,low:0,close:1},
 {date:'2026-03-03',open:12,high:11,low:9,close:10},
 ];
 assert.equal(normalize(junk).length,2);
 assert.equal(aggregate(junk,'month')[0].volume,220);
 assert.equal(aggregate(junk,'year')[0].sessions,2);
 assert.deepEqual(aggregate(null,'month'),[]);
 assert.throws(()=>aggregate(example,'week'),/unsupported/);
});
test('every candidate has a clear hit-label area and links to only one three-period detail',()=>{
 const html=text('public/picks.html'),js=text('public/assets/picks-page.js');
 assert.equal((html.match(/data-period="day"/g)||[]).length,1);
 assert.equal((html.match(/data-period="month"/g)||[]).length,1);
 assert.equal((html.match(/data-period="year"/g)||[]).length,1);
 assert.ok(html.includes('id="pickDetail"'));
 assert.ok(html.includes('id="candidates"'));
 assert.ok(js.includes("node('div','hit-tags')"));
 assert.ok(js.includes('v6:picks-select'));
 assert.ok(js.includes("v6:picks-unauthorized"));
 assert.ok(js.includes('v6:picks-reset'));
 assert.match(js,/\/api\/quant-picks\?/);
 assert.doesNotMatch(js,/force=1|method\s*:\s*['"]POST/);
});
test('viewer switches day/month/year without creating historical prices or order requests',()=>{
 const js=text('public/assets/picks-three-k.js');
 assert.ok(js.includes("source.aggregate(daily,period)"));
 assert.ok(js.includes("'/api/kline?code='"));
 assert.ok(js.includes('AbortController'));
 assert.ok(js.includes('if(turn!==generation)return'));
 assert.ok(js.includes('n=1200'));
 assert.ok(js.includes('数据不足'));
 assert.ok(js.includes('最新周期可能未结束'));
 assert.ok(js.includes('v6:picks-unauthorized'));
 assert.doesNotMatch(js,/\/api\/(?:trade|order|paper\/submit|push\/send)|force=1|method:'POST'/);
});
test('independent desktop and mobile responsive selection page never modifies original homepages',()=>{
 const css=text('public/assets/picks-three-k.css');
 assert.match(css,/\.picks-layout\{display:grid;grid-template-columns:/);
 assert.match(css,/@media\(max-width:900px\)/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/\.period-tabs\{display:grid/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
