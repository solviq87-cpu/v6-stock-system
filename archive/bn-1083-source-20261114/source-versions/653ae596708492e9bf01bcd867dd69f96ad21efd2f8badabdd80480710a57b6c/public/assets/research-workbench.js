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
  const response=await fetch('/api/research/'+mode,{
   method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!data.ok)throw Error(data.error||data.msg||'无权限或数据格式错误');
  $('status').textContent='研究分析完成。注意：用户上传的数据未经过真实性验证，不是实时行情，也不代表实盘收益。';
  if(mode==='scan')renderScan(data.result);else renderLedger(data.result);
  $('results').hidden=false;
 }catch(e){$('status').textContent='分析失败：'+e.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
async function runCache(mode){
 const buttons=[$('cacheScan'),$('cacheBacktest')];buttons.forEach(b=>b.disabled=true);
 $('results').hidden=true;$('status').textContent='读取服务器内存K线缓存…';
 try{
  const token=$('token').value.trim(),url='/api/research/cache-'+mode;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify({limit:50})});
  const data=await response.json();if(!data.ok)throw Error((data.error||'无有效缓存')+(data.skipped?.length?'；跳过原因：'+data.skipped.slice(0,5).map(x=>x.code+':'+x.reason).join('；'):''));
  $('status').textContent=`缓存候选 ${data.selected} 只，有效 ${data.accepted} 只，跳过 ${data.skipped.length} 只。${data.skipped.slice(0,3).map(x=>x.code+':'+x.reason).join('；')} 缓存未经实时性认证，不能视为实时行情。`;
  if(mode==='scan')renderScan(data.result);else renderLedger(data.result);$('results').hidden=false;
 }catch(e){$('status').textContent='缓存分析失败：'+e.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('cacheScan').onclick=()=>runCache('scan');$('cacheBacktest').onclick=()=>runCache('ledger');
$('scan').onclick=()=>run('scan');$('backtest').onclick=()=>run('ledger');

// Persistent cache controls are developer-only server operations.
async function disk(mode){
 const codes=prompt('股票代码，英文逗号分隔；扫描全部缓存可留空：','')||'';
 const body={codes:codes.split(',').map(x=>x.trim()).filter(Boolean)};
 if(mode==='disk-save'&&!body.codes.length){$('status').textContent='保存前必须指定代码';return;}
 $('status').textContent='正在读取磁盘缓存…';
 try{const token=$('token').value.trim();const response=await fetch('/api/research/'+mode,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(body)});
 const data=await response.json();if(!data.ok)throw Error(data.error||'请求失败');
 $('status').textContent=mode==='disk-save'?`保存${data.saved.length}只；拒绝${data.skipped.length}只`:`已分析${data.accepted}只；拒绝${data.skipped.length}只。非实时行情。`;
 if(data.result){if(mode==='disk-scan')renderScan(data.result);else renderLedger(data.result);$('results').hidden=false;}
 }catch(e){$('status').textContent='磁盘研究失败：'+e.message;}
}
$('saveDisk').onclick=()=>disk('disk-save');$('diskScan').onclick=()=>disk('disk-scan');$('diskLedger').onclick=()=>disk('disk-ledger');

async function loadCapabilities(){try{const token=$('token').value.trim();const res=await fetch('/api/research/capabilities',{headers:token?{'Authorization':'Bearer '+token}:{}});const j=await res.json();if(j.ok){$('capabilities').textContent=`内存K线 ${j.memoryKlineCount} 只；磁盘缓存最多 ${j.diskKlineCountAtMost100} 只；已认证实时行情：否。`;}}catch{}}
$('token').addEventListener('change',loadCapabilities);loadCapabilities();

