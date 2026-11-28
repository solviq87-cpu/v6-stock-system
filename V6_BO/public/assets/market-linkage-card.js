(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.V6MarketLinkageCard=api;
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const states=new WeakMap(),list=x=>Array.isArray(x)?x:[],known=x=>typeof x==='number'&&Number.isFinite(x);
 const text=x=>x===null||x===undefined||x===''?'未知':String(x);
 const pct=x=>known(x)?(x>0?'+':'')+(x*100).toFixed(2)+'%':'未知';
 const points=x=>known(x)?(x>0?'+':'')+x.toFixed(2)+'点':'未知';
 const ratio=x=>known(x)?(x*100).toFixed(1)+'%':'未知';
 const roles={'relative-front':'当期相对前排','relative-middle':'当期相对中段','relative-back':'当期相对后排',unknown:'位置未知'};
 const reasons={'selected-event-not-available':'尚未选择可用的封存研究','invalid-frozen-linkage-evidence':'封存联动证据未通过身份与时间校验','benchmark-window-and-index-weights-unavailable':'缺少同窗基准与有效指数权重','board-stock-feed-comparability-unverified':'板块与个股来源可比性未验证','intraday-lead-follow-unavailable':'缺少分时先行与跟随证据','history-not-verified':'连续历史未核验','index-attribution-incomplete-or-unreconciled':'指数归因不完整或尚未对账','stock-board-membership-unavailable':'缺少个股实际板块成员证据','provider-evidence-not-authenticated':'来源证据未认证'};
 const identity=x=>JSON.stringify([...['provider','code','classificationVersion','category'].map(k=>x?.[k]??''),x?.membersHash??list(x?.members).map(m=>m.symbol).sort()]);
 const benchmarkKey=x=>JSON.stringify(['provider','code','methodologyVersion','returnBasis'].map(k=>x?.[k]??''));
 const time=x=>typeof x==='number'&&x>0?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):text(x);
 function clear(host,reset=false){if(!host)return;host.replaceChildren();host.hidden=true;if(reset)states.delete(host);}
 function render(host,data,options={}){
  if(!host)return;clear(host);const doc=host.ownerDocument;
  function node(tag,value,parent,cls){const e=doc.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;if(parent)parent.append(e);return e;}
  function line(parent,k,v){return node('p',k+'：'+text(v),parent);}
  function details(parent,title){const e=node('details',undefined,parent);node('summary',title,e);return e;}
  function signed(parent,value,formatter=pct){return node('span',formatter(value),parent,known(value)?value>0?'ml-up':value<0?'ml-down':'':'ml-muted');}
  function button(parent,value,fn){const b=node('button',value,parent);b.type='button';b.addEventListener('click',fn);return b;}
  host.classList.add('market-linkage');host.hidden=false;
  node('h3','大盘 → 板块 → 个股',host);node('span','封存研究',host,'ml-badge');
  if(!data||data.status==='unavailable'||!data.benchmark&&!list(data.boards).length){
   line(host,'联动证据',list(data?.unknownReasons).map(x=>reasons[x]||x).join('；')||'所选研究未封存同窗基准、板块成员与权重。');
   node('p','可在下方“研究复访与板块证据”保存板块，或通过“补充原生评估证据”导入同窗资料，再比较已存股票。缺失保持未知。',host,'ml-muted');return;
  }
  const benchmark={...data.benchmark,returnBasis:data.benchmark?.returnBasis||data.returnBasis},boards=list(data.boards).map(b=>({...b,provider:b.provider||data.classification?.provider||data.source,classificationVersion:b.classificationVersion||data.classification?.version})),scope=benchmarkKey(benchmark)+'|'+text(data.source)+'|'+text(data.asOf)+'|'+text(data.tradeDate)+'|'+JSON.stringify(data.window||{})+'|'+text(data.symbol)+'|'+text(data.sourceRunId);
  let state=states.get(host);if(!state||state.contextSymbol!==data.symbol){const initial=boards.find(b=>list(b.members).some(m=>m.symbol===data.symbol))||boards[0];state={scope,contextSymbol:data.symbol,board:initial?identity(initial):'',symbol:data.symbol||''};}
  else if(state.scope!==scope)state={scope,contextSymbol:data.symbol,board:'',symbol:'',changed:true};
  states.set(host,state);
  const top=node('div',undefined,host,'ml-context');
  node('strong',text(benchmark.name)+' '+text(benchmark.code),top);node('span','同窗 ',top);signed(top,benchmark.return);
  if(!known(benchmark.return)&&(known(benchmark.close)||known(benchmark.changePct)))line(top,'封存日行情',text(benchmark.close)+'点 / '+pct(known(benchmark.changePct)?benchmark.changePct/100:null)+'；日涨跌不用于同窗归因');
  line(top,'数据日 / 来源',text(data.tradeDate)+' / '+text(data.source||benchmark.provider));
  const metadata=details(top,'数据时点与口径');line(metadata,'观察窗口',time(data.window?.start)+' → '+time(data.window?.end));
  line(metadata,'快照时点 / 口径',time(data.asOf)+' / '+(({'price':'价格收益','unadjusted':'未复权价格','price-return':'价格收益','total-return':'全收益'})[benchmark.returnBasis]||'封存口径未知'));
  const grid=node('div',undefined,host,'ml-grid'),attribution=node('section',undefined,grid);
  node('h4','指数行业拉动 / 拖累',attribution);
  const a=data.attribution||{},industries=list(a.industries),positive=industries.filter(x=>known(x.contribution)&&x.contribution>0).sort((x,y)=>y.contribution-x.contribution),negative=industries.filter(x=>known(x.contribution)&&x.contribution<0).sort((x,y)=>x.contribution-y.contribution);
  if(!industries.length)node('p','缺少适用指数权重或同窗成分证据，无法计算行业贡献；板块涨幅不能代替贡献。',attribution,'ml-muted');
  for(const [title,items]of [['拉动',positive],['拖累',negative]]){
   const group=node('div',undefined,attribution,'ml-contributions');node('strong',title,group);
   for(const row of items.slice(0,3)){const p=node('p',text(row.name||row.code)+' ',group);signed(p,row.contribution,x=>known(x)?(x>0?'+':'')+(x*100).toFixed(2)+'个百分点':'未知');node('span',' / '+points(row.points),p);}
   if(industries.length&&!items.length)node('p','已知部分无'+title+'行业',group,'ml-muted');
  }
  if(industries.length){const proof=details(attribution,'权重覆盖与对账');line(proof,'适用权重覆盖',ratio(a.coverageWeight));line(proof,'对账残差',pct(a.residualReturn)+' / '+points(a.residualPoints));line(proof,'行业归属未知贡献',pct(a.unknownIndustryContribution));}
  if(a.status)line(attribution,'归因状态',({'partial-estimate':'部分估算',partial:'部分估算',unknown:'证据不足','method-compatible-unverified':'口径匹配的研究估算，来源未认证','research-estimate':'研究估算',available:'研究估算',unavailable:'证据不足'})[a.status]||'研究估算，未认证');
  const sector=node('section',undefined,grid);node('h4','板块同窗表现',sector);
  const label=node('label','选择实际成员板块',sector),select=node('select',undefined,label);select.setAttribute('aria-label','联动板块');
  const empty=node('option','请选择板块',select);empty.value='';
  for(const b of boards){const o=node('option',text(b.name)+' · '+(b.category==='concept'?'概念':'行业')+' · '+pct(b.relativeReturn)+' 相对基准',select);o.value=identity(b);}
  if(boards.some(b=>identity(b)===state.board))select.value=state.board;else{select.value='';if(state.board||state.changed)node('p','原板块与当前版本不可比，请重新选择。',sector,'ml-muted');}
  select.addEventListener('change',()=>{state.board=select.value;state.symbol='';drawSector();});
  const comparisons=boards.filter(b=>known(b.relativeReturn));
  if(comparisons.length>1){const quick=node('div',undefined,sector,'ml-board-comparison');node('p','本批板块相对表现',quick);
   for(const category of ['industry','concept'])for(const b of comparisons.filter(x=>x.category===category).sort((a,b)=>b.relativeReturn-a.relativeReturn).slice(0,3)){
    const choose=button(quick,(category==='industry'?'行业 · ':'概念 · ')+text(b.name)+' '+pct(b.relativeReturn),()=>{select.value=identity(b);state.board=select.value;state.symbol='';drawSector();});choose.dataset.linkageBoard=b.code;
   }
  }
  const count=x=>Number.isSafeInteger(x)&&x>=0;
  const share=x=>known(x)&&x>=0&&x<=1;
  const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
  const fiveDays=xs=>Array.isArray(xs)&&xs.length===5&&xs.every((d,i)=>day(d)&&(!i||d>xs[i-1]))&&xs[4]===data.tradeDate;
  const strengthLabels={'broad-relative-strength':'广泛相对强势','broad-relative-weakness':'广泛相对弱势',mixed:'强弱分化'};
  const main=data.mainlineComparison,eligible=boards.filter(b=>b.category==='industry');
  const compare=details(sector,'同一封存快照行业比较');
  const rows=list(main?.rows);
  const mainValid=main?.scope==='selected-snapshot-industries-only'&&main.canTrade===false&&main.canNotify===false&&fiveDays(main.dates)&&
   count(main.totalIndustries)&&main.totalIndustries===eligible.length&&count(main.eligibleIndustries)&&main.eligibleIndustries===rows.length&&rows.length<=eligible.length&&
   new Set(rows.map(r=>r?.code)).size===rows.length&&rows.every(r=>r&&eligible.some(b=>b.code===r.code&&b.trend?.structure?.status==='observed-unverified'&&b.trend.relativeReturn===r.relativeReturn&&b.trend.structure.role===r.role)&&known(r.relativeReturn)&&Object.hasOwn(strengthLabels,r.role)&&
    (rows.length>=2?r.rank===1+rows.filter(q=>q?.relativeReturn>r.relativeReturn).length:r.rank===null));
  if(mainValid&&['observed-unverified','insufficient-comparable-industries'].includes(main.status)&&((rows.length>=2)===(main.status==='observed-unverified'))){
   line(compare,'覆盖','可比行业 '+rows.length+' / '+main.totalIndustries+'；'+main.dates[0]+' 至 '+main.dates[4]);
   if(rows.length<2)node('p','可比行业不足，不排名。',compare,'ml-muted');
   else for(const r of rows)line(compare,'第 '+r.rank+' 名 · '+text(eligible.find(b=>b.code===r.code).name),pct(r.relativeReturn)+' 相对基准；'+strengthLabels[r.role]);
  }else node('p','五日行业比较证据不足。',compare,'ml-muted');
  node('p','仅所选快照中的行业，保留并列；非事前信号，不构成买卖建议。',compare,'ml-muted');
  function drawStructure(parent,b){
   const s=b.trend?.structure,rows=list(s?.daily);
   const proof=details(parent,'五日共同样本与群体迁移');
   const valid=s?.status==='observed-unverified'&&s.method==='five-session-common-cohort-v1'&&s.cohortBasis==='retrospective-common-coverage'&&s.canTrade===false&&s.canNotify===false&&
    Object.hasOwn(strengthLabels,s.role)&&count(s.memberCount)&&s.memberCount===b.memberCount&&count(s.commonObserved)&&s.commonObserved>=5&&s.commonObserved<=s.memberCount&&share(s.coverage)&&s.coverage>=.8&&Math.abs(s.coverage-s.commonObserved/s.memberCount)<1e-8&&fiveDays(rows.map(r=>r?.date))&&
    rows.every(r=>r&&[r.up,r.down,r.flat].every(count)&&r.up+r.down+r.flat===s.commonObserved&&known(r.boardReturn)&&known(r.benchmarkReturn))&&
    [s.broadUpSessions,s.broadDownSessions,s.outperformSessions,s.underperformSessions].every(x=>count(x)&&x<=5)&&s.broadUpSessions===rows.filter(r=>r.up>s.commonObserved/2).length&&s.broadDownSessions===rows.filter(r=>r.down>s.commonObserved/2).length&&s.outperformSessions===rows.filter(r=>r.boardReturn>r.benchmarkReturn).length&&s.underperformSessions===rows.filter(r=>r.boardReturn<r.benchmarkReturn).length;
   if(!valid){node('p','共同样本覆盖不足或证据不完整，五日结构未知。',proof,'ml-muted');return;}
   line(proof,'五日结构',strengthLabels[s.role]+'；共同有效成员 '+s.commonObserved+' / '+s.memberCount+'（'+ratio(s.coverage)+'）');
   line(proof,'延续性','多数上涨 '+s.broadUpSessions+' / 5日；多数下跌 '+s.broadDownSessions+' / 5日；跑赢基准 '+s.outperformSessions+' / 5日；跑输 '+s.underperformSessions+' / 5日');
   for(const r of rows)line(proof,r.date,'涨 '+r.up+' / 跌 '+r.down+' / 平 '+r.flat+'；板块 '+pct(r.boardReturn)+' / 基准 '+pct(r.benchmarkReturn));
   const m=s.migration,open=Date.parse(data.tradeDate+'T09:30:00+08:00');
   const migrationValid=m?.canTrade===false&&m.priorDate===rows[3].date&&m.currentDate===rows[4].date&&Number.isSafeInteger(m.priorAsOf)&&m.priorAsOf>=Date.parse(m.priorDate+'T15:00:00+08:00')&&Number.isSafeInteger(m.priorRecordedAt)&&m.priorRecordedAt>=m.priorAsOf&&m.priorRecordedAt<=open&&
    [m.priorFrontCount,m.currentFrontCount,m.retainedFront,m.enteredFront,m.leftFront].every(x=>count(x)&&x<=s.memberCount)&&m.priorFrontCount>0&&m.currentFrontCount>0&&m.priorFrontCount===m.retainedFront+m.leftFront&&m.currentFrontCount===m.retainedFront+m.enteredFront;
   if(migrationValid){line(proof,'前排迁移','保留 '+m.retainedFront+' · 新进入 '+m.enteredFront+' · 离开 '+m.leftFront);line(proof,'上日前排当日均值',pct(m.priorFrontCurrentMeanReturn)+' / 其他成员 '+pct(m.otherCurrentMeanReturn));line(proof,'上日封存时点',time(m.priorRecordedAt));}
   else node('p','前排迁移证据不足，未冻结的旧群体不回填。',proof,'ml-muted');
   const lag=s.leadLag;
   const lagRows=list(lag?.pairs);
   const directions=new Set([-1,0,1]);
   const lagValid=lag?.method==='fixed-one-session-breadth-vs-index-v1'&&lag.lagSessions===1&&lag.status==='descriptive-insufficient-sample'&&lag.outOfSampleVerified===false&&lag.leadingConfirmed===false&&lag.canTrade===false&&lag.canNotify===false&&lag.attempted===4&&lagRows.length===4&&
    lagRows.every((r,i)=>r&&r.signalDate===rows[i].date&&r.targetDate===rows[i+1].date&&((r.status==='unknown'&&r.lagMatch===null&&r.concurrentMatch===null)||
      (r.status==='observed-unverified'&&[r.priorBreadth,r.concurrentBreadth,r.targetIndexDirection].every(x=>directions.has(x))&&Number.isSafeInteger(r.signalRecordedAt)&&r.signalRecordedAt>=Date.parse(r.signalDate+'T15:00:00+08:00')&&r.signalRecordedAt<=Date.parse(r.targetDate+'T09:30:00+08:00')&&Number.isSafeInteger(r.targetRecordedAt)&&r.targetRecordedAt>=Date.parse(r.targetDate+'T15:00:00+08:00')&&
       (r.priorBreadth&&r.concurrentBreadth&&r.targetIndexDirection?r.lagMatch===(r.priorBreadth===r.targetIndexDirection)&&r.concurrentMatch===(r.concurrentBreadth===r.targetIndexDirection):r.lagMatch===null&&r.concurrentMatch===null))));
   const paired=lagRows.filter(r=>r&&typeof r.lagMatch==='boolean'&&typeof r.concurrentMatch==='boolean');
   if(lagValid&&lag.pairedEvaluated===paired.length&&lag.unknown===lagRows.filter(r=>r.status==='unknown').length&&lag.abstained===4-paired.length-lag.unknown&&lag.lagMatches===(paired.length?paired.filter(r=>r.lagMatch).length:null)&&lag.concurrentMatches===(paired.length?paired.filter(r=>r.concurrentMatch).length:null)){
    line(proof,'领先滞后研究','固定滞后1个交易日；有效配对 '+paired.length+' / 4；未知 '+lag.unknown+'；弃权 '+lag.abstained);
    if(paired.length)line(proof,'配对方向一致次数','滞后 '+lag.lagMatches+' / '+paired.length+'；同期 '+lag.concurrentMatches+' / '+paired.length);
   }else node('p','领先滞后研究：配对证据不足或未知。',proof,'ml-muted');
   node('p','同期冲击不等于领先；未验证样本外效果，不形成预测信号。',proof,'ml-muted');
   const early=s.earlyObservation,earlyClock=(at,d)=>{const i=rows.findIndex(r=>r.date===d),next=rows[i+1]?.date;return i>=0&&day(d)&&Number.isSafeInteger(at)&&at>=Date.parse(d+'T15:00:00+08:00')&&at<(next?Date.parse(next+'T09:30:00+08:00'):Date.parse(d+'T00:00:00+08:00')+86400000);};
   const earlyValid=early?.mode==='five-frozen-session-early-observation-v1'&&early.scope==='five-session-window-only'&&early.actualCatalystVerified===false&&early.forwardValueVerified===false&&early.canTrade===false&&early.canNotify===false;
   const firstIndex=rows.findIndex(r=>r.date===early?.firstDate),confirmedIndex=rows.findIndex(r=>r.date===early?.confirmedDate);
   const firstValid=earlyValid&&firstIndex>0&&earlyClock(early.firstObservedAt,early.firstDate);
   const confirmedValid=firstValid&&confirmedIndex===firstIndex+1&&earlyClock(early.confirmedAt,early.confirmedDate)&&early.confirmationDelayMs===early.confirmedAt-early.firstObservedAt&&early.confirmationDelayMs>0;
   const noConfirmation=early?.confirmedAt===null&&early.confirmedDate===null&&early.confirmationDelayMs===null;
   if(firstValid&&((early.status==='confirmed-within-window'&&confirmedValid&&early.invalidatedAt===null)||(early.status==='first-observation-only'&&noConfirmation&&early.invalidatedAt===null)||(early.status==='invalidated-observation'&&(confirmedValid||noConfirmation)&&Number.isSafeInteger(early.invalidatedAt)&&early.invalidatedAt>(early.confirmedAt??early.firstObservedAt)&&early.invalidatedAt<=Date.parse(data.tradeDate+'T00:00:00+08:00')+86400000))){
    line(proof,'五日内首次符合观察',early.firstDate+' · '+time(early.firstObservedAt));
    line(proof,'相邻交易日确认',confirmedValid?early.confirmedDate+' · 延迟 '+early.confirmationDelayMs+' 毫秒':'尚无确认');
    if(early.status==='invalidated-observation')line(proof,'后续失效观察',time(early.invalidatedAt));
   }else if(earlyValid&&early.status==='left-censored-existing-strength'&&early.firstObservedAt===null)node('p','窗口首日已有强势，首次发现时点未知。',proof,'ml-muted');
   else if(earlyValid&&early.status==='no-qualified-observation'&&early.firstObservedAt===null)node('p','该五日窗口未见符合条件的观察，不代表没有机会。',proof,'ml-muted');
   else node('p','五日首次观察证据不足或未知。',proof,'ml-muted');
   node('p','首次观察仅限封存窗口；未认证真实催化与前向收益。',proof,'ml-muted');

   node('p','共同样本为事后覆盖对照；群体迁移仅为描述性研究，非事前信号，不构成买卖建议。',proof,'ml-muted');
  }
  const detail=node('div',undefined,sector,'ml-sector-detail');
  function drawSector(){
   detail.replaceChildren();const b=boards.find(x=>identity(x)===select.value);if(!b){node('p',boards.length?'选择板块查看封存成员。':'未封存可比板块；不生成示例排名。',detail,'ml-muted');return;}
   const p=node('p','板块 ',detail);signed(p,b.return);node('span',' / 相对基准 ',p);signed(p,b.relativeReturn);
   const breadth=b.breadth||{};line(detail,'成员广度','涨 '+text(breadth.up)+' / 跌 '+text(breadth.down)+' / 平 '+text(breadth.flat)+' / 缺 '+text(breadth.missing)+'；覆盖 '+ratio(breadth.coverage));
   const boardProof=details(detail,'板块判定依据');line(boardProof,'前两只正涨幅集中度',ratio(b.concentration));
   const breadthKnown=known(breadth.coverage)&&breadth.coverage>=.8&&(breadth.up+breadth.down+breadth.flat)>=5;
   const participation= breadthKnown?breadth.up/(breadth.up+breadth.down+breadth.flat):null;
   const sectorState=!known(b.return)||!breadthKnown?'广度证据不足':b.return>0&&(participation<.5||b.concentration>=.7)?'集中上涨，扩散待确认':b.return>0&&participation>=.6?'上涨扩散':b.return<0&&participation<.4?'板块偏弱':'板块分化';
   const marketRelation=!known(b.return)||!known(benchmark.return)||!known(b.relativeReturn)?'同窗关系未知':b.return>0&&benchmark.return<0?'逆势上涨':b.return<0&&b.relativeReturn>0?'相对抗跌，板块仍下跌':b.return>0&&benchmark.return>0?'同向上涨':b.return<0&&benchmark.return<0?'同向下跌':'相对表现分化';
   line(detail,'板块状态',sectorState+'；'+marketRelation);
   if(b.trend?.status==='observed-unverified')line(boardProof,'连续5交易日',pct(b.trend.return)+' / 相对基准 '+pct(b.trend.relativeReturn));
   drawStructure(boardProof,b);
   line(boardProof,'成员身份',text(b.provider||data.source)+' / '+text(b.classificationVersion)+' / '+text(b.code));
   if(b.category==='concept')node('p','概念可重叠，不能加总为指数贡献。',detail,'ml-muted');
   const members=list(b.members),membersHost=node('div',undefined,detail,'ml-members');membersHost.setAttribute('aria-label','板块实际成员');
   if(!members.length){node('p','缺少封存成员明细，不能按名称猜归属。',membersHost,'ml-muted');return;}
   if(!members.some(m=>m.symbol===state.symbol))state.symbol=members.some(m=>m.symbol===data.symbol)?data.symbol:'';
   const stockHost=node('div',undefined,detail,'ml-stock');stockHost.setAttribute('aria-live','polite');
   for(const m of members){const btn=button(membersHost,text(m.name||m.symbol)+' ',()=>{state.symbol=m.symbol;drawStock();});signed(btn,m.return);btn.dataset.linkageSymbol=m.symbol;}
   function drawStock(){
    stockHost.replaceChildren();for(const btn of membersHost.children)btn.setAttribute('aria-pressed',String(btn.dataset.linkageSymbol===state.symbol));
    const member=members.find(m=>m.symbol===state.symbol);if(!member){node('p','选择成员查看同一快照的位置依据；查看研究需另点按钮。',stockHost,'ml-muted');return;}
    const s={...member,...(b.stock?.symbol===member.symbol?b.stock:{})};node('h4',text(member.name||member.symbol)+' · '+(roles[s.role]||'当期相对位置'),stockHost);
    const performance=node('p','个股 ',stockHost);signed(performance,s.return);node('span',' / 相对板块 ',performance);signed(performance,s.relativeReturn);
    const stockProof=details(stockHost,'个股判定依据');line(stockProof,'位置依据','第 '+text(s.rank)+' / '+text(s.sampleSize??members.filter(m=>known(m.return)).length)+' 个有效成员；数据日 '+text(data.tradeDate));
    line(stockProof,'成交角色',s.turnoverRole==='turnover-core'?'成交核心观察':'成交证据不足');
    const trend=s.trend;
    if(trend?.status==='observed-unverified'){
     const trendRole=({'persistent-front-candidate':'持续前排候选','relative-weak-observation':'相对弱势观察',mixed:'持续性分化'})[trend.role]||'持续性观察';
     line(stockHost,'5日位置',trendRole+'；相对板块 '+pct(trend.relativeReturn)+'；前排 '+text(trend.frontSessions)+' / 5个交易日');
    }else node('p','持续领先：尚缺连续5个可比交易日的封存证据。',stockHost,'ml-muted');
    const order={'observed-first':'最先观察到异动','tied-first':'并列最先观察到异动','observed-after':'随后观察到异动'}[s.leadFollow];
    if(order){line(stockHost,'分时顺序',order);line(stockProof,'顺序含义','仅描述观测先后，不认证带动或因果');if(s.activation)line(stockProof,'启动 / 确认 / 定义',time(s.activation.at)+' / '+time(s.activation.confirmedAt)+' / '+text(s.activation.definitionVersion));}
    else node('p','先行 / 跟随：分时证据不足。',stockHost,'ml-muted');
    const inspect=button(stockHost,'查看该股研究',()=>options.onInspect?.(member.symbol));inspect.disabled=!/^\d{6}$/.test(member.symbol||'')||typeof options.onInspect!=='function';inspect.dataset.workspaceSymbol=member.symbol;
   }
   drawStock();
  }
  drawSector();
  if(list(data.unknownReasons).length){const gaps=node('details',undefined,host);node('summary','证据缺口（'+data.unknownReasons.length+'）',gaps);for(const reason of data.unknownReasons)node('p',reason==='history-source-not-authenticated'?'已完成连续窗口比较，历史来源真实性未认证':reasons[reason]||text(reason),gaps,'ml-muted');}
 }
 return {render,clear,pct,points,ratio,identity,benchmarkKey};
});
