'use strict';
(()=>{
 const el=id=>document.getElementById(id);if(!el('authorityAccount'))return;
 const controls=['authorityRead','authorityAudit','authorityConfigure','authoritySettle','evidencePreview','evidenceImport','evidenceCheck'];
 const fields={riskSingle:'maxPositionPct',riskGross:'maxGrossExposurePct',riskSector:'maxSectorPct',riskStrategy:'maxStrategyPct',riskStreak:'maxConsecutiveLosses',riskDrawdown:'maxDrawdownPausePct',riskDailyLoss:'maxDailyLossPausePct'};
 const inputs=['authorityAccount','settlementFile','evidenceFile','evidenceDate','evidenceSymbol',...Object.keys(fields)];
 let busy=false,generation=0,preview=null,renderedSession=null;
 const session=()=>({accountId:el('authorityAccount').value,token:el('token').value.trim(),generation});
 const current=s=>s.generation===generation&&s.accountId===el('authorityAccount').value&&s.token===el('token').value.trim();
 function buttons(){for(const id of controls)if(el(id))el(id).disabled=busy||(id==='evidenceImport'&&!preview);for(const id of inputs)if(el(id))el(id).disabled=busy;}
 function invalidate(contextChanged=true){
  generation++;preview=null;
  if(contextChanged){renderedSession=null;for(const id of Object.keys(fields))if(el(id))el(id).value='';el('authoritySummary').replaceChildren();el('authorityOutput').textContent='';}
  else if(renderedSession)renderedSession={...renderedSession,generation};
  buttons();if(el('evidenceOutput'))el('evidenceOutput').textContent='';
  el('authorityStatus').textContent=busy?'上下文已变更；在途操作仍针对原账户，请刷新核对':contextChanged?'账户或凭据已变更，请刷新并重新预检':'文件已变更，请重新预检';
 }
 async function call(s,action,extra={}){
  // Bind all requests in one operation to its original account and credentials.
  if(!current(s))throw Error('账户或凭据已变更，请重新操作');
  const r=await fetch('/api/research/order-account',{method:'POST',headers:{'Content-Type':'application/json',...(s.token?{Authorization:'Bearer '+s.token}:{})},body:JSON.stringify({accountId:s.accountId,action,...extra})});
  const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'账户请求失败');return data.result;
 }
 function show(s){renderedSession=session();el('authoritySummary').replaceChildren();for(const [name,value] of [['现金',s.account.cash.toFixed(2)],['持仓股票',Object.values(s.account.positions).filter(p=>p.quantity>0).length],['成交记录',s.account.events.length],['权益记录',s.corporateEvents?.length||0]]){const card=document.createElement('article');card.className='card';const label=document.createElement('div'),v=document.createElement('strong');label.textContent=name;v.textContent=String(value);card.append(label,v);el('authoritySummary').append(card);}for(const [id,key] of Object.entries(fields))if(el(id))el(id).value=s.riskPolicy?.[key]??'';el('authorityOutput').textContent=JSON.stringify(s,null,2);}
 const output=result=>{el('evidenceOutput').textContent=JSON.stringify(result,null,2);};
 async function run(action){
  if(busy)return;busy=true;const s=session();buttons();el('authorityStatus').textContent='正在核对…';
  try{
   if(action==='audit'){const audit=await call(s,'audit',{pagination:{limit:100}});if(!current(s))return;el('authorityOutput').textContent=JSON.stringify(audit,null,2);el('authorityStatus').textContent='审计校验通过，记录 '+audit.total+' 条；当前显示前100条';}
   else if(action==='configure'){
    preview=null;const riskPolicy={version:'user-risk-'+Date.now()};
    for(const [id,key] of Object.entries(fields)){if(!el(id))continue;const raw=el(id).value.trim();if(!raw){if(renderedSession&&current(renderedSession))riskPolicy[key]=null;continue;}const value=Number(raw);if(!Number.isFinite(value)||value<=0||value>(key==='maxConsecutiveLosses'?1000:100)||key==='maxConsecutiveLosses'&&!Number.isInteger(value))throw Error('风控上限填写无效');riskPolicy[key]=value;}
    if(!Object.values(fields).some(k=>riskPolicy[k]!=null))throw Error('至少填写一项风控上限');
    const before=await call(s,'read');const result=await call(s,'configure',{configuration:{expectedRevision:before.revision,riskPolicy:{...(before.riskPolicy||{}),...riskPolicy}}});if(!current(s))return;show(result);el('authorityStatus').textContent='新增仓位风控已保存';
   }else if(action==='settle'){
    preview=null;const file=el('settlementFile').files[0];if(!file||file.size>1024*1024)throw Error('请选择1MB以内的JSON结算凭据');const settlement=JSON.parse(await file.text());const before=await call(s,'read');const result=await call(s,'settle',{settlement,expectedRevision:before.revision});if(!current(s))return;show(result);el('authorityStatus').textContent='权益结算已入账，资金与持仓已刷新';
   }else if(action==='preview'){
    preview=null;const file=el('evidenceFile').files[0];if(!file||file.size>2*1024*1024)throw Error('请选择2MB以内的JSON证据数组');
    const records=JSON.parse(await file.text());if(!Array.isArray(records)||!records.length||records.length>100)throw Error('证据文件必须为1至100条JSON数组');
    const before=await call(s,'read'),result=await call(s,'preview-risk-evidence-import',{expectedRevision:before.revision,evidenceList:records});
    if(!current(s)||el('evidenceFile').files[0]!==file)return;
    preview={...s,file,records,revision:result.accountRevision};output(result);el('authorityStatus').textContent='预检通过：新增 '+result.imported+' 条，重复 '+result.unchanged+' 条；尚未导入';
   }else if(action==='import'){
    const plan=preview;preview=null;
    if(!plan||!current(plan)||el('evidenceFile').files[0]!==plan.file)throw Error('请先预检当前账户的证据文件');
    const result=await call(s,'import-risk-evidence-batch',{expectedRevision:plan.revision,evidenceList:plan.records});if(!current(s))return;show(result);el('authorityStatus').textContent='整组证据已导入；请按交易日检查证据，开仓仍需执行风控';
   }else if(action==='check'){
    const result=await call(s,'risk-evidence-status',{query:{tradeDate:el('evidenceDate').value,symbol:el('evidenceSymbol').value.trim()}});if(!current(s))return;output(result);el('authorityStatus').textContent=result.evidenceReady?'当前配置所需证据齐备；不代表允许开仓':'证据未齐备，请查看缺失原因';
   }else{const result=await call(s,'read');if(!current(s))return;show(result);if(preview&&preview.revision!==result.revision)preview=null;el('authorityStatus').textContent='主账户已刷新';}
  }catch(e){if(current(s)){if(action==='import'||action==='preview')preview=null;el('authorityStatus').textContent='操作未完成：'+e.message;}}
  finally{busy=false;buttons();}
 }
 for(const [id,action] of [['authorityRead','read'],['authorityAudit','audit'],['authorityConfigure','configure'],['authoritySettle','settle'],['evidencePreview','preview'],['evidenceImport','import'],['evidenceCheck','check']])if(el(id))el(id).addEventListener('click',()=>run(action));
 for(const [id,event] of [['authorityAccount','change'],['token','input'],['evidenceFile','change']])if(el(id))el(id).addEventListener(event,()=>invalidate(id!=='evidenceFile')); 
 buttons();
})();
