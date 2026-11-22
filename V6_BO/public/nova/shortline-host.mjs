import { h, button, note } from './ui.js';
import { archivedStockQuote } from './market-evidence.js';
import { rowsFrom,recoveryDisclosure } from './market.js';

const endpoint='/api/research/shortline';
const pages={
  overview:'短线研究总览',new:'自动战法校验',checks:'校验记录',library:'战法因子库',trades:'交易样本学习',
  backtest:'K线样本回测',review:'结构化复盘',mistakes:'交易纪律与错题',versions:'参数验证与审批'
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
export function createResearchSession(ctx,state){
  const inFlight=new Map(),recentLoads=new Map();
  function active(){
    if(ctx.signal?.aborted)throw new DOMException('已离开研究页面','AbortError');
    if(!ctx.canEdit)throw Error('当前设备需要研究编辑授权');
  }
  async function refresh(){
    active();
    const data=await ctx.api(endpoint,{signal:ctx.signal});
    active();
    Object.assign(state,data.state);
    return state;
  }
  async function save(action,payload,attempt=0){
    active();
    if(!state.permissions?.canWrite)throw Error(writeRequired);
    try{
      const data=await ctx.api(endpoint,{method:'POST',signal:ctx.signal,body:{revision:state.revision,action,payload}});
      active();
      Object.assign(state,data.state);
      return data.result;
    }catch(error){
      if(error.status===409){await refresh();if(action==='v6:sync'&&attempt<2&&state.permissions?.canWrite)return save(action,payload,attempt+1);throw Error('另一台设备已更新档案，已重读最新版本，请重新核对后保存。');}
      throw error;
    }
  }
  async function loadEvidence(code,date,force=false){
    active();
    if(!stockCode(code)||date&&!day(date))throw Error('请输入六位股票代码与有效交易日');
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
  const session=createResearchSession(ctx,state);
  const [render]=await Promise.all([renderer(page),session.refresh()]);
  const wrap=h('section',{class:'fy-stack fy-shortline-space'}),body=h('div',{class:'fy-shortline-sheet'});
  const shadow=body.attachShadow({mode:'open'}),root=h('div',{class:'sheet-body'});
  if(page==='overview'){root.classList.add('shortline-overview');shadow.append(h('link',{rel:'stylesheet',href:'/nova/shortline/overview.css'}));}
  shadow.append(h('link',{rel:'stylesheet',href:'/nova/shortline-sheet.css'}),root);
  const target=stockCode(route.code)?{code:route.code,date:day(route.date)}:researchTarget(ctx,state);
  if(page==='overview'&&!day(route.date)&&day(state.marketRecovery?.referenceDay))target.date=state.marketRecovery.referenceDay;
  const syncStatus=note(''),statusText=(message)=>{if(!ctx.signal.aborted)syncStatus.textContent=message;};
  const recoveryBox=h('div',{},recoveryDisclosure(state));
  const updateRecovery=()=>{if(ctx.signal.aborted)return;const open=recoveryBox.firstChild?.open;const replacement=recoveryDisclosure(state);replacement.open=!!open;recoveryBox.replaceChildren(replacement);};
  const ui={state,root,stock:target.code,date:target.date,esc,download,modal:modalFor(ctx,state,wrap),
    async save(action,payload){const result=await session.save(action,payload);updateRecovery();return result;},
    open:page=>{if(Object.hasOwn(pages,page))ctx.navigate('lab','shortline-'+page);},
    toast:(message)=>{if(!ctx.signal.aborted)ctx.notify(message);},
    async refresh(){await session.refresh();if(!ctx.signal.aborted){updateRecovery();render(ui);}},
    async loadEvidence(code,date,force=false){
      const result=await session.loadEvidence(code,date,force);
      if(!ctx.signal.aborted){
        updateRecovery();
        const retrieved=day(result?.day)||day(date);
        if(!ui.date&&retrieved)ui.date=retrieved;
        statusText([code,retrieved,result?.replica?'只读副本':result?.reused?'使用已读取的档案':'已读取同期研究档案'].filter(Boolean).join(' · '));
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
  sync.disabled=!state.permissions?.canWrite;
  const reload=button('刷新研究档案',async()=>{reload.disabled=true;try{await ui.refresh();statusText('已读取当前服务保存的研究档案');}catch(e){statusText(e.message);}finally{reload.disabled=false;}},'quiet');
  const controls=h('div',{class:'fy-inline'},codeField,sync,reload);
  wrap.append(h('header',{class:'fy-card fy-shortline-head'},h('div',{},h('h1',{},pages[page]),syncStatus),controls),recoveryBox,body);
  statusText(state.permissions?.canWrite?'已读取 V6 研究档案':'当前副本提供已保存档案的只读核查。');
  // Resolve the source day from a dated V6 snapshot or let the source identify its latest close.
  if(target.code && ['overview','new','checks','review','backtest'].includes(page)){
    try{await ui.loadEvidence(target.code,target.date);}
    catch(e){if(ctx.signal.aborted)throw e;statusText('行情未能更新，保留已有档案 · '+e.message);}
  }
  if(!ui.date)ui.date=day(state.market?.at(-1)?.date)||'';
  if(!ctx.signal.aborted)render(ui);
  return wrap;
}
