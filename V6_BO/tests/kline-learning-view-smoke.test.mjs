import test from 'node:test';
import assert from 'node:assert/strict';
import {renderKlineLearning} from '../public/nova/kline-learning-view.js';

class FakeNode {
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.listeners=new Map();this._text='';this.value='';this.files=[];this.style={};this.classList={toggle(){}};this.disabled=false;}
 set textContent(s){this._text=String(s);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
 setAttribute(k,v){this.attributes[k]=String(v);}
 append(...children){this.children.push(...children.flat().filter(Boolean));if(this.tagName==='select'&&!this.value)this.value=this.children[0]?.value||'';}
 replaceChildren(...children){this.children=[];this.append(...children);}
 addEventListener(name,cb){const all=this.listeners.get(name)||[];all.push(cb);this.listeners.set(name,all);}
 async dispatch(name){for(const f of this.listeners.get(name)||[])await f({target:this});}
 click(){return this.disabled?Promise.resolve():this.dispatch('click');}
 remove(){}
}
const saved={Node:globalThis.Node,document:globalThis.document};
globalThis.Node=FakeNode;
globalThis.document={createElement(tag){return new FakeNode(tag);},createElementNS(ns,tag){const x=new FakeNode(tag);x.namespaceURI=ns;return x;},createTextNode(value){const x=new FakeNode('#text');x.textContent=value;return x;},body:new FakeNode('body')};
const find=(tree,predicate)=>predicate(tree)?tree:tree.children.reduce((f,x)=>f||find(x,predicate),null);
const control=(view,label)=>find(view,x=>x.attributes['aria-label']===label);
const button=(view,label)=>find(view,x=>x.tagName==='button'&&x.textContent===label);
const file=(text,name='data.csv')=>({name,size:new TextEncoder().encode(text).length,text:async()=>text});
const dates=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21'];
const stock='代码,名称,日期,开盘,最高,最低,收盘,成交量,涨停价,所属板块,来源,数据截至,黑天鹅,可重复标准样本\n'+dates.map((d,i)=>
  `000001,测试公司,${d},${10+i*.2},${10.5+i*.2},${9.9+i*.2},${10.2+i*.2},${50000+i*6000},${i===5?11.2+i*.2:''},测试题材,来源甲,${d}T15:10:00+08:00,否,是`).join('\n');
const sectors='板块,日期,收盘,来源,数据截至,题材阶段\n'+dates.map((d,i)=>`测试题材,${d},${100+i},来源乙,${d}T15:10:00+08:00,发酵`).join('\n');
const markets='日期,收盘,全A趋势,来源,数据截至\n'+dates.map((d,i)=>`${d},${1000+i},多头,来源丙,${d}T15:10:00+08:00`).join('\n');
const appended='代码,名称,日期,开盘,最高,最低,收盘,成交量,所属板块,来源,数据截至,黑天鹅,可重复标准样本\n000001,测试公司,2026-10-22,12,12.3,11.9,12.1,30000,测试题材,来源甲,2026-10-22T15:10:00+08:00,否,是';
function workspace(){
 const controller=new AbortController(),listeners=[];let role='edit';
 const view=renderKlineLearning({get role(){return role;},signal:controller.signal,onState:fn=>listeners.push(fn)});
 control(view,'历史日K CSV（必选）').files=[file(stock,'initial-stock.csv')];
 control(view,'同期板块 CSV').files=[file(sectors,'initial-sector.csv')];
 control(view,'同期全A指数 CSV').files=[file(markets,'initial-market.csv')];
 return {view,controller,setRole(value){role=value;for(const fn of listeners)fn();}};
}
async function exportedReport(view){
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;let blob;
 URL.createObjectURL=value=>{blob=value;return 'blob:synthetic-export';};URL.revokeObjectURL=()=>{};
 try{await button(view,'导出回测学习报告 JSON').click();assert.ok(blob,'export is enabled for a committed dataset');return JSON.parse(await blob.text());}
 finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
}
async function correctFirstBar(view){
 const scope=control(view,'样本范围');scope.value='all';await scope.dispatch('change');
 const row=button(view,'测试公司 000001 · '+dates[0]);assert.ok(row,'unlabeled bars must be selectable for missed-signal corrections');await row.click();
 control(view,'修正战法').value='龙头战法';control(view,'修正动作').value='add';control(view,'人工修正原因').value='核对原始截图，补充漏标';
 await button(view,'保存本次人工修正').click();
}

test('browser learning workspace imports CSV, renders statistics and supports incremental append',async()=>{
 const {view,controller}=workspace();
 assert.equal(view.tagName,'div');
 const importButton=button(view,'导入并自动标注');
 await importButton.click();
 assert.match(view.textContent,/已生成8条历史标签/);
 assert.match(view.textContent,/K线样本8/);
 assert.match(view.textContent,/研究因子与负向组合/);
 const first=await exportedReport(view);
 control(view,'追加日K CSV（可选）').files=[file(appended,'more.csv')];
 await button(view,'追加新日K并重新计算').click();
 assert.match(view.textContent,/新增 1 根日K/);
 assert.match(view.textContent,/K线样本9/);
 const after=await exportedReport(view);
 assert.deepEqual(after.sourceFiles.appendedStock,['more.csv']);
 assert.deepEqual(after.report.split,first.report.split,'appending later bars must retain the frozen holdout boundary');
 const horizon=control(view,'跟踪期限');horizon.value='1';await horizon.dispatch('change');
 assert.deepEqual((await exportedReport(view)).report.split,first.report.split,'horizon changes use the same date split');
 controller.abort();
});

