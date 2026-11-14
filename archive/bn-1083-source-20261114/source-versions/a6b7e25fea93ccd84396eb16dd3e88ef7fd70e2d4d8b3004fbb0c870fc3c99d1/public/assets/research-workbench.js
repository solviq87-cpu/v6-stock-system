'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('file').addEventListener('change',async e=>{const f=e.target.files[0];if(f){if(f.size>7e6){$('status').textContent='文件过大';return;}$('payload').value=await f.text();}});
const card=(label,value)=>`<div class="card"><div class="muted">${esc(label)}</div><h2>${esc(value)}</h2></div>`;
function renderScan(r){
 $('summary').innerHTML=card('扫描总数',r.total)+card('风险过滤后候选',r.eligible)+card('数据质量拒绝',r.rejected)+card('模拟来源',r.simulated);
 $('resultTitle').textContent='选股排行榜 · 风险过滤优先';
 $('table').innerHTML='<table><thead><tr><th>代码/名称</th><th>评分</th><th>可交易</th><th>连板阶段</th><th>战法匹配</th><th>行情/原因</th></tr></thead><tbody>'+
 r.items.map(x=>`<tr><td>${esc(x.symbol)} ${esc(x.name)}</td><td>${esc(x.score??'—')}</td><td class="${x.tradable?'good':'bad'}">${x.tradable?'候选':'不满足'}</td><td>${esc(x.ladder?.stage||'未知')}</td><td>${esc((x.strategy?.playbookAnalysis?.playbooks||[]).filter(p=>p.status==='candidate').map(p=>p.label).join('、')||'暂无')}</td><td>${esc(x.quality.source||'未知')} · ${esc([...x.quality.errors,...x.quality.warnings].join('；')||'通过')}</td></tr>`).join('')+'</tbody></table>';
}
function renderLedger(r){
 $('summary').innerHTML=card('期末资产',r.metrics.finalEquity)+card('研究收益率',r.metrics.returnPct+'%')+card('最大回撤',r.metrics.maxDrawdownPct+'%')+card('平仓笔数',r.metrics.closedTrades);
 $('resultTitle').textContent='每日持仓账本 · 仅研究用途';
 $('table').innerHTML='<table><thead><tr><th>交易日序号</th><th>现金</th><th>持仓市值</th><th>总资产</th><th>持仓数量</th></tr></thead><tbody>'+
 r.equity.map(x=>`<tr><td>${esc(x.day)}</td><td>${esc(x.cash)}</td><td>${esc(x.marketValue)}</td><td>${esc(x.value)}</td><td>${esc(x.openPositions)}</td></tr>`).join('')+'</tbody></table>'+
 `<p class="muted">成交 ${r.trades.length} 笔；受阻 ${r.orders.filter(x=>x.status==='blocked').length} 笔；未平仓 ${r.openPositions.length} 只。</p>`;
}
async function run(mode){
 const buttons=[$('scan'),$('backtest')];buttons.forEach(b=>b.disabled=true);
 $('results').hidden=true;$('status').textContent='正在分析…';
 try{
  const payload=JSON.parse($('payload').value);
  const token=$('token').value.trim();
  const response=await fetch('/api/research/'+mode+(token?'?token='+encodeURIComponent(token):''),{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!data.ok)throw Error(data.error||data.msg||'无权限或数据格式错误');
  $('status').textContent='研究分析完成。注意：用户上传的数据未经过真实性验证，不是实时行情，也不代表实盘收益。';
  if(mode==='scan')renderScan(data.result);else renderLedger(data.result);
  $('results').hidden=false;
 }catch(e){$('status').textContent='分析失败：'+e.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('scan').onclick=()=>run('scan');$('backtest').onclick=()=>run('ledger');
