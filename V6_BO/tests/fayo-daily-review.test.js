'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public/nova'),url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const evidence=()=>import(url(fs.readFileSync(path.join(root,'market-evidence.js'),'utf8')));
const fixture=()=>({ztDay:'20261113',ztDayProbed:true,ztPool:Array.from({length:97},(_,i)=>({code:String(600000+i),name:'样本'+i,sector:i%2?'甲板块':'乙板块',limitUpCount:i%3+1,src:'em',tradeDate:'2026-11-13',sourceTradeDate:'2026-11-13',reason:'完整真实原因'+i,reasonTradeDate:'2026-11-13',reasonDateStatus:'matched',reasonSource:'合成已核对来源'})),review:{date:'20261113',items:[{code:'600000',reasonRaw:'同日归档原因',reasonTradeDate:'2026-11-13',reasonDateStatus:'matched',reasonSource:'归档来源',role:'leader'}]}});
test('daily review includes the complete deduplicated pool and all coded sector links',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.ztPool.push({...state.ztPool[0]});const result=dailyReviewEvidence(state);
 assert.equal(result.rows.length,97);assert.equal(result.sectors.reduce((n,x)=>n+x.count,0),97);assert.equal(result.rows[0].peers.length,48);assert.equal(result.rows[0].reason,'完整真实原因0');assert.equal(result.rows[0].role,'leader');assert.equal(result.day,'2026-11-13');
});
test('unknown and mismatched source days do not borrow raw reasons, roles or linked rows',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.review.date='20261112';state.ztPool[0].reasonTradeDate='2026-11-12';state.ztPool[1].reasonDateStatus='unknown';state.ztPool[2].sourceTradeDate='2026-11-12';
 const result=dailyReviewEvidence(state);assert.equal(result.rows[0].reason,null);assert.equal(result.rows[0].role,null);assert.equal(result.rows[1].reason,null);assert.equal(result.rows.length,97);assert.equal(result.rows[2].dateMatched,false);assert.equal(result.rows[2].peers.length,0);assert.equal(result.reviewMatched,false);
 const absent=dailyReviewEvidence({ztPool:[{code:'600001',reason:'无日期原因'}],review:{items:[{code:'600001',reasonRaw:'未知归档'}]}});assert.equal(absent.rows[0].reason,null);assert.equal(absent.day,null);
});
test('same-day archived evidence requires its own matched reason day and keeps every returned linkage without guessing codes',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();delete state.ztPool[0].reason;
 state.review.items[0].peers=Array.from({length:9},(_,i)=>({n:'关联'+i,lb:0,role:'mid',strong:true}));
 let row=dailyReviewEvidence(state).rows[0];assert.equal(row.reason,'同日归档原因');assert.equal(row.linkedRecords.length,9);assert.equal(row.linkedRecords[8].code,null);
 state.review.items[0].reasonDateStatus='unknown';row=dailyReviewEvidence(state).rows[0];assert.equal(row.reason,null);
});
test('readonly union includes ST and exposes independent 37 versus 38 source scopes and dates',async()=>{
 const {dailyReviewEvidence}=await evidence(),legacy=fixture(),rows=legacy.ztPool.slice(0,38);rows[37]={...rows[37],name:'ST合成样本',sectorTags:['甲板块','补充板块'],sources:['cls']};rows[0]={...rows[0],sectorTags:['乙板块','补充板块'],sources:['eastmoney','cls']};
 const meta={tradeDate:'2026-11-13',status:'ready',source:'eastmoney+cls',uniqueCount:38,intersectionCount:37,clsOnlyCount:1,eastmoneyOnlyCount:0,wholeMarketCertified:false,sources:[{source:'eastmoney',tradeDate:'2026-11-13',totalCount:37,fetchedCount:37,providerComplete:true,completenessScope:'provider-response-only',includesST:false},{source:'cls',tradeDate:'2026-11-13',totalCount:38,fetchedCount:38,providerComplete:true,completenessScope:'provider-response-only',includesST:true}]};
 const result=dailyReviewEvidence({...legacy,ztReviewPool:rows,ztReviewPoolMeta:meta});assert.equal(result.rows.length,38);assert.equal(result.rows[37].name,'ST合成样本');assert.equal(result.sourceEvidence.sources[0].totalCount,37);assert.equal(result.sourceEvidence.sources[1].totalCount,38);assert.equal(result.sectors.find(x=>x.name==='补充板块').count,2);assert.ok(result.rows[0].peers.some(x=>x.code===rows[37].code));assert.deepEqual(result.rows[0].sectorTags,['乙板块','补充板块']);
});
test('new readonly pool dates are independent of strategy dates, including missing meta, explicit empty and retained history',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();const row=state.ztPool[0];
 assert.equal(dailyReviewEvidence({...state,ztReviewPool:[row]}).day,null,'missing readonly metadata never borrows strategy day');
 assert.equal(dailyReviewEvidence({...state,ztReviewPool:[]}).rows.length,0,'explicit readonly empty does not silently resurrect strategy pool');
 const mixed=dailyReviewEvidence({...state,ztDay:'20261112',ztReviewPool:[row,{...state.ztPool[1],sourceTradeDate:'2026-11-12'}],ztReviewPoolMeta:{tradeDate:'2026-11-13',sources:[{source:'eastmoney',tradeDate:'2026-11-12',totalCount:37}]}});assert.equal(mixed.day,'2026-11-13');assert.equal(mixed.rows.length,1);assert.equal(mixed.excludedDateRows,1);assert.equal(mixed.sourceEvidence.sources[0].tradeDate,'2026-11-12');
 const retained=dailyReviewEvidence({...state,ztDay:'20261116',ztReviewPool:[row],ztReviewPoolMeta:{tradeDate:'2026-11-13',status:'retained',lastAttempt:{tradeDate:'2026-11-16'}}});assert.equal(retained.day,'2026-11-13');assert.equal(retained.rows[0].reasonDay,'2026-11-13');assert.equal(retained.sourceEvidence.status,'retained');assert.equal(dailyReviewEvidence(state).rows.length,97,'old services still use strategy pool');
});
test('held ST records preserve original reception/source fields and cannot look currently confirmed',async()=>{
 const {dailyReviewEvidence}=await evidence(),state=fixture();state.ztReviewPool=[{...state.ztPool[0],name:'ST保留样本',heldRecord:true,currentSourceConfirmed:false,heldSources:['cls'],sourceStatuses:{cls:'retained'},reasonSourceStatus:'retained',receivedAt:12345,sourceEventAt:12000}];state.ztReviewPoolMeta={tradeDate:'2026-11-13',retainedSources:['cls'],heldRecordCount:1};
 const row=dailyReviewEvidence(state).rows[0];assert.equal(row.heldRecord,true);assert.equal(row.currentSourceConfirmed,false);assert.deepEqual(row.heldSources,['cls']);assert.deepEqual(row.sourceStatuses,{cls:'retained'});assert.equal(row.reasonSourceStatus,'retained');assert.equal(row.receivedAt,12345);assert.equal(row.sourceEventAt,12000);
});
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.value='';this.hidden=false;this.dataset={};this._text='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}
 set textContent(v){this.children=[];this._text=String(v);}get textContent(){return this._text+this.children.map(x=>x.textContent??String(x)).join('');}
}
const descendants=node=>[node,...node.children.flatMap(x=>x instanceof Element?descendants(x):[])];
test('the rendered daily review exposes every one of 97 stocks through pages, search, sector filter and original drawer',async()=>{
 const saved={Node:global.Node,document:global.document};global.Node=Element;global.document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),createTextNode:text=>{const n=new Element('#text');n.textContent=text;return n;}};
 try{
  const e=url(fs.readFileSync(path.join(root,'market-evidence.js'),'utf8')),u=url(fs.readFileSync(path.join(root,'ui.js'),'utf8'));
  const source=fs.readFileSync(path.join(root,'market.js'),'utf8').replaceAll("'./market-evidence.js'",JSON.stringify(e)).replaceAll("'./ui.js'",JSON.stringify(u));const {renderDailyReview,renderPulse,renderMarket}=await import(url(source));let opened,navigation;
  const context={state:fixture(),selectStock:code=>opened=code,navigate:(...value)=>navigation=value,onState:()=>{}};
  const home=renderPulse({sub:'overview'},context);descendants(home).find(n=>n.tag==='button'&&n.textContent.includes('每日复盘')).events.click();assert.deepEqual(navigation,['pulse','review']);
  const route=renderMarket({sub:'review'},context);assert.match(route.textContent,/原复盘与历史学习/);assert.match(route.textContent,/可见复盘池 97/);
  let update;const view=renderDailyReview({state:fixture(),selectStock:code=>opened=code,onState:fn=>update=fn}),all=new Set();
  const expanded=descendants(view).find(n=>n.tag==='details');expanded.open=true;expanded.events.toggle({target:expanded});update();assert.equal(descendants(view).find(n=>n.tag==='details').open,true,'five-second snapshots preserve expanded evidence');
  for(let page=0;page<4;page++){
   for(const node of descendants(view).filter(n=>n.attrs['data-code']))all.add(node.attrs['data-code']);
   if(page<3)descendants(view).find(n=>n.tag==='button'&&n.textContent==='下一页').events.click();
  }
  assert.equal(all.size,97);assert.match(view.textContent,/97/);assert.match(view.textContent,/完整真实原因/);
  const search=descendants(view).find(n=>n.attrs.type==='search');search.value='600096';search.events.input();let cards=descendants(view).filter(n=>n.attrs['data-code']);assert.equal(cards.length,1);cards[0].events.click();assert.equal(opened,'600096');
  search.value='';search.events.input();const select=descendants(view).find(n=>n.tag==='select');select.value='甲板块';select.events.change();assert.match(view.textContent,/48/);assert.equal(descendants(view).filter(n=>n.attrs['data-code']).length,25);
  const union=fixture();union.ztReviewPool=union.ztPool.slice(0,38);union.ztReviewPool[0]={...union.ztReviewPool[0],sectorTags:['乙板块','补充板块']};union.ztReviewPool[37]={...union.ztReviewPool[37],name:'ST完整显示',sectorTags:['甲板块','补充板块']};
  union.ztReviewPoolMeta={tradeDate:'2026-11-13',uniqueCount:38,intersectionCount:37,eastmoneyOnlyCount:0,clsOnlyCount:1,sources:[{source:'eastmoney',tradeDate:'2026-11-13',totalCount:37,fetchedCount:37,providerComplete:true,includesST:false,completenessScope:'provider-response-only'},{source:'cls',tradeDate:'2026-11-13',totalCount:38,fetchedCount:38,providerComplete:true,includesST:true,completenessScope:'provider-response-only'}]};
  const complete=renderDailyReview({...context,state:union});assert.match(complete.textContent,/东方财富 · 来源日 2026-11-13 · 声明总量 37/);assert.match(complete.textContent,/财联社 · 来源日 2026-11-13 · 声明总量 38/);assert.match(complete.textContent,/未认证交易所全部股票/);
  const tags=descendants(complete).find(n=>n.tag==='select');tags.value='补充板块';tags.events.change();assert.equal(descendants(complete).filter(n=>n.attrs['data-code']).length,2);assert.match(complete.textContent,/ST完整显示/);assert.match(complete.textContent,/甲板块 \/ 补充板块/);
  union.ztReviewPool[37]={...union.ztReviewPool[37],heldRecord:true,currentSourceConfirmed:false,heldSources:['cls'],sourceStatuses:{cls:'retained'},reasonSourceStatus:'retained',receivedAt:Date.parse('2026-11-13T07:00:00Z'),sourceEventAt:Date.parse('2026-11-13T06:59:00Z')};union.ztReviewPoolMeta.sources[1].status='retained';union.ztReviewPoolMeta.retainedSources=['cls'];union.ztReviewPoolMeta.heldRecordCount=1;
  const held=renderDailyReview({...context,state:union});const heldSearch=descendants(held).find(n=>n.attrs.type==='search');heldSearch.value='ST完整显示';heldSearch.events.input();assert.match(held.textContent,/保留旧来源证据，本次未确认/);assert.match(held.textContent,/不能据此断言当前仍封板/);assert.match(held.textContent,/行业与概念，分类口径未统一/);
  const clsParagraph=descendants(held).find(n=>n.tag==='p'&&n.textContent.startsWith('财联社 · 来源日'));assert.match(clsParagraph.textContent,/上次响应完整，本次来源失败保留/);assert.doesNotMatch(clsParagraph.textContent,/本次响应条数齐全/);assert.doesNotMatch(held.textContent,/provider-response-only/);
  union.ztReviewPoolMeta.status='retained';union.ztReviewPoolMeta.retentionReason='startup-not-verified';
  union.ztReviewPoolMeta.sources[1].retentionReason='startup-not-verified';
  const startup=renderDailyReview({...context,state:union});
  assert.match(startup.textContent,/本次启动尚未重新核验/);
  assert.doesNotMatch(startup.textContent,/本次来源失败/,'restoring a snapshot does not prove a provider attempt failed');
 }finally{global.Node=saved.Node;global.document=saved.document;}
});
