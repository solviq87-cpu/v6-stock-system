'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {paperDecisionPolicy}=require('../src/core/paper-decision-command');
const modules=Promise.all([import('../public/nova/decision-workflow.js'),import('../public/nova/client.js')]);
const day='2026-11-25',now=Date.parse(day+'T10:30:00+08:00');
const policy=paperDecisionPolicy({maxPos:5,sl:-.03,tp:.08,expireDays:4},{atrMultiplier:2,atrStopMaxPct:-10});
const candidate=(code='600001')=>({code,name:'隔离候选'+code,day,entry:[9.9,10.1],stop:9.7,target:11,
  row:{code,name:'隔离候选'+code,poolDay:day}});
const fill=(code='600001',extra={})=>({ok:true,status:'filled',filled:true,queued:false,
  receipt:{account:'pool',code,day,eventId:'committed-'+code,price:10,shares:100},...extra});

// Exercise real UI handlers with a deliberately small DOM. Network replies
// use the real client's ApiError contract, rather than treating ok:false as a
// successful fetch result. No account, browser storage or external API is used.
class El{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.className='';this._text='';}
  get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
  set textContent(value){this._text=String(value??'');this.children=[];}
  get lastElementChild(){return this.children.filter(child=>child.tag!=='#text').at(-1)||null;}
  get classList(){return {add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');}};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=children;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
}
function dom(t){
  const previous={Node:global.Node,document:global.document};
  global.Node=El;global.document={createElement:tag=>new El(tag),createTextNode:value=>{const node=new El('#text');node.textContent=value;return node;}};
  t.after(()=>{global.Node=previous.Node;global.document=previous.document;});
}
const find=(node,predicate)=>predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean);
const click=button=>button.listeners.click({currentTarget:button,preventDefault(){}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function fixture(t,{initial=candidate(),initialPolicy=policy}={}){
  const [{createDecisionSelection,renderPaperDraft},{ApiError}]=await modules;
  const controller=new AbortController(),selection=createDecisionSelection(),stateListeners=[],calls=[];
  t.after(()=>controller.abort());
  if(initial)selection.select(initial);
  const x={calls,controller,refreshes:0,post:async()=>fill(),get:async()=>({ok:true,paper:{pool:{policy,trades:[],tradesShown:0,tradesTotal:0,audit:{ok:true}}}})};
  const ctx={canEdit:true,role:'edit',signal:controller.signal,state:{paper:{pool:{policy:initialPolicy}}},
    get selection(){return selection.value;},onSelection:callback=>selection.subscribe(callback,controller.signal),
    onState:callback=>stateListeners.push(callback),navigate(){},
    refresh:async()=>{x.refreshes++;for(const callback of stateListeners)callback();},
    api:async(url,options={})=>{
      calls.push({url,method:options.method||'GET',body:options.body&&structuredClone(options.body)});
      const result=await (options.method==='POST'?x.post(options.body):x.get());
      if(result?.ok===false)throw new ApiError(result.error||'服务拒绝',200,result);
      return result;
    }};
  const view=renderPaperDraft(ctx);
  return Object.assign(x,{ctx,view,choose:value=>selection.select(value),
    update:()=>stateListeners.forEach(callback=>callback()),
    status:()=>find(view,node=>node.tag==='p'&&node.attributes.role==='status'),
    confirm:()=>find(view,node=>node.tag==='button'&&node.className.includes('primary')),
    reconcile:()=>find(view,node=>node.tag==='button'&&node.textContent==='核对账户回执'),
    input:name=>find(view,node=>node.tag==='input'&&node.attributes.name===name)});
}

test('prefill is side-effect free, sends only the approved schema and disables repeat after a matching receipt',async t=>{
  dom(t);const x=await fixture(t);await tick();assert.deepEqual(x.calls,[]);
  assert.equal(x.view.dataset.code,'600001');assert.equal(x.view.dataset.day,day);
  assert.equal(x.input('entryMin').value,'9.9');assert.equal(x.input('entryMax').value,'10.1');
  assert.match(x.view.textContent,/策略参考止损/);assert.match(x.view.textContent,/不会自动挂单等待/);
  await click(x.confirm());
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].url,'/api/paper');
  assert.deepEqual(x.calls[0].body,{action:'submitDecision',account:'pool',code:'600001',day,entryMin:9.9,entryMax:10.1,policy});
  assert.equal(x.confirm().textContent,'已取得成交回执');assert.equal(x.confirm().disabled,true);assert.equal(x.refreshes,1);
  await click(x.confirm());assert.equal(x.calls.length,1,'the handler itself refuses a second click');
});

