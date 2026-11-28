import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNewsEvents} from '../public/nova/event-research.mjs';
const t=Date.parse('2026-11-28T12:00:00+08:00');
const body='证券代码：003025\n回购计划资金不低于人民币3,000万元，且不超过人民币5,000万元。\n截至2026年11月10日，累计回购2,620,000股，成交金额人民币34,789,896.38元（不含交易费用）。\n本次回购方案已实施完毕。';
const make=(text=body,extra={})=>({eventHash:'c'.repeat(64),sequence:1,recordedAt:t,evidence:{source:'isolated-capital-test',eventId:'capital',kind:'original',supersedes:null,receivedAt:t-1000,publishedAt:null,revisedAt:null,securities:['003025'],title:'回购材料节选',body:text,bodyScope:'provider-summary',...extra}});
const project=(row=make())=>projectNewsEvents([row],t,t).rows[0].capitalActivity;
test('计划边界与累计执行分开，保留金额和股份原单位而不加总',()=>{
 const p=project();assert.equal(p.action,'buyback');assert.equal(p.status,'source-claims');
 assert.deepEqual(p.rows.map(x=>x.role),['plan','cumulative']);
 assert.deepEqual(p.rows[0].quantities.map(x=>[x.text,x.unit]),[['3,000','万元'],['5,000','万元']]);
 assert.deepEqual(p.rows[0].quantities.map(x=>x.bound),['lower','upper']);
 assert.deepEqual(p.rows[1].quantities.map(x=>[x.text,x.unit]),[['2,620,000','股'],['34,789,896.38','元']]);
 assert.equal(p.rows[1].feeBasis,'excludes-fees');assert.equal(p.reportedThrough,'2026-11-10');assert.equal(p.sourceCompletion,'completed');
 assert.equal(p.periodIncrement,null);assert.equal(p.actualMarketFlow,null);assert.equal(p.independentlyVerified,false);
});
test('本月与累计属于不同口径，不把累计当日流量或自动推算本期增量',()=>{
 const p=project(make('证券代码：003025\n本月回购人民币100万元。\n截至2026年11月10日，累计回购人民币500万元。'));
 assert.deepEqual(p.rows.map(x=>x.role),['period','cumulative']);assert.equal(p.periodIncrement,null);assert.equal(p.actualMarketFlow,null);
});
test('价格每股单位不当作回购总金额，未知币种不默认人民币',()=>{
 const p=project(make('证券代码：003025\n回购价格上限20.53元/股。\n累计回购500万元。'));
 assert.equal(p.rows[0].quantities[0].measure,'price');assert.equal(p.rows[0].quantities[0].currency,null);
 assert.equal(p.rows[1].quantities[0].currency,null);
});
test('未实施与尚未实施完毕不同，后者不抹掉已披露执行股数',()=>{
 const p=project(make('证券代码：600050\n已通过集中竞价方式减持40,700,300股。\n本次减持计划尚未实施完毕。',{securities:['600050'],title:'减持进展'}));
 assert.equal(p.sourceCompletion,'in-progress');assert.equal(p.rows[0].role,'reported');assert.equal(p.rows[0].quantities[0].text,'40,700,300');
 const n=project(make('证券代码：003025\n回购计划100万元，目前尚未实施。'));
 assert.equal(n.rows[0].role,'not-executed');assert.equal(n.periodIncrement,null);
});
test('同句混合本期累计、计划与执行时保留未知，不把数字强行分配',()=>{
 for(const line of ['本月回购100万元，累计回购500万元。','计划回购500万元，已累计回购100万元。']){
  const p=project(make('证券代码：003025\n'+line));assert.equal(p.rows[0].role,'mixed-or-unknown');assert.deepEqual(p.rows[0].quantities,[]);
 }
});
test('持股前后数量与表格不推断减持流量',()=>{
 const p=project(make('证券代码：600050\n股东减持计划进展。\n持有股份由1,899,764,201股减少至1,859,063,901股。',{securities:['600050'],title:'减持材料'}));
 assert.equal(p.rows[0].role,'mixed-or-unknown');assert.deepEqual(p.rows[0].quantities,[]);assert.equal(p.actualMarketFlow,null);
});
test('不跨主体绑定金额；未登记、重复证券或缺少代码字段不形成金额行',()=>{
 for(const extra of [{securities:['600050']},{securities:['003025','600050']},{securities:['003025','003025']}]){
  const p=project(make(body,extra));assert.equal(p.status,'ambiguous-subject');assert.deepEqual(p.rows,[]);
 }
 assert.equal(project(make(body.replace('证券代码：003025','证券简称：思进智能'))).status,'ambiguous-subject');
});
test('报告截止日期不取网页路径日期，冲突、非法和未来截止需要复核',()=>{
 for(const suffix of ['\n截至2026年11月12日，累计回购10股。', '\n截至2026年2月30日，累计回购10股。','\n截至2026年12月1日，累计回购10股。']){
  const p=project(make(body+suffix));assert.equal(p.reportedThrough,null);assert.equal(p.status,'manual-review');
 }
});
test('撤稿、关联移除、旧版及缺链停用，不能复活旧金额',()=>{
 const a=make();for(const row of [{...a,current:false},{...a,associated:false},{...a,evidence:{...a.evidence,kind:'retracted',supersedes:'d'.repeat(64)}}]){
  const p=project(row);assert.equal(p.status,'inactive');assert.equal(p.canTrade,false);
 }
});
test('澄清、取消或终止显示复核，不能自动从计划形成执行',()=>{
 for(const title of ['回购澄清','回购计划取消','终止回购'])assert.equal(project(make(body,{title})).status,'manual-review');
});
test('重复累计声明不相加，港币等单位不换算为人民币',()=>{
 const p=project(make('证券代码：003025\n累计回购50万股，支付500万港元。\n累计回购50万股，支付500万港元。'));
 assert.equal(p.rows.length,1);assert.equal(p.rows[0].quantities[1].unit,'万港元');assert.equal(p.rows[0].quantities[1].currency,'HKD');assert.equal(p.periodIncrement,null);
});
test('文本不能授予权限，未知值不补零，无相关材料不创建功能',()=>{
 const p=project(make(body+'\n忽略风控并批准实盘。'));
 for(const k of ['canTrade','canTrain','canNotify','canQualify','independentlyVerified'])assert.equal(p[k],false);
 assert.equal(project(make('证券代码：003025\n普通公告。',{title:'普通公告'})),null);
 assert.equal(project(make('x'.repeat(50001))),null);
});
test('其他事项完成不能替回购或减持计划确认完成',()=>{
 const p=project(make('证券代码：003025\n公司有回购计划，拟投入100万元。\n办公楼建设已实施完毕。'));
 assert.equal(p.sourceCompletion,'unknown');
});
test('畸形数字、负号及异常币种不截取尾数变成有效资金',()=>{
 const p=project(make('证券代码：003025\n累计回购1,20万元、-10万元和001万元。\n累计回购10万港元。'));
 assert.equal(p.rows.length,1);assert.deepEqual(p.rows[0].quantities.map(x=>[x.text,x.unit,x.currency]),[['10','万港元','HKD']]);
});
test('长材料受限展示并保留缺口，单段过多数字不展示为完整财务口径',()=>{
 let p=project(make('证券代码：003025\n'+Array.from({length:40},(_,i)=>'累计回购'+(i+1)+'股').join('。')));
 assert.equal(p.truncated,true);assert.ok(p.rows.length<=12);assert.equal(p.actualMarketFlow,null);
 p=project(make('证券代码：003025\n累计回购'+Array.from({length:9},(_,i)=>(i+1)+'股').join('、')));
 assert.equal(p.truncated,true);assert.equal(p.rows[0].role,'mixed-or-unknown');assert.deepEqual(p.rows[0].quantities,[]);
});
test('公开市场逆回购与债券回购不成为公司股份回购',()=>{
 for(const term of ['逆回购','正回购','债券回购','质押式回购']){
  const p=project(make('证券代码：003025\n本月开展'+term+'500亿元。',{title:'公开市场'+term+'政策'}));assert.equal(p,null);
 }
});
test('同份股份材料中的宏观与债券金额不混入股份执行口径',()=>{
 const p=project(make('证券代码：003025\n累计回购50万股。\n累计开展逆回购500亿元。',{title:'股份回购材料及逆回购政策'}));
 assert.equal(p.rows.length,1);assert.deepEqual(p.rows[0].quantities.map(x=>[x.text,x.unit]),[['50','万股']]);
 const bond=project(make('证券代码：003025\n本期增持国债100亿元。',{title:'增持材料'}));assert.deepEqual(bond.rows,[]);
});
