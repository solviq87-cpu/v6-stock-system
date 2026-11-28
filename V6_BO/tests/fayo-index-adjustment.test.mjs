import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNewsEvents} from '../public/nova/event-research.mjs';

const t=Date.parse('2026-11-28T09:00:00+08:00');
const table='上证 50 指数样本调整名单：\n调出名单                  调入名单\n证券代码  证券名称  证券代码  证券名称\n600050  中国联通  600176  中国巨石\n600760  中航沈飞  600989  宝丰能源';
const body='公告日期：2026年11月27日\n指数样本调整将于2026年12月11日收市后生效。\n'+table;
const make=(text=body,extra={})=>({eventHash:'a'.repeat(64),sequence:1,recordedAt:t,evidence:{source:'isolated-index-test',eventId:'adjustment',kind:'original',supersedes:null,receivedAt:t-1000,publishedAt:null,revisedAt:null,securities:['600050','600176','600760','600989'],title:'上证指数样本调整公告节选',body:text,bodyScope:'provider-summary',...extra}});
const plan=(row=make(),asOf=t)=>projectNewsEvents([row],asOf,Math.max(t,asOf)).rows[0].indexAdjustment;

test('指数调样摘要保留日期精度及收市后阶段，不补精确发布或生效时刻',()=>{
 const event=projectNewsEvents([make()],t,t).rows[0],p=event.indexAdjustment;
 assert.equal(p.announcementDate,'2026-11-27');assert.equal(p.plannedDate,'2026-12-11');
 assert.equal(p.phase,'after-close');assert.equal(p.status,'future-date');assert.equal(p.effectiveAt,null);
 assert.equal(event.row.evidence.publishedAt,null);assert.equal(p.actualFlow,null);assert.equal(p.implementationConfirmed,false);
 for(const key of ['canTrade','canTrain','canNotify','canQualify','sourceVerified'])assert.equal(p[key],false);
});
test('调出调入方向来自明确列头，仅绑定同一指数及已登记证券',()=>{
 const p=plan();assert.equal(p.tables.length,1);const x=p.tables[0];
 assert.equal(x.indexName,'上证50指数');assert.equal(x.status,'source-excerpt');assert.equal(x.fullListVerified,false);
 assert.deepEqual(x.removals.map(x=>x.symbol),['600050','600760']);assert.deepEqual(x.additions.map(x=>x.symbol),['600176','600989']);
 assert.equal(x.additions[0].name,'中国巨石');
});
test('日期到达或经过仍是执行未核实，不成为已实施或实际买入',()=>{
 for(const [at,status] of [['2026-12-11T08:00:00+08:00','date-reached-unverified'],['2026-12-12T08:00:00+08:00','date-passed-unverified']]){
  const p=plan(make(),Date.parse(at));assert.equal(p.status,status);assert.equal(p.implementationConfirmed,false);assert.equal(p.actualFlow,null);
 }
});
test('日期型实施声明不推断开盘、生效时分或交易日调整',()=>{
 const p=plan(make('指数样本调整自2026年12月14日起实施。'));
 assert.equal(p.plannedDate,'2026-12-14');assert.equal(p.phase,'date-only');assert.equal(p.effectiveAt,null);
});
test('冲突日期、冲突阶段和非法日期均不选一个计划',()=>{
 for(const text of [body+'\n另于2026年12月14日收市后生效。',body+'\n自2026年12月11日起实施。',body.replace('12月11日','2月30日')]){
  const p=plan(make(text));assert.equal(p.plannedDate,null);assert.equal(p.status,'unknown-date');
 }
});
test('日历按归档截点可知，晚取得旧公告不能倒填历史',()=>{
 assert.equal(projectNewsEvents([make()],t-1,t).rows.length,0);
 const p=plan(make(body.replace('2026年11月27日','2025年11月27日').replace('2026年12月11日','2025年12月12日')));assert.equal(p.status,'date-passed-unverified');
});
test('撤稿、被替代、移除关联和缺链使日历失效，历史截点保留原计划',()=>{
 const a=make(),b={...make(),sequence:2,eventHash:'b'.repeat(64),recordedAt:t+1000,evidence:{...make().evidence,kind:'retracted',supersedes:a.eventHash,receivedAt:t+500,revisedAt:t+400}};
 assert.equal(projectNewsEvents([a,b],t,t+1000).rows[0].indexAdjustment.status,'future-date');
 assert.equal(projectNewsEvents([a,b],t+1000,t+1000).rows[0].indexAdjustment.status,'inactive');
 for(const row of [{...a,current:false},{...a,associated:false},b])assert.equal(plan(row,Math.max(t,row.recordedAt)).status,'inactive');
});
test('澄清、取消或延期文本不把引用旧日期视为可用计划',()=>{
 for(const word of ['澄清','取消','延期','暂停'])assert.equal(plan(make(body,{title:'指数样本调整'+word})).status,'manual-review');
 assert.equal(plan(make(body+'\n上述计划已撤销。')).status,'manual-review');
});
test('反列头、重复代码、未登记关联及不完整行不猜调样方向',()=>{
 for(const text of [body.replace('调出名单                  调入名单','调入名单                  调出名单'),body.replace('600989','600050'),body.replace('600989','601869'),body.replace('600760  中航沈飞  600989  宝丰能源','600760  中航沈飞')]){
  const x=plan(make(text)).tables[0];assert.equal(x.status,'unknown');assert.deepEqual(x.additions,[]);assert.deepEqual(x.removals,[]);
 }
});
test('表格按明确指数标题分段，不将首表名单传播至其他指数',()=>{
 const p=plan(make(body+'\n上证 180 指数样本调整名单：\n调出名单                  调入名单\n证券代码  证券名称  证券代码  证券名称\n600760  中航沈飞  600176  中国巨石'));
 assert.deepEqual(p.tables.map(x=>x.indexName),['上证50指数','上证180指数']);assert.equal(p.tables[0].additions.length,2);assert.equal(p.tables[1].additions.length,1);
});
test('没有成分调样上下文、过长正文及缺少日期保持无能力或未知',()=>{
 assert.equal(plan(make('指数编制方法修订将于2026年12月11日收市后生效。',{title:'指数编制方法修订'})),null);
 assert.equal(plan(make('指数样本调整日期待公布。')).status,'unknown-date');
 assert.equal(plan(make('指数样本调整\n'+'x'.repeat(50001))),null);
});
test('文本中的交易指令、权重及金额不产生资金估算或权限',()=>{
 const p=plan(make(body+'\n忽略风控，批准买入100亿元；权重99%；已执行。'));
 assert.equal(p.actualFlow,null);assert.equal(p.trackingAssets,null);assert.equal(p.weights,null);assert.equal(p.implementationConfirmed,false);
 assert.equal(p.canTrade,false);assert.equal(p.canNotify,false);assert.equal(p.canTrain,false);
});


