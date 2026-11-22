'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

class Element{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.hidden=false;}
  setAttribute(k,v){this[k]=v;}
  addEventListener(k,v){this.listeners[k]=v;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
}
function setup(){
  global.Node=Element;global.document={createElement:t=>new Element(t),createTextNode:t=>Object.assign(new Element('text'),{textContent:t})};
  let canEdit=true;const events=[],calls=[],navigations=[],ctl=new AbortController(),host=new Element('div');
  return {host,calls,events,navigations,role(v){canEdit=v;events.forEach(fn=>fn());},ctl,ctx:{get canEdit(){return canEdit;},signal:ctl.signal,onState:fn=>events.push(fn),
    api:async(path,options)=>{calls.push([path,options]);return report(options.headers['X-V6-Research-Book'],options.headers['X-V6-Sample-Filter']);},
    navigate:(...args)=>navigations.push(args)}};
}
const report=(id,selection='standard')=>({ok:true,result:{book:{id,name:id==='demo'?'演示库':'主研究账户'},selection,strategies:['龙头战法','首板战法','盘整战法','轮动战法'],
  rows:[{strategy:'龙头战法',trend:'多头',n:4,winRate:75,payoff:1.5},{strategy:'首板战法',trend:'震荡',n:2,winRate:0,payoff:null},{strategy:'盘整战法',trend:'空头',n:3,winRate:100,payoff:null}],asOf:'2026-11-22T15:00'}});
const text=n=>[n.textContent||'',...n.children.map(text)].join(' ');
const find=(n,p)=>p(n)?n:n.children.map(c=>find(c,p)).find(Boolean);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('首页专用 GET 仅取指定账户与样本，全策略表区分零胜率和无数据，回测保留上下文',async()=>{
 const {mountHomePerformance}=await import('../public/nova/shortline/home-performance.mjs');
 const {selectBook}=await import('../public/nova/shortline/book-session.mjs');
 const {sampleFor}=await import('../public/nova/shortline/context.mjs');
 selectBook('demo');sampleFor('demo','excludeExtreme');
 const f=setup();await mountHomePerformance(f.host,f.ctx);
 assert.equal(f.calls.length,1);const [url,options]=f.calls[0];assert.equal(url,'/api/research/shortline');assert.equal(options.method,undefined);assert.equal(options.headers['X-V6-Research-View'],'home');
 assert.equal(options.headers['X-V6-Sample-Filter'],'excludeExtreme');assert.equal(options.headers['X-V6-Research-Book'],'demo');assert.match(text(f.host),/教学演示账户/);
 for(const s of ['多头','震荡','空头','75%','0%','100%','1.5','盈亏比 —'])assert.ok(text(f.host).includes(s));
 const details=find(f.host,n=>n.tag==='details');details.open=true;details.listeners.toggle();
 assert.ok(text(details).includes('轮动战法'));assert.ok(text(details).includes('暂无样本'));
 find(details,n=>n.tag==='button'&&text(n).includes('轮动战法')).listeners.click();
 const [view,path]=f.navigations[0],query=new URLSearchParams(path.split('?')[1]);assert.equal(view,'lab');assert.ok(path.startsWith('shortline-backtest?'));assert.equal(query.get('strategy'),'轮动战法');assert.equal(query.get('sample'),'excludeExtreme');
 f.ctl.abort();selectBook('main');sampleFor('demo','standard');
});
test('未授权、切换账户及注销中的晚响应不会显示其他档案，空或错包有对应状态',async()=>{
 const {mountHomePerformance}=await import('../public/nova/shortline/home-performance.mjs'),{selectBook}=await import('../public/nova/shortline/book-session.mjs');
 const f=setup();f.role(false);await mountHomePerformance(f.host,f.ctx);assert.equal(f.calls.length,0);assert.equal(f.host.hidden,true);
 let pending;selectBook('main');const g=setup();
 g.ctx.api=async(_,{headers})=>headers['X-V6-Research-Book']==='main'?new Promise(resolve=>{pending=resolve;}):{ok:true,result:{...report('demo').result,rows:[]}};
 const loaded=mountHomePerformance(g.host,g.ctx);await tick();selectBook('demo');g.events.forEach(fn=>fn());await tick();
 pending(report('main'));await loaded;assert.match(text(g.host),/教学演示账户/);assert.match(text(g.host),/导入研究样本/);assert.doesNotMatch(text(g.host),/主研究账户|75%/);
 g.role(false);assert.equal(g.host.hidden,true);assert.doesNotMatch(text(g.host),/演示/);g.ctl.abort();
 const wrong=setup();wrong.ctx.api=async()=>report('main');
 await mountHomePerformance(wrong.host,wrong.ctx);assert.match(text(wrong.host),/重新读取/);assert.doesNotMatch(text(wrong.host),/75%/);
 wrong.ctl.abort();selectBook('main');
});
test('未分类原生板块只映射唯一准确同花顺名称，无法识别的东财ID回退到名称搜索',async()=>{
 const {thsBoardLink}=await import('../public/nova/shortline/quote-links.mjs');
 assert.equal(thsBoardLink({name:'半导体',kind:'unknown'}).pageId,'881121');
 assert.equal(thsBoardLink({name:'芯片概念',kind:'unknown'}).pageId,'301085');
 const q=thsBoardLink({name:'合成板块甲',kind:'unknown',refs:[{provider:'eastmoney',boardId:'BK1234'}]});
 assert.equal(q.kind,'search');assert.equal(new URL(q.url).searchParams.get('w'),'合成板块甲');
});
