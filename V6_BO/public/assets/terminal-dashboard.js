/* Reference-inspired visual shell. Observed data only; existing controls and role checks remain authoritative. */
(function(){
'use strict';
const mobile=!!document.getElementById('app');
const host=mobile?document.getElementById('app'):document.querySelector('.wrap');
if(!host)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',settings:'m9 3 1-2h4l1 2 3 2 2 1v4l-2 1v3l2 1v4l-2 1-3 2-1 2h-4l-1-2-3-2-2-1v-4l2-1v-3l-2-1V6l2-1 3-2Zm7 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',target:'M12 3v3m0 12v3M3 12h3m12 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',flask:'M9 3h6m-5 0v7L4 20h16l-6-10V3M8 15h8',chart:'M4 20V12m5 8V8m5 12V4m5 16V10M3 6l5-3 5 3 7-5',wallet:'M3 6h17v15H3V6Zm0 0 14-3v3m-2 7h6v4h-6v-4Z',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 5v8m-4-4h8',bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',arrow:'m8 4 8 8-8 8',refresh:'M20 7a9 9 0 1 0 1 9M20 2v6h-6'};
const icon=k=>`<svg class="vx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k]||paths.chart}"/></svg>`;
const logo=`<svg class="vx-logo" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="vx-logo-gradient" x2="0" y2="1"><stop stop-color="#56e4ff"/><stop offset="1" stop-color="#7161ff"/></linearGradient></defs><path d="M4 31h8v13H4zm11-7h8v20h-8zm11 3h8v17h-8zm11-13h8v30h-8z" fill="url(#vx-logo-gradient)"/><path d="m4 25 12-12 10 6L43 3m-9 0h9v9" fill="none" stroke="#ee7cc6" stroke-width="3"/></svg>`;
const link=(href,label,k,extra='')=>`<a href="${href}" ${extra}>${icon(k)}<span>${label}</span></a>`;
const base=mobile?'/':'';
const shell=document.createElement('div');
shell.className='vx-shell';
shell.innerHTML=`
<div class="vx-topbar"><a class="vx-brand" href="${mobile?'/m':'/'}">${logo}<span><strong>天枢智策</strong><small>A股智能选股 · 策略研究 · 风险控制</small></span></a><nav class="vx-mainnav" aria-label="系统导航">
${link('#vx-dashboard','首页','home','aria-current="page"')}${link(base+'#v6-stock','智能选股','target')}${link('/research.html','策略研究','flask')}${link('/research.html#completeHeading','回测分析','chart')}${link(base+'#v6-paper','模拟交易','wallet')}${link(base+'#v6-market','行情中心','chart')}${link(base+'#v6-strategy','风险控制','shield')}${link('#vx-ranking','排行榜','grid')}${link('#tabBar','更多','grid','class="vx-nav-more"')}</nav>
<div class="vx-topactions">${link(base+'#v6-stock','搜索股票','search','class="vx-search-action"')}${link(base+'#v6-news','消息','bell')}${link(base+'#v6-release','系统设置','settings','class="vx-settings-action"')}<button class="vx-identity" type="button" title="查看或切换身份">${icon('user')}<span id="vx-role">身份管理</span></button></div></div>
<aside class="vx-sidebar" aria-label="工作区导航"><div class="vx-aside-caption">WORKSPACE <span>工作台</span></div>${link('#vx-dashboard','总览仪表盘','grid','aria-current="page"')}${link(base+'#v6-market','市场环境','chart')}${link(base+'#v6-stock','选股中心','target')}${link('/research.html#decisionWorkspace','AI 策略引擎','flask')}<details open><summary>${icon('grid')}四套选股体系</summary><a href="#vx-ranking" data-vx-filter="fourteen">十四条选股</a><a href="#vx-ranking" data-vx-filter="bazi">八字口诀</a><a href="#vx-ranking" data-vx-filter="gpt">GPT 五策略</a><a href="#vx-ranking" data-vx-filter="python">Python 三轮筛选</a></details>${link('/research.html#completeHeading','策略回测','chart')}${link(base+'#v6-paper','模拟交易','wallet')}${link(base+'#v6-strategy','持仓与风控','shield')}${link('#vx-ranking','选股排行榜','star')}${link(base+'#v6-news','消息与推送','bell')}${link(base+'#v6-release','系统管理','grid')}<div class="vx-aside-bottom"><svg class="vx-bull" viewBox="0 0 180 105" aria-hidden="true"><defs><filter id="vx-bull-glow"><feGaussianBlur stdDeviation="2"/></filter></defs><path d="M16 75Q23 53 47 50L65 36Q90 23 116 40L137 49L153 42L147 57L162 67L153 77L137 75L126 65L119 83L110 95L101 94L107 77L88 72L64 79L56 96H46L48 76L36 69L27 90H17L22 70M27 61Q7 49 13 41M139 49Q145 27 151 35M144 58Q161 54 166 45" fill="none" stroke="#19cfee" stroke-width="1.5"/><path d="M16 75Q23 53 47 50L65 36Q90 23 116 40L137 49L153 42L147 57L162 67L153 77L137 75L126 65L119 83L110 95L101 94L107 77L88 72L64 79L56 96H46L48 76L36 69L27 90H17L22 70" fill="#00c8eb12" stroke="#28dfff" opacity=".6" filter="url(#vx-bull-glow)"/></svg><strong>天枢智策</strong><small>版本：20261112push</small></div></aside>`;
if(mobile){host.prepend(shell);}else{document.body.prepend(shell);document.body.classList.add('vx-desktop');}

const dashboard=document.createElement('section');
dashboard.id='vx-dashboard';
dashboard.className='vx-dashboard';
dashboard.setAttribute('aria-label','量化看盘总览');
dashboard.innerHTML=`
<div class="vx-statusline"><span><i></i><time id="vx-time">等待行情快照</time></span><span id="vx-source">尚未读取数据</span></div>
<div class="vx-market-strip"><div class="vx-index-grid" id="vx-indices"></div></div>
<div class="vx-overview-grid"><article class="vx-panel vx-signals"><h2><span class="vx-ai-badge">AI</span> AI 综合选股信号</h2><div class="vx-metrics" id="vx-counts"></div></article>
<article class="vx-panel vx-strategies"><h2>${icon('chart')}四套策略信号数量</h2><div id="vx-strategies"></div></article>
<article class="vx-panel vx-mood"><h2>市场情绪</h2><div class="vx-gauge"><svg viewBox="0 0 180 100" aria-hidden="true"><defs><linearGradient id="vx-gauge-gradient"><stop stop-color="#00dd89"/><stop offset=".55" stop-color="#f9d875"/><stop offset="1" stop-color="#fc506a"/></linearGradient></defs><path d="M15 90a75 75 0 0 1 150 0" stroke="#18314c" stroke-width="13" fill="none"/><path id="vx-gauge-path" d="M15 90a75 75 0 0 1 150 0" stroke="url(#vx-gauge-gradient)" stroke-width="13" fill="none" pathLength="100" stroke-dasharray="0 100"/></svg><strong id="vx-ratio">—</strong></div><small id="vx-mood-scope">上涨家数占比</small></article>
<article class="vx-panel vx-environment"><h2>${icon('shield')}市场环境判断</h2><strong id="vx-mood-label" class="vx-regime">待评估</strong><p id="vx-mood-note">等待有效的行情证据</p><div class="vx-risk-line">候选池风险提示 <b id="vx-risk">—</b></div></article></div>
<div class="vx-content-grid"><article class="vx-panel vx-ranking" id="vx-ranking"><div class="vx-table-toolbar"><h2>${icon('star')}AI 选股排行榜</h2><label class="vx-sort-label">排序 <select id="vx-sort"><option value="original">原始排序</option><option value="score">评分降序</option></select></label></div><div class="vx-tabs" role="tablist" aria-label="策略筛选">${[['all','AI选股排行榜'],['focused','重点关注'],['fourteen','十四条'],['bazi','八字口诀'],['gpt','GPT 五策略'],['python','Python 三轮']].map(([v,l])=>`<button type="button" role="tab" aria-selected="${v==='all'}" data-vx-filter="${v}">${l}</button>`).join('')}</div><div class="vx-table-scroll"><table><thead><tr><th>#</th><th class="vx-code-cell">股票代码</th><th>股票名称<span class="vx-mobile-only">(代码)</span></th><th>快照价</th><th>涨跌幅</th><th>综合评分</th><th class="vx-wide-cell">主要信号</th><th class="vx-wide-cell">策略来源</th><th class="vx-wide-cell">风险等级</th><th>查看</th></tr></thead><tbody id="vx-rows"></tbody></table></div><div class="vx-table-footer"><span id="vx-table-note">等待候选池</span><a href="/research.html">独立策略验证 ${icon('arrow')}</a></div></article>
<div class="vx-detail-column"><article class="vx-panel vx-chart-panel"><div class="vx-detail-tabs"><span>Ｋ线走势</span><a href="${base}#v6-stock">资金流向</a><a href="/research.html">技术指标</a><a href="/research.html#decisionWorkspace">诊断分析</a><button id="vx-chart-refresh" type="button" aria-label="刷新所选股票K线">${icon('refresh')}</button></div><div class="vx-stock-title"><strong id="vx-selected">选择一只股票</strong><span id="vx-selected-price">—</span></div><div id="vx-provider-links" style="padding:8px 12px" aria-live="polite"></div><div class="vx-ma-legend"><span>MA5</span><span>MA10</span><span>MA20</span></div><div id="vx-chart" class="vx-chart-empty">点击排行榜，查看对应行情</div><small id="vx-chart-source">仅绘制接口实际返回的K线</small></article>
<article class="vx-panel vx-explanation"><h2>${icon('flask')}AI 信号解释 <a href="/research.html#decisionWorkspace">详细研究 ›</a></h2><span class="vx-research-pill">研究观察 · 非交易指令</span><div id="vx-explanation">选中股票后展示已有信号及证据；缺失项目保留为空。</div></article>
<article class="vx-panel vx-explanation" id="vx-pattern-panel"><h2>历史K线战法研究 <a href="/research.html">完整战法池 ›</a></h2><span class="vx-research-pill">仅历史研究 · 不改变原评分</span><div id="vx-pattern-preview" aria-live="polite">选中股票后展示看涨形态与看跌风险，缺少K线时不作判断。</div></article>
<article class="vx-panel vx-explanation" id="vx-issuer-panel"><h2>上市公司公告 · 风险与优势</h2><span class="vx-research-pill">标题研究线索 · 非交易指令</span><div id="vx-issuer-evidence">选中股票后展示匹配的公告原文与风险提示。</div></article>
<article class="vx-panel vx-explanation vx-condition-panel" id="vx-condition-panel"><h2>策略条件与因子证据</h2><div id="vx-condition-summary">请选择系统推送股票或候选股票查看条件满足情况。</div><div class="vx-condition-list" id="vx-condition-list"></div><div id="vx-condition-detail">待选择条件</div></article>
<article class="vx-panel vx-explanation vx-research-panel" id="vx-research-panel"><h2>研究预演 <small>与生产推送隔离</small></h2><span class="vx-research-pill">临时调参 · 不改生产推送</span><div class="vx-research-grid"><label>研究模式<select id="vx-research-mode"><option value="production">生产配置</option><option value="draft">研究预演</option></select></label><label>因子<select id="vx-factor-select"></select></label><label>阈值 <input id="vx-factor-threshold" type="range" min="0" max="100" step="1" value="70"/><span id="vx-factor-threshold-value">70</span></label></div><div class="vx-research-actions"><button type="button" id="vx-draft-apply">应用预演</button><button type="button" id="vx-draft-undo">撤销</button><button type="button" id="vx-draft-reset">恢复默认</button><button type="button" id="vx-draft-save">保存配置</button></div><div id="vx-draft-note">未启用研究预演。</div><div id="vx-draft-history"></div></article></div></div>`;
if(mobile)shell.after(dashboard);else host.prepend(dashboard);

const strip=dashboard.querySelector?dashboard.querySelector('.vx-market-strip'):null;
if(strip){
 const pushPanel=document.createElement('article');
 pushPanel.className='vx-panel vx-push-panel';
 pushPanel.id='vx-pushes';
 pushPanel.innerHTML=`<h2>${icon('bell')}系统推送股票</h2><div class="vx-push-context" id="vx-push-context">当前对象：全部指数 · 全部板块</div><div class="vx-push-tabs"><button type="button" data-vx-push-tab="pushed" aria-pressed="true">系统推送</button><button type="button" data-vx-push-tab="candidate" aria-pressed="false">研究候选</button><button type="button" data-vx-push-tab="watch" aria-pressed="false">自选股票</button></div><div class="vx-push-filters"><label>指数<select id="vx-index-scope"><option value="all">全部指数</option><option value="1.000001">上证指数</option><option value="0.399001">深证成指</option><option value="0.399006">创业板指</option><option value="1.000688">科创50</option></select></label><label>状态<select id="vx-push-stage"><option value="all">全部状态</option><option value="candidate">候选股票</option><option value="triggered">信号已触发</option><option value="pending">待发送</option><option value="sent">发送成功</option><option value="failed">发送失败</option><option value="expired">已失效</option></select></label></div><div class="vx-sector-chips" id="vx-sector-chips"></div><div class="vx-push-summary" id="vx-push-summary">等待推送信号</div><div class="vx-push-list" id="vx-push-list" role="list"></div>`;
 strip.append(dashboard.querySelector('.vx-mood'),pushPanel,dashboard.querySelector('.vx-environment'));
 const risk=document.createElement('article');
 risk.className='vx-panel vx-risk-panel';
 risk.innerHTML=`<h2>${icon('shield')}风险概览</h2><dl><div><dt>候选池风险提示</dt><dd id="vx-risk-detail">—</dd></div><div><dt>仓位建议</dt><dd>待风控评估</dd></div><div><dt>最大回撤预警</dt><dd>待账户核验</dd></div></dl>`;
 const performance=document.createElement('article');
 performance.className='vx-panel vx-performance';
 performance.innerHTML=`<h2>${icon('chart')}今日策略表现 <small>独立验证</small></h2><dl>${['十四条选股','八字口诀','GPT 五策略','Python 三轮筛选'].map(label=>`<div><dt>${label}</dt><dd>未评估</dd></div>`).join('')}</dl>`;
 const toolbar=dashboard.querySelector('.vx-table-toolbar');
 toolbar.insertBefore(dashboard.querySelector('.vx-tabs'),toolbar.querySelector('.vx-sort-label'));
 const overview=dashboard.querySelector('.vx-overview-grid');
 overview.append(risk,performance);
 if(mobile)strip.append(risk);
}

if(mobile){
 document.body.classList.add('vx-mobile');
 const footer=document.createElement('nav');
 footer.className='vx-mobile-dock';
 footer.setAttribute('aria-label','手机主导航');
 footer.innerHTML=link('#vx-dashboard','首页','home','aria-current="page"')+link('/#v6-stock','自选股','star')+link('/#v6-market','行情','chart')+'<a class="vx-dock-ai" href="/research.html"><span>AI</span><small>研究</small></a>'+link('/#v6-paper','模拟交易','wallet')+link('/#v6-strategy','风控','shield')+link('#vx-pushes','推送','bell');
 host.append(footer);
}

const riskCard=document.createElement('article');
riskCard.className='vx-panel vx-evidence-card';
riskCard.innerHTML='<h2>今日风险与新闻依据</h2><strong id="vx-risk-status">今日观望</strong><p id="vx-risk-reasons">等待有效证据</p><details><summary>查看资金与新闻依据</summary><div id="vx-risk-evidence"></div></details>';// Supplemental risk/news evidence belongs after the reference overview and chart, not above the market strip.
dashboard.append(riskCard);

const el=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const format=(v,d=2)=>finite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const codeRe=/^\d{6}$/;
const stageMap={candidate:'候选股票',triggered:'信号已触发',pending:'待发送',sent:'发送成功',failed:'发送失败',expired:'已失效'};

let model=null,filter='all',selected=null,epoch=0,controller=null,indexScope='all',sectorScope='',pushStage='all',pushTab='pushed';
const observedSeries=new Map();
const conditionCache=new Map();
const pushUi={open:new Set(),pinned:new Set(),scrollTop:0};
const research={mode:'production',factor:'',threshold:70,history:[],undo:[]};

function readStore(key,fallback){
 try{
  if(typeof localStorage==='undefined')return fallback;
  const raw=localStorage.getItem(key);
  return raw?JSON.parse(raw):fallback;
 }catch{return fallback;}
}
function writeStore(key,value){
 try{if(typeof localStorage!=='undefined')localStorage.setItem(key,JSON.stringify(value));}catch{}
}
research.history=Array.isArray(readStore('vx-research-draft-history',[]))?readStore('vx-research-draft-history',[]):[];
const savedDraft=readStore('vx-research-draft-current',null);
if(savedDraft&&typeof savedDraft==='object'){
 if(savedDraft.mode==='draft'||savedDraft.mode==='production')research.mode=savedDraft.mode;
 if(typeof savedDraft.factor==='string')research.factor=savedDraft.factor;
 if(finite(savedDraft.threshold))research.threshold=Math.max(0,Math.min(100,Math.round(savedDraft.threshold)));
}

function quoteDescription(row){
 const at=row?.quoteAt;
 if(!Number.isSafeInteger(at)||at<=0||typeof row?.quoteSource!=='string'||!row.quoteSource.trim())return '报价时点或来源未知';
 if(at>Date.now())return '报价时点异常';
 return '快照 · '+new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
}

function selectedQuote(row){
 const node=el('vx-selected-price');
 if(!node)return;
 node.className=row?.pct<0?'vx-down':'vx-up';
 if(!row){
  node.textContent='— · 当前候选池无报价';
  node.title='当前候选池无报价';
  node.setAttribute('aria-label',node.title);
  return;
 }
 const brief=format(row.price)+' '+(finite(row.pct)?(row.pct>0?'+':'')+row.pct.toFixed(2)+'%':'—');
 const provenance=quoteDescription(row);
 // Match the owner's single-line original chart title; preserve original quote
 // source/time for hover and assistive technology, never label it as live.
 node.textContent=brief;
 node.title=provenance;
 node.setAttribute('aria-label',brief+' · '+provenance);
}

function indexKey(indexCode){
 if(indexCode==='1.000001')return 'sh';
 if(indexCode==='0.399001')return 'sz';
 if(indexCode==='0.399006')return 'cyb';
 if(indexCode==='1.000688')return 'kc50';
 return 'all';
}
function rowInIndex(row,scope){
 if(scope==='all')return true;
 const code=String(row?.code||'');
 const key=indexKey(scope);
 if(key==='sh')return /^60/.test(code);
 if(key==='sz')return /^(00|001|002|003|30)/.test(code);
 if(key==='cyb')return /^30/.test(code);
 if(key==='kc50')return /^68/.test(code);
 return true;
}
function rowInSector(row){
 if(!sectorScope)return true;
 return String(row?.sector||'')===sectorScope;
}
function rowInResearch(row){
 if(research.mode!=='draft'||!research.factor)return true;
 const value=row?.factorValues&&finite(row.factorValues[research.factor])?row.factorValues[research.factor]:null;
 return value!==null&&value>=research.threshold;
}
function tabFilteredRows(){
 let rows=model?.rows||[];
 if(filter==='focused')rows=rows.filter(x=>x.focused);
 else if(filter==='bazi')rows=rows.filter(x=>x.bazi);
 else if(filter==='fourteen')rows=rows.filter(x=>x.fourteen);
 else if(['gpt','python'].includes(filter))rows=[];
 return rows;
}
function displayRows(applyResearch=true){
 let rows=tabFilteredRows().filter(row=>rowInIndex(row,indexScope)&&rowInSector(row));
 if(applyResearch)rows=rows.filter(rowInResearch);
 if(el('vx-sort')&&el('vx-sort').value==='score')rows=[...rows].sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity));
 return rows;
}

