'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Minimal DOM fixture: run the exact original readout module body, with
// native-like attribute reflection and listener dispatch. No server requests.
function fixture(){
 class Node{
  constructor(name,data=''){this.nodeName=name.toUpperCase();this.nodeType=name==='#text'?3:1;this.data=data;
   this.childNodes=[];this.parentNode=null;this.attrs=new Map();this.dataset={};this.handlers=new Map();this.value='';this.checked=false;this.open=false;}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get firstChild(){return this.childNodes[0]||null;}get lastChild(){return this.childNodes.at(-1)||null;}
  get id(){return this.getAttribute('id')||'';}
  get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
  get disabled(){return this.hasAttribute('disabled');}set disabled(v){v?this.setAttribute('disabled',''):this.removeAttribute('disabled');}
  get readOnly(){return this.hasAttribute('readonly');}get hidden(){return this.hasAttribute('hidden');}
  set hidden(v){v?this.setAttribute('hidden',''):this.removeAttribute('hidden');}
  get className(){return this.getAttribute('class')||'';}set className(v){this.setAttribute('class',v);}
  hasAttribute(name){return this.attrs.has(name);}
  getAttribute(name){return this.attrs.get(name)??null;}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  removeAttribute(name){this.attrs.delete(name);}
  matches(selector){return selector.split(',').includes(this.nodeName.toLowerCase());}
  addEventListener(name,fn){const handlers=this.handlers.get(name)||[];handlers.push(fn);this.handlers.set(name,handlers);}
  dispatch(name){if(this.disabled)return;for(const fn of this.handlers.get(name)||[])fn({currentTarget:this});}
  remove(){if(this.parentNode){const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;}}
  insertBefore(node,before){if(node===before)return;node.remove();const at=before?this.childNodes.indexOf(before):this.childNodes.length;assert.ok(at>=0);this.childNodes.splice(at,0,node);node.parentNode=this;}
  append(...nodes){for(const n of nodes)this.insertBefore(n,null);}
  replaceChildren(...nodes){for(const n of [...this.childNodes])n.remove();this.append(...nodes);}
 }
 const document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 const src=fs.readFileSync(path.resolve(__dirname,'../public/nova/ui.js'),'utf8').replace(/^export /gm,'');
 return vm.runInNewContext(src+'\n({h,updateReadout})',{Node,document});
}
test('same focused control drops an action removed by a newer render and restores only one managed listener',()=>{
 const {h,updateReadout}=fixture(),calls=[],root=h('div');
 const action=h('button',{id:'same-action',onClick:()=>calls.push('old')},'旧操作');
 action.addEventListener('click',()=>calls.push('unrelated'));
 updateReadout(root,action);action.dispatch('click');
 updateReadout(root,h('button',{id:'same-action'},'仅查看'));
 assert.equal(root.firstChild,action);action.dispatch('click');
 assert.deepEqual(calls,['old','unrelated','unrelated']);
 updateReadout(root,h('button',{id:'same-action',onClick:()=>calls.push('new')},'恢复'));
 action.dispatch('click');assert.deepEqual(calls,['old','unrelated','unrelated','new','unrelated']);
 assert.equal(action.handlers.get('click').length,2);
});
test('input retains user draft while new permissions and accessible labels are reflected',()=>{
 const {h,updateReadout}=fixture(),root=h('div'),calls=[];
 const input=h('input',{id:'draft',value:'initial',onChange:()=>calls.push('old'),'aria-label':'旧标签'});
 updateReadout(root,input);input.value='user draft';
 const next=h('input',{id:'draft',value:'server data',disabled:true,readonly:true,'aria-label':'当前无编辑权限','aria-describedby':'reason'});
 updateReadout(root,next);
 assert.equal(root.firstChild,input);assert.equal(input.value,'user draft');
 assert.equal(input.disabled,true);assert.equal(input.readOnly,true);assert.equal(input.getAttribute('aria-label'),'当前无编辑权限');
 assert.equal(input.getAttribute('aria-describedby'),'reason');input.dispatch('change');
 updateReadout(root,h('input',{id:'draft',value:'new server data','aria-label':'编辑','onChange':()=>calls.push('new')}));
 assert.equal(input.disabled,false);assert.equal(input.readOnly,false);assert.equal(input.hasAttribute('aria-describedby'),false);
 assert.equal(input.value,'user draft');input.dispatch('change');assert.deepEqual(calls,['new']);
});
test('checkbox and select state remain local without retaining obsolete form callbacks',()=>{
 const {h,updateReadout}=fixture(),root=h('div'),calls=[];
 const checkbox=h('input',{id:'check',checked:true,onChange:()=>calls.push('obsolete')});
 const select=h('select',{id:'choose',value:'old',onChange:()=>calls.push('obsolete')});
 root.append(checkbox,select);checkbox.checked=false;select.value='chosen';
 updateReadout(root,h('input',{id:'check',checked:true,required:true}),h('select',{id:'choose',value:'server',disabled:true}));
 assert.equal(checkbox.checked,false);assert.equal(checkbox.hasAttribute('required'),true);
 assert.equal(select.value,'chosen');assert.equal(select.disabled,true);checkbox.dispatch('change');assert.deepEqual(calls,[]);
});
test('unmodified readout keeps disclosure state and updates the existing text and current action',()=>{
 const {h,updateReadout}=fixture(),root=h('div'),calls=[];
 const disclosure=h('details',{id:'evidence',open:true},h('summary',{onClick:()=>calls.push('first')},'旧证据'));
 root.append(disclosure);const summary=disclosure.firstChild;
 updateReadout(root,h('details',{id:'evidence'},h('summary',{onClick:()=>calls.push('second')},'新证据')));
 assert.equal(root.firstChild,disclosure);assert.equal(disclosure.open,true);
 assert.equal(disclosure.firstChild,summary);assert.equal(summary.firstChild.data,'新证据');
 summary.dispatch('click');assert.deepEqual(calls,['second']);
});
