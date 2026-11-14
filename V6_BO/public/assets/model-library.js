'use strict';
// Public metadata only. No model endpoints, credentials, account or browser store.
(()=>{
 const $=id=>document.getElementById(id),MAX_SELECTED=3;
 const categories={language:'通用语言与推理',forecast:'行情与时序预测','finance-text':'金融文本',workflow:'研究流程',interface:'页面与交互',runtime:'运行与调度',evaluation:'验证与评测',data:'数据与证据'};
 const states={implemented:'设计已落实',candidate:'待条件实测','reference-only':'仅参考'};
 const publicContext=globalThis.V6PublicLibraryContext;
 let catalog=null,selected=new Set(),generation=0,controller,initialContextPending=true;
 const list=x=>Array.isArray(x)?x:[],string=x=>typeof x==='string'?x:'未知';
 function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
 function safeURL(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
 function link(label,raw){const url=safeURL(raw);if(!url)return node('span',label);const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function bullets(items){const ul=node('ul');for(const item of list(items))if(typeof item==='string')ul.append(node('li',item));return ul;}
 function pair(dl,label,value){dl.append(node('dt',label),node('dd',value));}
 function readable(items){return list(items).filter(x=>typeof x==='string').join('；')||'未知';}
 function metric(value,suffix=''){return typeof value==='number'&&Number.isFinite(value)?String(value)+suffix:'未测';}
 function validCatalog(value){
  if(value?.schemaVersion!==1||typeof value.reviewDate!=='string'||!Array.isArray(value.entries)||value.entries.length>256)throw Error('目录结构无效');
  const ids=new Set();for(const e of value.entries){if(!e||typeof e.id!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||e.name.length>240||!Object.hasOwn(categories,e.category)||!Object.hasOwn(states,e.adoption)||!Array.isArray(e.borrow)||!Array.isArray(e.reads))throw Error('目录条目无效');ids.add(e.id);}return value;
 }
 function selectedEntries(){return catalog?catalog.entries.filter(e=>selected.has(e.id)):[];}
 function replacePublicURL(url){
  // Reload must not resurrect a selection the user has explicitly cleared.
  try{if(location.pathname==='/model-library.html'&&location.pathname+location.search+location.hash!==url)history.replaceState(null,'',url);}catch{}
 }
 function syncPublicLink(){
  const share=$('libraryShare');if(!share)return;
  share.hidden=!catalog||!publicContext;
  if(share.hidden){share.removeAttribute('href');return;}
  const url=publicContext.canonicalURL({category:$('libraryCategory').value,adoption:$('libraryAdoption').value,ids:[...selected]},catalog.entries);
  share.href=url;replacePublicURL(url);
 }
 function clearCatalogContext(){
  catalog=null;selected.clear();$('libraryFilters').reset();$('libraryCategory').replaceChildren(new Option('全部类别',''));
  $('libraryCards').replaceChildren();$('libraryCount').textContent='';$('libraryEmpty').hidden=true;
  renderComparison();renderSummary(null);
 }
 function summarySelection(){
  const active=catalog&&!$('librarySearch').value.trim()&&!$('libraryCategory').value?($('libraryAdoption').value||'all'):null;
  for(const button of document.querySelectorAll('[data-library-summary]'))button.setAttribute('aria-pressed',String(button.dataset.librarySummary===active));
 }
 function renderSummary(value){
  for(const button of document.querySelectorAll('[data-library-summary]')){const adoption=button.dataset.librarySummary;
   button.disabled=!value;button.querySelector('[data-summary-count]').textContent=value?String(adoption==='all'?value.entries.length:value.entries.filter(e=>e.adoption===adoption).length):'—';
  }
  if(value)summarySelection();else for(const button of document.querySelectorAll('[data-library-summary]'))button.setAttribute('aria-pressed','false');
 }
 function renderComparison(){
  const entries=selectedEntries(),grid=$('compareGrid');grid.replaceChildren();$('compareCount').textContent=entries.length+' / '+MAX_SELECTED;
  syncPublicLink();
  $('libraryExport').disabled=!entries.length;$('libraryClear').disabled=!entries.length;
  const mixed=new Set(entries.map(e=>e.category)).size>1;$('compareNotice').className=mixed?'warning':'muted';
  $('compareNotice').textContent=mixed?'所选资料属于不同任务，只比较适用条件与做法；不合成总分或收益排名。':entries.length?'按相同字段查看；未测指标保持未测。':'选择资料后查看来源、许可、运行方式与借鉴内容。';
  for(const e of entries){const card=node('article',undefined,'compare-card');card.dataset.compareId=e.id;card.append(node('h3',e.name));const dl=node('dl');
   pair(dl,'类别 / 类型',(categories[e.category]||e.category)+' / '+string(e.kind));pair(dl,'采用状态',states[e.adoption]);pair(dl,'值得借鉴',readable(e.borrow));pair(dl,'运行方式',readable(e.runMode));pair(dl,'运行条件与实测范围',string(e.runtimeNotes));pair(dl,'已落实位置',list(e.implementation).map(i=>string(i.label)+' · '+string(i.path)).join('\n')||'未记录实现位置');pair(dl,'源码许可',string(e.license));pair(dl,'权重许可',string(e.weightsLicense));pair(dl,'限制与条件',string(e.limit));pair(dl,'固定版本',e.commit||'官方文档访问快照，无固定Git版本');pair(dl,'当前实际状态',string(e.status));pair(dl,'本系统准确率 / 时延',metric(e.v6MeasuredAccuracy)+' / '+metric(e.v6MeasuredLatencyMs,' ms'));card.append(dl);const remove=node('button','移除 '+e.name,'secondary');remove.type='button';remove.addEventListener('click',()=>{selected.delete(e.id);renderComparison();syncSelection();$('compareHeading').focus();});card.append(remove);grid.append(card);
  }
 }
 function syncSelection(){for(const input of $('libraryCards').querySelectorAll('input[data-select-id]'))input.checked=selected.has(input.dataset.selectId);}
 function setSelection(id,checked){if(checked&&selected.size>=MAX_SELECTED&&!selected.has(id)){$('libraryStatus').textContent='最多选择3项，请先移除一项。';syncSelection();return;}if(checked)selected.add(id);else selected.delete(id);renderComparison();syncSelection();$('libraryStatus').textContent='已选 '+selected.size+' 项；筛选不会清除选择。';}
 function renderCards(){
  if(!catalog)return;summarySelection();syncPublicLink();const q=$('librarySearch').value.trim().toLocaleLowerCase(),category=$('libraryCategory').value,adoption=$('libraryAdoption').value;
  const entries=catalog.entries.filter(e=>(!category||e.category===category)&&(!adoption||e.adoption===adoption)&&(!q||[e.id,e.name,e.kind,e.repository,e.license,e.weightsLicense,...list(e.borrow),e.limit,...list(e.runMode)].join(' ').toLocaleLowerCase().includes(q)));
  const cards=$('libraryCards');cards.replaceChildren();$('libraryEmpty').hidden=!!entries.length;$('libraryCount').textContent='显示 '+entries.length+' / '+catalog.entries.length+' 项 · 核对日期 '+catalog.reviewDate;
  for(const e of entries){const card=node('article',undefined,'catalog-card');card.dataset.entryId=e.id;const selection=node('label',undefined,'selection'),checkbox=node('input');checkbox.type='checkbox';checkbox.dataset.selectId=e.id;checkbox.checked=selected.has(e.id);checkbox.setAttribute('aria-label','选择 '+e.name+' 加入对照');checkbox.addEventListener('change',()=>setSelection(e.id,checkbox.checked));selection.append(checkbox,node('span','加入对照'));card.append(selection,node('span',categories[e.category],'tag'),node('span',states[e.adoption],'tag'),node('h3',e.name),node('p',string(e.kind),'muted'),bullets(e.borrow));
   const details=node('details'),summary=node('summary','来源、许可与运行条件');details.append(summary,node('p','源码许可：'+string(e.license)),node('p','权重许可：'+string(e.weightsLicense)),node('p','运行方式：'+readable(e.runMode)),node('p',string(e.runtimeNotes)),node('p','限制：'+string(e.limit)),node('p','实际采用：'+string(e.status)),node('p','固定版本：'+(e.commit||'官方文档访问快照，无固定Git版本')));
   if(e.repository)details.append(link(e.repository,'https://github.com/'+e.repository));
   for(const read of list(e.reads)){const row=node('div',undefined,'source-row');row.append(link(string(read.path),read.url));row.append(node('small','文件版本：'+(read.blobSha||'未记录独立文件哈希')));details.append(row);}
   for(const impl of list(e.implementation)){const path=typeof impl.path==='string'?impl.path:'';if(/^[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..'))details.append(link('实现：'+string(impl.label),'https://github.com/solviq87-cpu/v6-stock-system/blob/dev/'+path));}
   card.append(details);cards.append(card);
  }
 }
 async function loadCatalog(){
  const current=++generation;controller?.abort();controller=new AbortController();const requestController=controller,timer=setTimeout(()=>requestController.abort(),12000);clearCatalogContext();$('libraryStatus').textContent='正在读取公开目录…';$('libraryRetry').hidden=true;
  try{const response=await fetch('/assets/model-library-catalog.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});if(!response.ok)throw Error('读取失败');const text=await response.text();if(text.length>2*1024*1024)throw Error('目录过大');const value=validCatalog(JSON.parse(text));if(current!==generation)return;catalog=value;
   $('libraryCategory').replaceChildren(new Option('全部类别',''));for(const [key,label]of Object.entries(categories))if(value.entries.some(e=>e.category===key))$('libraryCategory').append(new Option(label,key));
   if(initialContextPending){initialContextPending=false;const context=publicContext?.parseContext(location.search,value.entries);
    if(context){selected=new Set(context.ids);if([...$('libraryCategory').options].some(o=>o.value===context.category))$('libraryCategory').value=context.category;$('libraryAdoption').value=context.adoption;}
   }
   renderCards();renderComparison();renderSummary(value);$('libraryStatus').textContent='已读取公开目录；浏览资料不会启动模型。';
  }catch{if(current!==generation)return;initialContextPending=false;clearCatalogContext();if(publicContext)replacePublicURL(publicContext.canonicalURL({},[]));$('libraryStatus').textContent='公开目录暂不可用，请稍后重试；原公开选择已清空。';$('libraryRetry').hidden=false;
  }finally{clearTimeout(timer);}
 }
 $('compareHeading').tabIndex=-1;$('libraryFilters').addEventListener('submit',e=>e.preventDefault());
 for(const id of ['librarySearch','libraryCategory','libraryAdoption'])$(id).addEventListener(id==='librarySearch'?'input':'change',renderCards);
 for(const button of document.querySelectorAll('[data-library-summary]'))button.addEventListener('click',()=>{if(!catalog)return;$('librarySearch').value='';$('libraryCategory').value='';$('libraryAdoption').value=button.dataset.librarySummary==='all'?'':button.dataset.librarySummary;renderCards();$('libraryStatus').textContent='已按总览卡片筛选；已选对照保留。';});
 $('libraryReset').addEventListener('click',()=>{$('libraryFilters').reset();renderCards();$('librarySearch').focus();});
 $('libraryClear').addEventListener('click',()=>{selected.clear();renderComparison();syncSelection();$('libraryStatus').textContent='已清除选择。';});
 $('libraryRetry').addEventListener('click',loadCatalog);
 $('libraryExport').addEventListener('click',()=>{const entries=selectedEntries();if(!entries.length)return;const payload={schemaVersion:1,reviewDate:catalog.reviewDate,mode:'public-source-comparison',entries,limits:['仅公开目录与设计对照，未据此运行模型或认证收益','不同任务不合成总分，未知指标保持未知']};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='v6-public-comparison-'+catalog.reviewDate+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 loadCatalog();
})();