test('contradictory, missing and mismatched receipts cannot display a confirmed fill',async t=>{
  dom(t);
  const cases=[fill('600001',{filled:false}),fill('600001',{receipt:undefined}),fill('600002'),
    fill('600001',{receipt:{...fill().receipt,account:'pre'}}),fill('600001',{receipt:{...fill().receipt,day:'2026-11-24'}}),
    fill('600001',{receipt:{...fill().receipt,eventId:''}}),fill('600001',{receipt:{...fill().receipt,price:null}}),
    fill('600001',{receipt:{...fill().receipt,shares:0}}),{ok:true,message:'请求已收到'}];
  for(const response of cases){
    const x=await fixture(t);x.post=async()=>response;await click(x.confirm());
    assert.notEqual(x.confirm().textContent,'已取得成交回执',JSON.stringify(response));
    assert.equal(x.confirm().disabled,true);assert.equal(x.reconcile().hidden,false);
    assert.match(x.status().textContent,/尚未确认成交|核对权威账户/);assert.equal(x.refreshes,1);
    await click(x.confirm());assert.equal(x.calls.length,1);
  }
});

test('unknown outcome and network timeout preserve an explicit reconciliation step before another submit',async t=>{
  dom(t);
  for(const outcome of ['unknown','timeout']){
    const x=await fixture(t);
    x.post=async()=>{if(outcome==='timeout')throw Error('请求超时');return {ok:false,status:'receipt-unavailable',filled:null,error:'权威回执暂不可读'};};
    await click(x.confirm());
    assert.equal(x.confirm().disabled,true);assert.equal(x.reconcile().hidden,false);assert.equal(x.refreshes,1);
    assert.match(x.status().textContent,/核对账户回执/);assert.doesNotMatch(x.status().textContent,/已确认成交|本次未成交/);
    await click(x.confirm());assert.equal(x.calls.filter(call=>call.method==='POST').length,1);
  }
});

test('an explicit blocked response remains distinguishable from an unknown outcome',async t=>{
  dom(t);const x=await fixture(t);
  x.post=async()=>({ok:false,status:'blocked',filled:false,reasonCode:'OUTSIDE_ENTRY_RANGE',error:'当前报价不在区间'});
  await click(x.confirm());assert.equal(x.confirm().disabled,false);assert.equal(x.reconcile().hidden,true);
  assert.equal(x.status().textContent,'当前报价不在区间');assert.equal(x.refreshes,0);
});

test('missing counts or a truncated account response cannot clear the unknown-outcome block',async t=>{
  dom(t);
  const cases=[{trades:[],audit:{ok:true}},
    {trades:[],tradesShown:0,tradesTotal:30,audit:{ok:true}},
    {trades:[],tradesShown:1,tradesTotal:1,audit:{ok:true}},
    {trades:[],tradesShown:0,tradesTotal:0,audit:{ok:false}},
    {trades:[],tradesShown:null,tradesTotal:null,audit:{ok:true}}];
  for(const account of cases){
    const x=await fixture(t);x.post=async()=>{throw Error('连接中断');};
    await click(x.confirm());x.get=async()=>({ok:true,paper:{pool:{policy,...account}}});
    await click(x.reconcile());
    assert.equal(x.confirm().disabled,true,JSON.stringify(account));assert.equal(x.reconcile().hidden,false);
    assert.match(x.status().textContent,/不足以排除成交|尚不完整/);
    await click(x.confirm());assert.equal(x.calls.filter(call=>call.method==='POST').length,1);
  }
});

