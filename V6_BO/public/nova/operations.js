/* FAYO operations: independent presentation over the existing account authority.
   No old page, controller, stylesheet or account replica is embedded here. */
import {newsRows} from './market-evidence.js';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => value === null || value === undefined || value === '' ? '—' : String(value);
const fmt = (value, digits = 2) => number(value) === null ? '—' : value.toLocaleString('zh-CN', {minimumFractionDigits:digits, maximumFractionDigits:digits});
const yuan = value => number(value) === null ? '—' : '¥ ' + fmt(value);
const pct = value => number(value) === null ? '—' : (value > 0 ? '+' : '') + fmt(value) + '%';
const arr = value => Array.isArray(value) ? value.filter(Boolean) : [];
const date = value => { if (!value) return '时间未知'; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : String(value); };
const editor = ctx => ctx.role === 'edit';
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'value') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const append = child => { if (Array.isArray(child)) child.forEach(append); else if (child instanceof Node) node.append(child); else if (child !== null && child !== undefined && child !== false) node.append(document.createTextNode(String(child))); };
  children.forEach(append);
  return node;
}
const action = (label, run, kind='secondary', attrs={}) => el('button',{type:'button',class:'fy-button '+kind,...attrs,onclick:run},label);
const empty = (title, detail='') => el('div',{class:'fy-empty'},el('strong',{},title),detail && el('p',{},detail));
const panel = (title, description, ...children) => el('section',{class:'fy-panel'},el('div',{class:'fy-section-heading'},el('h2',{},title),description&&el('p',{},description)),...children);
const metric = (label, value, note='') => el('div',{class:'fy-metric'},el('span',{},label),el('strong',{},value),note&&el('small',{},note));
const notice = message => el('p',{class:'fy-status',role:'status'},message);
const field = (label, input, hint='') => el('label',{class:'fy-field'},el('span',{},label),input,hint&&el('small',{},hint));
const input = (name, value='', type='text', attrs={}) => el('input',{class:'fy-input',name,type,value:value??'',...attrs});
function select(name, options, value) { const node=el('select',{class:'fy-input',name},options.map(([v,label])=>el('option',{value:v},label))); if (value!==undefined) node.value=String(value); return node; }
const toggle = (name,label,checked=false) => el('label',{class:'fy-check'},input(name,'','checkbox',{checked}),el('span',{},label));
function table(columns, rows) {
  if (!rows.length) return empty('当前没有记录','已有结果保留在服务端，切换筛选或稍后重新读取。');
  return el('div',{class:'fy-table-wrap'},el('table',{class:'fy-table'},el('thead',{},el('tr',{},columns.map(([label])=>el('th',{},label)))),el('tbody',{},rows.map((row,index)=>el('tr',{},columns.map(([,get])=>el('td',{},get(row,index))))))));
}
function link(url,label) { try { const parsed=new URL(url,location.origin); if (!['https:','http:'].includes(parsed.protocol)) return el('span',{},label); return el('a',{href:parsed.href,target:'_blank',rel:'noopener noreferrer'},label); } catch { return el('span',{},label); } }
const privateView = () => empty('这是你的私人工作区','持仓、账户和配置只向已认证的编辑身份开放。可从右上角切换身份后继续。');
function subnav(ctx,view,items,active) { return el('nav',{class:'fy-subnav','aria-label':'工作区分区'},items.map(([value,label])=>action(label,()=>ctx.navigate(view,value),value===active?'active':'secondary',{'aria-current':value===active?'page':undefined}))); }
async function request(ctx,path,options) { const data=await ctx.api(path,{...options,signal:ctx.signal}); if(data?.ok===false) throw Error(data.error||data.message||'请求未完成'); return data; }
function failure(container,error, retry) { container.replaceChildren(empty('暂时无法读取',error?.message||'请稍后重试'),retry&&action('重新读取',retry)); }
function asyncRegion(ctx, read, render) {
  const box=el('div',{class:'fy-region'},notice('正在读取服务端记录…'));
  let generation=0,loading=false,dirty=false;
  box.addEventListener('input',()=>{dirty=true;});box.addEventListener('change',event=>{if(event.target.closest('form'))dirty=true;});
  const load=async()=>{const turn=++generation;loading=true;dirty=false;try{const data=await read();if(turn===generation&&!ctx.signal?.aborted&&!dirty)box.replaceChildren(render(data,load));}catch(error){if(turn===generation&&!ctx.signal?.aborted&&!dirty&&error?.name!=='AbortError')failure(box,error,load);}finally{if(turn===generation)loading=false;}};
  ctx.onState?.(()=>{if(!loading&&!dirty&&!box.parentElement?.querySelector('[data-operation-review]'))load();});
  queueMicrotask(()=>{const parent=box.parentElement;if(parent){parent.addEventListener('input',()=>{dirty=true;},ctx.signal?{signal:ctx.signal}:undefined);parent.addEventListener('change',event=>{if(event.target.closest('form'))dirty=true;},ctx.signal?{signal:ctx.signal}:undefined);}load();});return box;
}
function download(name,content,type='text/plain;charset=utf-8') { const url=URL.createObjectURL(new Blob([content],{type})); const a=el('a',{href:url,download:name}); a.click();setTimeout(()=>URL.revokeObjectURL(url),0); }
function review(ctx,host,title,description,run) {
  host.querySelector('[data-operation-review]')?.remove();
  const box=el('section',{class:'fy-review',role:'alertdialog','aria-label':title,'data-operation-review':true,tabindex:'-1'},el('h3',{},title),el('p',{},description));
  const cancel=action('取消',()=>box.remove());
  const confirm=action('确认执行',async()=>{confirm.disabled=true;cancel.disabled=true;try{const response=await run();if(ctx.signal?.aborted)return;box.remove();ctx.notify(response?.msg||response?.note||'操作已完成','success');}catch(error){if(ctx.signal?.aborted)return;confirm.disabled=false;cancel.disabled=false;box.append(notice(error.message));}},'danger');
  box.append(el('div',{class:'fy-toolbar'},cancel,confirm));host.prepend(box);box.focus();return box;
}
async function mutation(ctx,path,body,reload) { const data=await request(ctx,path,{method:'POST',body}); if(reload&&!ctx.signal?.aborted)await reload(); return data; }
function form(title, description, fields, submitLabel, submit) {
  const node=el('form',{class:'fy-form'},el('h3',{},title),description&&el('p',{class:'fy-muted'},description),el('div',{class:'fy-form-grid'},fields));
  const result=notice('');result.hidden=true;
  const button=el('button',{type:'submit',class:'fy-button primary'},submitLabel);
  node.append(el('div',{class:'fy-toolbar'},button),result);
  node.addEventListener('submit',async event=>{event.preventDefault();if(!node.reportValidity())return;button.disabled=true;result.hidden=false;result.textContent='正在保存…';try{const data=await submit(new FormData(node),node);result.textContent=data?.msg||data?.note||'服务端已确认';}catch(error){result.textContent=error.message;}finally{button.disabled=false;}});
  return node;
}
function holdingForm(ctx,host,reload,item) {
  const editing=!!item;
  const fields=[field('股票代码',input('code',item?.code||'','text',{required:true,pattern:'[0-9]{6}',maxlength:6,inputmode:'numeric',readonly:editing})),field('股票名称',input('name',item?.name||'')),field('成本价',input('cost',item?.cost??'','number',{required:true,min:'0.001',step:'0.001'})),field('股数',input('shares',item?.shares??'','number',{required:true,min:1,step:1})),field('标签',input('tags',arr(item?.tags).join('，')),'用逗号分隔，可同时属于多个分组'),field('备注',input('note',item?.note||'')),toggle('locked','锁定仓位',!!item?.locked),toggle('mute','暂停该股推送',!!item?.muted)];
  const node=form(editing?'调整持仓':'记录一笔持仓','这里记录实际持仓，不会向券商提交交易。',fields,editing?'保存调整':'加入资产簿',async data=>{
    const entry={code:String(data.get('code')),name:String(data.get('name')),cost:Number(data.get('cost')),shares:Number(data.get('shares')),tags:String(data.get('tags')).split(/[,，、\s]+/).filter(Boolean),note:String(data.get('note')),locked:data.has('locked'),mute:data.has('mute')};
    const response=await mutation(ctx,'/api/holdings',editing?{action:'update',code:item.code,data:entry}:{action:'add',item:entry},reload);
    if(!ctx.signal?.aborted){node.remove();ctx.notify(response.msg||'持仓已保存','success');}return response;
  });
  node.append(action('收起',()=>node.remove()));host.prepend(node);node.querySelector('input').focus();return node;
}
function holdingCards(ctx,host,items,reload,selected) {
  return el('div',{class:'fy-holding-grid'},items.map(item=>{
    const card=el('article',{class:'fy-holding-card','data-holding-code':item.code});
    const choose=input('pick-'+item.code,'','checkbox',{'aria-label':'选择'+text(item.name||item.code)});choose.checked=selected.has(item.code);choose.addEventListener('change',()=>choose.checked?selected.add(item.code):selected.delete(item.code));
    card.append(el('div',{class:'fy-item-head'},choose,action(text(item.name||item.code),()=>ctx.selectStock(item.code),'text'),el('code',{},item.code),el('strong',{class:number(item.floatPct)>0?'fy-up':number(item.floatPct)<0?'fy-down':''},pct(item.floatPct))),el('div',{class:'fy-tagline'},arr(item.tags).map(tag=>el('span',{class:'fy-tag'},tag)),item.locked&&el('span',{class:'fy-tag'},'锁定'),item.muted&&el('span',{class:'fy-tag'},'静音'),item.valuationOnly&&el('span',{class:'fy-tag'},'仅估值')));
    card.append(el('dl',{class:'fy-detail-grid'},[['当前估值',yuan(item.price)],['成本价',yuan(item.cost)],['持有股数',fmt(item.shares,0)],['仓位比例',pct(item.weight)],['浮动盈亏',yuan(item.profitAmt)],['当日盈亏',yuan(item.dayPnl)],['主力净额',yuan(item.mainIn)],['近高回撤',pct(item.drawdown)]].map(([label,value])=>el('div',{},el('dt',{},label),el('dd',{},value)))));
    if(item.note)card.append(el('p',{class:'fy-muted'},item.note));
    card.append(el('div',{class:'fy-action-reasons'},arr(item.acts).length?arr(item.acts).map(a=>el('p',{},el('strong',{},a.type||'观察'),a.text&&' · '+a.text,el('small',{},a.why||''))):notice('未触发持仓处理条件')));
    card.append(el('div',{class:'fy-toolbar'},action('编辑',()=>holdingForm(ctx,host,reload,item)),action(item.muted?'恢复提醒':'暂停提醒',async()=>{try{await mutation(ctx,'/api/holdings',{action:'mute',code:item.code,muted:!item.muted},reload);}catch(e){ctx.notify(e.message,'error');}}),action(item.locked?'解除锁定':'锁定仓位',async()=>{try{await mutation(ctx,'/api/holdings',{action:'setlocked',code:item.code,locked:!item.locked},reload);}catch(e){ctx.notify(e.message,'error');}}),action('移除',()=>review(ctx,host,'移除 '+text(item.name||item.code),'只移除资产簿记录，不会向券商卖出股票。',()=>mutation(ctx,'/api/holdings',{action:'remove',code:item.code},reload)),'danger')));
    return card;
  }));
}
function holdings(ctx,risk=false) {
  const host=el('div',{class:'fy-stack'});if(!editor(ctx))return privateView();
  host.append(asyncRegion(ctx,()=>request(ctx,'/api/holdings'),(data,reload)=>{
    const items=arr(data.items),summary=data.summary||{},cfg=data.cfg||{},selected=new Set();
    const wrap=el('div',{class:'fy-stack'},el('div',{class:'fy-metrics'},metric('持仓市值',yuan(summary.market)),metric('浮动盈亏',yuan(summary.profit),pct(summary.floatPct)),metric('仓位',pct(summary.positionPct)),metric('总资金',yuan(summary.capital))));
    const list=el('div');const search=input('holding-search','','search',{placeholder:'搜索股票、代码或标签','aria-label':'筛选资产'});const tags=select('holding-tag',[['','全部标签'],...arr(data.allTags).map(tag=>[tag,tag]),['__locked','只看锁仓'],['__muted','只看静音']]);
    const render=()=>{const q=search.value.trim().toLowerCase(),tag=tags.value;const rows=items.filter(item=>(!q||[item.name,item.code,...arr(item.tags)].join(' ').toLowerCase().includes(q))&&(!tag||tag==='__locked'?(!tag||item.locked):tag==='__muted'?item.muted:arr(item.tags).includes(tag)));list.replaceChildren(rows.length?holdingCards(ctx,host,rows,reload,selected):empty('当前分组没有资产','调整筛选，或记录第一笔持仓。'));};
    search.addEventListener('input',render);tags.addEventListener('change',render);
    const tools=el('div',{class:'fy-toolbar'},search,tags,action('记录持仓',()=>holdingForm(ctx,host,reload),'primary'),action('锁定一笔仓位',()=>{
      const code=input('code','','text',{required:true,pattern:'[0-9]{6}',maxlength:6}),shares=input('shares','','number',{required:true,min:1,step:1});const node=form('快速锁仓','已存在的持仓会沿用服务器记录。',[field('股票代码',code),field('股数',shares)],'确认锁仓',data=>mutation(ctx,'/api/holdings',{action:'lock',item:{code:String(data.get('code')),shares:Number(data.get('shares'))}},reload));host.prepend(node);
    }),action('移除所选',()=>{if(!selected.size)return ctx.notify('先选择要移除的资产','info');const codes=[...selected];review(ctx,host,'移除 '+codes.length+' 条持仓记录','这些记录会从资产簿移除，不会执行证券交易。',()=>mutation(ctx,'/api/holdings',{action:'removeMany',codes},reload));},'danger'),action('刷新',reload));
    if(risk){
      const thresholds=form('风险边界','所有阈值由服务端按原有规则判定，保存不会直接执行买卖。',[field('总资金（元）',input('capital',summary.capital??'','number',{min:0,step:0.01})),field('止损幅度 %',input('stopPct',cfg.stopPct==null?'':Math.abs(cfg.stopPct),'number',{min:0,step:0.1,required:true})),field('减仓预警 %',input('reducePct',cfg.reducePct==null?'':Math.abs(cfg.reducePct),'number',{min:0,step:0.1,required:true})),field('止盈幅度 %',input('takePct',cfg.takePct??'','number',{min:0,step:0.1,required:true})),field('仓位上限 %',input('maxPosPct',cfg.maxPosPct??'','number',{min:0,max:100,step:0.1,required:true}))],'保存边界',async values=>{
        if(String(values.get('capital'))!=='')await mutation(ctx,'/api/holdings',{action:'capital',capital:Number(values.get('capital'))});
        return mutation(ctx,'/api/holdings',{action:'cfg',cfg:Object.fromEntries(['stopPct','reducePct','takePct','maxPosPct'].map(key=>[key,Number(values.get(key))]))},reload);
      });
      wrap.append(thresholds,panel('需要关注的资产','风险、暂停、锁定和估值状态均沿用服务端证据。',el('div',{class:'fy-toolbar'},action('立即巡检',()=>review(ctx,host,'立即巡检持仓','巡检会按现有策略检查持仓；符合条件时会向已配置的私密通道发送提醒。',async()=>{const response=await mutation(ctx,'/api/holdings',{action:'check'},reload);return{msg:'巡检完成 · 触发 '+text(response.fired)+' 项；提醒送达请查看投递追踪。'};}),'primary')),items.filter(item=>item.level==='danger'||item.level==='warn').length?holdingCards(ctx,host,items.filter(item=>item.level==='danger'||item.level==='warn'),reload,selected):empty('当前未返回需要处理的资产','这不代表行情或风险已完成实时认证。')));
    }else wrap.append(panel('资产簿',data.time?'服务端更新时间 '+date(data.time):'同一服务端账户',tools,list));
    wrap.append(el('details',{class:'fy-advanced'},el('summary',{},'资产簿维护'),el('p',{},'清空仅影响资产簿，保留总资金和风险边界。'),action('清空资产簿',()=>review(ctx,host,'清空全部持仓记录','将移除 '+items.length+' 条持仓记录。建议先在变更历史中确认可用快照；不会执行券商交易。',()=>mutation(ctx,'/api/holdings',{action:'clear'},reload)),'danger')));render();return wrap;
  }));return host;
}
function holdingHistory(ctx) {if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});host.append(asyncRegion(ctx,()=>request(ctx,'/api/holdings/ops?n=100'),(data,reload)=>el('div',{class:'fy-stack'},panel('资产变更轨迹','服务端留存的变更与备份，恢复前可先核对时间。',table([['发生时间',row=>date(row.at||row.ts||row.time)],['操作',row=>text(row.action||row.type||row.op)],['资产',row=>text(row.code||arr(row.codes).join('、'))],['记录',row=>text(row.note||row.msg||row.detail)]],arr(data.ops))),panel('可恢复快照','恢复会替换当前资产簿，操作前需要确认。',arr(data.snapshots).length?el('div',{class:'fy-list'},arr(data.snapshots).map(snapshot=>{const file=typeof snapshot==='string'?snapshot:snapshot.file||snapshot.name;return el('article',{class:'fy-item'},el('strong',{},text(file)),el('span',{},date(snapshot.at||snapshot.ts||snapshot.time)),action('恢复这一份',()=>review(ctx,host,'恢复资产簿快照',text(file)+' 将替换当前资产簿，请核对快照日期与账户。',()=>mutation(ctx,'/api/holdings/restore',{file},reload)),'danger'));})):empty('当前没有可恢复快照')))));return host;}
function paper(ctx,ledger=false) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});
  host.append(asyncRegion(ctx,()=>request(ctx,ledger?'/api/paper/ledger':'/api/paper'),(data,reload)=>{
    const records=data.paper||{};return el('div',{class:'fy-stack'},['pool','pre'].map(key=>{
      const account=records[key];if(!account)return panel(key==='pool'?'策略跟踪账户':'机会预选账户','',empty('账户数据尚未返回'));
      if(ledger)return renderLedgerAccount(account,key);
      const card=panel(account.name||(key==='pool'?'策略跟踪账户':'机会预选账户'),account.enabled===false?'自动跟踪已暂停':'保留策略、T+1与报价门禁');
      const quote=account.pxBasis;card.append(el('div',{class:'fy-metrics'},metric('账户权益',yuan(account.equity)),metric('可用资金',yuan(account.cash)),metric('累计盈亏',yuan(account.totalPnl),pct(account.totalPct)),metric('初始资金',yuan(account.initial))),quote&&notice(quote.note||quote.label||'账户估值沿用原始行情快照'));
      card.append(el('div',{class:'fy-toolbar'},action(account.enabled===false?'恢复策略跟踪':'暂停策略跟踪',()=>review(ctx,host,'切换策略跟踪状态',account.enabled===false?'恢复后，现有策略将在满足服务端交易与风控门禁时继续模拟跟踪。':'暂停后不再由该模拟账户继续自动跟踪。',()=>mutation(ctx,'/api/paper',{account:key,action:'toggle'},reload)),'primary'),action('刷新账户',reload)));
      card.append(el('h3',{},'当前仓位'),table([['资产',row=>action(text(row.name||row.code),()=>ctx.selectStock(row.code),'text')],['股数',row=>fmt(row.shares,0)],['买入价',row=>yuan(row.buyPrice)],['估值价',row=>yuan(row.lastPrice)],['盈亏',row=>el('span',{class:number(row.pnl)>0?'fy-up':'fy-down'},yuan(row.pnl))],['交易日',row=>fmt(row.days,0)],['报价状态',row=>text(row.valuationQuote?.status||row.valuationQuote?.note||'原始时点待核验')]],arr(account.positions)));
      card.append(el('h3',{},'最近成交 · '+(account.tradesShown??arr(account.trades).length)+' / '+text(account.tradesTotal)),table([['成交时间',row=>date(row.t||row.ts||row.time||row.tradeDate||row.date)],['报价时点',row=>date(row.quoteAt||row.fillEvidence?.quoteAt)],['方向',row=>text(row.side||row.action||row.type)],['资产',row=>text(row.name||row.code)],['成交价',row=>yuan(row.price)],['股数',row=>fmt(row.shares,0)],['依据',row=>text(row.reason||row.note||row.source)]],arr(account.trades)));
      const audit=account.audit||{};card.append(notice(audit.replica?'当前是副本视图，账户以主实例为准。':audit.ok===true?'账户与流水核对通过':audit.incomplete?'对账证据不完整，保留未知。':audit.note||'账户对账状态待核验'));
      const initial=input('amount',account.initial??'','number',{min:10000,max:1e9,step:1,required:true});
      const maintain=form('账户维护','调整本金或修复记录前，请核对将影响的账户。',[field('新本金（元）',initial)],'预览本金调整',async values=>{const amount=Number(values.get('amount'));review(ctx,host,'调整模拟账户本金',`将 ${account.name||key} 的本金改为 ${yuan(amount)}，保留当前持仓与流水。`,()=>mutation(ctx,'/api/paper',{account:key,action:'setInitialKeep',amount},reload));return{note:'请在上方预览中确认执行'};});
      maintain.append(el('div',{class:'fy-toolbar'},action('重新开始账户',()=>review(ctx,host,'重置模拟账户',`将清空 ${account.name||key} 的持仓与交易记录，本金回到 ${yuan(account.initial)}。`,()=>mutation(ctx,'/api/paper',{account:key,action:'reset'},reload)),'danger'),action('改本金并清空记录',()=>{const amount=Number(initial.value);if(!Number.isFinite(amount)||amount<10000||amount>1e9)return ctx.notify('本金需在1万至10亿之间','error');review(ctx,host,'改本金并重新开始',`本金将改为 ${yuan(amount)}，同时清空本账户持仓与交易记录。`,()=>mutation(ctx,'/api/paper',{account:key,action:'setInitial',amount},reload));},'danger'),action('核对并修复仓位',()=>review(ctx,host,'按完整流水修复仓位','服务端将按原有权威规则处理；副本只转交主实例，不用本地混合流水重建。',()=>mutation(ctx,'/api/paper',{account:key,action:'repairPositions'},reload))),action('归档多余流水',()=>review(ctx,host,'归档未匹配的流水','以账户现有仓位为准，服务端会把未匹配的流水移入归档，保留证据。',()=>mutation(ctx,'/api/paper',{account:key,action:'archivePhantomTrades'},reload)))));
      card.append(el('details',{class:'fy-advanced'},el('summary',{},'维护与校验'),maintain));return card;
    }));
  }));return host;
}
function renderLedgerAccount(account,key) {
  const totals=account.accounting||account.summary||account.balance||account;const metrics=el('div',{class:'fy-metrics'},metric('可用现金',yuan(totals.cash??totals.availableCash)),metric('初始资金',yuan(totals.initialCash)),metric('已实现盈亏',yuan(totals.realized??totals.realizedPnl)),metric('对账状态',totals.auditStatus==='passed'||account.reconciliation?.ok===true||account.audit?.ok===true?'已核对':totals.auditStatus==='replica'?'副本 · 主实例为准':'待核验'));
  const positions=Array.isArray(totals.positions)?totals.positions:Array.isArray(account.positions)?account.positions:Object.values(account.positions||{});
  const events=arr(account.events||account.ledger||account.trades);
  return panel(account.name||(key==='pool'?'策略跟踪账本':'机会预选账本'),'账务投影来自账户权威，不创建第二本账。',metrics,table([['资产',r=>text(r.name||r.code)],['持有股数',r=>fmt(r.shares??r.quantity,0)],['可售股数',r=>fmt(r.sellableShares??r.sellable,0)],['账面成本',r=>yuan(r.cost??r.basis)],['估值',r=>yuan(r.marketValue??r.market)]],positions),el('h3',{},'账务事件'),table([['事件时间',r=>date(r.t||r.at||r.ts||r.time||r.tradeDate)],['报价时点',r=>date(r.quoteAt)],['类型',r=>text(r.type||r.side)],['资产',r=>text(r.code||r.symbol)],['金额',r=>yuan(r.amount??r.value)],['说明',r=>text(r.reason||r.note)]],events));
}
function newsFeed(ctx,kind) {
  let source=[];
  const readSource=()=>newsRows(ctx.state||{},kind);
  const host=el('div',{class:'fy-stack'});const search=input('news-search','','search',{placeholder:'搜索标题、股票或板块','aria-label':'筛选资讯'});const feed=el('div',{class:'fy-news-feed'});
  const render=()=>{source=readSource();const q=search.value.trim().toLowerCase(),rows=source.filter(row=>[row.title,row.name,row.code,row.text,...arr(row.codes),...arr(row.sectors)].join(' ').toLowerCase().includes(q));feed.replaceChildren(rows.length?el('div',{class:'fy-timeline'},rows.map(row=>{
    const title=row.title||row.name||row.text||'信号记录';const url=row.url||row.sourceUrl;return el('article',{class:'fy-news-item'},el('div',{class:'fy-item-head'},el('time',{},date(row.publishedAt||row.quoteAt||row.t||row.time)),el('span',{class:'fy-tag'},row.direction||row.type||(arr(ctx.state?.badNews?.items).includes(row)?'风险线索':'资讯'))),el('h3',{},url?link(url,title):title),row.text&&row.text!==title&&el('p',{},row.text),row.reason&&el('p',{class:'fy-muted'},row.reason),el('div',{class:'fy-tagline'},arr(row.codes).map(code=>action(code,()=>ctx.selectStock(code),'text')),row.code&&action(row.code,()=>ctx.selectStock(row.code),'text'),arr(row.sectors).map(sector=>el('span',{class:'fy-tag'},sector))),row.source&&el('small',{},'来源 '+row.source));})):empty('当前没有匹配的资讯','休市期间资讯仍独立更新；行情快照与新闻发布时间分别展示。'));};search.addEventListener('input',render);render();
  host.append(panel(kind==='alerts'?'风险线索':kind==='signals'?'信号轨迹':'资讯时间线','公告、新闻与行情分别核验，不把标题线索直接当作买卖指令。',el('div',{class:'fy-toolbar'},search,action('刷新资讯',()=>ctx.refresh())),feed));
  if(editor(ctx))host.append(el('div',{class:'fy-toolbar'},action('补发新闻摘要',()=>review(ctx,host,'发送新闻摘要','这会向当前配置的通知通道发送一份新闻汇总。',()=>mutation(ctx,'/api/news-digest',{holiday:ctx.state?.trading===false})))));
  ctx.onState?.(render);return host;
}
function pushLog(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});let only='';
  const container=el('div');const load=async()=>{container.replaceChildren(notice('正在读取投递轨迹…'));try{const data=await request(ctx,'/api/push-log?n=200'+(only?'&only=sent':''));if(ctx.signal?.aborted)return;container.replaceChildren(el('div',{class:'fy-metrics'},metric('今日实际送达',fmt(data.sentToday,0)),metric('流水总数',fmt(data.count,0)),metric('本次显示',fmt(data.shown,0)),metric('实例身份',data.replica?'副本':'主实例')),arr(data.log).length?el('div',{class:'fy-timeline'},arr(data.log).map(row=>el('article',{class:'fy-news-item'},el('div',{class:'fy-item-head'},el('span',{class:'fy-tag'},row.status||'状态未知'),el('time',{},date(row.ts||row.time))),el('h3',{},row.title||'通知记录'),row.channel&&el('small',{},row.channel),el('p',{},row.error||row.note||row.text||'服务端未提供更多说明')))):empty('尚无通知流水'));}catch(error){if(!ctx.signal?.aborted)failure(container,error,load);}};
  const filter=select('push-delivery',[['','全部状态'],['sent','仅实际送达']],'');filter.addEventListener('change',()=>{only=filter.value;load();});host.append(panel('投递追踪','“请求已接收”与“已经送达”是两种状态。',el('div',{class:'fy-toolbar'},filter,action('重新读取',load)),container));queueMicrotask(load);return host;
}
function messageComposer(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});const title=input('title','','text',{required:true,maxlength:40});const content=el('textarea',{class:'fy-input',name:'text',required:true,maxlength:4000,rows:7});const channel=select('channel',[['private','个人私密通道']],'private');
  host.append(form('写一条通知','发送前会展示内容与目标通道。',[field('标题',title),field('正文',content),field('送达范围',channel),toggle('force','允许穿过静默时段',false)],'预览通知',async data=>{const body={title:String(data.get('title')),text:String(data.get('text')),private:true,force:data.has('force')};review(ctx,host,'发送到'+(body.private?'私密通道':'公共通道'),body.title+'\n\n'+body.text+(body.force?'\n将穿过静默时段。':''),async()=>{await mutation(ctx,'/api/push-note',body);return{msg:'通知已提交；实际送达请查看投递追踪。'};});return{note:'请在上方预览中确认发送。'};}));return host;
}
function preferences(ctx) {
  if(!editor(ctx))return privateView();const state=ctx.state||{},host=el('div',{class:'fy-stack'}),controls=[];
  for(const [key,item] of Object.entries(state.cfgSet||{})){
    const node=item.kind==='bool'?input(key,'','checkbox',{checked:item.value===true}):input(key,item.value??'',item.kind==='hhmm'?'time':'number',{step:item.kind==='hhmm'?undefined:'any'});
    controls.push(field(item.label||key,node,item.note||''));
  }
  const ranges=Object.entries(state.cfgRange||{});
  for(const [key,item]of ranges)controls.push(field(item.label||key,input(key,item.cur??item.using??'','number',{min:item.min,max:item.max,step:'any'}),[item.hint,item.def!==undefined?'默认 '+item.def:''].filter(Boolean).join(' · ')));
  if(!controls.length)return empty('配置目录尚未返回','重新读取服务端状态后，将显示可编辑的通知时段、开关和策略阈值。');
  host.append(form('自动化偏好','可改项与范围由当前服务端提供，不重写策略规则。',controls,'预览修改',async values=>{const body={};for(const [key,item]of Object.entries(state.cfgSet||{}))body[key]=item.kind==='bool'?values.has(key):item.kind==='hhmm'?String(values.get(key)):Number(values.get(key));for(const [key]of ranges)body[key]=Number(values.get(key));review(ctx,host,'应用自动化偏好','将更新 '+Object.keys(body).length+' 个时段、开关或阈值。保存失败时服务端保留原配置。',async()=>{const result=await mutation(ctx,'/api/config',body);await ctx.refresh();return result;});return{note:'请在上方确认修改。'};}));return host;
}
function channels(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'}),state=ctx.state||{};
  host.append(el('div',{class:'fy-metrics'},metric('公共通道',state.wecomReady||state.feishuReady?'已配置':'未就绪',state.feishuMask||''),metric('私密通道',state.feishuSecReady?'已配置':'待核对',state.feishuSecMask||''),metric('邮件通道',state.mailReady?'已配置':'待核对')));
  for(const [kind,label,hookKey,secretKey,verifyKey]of [['public','公共通知','feishuWebhook','feishuSecret','verify'],['private','私密通知','feishuSecWebhook','feishuSecSecret','secVerify']]){
    const hook=input('hook','','url',{required:true,autocomplete:'off',placeholder:'粘贴新的飞书机器人地址'}),secret=input('secret','','password',{autocomplete:'new-password'});
    const card=form(label+'路由','新配置先发送一条通道体检，成功后服务端才切换。地址和密钥不会回显。',[field('机器人地址',hook),field('签名密钥',secret)],'预览切换',async values=>{const body={[hookKey]:String(values.get('hook')).trim(),[secretKey]:String(values.get('secret')).trim(),[verifyKey]:true};review(ctx,host,'验证并切换'+label,'将向新机器人发送一条体检消息；验证成功后更新通道。',async()=>{const r=await mutation(ctx,'/api/config',body);hook.value='';secret.value='';await ctx.refresh();return{...r,msg:r.fsNote||'通知路由已更新'};});return{note:'请在上方确认通道体检。'};});
    card.append(action('停用'+label,()=>review(ctx,host,'停用'+label,kind==='private'?'验证码与私密消息会停止发送，不会退回公共群。':'系统将停止通过公共机器人发送通知。',async()=>{const r=await mutation(ctx,'/api/config',{[hookKey]:'',[secretKey]:''});await ctx.refresh();return r;}),'danger'));host.append(card);
  }
  const mail=form('邮件路由','仅提交新值，密码不会显示。',[field('邮箱账户',input('user','','email',{required:true,autocomplete:'off'})),field('授权码',input('authCode','','password',{required:true,autocomplete:'new-password'})),field('收件邮箱',input('to','','email',{required:true}))],'预览保存',async values=>{const body={qqMail:{user:String(values.get('user')),authCode:String(values.get('authCode')),to:String(values.get('to'))}};review(ctx,host,'保存邮件路由','将使用表单中的邮箱账户与收件地址发送后续通知。',async()=>{const r=await mutation(ctx,'/api/config',body);mail.reset();await ctx.refresh();return r;});return{note:'请在上方确认。'};});host.append(mail,action('发送通道自检',()=>review(ctx,host,'发送一条自检消息','将向现有通知路由发送体检消息，并返回实际投递结果。',()=>mutation(ctx,'/api/test-push',{}))));return host;
}
function devices(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});
  host.append(asyncRegion(ctx,async()=>{const results=await Promise.allSettled([request(ctx,'/api/lock/devices'),request(ctx,'/api/devices')]);return{authorized:results[0].status==='fulfilled'?results[0].value:null,online:results[1].status==='fulfilled'?results[1].value:null,errors:results.filter(x=>x.status==='rejected').map(x=>x.reason.message)};},(data,reload)=>{
    const all=arr(data.authorized?.items),online=arr(data.online?.items);const wrap=el('div',{class:'fy-stack'},data.errors.length?notice(data.errors.join('；')):null,panel('已授权设备','撤销后，该设备需要重新认证。',table([['设备',d=>text(d.name||d.dev)],['身份',d=>d.role==='edit'?'编辑':'只读'],['最近活跃',d=>date(d.ts||d.at)],['网络',d=>text(d.ip)],['状态',d=>d.revoked?'已撤销':'已授权'],['操作',d=>action('撤销',()=>review(ctx,host,'撤销设备访问',text(d.name||d.id)+' 将失去当前访问授权。',()=>mutation(ctx,'/api/lock/revoke',{id:d.id},reload)),'danger')]],all),el('div',{class:'fy-toolbar'},action('刷新设备',reload),action('清理30天未活跃授权',()=>review(ctx,host,'清理历史授权','将按服务端规则合并重复设备，清理30天未活跃的授权。',()=>mutation(ctx,'/api/lock/devices',{action:'prune',days:30},reload))))),panel('正在访问','来自当前服务端的在线设备台账。',table([['设备',d=>text(d.name||d.dev)],['身份',d=>d.role==='edit'?'编辑':'只读'],['活跃时刻',d=>date(d.at||d.ts)],['设备ID',d=>text(d.id)]],online)));
    const pending=el('div');const pendingButton=action('读取访问申请',async()=>{pendingButton.disabled=true;try{const r=await request(ctx,'/api/lock/pending-list',{method:'POST',body:{}});if(ctx.signal?.aborted)return;pending.replaceChildren(arr(r.list).length?el('div',{class:'fy-list'},arr(r.list).map(d=>el('article',{class:'fy-item'},el('strong',{},d.name||'新设备'),el('span',{},text(d.ip)+' · '+text(d.at)),el('div',{class:'fy-toolbar'},action('允许',()=>review(ctx,host,'允许只读访问',text(d.name||d.ip)+' 将可访问公开行情与研究结果，不能查看私人资产或修改配置。',()=>mutation(ctx,'/api/lock/pending-approve',{req:d.req,allow:true},reload)),'primary'),action('拒绝',()=>review(ctx,host,'拒绝访问申请',text(d.name||d.ip)+' 的本次访问申请将被拒绝。',()=>mutation(ctx,'/api/lock/pending-approve',{req:d.req,allow:false},reload)),'danger'))))):empty('没有待处理的访问申请'));}catch(e){failure(pending,e);}finally{pendingButton.disabled=false;}});
    wrap.append(panel('新设备申请','只读设备输入正确口令后，仍需要你明确放行。',pendingButton,pending));return wrap;
  }));return host;
}
function security(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});
  host.append(asyncRegion(ctx,()=>request(ctx,'/api/lock/status'),data=>el('div',{class:'fy-metrics'},metric('当前身份',data.role==='edit'?'编辑':'只读'),metric('编辑口令',data.hasPassword?'已设置':'未设置'),metric('观看口令',data.hasViewPassword?'已设置':'未设置'),metric('找回手机',data.boundPhone||'未绑定'))));
  if(ctx.auth?.hasPassword===false){
    const setup=form('创建编辑口令','此实例尚未建立编辑口令。确认后创建访问凭据，账户数据继续保留。',[field('新的编辑口令',input('password','','password',{required:true,minlength:8,maxlength:128,autocomplete:'new-password'}))],'预览创建',async values=>{
      const password=String(values.get('password'));
      review(ctx,host,'创建首次访问口令','将为此实例设置编辑访问口令。确认后请使用新口令重新登录。',async()=>{const result=await mutation(ctx,'/api/lock/setup',{password,role:'edit'});setup.reset();ctx.passwordCreated?.();ctx.logout?.('首次口令已创建，请重新登录以绑定此设备。');return result;});return{note:'请在上方确认首次口令设置。'};
    });host.append(setup);
  }
  const edit=form('更换编辑口令','更换口令可能让已有编辑会话失效。',[field('当前口令',input('password','','password',{required:true,autocomplete:'current-password'})),field('新口令',input('newPassword','','password',{required:true,minlength:4,autocomplete:'new-password'}))],'预览更换',async values=>{review(ctx,host,'更换编辑口令','确认后使用新口令重新登录；已有会话可能需要再次认证。',async()=>{const r=await mutation(ctx,'/api/lock/change',{role:'edit',password:String(values.get('password')),newPassword:String(values.get('newPassword'))});edit.reset();if(typeof ctx.logout==='function')ctx.logout();return r;});return{note:'请在上方确认。'};});
  const view=form('更换观看口令','更新后，已授权的观看设备可能需要重新申请。',[field('新的观看口令',input('newPassword','','password',{required:true,minlength:4,autocomplete:'new-password'}))],'预览更换',async values=>{review(ctx,host,'更换观看口令','所有观看设备可能立即失效，需要重新申请并由你放行。',async()=>{const r=await mutation(ctx,'/api/lock/change',{role:'view',newPassword:String(values.get('newPassword'))});view.reset();return r;});return{note:'请在上方确认。'};});
  const phone=form('找回手机号','服务端只保留验证所需的安全摘要，页面不显示完整号码。',[field('手机号',input('phone','','tel',{required:true,pattern:'[0-9]{7,15}',autocomplete:'tel'}))],'绑定手机号',async values=>{const r=await mutation(ctx,'/api/lock/bind-phone',{phone:String(values.get('phone'))});phone.reset();return r;});
  const role=select('role',[['view','只读观看'],['edit','编辑管理']],'view');const codeBox=notice('');
  host.append(edit,view,phone,panel('另一台设备登录','授权码10分钟内有效且只能使用一次。生成时会发送到私密通知通道。',field('授权身份',role),action('生成一次性授权码',()=>{const authorizationRole=role.value;review(ctx,host,'生成设备授权码','将生成 '+(authorizationRole==='edit'?'编辑':'只读')+' 授权码，并发送到私密通知通道。',async()=>{const r=await mutation(ctx,'/api/auth/code',{role:authorizationRole});codeBox.textContent='授权码 '+text(r.code)+' · '+text(r.expMin)+' 分钟内有效';return{msg:'授权码已生成'};});}),codeBox));return host;
}
function sourceTools(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'}),files=['public/nova/app.js','public/nova/index.html','public/nova/client.js','public/nova/ui.js','public/nova/market.js','public/nova/market-evidence.js','public/nova/workbook.js','public/nova/workbook-view.js','public/nova/research-extensions.js','public/nova/research.js','public/nova/research-records.js','public/nova/operations.js','public/nova/fayo.css','public/nova/mark.svg','server.js','analysis.js','em.js','mailer.js','themeMap.json','public/index.html'];
  const file=select('source-file',files.map(f=>[f,f==='public/index.html'?'历史页面 · public/index.html':f.startsWith('public/nova/')?'当前系统 · '+f.slice(12):f]),files[0]),content=el('textarea',{class:'fy-input fy-code-input',rows:24,spellcheck:'false','aria-label':'源文件内容'}),status=notice('选择文件后读取。');let loaded='';
  const read=async()=>{try{const r=await request(ctx,'/api/source?file='+encodeURIComponent(file.value));if(ctx.signal?.aborted)return;loaded=r.file;content.value=r.content;status.textContent='已读取 '+loaded;}catch(e){status.textContent=e.message;}};
  file.addEventListener('change',()=>{loaded='';content.value='';status.textContent='文件已切换，请重新读取。';});
  host.append(panel('受控源文件','只列出服务端允许编辑的文件。读取与修改均需要编辑身份。',el('div',{class:'fy-toolbar'},file,action('读取文件',read),action('下载已读取文件',()=>{if(!loaded)return ctx.notify('先读取文件','info');download(loaded.replaceAll('/','-'),content.value);}),action('下载源代码汇总',async()=>{try{const r=await request(ctx,'/api/source-all');if(ctx.signal?.aborted)return;download('fayo-service-sources.txt',r.source||'');ctx.notify('已生成源代码汇总','success');}catch(e){ctx.notify(e.message,'error');}})),status,content,action('预览保存',()=>{if(!loaded||loaded!==file.value||!content.value.trim())return ctx.notify('先读取当前文件并输入有效内容','error');const sourceFile=loaded,sourceContent=content.value;review(ctx,host,'保存 '+sourceFile,'服务端会按原有流程先备份、检查，再保存文件。修改服务源码可能影响正在运行的功能。',async()=>{const r=await mutation(ctx,'/api/source',{file:sourceFile,content:sourceContent});status.textContent='已保存 '+sourceFile+' · '+text(r.time);return r;});},'primary')));return host;
}
function releaseTools(ctx) {
  if(!editor(ctx))return privateView();const host=el('div',{class:'fy-stack'});
  host.append(asyncRegion(ctx,()=>request(ctx,'/api/release/requests'),(data,reload)=>{
    const requests=arr(data.requests),picked=new Set();const rows=requests.map(row=>{const check=input('release-'+row.file,'','checkbox',{'aria-label':'选择发布请求 '+text(row.summary||row.file)});check.addEventListener('change',()=>check.checked?picked.add(row.file):picked.delete(row.file));return{...row,check};});
    const stage=select('stage',[['pending','待处理'],['reviewed','已复核'],['rejected','拒绝'],['published','已发布']],'reviewed');
    const detail=input('detail','','text',{placeholder:'处理说明或发布版本'});
    return el('div',{class:'fy-stack'},panel('发布收件箱','这里显示现有发布流程的请求。只有明确确认后才会提交发布。',el('div',{class:'fy-metrics'},metric('请求数',fmt(requests.length,0)),metric('当前服务版本',text(data.onlineVer)),metric('同步时刻',date(data.syncedAt))),table([['选择',r=>r.check],['请求',r=>text(r.summary||r.title||r.file)],['状态',r=>text(r.status||r.stage)],['来源',r=>text(r.space||r.from)],['文件',r=>text(r.file)]],rows),el('div',{class:'fy-toolbar'},action('重新读取',reload),action('发布所选请求',()=>{if(!picked.size)return ctx.notify('先选择发布请求','info');const files=[...picked];review(ctx,host,'提交 '+files.length+' 个发布请求',files.join('、')+'。服务端将交给受控发布执行者处理；提交请求不等于已经上线。',async()=>{const response=await mutation(ctx,'/api/release/publish',{files,force:false},reload);return{msg:response.queued?'已加入发布队列，尚未确认上线':response.msg||'发布流程已提交，请核对实际回执。'};});},'primary')),el('div',{class:'fy-form-grid'},field('处理阶段',stage),field('处理说明',detail)),action('更新所选处理阶段',()=>{if(!picked.size)return ctx.notify('先选择请求','info');const files=[...picked],nextStage=stage.value,nextDetail=detail.value,nextLabel=stage.selectedOptions[0].textContent;review(ctx,host,'更新处理阶段','将 '+files.length+' 个请求标记为 '+nextLabel+'。标记已发布可能触发原有回执和复核。',async()=>{for(const file of files)await mutation(ctx,'/api/release/update',{file,stage:nextStage,detail:nextDetail});await reload();return{msg:'请求状态已更新'};});})),panel('最近一次发布','真实发布信息以业务服务回执为准。',data.lastRelease?el('dl',{class:'fy-detail-grid'},Object.entries(data.lastRelease).filter(([key,value])=>['version','ver','time','at','status','summary','sha','commit'].includes(key)&&typeof value!=='object').map(([key,value])=>el('div',{},el('dt',{},key),el('dd',{},text(value))))):empty('尚无发布回执')));
  }));return host;
}
function authority(ctx) {
  if(!editor(ctx))return privateView();
  const host=el('div',{class:'fy-stack'}),account=select('accountId',[['pool','策略跟踪主账户'],['pre','机会预选主账户']],'pool');
  const output=el('div'),status=notice('选择账户后读取。'),policyInputs={};let current=null,generation=0,preview=null;
  const fields=[['maxPositionPct','单票仓位上限 %',100],['maxGrossExposurePct','总仓位上限 %',100],['maxSectorPct','行业仓位上限 %',100],['maxStrategyPct','策略仓位上限 %',100],['maxConsecutiveLosses','连续亏损暂停次数',1000],['maxDrawdownPausePct','收盘回撤暂停 %',100],['maxDailyLossPausePct','收盘单日亏损暂停 %',100]];
  const plan=()=>({accountId:account.value,generation});
  const live=p=>!ctx.signal?.aborted&&p.accountId===account.value&&p.generation===generation;
  const ensure=p=>{if(!live(p))throw Error('账户或文件已变更，请重新读取并预检。');};
  const call=async(p,action,extra={})=>{ensure(p);const r=await request(ctx,'/api/research/order-account',{method:'POST',body:{accountId:p.accountId,action,...extra}});ensure(p);return r.result;};
  const show=data=>{current=data;const root=data.account||{},positions=Object.entries(root.positions||{}).map(([symbol,item])=>({symbol,...item})),orders=Object.values(data.orders||{});output.replaceChildren(el('div',{class:'fy-metrics'},metric('账户现金',yuan(root.cash)),metric('快照版本',fmt(data.revision,0)),metric('持有资产',fmt(positions.filter(p=>number(p.quantity)>0).length,0)),metric('账务事件',fmt(arr(root.events).length,0))),table([['资产',r=>action(r.symbol,()=>ctx.selectStock(r.symbol),'text')],['股数',r=>fmt(r.quantity,0)],['成本',r=>yuan(r.costBasis??r.basis)],['持仓批次',r=>fmt(arr(r.lots).length,0)]],positions),el('h3',{},'委托状态'),table([['订单',r=>text(r.order?.orderId)],['资产',r=>text(r.order?.symbol)],['方向',r=>text(r.order?.side)],['状态',r=>text(r.state?.status||r.state?.phase)],['剩余数量',r=>fmt(r.state?.remainingQuantity,0)]],orders),el('h3',{},'账户事件'),table([['日期',r=>date(r.quoteAt||r.executionAt||r.t||r.tradeDate)],['方向',r=>text(r.side)],['资产',r=>text(r.symbol)],['数量',r=>fmt(r.quantity,0)],['成交价',r=>yuan(r.price)],['手续费',r=>yuan(r.fee)]],arr(root.events)));for(const [key]of fields)policyInputs[key].value=data.riskPolicy?.[key]??'';};
  const read=async()=>{const p=plan();status.textContent='正在读取主账户…';try{const data=await call(p,'read');if(!live(p))return;show(data);status.textContent='主账户已读取 · 原始账务与委托相互核对。';}catch(error){if(live(p))status.textContent=error.message;}};
  account.addEventListener('change',()=>{generation++;preview=null;current=null;output.replaceChildren();for(const node of Object.values(policyInputs))node.value='';status.textContent='账户已切换，请重新读取；尚未发起任何账户写入。';});
  host.append(panel('权威账务工作台','这是既有模拟订单与资金的同一份权威快照，和研究预演账户分开。',el('div',{class:'fy-toolbar'},account,action('读取账户',read,'primary'),action('读取拒单审计',async()=>{const p=plan();try{const result=await call(p,'audit',{pagination:{limit:100}});if(!live(p))return;output.replaceChildren(notice('审计记录 '+text(result.total)+' 条 · 当前最多显示100条'),table([['时间',r=>date(r.at||r.recordedAt||r.ts)],['资产',r=>text(r.symbol||r.order?.symbol)],['原因',r=>arr(r.reasonCodes).join(' · ')||text(r.reason)],['依据',r=>text(r.note||r.message)]],arr(result.items||result.records)));status.textContent='已读取拒单审计';}catch(error){if(live(p))status.textContent=error.message;}})),status,output));
  const policyFields=fields.map(([key,label,max])=>{const node=input(key,'','number',{min:key==='maxConsecutiveLosses'?1:0.01,max,step:key==='maxConsecutiveLosses'?1:0.01});policyInputs[key]=node;return field(label,node,'留空表示该项未配置');});
  host.append(form('统一新增仓位边界','保存前读取当前账户版本；账户已变化时，服务端拒绝覆盖。',policyFields,'预览风险配置',async values=>{
    const p=plan(),before=await call(p,'read'),riskPolicy={...before.riskPolicy,version:'fayo-risk-'+Date.now()};
    for(const [key]of fields){const raw=String(values.get(key)||'').trim();riskPolicy[key]=raw?Number(raw):null;}
    if(!fields.some(([key])=>riskPolicy[key]!==null))throw Error('至少填写一项风险边界。');
    review(ctx,host,'保存账户风险边界','将更新 '+p.accountId+' 的风险配置，预检版本 '+before.revision+'；不会创建或成交任何委托。',async()=>{ensure(p);const result=await call(p,'configure',{configuration:{expectedRevision:before.revision,riskPolicy}});if(live(p))show(result);return{msg:'统一风险边界已保存'};});return{note:'请在上方核对并确认。'};
  }));
  const settlementFile=input('settlement','','file',{accept:'.json,application/json'});settlementFile.addEventListener('change',()=>{generation++;preview=null;});
  host.append(form('权益结算凭据','导入已有的公司行为结算凭据，服务端会核对账户版本与证据。',[field('结算 JSON',settlementFile)],'预览权益结算',async()=>{
    const p=plan(),file=settlementFile.files[0];if(!file||file.size>1024*1024)throw Error('请选择1MB以内的结算凭据。');const settlement=JSON.parse(await file.text());ensure(p);const before=await call(p,'read');
    review(ctx,host,'导入权益结算','将以 '+file.name+' 结算 '+p.accountId+'，账户版本 '+before.revision+'。',async()=>{ensure(p);if(settlementFile.files[0]!==file)throw Error('结算文件已更换，请重新预览。');const result=await call(p,'settle',{settlement,expectedRevision:before.revision});show(result);return{msg:'权益结算已入账'};});return{note:'请在上方核对并确认。'};
  }));
  const evidenceFile=input('evidence','','file',{accept:'.json,application/json'}),evidenceOutput=el('div'),importButton=action('导入已预检证据',()=>{
    const stored=preview;if(!stored||!live(stored)||evidenceFile.files[0]!==stored.file)return ctx.notify('请先预检当前账户与文件','info');
    review(ctx,host,'导入 '+stored.records.length+' 条风险证据','目标账户 '+stored.accountId+' · 预检版本 '+stored.revision+'。证据齐备不代表允许开仓。',async()=>{ensure(stored);if(preview!==stored||evidenceFile.files[0]!==stored.file)throw Error('预检上下文已变更。');preview=null;importButton.disabled=true;const result=await call(stored,'import-risk-evidence-batch',{expectedRevision:stored.revision,evidenceList:stored.records});show(result);return{msg:'证据批次已导入'};});
  },'primary');importButton.disabled=true;
  evidenceFile.addEventListener('change',()=>{generation++;preview=null;importButton.disabled=true;evidenceOutput.replaceChildren();});
  host.append(panel('风险证据入库','只有同一账户、同一文件的有效预检才能导入；每批1至100条。',field('证据 JSON 数组',evidenceFile),el('div',{class:'fy-toolbar'},action('预检文件',async()=>{
    const p=plan(),file=evidenceFile.files[0];try{preview=null;importButton.disabled=true;if(!file||file.size>2*1024*1024)throw Error('请选择2MB以内的证据数组。');const records=JSON.parse(await file.text());if(!Array.isArray(records)||!records.length||records.length>100)throw Error('文件必须包含1至100条证据数组。');ensure(p);const before=await call(p,'read'),result=await call(p,'preview-risk-evidence-import',{expectedRevision:before.revision,evidenceList:records});ensure(p);if(evidenceFile.files[0]!==file)return;preview={...p,file,records,revision:result.accountRevision};importButton.disabled=false;evidenceOutput.replaceChildren(notice('预检通过 · 新增 '+text(result.imported)+' 条 · 重复 '+text(result.unchanged)+' 条 · 尚未导入'));}catch(error){if(live(p))evidenceOutput.replaceChildren(notice(error.message));}
  }),importButton),evidenceOutput));
  const day=input('tradeDate','','date',{required:true}),symbol=input('symbol',ctx.stock||'','text',{required:true,pattern:'[0-9]{6}',maxlength:6});
  host.append(form('检查证据覆盖','按指定交易日和股票核对当前风险规则所需证据。',[field('交易日',day),field('股票代码',symbol)],'核对所需证据',async values=>{const p=plan(),result=await call(p,'risk-evidence-status',{query:{tradeDate:String(values.get('tradeDate')),symbol:String(values.get('symbol'))}});evidenceOutput.replaceChildren(notice(result.evidenceReady?'当前规则所需证据齐备；仍需通过执行风控。':'证据不完整，请查看缺失项目。'),table([['证据类型',r=>text(r.kind)],['需要',r=>r.required?'需要':'未要求'],['覆盖',r=>r.ready?'齐备':'缺失'],['原因',r=>arr(r.reasonCodes).join(' · ')||'—'],['缺失股票',r=>arr(r.missingSymbols).join('、')||'—']],arr(result.checks)));return{note:'证据核对已完成'};}));
  return host;
}

