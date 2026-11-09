'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../public/assets/complete-workbench.js'),'utf8');
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.textContent='';this.value='';this.hidden=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 after(node){this.insertedAfter=node;}
 remove(){this.removed=true;}
 addEventListener(name,callback){this.handlers[name]=callback;}
 fire(name){return this.handlers[name]?.();}
}
const ids=Object.fromEntries(['completeRun','paperAppend','paperRead','completeStatus','completeOutput',
 'completeSummary','payload','paperAccountId','token'].map(id=>[id,new Element()]));
const created=[];
const document={getElementById(id){return ids[id]||created.find(x=>x.id===id&&!x.removed)||null;},
 createElement(tag){const x=new Element(tag);created.push(x);return x;}};
const all=Array.from({length:31},(_,i)=>({symbol:String(600001+i),name:'历史样本'+i,
 dataStatus:'imported-unverified',rationale:{
  selection:{ruleCount:1,explanation:'历史研究规则命中',rules:[{id:'pattern:breakout',name:'放量突破',evidence:['收盘突破']} ]},
  market:{status:'unknown'},sector:{status:'unknown'},price:{changePct:1.2},
  whyUp:{conclusion:'没有核验上涨原因',possibleContributors:[],confirmedCauses:[]},
  risks:['公告风险待核对']}}));
const result={ok:true,result:{selectionEvidence:{status:'evaluated',asOf:'2026-03-09',
 dataStatus:'imported-unverified',candidates:all},backtest:{metrics:{finalEquity:101000}}}};
ids.payload.value='{"history":{}}';ids.token.value='test-token';
const requests=[];
const fetch=async (url,options)=>{requests.push({url,options});return {json:async()=>result};};
vm.runInNewContext(script,{document,fetch,JSON,Error,Array,String,Number});
test('complete-run uses authenticated existing research API and shows historical provenance',async()=>{
 await ids.completeRun.fire('click');
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/research/complete-run');
 assert.equal(requests[0].options.headers.Authorization,'Bearer test-token');
 const root=document.getElementById('historicalSelection');
 assert.ok(root);
 assert.ok(root.children.some(n=>String(n.textContent).includes('非实时行情')));
 assert.equal(ids.completeOutput.textContent.includes('selectionEvidence'),true);
 const details=created.filter(n=>n.tag==='details');
 assert.equal(details.length,30);
 assert.ok(details[0].children.some(n=>String(n.textContent).includes('公告风险待核对')));
});
test('strategy filter is wired and load-more reveals remaining matched stocks',()=>{
 const selector=created.find(x=>x.tag==='select');
 assert.ok(selector);
 assert.ok(selector.children.some(x=>x.value==='pattern:breakout'));
 selector.value='pattern:breakout';selector.fire('change');
 const list=document.getElementById('historicalSelection').children.find(x=>x.tag==='div');
 assert.ok(list);
 const more=created.find(x=>x.tag==='button'&&x.textContent==='显示更多历史股票');
 assert.ok(more);
 more.fire('click');
 assert.ok(created.filter(x=>x.tag==='details').length>=61);
});
test('historical stock evidence uses textContent rather than untrusted HTML',()=>{
 assert.ok(script.includes('textContent=String(value'));
 assert.ok(!script.includes('innerHTML'));
});

test('sector cohort percentile is disclosed only as a historical limited-universe comparison',async()=>{
 all[0].rationale.sectorCohortRps={status:'imported-unverified',sector:'设备',
  return20Pct:9.5,rpsPct:100,cohortSectors:3};
 await ids.completeRun.fire('click');
 const details=created.filter(e=>e.tag==='details');
 assert.ok(details.some(d=>d.children.some(x=>String(x.textContent).includes('板块横向研究分位：设备'))));
 assert.ok(details.some(d=>d.children.some(x=>String(x.textContent).includes('不代表全市场强度或资金流'))));
});

test('weak-market preference is visible, moves only historical display order, and never hides signal hits',async()=>{
 const selected=all[0];
 selected.rationale.selection.researchDeprioritized=true;
 selected.rationale.weakMarketPreference={researchDeprioritized:true,
  reason:'弱市按用户偏好降低银行研究顺序'};
 const before=created.length;
 try{
  await ids.completeRun.fire('click');
  const details=created.slice(before).filter(x=>x.tag==='details');
  assert.equal(details.length,30);
  assert.match(details[0].children[0].textContent,/^600002 /,
   'ordinary research sample should display ahead of deprioritized sector');
  const selectedDetails=details.filter(x=>x.children[0]?.textContent.startsWith('600001 '));
  assert.equal(selectedDetails.length,0,'deprioritized last row can be outside initial page');
  const more=created.slice(before).find(x=>x.tag==='button'&&x.textContent==='显示更多历史股票');
  assert.ok(more);more.fire('click');
  const allDetails=created.slice(before).filter(x=>x.tag==='details');
  assert.ok(allDetails.some(d=>d.children.some(x=>String(x.textContent).includes('弱市板块偏好：观察次序降低'))));
  assert.ok(allDetails.some(d=>d.children.some(x=>String(x.textContent).includes('放量突破'))),
   'original matched rule details must remain visible');
 }finally{
  delete selected.rationale.selection.researchDeprioritized;
  delete selected.rationale.weakMarketPreference;
 }
});
