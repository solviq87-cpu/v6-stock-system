(() => {
'use strict';
const $=id=>document.getElementById(id);
const state={items:[],hasData:false,lastRefresh:0,requestId:0,controller:null};
const number=value=>{
 if(value===null||value===undefined||typeof value==='boolean'||typeof value==='object')return null;
 const v=typeof value==='string'?value.trim():value;
 if(typeof v==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))return null;
 if(v==='')return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
};
const node=(tag,klass,value)=>{
 const x=document.createElement(tag);if(klass)x.className=klass;
 if(value!==undefined)x.textContent=String(value);
 return x;
};
const atChina=value=>{
 const n=number(value);
 if(n===null||!Number.isSafeInteger(n)||n<1000000000000||n>9999999999999)return '';
 const d=new Date(n);
 return Number.isNaN(d.valueOf())?'':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
};
const token=()=>{
 try{return localStorage.getItem('qd_device')||localStorage.getItem('qd_token')||'';}
 catch{return '';}
};
const status=(value,kind='')=>{
 $('status').textContent=value;$('status').className=kind;
};
const reasons=item=>{
 const raw=Array.isArray(item.reasons)?item.reasons:Array.isArray(item.hit)?item.hit:[];
 return raw.slice(0,30).map(x=>typeof x==='string'?x.trim().slice(0,200):'').filter(Boolean);
};
const card=item=>{
 const el=node('article','pick');
 const head=node('div','pickhead');
 const name=node('div');
 name.append(node('strong','',String(item.name||'名称未知').slice(0,45)));
 name.append(node('span','code',String(item.code||'代码未知').slice(0,12)));
 head.append(name);
 const score=number(item.score);
 const box=node('div','score',score===null?'—':score.toFixed(1));
 box.append(node('small','',' 共振分（历史阈值未经新回验）'));
 head.append(box);el.append(head);
 const tags=node('div','tags');
 const auctionPct=number(item.auctionPct);
 const pct=number(item.pct);
 tags.append(node('span','tag '+(auctionPct===null?'':auctionPct>0?'up':'down'),
  '竞价涨幅 '+(auctionPct===null?'未知':(auctionPct>0?'+':'')+auctionPct.toFixed(2)+'%')));
 tags.append(node('span','tag','板块 '+String(item.sector||'未知').slice(0,40)));
 const sectorRank=number(item.rank);
 tags.append(node('span','tag',sectorRank!==null&&sectorRank>=1&&sectorRank<=1000?
  '板块名次 '+sectorRank:'板块名次未知'));
 if(pct!==null)tags.append(node('span','tag',(pct>0?'+':'')+pct.toFixed(2)+'% · 行情日未确认'));
 el.append(tags);
 const rows=reasons(item);
 el.append(node('p','muted','现有服务端返回的研究理由'));
 if(rows.length){
  const list=node('ul','reasons');
  for(const reason of rows.slice(0,3))list.append(node('li','',reason));
  el.append(list);
  if(rows.length>3){
   const details=node('details'),listMore=node('ul','reasons');
   details.append(node('summary','', '其余 '+(rows.length-3)+' 条解释'));
   for(const reason of rows.slice(3))listMore.append(node('li','',reason));
   details.append(listMore);el.append(details);
  }
 }else el.append(node('p','muted','尚无可核验的命中理由；不推定已触发独立战法'));
 const risk=number(item.drawdown3d);
 if(risk!==null&&risk>0)el.append(node('p','footnote','近3日板块资金回撤指标 '+risk.toFixed(1)+'%（口径未经独立核对）'));
 el.append(node('p','footnote','逐票竞价原始报价时间：未知 · 9:25实际成交额：未由本接口独立验证'));
 const link=node('a','','进入策略研究和风险核对');
 link.href='/research.html#decisionWorkspace';el.append(link);
 return el;
};
const render=()=>{
 const q=$('search').value.trim().toLowerCase(),sort=$('sort').value;
 const rows=state.items.filter(x=>!q||String(x.code||'').includes(q)||
   String(x.name||'').toLowerCase().includes(q));
 if(sort!=='original'){
  const get=sort==='auctionPct'?x=>number(x.auctionPct):x=>number(x.score);
  rows.sort((a,b)=>(get(b)??-Infinity)-(get(a)??-Infinity));
 }
 $('total').textContent=state.hasData?state.items.length:'—';
 $('visible').textContent=state.hasData?rows.length:'—';
 $('explained').textContent=state.hasData?state.items.filter(x=>reasons(x).length).length:'—';
 const root=$('results');root.replaceChildren();
 if(!state.hasData){root.append(node('p','empty','没有可读取的云端竞价研究结果'));return;}
 if(!rows.length){root.append(node('p','empty',state.items.length?'没有匹配搜索条件的股票':'云端当前未返回竞价共振候选。无数据不代表没有机会。'));return;}
 const fragment=document.createDocumentFragment();
 for(const item of rows.slice(0,100))fragment.append(card(item));
 root.append(fragment);
};
const revoke=()=>{
 state.items=[];state.hasData=false;state.lastRefresh=0;
 $('synced').textContent='查看权限已撤销；之前返回的研究内容已清空';render();
};
const load=async()=>{
 const id=++state.requestId;
 if(state.controller)state.controller.abort();
 const controller=new AbortController();state.controller=controller;
 $('reload').disabled=true;status('正在读取云端竞价共振观察名单…');
 const params=new URLSearchParams({board:$('board').value,max:'40'});
 const tok=token();if(tok)params.set('token',tok);
 try{
  const response=await fetch('/api/auction-resonance?'+params,{
   method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
   headers:{Accept:'application/json'}
  });
  if(id!==state.requestId)return;
  if(!response.ok){
   if([401,403].includes(response.status)){revoke();throw Error('只读权限失效，请重新登录');}
   throw Error('接口 HTTP '+response.status);
  }
  const data=await response.json();
  if(id!==state.requestId)return;
  if(data?.locked===true){revoke();throw Error('需要重新授权后才能查看竞价观察池');}
  if(data?.ok===false)throw Error(String(data.error||data.note||'共振结果不可用'));
  if(data?.isMock===true||data?.simulated===true)
   throw Error('已拒绝把演示研究股票标记为真实行情');
  if(!Array.isArray(data?.items))throw Error('服务端尚无有效竞价候选列表');
  state.items=data.items.filter(x=>x&&typeof x==='object').slice(0,100);
  state.hasData=true;state.lastRefresh=Date.now();
  const computed=atChina(data.asOf);
  $('synced').textContent='本机成功读取：'+new Date(state.lastRefresh).toLocaleTimeString('zh-CN',{hour12:false})+
    (computed?' · 服务端共振结果计算于 '+computed:' · 服务端计算时点未知')+
    ' · 均不是逐票原始报价时点';
  status('已读取 '+state.items.length+' 只已有共振观察候选；9:20/9:25新战法仍需原始时点与实际成交证据。','warn');
  render();
 }catch(e){
  if(id!==state.requestId||e.name==='AbortError')return;
  status((state.hasData?'云端暂不可用，保留上次结果（非实时）。 ':'当前无法读取结果。 ')+String(e.message||e),'error');
  render();
 }finally{if(id===state.requestId)$('reload').disabled=false;}
};
$('reload').addEventListener('click',load);
$('board').addEventListener('change',load);
$('search').addEventListener('input',render);
$('sort').addEventListener('change',render);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-state.lastRefresh>15000)load();});
window.addEventListener('pageshow',()=>{if(!document.hidden&&state.lastRefresh&&Date.now()-state.lastRefresh>15000)load();});
window.setInterval(()=>{if(!document.hidden&&Date.now()-state.lastRefresh>=60000)load();},60000);
load();
})();