function overview(ctx) {
  if(!editor(ctx))return privateView();const state=ctx.state||{},paper=state.paper||{},host=el('div',{class:'fy-stack'});
  host.append(panel('你的资产空间','实际持仓与模拟跟踪分开管理，始终沿用服务器上的同一份账户。',el('div',{class:'fy-portal-grid'},[['holdings','资产簿','记录成本、股数、标签与观察安排'],['risk','风险边界','查看持仓处理条件与风险参数'],['paper','策略跟踪账户','查看两套模拟账户与原有成交记录'],['ledger','账务证据','核对现金、仓位与账务事件'],['history','变更与恢复','追溯资产变更并恢复已有快照']].map(([sub,title,note])=>action(el('span',{},el('strong',{},title),el('small',{},note)),()=>ctx.navigate('assets',sub),'portal')))));
  if(!paper.hidden&&paper.pool)host.append(el('div',{class:'fy-metrics'},metric('策略跟踪权益',yuan(paper.pool.equity)),metric('机会预选权益',yuan(paper.pre?.equity)),metric('策略跟踪收益',pct(paper.pool.totalPct)),metric('机会预选收益',pct(paper.pre?.totalPct))));
  return host;
}
function diagnostics(ctx){
 if(!editor(ctx))return privateView();const state=ctx.state||{};
 const fields=[['taskState','后台任务'],['staleState','更新时效'],['poolBasis','候选口径'],['needRule','条件门槛'],['empSkip','模型跳过原因'],['ztPreRules','形态规则'],['trendScanProg','扫描进度'],['ztPreBasis','形态来源'],['trendScanBasis','扫描来源'],['steadyUpBasis','稳态来源']];
 function record(value,depth=0){if(value==null)return el('span',{class:'fy-muted'},'尚无记录');if(typeof value!=='object')return el('span',{},String(value));if(depth>5)return el('span',{},'深层记录');if(Array.isArray(value))return el('div',{class:'fy-list'},value.map(item=>el('div',{class:'fy-item'},record(item,depth+1))));return el('dl',{class:'fy-facts'},Object.entries(value).filter(([key])=>!/(?:token|secret|password|webhook|credential)/i.test(key)).map(([key,item])=>el('div',{},el('dt',{},key),el('dd',{},typeof item==='object'&&item?el('details',{class:'fy-details'},el('summary',{},'查看记录'),record(item,depth+1)):record(item,depth+1)))));}
 return el('div',{class:'fy-stack'},...fields.map(([key,title])=>panel(title,'共享状态中的实际运行记录',record(state[key]))));
}

