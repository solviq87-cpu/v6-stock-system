'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('file').addEventListener('change',async e=>{const f=e.target.files[0];if(f){if(f.size>7e6){$('status').textContent='文件过大';return;}$('payload').value=await f.text();}});
const card=(label,value)=>`<div class="card"><div class="muted">${esc(label)}</div><h2>${esc(value)}</h2></div>`;
function renderScan(r){
 const items=Array.isArray(r.items)?r.items:[];
 const positives=items.filter(x=>(x.patterns?.positiveCount||0)>0);
 const risks=items.filter(x=>(x.patterns?.riskCount||0)>0);
 const pools=r.patternPools||{};
 $('summary').innerHTML=card('扫描总数',r.total)+card('原有风险过滤后候选',r.eligible)+card('看涨战法命中',positives.length)+card('看跌形态预警',risks.length)+card('行情质量拒绝',r.rejected)+card('模拟来源',r.simulated);
 $('resultTitle').textContent='A股战法研究池 · 任意一套完整战法命中即可入观察池';
 const grouped=Object.entries(pools);
 $('patternPools').innerHTML=grouped.length?'<p class="muted">研究股票池与原正式精选池分开：同股可进入多个池，风险池不抵消看涨信号。历史数据仅供回测，不代表可实时交易。</p>'+
 grouped.map(([name,rows])=>'<details class="card"><summary><b>'+esc(name)+'</b> · '+rows.length+' 只</summary><div class="scroller"><table><thead><tr><th>代码 / 名称</th><th>看涨命中</th><th>风险</th><th>研究共振分</th><th>触发战法</th></tr></thead><tbody>'+
 rows.map(x=>'<tr><td>'+esc(x.symbol)+' '+esc(x.name)+'</td><td>'+esc(x.positiveCount)+'</td><td>'+esc(x.riskCount)+'</td><td>'+esc(x.confluencePoints)+'/100（非正式评分）</td><td>'+esc((x.matched||[]).join('、'))+'</td></tr>').join('')+
 '</tbody></table></div></details>').join(''):'<p class="muted">本次有效行情中暂无命中战法的股票；不为凑池虚构候选。</p>';
 $('table').innerHTML='<table><thead><tr><th>代码/名称</th><th>原评分</th><th>原候选</th><th>战法研究命中详情</th><th>连板</th><th>行情/风险</th></tr></thead><tbody>'+
 items.map(x=>{
  const matched=x.patterns?.matched||[];
  const checks=x.patterns?.checks||[];
  const positive=x.patterns?.positiveCount||0;
  const risk=x.patterns?.riskCount||0;
  const detail='<details><summary>看涨'+positive+'项 / 看跌'+risk+'项 · 研究共振'+(x.patterns?.confluencePoints||0)+'/100</summary>'+
    (matched.length?'<div><b>已命中：</b>'+esc(matched.map(y=>y.label).join('、'))+'</div>':'<div class="muted">暂无命中</div>')+
    '<ul>'+checks.map(y=>'<li><b>'+esc(y.status==='matched'?'✓':y.status==='insufficient_data'?'?':'—')+' '+esc(y.label)+'</b> · '+esc(y.side==='bearish'?'看跌/风险':'看涨')+' · '+esc(y.status==='matched'?'已命中':y.status==='insufficient_data'?'数据不足':'未命中')+' · '+esc(y.detail)+'</li>').join('')+'</ul>'+
    (x.patterns?.rps120==null?'':'<div>RPS120排名：'+esc(x.patterns.rps120)+'（样本横截面百分位）</div>')+
    '</details>';
  return '<tr><td>'+esc(x.symbol)+' '+esc(x.name)+'</td><td>'+esc(x.score??'—')+'</td><td class="'+(x.tradable?'good':'bad')+'">'+(x.tradable?'候选':'不满足')+'</td><td>'+detail+'</td><td>'+esc(x.ladder?.stage||'未知')+'</td><td>'+esc(x.quality.source||'未知')+' · '+esc([...(x.quality.errors||[]),...(x.quality.warnings||[])].join('；')||'通过')+'</td></tr>';
 }).join('')+'</tbody></table>';
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

// F01: Four independent rule systems. Render text through esc() only.
$('ruleAnalyze').onclick=async()=>{
 const button=$('ruleAnalyze'),status=$('ruleStatus'),summary=$('ruleSummary'),details=$('ruleDetails');
 button.disabled=true;summary.replaceChildren();details.replaceChildren();status.textContent='正在对照原始规则…';
 try{
  const payload=JSON.parse($('rulePayload').value||'{}');
  const token=$('token').value.trim();
  const response=await fetch('/api/research/rule-comparison',{method:'POST',
   headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'规则对照失败');
  const systems=data.analysis?.systems||{};
  const percent=n=>Number.isFinite(n)?(100*n).toFixed(1)+'%':'—';
  const blocks=[];
  const add=(label,system)=>{
   if(!system?.available&&system?.reason){blocks.push(`<h4>${esc(label)} · 不可用</h4><p class="muted">${esc(system.reason)}</p>`);return;}
   const c=system?.coverage||{};
   summary.insertAdjacentHTML('beforeend',card(label+' · 已知覆盖率',percent(c.coverageRate)));
   const rows=system?.rules||system?.dimensions||[];
   blocks.push(`<h4>${esc(label)} · 通过 ${esc(c.passed??'—')} / 已知 ${esc(c.known??'—')} / 未知 ${esc(c.unknown??'—')}</h4>`+
    '<table><thead><tr><th>条件</th><th>状态</th><th>实际值</th><th>比较</th><th>阈值</th><th>权重</th><th>说明</th></tr></thead><tbody>'+
    rows.map(x=>`<tr><td>${esc(x.label||x.id||'—')}</td><td>${esc(x.status||'unknown')}</td><td>${esc(x.observed??x.score??'—')}</td><td>${esc(x.op||'—')}</td><td>${esc(x.threshold??'—')}</td><td>${esc(x.weight??'—')}</td><td>${esc(x.reason||'')}</td></tr>`).join('')+'</tbody></table>');
  };
  add('十四条',systems.fourteen);add('八字口诀',systems.bazi);
  for(const strategy of systems.gpt||[])add('GPT · '+(strategy.name||'策略'),strategy);
  add('Python 三轮',systems.python);
  details.innerHTML=blocks.join('');
  status.textContent='规则对照完成：各体系独立显示；未知数据不算失败，评分不相加，不改变线上选股排名。';
 }catch(e){status.textContent='规则对照失败：'+e.message;}
 finally{button.disabled=false;}
};

// C03/F01: Single-request public market research + existing candidate intersection.
// This workflow never writes to the production ranking or silently fabricates scores.
$('fetchLiveMarket').onclick=async()=>{
 const button=$('fetchLiveMarket'),status=$('liveMarketStatus'),summary=$('liveMarketSummary'),table=$('liveMarketCandidates');
 button.disabled=true;summary.replaceChildren();table.replaceChildren();status.textContent='正在获取公开行情并分析候选交集…';
 try{
  const payload=JSON.parse($('liveMarketPayload').value.trim()||'{}');
  const token=$('token').value.trim();
  const response=await fetch('/api/research/live-market',{method:'POST',
   headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'实时市场研究失败');
  const r=data.analysis||data.result||{},b=r.breadth||{},regime=r.regime||{},join=r.candidateIntersection||{},meta=r.snapshotMetadata||{};
  const risk=r.riskEvidence||{},riskBox=$('liveMarketRisk');
  riskBox.innerHTML='<p class="muted">'+esc(risk.warning||'风险证据不可用')+'</p>'+
    '<table><thead><tr><th>股票</th><th>原评分</th><th>风险状态</th><th>缺失证据 / 说明</th></tr></thead><tbody>'+
    (risk.items||[]).map(x=>`<tr><td>${esc(x.code)} ${esc(x.name)}</td><td>${esc(x.originalScore??'未知')}</td><td>${esc(x.riskStatus)}</td><td>${esc(x.reason)}</td></tr>`).join('')+'</tbody></table>';
  status.textContent=`行情来源 ${meta.source||'未知'} · 请求日期 ${meta.date||'未知'}。未认证为交易所实时行情；候选评分未修改。`;
  summary.innerHTML=card('市场覆盖率',Number.isFinite(b.coverage)?(b.coverage*100).toFixed(1)+'%':'不可用')+
   card('上涨 / 下跌 / 平盘',b.usable?`${b.up} / ${b.down} / ${b.flat}`:'不可用')+
   card('市场环境',regime.usable?regime.regime:'不可判定')+
   card('候选行情匹配',join.usable?`${join.matched} 只`:'不可用');
  if(!b.usable)status.textContent+=' 市场宽度不可用：'+(b.reason||'数据质量不足');
  if(!regime.usable)status.textContent+=' 市场环境：'+(regime.reason||'缺少独立评分');
  if(!join.usable){table.textContent=join.reason||'候选交集不可用';return;}
  const items=join.items||[];
  table.innerHTML='<table><thead><tr><th>代码</th><th>名称</th><th>原候选评分</th><th>公开行情涨跌幅</th><th>成交额</th><th>来源日期</th></tr></thead><tbody>'+
   items.map(x=>`<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.candidateScore??'—')}</td><td>${esc(x.pctChange)}%</td><td>${esc(x.observedAmount??'—')}</td><td>${esc(x.source)} / ${esc(x.quoteDate)}</td></tr>`).join('')+'</tbody></table>';
  if(!items.length)table.textContent='没有匹配到已有候选股票；不会自动创建候选。';
 }catch(e){status.textContent='研究失败：'+e.message;}
 finally{button.disabled=false;}
};

// Integrated decision workbench: never modifies production ranking or issues orders.
function renderDecisionWorkspace(result){
 const ranked=Array.isArray(result.ranked)?result.ranked:[];
 const gate=result.releaseGate||{};
 const market=result.market||{};
 const metric=(label,value)=>`<div class="card"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong></div>`;
 $('decisionMetrics').innerHTML=metric('研究候选',ranked.length+' 只')+
   metric('风险证据就绪',ranked.filter(x=>x.evidenceReady).length+' 只')+
   metric('历史回测',result.historical?.status||'未验证')+
   metric('交易放行',result.canTrade===true?'需人工复核':'未放行');
 const blockers=Array.isArray(gate.blockers)?gate.blockers:[];
 $('decisionGate').innerHTML=`<p class="decision-banner">${esc(gate.eligible===true?'研究门禁检查通过（非交易许可）':'未通过正式上线门禁')}：${esc(blockers.join('；')||'仍需人工与生产验收')}</p>`;
 $('decisionRanking').innerHTML=ranked.length?'<table class="decision-table"><thead><tr><th>原始排名</th><th>股票</th><th>原始评分</th><th>风险状态</th><th>行情证据</th><th>原因</th></tr></thead><tbody>'+
 ranked.map(x=>`<tr><td>${esc(x.originalRank)}</td><td>${esc(x.name)} (${esc(x.code)})</td><td>${esc(x.originalScore??'未知')}</td><td><span class="decision-tag ${x.riskStatus==='blocked'?'blocked':'unknown'}">${esc(x.riskStatus)}</span></td><td>${x.evidenceReady?'已有证据':'未知'}</td><td>${esc(x.reason)}</td></tr>`).join('')+'</tbody></table>':'<p class="muted">当前服务器候选池为空，不能生成虚构排行榜。</p>';
 const systems=result.systems||{};
 $('decisionEvidence').innerHTML=`<div class="card"><h3>四套策略独立证据</h3><p class="muted">十四条、八字口诀、GPT 五策略、Python 三轮筛选；缺失不等于未命中。</p><pre>${esc(JSON.stringify(systems,null,2))}</pre></div>`+
 `<div class="card"><h3>市场与历史验证</h3><p>行情认证：${result.verifiedLive?'已验证':'未认证实时行情'}；生产排名：${result.productionRankingModified?'已变更':'保持不变'}</p><pre>${esc(JSON.stringify({breadth:market.breadth,regime:market.regime,historical:result.historical},null,2))}</pre></div>`;
}
$('runDecision').onclick=async()=>{
 const button=$('runDecision');button.disabled=true;
 $('decisionStatus').textContent='正在联网获取市场证据并分析服务器候选池…';
 try{
  const token=$('token').value.trim();
  const raw=$('liveMarketPayload').value.trim();
  const input=raw?JSON.parse(raw):{};
  const allowed=['scores','scoreSource','scoreDate','minCoverage'];
  const payload=Object.fromEntries(allowed.filter(k=>Object.prototype.hasOwnProperty.call(input,k)).map(k=>[k,input[k]]));
  const response=await fetch('/api/research/decision-pipeline',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error(result.error||'权限或行情请求失败');
  renderDecisionWorkspace(result);
  $('decisionStatus').textContent='研究完成：数据仅供研究，不是交易指令。';
 }catch(error){$('decisionStatus').textContent='研究未完成：'+String(error.message||error);}
 finally{button.disabled=false;}
};
