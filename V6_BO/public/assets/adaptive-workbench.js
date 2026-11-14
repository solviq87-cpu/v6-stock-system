'use strict';
((root)=>{const doc=root.document,el=id=>doc?.getElementById(id);if(!el('adaptiveRun'))return;let epoch=0,active=null;
function render(r){el('adaptiveOutput').textContent=JSON.stringify(r,null,2);el('adaptiveSummary').replaceChildren();
for(const [label,value] of [['市场环境',({risk_on:'偏强',risk_off:'偏弱',mixed:'分化',unknown:'证据不足'})[r.market.regime]||r.market.regime],['可研究候选',r.latest?.ranking.filter(x=>x.eligible).length||0],['学习版本',r.latest?.version?.slice(0,12)||'样本不足'],['模拟收益率(%)',r.simulation?.metrics?.returnPct??'未运行']]){const card=doc.createElement('article'),name=doc.createElement('div'),v=doc.createElement('strong');card.className='card';name.textContent=label;v.textContent=String(value);card.append(name,v);el('adaptiveSummary').append(card);}for(const [id,label] of [['shanghai','上证'],['shenzhen','深证'],['chinext','创业板'],['a50','A50']]){const card=doc.createElement('article'),name=doc.createElement('div'),v=doc.createElement('strong'),p=r.indexModels[id]?.latest?.upProbability;card.className='card';name.textContent=label+'次期上涨经验概率';v.textContent=Number.isFinite(p)?(p*100).toFixed(1)+'%':'样本或证据不足';card.append(name,v);el('adaptiveSummary').append(card);}}
function sync(){el('adaptiveLatest').disabled=false;el('adaptiveRun').disabled=active?.kind==='run';}
function empty(){el('adaptiveOutput').textContent='';el('adaptiveSummary').replaceChildren();}
function clear(message='数据或凭据已变更，请重新读取',privateInput=false){epoch++;const old=active;active=null;old?.controller.abort();empty();if(privateInput)el('adaptiveFile').value='';el('adaptiveLatestStatus').textContent=message;el('adaptiveStatus').textContent=message;sync();}
function current(c){return c.id===epoch&&c.token===el('token').value.trim()&&!doc.hidden&&root.navigator?.onLine!==false&&(c.kind!=='run'||c.file===el('adaptiveFile').files?.[0]);}
function valid(c){return current(c)&&!c.controller.signal.aborted;}
async function json(url,options,c){const response=await root.fetch(url,{...options,signal:c.controller.signal,cache:'no-store',headers:{...(c.token?{Authorization:'Bearer '+c.token}:{}),...(options.method==='POST'?{'Content-Type':'application/json'}:{})}});if(response.status===401||response.status===403){const e=Error('权限已失效，请重新认证');e.denied=true;throw e;}const data=await response.json();if(data?.locked||data?.needPassword){const e=Error('权限已失效，请重新认证');e.denied=true;throw e;}if(!response.ok||!data?.ok)throw Error('研究请求未完成，请稍后重试');return data;}
async function run(kind){
 if(doc.hidden||root.navigator?.onLine===false){clear('页面隐藏或网络离线，请恢复后重新读取',true);return;}
 const file=el('adaptiveFile').files?.[0];if(kind==='run'&&(!file||file.size>1800*1024)){el('adaptiveStatus').textContent='请选择1800KiB以内JSON文件';return;}
 const id=++epoch;active?.controller.abort();const c={id,kind,file,token:el('token').value.trim(),controller:new AbortController()};active=c;empty();sync();
 el('adaptiveStatus').textContent=kind==='run'?'正在进行独立研究…':'正在读取已保存的研究报告';el('adaptiveLatestStatus').textContent=kind==='run'?'当前显示手动研究，未读取自动报告':'核验中…';let timedOut=false;
 const aborted=new Promise((_,reject)=>c.controller.signal.addEventListener('abort',()=>{const e=Error('aborted');e.name='AbortError';reject(e);},{once:true}));
 const timer=root.setTimeout(()=>{timedOut=true;c.controller.abort();},kind==='run'?60000:15000);
 try{await Promise.race([(async()=>{
  if(kind==='run'){const payload=JSON.parse(await file.text());if(!valid(c))return;const d=await json('/api/research/adaptive-market',{method:'POST',body:JSON.stringify(payload)},c);if(!valid(c))return;render(d.result);el('adaptiveStatus').textContent='研究完成；概率不保证收益，未修改真实账户或生产规则';}
  else{const data=await json('/api/research/adaptive-latest',{},c);if(!valid(c))return;
   if(data.status==='unconfigured'){el('adaptiveLatestStatus').textContent='尚未配置自动研究报告目录';el('adaptiveStatus').textContent='没有可显示的自动研究报告';return;}
   if(data.status!=='verified'||!data.result)throw Error('报告状态无效');render(data.result);
   const source=({simulated:'模拟数据',configured:'来源已配置，未经供应商认证',unknown:'来源未配置或未知'})[data.sourceStatus]||'来源未知';
   el('adaptiveLatestStatus').textContent='历史与报告校验通过 · 第'+data.revision+'版 · '+data.asOf+' · '+(data.stale?'已过期（超过'+data.maxAgeDays+'个自然日）':'距今'+data.ageDays+'个自然日')+' · '+source;
   el('adaptiveStatus').textContent='已读取保存的研究报告；仅供研究，非实时行情';
  }
 })(),aborted]);}catch(e){if(current(c)){if(e.denied)clear('权限已失效，私有研究已清空；请重新认证',true);else{empty();el('adaptiveLatestStatus').textContent='未显示报告';el('adaptiveStatus').textContent=timedOut?'等待超时，请重新读取；已提交的服务端研究可能继续执行':'研究未完成：'+(e.name==='SyntaxError'?'JSON格式无效':e.message);}}}
 finally{root.clearTimeout(timer);if(id===epoch){active=null;sync();}}
}
for(const event of ['input','change'])el('token').addEventListener(event,()=>clear(undefined,true));el('adaptiveFile').addEventListener('change',()=>clear());
el('adaptiveLatest').addEventListener('click',()=>run('read'));el('adaptiveRun').addEventListener('click',()=>run('run'));
root.addEventListener?.('offline',()=>clear('网络离线，私有研究已清空',true));root.addEventListener?.('pagehide',()=>clear('页面已离开，私有研究已清空',true));doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear('页面隐藏，私有研究已清空',true);});sync();
})(typeof window==='object'?window:globalThis);