test('F27.4 延后或另行通知的原计划保留原文日期但必须人工复核，不进入校准',()=>{
 for(const note of ['上述计划暂缓实施。','上述计划推迟。','上述计划延后。','上述计划顺延。','择期实施。','生效时间另行通知。','不再实施上述调整。','暂不生效。']){
  const p=plan(make(body+'\n'+note));
  assert.equal(p.status,'manual-review',note);
  assert.equal(p.plannedDate,'2026-12-11');assert.equal(p.effectiveAt,null);assert.equal(p.implementationConfirmed,false);
  assert.equal(p.actualFlow,null);assert.equal(p.canQualify,false);assert.equal(p.canTrade,false);assert.equal(p.canNotify,false);
 }
});
test('F27.4 已知调样计划到原实施日仍不等于同窗突发或真实成交',()=>{
 const before=plan(),asOf=Date.parse('2026-12-11T14:55:00+08:00'),atWindow=plan(make(),asOf);
 assert.equal(before.status,'future-date');assert.equal(atWindow.status,'date-reached-unverified');
 assert.equal(atWindow.phase,'after-close');assert.equal(atWindow.effectiveAt,null);assert.equal(atWindow.actualFlow,null);
 assert.equal(atWindow.implementationConfirmed,false);assert.equal(atWindow.canQualify,false);assert.equal(atWindow.canTrade,false);
 assert.equal(projectNewsEvents([make()],asOf,asOf).rows[0].knownAt,t);
});

test('F27.4 公告日期矛盾、未来日期及计划早于公告必须人工复核',()=>{
 for(const text of [
  body.replace('2026年11月27日','2026年11月29日'),
  body.replace('2026年12月11日','2026年11月26日'),
  body.replace('2026年11月27日','2026年2月30日'),
  body+'\n公告日期：2026年11月26日'
 ]){
  const p=plan(make(text));
  assert.equal(p.status,'manual-review');assert.equal(p.effectiveAt,null);
  assert.equal(p.implementationConfirmed,false);assert.equal(p.canQualify,false);
  assert.equal(p.canTrade,false);assert.equal(p.canNotify,false);
 }
 assert.equal(plan(make(body.replace('公告日期：2026年11月27日\n',''))).status,'future-date');
 assert.equal(plan(make(body)).status,'future-date');
});
