'use strict';
(()=>{const el=id=>document.getElementById(id);if(!el('adaptiveRun'))return;let busy=false,epoch=0;
function render(r){el('adaptiveOutput').textContent=JSON.stringify(r,null,2);el('adaptiveSummary').replaceChildren();
for(const [label,value] of [['市场环境',({risk_on:'偏强',risk_off:'偏弱',mixed:'分化',unknown:'证据不足'})[r.market.regime]||r.market.regime],['可研究候选',r.latest?.ranking.filter(x=>x.eligible).length||0],['学习版本',r.latest?.version?.slice(0,12)||'样本不足'],['模拟收益率(%)',r.simulation?.metrics?.returnPct??'未运行']]){const card=document.createElement('article'),name=document.createElement('div'),v=document.createElement('strong');card.className='card';name.textContent=label;v.textContent=String(value);card.append(name,v);el('adaptiveSummary').append(card);}for(const [id,label] of [['shanghai','上证'],['shenzhen','深证'],['chinext','创业板'],['a50','A50']]){const card=document.createElement('article'),name=document.createElement('div'),v=document.createElement('strong'),p=r.indexModels[id]?.latest?.upProbability;card.className='card';name.textContent=label+'次期上涨经验概率';v.textContent=Number.isFinite(p)?(p*100).toFixed(1)+'%':'样本或证据不足';card.append(name,v);el('adaptiveSummary').append(card);}}
const clear=()=>{epoch++;if(el('adaptiveLatestStatus'))el('adaptiveLatestStatus').textContent='数据或凭据已变更，请重新读取';el('adaptiveOutput').textContent='';el('adaptiveSummary').replaceChildren();el('adaptiveStatus').textContent='数据或凭据已变更，请重新运行';};
for(const id of ['adaptiveFile','token'])el(id).addEventListener(id==='token'?'input':'change',clear);
el('adaptiveLatest').addEventListener('click',async()=>{
 if(busy)return;busy=true;const ticket=epoch,token=el('token').value.trim();
 el('adaptiveLatest').disabled=true;el('adaptiveRun').disabled=true;
 el('adaptiveOutput').textContent='';el('adaptiveSummary').replaceChildren();
 el('adaptiveStatus').textContent='正在读取已保存的研究报告';el('adaptiveLatestStatus').textContent='核验中…';
 try{
  const response=await fetch('/api/research/adaptive-latest',{cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}}),data=await response.json();
  if(ticket!==epoch||token!==el('token').value.trim())return;
  if(!response.ok||!data.ok)throw Error(data.error||'读取被拒绝');
  if(data.status==='unconfigured'){el('adaptiveLatestStatus').textContent='尚未配置自动研究报告目录';el('adaptiveStatus').textContent='没有可显示的自动研究报告';return;}
  if(data.status!=='verified'||!data.result)throw Error('报告状态无效');
  render(data.result);
  const source=({simulated:'模拟数据',configured:'来源已配置，未经供应商认证',unknown:'来源未配置或未知'})[data.sourceStatus]||'来源未知';
  el('adaptiveLatestStatus').textContent='历史与报告校验通过 · 第'+data.revision+'版 · '+data.asOf+' · '+(data.stale?'已过期（超过'+data.maxAgeDays+'个自然日）':'距今'+data.ageDays+'个自然日')+' · '+source;
  el('adaptiveStatus').textContent='已读取保存的研究报告；仅供研究，非实时行情';
 }catch(e){if(ticket===epoch){el('adaptiveLatestStatus').textContent='未显示报告：'+e.message;el('adaptiveStatus').textContent='自动研究报告不可用';}}
 finally{busy=false;el('adaptiveLatest').disabled=false;el('adaptiveRun').disabled=false;}
});
el('adaptiveRun').addEventListener('click',async()=>{if(busy)return;const file=el('adaptiveFile').files[0],token=el('token').value.trim(),ticket=epoch;busy=true;el('adaptiveRun').disabled=true;el('adaptiveLatest').disabled=true;el('adaptiveLatestStatus').textContent='当前显示手动研究，未读取自动报告';el('adaptiveOutput').textContent='';el('adaptiveSummary').replaceChildren();el('adaptiveStatus').textContent='正在进行独立研究…';
try{if(!file||file.size>1800*1024)throw Error('请选择1800KiB以内JSON文件');const payload=JSON.parse(await file.text());if(ticket!==epoch||token!==el('token').value.trim())return;
const response=await fetch('/api/research/adaptive-market',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)}),data=await response.json();if(ticket!==epoch||token!==el('token').value.trim())return;if(!response.ok||!data.ok)throw Error(data.error||'研究失败');const r=data.result;render(r);el('adaptiveStatus').textContent='研究完成；概率不保证收益，未修改真实账户或生产规则';
}catch(e){if(ticket===epoch)el('adaptiveStatus').textContent='研究未完成：'+e.message;}finally{busy=false;el('adaptiveRun').disabled=false;el('adaptiveLatest').disabled=false;}});})();
