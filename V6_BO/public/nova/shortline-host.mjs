import { h, button, note } from './ui.js';
import { linkedPage,sampleFor } from './shortline/context.mjs';
import { activeBook,selectBook,bookHeaders,replaceArchive } from './shortline/book-session.mjs';
import { thsStockLink,thsBoardLink } from './shortline/quote-links.mjs';
import { archivedStockQuote } from './market-evidence.js';
import { rowsFrom,recoveryDisclosure } from './market.js';

const endpoint='/api/research/shortline';
const pages={
  overview:'短线研究总览',new:'自动战法校验',checks:'校验记录',library:'战法因子库',trades:'交易样本学习',
  backtest:'K线样本回测',review:'结构化复盘',mistakes:'交易纪律与错题',versions:'参数验证与审批',setup:'开始使用与账户',settings:'研究参数与黑名单',import:'数据导入向导',journal:'复盘日志与导出',structure:'题材梯队与高标',pressure:'公告压力与筹码',dictionary:'因子代号词典'
};
const writeRequired='当前为研究副本，请在主实例保存或同步。';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stockCode=v=>/^\d{6}$/.test(String(v||'')) ? String(v) : '';
function day(v){
  const s=String(v||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)))return '';
  return new Date(s).toISOString().slice(0,10)===s?s:'';
}
export function researchTarget(ctx,archive){
  const native=ctx.state||{};
  const pools=[
    [native.pool,native.snapshotFieldDays?.pool],
    [native.dashboard?.rows,native.snapshotFieldDays?.dashboard||native.dashboard?.snapshotDay],
    [native.trendPool,native.snapshotFieldDays?.trendPool]
  ].flatMap(([pool,sourceDay])=>rowsFrom(pool).map(row=>({...row,sourceDay})));
  const selected=stockCode(ctx.stock), chosen=selected?pools.find(r=>r.code===selected):pools[0];
  const code=selected||chosen?.code||stockCode(archive.checks?.at(-1)?.code)||stockCode(archive.bars?.find(b=>b.role==='stock')?.code);
  const codeDay=day(chosen?.tradeDate)||day(chosen?.quoteDate)||day(chosen?.poolDay);
  return {code,date:codeDay||day(chosen?.sourceDay)||(!chosen?day(native.snapshotDay):''),name:chosen?.name||''};
}
function storedOn(state,code,date) {
  const source=state.v6Observation;
  if(!source||source.code!==code)return false;
  if(date&&source.day!==date)return false;
  const age=Date.now()-Number(source.observedAtMs);
  return Number.isFinite(age)&&age>=0&&age<60_000;
}
// Store only request timestamps. Evidence, account records and authentication remain in V6.
const retryWindow=60_000;
export function createResearchSession(ctx,state,book=activeBook()){
  const inFlight=new Map(),recentLoads=new Map();
  function active(){
    if(ctx.signal?.aborted)throw new DOMException('已离开研究页面','AbortError');
    if(!ctx.canEdit)throw Error('当前设备需要研究编辑授权');
  }
  function accept(incoming){
    if(!Number.isSafeInteger(state.revision)||incoming.revision>=state.revision)replaceArchive(state,incoming);
  }
  async function refresh(){
    active();
    const data=await ctx.api(endpoint,{signal:ctx.signal,headers:bookHeaders(book)});
    active();
    accept(data.state);
    return state;
  }
  async function save(action,payload,attempt=0){
    active();
    if(!state.permissions?.canWrite)throw Error(writeRequired);
    try{
      const data=await ctx.api(endpoint,{method:'POST',signal:ctx.signal,headers:bookHeaders(book),body:{revision:state.revision,action,payload}});
      active();
      accept(data.state);
      if(data.maintenance?.length)ctx.notify?.('档案已保存。'+data.maintenance.join('、'));
      return data.result;
    }catch(error){
      if(error.status===409){await refresh();if(action==='v6:sync'&&attempt<2&&state.permissions?.canWrite)return save(action,payload,attempt+1);throw Error('另一台设备已更新档案，已重读最新版本，请重新核对后保存。');}
      throw error;
    }
  }
  async function loadEvidence(code,date,force=false){
    active();
    if(!stockCode(code)||date&&!day(date))throw Error('请输入六位股票代码与有效交易日');
    if(book==='demo')return {code,day:date,reused:true};
    const key=code+'/'+(date||'latest'),now=Date.now();
    if(inFlight.has(key))return inFlight.get(key);
    if(!force && (storedOn(state,code,date)||state.v6Observation?.code===code&&(!date||state.v6Observation.day===date)&&recentLoads.has(key)&&now-recentLoads.get(key)<retryWindow))return {code,day:date||state.v6Observation?.day,reused:true};
    if(!state.permissions?.canWrite)return {code,day:date,replica:true,reused:true};
    const request=save('v6:sync',{code,...(date?{day:date}:{})}).then(result=>{
      for(const [k,t] of recentLoads)if(now-t>=retryWindow)recentLoads.delete(k);
      recentLoads.set(key,Date.now());
      return result;
    }).finally(()=>inFlight.delete(key));
    inFlight.set(key,request);
    return request;
  }
  return {refresh,save,loadEvidence};
}
export async function stockCheckAt(ctx,code,row,signal){
  if(!ctx.canEdit||!stockCode(code)||signal.aborted)return null;
  // A public quote drawer is never hydrated from the synthetic workbook.
  if(activeBook()==='demo')return {code,date:day(row?.poolDay)||day(row?.tradeDate)||day(row?.quoteDate),demo:true};
  const state={},scoped=Object.create(ctx);
  Object.defineProperty(scoped,'signal',{value:signal});
  const api=createResearchSession(scoped,state);
  await api.refresh();
  const sourceDate=day(row?.poolDay)||day(row?.tradeDate)||day(row?.quoteDate);
  const result=await api.loadEvidence(code,sourceDate);
  if(signal.aborted)return null;
  const checkedDay=sourceDate||day(result?.day)||(state.v6Observation?.code===code?day(state.v6Observation.day):'');
  // A read-only replica can display its latest dated assessment for this stock.
  const records=(state.checks||[]).filter(c=>c.code===code&&(!checkedDay||c.date===checkedDay));
  const record=records.sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
  const previousRecord=record?null:(state.checks||[]).filter(c=>c.code===code&&day(c.date)&&c.date<checkedDay&&
    c.status&&c.createdAt&&Number.isFinite(Date.parse(c.createdAt))&&Date.parse(c.createdAt)<=Date.now())
    .sort((a,b)=>b.date.localeCompare(a.date)||Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
  const quote=archivedStockQuote(state.bars,code,checkedDay||undefined);
  return {code,date:checkedDay||record?.date||'',record,previousRecord,quote,recovery:state.marketRecovery,missing:result?.missing||[],replica:!!result?.replica};
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type:type||'text/plain;charset=utf-8'}));
  const a=h('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function modalFor(ctx,session,wrap){
  return (title,html,submit)=>{
    if(ctx.signal.aborted)return;
    if(submit&&!session.permissions?.canWrite){ctx.notify(writeRequired,'error');return;}
    wrap.querySelector('dialog')?.remove();
    const dialog=h('dialog',{class:'fy-shortline-modal','aria-label':title}),error=note('','error');
    const close=()=>dialog.close();
    const fields=h('div',{class:'fy-shortline-fields'});
    fields.innerHTML=html;
    const confirm=submit?h('button',{class:'fy-button primary',type:'submit'},'确认保存'):null;
    const form=h('form',{},h('header',{class:'fy-inline'},h('h2',{},title),button('关闭',close,'quiet')),fields,error,
      h('div',{class:'fy-inline'},submit?button('取消',close,'quiet'):null,confirm));
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(!submit||confirm.disabled)return;
      confirm.disabled=true;
      try{await submit(new FormData(form));if(dialog.open)dialog.close();}
      catch(e){if(!ctx.signal.aborted)error.textContent=e.message;}
      finally{confirm.disabled=false;}
    });
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    dialog.append(form);wrap.append(dialog);dialog.showModal();
  };
}
async function renderer(page){
  if(page==='setup')return (await import('./shortline/preflight.mjs')).renderPreflight;
  if(page==='dictionary')return (await import('./shortline/preflight.mjs')).renderDictionary;
  if(page==='settings')return (await import('./shortline/settings.mjs')).renderSettings;
  if(page==='import')return (await import('./shortline/import-wizard.mjs')).renderImport;
  if(page==='journal')return (await import('./shortline/journal.mjs')).renderJournal;
  if(page==='structure')return (await import('./shortline/structure.mjs')).renderStructure;
  if(page==='pressure')return (await import('./shortline/pressure.mjs')).renderPressure;
  if(page==='overview')return (await import('./shortline/overview.mjs')).renderOverview;
  if(['new','checks','library'].includes(page)){
    const {renderMarket}=await import('./shortline/market.mjs');
    return ui=>renderMarket(ui,page==='checks'?'check':page);
  }
  if(page==='backtest'){
    const {renderBacktest}=await import('./shortline/backtest.mjs');
    return renderBacktest;
  }
  if(['trades','versions'].includes(page)){
    const {renderLearning}=await import('./shortline/learning.mjs');
    return ui=>renderLearning(ui,page);
  }
  const {renderReview}=await import('./shortline/review.mjs');
  return ui=>renderReview(ui,page);
}
export async function renderShortline(route,ctx){
  const page=route.sub.replace(/^shortline-/,''),state={};
  if(!ctx.canEdit||!Object.hasOwn(pages,page))throw Error('该研究入口需要编辑权限');
  const book=activeBook(),session=createResearchSession(ctx,state,book);
  const [render]=await Promise.all([renderer(page),session.refresh()]);
  const wrap=h('section',{class:'fy-stack fy-shortline-space'}),body=h('div',{class:'fy-shortline-sheet'});
  const shadow=body.attachShadow({mode:'open'}),root=h('div',{class:'sheet-body'});
  if(page==='overview'){root.classList.add('shortline-overview');shadow.append(h('link',{rel:'stylesheet',href:'/nova/shortline/overview.css'}));}
  shadow.append(h('link',{rel:'stylesheet',href:'/nova/shortline-sheet.css'}),root);
  const target=stockCode(route.code)?{code:route.code,date:day(route.date)}:book==='demo'?{code:state.bars?.find(b=>b.role==='stock')?.code||'',date:state.market?.at(-1)?.date||''}:researchTarget(ctx,state);
  if(day(route.date))target.date=day(route.date);
  if(page==='overview'&&!day(route.date)&&day(state.marketRecovery?.referenceDay))target.date=state.marketRecovery.referenceDay;
  const syncStatus=note(''),statusText=(message)=>{if(!ctx.signal.aborted)syncStatus.textContent=message;};
  const recoveryBox=h('div',{},recoveryDisclosure(state));
  const updateRecovery=()=>{if(ctx.signal.aborted)return;const open=recoveryBox.firstChild?.open;const replacement=recoveryDisclosure(state);replacement.open=!!open;recoveryBox.replaceChildren(replacement);};
  const ui={state,root,stock:target.code,date:target.date,sampleFilter:sampleFor(book,route.sample),strategy:route.strategy||'',factor:route.factor||'',ref:route.ref||'',esc,download,
    setSample(value){ui.sampleFilter=sampleFor(book,value);},modal:modalFor(ctx,state,wrap),
    switchBook(id,page='overview'){selectBook(id);ctx.navigate('lab','shortline-'+page);},
    async readView(view){return (await ctx.api(endpoint,{signal:ctx.signal,headers:{...bookHeaders(book),'X-V6-Research-View':view}})).result;},
    async demo(){
      try{
        const archive={},practice=createResearchSession(ctx,archive,'demo');
        await practice.refresh();if(!archive.demoVersion)await practice.save('book:demo',{});
        ui.switchBook('demo','overview');
      }catch(e){if(!ctx.signal.aborted)ui.toast(e.message);}
    },
    async save(action,payload){const result=await session.save(action,payload);updateRecovery();return result;},
    open(page,options={}){
      if(Object.hasOwn(pages,page))ctx.navigate('lab',linkedPage(page,{code:ui.stock,date:ui.date,sample:ui.sampleFilter,...options}));
    },
    toast:(message)=>{if(!ctx.signal.aborted)ctx.notify(message);},
    async refresh(){await session.refresh();if(!ctx.signal.aborted){updateRecovery();render(ui);}},
    async loadEvidence(code,date,force=false){
      const result=await session.loadEvidence(code,date,force);
      if(!ctx.signal.aborted){
        updateRecovery();
        const retrieved=day(result?.day)||day(date);
        if(!ui.date&&retrieved)ui.date=retrieved;
        statusText([code,retrieved,result?.degraded?'行情源重试中，显示已归档证据':result?.replica?'只读副本':result?.reused?'使用已读取的档案':'已读取同期研究档案'].filter(Boolean).join(' · '));
      }
      return result;
    }};
  const codeField=h('input',{type:'text',inputmode:'numeric',maxlength:6,pattern:'[0-9]{6}',value:target.code,placeholder:'六位股票代码','aria-label':'同步行情代码'});
  const sync=button('重新同步行情',async()=>{
    if(!stockCode(codeField.value)){statusText('请输入六位股票代码');codeField.focus();return;}
    sync.disabled=true;
    try{await ui.loadEvidence(codeField.value,ui.date,true);ui.stock=codeField.value;if(!ctx.signal.aborted)render(ui);}
    catch(e){statusText(e.message);}
    finally{sync.disabled=!state.permissions?.canWrite;}
  },'quiet');
  sync.disabled=!state.permissions?.canWrite||book==='demo';
  const reload=button('刷新研究档案',async()=>{reload.disabled=true;try{await ui.refresh();statusText('已读取当前服务保存的研究档案');}catch(e){statusText(e.message);}finally{reload.disabled=false;}},'quiet');
  const select=h('select',{'aria-label':'当前研究账户'},(state.books||[]).map(b=>h('option',{value:b.id},b.name)));
  select.value=book;select.addEventListener('change',()=>ui.switchBook(select.value,page));
  const controls=h('div',{class:'fy-inline'},select,...(book==='demo'?[]:[codeField,sync]),reload,button('账户与初始化',()=>ui.open('setup'),'quiet'));
  wrap.append(h('header',{class:'fy-card fy-shortline-head'},h('div',{},h('h1',{},pages[page]),syncStatus),controls),recoveryBox,body);
  statusText(state.permissions?.canWrite?'已读取 V6 研究档案':'当前副本提供已保存档案的只读核查。');
  if(book==='demo'){
    recoveryBox.hidden=true;
    statusText('教学演示 · 此账户的记录和绩效独立保存');
  }
  if(page!=='setup'&&(!state.trades?.length||!state.bars?.length)){
    const guide=h('aside',{class:'fy-card fy-shortline-guide'},h('strong',{},'开始积累研究样本'),
      h('div',{class:'fy-inline'},!state.bars?.length?button('导入 K 线或同花顺数据',()=>ui.open('import'),'quiet'):null,
        !state.trades?.length?button('录入交易样本',()=>ui.open('trades'),'quiet'):null,
        state.permissions?.canWrite?button('载入独立演示库',()=>ui.demo(),'quiet'):null));
    wrap.insertBefore(guide,body);
  }
  root.addEventListener('click',e=>{
    if(e.target.closest?.('[data-enable-research-notify]'))import('./shortline/web-notices.mjs').then(m=>m.enableDevice(ui,ctx,book)).catch(err=>ui.toast(err.message));
  });
  if(target.code&&['new','structure','backtest','pressure','review','journal','trades'].includes(page)){
    const links=[['new','战法校验'],['structure','题材梯队'],['backtest','历史回测'],['pressure','公告与筹码'],['journal','交易与复盘日志']];
    const obs=state.v6Observation,stock=obs?.code===ui.stock&&obs.day===ui.date?obs.stock:null;
    const theme=stock?.theme&&{name:stock.theme,refs:stock.themeRefs,kind:/行业/.test(stock.themeBasis)?'industry':'theme'};
    const quotes=book==='demo'?[]:[thsStockLink(ui.stock),theme&&thsBoardLink(theme)].filter(Boolean);
    wrap.insertBefore(h('nav',{class:'fy-inline','aria-label':'同一标的联动'},h('strong',{},ui.stock),
      ...links.filter(([k])=>k!==page).map(([k,label])=>button(label,()=>ui.open(k),'quiet')),
      ...quotes.map(q=>h('a',{href:q.url,target:'_blank',rel:'noopener noreferrer'},q.label))),body);
  }
  if(!ui.date)ui.date=day(state.market?.at(-1)?.date)||'';
  if(!ctx.signal.aborted)render(ui);
  // Render the archive and cold-start actions first. A slow provider may finish
  // after the researcher has already started editing or moved to another page.
  if(book!=='demo'&&target.code&&['overview','new','checks','review','backtest','pressure','structure'].includes(page)&&!ctx.signal.aborted){
    let edited=false;
    for(const event of ['input','change','pointerdown','keydown'])wrap.addEventListener(event,()=>{edited=true;},{once:true,capture:true,signal:ctx.signal});
    void ui.loadEvidence(target.code,target.date).then(result=>{
      if(ctx.signal.aborted||result?.reused||result?.degraded||ui.stock!==target.code)return;
      if(!edited&&!wrap.querySelector('dialog[open]'))render(ui);
    },e=>{if(!ctx.signal.aborted)statusText('行情正在重试，可继续使用已有档案 · '+e.message);});
  }
  return wrap;
}
