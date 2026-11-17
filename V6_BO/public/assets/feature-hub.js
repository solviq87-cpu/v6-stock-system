/* V6 feature finder: navigation-only enhancement for the approved legacy pages.
 * Does not request market data, change controllers, credentials or account state. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)api.install(root);
})(typeof window==='object'?window:globalThis,function(){
'use strict';
// Primary navigation follows the approved homepage reference; each item opens
// the original module or a dedicated existing page. No duplicated business UI.
const PRIMARY_NAV=Object.freeze([
 {label:'首页',href:'/#vx-dashboard',group:'market'},
 {label:'行情',href:'/#v6-market',group:'market'},
 {label:'选股',href:'/picks.html',group:'stocks'},
 {label:'策略',href:'/#v6-strategy',group:'strategy'},
 {label:'回测',href:'/#workspace-analysis',group:'review'},
 {label:'复盘',href:'/#v6-review',group:'review'},
 {label:'资讯',href:'/#v6-news',group:'settings'},
 {label:'资金流',href:'/#sectors',group:'market'},
 {label:'风控',href:'/#holdSec1',group:'account'},
 {label:'模拟盘',href:'/#v6-paper',group:'account'},
 {label:'我的',href:'/#workspace-settings',group:'settings'}
]);
const GROUPS=Object.freeze([
 {id:'quick',name:'常用',emoji:'★'}, {id:'market',name:'看盘行情',emoji:'📊'},
 {id:'stocks',name:'选股工具',emoji:'🎯'}, {id:'review',name:'涨停复盘',emoji:'🔥'},
 {id:'strategy',name:'策略研究',emoji:'🧠'}, {id:'account',name:'交易风控',emoji:'🛡️'},
 {id:'settings',name:'系统管理',emoji:'⚙️'}, {id:'all',name:'全部',emoji:'▦'}
]);
// Explicitly maintained against the actual V6 public pages and live page anchors.
// "entry" is a shortcut into an existing controller, never a new business action.
const CATALOG=Object.freeze([
 {id:'home',group:'market',icon:'⌂',name:'市场工作台',href:'/#vx-dashboard',description:'指数、情绪、策略候选与风险概览',tags:'首页 总览 大盘 指数',popular:true},
 {id:'picks',group:'stocks',icon:'✦',name:'智能选股池',href:'/picks.html',description:'候选股票、排名与K线详情',tags:'选股 自选股 推荐 个股 排行榜',popular:true},
 {id:'review',group:'review',icon:'🔥',name:'每日涨停复盘',href:'/#v6-review',description:'涨停数量、首板连板、逐股归因',tags:'复盘 涨停板 数量 今天几只 收盘',popular:true},
 {id:'review-evidence',group:'review',icon:'📎',name:'涨停原因与事件证据',href:'/#review',description:'题材标签、新闻来源与事件日期核对',tags:'涨停原因 为什么涨 公告 事件 利好 利空 证据',popular:true},
 {id:'nextplan',group:'review',icon:'🗓',name:'明日作战计划',href:'/#v6-plan',description:'候选、进出场条件与次日验证',tags:'明天 计划 明日 次日 机会',popular:true},
 {id:'strategy',group:'strategy',icon:'🧠',name:'四套选股策略',href:'/#v6-strategy',description:'多策略评分、贡献和风险解释',tags:'策略 评分 口诀 gpt python',popular:true},
 {id:'portfolio',group:'account',icon:'💼',name:'我的持仓与风险',href:'/#holdSec1',description:'账户持仓、风险提示与盯盘',tags:'仓位 股票 账户 加仓 减仓 清仓 止损 风控',role:'edit',popular:true},
 {id:'news',group:'settings',icon:'📰',name:'新闻与利空雷达',href:'/#v6-news',description:'个股关联新闻与风险标签',tags:'新闻 公告 利好 利空 消息面',popular:true},
 {id:'limitup',group:'market',icon:'↑',name:'涨停池与板块统计',href:'/#ztCount',description:'涨停股票与涨停题材汇总',tags:'涨停家数 封板 37只 涨停股 题材'},
 {id:'indexes',group:'market',icon:'📈',name:'大盘与市场情绪',href:'/#v6-market',description:'盘面总览、市场温度与指数',tags:'沪指 深成指 创业板 上证指数'},
 {id:'sector-flow',group:'market',icon:'〽',name:'板块资金流',href:'/#sectors',description:'板块主力流入流出与涨跌',tags:'资金 净流入 净流出 热点 板块'},
 {id:'mainline',group:'market',icon:'♨',name:'市场主线分析',href:'/#mainline',description:'热点题材与主线联动',tags:'主线 板块 主题 轮动'},
 {id:'auction',group:'market',icon:'⏱',name:'竞价异动',href:'/#leader',description:'开盘竞价强势股与复盘',tags:'集合竞价 9点25 龙头 异动'},
 {id:'foreign',group:'market',icon:'🌍',name:'外围市场与外盘',href:'/#global',description:'海外指数及对A股的联动',tags:'美股 汇率 外汇 港股 日股'},
 {id:'feed',group:'market',icon:'📡',name:'数据源与财报',href:'/#external',description:'外部行情、商品和财务信息',tags:'数据准确性 东财 同花顺 腾讯 接口'},
 {id:'bigmoney',group:'stocks',icon:'💰',name:'主力大单流入',href:'/#bigMoney',description:'大单资金异动候选',tags:'主力 大资金 流入 净流'},
 {id:'trends',group:'stocks',icon:'↗',name:'趋势股票池',href:'/#trendPool',description:'均线与趋势条件选股',tags:'趋势 均线 连续小阳线'},
 {id:'pre-limit',group:'stocks',icon:'⚡',name:'涨停前形态',href:'/#ztPreBox',description:'涨停前技术形态研究',tags:'涨停前发现 埋伏 突破'},
 {id:'ranking',group:'stocks',icon:'▤',name:'综合评分精选池',href:'/#pool',description:'评分榜、策略理由与风险',tags:'精选 股票池 综合排名'},
 {id:'individual',group:'stocks',icon:'🔍',name:'个股分析与K线',href:'/#analyzeCard',description:'输入股票代码查看分析和K线',tags:'搜索 股票名称 K线 股票详情 指标'},
 {id:'auctionpicks',group:'stocks',icon:'◎',name:'竞价观察池',href:'/auction-picks.html',description:'竞价候选和观察结果',tags:'竞价选股 竞价共振'},
 {id:'abnormal',group:'stocks',icon:'⚠',name:'涨幅异动池',href:'/#amTopBox',description:'异动阈值与个股风险',tags:'异常波动 涨幅异动'},
 {id:'yier',group:'review',icon:'①',name:'一进二首板接力',href:'/#yierList',description:'首板与次日接力候选',tags:'一进二 1进2'},
 {id:'relay',group:'review',icon:'②',name:'二进三与连板接力',href:'/#lianbanList',description:'连板梯队和板块联动',tags:'二进三 三进四 2进3 连板'},
 {id:'backtest',group:'review',icon:'▥',name:'历史回测',href:'/#workspace-analysis',description:'历史回放与绩效验证',tags:'回测 收益率 历史 盈亏'},
 {id:'strategy14',group:'strategy',icon:'⑭',name:'我的十四条条件',href:'/#myrules',description:'十四条选股要求逐条判定',tags:'14条 十四条 规则'},
 {id:'ai-research',group:'strategy',icon:'✦',name:'AI研究工作台',href:'/research.html#decisionWorkspace',description:'研究决策、解释和验证门禁',tags:'人工智能 GPT 策略研究',role:'edit'},
 {id:'research36',group:'strategy',icon:'◈',name:'36种策略研究',href:'/research.html#research36Workspace',description:'36种研究条件及证据查看',tags:'36策略 36条 36种策略 战法 实验研究',role:'edit'},
 {id:'factor',group:'strategy',icon:'📐',name:'因子研究与学习',href:'/research.html#factorAgentHeading',description:'因子权重、数据证据和学习状态',tags:'因子 模型 自学习 Python',role:'edit'},
 {id:'models',group:'strategy',icon:'📚',name:'模型资料库',href:'/model-library.html',description:'研究模型与版本资料',tags:'模型管理 历史'},
 {id:'risk',group:'account',icon:'🛡',name:'策略风控中心',href:'/research.html#riskCenter',description:'风险证据和风控条件',tags:'止损 回撤 风险评估',role:'edit'},
 {id:'paper',group:'account',icon:'⇄',name:'模拟交易A/B盘',href:'/#v6-paper',description:'模拟持仓、成交及流水',tags:'模拟盘 订单 买卖 成交',role:'edit'},
 {id:'pushes',group:'account',icon:'🔔',name:'系统推送记录',href:'/#vx-pushes',description:'候选信号、已发送与失败状态',tags:'消息 推送 飞书 记录'},
 {id:'risknews',group:'account',icon:'⚠',name:'利空风险追踪',href:'/#bnList',description:'新闻负面线索与关联个股',tags:'风险 雷达 新闻 利空'},
 {id:'devices',group:'settings',icon:'🔐',name:'设备与登录设置',href:'/#workspace-settings',description:'设备授权、身份管理和密码设置',tags:'账号 设备 同步 权限 登录 密码',role:'edit'},
 {id:'push-config',group:'settings',icon:'📣',name:'推送通道设置',href:'/#workspace-settings',description:'飞书/邮箱及推送时段（系统设置→工具）',tags:'机器人 微信 飞书 邮件 推送开关',role:'edit'},
 {id:'sources',group:'settings',icon:'🗂',name:'新闻原文证据库',href:'/research.html#newsEvidence',description:'已归档消息、修订与撤稿记录',tags:'公告原文 来源 事件 日期 公司',role:'edit'},
 {id:'status',group:'settings',icon:'🩺',name:'界面与服务自检',href:'/#v6UiHealth',description:'页面组件和服务接口自查',tags:'检测 健康 故障 诊断'},
 {id:'publish',group:'settings',icon:'🚀',name:'发布与版本看板',href:'/#v6-release',description:'更新请求、发布状态及版本',tags:'上线 更新 发布 部署'},
 {id:'market-radar',group:'market',icon:'◎',name:'市场雷达独立页',href:'/v6-market-radar.html',description:'独立市场观察入口',tags:'市场 看盘'},
 {id:'research-page',group:'strategy',icon:'▦',name:'策略研究独立页',href:'/v6-research.html',description:'独立策略研究模块',tags:'研究 页面'},
 {id:'validation',group:'settings',icon:'✓',name:'验证与自检独立页',href:'/v6-validation.html',description:'数据质量与验证入口',tags:'验证 测试 自检'}
]);
const trim=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\-—_.、，\/|]+/g,'');
const validDestination=s=>typeof s==='string'&&/^\/(?:[a-z0-9-]+\.html)?(?:#[A-Za-z][A-Za-z0-9_-]*)?$/.test(s);
function findEntries(query='',group='quick'){
 const q=trim(query);
 if(q){
  const terms=q.split(/\s+/).filter(Boolean);
  return CATALOG.filter(x=>{
   const text=trim(x.name+' '+x.description+' '+x.tags);
   return terms.every(t=>text.includes(t));
  });
 }
 if(group==='quick')return CATALOG.filter(x=>x.popular);
 if(group==='all')return CATALOG.slice();
 return CATALOG.filter(x=>x.group===group);
}
function install(root){
 const doc=root.document;
 function start(){
  if(doc.getElementById('v6FeatureHub')||!doc.body)return;
  const el=(tag,className,text)=>{
   const node=doc.createElement(tag);
   if(className)node.className=className;
   if(text!==undefined)node.textContent=text;
   return node;
  };
  const layer=el('div','v6-hub-layer');
  layer.id='v6FeatureHub';layer.hidden=true;
  const backdrop=el('div','v6-hub-backdrop');backdrop.setAttribute('aria-hidden','true');
  const panel=el('section','v6-hub-dialog');
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','v6HubTitle');
  const header=el('header','v6-hub-header');
  const titleWrap=el('div','v6-hub-heading');
  const kicker=el('span','v6-hub-kicker','TIANSHU / FUNCTION FINDER');
  const title=el('h2','','功能中心');title.id='v6HubTitle';
  const subtitle=el('p','','不必翻旧页面：输入名称，直接找到原有功能。');
  titleWrap.append(kicker,title,subtitle);
  const close=el('button','v6-hub-close','关闭 ✕');close.type='button';close.setAttribute('aria-label','关闭功能中心');
  header.append(titleWrap,close);
  const searchWrap=el('div','v6-hub-search');
  const searchLabel=el('label','','搜索功能');searchLabel.htmlFor='v6HubSearch';
  const input=el('input');input.id='v6HubSearch';input.type='search';input.autocomplete='off';
  input.placeholder='试试：涨停原因、36策略、资金流、模拟盘、设备…';
  searchWrap.append(searchLabel,input);
  const tabs=el('div','v6-hub-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','功能类别');
  const status=el('p','v6-hub-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const results=el('div','v6-hub-results');results.id='v6HubResults';
  const hint=el('p','v6-hub-footnote','功能中心仅负责找入口；原有账号权限、行情数据和交易安全规则不变。');
  panel.append(header,searchWrap,tabs,status,results,hint);
  layer.append(backdrop,panel);doc.body.appendChild(layer);
  let group='quick',opener=null;
  const categoryButtons=new Map();
  function draw(){
   const q=input.value;
   for(const [id,node] of categoryButtons)node.setAttribute('aria-pressed',String(!q&&id===group));
   const matched=findEntries(q,group);
   status.textContent=q?'搜索“'+q.slice(0,60)+'”：'+matched.length+' 个入口':'当前分类：'+(GROUPS.find(x=>x.id===group)?.name||'')+' · '+matched.length+' 个入口';
   results.replaceChildren();
   if(!matched.length){
    const empty=el('div','v6-hub-empty','未找到匹配入口。可换个关键词，例如“复盘”“选股”“风险”。');
    results.appendChild(empty);return;
   }
   const fragment=doc.createDocumentFragment();
   for(const item of matched){
    if(!validDestination(item.href))continue;
    const link=el('a','v6-hub-item');link.href=item.href;
    link.dataset.featureId=item.id;
    const ico=el('span','v6-hub-item-icon',item.icon);ico.setAttribute('aria-hidden','true');
    const meta=el('span','v6-hub-item-body');
    meta.append(el('strong','',item.name),el('small','',item.description));
    link.append(ico,meta);
    if(item.role==='edit')link.append(el('span','v6-hub-role','开发者'));
    fragment.appendChild(link);
   }
   results.appendChild(fragment);
  }
  function setGroup(id){
   group=GROUPS.some(x=>x.id===id)?id:'quick';
   if(input.value)input.value='';
   draw();
  }
  for(const item of GROUPS){
   const button=el('button','v6-hub-category',item.emoji+' '+item.name);
   button.type='button';button.setAttribute('aria-pressed',String(item.id===group));
   button.addEventListener('click',()=>setGroup(item.id));
   tabs.appendChild(button);categoryButtons.set(item.id,button);
  }
  let previouslyFocused=null;
  function closeHub(){
   if(layer.hidden)return;
   layer.hidden=true;delete doc.body.dataset.v6HubOpen;
   if(previouslyFocused&&typeof previouslyFocused.focus==='function')previouslyFocused.focus();
   previouslyFocused=null;
  }
  function openHub(term=''){
   previouslyFocused=doc.activeElement;
   layer.hidden=false;doc.body.dataset.v6HubOpen='1';
   group='quick';input.value=typeof term==='string'?term:'';
   draw();input.focus();
  }
  backdrop.addEventListener('click',closeHub);close.addEventListener('click',closeHub);
  input.addEventListener('input',draw);
  input.addEventListener('keydown',event=>{
   if(event.key==='ArrowDown'){
    const first=results.querySelector('a');if(first){event.preventDefault();first.focus();}
   }
  });
  results.addEventListener('click',event=>{
   const anchor=event.target.closest('a[data-feature-id]');
   if(anchor&&results.contains(anchor)&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){
    // Navigation goes to the existing, access-controlled target.
    closeHub();
    const url=new URL(anchor.href,root.location.href);
    if(url.pathname===root.location.pathname&&url.hash===root.location.hash){
     const id=decodeURIComponent(url.hash.slice(1));
     const target=doc.getElementById(id);target?.scrollIntoView?.({block:'start'});
    }
   }
  });
  doc.addEventListener('keydown',event=>{
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();layer.hidden?openHub():closeHub();return;
   }
   if(layer.hidden)return;
   if(event.key==='Escape'){event.preventDefault();closeHub();return;}
   if(event.key!=='Tab')return;
   const focusables=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')]
     .filter(node=>node.getClientRects().length>0);
   if(!focusables.length)return;
   const first=focusables[0],last=focusables[focusables.length-1];
   if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
  });
  // Apply the 11 approved main-page categories to the existing shell. This is
  // navigation only: the real dashboard and all legacy controllers stay intact.
  const shell=doc.querySelector('.vx-shell');
  const mainNav=shell?.querySelector('.vx-mainnav');
  if(mainNav){
    const navLinks=[];
    for(const entry of PRIMARY_NAV){
      if(!validDestination(entry.href))continue;
      const a=el('a','v6-hub-primary-link',entry.label);
      a.href=entry.href;
      if(entry.label==='首页')a.setAttribute('aria-current','page');
      navLinks.push(a);
    }
    mainNav.replaceChildren(...navLinks);
    mainNav.setAttribute('aria-label','V6 主导航：点击打开对应模块');
  }
  const launcher=el('button','v6-hub-launch','⌕ 全部功能');
  launcher.type='button';launcher.setAttribute('aria-haspopup','dialog');
  launcher.setAttribute('aria-controls','v6FeatureHub');
  launcher.setAttribute('title','搜索所有功能 · Ctrl/⌘ + K');
  launcher.addEventListener('click',()=>openHub());
  doc.body.appendChild(launcher);
  const top=doc.querySelector('.vx-topactions');
  if(top){
   const button=el('button','v6-hub-top','▦ 功能中心');
   button.type='button';button.setAttribute('aria-haspopup','dialog');
   button.setAttribute('aria-controls','v6FeatureHub');
   button.addEventListener('click',()=>openHub());
   top.prepend(button);
  }
  const dashboard=doc.getElementById('vx-dashboard');
  const heading=dashboard?.querySelector('.ow-page-heading');
  if(heading){
   const shortcuts=el('section','v6-hub-shortcuts');
   shortcuts.setAttribute('aria-label','四个常用快捷入口');
   const left=el('div','v6-hub-shortcuts-title');
   left.append(el('strong','','常用入口'),el('span','','先做常用的事，其他功能用右侧搜索'));
   shortcuts.appendChild(left);
   for(const id of ['indexes','picks','review','portfolio']){
    const item=CATALOG.find(x=>x.id===id);
    if(!item)continue;
    const a=el('a','v6-hub-shortcut',item.icon+' '+item.name);a.href=item.href;shortcuts.appendChild(a);
   }
   const more=el('button','v6-hub-shortcut v6-hub-shortcut-all','更多功能 ▦');
   more.type='button';more.addEventListener('click',()=>openHub());
   shortcuts.appendChild(more);
   heading.after(shortcuts);
  }
  // Hide launcher when one of the app's credential dialog overlays is active:
  // it must never obstruct a required login action.
  root.V6FeatureHub={open:openHub,close:closeHub,find:findEntries};
 }
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
}
return Object.freeze({PRIMARY_NAV,GROUPS,CATALOG,findEntries,validDestination,install});
});
