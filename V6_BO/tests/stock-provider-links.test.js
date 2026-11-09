'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const providers=require('../public/assets/stock-provider-links');
test('external navigation rejects injected, ambiguous and unsupported symbols rather than opening the wrong market',()=>{
 for(const code of ['SZ000001','1.000001','000001?token=secret','000001"><script>','920001','510300','123456',null,1])assert.deepEqual(providers.links(code),[]);
 for(const [code,market] of [['000001','sz'],['300033','sz'],['600000','sh'],['688001','sh']]){
  const items=providers.links(code);assert.equal(items.length,4);
  assert.ok(items.find(x=>x.id==='eastmoney').url.endsWith('/'+market+code+'.html'));
  assert.ok(items.find(x=>x.id==='xueqiu').url.endsWith('/'+market.toUpperCase()+code));
  for(const item of items){const u=new URL(item.url);assert.equal(u.protocol,'https:');assert.equal(u.search,'');assert.equal(u.username,'');}
 }
 const html=providers.render('000001');assert.ok(!html.includes('iframe'));assert.ok(!html.includes('token='));assert.equal((html.match(/rel="noopener noreferrer"/g)||[]).length,4);assert.ok(html.includes('未接入这些授权实时接口'));
});
test('both entry pages load provider module before shared dashboard; legacy detail also exposes it',()=>{
 for(const name of ['index.html','mobile.html']){const html=fs.readFileSync(require.resolve('../public/'+name),'utf8');assert.ok(html.indexOf('/assets/stock-provider-links.js')<html.indexOf('/assets/terminal-dashboard.js'));}
 const legacy=fs.readFileSync(require.resolve('../public/assets/app.js'),'utf8');assert.ok(legacy.includes('id="klProviders"'));assert.ok(legacy.includes('V6StockProviders.render(KL.code)'));
});
test('provider selection follows current stock immediately even if candles fail or an old request resolves late',async()=>{
 const src=fs.readFileSync(require.resolve('../public/assets/terminal-dashboard.js'),'utf8');
 const elements={},el=id=>elements[id]||(elements[id]={setAttribute(name,value){this[name]=String(value);}});const pending=[];
 const context={V6StockProviders:providers,el,model:{rows:[{code:'000001',name:'A',signals:[]},{code:'600000',name:'B',signals:[]}]},selected:null,epoch:0,controller:null,AbortController,renderRows(){},format(){return '—';},finite:Number.isFinite,esc:x=>x,token:()=>'',plot:()=>'<svg/>',fetch:()=>new Promise(resolve=>pending.push(resolve))};
 vm.createContext(context);vm.runInContext(src.slice(src.indexOf('function quoteDescription(row)'),src.indexOf('function renderRows()')),context);vm.runInContext(src.slice(src.indexOf('function renderIssuer(row'),src.indexOf('function token()')),context);vm.runInContext(src.slice(src.indexOf('async function select(code)'),src.indexOf("document.addEventListener('click'")),context);
 const a=context.select('000001'),b=context.select('600000');
 assert.ok(el('vx-provider-links').innerHTML.includes('/sh600000.html'));assert.ok(!el('vx-provider-links').innerHTML.includes('000001'));
 pending[1]({ok:false,json:async()=>({error:'offline'})});await b;assert.ok(el('vx-chart').textContent.includes('offline'));assert.ok(el('vx-provider-links').innerHTML.includes('/sh600000.html'));
 pending[0]({ok:true,json:async()=>({ok:true,rows:[]})});await a;assert.ok(el('vx-provider-links').innerHTML.includes('/sh600000.html'));assert.ok(el('vx-chart').textContent.includes('offline'));
});