$('refresh').onclick=async()=>{
 $('refresh').disabled=true;$('status').textContent='正在获取历史K线…';
 try{
  const p=JSON.parse($('payload').value||'{}');
  const codes=Array.isArray(p.codes)?p.codes:(Array.isArray(p.stocks)?p.stocks.map(s=>s.symbol||s.code):[]);
  const token=$('token').value.trim();
  const res=await fetch('/api/research/history-refresh',{method:'POST',
   headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},
   body:JSON.stringify({codes})});
  const data=await res.json();
  if(!data.ok)throw Error(data.error||'获取失败');
  $('status').textContent=`历史K线更新：成功 ${data.success}/${data.requested}。${data.warning} `+
   data.rejected.map(x=>x.code+':'+x.reason).join('；');
 }catch(e){$('status').textContent='历史K线更新失败：'+e.message;}
 finally{$('refresh').disabled=false;}
};

// C03 observed market research: an explicit, separately authenticated workflow.
// Never merge user-submitted observations into the existing candidate ranking.
$('marketAnalyze').onclick=async()=>{
 const button=$('marketAnalyze'),status=$('marketStatus'),summary=$('marketSummary');
 button.disabled=true;summary.replaceChildren();status.textContent='正在验证来源、日期与市场覆盖率…';
 try{
  const payload=JSON.parse($('marketPayload').value);
  const token=$('token').value.trim();
  const response=await fetch('/api/research/observed-regime',{
   method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},
   body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||'市场研究接口拒绝请求');
  const result=data.analysis||{},breadth=result.breadth||{};
  if(!result.usable){status.textContent='研究结论不可用：'+(result.reason||'数据不完整');return;}
  status.textContent=`研究完成 · 快照 ${result.date} · 来源 ${result.source} · 环境评分来源 ${result.scoreSource}。未验证为实时行情，不影响原有选股策略。`;
  summary.innerHTML=card('有效覆盖率',(100*breadth.coverage).toFixed(1)+'%')+
   card('上涨 / 下跌 / 平盘',`${breadth.up} / ${breadth.down} / ${breadth.flat}`)+
   card('上涨占比',breadth.breadthScore+'%')+card('涨停 / 跌停（明确标记）',`${breadth.limitUp} / ${breadth.limitDown}`)+
   card('研究市场环境',result.regime)+card('研究攻击 / 防守评分',`${result.attackScore} / ${result.defensiveScore}`);
 }catch(e){status.textContent='市场研究失败：'+e.message;}
 finally{button.disabled=false;}
};

// On-demand Eastmoney public feed. No polling, no persistence, no ranking injection.
$('fetchLiveBreadth').onclick=async()=>{
 const button=$('fetchLiveBreadth'),status=$('liveBreadthStatus'),summary=$('liveBreadthSummary');
 button.disabled=true;summary.replaceChildren();status.textContent='正在逐页请求东方财富公开行情…';
 try{
  const token=$('token').value.trim();
  const response=await fetch('/api/research/eastmoney-breadth',{
   method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},
   body:'{}'});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||'行情服务不可用');
  const b=data.breadth||{},meta=data.snapshotMetadata||{};
  if(!b.usable){status.textContent='行情宽度不可用：'+(b.reason||'市场覆盖率或质量不合格');return;}
  const coverage=Number(b.coverage);
  status.textContent=`公开行情抓取完成 · 请求日期 ${meta.date||'未知'} · 来源 ${meta.source||'未知'} · ${meta.pages||0} 页。${meta.warning||''} 未认证为交易所实时行情。`;
  summary.innerHTML=card('抓取覆盖率',Number.isFinite(coverage)?(coverage*100).toFixed(1)+'%':'—')+
   card('上涨 / 下跌 / 平盘',`${b.up??'—'} / ${b.down??'—'} / ${b.flat??'—'}`)+
   card('上涨占比',b.breadthScore==null?'—':b.breadthScore+'%')+
   card('有效股票 / 市场总数',`${b.observed??'—'} / ${meta.universeSize??'—'}`);
 }catch(e){status.textContent='联网行情失败：'+e.message;}
 finally{button.disabled=false;}
};