test('complete audited no-fill evidence clears the block without automatically submitting',async t=>{
  dom(t);const x=await fixture(t);x.post=async()=>{throw Error('连接中断');};
  await click(x.confirm());await click(x.reconcile());
  assert.equal(x.confirm().disabled,false);assert.equal(x.reconcile().hidden,true);
  assert.match(x.status().textContent,/已核对完整账户回执/);
  assert.equal(x.calls.filter(call=>call.method==='POST').length,1);assert.equal(x.calls.filter(call=>call.method==='GET').length,1);
});

test('reconciliation of an already recorded same-day buy keeps submission disabled',async t=>{
  dom(t);t.mock.method(Date,'now',()=>now);const x=await fixture(t);x.post=async()=>{throw Error('连接中断');};
  await click(x.confirm());
  x.get=async()=>({ok:true,paper:{pool:{policy,trades:[{code:'600001',side:'买入',t:now-1000}],tradesShown:1,tradesTotal:1,audit:{ok:true}}}});
  await click(x.reconcile());assert.equal(x.confirm().disabled,true);assert.equal(x.reconcile().hidden,true);
  assert.match(x.status().textContent,/已有该股当日买入记录/);assert.equal(x.calls.filter(call=>call.method==='POST').length,1);
});

test('an explicit null policy clears old rules and a read-only identity cannot submit',async t=>{
  dom(t);const x=await fixture(t);
  x.ctx.state.paper.pool.policy=null;x.update();assert.equal(x.confirm().disabled,true);
  await click(x.confirm());assert.equal(x.calls.length,0);
  const position=find(x.view,node=>node.tag==='input'&&node.attributes['aria-label']==='模拟账户仓位规则');
  assert.equal(position.value,'等待账户规则');
  x.ctx.state.paper.pool.policy=policy;x.ctx.canEdit=false;x.ctx.role='view';x.update();
  assert.equal(x.view.hidden,true);await click(x.confirm());assert.equal(x.calls.length,0);
});

test('late A submission success or failure cannot overwrite the selected B identity or prefilled plan',async t=>{
  dom(t);
  for(const response of ['success','unknown']){
    const x=await fixture(t),pending=deferred();x.post=()=>pending.promise;
    const submit=click(x.confirm());assert.equal(x.confirm().disabled,true);
    x.choose({...candidate('600002'),entry:[20,21]});
    pending.resolve(response==='success'?fill('600001'):{ok:false,status:'receipt-unavailable',filled:null,error:'A回执未知'});
    await submit;
    assert.equal(x.view.dataset.code,'600002');assert.equal(x.view.dataset.day,day);
    assert.equal(x.input('entryMin').value,'20');assert.equal(x.input('entryMax').value,'21');
    assert.equal(x.status().textContent,'已预填，尚未提交。');assert.equal(x.confirm().textContent,'确认条件并加入模拟盘');
    assert.equal(x.confirm().disabled,false);assert.equal(x.refreshes,0);
  }
});

test('a late reconciliation response for A cannot label B as filled or clear B form fields',async t=>{
  dom(t);t.mock.method(Date,'now',()=>now);const x=await fixture(t);x.post=async()=>{throw Error('连接中断');};
  await click(x.confirm());const pending=deferred();x.get=()=>pending.promise;
  const reconcile=click(x.reconcile());x.choose({...candidate('600002'),entry:[20,21]});
  pending.resolve({ok:true,paper:{pool:{policy,trades:[{code:'600001',side:'买入',t:now}],tradesShown:1,tradesTotal:1,audit:{ok:true}}}});
  await reconcile;assert.equal(x.view.dataset.code,'600002');assert.equal(x.input('entryMin').value,'20');
  assert.equal(x.status().textContent,'已预填，尚未提交。');assert.equal(x.confirm().disabled,false);
});
