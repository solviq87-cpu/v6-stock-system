import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelTools,createResearchReplay,createDisciplineWorkbench} from '../public/nova/evidence-workbench.mjs';
import {parseSelectionCommand} from '../public/nova/command-selection.mjs';
import {explainSealedResearch} from '../public/nova/research-review.mjs';

// Exercise the public controls with deferred receipts, without a model,
// account writer or network. The browser suite checks the same native nodes.
class El {
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.value='';this.text='';this.disabled=false;this.clientWidth=320;}
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
 append(...children){this.children.push(...children);}replaceChildren(...children){this.text='';this.children=[];this.append(...children);}
 setAttribute(k,v){this.attributes[k]=String(v);}addEventListener(k,fn){this.listeners[k]=fn;}
}
function dom(t){const prior={Node:globalThis.Node,document:globalThis.document};globalThis.Node=El;
 globalThis.document={createElement:tag=>new El(tag),createElementNS:(_,tag)=>new El(tag),createTextNode:value=>Object.assign(new El('#text'),{textContent:String(value)})};
 t.after(()=>Object.assign(globalThis,prior));}
const walk=node=>[node,...node.children.flatMap(walk)];
const byButton=(node,label)=>walk(node).find(e=>e.tagName==='button'&&e.textContent===label);
const byLabel=(node,label)=>walk(node).find(e=>e.attributes['aria-label']===label);
const trigger=(node,type='click')=>!node.disabled&&node.listeners[type]?.({preventDefault(){}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flags={researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false};
const cutoff=Date.parse('2026-11-10T15:30:00+08:00'),run={id:'a'.repeat(64),symbol:'600000'};
const modelResult=(overrides={})=>({ok:true,result:{...flags,...run,runId:run.id,asOf:cutoff,question:'support',status:'completed',modelCalled:true,
 model:'isolated-local',answer:'有引用的合成解释',citations:[{id:'R1',rule:'原条件',version:'v1',refs:[]}],...overrides}});

test('a pending model call cannot be invalidated by a configuration click and leave controls locked',async t=>{
 dom(t);let resolve,calls=0;
 const tools=createModelTools({role:'edit',api:()=>{calls++;return new Promise(r=>resolve=r);}},{run,asOf:cutoff,question:()=> 'support'});
 const model=byButton(tools.node,'明确调用已授权模型'),config=byButton(tools.node,'检查模型配置');
 const pending=trigger(model);assert.equal(model.disabled,true);assert.equal(config.disabled,true,'configuration must not supersede an in-flight model request');
 trigger(config);assert.equal(calls,1);resolve(modelResult());await pending;await tick();
 assert.equal(model.disabled,false);assert.equal(config.disabled,false);assert.match(tools.node.textContent,/有引用的合成解释/);
});

test('changing question cancels the request and does not expose a late answer',async t=>{
 dom(t);let resolve,signal,question='support';
 const tools=createModelTools({role:'edit',api:(_p,o)=>{signal=o.signal;return new Promise(r=>resolve=r);}},{run,asOf:cutoff,question:()=>question});
 const pending=trigger(byButton(tools.node,'明确调用已授权模型'));question='opposition';tools.reset();
 assert.equal(signal?.aborted,true);resolve(modelResult({answer:'晚到内容不得出现'}));await pending;
 assert.doesNotMatch(tools.node.textContent,/晚到内容不得出现/);assert.equal(byButton(tools.node,'检查模型配置').disabled,false);
});

test('a completed label without an actual model call is shown as a failed receipt',async t=>{
 dom(t);const tools=createModelTools({role:'edit',api:async()=>modelResult({modelCalled:false})},{run,asOf:cutoff,question:()=> 'support'});
 await trigger(byButton(tools.node,'明确调用已授权模型'));
 assert.doesNotMatch(tools.node.textContent,/实际模型|有引用的合成解释/);assert.match(tools.node.textContent,/保留原规则解释/);
});

function replayResult(query,overrides={}){
 const asOf=Number(query.get('asOf')),identity='b'.repeat(64),point={value:1,knownAt:cutoff-1000,source:'isolated-original',ref:run.id,kind:'daily-change',seriesIdentity:identity};
 return {ok:true,result:{...flags,protocol:'fayo-evidence-replay-v1',scope:'historical-readonly',symbol:query.get('symbol'),asOf,runId:run.id,
 rows:['2026-11-08','2026-11-09','2026-11-10'].map(date=>({date,stock:point,sector:null,index:null})),boards:[],selectedBoard:null,missing:[],
 markers:[{...flags,kind:'news',at:cutoff-1000,knownAt:cutoff-500,ref:'news-original',source:'isolated-original',detail:{title:'合成原始证据'}}],...overrides}};
}
test('returning to a replay restores the selected evidence and zoom only after rereading the same identity',async t=>{
 dom(t);const memory={};let calls=0;const ctx={role:'edit',api:async p=>{calls++;return replayResult(new URL(p,'http://localhost').searchParams);}};
 const view=createResearchReplay(ctx,{symbol:run.symbol,runId:run.id,asOf:cutoff,memory});
 await trigger(byButton(view,'读取联动回放'));const zoom=byLabel(view,'缩放可见日期范围');zoom.value='2';trigger(zoom,'input');
 trigger(byButton(view,'2026-11-10 证据'));trigger(byButton(view,'指数'));
 assert.equal(memory.replayContext.zoom,2);assert.equal(memory.replayContext.selectedDay,'2026-11-10');assert.equal(memory.replayContext.runId,run.id);
 assert.deepEqual(memory.replayContext.enabled,['stock','sector']);
 const returned=createResearchReplay(ctx,{symbol:run.symbol,runId:run.id,asOf:cutoff,memory});assert.equal(calls,1,'view restoration cannot fetch or execute implicitly');
 await trigger(byButton(returned,'读取联动回放'));assert.equal(byLabel(returned,'缩放可见日期范围').value,'2');
 assert.match(returned.textContent,/合成原始证据/);assert.equal(byButton(returned,'指数').attributes['aria-pressed'],'false');
 const other=createResearchReplay(ctx,{symbol:'600001',memory});assert.equal(byLabel(other,'回放截点 北京时间').value,'','a different stock cannot inherit this archive cutoff');
});

test('replay refuses a receipt for a different sealed version even with the same stock and cutoff',async t=>{
 dom(t);const ctx={role:'edit',api:async p=>replayResult(new URL(p,'http://localhost').searchParams,{runId:'c'.repeat(64)})};
 const view=createResearchReplay(ctx,{symbol:run.symbol,runId:run.id,asOf:cutoff});await trigger(byButton(view,'读取联动回放'));
 assert.match(view.textContent,/回放未就绪/);assert.doesNotMatch(view.textContent,/逐日数值/);
});

test('unsupported single-character OR clauses are not interpreted as one industry name',()=>{
 for(const raw of ['芯片或银行评分前5','评分前3且排除ST或停牌','评分前3或股价低于10元']){
  const result=parseSelectionCommand(raw);assert.equal(result.ok,false,raw);assert.match(result.error,/或|未识别/);
 }
});

test('unknown conditions cannot display late values as observations known at the historical cutoff',()=>{
 const r={...run,asOf:cutoff-20,recordedAt:cutoff,conditions:[{id:'late-condition',version:'v1',status:'pass',field:'score',value:987654.125,
  threshold:70,op:'>=',evidenceIds:['late']}],evidence:[{id:'late',symbol:run.symbol,source:'isolated-original',availableAt:cutoff+1,receivedAt:cutoff+2,evidenceRef:'late-ref'}]};
 const result=explainSealedResearch({selectedRun:r,asOf:cutoff},'missing');
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].status,'unknown');
 assert.equal(result.rows[0].value,null);assert.equal(result.rows[0].threshold,null);assert.equal(result.rows[0].op,null);
 assert.equal(r.conditions[0].value,987654.125,'the original archive is preserved');assert.deepEqual(result.rows[0].evidence,[]);
});

