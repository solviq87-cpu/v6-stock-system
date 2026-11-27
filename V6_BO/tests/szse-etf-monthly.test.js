'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {projectEtfMonthly,collectEtfMonthly,compareArchivedMonths} = require('../src/core/szse-etf-monthly');
const {appendBackgroundReceipt,readBackgroundOverview} = require('../src/core/market-data-evidence');
const march = {month:'2025-03',documentId:'W020250402560972808549.html'};
const april = {month:'2025-04',documentId:'W020250513504907210876.html'};

function table(scope,{amount='250.10',index='399006',symbol='159915',duplicate=false}={}) {
  const [y,m]=scope.month.split('-');
  const head=['代码 Code','基金名称 ETFs','当前规模 Fund Size','单位净值 NAV','目标指数 Underlying Index'].map(x=>'<th>'+x+'</th>').join('');
  const sub=['最高价 High','最低价 Low','成交量 Volume','成交金额 Turnover','拟合误差 Error%',null,'最高价 High','最低价 Low','收市价 Close','升跌幅 ±%','成交量 Volume','成交金额 Turnover','拟合误差 Error%'];
  const data=[symbol,'测试基金','87654','1.0',index,'10','8','123','900','2',null,'9','8','8.5','0','75',amount,'0'];
  const row='<tr>'+data.map((v,i)=>v===null?'<td class="separator"/>':'<td class="c'+(i<10?i+1:i-1)+'">'+v+'</td>').join('')+'</tr>';
  return Buffer.from('<table><caption>ETF证券成交统计 TRADING SUMMARY OF EXCHANGE TRADED FUNDS - （'+y+'.'+m+'） 成交金额单位：万元 10,000</caption>'+
    '<tr>'+head+'<th colspan="5">'+y+'年1月- '+Number(m)+'月 YTD</th><th/><th colspan="7">'+y+'年'+Number(m)+'月 Month</th></tr>'+
    '<tr>'+sub.map(s=>s===null?'<th/>':'<th>'+s+'</th>').join('')+'</tr>'+row+(duplicate?row:'')+'</table>');
}
const at = Date.parse('2025-06-01T10:00:00Z');
test('同一月报中只取当月成交额，零值与缺失分开，规模和成交量不能确定净申购或主体',()=>{
  const r=projectEtfMonthly(table(march),march,at);
  assert.deepEqual(r.rows,[{symbol:'159915',name:'测试基金',trackingIndex:'399006',monthlyTurnoverWanCny:250.1}]);
  assert.equal(r.buyerIdentity,null);assert.equal(r.netSubscriptions,null);assert.equal(r.quoteAt,null);
  for(const [s,n] of [['0',0],['--',null],['',null]])assert.equal(projectEtfMonthly(table(march,{amount:s}),march,at).rows[0].monthlyTurnoverWanCny,n);
});
test('字段、期间、单位、重复代码和截断表格拒绝投影',()=>{
 const raw=table(march).toString();
 for(const [a,b] of [['成交金额单位：万元','成交金额单位：元'],['成交金额 Turnover','价格 Price'],['colspan="7"','colspan="6"'],
   ['class="c15"','class="c14"'],['</table>',''],['2025年3月 Month','2025年4月 Month']]){
   assert.throws(()=>projectEtfMonthly(Buffer.from(raw.replace(a,b)),march,at));
 }
 assert.throws(()=>projectEtfMonthly(table(april),march,at));
 assert.throws(()=>projectEtfMonthly(table(march,{duplicate:true}),march,at));
 assert.throws(()=>projectEtfMonthly(table(march,{amount:'-50'}),march,at));
 assert.throws(()=>projectEtfMonthly(table(march),march,Date.parse('2025-03-30T12:00:00Z')));
});
test('公开文件采集仅允许固定发布目录、完整HTML字节和有界读取',async()=>{
 const call=(fetchImpl,scope=march)=>collectEtfMonthly({...scope,fetchImpl});
 const file=table(march);
 const r=await call(async(url,options)=>{
   assert.equal(url,'https://docs.static.szse.cn/www/market/periodical/month/'+march.documentId);
   assert.equal(options.redirect,'error');return new Response(file,{headers:{'content-type':'text/html'}});
 });
 assert.equal(r.rows.length,1);assert.equal(r.canTrade,false);
 await assert.rejects(call(()=>assert.fail(),{...march,documentId:'../wrong.html'}));
 for(const [status,type,bytes] of [[403,'text/html',file],[206,'text/html',file],[200,'application/json',file],[200,'text/html',Buffer.alloc(2097153)]]){
   await assert.rejects(call(async()=>new Response(bytes,{status,headers:{'content-type':type}})));
 }
});
test('原档案按可知时点回放，比较相邻月，异常分母、跟踪变更、原文损坏返回未知或拒绝',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-etf-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let seq=0;
 function add(scope,opts,byteBasis='response-body'){
   const observedAt=at+seq++;
   return appendBackgroundReceipt({root,provider:'szse-fund',scope,raw:table(scope,opts),byteBasis,observedAt,requestStartedAt:observedAt-2});
 }
 const cmp=(overrides={})=>compareArchivedMonths({root,symbol:'159915',earlier:march,later:april,decisionAt:Date.now(),...overrides});
 assert.throws(()=>add(march,{},'decoded-body-text'));
 const first=add(march,{amount:'100'});add(april,{amount:'125'});
 assert.equal(cmp().turnoverRatio,1.25);assert.equal(cmp().intradayAnomaly,null);
 assert.equal(cmp({decisionAt:first.recordedAt-1}).turnoverRatio,null);
 assert.equal(cmp({symbol:'159919'}).status,'unknown');assert.equal(cmp({earlier:april,later:march}).status,'unknown');
 add(march,{amount:'0'});assert.equal(cmp().turnoverRatio,null);
 add(march,{amount:'100',index:'000300'});assert.equal(cmp().turnoverRatio,null);
 const overview=readBackgroundOverview({root});assert.equal(overview.totalScopes,2);assert.equal(overview.rows[0].sourceTimePrecision,'report-month');
 assert.equal(overview.rows[0].sourcePublishedAt,null);assert.equal(overview.rows[0].buyerIdentity,null);
 assert.equal(first.data.upstreamGroup,'szse');assert.equal(first.data.sourceTimePrecision,'report-month');
 fs.writeFileSync(path.join(root,'blobs',first.data.dataVersion+'.bin'),'damaged');
 assert.throws(()=>cmp());assert.equal(first.data.canTrade,false);
});