function renderRows(){
 const rows=displayRows(true);
 const body=el('vx-rows');
 if(!body)return rows;
 body.innerHTML=rows.length?rows.slice(0,20).map((r,i)=>`<tr class="${r.code===selected?'vx-row-selected':''}"><td><span class="vx-rank vx-rank-${i+1}">${i+1}</span></td><td class="vx-code-cell">${esc(r.code)}</td><td><b>${esc(r.name||r.code)}</b><small>${esc(r.code)}</small></td><td class="${r.pct<0?'vx-down':'vx-up'}" title="${esc(quoteDescription(r))}">${format(r.price)}<small>${esc(quoteDescription(r))}</small></td><td class="${r.pct<0?'vx-down':'vx-up'}">${finite(r.pct)?(r.pct>0?'+':'')+r.pct.toFixed(2)+'%':'—'}</td><td><span class="vx-score">${format(r.score,1)}</span></td><td class="vx-wide-cell vx-signal-cell">${esc(r.signals?.join(' · ')||'尚无信号')}</td><td class="vx-wide-cell vx-origin">${r.fourteen?'十四条选股':r.bazi?'八字口诀':'候选池'}</td><td class="vx-wide-cell"><span class="vx-risk-tag ${r.bad?'warn':''}">${r.bad?'有提示':'待核验'}</span></td><td><button class="vx-row-open" type="button" data-vx-code="${esc(r.code)}" aria-label="查看${esc(r.name||r.code)}行情">${icon('arrow')}</button></td></tr>`).join(''):'<tr><td colspan="10"><div class="vx-empty"><span>◈</span><strong>暂无可展示的策略证据</strong><p>等待行情或到研究工作台运行独立验证</p></div></td></tr>';
 const note=research.mode==='draft'&&research.factor?`研究预演：${research.factor} ≥ ${research.threshold}`:'评分沿用原系统口径';
 el('vx-table-note').textContent=`${rows.length} 只候选 · ${note}`;
 document.querySelectorAll('.vx-tabs [data-vx-filter]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.vxFilter===filter));b.tabIndex=b.dataset.vxFilter===filter?0:-1;});
 return rows;
}

function indexSpark(key,value,time){
 if(!finite(value)||!finite(time))return '<small>行情未就绪</small>';
 let list=observedSeries.get(key)||[];
 if(list.length&&new Date(time).toDateString()!==new Date(list.at(-1).time).toDateString())list=[];
 if(!list.length||list.at(-1).time!==time)list.push({value,time});
 list=list.slice(-40);
 observedSeries.set(key,list);
 if(list.length<2)return '<small>等待后续价格采样</small>';
 const values=list.map(x=>x.value),min=Math.min(...values),range=Math.max(...values)-min||1;
 const pts=values.map((v,i)=>`${i*200/(values.length-1)},${42-(v-min)/range*34}`).join(' ');
 const gradient="vx-spark-"+key.replace(/[^a-z0-9]/gi,"-");
 return `<svg class="vx-spark" viewBox="0 0 200 50" preserveAspectRatio="none" aria-label="本页面观察到的指数价格序列"><defs><linearGradient id="${gradient}" x2="0" y2="1"><stop stop-color="currentColor" stop-opacity=".3"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><polygon points="0,50 ${pts} 200,50" fill="url(#${gradient})"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function shapeCondition(c){
 if(!c||typeof c!=='object')return null;
 return {
  id:String(c.id||Math.random()),
  label:String(c.label||'未命名条件'),
  value:finite(c.value)?c.value:null,
  threshold:finite(c.threshold)?c.threshold:null,
  operator:String(c.operator||'>='),
  source:String(c.source||'来源未知'),
  reason:String(c.reason||'缺少判定依据'),
  satisfied:c.satisfied===true?true:c.satisfied===false?false:null,
  updatedAt:finite(c.updatedAt)?c.updatedAt:null
 };
}

function fallbackConditions(row){
 const out=[];
 const values=row?.factorValues&&typeof row.factorValues==='object'?row.factorValues:{};
 const keys=Object.keys(values).slice(0,3);
 for(const key of keys){
  const v=values[key];
  out.push(shapeCondition({id:key,label:key,value:v,threshold:70,operator:'>=',source:'candidate.factorValues',reason:finite(v)&&v>=70?'满足':'未满足'}));
 }
 if(finite(row?.score))out.unshift(shapeCondition({id:'score',label:'候选评分',value:row.score,threshold:0,operator:'>=',source:'candidate.score',reason:'候选评分展示'}));
 return out.filter(Boolean);
}

function pushItemsForView(){
 const src=Array.isArray(model?.pushes?.items)?model.pushes.items:[];
 let items=src.filter(x=>x&&codeRe.test(String(x.code||''))).map(x=>({
  id:String(x.id||`${x.code}-${x.triggerAt||x.quoteAt||''}`),
  code:String(x.code),
  name:String(x.name||x.code),
  sector:String(x.sector||''),
  price:finite(x.price)?x.price:null,
  pct:finite(x.pct)?x.pct:null,
  triggerStrategy:String(x.triggerStrategy||'未标注策略'),
  triggerAt:finite(x.triggerAt)?x.triggerAt:null,
  pushAt:finite(x.pushAt)?x.pushAt:null,
  quoteAt:finite(x.quoteAt)?x.quoteAt:null,
  quoteSource:String(x.quoteSource||''),
  stage:String(x.stage||'triggered'),
  stageLabel:String(x.stageLabel||stageMap[x.stage]||'待核验'),
  stageReason:String(x.stageReason||''),
  pushStatus:String(x.pushStatus||''),
  pushChannel:String(x.pushChannel||''),
  pushNote:String(x.pushNote||''),
  focused:x.focused===true,
  conditions:(Array.isArray(x.conditions)?x.conditions:[]).map(shapeCondition).filter(Boolean),
  conditionsSummary:x.conditionsSummary&&typeof x.conditionsSummary==='object'?x.conditionsSummary:null,
  playbookAnalysis:x.playbookAnalysis&&typeof x.playbookAnalysis==='object'?x.playbookAnalysis:null,
  factorValues:x.factorValues&&typeof x.factorValues==='object'?x.factorValues:{},
  factorEvidence:x.factorEvidence&&typeof x.factorEvidence==='object'?x.factorEvidence:{},
  scope:String(x.scope||'all')
 }));
 if(!items.length){
  items=(model?.rows||[]).slice(0,20).map(row=>({
   id:'fallback-'+row.code,code:row.code,name:row.name||row.code,sector:String(row.sector||''),price:finite(row.price)?row.price:null,pct:finite(row.pct)?row.pct:null,
   triggerStrategy:'候选观察',triggerAt:null,pushAt:null,quoteAt:finite(row.quoteAt)?row.quoteAt:null,quoteSource:String(row.quoteSource||''),stage:'candidate',stageLabel:'候选股票',
   stageReason:'当前无系统推送记录，展示候选池联动入口',pushStatus:'',pushChannel:'',pushNote:'',focused:row.focused===true,
   conditions:fallbackConditions(row),conditionsSummary:null,playbookAnalysis:row.playbookAnalysis||null,factorValues:row.factorValues||{},factorEvidence:row.factorEvidence||{},scope:'all'
  }));
 }
 items=items.filter(x=>rowInIndex({code:x.code},indexScope)&&(!sectorScope||x.sector===sectorScope));
 if(pushTab==='pushed')items=items.filter(x=>x.stage!=='candidate');
 else if(pushTab==='candidate')items=items.filter(x=>x.stage==='candidate');
 else if(pushTab==='watch')items=items.filter(x=>x.focused===true);
 if(pushStage!=='all')items=items.filter(x=>x.stage===pushStage);
 items.sort((a,b)=>{
  const ao=['pending','triggered','sent','failed','expired','candidate'].indexOf(a.stage);
  const bo=['pending','triggered','sent','failed','expired','candidate'].indexOf(b.stage);
  return (ao-bo)||((b.triggerAt||0)-(a.triggerAt||0))||((b.quoteAt||0)-(a.quoteAt||0));
 });
 return items.slice(0,30);
}

function normalizePushOpen(){
 const opened=[...pushUi.open].filter(key=>!pushUi.pinned.has(key));
 if(opened.length<=2)return;
 for(const key of opened.slice(0,opened.length-2))pushUi.open.delete(key);
}

function renderSectorChips(){
 const node=el('vx-sector-chips');
 if(!node)return;
 const sectors=(model?.sectors||[]).filter(x=>x&&x.name).slice(0,12);
 node.innerHTML='<button type="button" data-vx-sector="" aria-pressed="'+String(!sectorScope)+'">全部板块</button>'+
  sectors.map(x=>`<button type="button" data-vx-sector="${esc(x.name)}" aria-pressed="${String(sectorScope===x.name)}">${esc(x.name)}${finite(x.pct)?` <small>${x.pct>0?'+':''}${x.pct.toFixed(1)}%</small>`:''}</button>`).join('');
}

function renderPushes(){
 const listNode=el('vx-push-list');
 if(!listNode)return;
 pushUi.scrollTop=listNode.scrollTop||0;
 normalizePushOpen();
 const items=pushItemsForView();
 const stat={candidate:0,triggered:0,pending:0,sent:0,failed:0,expired:0};
 for(const item of items){if(Object.prototype.hasOwnProperty.call(stat,item.stage))stat[item.stage]++;}
 const summary=el('vx-push-summary');
 const asOf=model?.pushes?.asOf;
 const source=model?.pushes?.source||'state.signals';
 if(summary){
  summary.textContent=items.length?`当前展示 ${items.length} 条 · 候选${stat.candidate} / 触发${stat.triggered} / 待发${stat.pending} / 已发${stat.sent} / 失败${stat.failed} / 失效${stat.expired} · 数据源 ${source} ${finite(asOf)?new Date(asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''}`:(model?.pushes?.emptyReason||'暂无系统推送股票记录');
 }
 const context=el('vx-push-context');
 if(context)context.textContent=`当前对象：${indexScope==='all'?'全部指数':(el('vx-index-scope')?.selectedOptions?.[0]?.textContent||'指数')} · ${sectorScope||'全部板块'}${selected?` · ${selected}`:''}`;
 const modeInfo=research.mode==='draft'&&research.factor?`研究预演：${research.factor} ≥ ${research.threshold}`:'生产配置';
 const lastDelivery=model?.pushes?.channels?.lastDispatch;
 const deliveryTxt=lastDelivery&&finite(lastDelivery.t)?`${lastDelivery.sent?'最近发送成功':'最近发送未确认'} · ${new Date(lastDelivery.t).toLocaleTimeString('zh-CN')}`:'最近发送状态待核验';
 const topLine=document.createElement('div');
 topLine.className='vx-push-headline';
 topLine.textContent=modeInfo+' · '+deliveryTxt;
 listNode.innerHTML='';
 listNode.append(topLine);
 if(!items.length){
  const empty=document.createElement('div');
  empty.className='vx-empty';
  empty.innerHTML='<span>◈</span><strong>暂无系统推送股票</strong><p>请先筛选指数/板块，或等待信号触发。</p>';
  listNode.append(empty);
  return;
 }
 const wrap=document.createElement('div');
 wrap.className='vx-push-items';
 wrap.innerHTML=items.map(item=>{
  const key=item.id;
  const open=pushUi.open.has(key)?' open':'';
  const pinned=pushUi.pinned.has(key);
  const stageClass='vx-stage-'+esc(item.stage);
  const cond=item.conditions.length?item.conditions:[];
  const met=cond.filter(c=>c.satisfied===true).length;
  const total=cond.filter(c=>c.satisfied!==null).length;
  const ratio=total?`${met}/${total}`:'—';
  const triggerAt=item.triggerAt?new Date(item.triggerAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
  const pushAt=item.pushAt?new Date(item.pushAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
  return `<details class="vx-push-item ${stageClass}" data-vx-push-key="${esc(key)}"${open}><summary><b>${esc(item.name)}<small>${esc(item.code)} · ${esc(item.sector||'板块未知')}</small></b><span class="vx-stage">${esc(item.stageLabel)}</span><strong class="${item.pct<0?'vx-down':'vx-up'}">${format(item.price)} ${finite(item.pct)?(item.pct>0?'+':'')+item.pct.toFixed(2)+'%':'—'}</strong></summary><div class="vx-push-meta"><p>触发策略：${esc(item.triggerStrategy)} · 条件满足 ${ratio}</p><p>触发时间：${esc(triggerAt)} · 推送时间：${esc(pushAt)}</p><p>状态：${esc(item.stageReason||'待核验')} ${item.pushStatus?`· ${esc(item.pushStatus)}`:''}${item.pushNote?` · ${esc(item.pushNote)}`:''}</p><div class="vx-push-actions"><button type="button" data-vx-code="${esc(item.code)}">查看行情</button><button type="button" data-vx-evidence="${esc(key)}">查看依据</button><a href="/#v6-stock" aria-label="打开自选股票页">加入自选</a><button type="button" data-vx-pin="${esc(key)}">${pinned?'取消固定':'固定对比'}</button></div></div></details>`;
 }).join('');
 listNode.append(wrap);
 listNode.scrollTop=pushUi.scrollTop;
}

function conditionTitle(c){
 if(c.satisfied===true)return '✅ '+c.label;
 if(c.satisfied===false)return '❌ '+c.label;
 return '— '+c.label;
}
function renderConditionsFor(code,forcedKey=''){
 const summary=el('vx-condition-summary');
 const list=el('vx-condition-list');
 const detail=el('vx-condition-detail');
 if(!summary||!list||!detail)return;
 const row=(model?.rows||[]).find(x=>x.code===code)||null;
 const source=pushItemsForView().find(x=>x.code===code)||null;
 const conditions=(source&&source.conditions.length?source.conditions:fallbackConditions(row)).map(shapeCondition).filter(Boolean);
 summary.textContent=source&&source.conditionsSummary&&source.conditionsSummary.label?`当前对象 ${code} · ${source.conditionsSummary.label}`:`当前对象 ${code||'未选择'} · 条件待核验`;
 if(!conditions.length){
  list.innerHTML='';
  detail.textContent='未收录可解释的策略条件。';
  return;
 }
 conditionCache.clear();
 list.innerHTML=conditions.map(c=>{
  const key=`${code}:${c.id}`;
  conditionCache.set(key,c);
  return `<button type="button" data-vx-condition-key="${esc(key)}">${esc(conditionTitle(c))}</button>`;
 }).join('');
 const first=forcedKey&&conditionCache.has(forcedKey)?forcedKey:[...conditionCache.keys()][0];
 const active=conditionCache.get(first);
 if(active){
  detail.innerHTML=`<p><b>${esc(active.label)}</b> · ${active.operator} ${active.threshold===null?'—':active.threshold}</p><p>实际值：${active.value===null?'缺失':active.value} · 判定：${active.satisfied===true?'满足':active.satisfied===false?'未满足':'无法判定'}</p><p>来源：${esc(active.source||'来源未知')} · 更新时间：${active.updatedAt?new Date(active.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未知'}</p><p>${esc(active.reason||'缺少说明')}</p>`;
 }
}

function factorCatalog(){
 const src=Array.isArray(model?.factorCatalog)?model.factorCatalog:[];
 return src.filter(x=>x&&x.field).map(x=>({field:String(x.field),label:String(x.label||x.field)}));
}

function saveResearchState(){
 writeStore('vx-research-draft-current',{mode:research.mode,factor:research.factor,threshold:research.threshold});
 writeStore('vx-research-draft-history',research.history.slice(0,20));
}

function renderResearchPanel(){
 const modeNode=el('vx-research-mode');
 const factorNode=el('vx-factor-select');
 const thresholdNode=el('vx-factor-threshold');
 const thresholdLabel=el('vx-factor-threshold-value');
 const note=el('vx-draft-note');
 const historyNode=el('vx-draft-history');
 if(!modeNode||!factorNode||!thresholdNode||!thresholdLabel||!note||!historyNode)return;
 modeNode.value=research.mode;
 const catalog=factorCatalog();
 if(!research.factor&&catalog.length)research.factor=catalog[0].field;
 factorNode.innerHTML=catalog.length?catalog.map(x=>`<option value="${esc(x.field)}"${x.field===research.factor?' selected':''}>${esc(x.label)} (${esc(x.field)})</option>`).join(''):'<option value="">暂无可用因子</option>';
 thresholdNode.value=String(research.threshold);
 thresholdLabel.textContent=String(research.threshold);
 const before=displayRows(false).length;
 const after=displayRows(true).length;
 note.textContent=research.mode==='draft'&&research.factor?`研究预演已启用：${research.factor} ≥ ${research.threshold}，候选数量 ${before} → ${after}。此变更仅影响页面研究展示，不影响生产推送。`:'未启用研究预演。';
 historyNode.innerHTML=research.history.length?'<details><summary>已保存配置（可追溯）</summary>'+research.history.slice(0,8).map(x=>`<p>${esc(new Date(x.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · ${esc(x.factor)} ≥ ${x.threshold} · ${esc(x.scope||'全部范围')}</p>`).join('')+'</details>':'';
}

function plot(rows){
 const valid=rows.filter(r=>r&&['open','high','low','close'].every(k=>finite(r[k]))&&r.high>=r.low);
 if(!valid.length)throw Error('K线字段不完整');
 const bars=valid.slice(-60),w=580,h=240,left=10,right=45,top=10,bottom=180,step=(w-left-right)/bars.length,low=Math.min(...bars.map(b=>b.low)),high=Math.max(...bars.map(b=>b.high)),range=high-low||1,y=v=>bottom-(v-low)/range*(bottom-top);
 const maxVol=Math.max(1,...bars.map(b=>finite(b.volume)?b.volume:0));
 let svg='';
 for(let i=0;i<5;i++){
  const v=low+range*i/4,yy=y(v);
  svg+=`<path d="M${left} ${yy}H${w-right}" stroke="#19334d"/><text x="${w-right+6}" y="${yy+4}" fill="#8da6c1" font-size="10">${v.toFixed(2)}</text>`;
 }
 bars.forEach((b,i)=>{
  const x=left+step*(i+.5),color=b.close>=b.open?'#ff5369':'#21d99d';
  svg+=`<path d="M${x} ${y(b.high)}V${y(b.low)}" stroke="${color}"/><rect x="${x-step*.3}" y="${Math.min(y(b.open),y(b.close))}" width="${Math.max(1,step*.6)}" height="${Math.max(1,Math.abs(y(b.open)-y(b.close)))}" fill="${color}"/>`;
  if(finite(b.volume))svg+=`<rect x="${x-step*.3}" y="${220-b.volume/maxVol*28}" width="${Math.max(1,step*.6)}" height="${b.volume/maxVol*28}" fill="${color}" opacity=".8"/>`;
  if(i===0||i===bars.length-1||i===Math.floor(bars.length/2))svg+=`<text x="${Math.min(w-right-40,Math.max(10,x-16))}" y="237" fill="#8da6c1" font-size="10">${esc(String(b.date||'').slice(-5))}</text>`;
 });
 [5,10,20].forEach((period,j)=>{
  const points=[];
  for(let i=0;i<bars.length;i++){
   const originalIndex=valid.length-bars.length+i;
   if(originalIndex+1<period)continue;
   const avg=valid.slice(originalIndex-period+1,originalIndex+1).reduce((s,b)=>s+b.close,0)/period;
   points.push(`${left+step*(i+.5)},${y(avg)}`);
  }
  svg+=`<polyline points="${points.join(' ')}" fill="none" stroke="${['#f5cb63','#54e5e0','#d591f5'][j]}" stroke-width="1.6"/>`;
 });
 return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="实际行情K线、移动均线和成交量">${svg}</svg>`;
}

function renderIssuer(row,positivePatterns=0){
 const output=el('vx-issuer-evidence');
 if(!output)return;
 if(!row){output.textContent='未选择股票或缺少可用公告证据';return;}
 const events=Array.isArray(row.issuerEvidence?.events)?row.issuerEvidence.events:[];
 const riskCount=Number(row.issuerEvidence?.riskClues?.length||0)+Number(row.issuerEvidence?.conflicts?.length||0);
 const goodCount=Number(row.issuerEvidence?.strengthClues?.length||0);
 if(!events.length){output.textContent='暂无可核实的公告原文链接；不代表这家公司没有风险或没有公告。';return;}
 const urlCheck=/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i;
 output.innerHTML='<p>风险线索 '+riskCount+' 项 · 经营优势线索 '+goodCount+' 项 · 均未经公告正文核实</p>'+
 (riskCount&&positivePatterns?'<p class="vx-down">技术看涨形态与公告风险线索并存，先核查原文。</p>':'')+
 '<ul>'+events.slice(0,12).map(d=>{
  const url=typeof d.url==='string'&&urlCheck.test(d.url)?d.url:null;
  const title=esc(d.title||'无标题');
  const type=d.category==='risk-clue'?'风险线索':d.category==='strength-clue'?'优势线索':'中性/冲突待核查';
  return '<li><b>'+esc(type)+'</b> · '+esc(d.publishedAt||'时间未知')+' · '+
   (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+title+'</a>':title)+
   ' · '+esc(d.reason||'只核对了标题，未读取正文')+'</li>';
 }).join('')+'</ul><small>标题不是已证实的经营优势、利空程度或交易依据；不保证公告源实时接通。</small>';
}

function token(){try{return (typeof getRelToken==='function'?getRelToken():typeof getToken==='function'?getToken():'')||'';}catch{return '';}}

async function select(code){
 const row=(model?.rows||[]).find(r=>r.code===code);
 if(!row||!codeRe.test(code))return;
 selected=code;
 const provider=el('vx-provider-links');
 if(provider)provider.innerHTML=typeof V6StockProviders==='object'?V6StockProviders.render(code):'外部行情入口未加载';
 const ticket=++epoch;
 controller?.abort();
 controller=new AbortController();
 renderRows();
 renderPushes();
 const selectedNode=el('vx-selected');
 if(selectedNode)selectedNode.textContent=code+' '+row.name;
 selectedQuote(row);
 renderIssuer(row);
 renderConditionsFor(code);
 if(el('vx-chart'))el('vx-chart').textContent='正在读取K线…';
 if(el('vx-pattern-preview'))el('vx-pattern-preview').textContent='正在核对历史日K形态，尚无结论';
 const evidence=[row.probabilityLabel||'概率尚未验证',...(row.news||[]).map(n=>n.direction+'：'+n.title+' · '+(n.reason||'缺少判定依据')+' · '+(n.source||'来源未知')+' · '+n.publishedAt+'（未核验）'),...row.signals,...(row.explanation||[]),...(row.bazi?[`八字口诀：${row.bazi.verdict||'结论暂缺'}${row.bazi.line?' · '+row.bazi.line:''}`]:[]),row.bad?'风险：命中现有利空提示':'风险：未完成独立核验'];
 if(el('vx-explanation'))el('vx-explanation').innerHTML=evidence.map(t=>`<p><span>◇</span>${esc(t)}</p>`).join('');
 try{
  const r=await fetch('/api/kline?code='+code+'&n=120',{headers:{Authorization:'Bearer '+token()},signal:controller.signal,cache:'no-store'});
  const d=await r.json();
  if(ticket!==epoch)return;
  if(!r.ok||!d.ok)throw Error(d.error||d.msg||'暂无可用K线');
  if(el('vx-chart'))el('vx-chart').innerHTML=plot(Array.isArray(d.rows)?d.rows:[]);
  if(el('vx-chart-source'))el('vx-chart-source').textContent='日K截至 '+(d.asOf||'未知')+' · 来源为现有行情接口';
  const preview=typeof V6PatternPreview==='object'?V6PatternPreview.evaluate(Array.isArray(d.rows)?d.rows:[]):null;
  if(el('vx-pattern-preview'))el('vx-pattern-preview').innerHTML=preview?V6PatternPreview.render(preview,{asOf:d.asOf,source:d.source||d.provider}):'形态研究组件尚未加载；请刷新页面。';
  renderIssuer(row,preview?.usable?preview.positive.length:0);
 }catch(e){
  if(ticket===epoch&&e.name!=='AbortError'){
   if(el('vx-chart'))el('vx-chart').textContent='K线暂不可用：'+e.message;
   if(el('vx-chart-source'))el('vx-chart-source').textContent='未生成替代行情';
   if(el('vx-pattern-preview'))el('vx-pattern-preview').textContent='K线接口不可用：未形成形态结论';
  }
 }
}

function render(data){
 model=data&&typeof data==='object'?data:null;
 const risk=model?.riskEvidence;
 const fresh=risk&&finite(risk.validUntil)&&risk.validUntil>=Date.now()&&finite(risk.generatedAt)&&risk.generatedAt<=Date.now();
 if(el('vx-risk-status'))el('vx-risk-status').textContent='今日观望';
 if(el('vx-risk-reasons'))el('vx-risk-reasons').textContent=fresh?(risk.reasons||[]).join('；'):'连接或数据失效，等待有效证据';
 if(el('vx-risk-evidence')){
  el('vx-risk-evidence').innerHTML=fresh?'<p>'+esc(risk.positionAction)+' · '+esc(risk.probabilityLabel)+'</p><p>'+esc(risk.source)+' · '+esc(risk.tradeDate)+' · '+new Date(risk.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'</p><p>'+esc(risk.sectorAdvice)+'</p>'+(risk.sectors||[]).slice(0,8).map(x=>'<p>'+esc(x.name)+' · 主力净额 '+(finite(x.netInflowYuan)?format(x.netInflowYuan/1e8)+'亿元':'未知')+' · '+esc(x.status)+'</p>').join('')+'<p>'+esc(risk.newsStatus)+'</p>'+(risk.news||[]).slice(0,6).map(x=>'<p>'+esc(x.direction)+' · '+esc(x.title)+' · '+esc(x.publishedAt)+' · '+esc(x.source||'来源未知')+'<br>'+esc(x.reason||'缺少判断依据')+'</p>').join(''):'未生成替代数据';
 }
 if(fresh&&risk.optionalSources&&el('vx-risk-evidence'))el('vx-risk-evidence').innerHTML+='<p>研究采集：'+esc(risk.optionalStatus)+'</p>'+risk.optionalSources.map(x=>'<p>'+esc(x.provider)+' · '+esc(x.status)+' · 上游 '+esc(x.upstream)+(finite(x.barsCount)?' · 历史K线 '+x.barsCount+'条':'')+(x.flow?' · '+esc(x.flow.date)+' 主力净额 '+format(x.flow.netNative)+'（'+esc(x.flow.unit)+'）':'')+'</p>').join('');
 if(fresh&&risk.optionalCatalog&&el('vx-risk-evidence'))el('vx-risk-evidence').innerHTML+='<details><summary>全部数据源接入清单（登记不等于接通）</summary>'+risk.optionalCatalog.map(x=>'<p>'+esc(x.id)+' · '+esc(x.access)+' · '+esc(x.adapter)+'</p>').join('')+'</details>';
 const parallel=model?.parallelMarket;if(fresh&&parallel&&el('vx-risk-evidence'))el('vx-risk-evidence').innerHTML+='<p>三路行情：'+esc(parallel.status)+'</p>'+(parallel.sources||[]).map(s=>'<p>'+esc(s.id)+' · '+esc(s.status)+'</p>').join('')+(parallel.analysis||[]).slice(0,8).map(a=>'<p>'+esc(a.symbol)+' · '+esc(a.status)+' · '+esc(a.analysis)+'</p>').join('');
 const probe=model?.publicQuoteProbe;if(probe&&/^(?:60|68|00|30)\d{4}$/.test(probe.code)&&el('vx-risk-evidence'))el('vx-risk-evidence').innerHTML+='<details><summary>公开行情快照 · '+esc(probe.code)+'</summary><p>检查时间 '+(finite(probe.checkedAt)?new Date(probe.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未知')+' · '+esc(probe.status)+' · 非交易依据</p>'+(probe.sources||[]).map(s=>{const q=s.quote,at=q?.quoteAt;return '<p>'+esc(s.id)+' · '+(q&&finite(at)&&at<=Date.now()?format(q.price)+' 元 · '+new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' · 报价快照（非实时认证）':'无可用报价')+'</p>';}).join('')+(typeof V6StockProviders==='object'?V6StockProviders.render(probe.code):'')+'</details>';
 const bank=model?.sixPhotoBackups;if(bank&&bank.status!=='unconfigured'&&el('vx-risk-evidence'))el('vx-risk-evidence').innerHTML+='<details><summary>六图备用数据 · '+esc(bank.status)+' · '+format(bank.availableCount,0)+'路有数据</summary>'+(bank.sources||[]).map(s=>'<p>'+esc(s.photo)+' · '+esc(s.id)+' · '+esc(s.status)+' · '+(s.retainedRows||0)+'条</p>').join('')+'</details>';

 const stamp=model?.observedAt;
 if(el('vx-time'))el('vx-time').textContent=stamp?new Date(stamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' · 列表接收':'等待行情快照';
 if(el('vx-source'))el('vx-source').textContent=model?.source||'请登录后读取数据';
 if(stamp&&Date.now()-stamp>180000&&el('vx-source'))el('vx-source').textContent+=' · 非实时 / 可能过期';

 const names=[['1.000001','上证指数'],['0.399001','深证成指'],['0.399006','创业板指'],['1.000688','科创50']];
 if(el('vx-indices'))el('vx-indices').innerHTML=names.map(([code,name])=>{
  const q=model?.indices?.find(x=>x.code===code)||{};
  const active=indexScope===code?' vx-index-active':'';
  return `<article class="vx-panel vx-index ${q.pct<0?'vx-down':'vx-up'}${active}"><button type="button" class="vx-index-hit" data-vx-index="${code}" aria-label="切换${name}范围"><h2>${name}</h2><div><strong>${format(q.price)}</strong><b>${finite(q.pct)?(q.pct>0?'+':'')+q.pct.toFixed(2)+'%':'—'}</b></div>${indexSpark(code,q.price,model?.indexObservedAt)}</button></article>`;
 }).join('');
 if(el('vx-counts'))el('vx-counts').innerHTML=[['candidates','候选池','blue'],['focused','重点关注','red'],['signals','现有信号','gold'],['risk','风险提示','green']].map(([key,label,color])=>`<div class="vx-metric ${color}"><span>${label}</span><strong>${format(model?.counts?.[key],0)}<small>${key==='signals'?'条':'只'}</small></strong></div>`).join('');
 if(el('vx-strategies'))el('vx-strategies').innerHTML=(model?.strategies||[{label:'十四条选股'},{label:'八字口诀'},{label:'GPT 五策略'},{label:'Python 三轮'}]).map((x,i)=>`<div class="vx-strategy-row"><span>${esc(x.label)}</span><i><b style="width:${finite(x.count)?Math.min(100,x.count/Math.max(1,model?.counts?.candidates||x.count)*100):0}%;--vx-bar:${['#64c9ff','#57e7b3','#ffb77c','#bf94ff'][i]}"></b></i><strong title="${esc(x.note||'暂无证据')}">${format(x.count,0)}</strong></div>`).join('');
 const ratio=model?.mood?.upRatio;
 if(el('vx-ratio'))el('vx-ratio').textContent=finite(ratio)?ratio+'%':'—';
 if(el('vx-gauge-path'))el('vx-gauge-path').setAttribute('stroke-dasharray',`${finite(ratio)?ratio:0} 100`);
 if(el('vx-mood-label'))el('vx-mood-label').textContent=model?.mood?.label||'待评估';
 if(el('vx-mood-note'))el('vx-mood-note').textContent=model?.mood?.note||'等待有效的行情证据';
 if(el('vx-mood-scope'))el('vx-mood-scope').textContent=model?.mood?.scope?.method?`上涨家数占比 · ${model.mood.scope.method}`:'上涨家数占比';
 if(el('vx-risk'))el('vx-risk').textContent=format(model?.counts?.risk,0)+' 只';
 if(el('vx-risk-detail'))el('vx-risk-detail').textContent=format(model?.counts?.risk,0)+' 只';
 const visibleRows=renderRows();
 renderSectorChips();
 renderPushes();
 renderResearchPanel();
 if(model&&selected){
  const active=(model.rows||[]).find(r=>r.code===selected);
  selectedQuote(active);
  renderIssuer(active);
  renderConditionsFor(selected);
 }else if(!model){
  selected=null;
  epoch++;
  controller?.abort();
  observedSeries.clear();
  if(el('vx-provider-links'))el('vx-provider-links').textContent='';
  if(el('vx-selected'))el('vx-selected').textContent='选择一只股票';
  if(el('vx-selected-price'))el('vx-selected-price').textContent='—';
  if(el('vx-chart'))el('vx-chart').textContent='请登录后查看行情';
  if(el('vx-explanation'))el('vx-explanation').textContent='尚无策略证据';
  if(el('vx-issuer-evidence'))el('vx-issuer-evidence').textContent='访问已失效：公告信息已清除';
  if(el('vx-pattern-preview'))el('vx-pattern-preview').textContent='访问已失效：已清除历史形态预览';
  if(el('vx-condition-summary'))el('vx-condition-summary').textContent='请选择系统推送股票或候选股票查看条件满足情况。';
  if(el('vx-condition-list'))el('vx-condition-list').textContent='';
  if(el('vx-condition-detail'))el('vx-condition-detail').textContent='待选择条件';
 }else if(!selected&&visibleRows.length)select(visibleRows[0].code);
 const role=document.getElementById('roleState');
 if(el('vx-role'))el('vx-role').textContent=role?.textContent?.trim()&&role.textContent.trim()!=='—'?role.textContent.trim():'身份管理';
}

document.addEventListener('click',e=>{
 const tab=e.target.closest('[data-vx-filter]');
 if(tab){
  filter=tab.dataset.vxFilter;
  renderRows();
  if(selected&&!displayRows(true).some(r=>r.code===selected)){
   const first=displayRows(true)[0];
   if(first)select(first.code);
  }
  renderPushes();
  return;
 }
 const row=e.target.closest('[data-vx-code]');
 if(row){select(row.dataset.vxCode);return;}
 const idx=e.target.closest('[data-vx-index]');
 if(idx){
  indexScope=idx.dataset.vxIndex||'all';
  if(el('vx-index-scope'))el('vx-index-scope').value=indexScope;
  renderRows();
  renderPushes();
  const available=displayRows(true);
  if(available.length&&(!selected||!available.some(r=>r.code===selected)))select(available[0].code);
  return;
 }
 const sec=e.target.closest('[data-vx-sector]');
 if(sec){
  sectorScope=sec.dataset.vxSector||'';
  renderSectorChips();
  renderRows();
  renderPushes();
  const available=displayRows(true);
  if(available.length&&(!selected||!available.some(r=>r.code===selected)))select(available[0].code);
  return;
 }
 const ptab=e.target.closest('[data-vx-push-tab]');
 if(ptab){
  pushTab=ptab.dataset.vxPushTab||'pushed';
  document.querySelectorAll('[data-vx-push-tab]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.vxPushTab===pushTab)));
  renderPushes();
  return;
 }
 const evidence=e.target.closest('[data-vx-evidence]');
 if(evidence){
  const key=evidence.dataset.vxEvidence;
  const box=evidence.closest('[data-vx-push-key]');
  if(box){pushUi.open.add(box.dataset.vxPushKey);normalizePushOpen();}
  const item=pushItemsForView().find(x=>x.id===key);
  if(item){
   selected=item.code;
   renderConditionsFor(item.code);
   renderPushes();
   select(item.code);
  }
  return;
 }
 const pin=e.target.closest('[data-vx-pin]');
 if(pin){
  const key=pin.dataset.vxPin;
  if(pushUi.pinned.has(key))pushUi.pinned.delete(key);else pushUi.pinned.add(key);
  pushUi.open.add(key);
  renderPushes();
  return;
 }
 const cond=e.target.closest('[data-vx-condition-key]');
 if(cond){
  renderConditionsFor(selected||'',cond.dataset.vxConditionKey||'');
 }
});

const tabsContainer=document.querySelector('.vx-tabs');
if(tabsContainer)tabsContainer.addEventListener('keydown',e=>{
 const tabs=[...document.querySelectorAll('.vx-tabs button')],index=tabs.indexOf(e.target);
 if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();
 const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 filter=tabs[next].dataset.vxFilter;
 renderRows();
 renderPushes();
 tabs[next].focus();
});

if(el('vx-sort'))el('vx-sort').addEventListener('change',()=>{renderRows();renderPushes();});
if(el('vx-chart-refresh'))el('vx-chart-refresh').addEventListener('click',()=>{if(selected)select(selected);});
if(el('vx-index-scope'))el('vx-index-scope').addEventListener('change',e=>{indexScope=e.target.value||'all';renderRows();renderPushes();});
if(el('vx-push-stage'))el('vx-push-stage').addEventListener('change',e=>{pushStage=e.target.value||'all';renderPushes();});

if(el('vx-research-mode'))el('vx-research-mode').addEventListener('change',e=>{
 research.mode=e.target.value==='draft'?'draft':'production';
 saveResearchState();
 renderRows();
 renderPushes();
 renderResearchPanel();
});
if(el('vx-factor-select'))el('vx-factor-select').addEventListener('change',e=>{
 research.factor=e.target.value||'';
 saveResearchState();
 renderResearchPanel();
});
if(el('vx-factor-threshold'))el('vx-factor-threshold').addEventListener('input',e=>{
 research.threshold=Math.max(0,Math.min(100,Math.round(Number(e.target.value)||0)));
 if(el('vx-factor-threshold-value'))el('vx-factor-threshold-value').textContent=String(research.threshold);
});
if(el('vx-draft-apply'))el('vx-draft-apply').addEventListener('click',()=>{
 research.undo.push({mode:research.mode,factor:research.factor,threshold:research.threshold});
 if(research.mode!=='draft')research.mode='draft';
 saveResearchState();
 renderRows();
 renderPushes();
 renderResearchPanel();
});
if(el('vx-draft-undo'))el('vx-draft-undo').addEventListener('click',()=>{
 const last=research.undo.pop();
 if(!last)return;
 research.mode=last.mode;
 research.factor=last.factor;
 research.threshold=last.threshold;
 saveResearchState();
 renderRows();
 renderPushes();
 renderResearchPanel();
});
if(el('vx-draft-reset'))el('vx-draft-reset').addEventListener('click',()=>{
 research.undo.push({mode:research.mode,factor:research.factor,threshold:research.threshold});
 research.mode='production';
 research.threshold=70;
 const catalog=factorCatalog();
 research.factor=catalog[0]?catalog[0].field:'';
 saveResearchState();
 renderRows();
 renderPushes();
 renderResearchPanel();
});
if(el('vx-draft-save'))el('vx-draft-save').addEventListener('click',()=>{
 const scopeText=(el('vx-index-scope')?.selectedOptions?.[0]?.textContent||'全部指数')+' / '+(sectorScope||'全部板块');
 research.history.unshift({at:Date.now(),factor:research.factor||'未选择',threshold:research.threshold,scope:scopeText});
 research.history=research.history.slice(0,20);
 saveResearchState();
 renderResearchPanel();
});

const identityBtn=document.querySelector('.vx-identity');
if(identityBtn)identityBtn.addEventListener('click',()=>{if(typeof identBtn==='function')identBtn();else location.href='/';});

addEventListener('v6-dashboard-data',e=>render(e.detail));
addEventListener('v6-dashboard-offline',()=>{
 if(el('vx-source'))el('vx-source').textContent='连接中断 · 显示上次快照，非实时';
 if(el('vx-risk-status'))el('vx-risk-status').textContent='今日观望';
 if(el('vx-risk-reasons'))el('vx-risk-reasons').textContent='连接中断，依据已失效';
 if(el('vx-risk-evidence'))el('vx-risk-evidence').textContent='请重连后查看有效快照';
 if(el('vx-pattern-preview'))el('vx-pattern-preview').textContent='连接中断：历史形态预览不再有效，请重新读取K线';
 if(el('vx-issuer-evidence'))el('vx-issuer-evidence').textContent='连接中断：公告证据需重新获取';
 if(el('vx-condition-summary'))el('vx-condition-summary').textContent='连接中断：策略条件需要重新拉取。';
 if(el('vx-condition-list'))el('vx-condition-list').textContent='';
 if(el('vx-condition-detail'))el('vx-condition-detail').textContent='连接中断：条件详情不可用。';
});

render(window.__v6Dashboard||null);
})();