const incident={code:'600000',source:'原模拟执行日报',date:'2026-11-06',accountId:'pool',knownAt:cutoff-100,planFrozenAt:cutoff-200,
 planId:'original-plan',planVersion:'d'.repeat(64),rule:'按计划止损',ruleVersion:'original-score-v1',status:'触发',ref:'e'.repeat(64),
 evidence:'原日止损纪律触发事实',refs:['original-fill','original-observation'],nextCheck:'下次核对原冻结止损与可成交窗口',
 followup:{status:'触发',date:'2026-11-07',planId:'original-plan',planVersion:'d'.repeat(64),ref:'same-plan-ref',evidence:'同计划核对仍触发',note:'原问题保留'}};
const nextPlan={status:'observed',label:'后续计划原核验符合',scope:'read-archive-window-same-account-source-symbol',accountId:'pool',
 source:incident.source,code:incident.code,planId:'later-plan',planVersion:'f'.repeat(64),planFrozenAt:cutoff-50,rule:incident.rule,ruleVersion:incident.ruleVersion,
 date:'2026-11-10',knownAt:cutoff-10,ref:'b'.repeat(64),refs:['later-fill','later-observation'],evidence:'后续计划原核验记录',reason:'原规则事实可逐项核对',
 note:'仅在已读取原档案范围核对后续计划，不认证完整交易覆盖；保留原日事实，不证明用户看过建议或习惯改善。'};
