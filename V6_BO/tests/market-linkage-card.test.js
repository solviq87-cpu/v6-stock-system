'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../public/assets/market-linkage-card');
function fixture(){
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.hidden=false;this.ownText='';this.ownerDocument=doc;this.classList={add(){}};}
  append(e){this.children.push(e);}
  replaceChildren(){this.children=[];this.ownText='';}
  set textContent(x){this.ownText=x;this.children=[];}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join('');}
  setAttribute(k,v){this.attributes[k]=v;}
 }
 const doc={createElement:tag=>new Element(tag)},host=new Element('section');
 const all=(tag,parent=host)=>parent.children.flatMap(x=>[...(x.tagName===tag?[x]:[]),...all(tag,x)]);
 return {host,all,click:e=>e.dispatchEvent(new Event('click')),choose:value=>{const s=all('select')[0];s.value=value;s.dispatchEvent(new Event('change'));}};
}
function data(){return {status:'partial',tradeDate:'2026-11-13',asOf:1794562800000,source:'archived',returnBasis:'price',symbol:'600000',window:{start:1794476400000,end:1794562800000},classification:{provider:'test',version:'v1'},benchmark:{provider:'test',name:'上证综指',code:'000001',return:.002},attribution:{status:'partial-estimate',coverageWeight:.8,residualReturn:.001,residualPoints:3,unknownIndustryContribution:0,industries:[{code:'A',name:'银行',contribution:.004,points:12},{code:'B',name:'汽车',contribution:-.003,points:-9}]},boards:[{code:'A',name:'银行',category:'industry',return:.01,relativeReturn:.008,breadth:{up:1,down:1,flat:0,missing:1,coverage:2/3},concentration:1,memberCount:3,members:[{symbol:'600000',return:.03,relativeReturn:.02,rank:1,sampleSize:2,role:'relative-front'},{symbol:'600001',return:-.01,relativeReturn:-.02,rank:2,sampleSize:2,role:'relative-back'}]}],unknownReasons:['intraday-lead-follow-unavailable']};}
test('decimal returns, weights and point contributions preserve sign and missingness',()=>{
 assert.equal(C.pct(.03),'+3.00%');assert.equal(C.pct(-.01),'-1.00%');assert.equal(C.pct(null),'未知');assert.equal(C.pct(undefined),'未知');assert.equal(C.ratio(.8),'80.0%');assert.equal(C.points(-9),'-9.00点');
 const f=fixture();C.render(f.host,data());assert.match(f.host.textContent,/上证综指 000001/);assert.match(f.host.textContent,/\+0.40个百分点 \/ \+12.00点/);assert.match(f.host.textContent,/-0.30个百分点 \/ -9.00点/);assert.match(f.host.textContent,/80.0%/);assert.match(f.host.textContent,/缺少分时先行与跟随证据/);
});
test('member selection displays same snapshot role locally; only explicit inspect invokes callback',()=>{
 const f=fixture(),calls=[];C.render(f.host,data(),{onInspect:s=>calls.push(s)});f.click(f.all('button').find(b=>b.dataset.linkageSymbol==='600001'));
 assert.deepEqual(calls,[]);assert.match(f.host.textContent,/600001 · 当期相对后排/);assert.match(f.host.textContent,/-2.00%/);assert.match(f.host.textContent,/第 2 \/ 2 个有效成员/);f.click(f.all('button').find(b=>b.textContent==='查看该股研究'));assert.deepEqual(calls,['600001']);
});
test('switching selected research stock at the same timestamp selects the new member; version changes clear old selection',()=>{
 const f=fixture(),calls=[],d=data();d.sourceRunId='old-run';C.render(f.host,d,{onInspect:s=>calls.push(s)});C.clear(f.host);
 const next=data();next.symbol='600001';next.sourceRunId='new-run';C.render(f.host,next,{onInspect:s=>calls.push(s)});
 assert.match(f.host.textContent,/600001 · 当期相对后排/);assert.doesNotMatch(f.host.textContent,/600000 · 当期相对前排/);
 f.click(f.all('button').find(b=>b.textContent==='查看该股研究'));assert.deepEqual(calls,['600001']);
 const revised=structuredClone(next);revised.sourceRunId='revised-run';C.render(f.host,revised);assert.equal(f.all('select')[0].value,'');assert.equal(f.all('button').length,0);
});
test('loading clears visible content, same snapshot retains sector and member; changed identity requires selection',()=>{
 const f=fixture(),d=data();C.render(f.host,d);f.click(f.all('button').find(b=>b.dataset.linkageSymbol==='600001'));C.clear(f.host);assert.equal(f.host.hidden,true);assert.equal(f.host.textContent,'');C.render(f.host,d);assert.match(f.host.textContent,/600001 · 当期相对后排/);
 const changed=data();changed.classification.version='v2';C.render(f.host,changed);assert.equal(f.all('select')[0].value,'');assert.match(f.host.textContent,/原板块与当前版本不可比/);assert.equal(f.all('button').length,0);
 const replaced=data();replaced.boards[0].members[1].symbol='600002';C.render(f.host,replaced);assert.equal(f.all('select')[0].value,'','equal count with replaced members must not retain sector context');
});
test('benchmark, source clock or window changes invalidate sector selection; privacy clear drops selection',()=>{
 for(const mutate of [d=>d.benchmark.code='000300',d=>d.asOf++,d=>d.window.start++,d=>d.source='another']){const f=fixture();C.render(f.host,data());const d=data();mutate(d);C.render(f.host,d);assert.equal(f.all('select')[0].value,'');}
 const f=fixture();C.render(f.host,data());f.click(f.all('button').find(b=>b.dataset.linkageSymbol==='600001'));C.clear(f.host,true);C.render(f.host,data());assert.match(f.host.textContent,/600000 · 当期相对前排/);
});
test('no archived evidence or index weights yields useful unknown state without synthetic members',()=>{
 const f=fixture();C.render(f.host,null);assert.match(f.host.textContent,/未封存/);assert.equal(f.all('button').length,0);const d=data();d.attribution={status:'unknown',industries:[]};d.boards=[];C.render(f.host,d);assert.match(f.host.textContent,/缺少适用指数权重/);assert.match(f.host.textContent,/未封存可比板块/);assert.equal(f.all('button').length,0);
});
test('provider names and member strings are rendered as text nodes, with invalid stock inspect disabled',()=>{
 const f=fixture(),d=data();d.benchmark.name='<img src=x>';d.boards[0].members=[{symbol:'<script>x</script>',return:null}];d.symbol='<script>x</script>';C.render(f.host,d,{onInspect(){throw Error('invalid inspect');}});assert.match(f.host.textContent,/<img src=x>/);assert.equal(f.all('img').length,0);assert.equal(f.all('script').length,0);assert.equal(f.all('button').find(b=>b.textContent==='查看该股研究').disabled,true);
});
test('explicit same-window activation order stays descriptive and missing activation remains unknown',()=>{
 const f=fixture(),d=data();d.boards[0].members[0].leadFollow='observed-first';d.boards[0].members[0].activation={at:d.window.start,confirmedAt:d.window.start+60000,definitionVersion:'activation-v1'};C.render(f.host,d);assert.match(f.host.textContent,/最先观察到异动/);assert.match(f.host.textContent,/仅描述观测先后，不认证带动或因果/);assert.match(f.host.textContent,/activation-v1/);f.click(f.all('button').find(b=>b.dataset.linkageSymbol==='600001'));assert.match(f.host.textContent,/先行 \/ 跟随：分时证据不足/);assert.doesNotMatch(f.host.textContent,/最先观察到异动/);
});
test('frozen daily benchmark percent quote is separate from unavailable same-window return',()=>{
 const f=fixture(),d=data();d.benchmark={provider:'archive',name:'上证指数',code:'000001',return:null,close:3200,changePct:1.2};d.returnBasis=null;C.render(f.host,d);assert.match(f.host.textContent,/同窗 未知/);assert.match(f.host.textContent,/3200点 \/ \+1.20%；日涨跌不用于同窗归因/);assert.match(f.host.textContent,/封存口径未知/);assert.doesNotMatch(f.host.textContent,/undefined/);
});
