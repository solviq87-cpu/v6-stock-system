import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRuntimeObservationCoverage,renderBackgroundArchive} from '../public/nova/deep-research.js';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.text='';this.listeners={};}
 replaceChildren(...nodes){this.children=nodes;this.text='';}
 addEventListener(name,handler){this.listeners[name]=handler;}
 dispatch(name){this.listeners[name]?.({currentTarget:this,target:this});}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(key,value){this.attrs[key]=value;}
 get textContent(){return this.text+this.children.map(child=>child instanceof Element?child.textContent:String(child)).join(' ');}
 set textContent(value){this.text=String(value);this.children=[];}
}
function renderElement(t,observation,renderer=renderRuntimeObservationCoverage){
 const saved={document:globalThis.document,Node:globalThis.Node};
 globalThis.Node=Element;globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 t.after(()=>{globalThis.document=saved.document;globalThis.Node=saved.Node;});return renderer(observation);
}
function render(t,observation,renderer=renderRuntimeObservationCoverage){return renderElement(t,observation,renderer).textContent;}
const day='2026-11-26';
const held={scope:'original-monitor-held-symbols-v1',attemptedMinutes:3,observedMinutes:2,missingMinutes:1,observedExpectedSymbolMinutes:442,observedFreshSymbolMinutes:440,fullMarketCertified:false};
const account={scope:'original-paper-local-joint-reconciliation-v1',attempted:3,verifiedLocal:1,unsuccessful:1,unknown:1,verifiedExternal:false};
test('runtime coverage page labels missing receipt minutes and does not promote a partial quote population to full coverage',t=>{
 const text=render(t,{elapsedTradingDays:1,elapsedTradingDaysComplete:false,calendar:{omittedAttemptDays:[day],versionMismatchDays:[day]},days:[{day,heldMonitorCoverage:held,accountReconciliation:account}]});
 assert.match(text,/完整范围待核/);assert.match(text,/取得 \/ 已尝试/);assert.match(text,/已尝试分钟不是完整交易时段/);assert.match(text,/2 \/ 3（缺 1）/);assert.match(text,/440 \/ 442 · 99\.55%/);assert.match(text,/本地一致 1 · 未成功 1 · 未知 1/);assert.match(text,/不代表全市场覆盖或外部券商对账/);
});
test('empty or malformed counts display unknown rather than perfect or zero coverage',t=>{
 const text=render(t,{elapsedTradingDays:1,days:[{day,heldMonitorCoverage:{...held,observedFreshSymbolMinutes:999},accountReconciliation:{...account,verifiedLocal:4}}]});
 assert.match(text,/完整范围待核/);assert.doesNotMatch(text,/999|225\.\d+%|本地一致 4/);assert.ok((text.match(/未知/g)||[]).length>=3);
});
test('no original observations shows the explicit empty state',t=>{
 const text=render(t,{elapsedTradingDays:0,elapsedTradingDaysComplete:null,days:[]});assert.match(text,/尚无真实观察回执/);assert.doesNotMatch(text,/100\.00%|本地一致 0/);
});


const overview={mode:'official-background-archive-overview',status:'available',asOf:Date.parse('2026-11-26T10:00:00+08:00'),canTrade:false,pointInTimeBacktestReady:false,totalScopes:1,checkedLatestReceipts:1,unverifiedScopes:0};
test('background archive view displays genuine zero and unknown separately with local receipt and no publication inference',t=>{
 const row={provider:'worldbank',status:'verified-latest-receipt',scope:{country:'CHN',indicator:'NY.GDP.MKTP.CD',startYear:2023,endYear:2024},sourcePublishedAt:null,sourceRevisedAt:null,
  records:[{period:'2023',value:0,unit:null},{period:'2024',value:null,unit:null}],observedAt:overview.asOf,availableAt:overview.asOf,firstKnownAt:overview.asOf,recordCount:2,missingValues:1,byteBasis:'response-body'};
 const text=render(t,{...overview,rows:[row]},renderBackgroundArchive);assert.match(text,/世界银行宏观指标/);assert.match(text,/2023 0 未知/);assert.match(text,/2024 未知 未知/);assert.match(text,/原始发布时间\s+未知/);assert.match(text,/不认证全部历史原文/);
});
test('ETF档案以月为单位，单列成交额、目标指数和未知归因',t=>{
 const row={provider:'szse-fund',status:'verified-latest-receipt',scope:{month:'2025-04',documentId:'W020250513504907210876.html'},
  sourcePublishedAt:null,sourceRevisedAt:null,byteBasis:'response-body',recordCount:2,missingValues:1,
  records:[{symbol:'159915',name:'样本甲',trackingIndex:'399006',monthlyTurnoverWanCny:0},{symbol:'159919',name:'样本乙',trackingIndex:null,monthlyTurnoverWanCny:null}]};
 const text=render(t,{...overview,rows:[row]},renderBackgroundArchive);
 assert.match(text,/深交所ETF证券成交月报 · 2025-04/);assert.match(text,/净申购未知，交易主体未知/);
 assert.match(text,/159915 样本甲 399006 0/);assert.match(text,/159919 样本乙 未知 未知/);
});
test('unverified background rows do not show a numeric value and archive absence remains explicit',t=>{
 const text=render(t,{...overview,status:'partial',rows:[{provider:'worldbank',status:'unavailable',scope:null,records:[{period:'2024',value:999999}]}]},renderBackgroundArchive);
 assert.match(text,/部分范围待校验/);assert.match(text,/尚无已复核数值/);assert.doesNotMatch(text,/999999/);
 const missing=render(t,{...overview,status:'unconfigured',rows:[],totalScopes:null},renderBackgroundArchive);assert.match(missing,/尚未配置原背景档案/);
});

