'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../public/nova/market.js');
class El {
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.dataset={};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(key,value){this[key]=value;}
 contains(){return false;}
}
const text=el=>[el?.textContent||'',...(el?.children||[]).map(text)].join(' ');
const find=(el,predicate)=>predicate(el)?el:(el.children||[]).map(child=>find(child,predicate)).find(Boolean);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){global.Node=El;global.document={createElement:tag=>new El(tag),createElementNS:(_ns,tag)=>new El(tag),createTextNode:textContent=>Object.assign(new El('text'),{textContent})};}
function context(state,role='edit') {const controller=new AbortController(),calls=[],listeners=[];return {state,role,signal:controller.signal,calls,listeners,api:async url=>{calls.push(url);if(url.startsWith('/api/quant'))return {items:[],freezeUnavailable:true,note:'没有已保存的盘中卡片'};if(url.startsWith('/api/auction'))throw Error('源暂不可用');return {items:[]};},readPool:(_key,loader)=>loader(),refresh:async()=>{},navigate(){},selectStock(){},notify(){},onState:fn=>listeners.push(fn),controller};}
test('system picks refresh in place and keep the source result and display read times separate',async()=>{
 dom();const {renderOpportunities,systemPicks}=await api;
 const at=Date.parse('2026-11-17T08:00:00+08:00');
 const legacy={code:'600101',name:'合成旧候选',paths:['旧命中条件']};
 const old=systemPicks({pool:[legacy],dashboard:{snapshotDay:'20261117'},snapshotDay:'20261117'});
 assert.equal(old.snapshotDay,null);assert.equal(old.items[0].poolDay,undefined);assert.deepEqual(old.items[0].signals,['旧命中条件']);
 const ctx=context({isSnapshot:true,pool:[legacy],snapshotFieldDays:{candidatePool:'20261116'}});
 ctx.refresh=async()=>{
  ctx.lastRead=at;
  ctx.state={...ctx.state,dashboard:{rows:[{code:'600199',name:'刷新后新候选',quoteAt:at-1000,quoteSource:'fixture',score:99,signals:['新命中条件']}],snapshotDay:'20261117'}};
  for(const update of ctx.listeners)await update();
 };
 const view=renderOpportunities({sub:'ranked'},ctx);
 assert.match(text(view),/合成旧候选/);
 assert.match(text(view),/原始交易日 2026-11-16/);
 await find(view,el=>el?.tag==='button'&&text(el).trim()==='刷新结果').listeners.click();
 assert.match(text(view),/刷新后新候选/);assert.match(text(view),/新命中条件/);
 assert.match(text(view),/最近读取 2026\/11\/17/);assert.doesNotMatch(text(view),/合成旧候选/);
 assert.deepEqual(ctx.calls,[],'the view does not request source scans');
 ctx.controller.abort();
});
test('default home exposes each index original timestamp and single-source status',async()=>{
 dom();const {renderAllOpportunities}=await api;
 const ctx=context({dashboard:{indices:[{code:'1.000001',price:3584.58,pct:-.5,quoteAt:Date.parse('2026-11-17T15:00:00+08:00'),quoteSource:'tencent-index'}]}});
 const view=renderAllOpportunities(ctx);assert.match(text(view),/3,584.58/);assert.match(text(view),/tencent-index/);assert.match(text(view),/单源观测/);assert.match(text(view),/报价时点待核验/);
 ctx.state={dashboard:{indices:[{code:'1.000001',price:3580,quoteSource:'sina'}]}};ctx.listeners[0]();
 assert.doesNotMatch(text(view),/3,584.58|tencent-index/);assert.match(text(view),/报价时点待核验 · sina/);ctx.controller.abort();
});
test('aggregate unions pools, deduplicates without grafting quotes, keeps dates and evidence',async()=>{
 const {combinePoolResults}=await api,inputs=[{label:'量化',data:{snapshotDay:'2026-11-16',items:[{code:'600001',price:10,quoteAt:100,hit:['原条件'],mainInflow:null}]}},{label:'趋势',data:{snapshotDay:'2026-11-17',items:[{code:'600001',price:20,quoteAt:200,hit:['趋势条件']},{code:'000001',price:1}]}},{label:'缺时点',data:{items:[{code:'600001',price:999}]}},{label:'未来',data:{items:[{code:'600001',price:777,quoteAt:999}]}}];
 const before=JSON.stringify(inputs),out=combinePoolResults(inputs,500);assert.equal(out.length,2);assert.equal(out[0].price,20);assert.equal(out[0].quoteAt,200);assert.equal(out[0].poolDay,'2026-11-17');assert.equal(out[0].poolEvidence[0].row.mainInflow,null);assert.deepEqual(out[0].hit,['趋势条件']);assert.equal(out[0].poolLabels.length,4);assert.equal(JSON.stringify(inputs),before);
});
test('second-board card excludes higher boards and unknown levels, keeps its own date',async()=>{
 const {POOLS,poolStateResult}=await api;
 const result=poolStateResult(POOLS.find(p=>p[0]==='relay-second'),{snapshotDay:'20261117',lianbanAsOf:'2026-11-16',lianbanList:[{code:'600001',level:2,targetLevel:3},{code:'600002',level:3,targetLevel:4},{code:'600003'},{code:'600004',level:2,targetLevel:4}]});
 assert.deepEqual(result.items.map(x=>x.code),['600001']);assert.equal(result.snapshotDay,'2026-11-16');
});
test('default home paints existing candidates before slow APIs; failures do not erase them or request writes',async()=>{
 dom();const {renderPulse}=await api,ctx=context({pool:[{code:'600001',name:'已有候选',price:10,quoteAt:100}],dashboard:{rows:[{code:'000001',name:'首页候选'}]},snapshotDay:'20261116'});
 const view=renderPulse({sub:'overview'},ctx);assert.match(text(view),/已有候选/);assert.match(text(view),/今日复盘/);assert.match(text(view),/一进二/);assert.match(text(view),/二进三/);await tick();assert.match(text(view),/源暂不可用/);assert.match(text(view),/没有已保存的盘中卡片/);assert.match(text(view),/已有候选/);assert.ok(ctx.calls.every(url=>!url.includes('force=')&&!url.includes('/refresh')));
 const count=ctx.calls.length;ctx.listeners[0]();await tick();assert.equal(ctx.calls.length,count,'state polling reuses remote responses for 60 seconds');ctx.controller.abort();
});
test('viewer never requests private pools and cannot render private relay rows',async()=>{
 dom();const {renderAllOpportunities}=await api,ctx=context({yierList:[{code:'600999',name:'私密接力'}],lianbanList:[{code:'600998',name:'私密高板'}],pool:[{code:'600001',name:'公开候选'}]},'view');
 const view=renderAllOpportunities(ctx);await tick();assert.doesNotMatch(text(view),/私密接力|私密高板/);assert.match(text(view),/公开候选/);assert.ok(ctx.calls.every(url=>!/wash-trend|preseal|shortline/.test(url)));ctx.controller.abort();
});
test('daily market review uses market state and original day, never private execution endpoint',async()=>{
 dom();const {renderDailyReview}=await api,ctx=context({review:{date:'20260102',items:[{code:'600001',name:'历史复盘票'}]}});const view=renderDailyReview(ctx);assert.match(text(view),/最近复盘 · 2026-01-02/);assert.match(text(view),/今天的报告尚未返回/);assert.match(text(view),/历史复盘票/);assert.equal(ctx.calls.length,0);
 ctx.state={};ctx.listeners[0]();assert.match(text(view),/今日复盘尚未生成/);assert.doesNotMatch(text(view),/历史复盘票/);ctx.controller.abort();
});
test('more stocks and search do not require choosing strategy pools',async()=>{
 dom();const {renderAllOpportunities}=await api,ctx=context({pool:Array.from({length:30},(_,i)=>({code:String(600000+i),name:'测试候选'+i}))});const view=renderAllOpportunities(ctx);await tick();assert.doesNotMatch(text(view),/测试候选29/);
 const more=find(view,e=>e.tag==='button'&&String(e.textContent||'').startsWith('显示更多股票'));more.listeners.click();assert.match(text(view),/测试候选29/);
 const search=find(view,e=>e['aria-label']==='筛选全部候选');search.value='600029';search.listeners.input();assert.match(text(view),/测试候选29/);assert.doesNotMatch(text(view),/测试候选28/);ctx.controller.abort();
});
test('relay refresh selects only the pure strategy-card task and reports backend errors',async()=>{
 dom();const {renderOpportunities}=await api,ctx=context({lianbanAsOf:'20261116',lianbanList:[{code:'600002',name:'二板候选',level:2,targetLevel:3},{code:'600003',name:'高板候选',level:3,targetLevel:4}]}),calls=[];
 ctx.api=async(url,options)=>{calls.push({url,options});return {ok:true};};
 const view=renderOpportunities({sub:'relay-second'},ctx);assert.match(text(view),/二板候选/);assert.doesNotMatch(text(view),/高板候选/);assert.match(text(view),/2026-11-16/);
 const refresh=find(view,e=>e.tag==='button'&&text(e).trim()==='刷新二进三');await refresh.listeners.click();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/refresh');assert.deepEqual(calls[0].options.body,{module:'lianban'});ctx.controller.abort();
});
test('automatic live aggregation does not run the legacy wash scanner with notification side effects',async()=>{
 dom();const {renderAllOpportunities}=await api,ctx=context({trading:true});const view=renderAllOpportunities(ctx);await tick();assert.ok(ctx.calls.every(url=>!url.includes('wash-trend')));assert.match(text(view),/盘中自动汇总暂不读取此池/);ctx.controller.abort();
});
test('review summary separates board levels, deduplicates codes and does not double-count sector money',async()=>{
 const {summarizeReview}=await api;
 const result=summarizeReview({ztN:6,items:[{code:'600001',sector:'芯片',limitUpCount:1,sectorInflow:100,breakCount:0,aboveMa5:true,sealAmount:50},{code:'600002',sector:'芯片',limitUpCount:2,sectorInflow:100,breakCount:2,aboveMa5:false,sealAmount:100},{code:'600003',sector:'机械',limitUpCount:3,aboveMa5:null},{code:'600004',limitUpCount:null},{code:'600002',sector:'芯片',limitUpCount:2,sectorInflow:100,breakCount:2,aboveMa5:false,sealAmount:100}]});
 assert.equal(result.rows.length,4);assert.equal(result.reported,6);assert.equal(result.first,1);assert.equal(result.continued,2);assert.equal(result.unknownLevel,1);assert.equal(result.highest,3);assert.equal(result.groups[0].count,2);assert.equal(result.groups[0].name,'芯片');assert.equal(result.groups[0].netInflow,undefined);assert.equal(result.opened.length,1);assert.equal(result.belowMa.length,1);assert.equal(result.missingHistory.length,2);assert.equal(result.seals[0].code,'600002');
});
test('review exposes analysis sections, coverage mismatch and rejects stale relay as next-session candidates',async()=>{
 dom();const {renderDailyReview}=await api,ctx=context({snapshotDay:'20261116',review:{date:'20261117',ztN:10,items:[{code:'600001',name:'本日报告股票',sector:'芯片',limitUpCount:2,breakCount:1}]},yierAsOf:'20261116',yierList:[{code:'600999',name:'昨日接力不应混入'}]});
 const view=renderDailyReview(ctx),body=text(view);for(const title of ['市场概况','强势主线','连板梯队','封单与开板情况','风险线索','下一交易日观察重点'])assert.ok(body.includes(title),title);assert.match(body,/与明细 1 不一致/);assert.match(body,/未提供完整炸板池/);assert.match(body,/与本次复盘未确认一致/);assert.doesNotMatch(body,/昨日接力不应混入/);ctx.controller.abort();
});
test('review refresh keeps failed requests and unknown dates visibly distinct from a current report',async()=>{
 dom();const {renderDailyReview}=await api,ctx=context({review:{items:[]}});const view=renderDailyReview(ctx);assert.match(text(view),/报告缺少原始日期/);assert.match(text(view),/源数据未就绪/);assert.doesNotMatch(text(view),/最近复盘 · 1970/);ctx.controller.abort();
});
test('detailed relay shows all evidence and distinct ratio definitions without certifying model probability',async()=>{
 dom();const {detailedStockCard}=await api,ctx=context({}),view=detailedStockCard({code:'600001',name:'详细候选',role:'leader',level:2,targetLevel:3,sealRatio:1.19,sealStrength:4.02,turnover:3.4,breakCount:0,sealAmount:270000000,floatCap:6750000000,mainInflow:null,prob:63,fused:62,why:['依据甲','依据乙','依据丙','第四条完整依据'],poolDay:'20261117',sectorStrength:{theme:'芯片',score:70,grade:'强',sectorZT:16,maxLb:3}},ctx);
 const body=text(view);for(const value of ['龙头','2进3','119%','4.02%','第四条完整依据','主力净额','未知','同主线涨停 16','不等于经验证的胜率'])assert.ok(body.includes(value),value);
});
test('sector role cards keep server roles, strong non-limit tags and source date isolation',async()=>{
 dom();const {sectorRoleCards}=await api,ctx=context({}),state={ztDay:'20261117',ztBySector:[{sector:'芯片',count:3,stocks:[{name:'龙头甲',role:'leader',lb:3},{name:'中军乙',role:'mid',strong:true}]}]};
 const body=text(sectorRoleCards(state,'2026-11-17',ctx));assert.match(body,/龙头.*龙头甲/);assert.match(body,/中军.*中军乙.*题材强势/);assert.doesNotMatch(text(sectorRoleCards(state,'2026-11-18',ctx)),/龙头甲/);
});
test('next plans show reasons risks confirmation and applicability only for matching generation day',async()=>{
 dom();const {nextPlanCards}=await api,ctx=context({}),state={nextplan:{date:'20261117',applyDate:'20261118',plan:{picked:[{code:'600001',name:'计划甲',entry:[10,11],stop:9,target:12,reasons:['量价依据'],risks:['回落风险'],confirm:['量能确认'],invalid:['条件失效']}]}}};
 const body=text(nextPlanCards(state,'2026-11-17',ctx));for(const value of ['2026-11-18','10.00 ～ 11.00','量价依据','回落风险','量能确认','条件失效'])assert.ok(body.includes(value),value);assert.doesNotMatch(text(nextPlanCards(state,'2026-11-18',ctx)),/计划甲/);
});
test('review exposes exact same-batch missing names instead of silently calling 33 the total',async()=>{
 dom();const {renderDailyReview,reviewCoverage}=await api;
 const members=Array.from({length:37},(_,i)=>({code:String(600000+i),name:'覆盖样本'+i,src:'em'}));
 const review={date:'20261117',ztN:37,items:members.slice(0,33),poolMembers:members,poolEvidence:[{source:'em',tradeDate:'20261117',reportedCount:37,returnedCount:37,uniqueCount:37}]};
 const coverage=reviewCoverage(review);assert.equal(coverage.sourceIncomplete,false);assert.deepEqual(coverage.missing.map(x=>x.code),members.slice(33).map(x=>x.code));
 const ctx=context({review}),body=text(renderDailyReview(ctx));assert.match(body,/东财池统计 37 只/);assert.match(body,/本报告 33 只/);assert.match(body,/4 只未进入本报告/);for(const row of members.slice(33))assert.ok(body.includes(row.name));ctx.controller.abort();
});
test('partial upstream, old metadata and derived additions stay separate in coverage',async()=>{
 const {reviewCoverage}=await api;
 const review={date:'20261117',items:[{code:'600001'}],poolMembers:[{code:'600001',src:'em'},{code:'600002',src:'derive'}],poolEvidence:[{source:'em',tradeDate:'20261117',reportedCount:37,returnedCount:33,uniqueCount:33}]};
 assert.equal(reviewCoverage(review).sourceIncomplete,true);assert.equal(reviewCoverage(review).supplements[0].code,'600002');
 review.poolEvidence[0].tradeDate='20261116';assert.equal(reviewCoverage(review).source,null);
 assert.equal(reviewCoverage({items:review.items}).missing,null);
});
