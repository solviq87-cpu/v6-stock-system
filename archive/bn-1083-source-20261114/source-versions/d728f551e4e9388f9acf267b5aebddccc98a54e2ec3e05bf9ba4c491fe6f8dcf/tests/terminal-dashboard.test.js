'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Minimal DOM contract harness; verifies controller state, escaping and request ordering, not pixel layout.
function setup(){
 const nodes=new Map(),events={},docEvents={},requests=[];
 function node(id=''){const n={id,value:id==='vx-sort'?'original':'',dataset:{},classList:{add(){}},setAttribute(k,v){this[k]=v;},addEventListener(k,f){this['on'+k]=f;},prepend(){},append(){},after(){},focus(){this.focused=true;}};let html='',text='';Object.defineProperty(n,'innerHTML',{get:()=>html,set:s=>{html=String(s);for(const match of html.matchAll(/id="([^"]+)"/g))if(!nodes.has(match[1]))nodes.set(match[1],node(match[1]));}});Object.defineProperty(n,'textContent',{get:()=>text,set:s=>{text=String(s);html='';}});return n;}
 const tabs=['all','focused','fourteen','bazi','gpt','python'].map(f=>{const n=node();n.dataset.vxFilter=f;return n;});const container=node(),identity=node();
 const document={body:node(),getElementById:id=>nodes.get(id)||null,createElement:()=>node(),querySelector:q=>q==='.wrap'?node():q==='.vx-tabs'?container:q==='.vx-identity'?identity:null,querySelectorAll:q=>q.includes('.vx-tabs')?tabs:[],addEventListener:(n,f)=>docEvents[n]=f};
 const fetch=(url,opts)=>new Promise(resolve=>requests.push({url,opts,resolve}));
 const context={document,console,fetch,AbortController,location:{href:''},addEventListener:(n,f)=>events[n]=f,Date,Map,Set,URLSearchParams};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/assets/terminal-dashboard.js'),'utf8'),context);
 return {nodes,events,docEvents,requests,tabs,container};
}
const model=()=>({observedAt:Date.now(),indices:[],counts:{candidates:2,focused:0,signals:0,risk:0},mood:{},rows:[{code:'000001',name:'<img src=x onerror=alert(1)>',price:10,pct:0,score:0,signals:['<script>bad()</script>'],explanation:[]},{code:'000002',name:'第二只',price:20,pct:1,score:50,signals:[],explanation:[]}]});
const tick=()=>new Promise(r=>setImmediate(r));
test('terminal controller displays unknowns safely, escapes provider strings and requests only selected real code',async()=>{
 const h=setup();assert.match(h.nodes.get('vx-counts').innerHTML,/—/);h.events['v6-dashboard-data']({detail:model()});assert.match(h.nodes.get('vx-rows').innerHTML,/&lt;img/);assert.ok(!h.nodes.get('vx-rows').innerHTML.includes('<img'));assert.match(h.nodes.get('vx-explanation').innerHTML,/&lt;script/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/kline?code=000001&n=120');
 h.requests[0].resolve({ok:true,json:async()=>({ok:true,asOf:'2026-01-01',rows:[{date:'2026-01-01',open:10,high:11,low:9,close:10.5,volume:100}]})});await tick();assert.match(h.nodes.get('vx-chart').innerHTML,/<svg/);assert.match(h.nodes.get('vx-chart-source').textContent,/2026-01-01/);
});
test('terminal clears displayed data on loss of access and ignores late candle responses',async()=>{
 const h=setup();h.events['v6-dashboard-data']({detail:model()});h.events['v6-dashboard-data']({detail:null});h.requests[0].resolve({ok:true,json:async()=>({ok:true,rows:[{open:1,high:2,low:1,close:2,volume:1}]})});await tick();assert.equal(h.nodes.get('vx-chart').textContent,'请登录后查看行情');assert.ok(!h.nodes.get('vx-rows').innerHTML.includes('000001'));
});
test('terminal keyboard filters are focusable and missing independent signals remain empty',()=>{
 const h=setup();h.events['v6-dashboard-data']({detail:model()});h.container.onkeydown({target:h.tabs[0],key:'End',preventDefault(){}});assert.equal(h.tabs[5].tabIndex,0);assert.equal(h.tabs[5].focused,true);assert.match(h.nodes.get('vx-rows').innerHTML,/暂无可展示/);h.events['v6-dashboard-offline']();assert.match(h.nodes.get('vx-source').textContent,/非实时/);
});