// The task inventory is a fixed 78-row evidence ledger, not a weighted project score.
const taskModule=await import('../public/nova/deep-research.js');
const positive={code:'implemented',interface:'connected',realData:'available',validation:'passed',deployed:'deployed',observation:'verified'};
const taskAxis=(status,evidence=['docs/FAYO_78_TASK_AUDIT_20261126.md'])=>({status,evidence});
const sourceSha='a'.repeat(40);
const stageRef=key=>key==='code'?'V6_BO/src/core/runtime-acceptance.js':key==='interface'||key==='validation'?'https://github.com/solviq87-cpu/v6-stock-system/actions/runs/123':'docs/validation/test/receipt.json';
const fullTask=id=>({id,title:'任务'+id,sourceSha,...Object.fromEntries(Object.entries(positive).map(([key,status])=>[key,taskAxis(status,[stageRef(key)])]))});
test('task delivery summary keeps the fixed 78 denominator, six separate axes, and unknown deployment/observation',()=>{
 const rows=Array.from({length:78},(_,i)=>({...fullTask(i+1),code:taskAxis('partial'),deployed:taskAxis('unknown'),observation:taskAxis('waiting')}));
 const x=taskModule.summarizeTaskDelivery(rows);
 assert.equal(x.total,78);assert.equal(x.received,78);assert.equal(x.allPositive,0);
 assert.deepEqual(x.axes.find(a=>a.key==='code'),{key:'code',label:'代码',positive:0,partial:78,failed:0,pending:0});
 assert.equal(x.axes.find(a=>a.key==='validation').positive,78);
 assert.equal(x.axes.find(a=>a.key==='deployed').pending,78);assert.equal(x.axes.find(a=>a.key==='observation').pending,78);
});
test('missing, duplicate and invalid task identities never shrink the denominator or promote a positive declaration',()=>{
 const x=taskModule.summarizeTaskDelivery([fullTask(1),fullTask(1),fullTask(2),{...fullTask(3),deployed:taskAxis('passed'),observation:taskAxis('verified',[])},null,fullTask(79)]);
 assert.equal(x.received,2);assert.deepEqual(x.duplicateIds,[1]);assert.equal(x.missingIds.length,75);assert.equal(x.invalidRows,2);
 assert.equal(x.allPositive,1);assert.equal(x.rows[0].recordState,'duplicate');assert.equal(x.rows[2].statuses.deployed,'unknown');assert.equal(x.rows[2].statuses.observation,'unknown');
 for(const axis of x.axes)assert.equal(axis.positive+axis.partial+axis.failed+axis.pending,78);
});
test('known failures and partial progress are independent, with evidence required for positive declarations',()=>{
 const x=taskModule.summarizeTaskDelivery([{...fullTask(4),code:taskAxis('partial'),validation:taskAxis('failed'),deployed:taskAxis('blocked'),realData:taskAxis('available',[' '])}]);
 assert.equal(x.axes.find(a=>a.key==='validation').failed,1);assert.equal(x.axes.find(a=>a.key==='deployed').failed,1);assert.equal(x.axes.find(a=>a.key==='realData').positive,0);assert.equal(x.allPositive,0);
});
test('task panel presents the six-axis denominator and explicitly avoids overall acceptance or deployment claims',t=>{
 const text=render(t,[{...fullTask(1),code:taskAxis('partial'),validation:taskAxis('failed'),deployed:taskAxis('not-deployed'),observation:taskAxis('observing')}],taskModule.renderTaskDeliveryStatus);
 assert.match(text,/逐项交付状态（78项）/);assert.match(text,/收到唯一任务编号\s+1/);assert.match(text,/缺少任务编号\s+77/);assert.match(text,/不是整体完成率/);assert.match(text,/验证失败/);assert.match(text,/尚未部署/);assert.match(text,/观察积累中/);
});
test('task panel filters failed/blocked tasks and can restore all 78 entries without dropping missing identifiers',t=>{
 const root=renderElement(t,[fullTask(1),{...fullTask(2),title:'失败任务',validation:taskAxis('failed')}],taskModule.renderTaskDeliveryStatus);
 const walk=n=>[n,...n.children.filter(x=>x instanceof Element).flatMap(walk)];
 const select=walk(root).find(n=>n.attrs['aria-label']==='筛选任务交付状态');
 assert.ok(select);assert.match(root.textContent,/当前显示 78 \/ 78 项/);
 select.value='blocked';select.dispatch('change');assert.match(root.textContent,/当前显示 1 \/ 78 项/);assert.match(root.textContent,/失败任务/);assert.doesNotMatch(root.textContent,/缺少该编号回执/);
 select.value='missing';select.dispatch('change');assert.match(root.textContent,/当前显示 76 \/ 78 项/);assert.match(root.textContent,/缺少该编号回执/);
 select.value='all';select.dispatch('change');assert.match(root.textContent,/当前显示 78 \/ 78 项/);
});