test('unlabeled bars can be corrected, filtered by strategy and date, and removed with an audit trail',async()=>{
 const {view,controller}=workspace();await button(view,'导入并自动标注').click();
 assert.ok(control(view,'战法筛选').children.some(x=>x.value==='龙头战法'));
 await correctFirstBar(view);
 const strategy=control(view,'战法筛选');strategy.value='龙头战法';await strategy.dispatch('change');
 const date=control(view,'按信号日期筛选');date.value=dates[0];await date.dispatch('change');
 assert.match(view.textContent,/历史同类样本 \(1 条/);
 let report=await exportedReport(view);
 assert.equal(report.corrections.length,1);
 assert.ok(report.samples.find(x=>x.date===dates[0]).signals.some(x=>x.name==='龙头战法'));
 control(view,'修正动作').value='remove';control(view,'人工修正原因').value='再次对照，撤销错误标注';await button(view,'保存本次人工修正').click();
 report=await exportedReport(view);assert.equal(report.corrections.length,2);
 assert.equal(report.samples.find(x=>x.date===dates[0]).signals.some(x=>x.name==='龙头战法'),false);
 strategy.value='';const scope=control(view,'样本范围');scope.value='missing';await scope.dispatch('change');
 assert.ok(button(view,'测试公司 000001 · '+dates[0]));
 controller.abort();
});

test('invalid replacements preserve committed samples, corrections and export provenance',async()=>{
 const {view,controller}=workspace();await button(view,'导入并自动标注').click();await correctFirstBar(view);
 const before=await exportedReport(view);
 control(view,'历史日K CSV（必选）').files=[file('代码,日期\ninvalid,not-a-date','not-imported.csv')];
 control(view,'同期板块 CSV').files=[file(sectors,'not-imported-sector.csv')];
 assert.deepEqual((await exportedReport(view)).sourceFiles,before.sourceFiles,'changing a picker alone cannot relabel prior data provenance');
 await button(view,'导入并自动标注').click();
 assert.match(view.textContent,/导入失败/);assert.match(view.textContent,/保留上次成功导入的样本与修正/);assert.match(view.textContent,/K线样本8/);
 let after=await exportedReport(view);assert.deepEqual(after.samples,before.samples);assert.deepEqual(after.corrections,before.corrections);assert.deepEqual(after.sourceFiles,before.sourceFiles);
 control(view,'追加日K CSV（可选）').files=[file(stock,'duplicates.csv')];await button(view,'追加新日K并重新计算').click();
 assert.match(view.textContent,/重复追加/);after=await exportedReport(view);assert.deepEqual(after.samples,before.samples);assert.deepEqual(after.corrections,before.corrections);
 controller.abort();
});

test('import and append serialize work and recover both buttons after success or failure',async()=>{
 const {view,controller}=workspace();let resolve;
 const delayed=file(stock,'delayed.csv');delayed.text=()=>new Promise(r=>{resolve=r;});
 control(view,'历史日K CSV（必选）').files=[delayed];control(view,'追加日K CSV（可选）').files=[file(appended,'more.csv')];
 const load=button(view,'导入并自动标注'),append=button(view,'追加新日K并重新计算'),pending=load.click();
 assert.equal(load.disabled,true);assert.equal(append.disabled,true);
 await append.dispatch('click'); // A stale or programmatic event still cannot start a competing import.
 resolve(stock);await pending;
 assert.equal(load.disabled,false);assert.equal(append.disabled,false);assert.match(view.textContent,/K线样本9/);
 await append.click();assert.match(view.textContent,/重复追加/);assert.equal(load.disabled,false);assert.equal(append.disabled,false);
 controller.abort();
});

test('role downgrade rejects stale correction clicks and abort discards visible evidence',async()=>{
 const {view,controller,setRole}=workspace();await button(view,'导入并自动标注').click();await correctFirstBar(view);
 const save=button(view,'保存本次人工修正'),before=await exportedReport(view);
 control(view,'人工修正原因').value='将被撤销的草稿';setRole('view');assert.equal(save.disabled,true);assert.equal(control(view,'人工修正原因').value,'');
 control(view,'人工修正原因').value='降级后不能保存';await save.dispatch('click');
 assert.deepEqual((await exportedReport(view)).corrections,before.corrections);
 setRole('edit');assert.equal(save.disabled,false);
 controller.abort();assert.equal(view.textContent,'');await save.dispatch('click');assert.equal(view.textContent,'');
});

test('an aborted file read cannot repaint evidence or re-enable stale controls',async()=>{
 const {view,controller}=workspace();let resolve;
 const delayed=file(stock);delayed.text=()=>new Promise(r=>{resolve=r;});control(view,'历史日K CSV（必选）').files=[delayed];
 const load=button(view,'导入并自动标注'),append=button(view,'追加新日K并重新计算'),pending=load.click();
 controller.abort();resolve(stock);await pending;assert.equal(view.textContent,'');assert.equal(load.disabled,true);assert.equal(append.disabled,true);
});
// Restore Node globals at process exit (test runner isolates files by default).
process.on('exit',()=>{globalThis.Node=saved.Node;globalThis.document=saved.document;});
