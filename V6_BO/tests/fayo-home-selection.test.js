'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Exercise the real home controller with a deterministic DOM and market fixture.
// The existing Chromium suite independently checks real DOM/layout behavior.
const source=fs.readFileSync(path.join(__dirname,'../public/nova/home-layout.js'),'utf8')
 .replace(/^import .*;\r?$/gm,'').replace(/^export function /gm,'function ');
class Element {
 constructor(tag,attrs={},children=[]){this.tag=tag;this.attrs={...attrs};this.disabled=!!attrs.disabled;this.children=children.flat(Infinity).filter(x=>x!=null&&x!==false);this.text='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children.filter(x=>x!=null);}
 setAttribute(key,value){this.attrs[key]=String(value);}
 click(){if(!this.disabled)this.attrs.onClick?.({currentTarget:this});}
 get textContent(){return this.text+this.children.map(x=>x instanceof Element?x.textContent:String(x)).join(' ');}
 set textContent(value){this.text=String(value);this.children=[];}
}
function descendants(node){return [node,...node.children.filter(x=>x instanceof Element).flatMap(descendants)];}
const h=(tag,attrs,...children)=>new Element(tag,attrs,children);
const day='2026-11-13',at=Date.parse(day+'T09:25:00+08:00');
function fixture({role='edit',memory={},hasMemory=true}={}){
 const calls=[],controller=new AbortController();let currentMemory=memory;
 const ctx={role,signal:controller.signal,get viewMemory(){return hasMemory?currentMemory:undefined;},navigate:(...args)=>calls.push(['navigate',...args]),selectStock:(code)=>calls.push(['stock',code])};
 const create=vm.runInNewContext(source+'\ncreateTradingHome',{Date,h,button:(label,onClick)=>h('button',{onClick},label),updateReadout:(node,...children)=>node.replaceChildren(...children),dateTime:String,percent:String,
  POOLS:[['relay-first']],closeSessionDay:s=>s.closeSession?.day??null,reviewDate:v=>v||null,marketOverviewParts:()=>({indexAvailability:[],indices:[],sentiment:h('p',{}),environment:h('p',{}),risk:h('p',{}),hasSentiment:true,hasEnvironment:true,hasRisk:true}),
  poolStateResult:(pool,state)=>state.relay,selectResearchPicks:(_state,{native})=>native||{day,items:[]}});
 const home=create(ctx,h('div',{}));const nodes=()=>descendants(home.opportunity);
 const tab=label=>nodes().find(n=>n.tag==='button'&&n.textContent===label);
 const detail=()=>nodes().find(n=>n.attrs.class==='fy-home-opportunity-detail');
 const selected=()=>nodes().filter(n=>n.attrs['aria-pressed']==='true').map(n=>n.textContent);
 const state={now:at,closeSession:{day},marketClock:{day,trading:false},relay:{day,items:[]},auctionObservations:{day,phase:'matched',items:[{code:'000001',name:'竞价样本',day,quoteAt:at,knownAt:at+1000,sealSource:'隔离测试'}]}};
 const paint=(picks={day,items:[]},snapshot=state)=>home.paint(snapshot,picks,false,null);
 return {ctx,home,tab,selected,detail,paint,calls,memory,state,abort:()=>controller.abort(),switchMemory:m=>{currentMemory=m;}};
}
test('tabs are safe before initial data, and an explicit choice survives the first refresh',()=>{
 const f=fixture();assert.doesNotThrow(()=>f.tab('竞价引力').click());assert.deepEqual(f.selected(),['竞价引力']);assert.match(f.detail().textContent,/正在读取/);f.paint();assert.deepEqual(f.selected(),['竞价引力']);assert.match(f.detail().textContent,/竞价样本/);assert.equal(f.memory.homeChannel,'auction');
});
test('obsolete or permission-incompatible remembered channels fall back to a permitted observation',()=>{
 for(const [role,homeChannel] of [['edit','removed-channel'],['view','relay-first']]){
  const f=fixture({role,memory:{homeChannel}});assert.doesNotThrow(()=>f.paint());assert.deepEqual(f.selected(),['竞价引力']);assert.equal(f.memory.homeChannel,undefined);assert.doesNotMatch(f.detail().textContent,/权限研究样本/);if(role==='view')assert.equal(f.tab('一进二').disabled,true);
 }
});
test('role changes reject restricted tab choices and discard old restricted rows before repaint',()=>{
 const f=fixture();f.state.relay.items=[{code:'600001',name:'权限研究样本',selectionWhy:'隔离测试'}];f.paint();f.tab('一进二').click();assert.match(f.detail().textContent,/权限研究样本/);const stale=descendants(f.detail()).find(n=>n.attrs['data-code']==='600001');f.ctx.role='view';stale.click();assert.deepEqual(f.calls,[]);f.paint();assert.equal(f.tab('一进二').disabled,true);assert.deepEqual(f.selected(),['竞价引力']);assert.doesNotMatch(f.detail().textContent,/权限研究样本/);assert.equal(f.memory.homeChannel,undefined);
});
test('aborted view callbacks do not navigate, select a stock, or write memory belonging to another view',()=>{
 const f=fixture();f.paint();const stale=descendants(f.detail()).find(n=>n.attrs['data-code']==='000001');const other={homeChannel:'ranked'};f.switchMemory(other);f.abort();f.tab('盘中异动').click();stale.click();f.tab('查看全部推荐 →').click();f.paint();assert.deepEqual(f.calls,[]);assert.deepEqual(other,{homeChannel:'ranked'});assert.equal(f.memory.homeChannel,undefined);
});
test('valid explicit choice uses the captured view memory, not a different route memory',()=>{
 const f=fixture();f.paint();const other={};f.switchMemory(other);f.tab('精选').click();assert.equal(f.memory.homeChannel,'ranked');assert.deepEqual(other,{});
});
test('missing or mismatched candidate scope shows an unverified state rather than a confirmed zero',()=>{
 const f=fixture();f.paint({day:'2026-11-12',items:[]});assert.match(f.home.opportunity.textContent,/系统精选 · 待核验/);f.tab('精选').click();assert.match(f.detail().textContent,/尚无同日可核验/);f.paint({day,items:[]});assert.match(f.home.opportunity.textContent,/系统精选 · 0 只/);assert.doesNotMatch(f.detail().textContent,/尚无同日可核验/);
});