test('normalized server duplicate issues remain duplicate instead of counting a unique received task',()=>{
 const row={...fullTask(1),issues:['duplicate-task-id']};
 const r=taskModule.summarizeTaskDelivery([row,fullTask(2)]);
 assert.equal(r.received,1);assert.deepEqual(r.duplicateIds,[1]);assert.equal(r.allPositive,1);assert.equal(r.rows[0].recordState,'duplicate');
});
test('positive delivery declarations require a source version and appropriate stage receipts',()=>{
 const generic='https://github.com/solviq87-cpu/v6-stock-system/pull/123';
 const cases=[
  [{...fullTask(1),sourceSha:null},Object.keys(positive)],
  [{...fullTask(1),code:taskAxis('implemented',['V6_BO/tests/runtime-acceptance.test.js'])},['code']],
  [{...fullTask(1),code:taskAxis('implemented',['https://github.com/solviq87-cpu/v6-stock-system/commit/'+'b'.repeat(40)])},['code']],
  [{...fullTask(1),realData:taskAxis('available',[generic]),deployed:taskAxis('deployed',[generic]),observation:taskAxis('verified',[generic])},['realData','deployed','observation']],
  [{...fullTask(1),validation:taskAxis('passed',['https://example.com/unverified',stageRef('validation')])},['validation']],
  [{...fullTask(1),validation:{...taskAxis('passed',[stageRef('validation')]),reason:'missing-stage-evidence'}},['validation']]
 ];
 for(const [entry,axes] of cases){const r=taskModule.summarizeTaskDelivery([entry]);for(const key of axes)assert.equal(r.rows[0].statuses[key],'unknown',key);assert.equal(r.allPositive,0);}
 const r=taskModule.summarizeTaskDelivery([fullTask(1)]);assert.equal(r.allPositive,1);
});
test('stage-specific pending states cannot be reassigned across axes',()=>{
 const x={...fullTask(1),code:taskAxis('observing'),interface:taskAxis('not-deployed'),deployed:taskAxis('waiting'),observation:taskAxis('not-deployed')};
 const r=taskModule.summarizeTaskDelivery([x]);for(const key of ['code','interface','deployed','observation'])assert.equal(r.rows[0].statuses[key],'unknown',key);
});
test('runtime coverage rejects malformed and duplicate days without erasing the original report',t=>{
 const report={elapsedTradingDays:2,days:[null,{day:'2026-02-30',heldMonitorCoverage:held,accountReconciliation:account},{day,heldMonitorCoverage:held,accountReconciliation:account},{day,heldMonitorCoverage:held,accountReconciliation:account}]};
 const before=JSON.stringify(report),text=render(t,report);
 assert.match(text,/重复交易日，待核/);assert.match(text,/重复观察日待核\s+1/);assert.match(text,/无效观察日记录\s+2/);
 assert.doesNotMatch(text,/99\.55%|本地一致 1|2026-02-30/);assert.equal(JSON.stringify(report),before);
});
test('runtime coverage requires original scopes and consistent attempted denominators',t=>{
 for(const change of [{heldMonitorCoverage:{...held,fullMarketCertified:true}},{accountReconciliation:{...account,verifiedExternal:true}},{attemptSamples:4}]){
  const text=render(t,{days:[{day,heldMonitorCoverage:held,accountReconciliation:account,...change}]});
  if(change.heldMonitorCoverage||change.attemptSamples)assert.doesNotMatch(text,/99\.55%/);
  if(change.accountReconciliation||change.attemptSamples)assert.doesNotMatch(text,/本地一致 1/);
 }
});
test('calendar range confirmation cannot contradict missing or changed calendar evidence',t=>{
 const calendar={runtimeEligible:true,omittedAttemptDays:[],versionMismatchDays:[],unverifiedVersionDays:[]};
 for(const change of [{unverifiedVersionDays:[day]},{omittedAttemptDays:[day]},{versionMismatchDays:[day]},{runtimeEligible:false}]){
  assert.match(render(t,{elapsedTradingDaysComplete:true,calendar:{...calendar,...change},days:[]}),/完整范围待核/);
 }
 assert.match(render(t,{elapsedTradingDaysComplete:true,calendar,days:[]}),/范围已核对/);
});