async function readDisciplineCase(original=incident,next=nextPlan){
 let calls=0;
 const ctx={role:'edit',api:async(p,o)=>{calls++;assert.equal(o?.method,undefined);assert.equal(o?.body,undefined);
  const q=new URL(p,'http://localhost').searchParams;
  return {ok:true,result:{...flags,asOf:Number(q.get('asOf')),symbol:q.get('symbol'),scope:'隔离原日报范围',rows:[original],missing:[],followups:[{...original,nextPlanCheck:next}]}};
 }};
 const view=createDisciplineWorkbench(ctx,{symbol:'600000'});assert.equal(calls,0);await trigger(byButton(view,'读取个人纪律与后续落实'));
 return {view,calls,next:walk(view).find(n=>n.dataset.nextPlanCheck)};
}
test('next-plan review preserves the original incident and same-plan follow-up while exposing a separately bound later fact',async t=>{
 dom(t);const before=JSON.stringify({incident,nextPlan}),{view,calls,next}=await readDisciplineCase();
 assert.ok(next,'a separate optional next-plan disclosure is rendered');assert.equal(next.dataset.nextPlanCheck,'observed');
 assert.match(next.textContent,/后续计划原核验符合/);assert.match(next.textContent,/later-fill/);assert.match(next.textContent,/later-plan/);
 assert.match(view.textContent,/原日止损纪律触发事实/);assert.match(view.textContent,/同计划核对仍触发/);assert.match(view.textContent,/原结论触发/);
 assert.match(next.textContent,/不认证完整交易覆盖/);assert.match(next.textContent,/不证明用户看过建议或习惯改善/);
 assert.equal(calls,1);assert.equal(JSON.stringify({incident,nextPlan}),before,'the display must not rewrite either original record');
});
test('unbound, mismatched and future next-plan receipts fail only that disclosure without claiming compliance',async t=>{
 dom(t);
 const cases=[
  ['missing original account',{...incident,accountId:null},nextPlan],
  ['different account',incident,{...nextPlan,accountId:'pre'}],
  ['different stock',incident,{...nextPlan,code:'600001'}],
  ['different source',incident,{...nextPlan,source:'本人实录'}],
  ['different rule',incident,{...nextPlan,rule:'按计划买入'}],
  ['changed rule version',incident,{...nextPlan,ruleVersion:'original-score-v2'}],
  ['unverified plan version',incident,{...nextPlan,planVersion:'not-a-fingerprint'}],
  ['same plan',incident,{...nextPlan,planId:incident.planId}],
  ['frozen before incident known',incident,{...nextPlan,planFrozenAt:incident.knownAt}],
  ['known before freezing',incident,{...nextPlan,knownAt:nextPlan.planFrozenAt-1}],
  ['future receipt',incident,{...nextPlan,knownAt:Date.now()+60000}],
  ['missing event references',incident,{...nextPlan,refs:[]}],
  ['missing original-record reference',incident,{...nextPlan,ref:''}]
 ];
 for(const [name,original,later]of cases){const {view,next}=await readDisciplineCase(original,later);assert.ok(next,name);
  assert.equal(next.dataset.nextPlanCheck,'not-ready',name);assert.doesNotMatch(next.textContent,/后续计划原核验符合|后续计划原核验记录/,name);
  assert.match(view.textContent,/原日止损纪律触发事实/,name);assert.match(view.textContent,/同计划核对仍触发/,name);
 }
});
test('a different rule version stays unknown and cannot reuse a positive label or evidence',async t=>{
 dom(t);const {next}=await readDisciplineCase(incident,{...nextPlan,status:'unknown',ruleVersion:'original-score-v2',
  reason:'后续计划采用不同规则版本，暂不能与原问题比较',evidence:'不应显示的通过结论'});
 assert.equal(next.dataset.nextPlanCheck,'unknown');assert.match(next.textContent,/不同规则版本/);assert.match(next.textContent,/original-score-v2/);
 assert.doesNotMatch(next.textContent,/后续计划原核验符合|不应显示的通过结论/);
});
test('a bound unknown receipt without a selected later plan preserves its specific archive gap',async t=>{
 dom(t);const empty={...nextPlan,status:'unknown',planId:null,planVersion:null,planFrozenAt:null,knownAt:null,date:null,ref:null,refs:[],evidence:null,
  reason:'已读取范围内没有在本条原核验记录之后冻结的后续计划；不推断范围外交易'};
 const {view,next}=await readDisciplineCase(incident,empty);
 assert.equal(next.dataset.nextPlanCheck,'unknown');assert.match(next.textContent,/已读取范围内没有在本条原核验记录之后冻结的后续计划；不推断范围外交易/);
 assert.doesNotMatch(next.textContent,/后续计划原核验符合|未通过核对/);assert.match(view.textContent,/原日止损纪律触发事实/);
 const wrongAccount=await readDisciplineCase(incident,{...empty,accountId:'pre'});
 assert.equal(wrongAccount.next.dataset.nextPlanCheck,'not-ready','an empty result still needs the original account identity');
});

test('optional attention evidence never inserts a null child or keeps a previous disclosure on reread',async t=>{
 dom(t);let attention=true,calls=0;
 const ctx={role:'edit',api:async p=>{calls++;const q=new URL(p,'http://localhost').searchParams;return replayResult(q,attention?{attentionPair:{status:'paired-local-observations',expectedSecurities:5,validSecurities:5,pairedSecurities:5,turnoverHHI:.4,attentionHHI:.5,counterexamples:['600001']}}:{});}};
 const view=createResearchReplay(ctx,{symbol:run.symbol,runId:run.id,asOf:cutoff});
 await trigger(byButton(view,'读取联动回放'));
 assert.match(view.textContent,/本地新闻与同期成交额配对/);assert.match(view.textContent,/高关注低成交反例600001/);
 assert.ok(walk(view).every(node=>node instanceof El));
 attention=false;await trigger(byButton(view,'读取联动回放'));
 assert.doesNotMatch(view.textContent,/本地新闻与同期成交额配对|高关注低成交反例/);
 assert.match(view.textContent,/逐日数值/);assert.ok(walk(view).every(node=>node instanceof El));assert.equal(calls,2);
});