export function renderOperations(route,ctx) {
  const view=route.view,sub=route.sub||({assets:'overview',inbox:'all',settings:'preferences'}[view]);
  const host=el('div',{class:'fy-operations fy-stack','data-operations-view':view,'data-operations-sub':sub});
  const categories={assets:[['overview','资产总览'],['holdings','资产簿'],['risk','风险边界'],['paper','模拟跟踪'],['ledger','账务证据'],['authority','主账户风控'],['history','变更与恢复']],inbox:[['all','资讯时间线'],['alerts','风险线索'],['signals','信号轨迹'],['push','投递追踪'],['compose','写通知']],settings:[['preferences','自动化偏好'],['diagnostics','运行状态'],['channels','通知路由'],['devices','设备'],['security','访问安全'],['source','受控源文件'],['release','发布收件箱']]};
  host.append(subnav(ctx,view,categories[view]||[],sub));
  let content;
  if(view==='assets')content=sub==='holdings'?holdings(ctx):sub==='risk'?holdings(ctx,true):sub==='paper'?paper(ctx):sub==='ledger'?paper(ctx,true):sub==='authority'?authority(ctx):sub==='history'?holdingHistory(ctx):overview(ctx);
  else if(view==='inbox')content=sub==='push'?pushLog(ctx):sub==='compose'?messageComposer(ctx):newsFeed(ctx,sub);
  else if(view==='settings')content=sub==='diagnostics'?diagnostics(ctx):sub==='channels'?channels(ctx):sub==='devices'?devices(ctx):sub==='security'?security(ctx):sub==='source'?sourceTools(ctx):sub==='release'?releaseTools(ctx):preferences(ctx);
  else content=empty('工作区不存在','从主导航选择一个功能继续。');
  host.append(content);return host;
}
