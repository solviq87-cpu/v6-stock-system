(function(root){
 'use strict';
 const doc=root.document;if(!doc)return;
 const el=id=>doc.getElementById(id),load=el('research36Catalog'),run=el('research36Run');if(!load||!run)return;
 const token=el('token'),file=el('research36File'),status=el('research36Status'),configBox=el('research36Config'),resultBox=el('research36Result');
 let generation=0,config={};
 const node=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 function clear(message='研究上下文变化，结果已清空。'){generation++;resultBox.replaceChildren();status.textContent=message;run.disabled=false;load.disabled=false;}
 token?.addEventListener('input',()=>{clear();configBox.replaceChildren();config={};});
 token?.addEventListener('change',()=>{clear();configBox.replaceChildren();config={};});
 file.addEventListener('change',()=>clear('已更换证据文件，请重新分析。'));
 root.addEventListener('offline',()=>{clear('离线，私有研究结果已清空。');configBox.replaceChildren();config={};});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)clear();});
 root.addEventListener('pagehide',()=>clear());
 function renderCatalog(catalog){
  configBox.replaceChildren();config={};
  for(const s of catalog.strategies){
   const card=node('details');card.className='card';card.append(node('summary',s.name+' · 实验'));
   const c=config[s.id]={enabled:s.enabled,weight:1,thresholds:{}};
   const label=node('label','纳入本次研究 '),check=node('input');check.type='checkbox';check.checked=c.enabled;
   check.addEventListener('change',()=>{c.enabled=check.checked;clear('配置已变更，请重新分析。');});label.append(check);card.append(label);
   const weightLabel=node('label','研究权重 '),weight=node('input');weight.type='number';weight.min='0';weight.max='100';weight.step='0.1';weight.value='1';
   weight.addEventListener('input',()=>{c.weight=weight.value===''?null:Number(weight.value);clear('配置已变更，请重新分析。');});weightLabel.append(weight);card.append(weightLabel);
   for(const r of s.rules){
    card.append(node('p',r.field+' '+r.op+' '+JSON.stringify(r.value)+' ['+r.unit+']'));
    if(r.type==='number'){
     const values=Array.isArray(r.value)?r.value:[r.value],inputs=[];
     values.forEach(value=>{const input=node('input');input.type='number';input.step='any';input.value=String(value);input.setAttribute('aria-label',s.name+' '+r.field+' 阈值');inputs.push(input);card.append(input);});
     for(const input of inputs)input.addEventListener('input',()=>{const values=inputs.map(i=>i.value===''?null:Number(i.value));c.thresholds[r.field]=r.op==='between'?values:values[0];clear('阈值已变更，请重新分析。');});
    }
   }
   card.append(node('p','失效：'+s.invalidation));configBox.append(card);
  }
 }
 function render(result){
  resultBox.replaceChildren();
  const names={research_candidate:'关注研究',not_matched:'条件未满足',insufficient_data:'等待数据',disabled:'未启用'};
  for(const row of result.evaluations){
   const card=node('article');card.className='card';card.append(node('h3',row.name),node('p',names[row.status]||'未知'),node('p','条件分：'+(row.score??'未知')+'（不是概率）'));
   for(const [title,checks] of [['支持',row.support],['反对',row.opposition],['缺失',row.missing]]){
    const details=node('details');details.append(node('summary',title+' '+checks.length+'项'));
    for(const c of checks)details.append(node('p',c.field+'：'+(c.missing||String(c.value))+'；来源 '+(c.evidence?.source||'未知')+'；原时点 '+(c.evidence?.observedAt?new Date(c.evidence.observedAt).toISOString():'未知')));
    card.append(details);
   }
   card.append(node('p','失效：'+row.invalidation));resultBox.append(card);
  }
  status.textContent=result.code+' · '+result.matched+'项研究条件命中；来源未经独立认证，不自动交易。';
 }
 async function request(kind){
  clear('正在处理研究证据…');const current=generation,secret=token?.value.trim()||'';
  const active=()=>current===generation&&secret===(token?.value.trim()||'')&&!doc.hidden;
  load.disabled=true;run.disabled=true;
  try{
   const options={method:kind==='catalog'?'GET':'POST',cache:'no-store',headers:secret?{Authorization:'Bearer '+secret}:{}};
   if(kind!=='catalog'){
    const chosen=file.files?.[0];if(!chosen||chosen.size>256*1024)throw Error('file');
    const input=JSON.parse(await chosen.text());if(!active())return;
    options.headers['Content-Type']='application/json';options.body=JSON.stringify({...input,config:Object.keys(config).length?config:input.config||{}});
   }
   const response=await root.fetch('/api/research/strategy36',options),data=await response.json();if(!active())return;
   if(!response.ok||!data.ok)throw Error('unavailable');
   if(kind==='catalog'){renderCatalog(data.catalog);status.textContent='36项实验规则；修改仅影响本次研究，不修改生产参数。';}else render(data.result);
  }catch{if(active()){resultBox.replaceChildren();status.textContent='未完成：请检查权限、证据JSON、时点和配置；没有生成交易建议。';}}
  finally{if(current===generation){load.disabled=false;run.disabled=false;}}
 }
 load.addEventListener('click',()=>request('catalog'));run.addEventListener('click',()=>request('evaluate'));
})(typeof window==='object'?window:globalThis);
