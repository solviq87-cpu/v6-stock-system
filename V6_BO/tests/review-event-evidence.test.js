'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../public/assets/review-event-evidence');
const day='20261117',closeAt=Date.parse('2026-11-17T15:00:00+08:00');
function sample(extra={},extraEvidence={}){
 return {sequence:1,recordedAt:closeAt-60000,current:true,supportStatus:'source-declared-unverified',
 evidence:{source:'fixture',eventId:'one',title:'公司公告标题待核验',kind:'original',url:'https://example.test/news',
  securities:['600000'],body:'消息摘要只是线索',bodyScope:'provider-summary',
  publishedAt:closeAt-3600000,receivedAt:closeAt-120000,revisedAt:null,...extraEvidence},...extra};
}
const plan=(rows,code='600000',date=day)=>M.view({rows},{code,date});
test('China-market close uses 15:00 +08 and rejects impossible review days',()=>{
 assert.equal(M.reviewCutoff(day).closeAt,closeAt);
 assert.equal(M.reviewCutoff('2026-11-17').closeAt,closeAt);
 for(const d of ['2026-02-30','20261301','202611','x','','20261117<script>'])assert.equal(M.reviewCutoff(d),null);
});
test('timely same-stock messages are context only, never a causal or independent attestation',()=>{
 const p=plan([sample()]);
 assert.equal(p.items.length,1);assert.equal(p.items[0].status.key,'context');
 assert.equal(p.items[0].verified,false);
 assert.match(p.items[0].status.label,/并非涨停因果认证/);
 assert.match(p.items[0].bodyScope,/供应商摘要/);
});
test('post-close publication and late receipt or archive do not masquerade as intraday evidence',()=>{
 assert.equal(plan([sample({}, {publishedAt:closeAt+1000})]).items[0].status.key,'postclose');
 assert.equal(plan([sample({}, {receivedAt:closeAt+1000})]).items[0].status.key,'late');
 assert.equal(plan([sample({recordedAt:closeAt+1000})]).items[0].status.key,'late');
 assert.equal(plan([sample({}, {publishedAt:null})]).items[0].status.key,'unknown');
 assert.equal(plan([sample({}, {publishedAt:closeAt-8*86400000})]).items[0].status.key,'old');
});
test('withdrawals and superseded versions are excluded as present supporting evidence',()=>{
 assert.equal(plan([sample({supportStatus:'retracted'}, {kind:'retracted'})]).items[0].status.key,'retracted');
 assert.equal(plan([sample({current:false})]).items[0].status.key,'superseded');
 const older=sample({sequence:1,current:false});
 const later=sample({sequence:2,current:true},{kind:'revised'});
 assert.equal(plan([older,later]).total,1);
 assert.equal(plan([older,later]).items[0].sequence,2);
});
test('stock association is strict and absent matches do not imply absence of risk',()=>{
 assert.equal(plan([sample({}, {securities:['000001']})]).items.length,0);
 assert.throws(()=>plan([], '000001"><img'));
 assert.throws(()=>plan([sample()], '600000','2026-99-99'));
 assert.throws(()=>M.view({rows:[]},{code:'600000',date:day,limit:999}));
 assert.throws(()=>M.view({rows:{}},{code:'600000',date:day}));
});
test('only HTTP(S) links without credentials are allowed; HTML is text, not markup',()=>{
 assert.equal(M.allowedUrl('javascript:alert(1)'),null);
 assert.equal(M.allowedUrl('https://user:pass@example.test/'),null);
 assert.equal(M.allowedUrl('https://example.test/a'),'https://example.test/a');
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.className='';}
  appendChild(c){this.children.push(c);return c;}
  replaceChildren(){this.children=[];}
 }
 const doc={createElement:tag=>new Node(tag)},panel=new Node('div');
 const p=plan([sample({}, {title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)'})]);
 M.render(doc,panel,p);
 const card=panel.children.find(x=>x.tag==='article');
 assert.ok(card);
 assert.match(card.children[0].textContent,/<img src=x/);
 assert.equal(card.children.filter(x=>x.tag==='a').length,0);
 assert.ok(card.children.some(x=>/来源声明未独立核实/.test(x.textContent)));
 assert.ok(card.children.some(x=>/事件实际发生日期：未核实/.test(x.textContent)));
 assert.ok(card.children.some(x=>/尚无业务合同或公告正文交叉证明/.test(x.textContent)));
 assert.ok(panel.children.some(x=>/不能独立证明涨停原因/.test(x.textContent)));
 const empty=new Node('div');M.render(doc,empty,plan([]));
 assert.ok(empty.children.some(x=>/证据不足/.test(x.textContent)));
});
test('approved homepages and legacy review controller remain frozen; enhancer loads independently',()=>{
 const root=path.resolve(__dirname,'..');
 const app=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
 const page=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const loader=fs.readFileSync(path.join(root,'public/assets/ui-navigation.js'),'utf8');
 const viewer=fs.readFileSync(path.join(root,'public/assets/review-event-evidence.js'),'utf8');
 const baseline=require('./fixtures/ui-homepage-approved-baseline-20261115.json');
 const crypto=require('node:crypto');
 const sha=x=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+x.length+'\0'),x])).digest('hex');
 assert.equal(sha(fs.readFileSync(path.join(root,'public/index.html'))),baseline.homepages['index.html']);
 assert.match(loader,/review-event-evidence\.js/);
 assert.match(viewer,/MutationObserver\(decorate\)/);
 assert.match(viewer,/\.rv-evidence-trigger/);
 assert.match(viewer,/document|doc\.getElementById/);
 assert.match(viewer,/题材标签不代表事件因果|题材标签不得冒充/);
 assert.doesNotMatch(page,/assets\/review-event-evidence\.js/);
 assert.match(app,/🔥 涨停原因/);
});
test('the old fetch shim cannot append bearer tokens to event requests or linked sources',()=>{
 const root=path.resolve(__dirname,'..');
 const app=fs.readFileSync(path.join(root,'public/assets/app.js'),'utf8');
 const viewer=fs.readFileSync(path.join(root,'public/assets/review-event-evidence.js'),'utf8');
 assert.match(app,/input\.indexOf\('\/api\/'\) === 0/,'legacy patch only rewrites relative API strings');
 assert.match(viewer,/sameOrigin\('\/api\/state'\)/);
 assert.match(viewer,/sameOrigin\('\/api\/research\/news-evidence\?symbol='/);
 assert.match(viewer,/Authorization:'Bearer '\+auth/);
 assert.match(viewer,/getRelToken/);
 assert.doesNotMatch(viewer,/['"]\/api\/research\/news-evidence\?symbol=['"]\s*\+/);
});
