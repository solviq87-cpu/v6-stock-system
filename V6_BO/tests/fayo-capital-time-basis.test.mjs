import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectNewsEvents} from '../public/nova/event-research.mjs';
const inputs=JSON.parse(fs.readFileSync(new URL('../../docs/validation/fayo-capital-activity-20261128/news-input.json',import.meta.url),'utf8'));
const t=Date.parse('2026-11-28T20:00:00+08:00');
const row=(e=inputs[1])=>({eventHash:'d'.repeat(64),sequence:1,recordedAt:t,evidence:structuredClone(e)});
const project=(e=inputs[1],extra={})=>projectNewsEvents([{...row(e),...extra}],t,t).rows[0];
test('历史减持材料落款、执行区间与本次接收分别保留，不取URL路径当发布日',()=>{
 const e=project(),p=e.capitalActivity;
 assert.equal(p.documentDate,'2025-11-12');assert.equal(p.documentDateStatus,'declared-date');
 assert.equal(p.executionPeriod.start,'2025-11-10');assert.equal(p.executionPeriod.end,'2025-11-12');assert.equal(p.executionPeriod.precision,'date-only');
 assert.equal(e.row.evidence.publishedAt,null);assert.equal(e.row.evidence.receivedAt,inputs[1].receivedAt);assert.equal(e.knownAt,t);
 assert.equal(p.sourceCompletion,'in-progress');assert.equal(p.actualMarketFlow,null);
});
test('回购落款与累计截止日不同，缺少起止区间时不补全',()=>{
 const e=project(inputs[0]),p=e.capitalActivity;
 assert.equal(p.documentDate,'2026-11-11');assert.equal(p.reportedThrough,'2026-11-10');assert.equal(p.executionPeriod,null);assert.equal(p.executionPeriodStatus,'unknown');
 assert.equal(e.row.evidence.publishedAt,null);assert.equal(p.status,'source-claims');
});
test('缺少明确文件日期时不从接收、URL、已有发布时间或其他日期推断',()=>{
 const input={...inputs[0],body:'证券代码：003025\n回购计划资金不超过人民币100万元。',publishedAt:inputs[0].receivedAt-1000};
 const e=project(input);assert.equal(e.capitalActivity.documentDate,null);assert.equal(e.capitalActivity.documentDateStatus,'unknown');assert.equal(e.row.evidence.publishedAt,input.publishedAt);
});
test('非法、冲突或未来材料日期要求复核，不能滚动到下一月或取最后一个',()=>{
 for(const date of ['2025年2月30日','2026年11月29日','2025年11月12日\n文件落款日期：2025年11月13日']){
  const p=project({...inputs[1],body:inputs[1].body.replace('文件落款日期：2025年11月12日','文件落款日期：'+date)}).capitalActivity;
  assert.equal(p.documentDate,null);assert.equal(p.documentDateStatus,'conflict');assert.equal(p.status,'manual-review');
 }
});
test('执行区间倒置、非法、未来或晚于材料日期时不形成有效区间',()=>{
 for(const range of ['2025年11月12日至2025年11月10日','2025年2月30日至2025年11月12日','2025年11月10日至2026年11月29日','2025年11月10日至2025年11月13日']){
  const p=project({...inputs[1],body:inputs[1].body.replace('2025年11月10日至2025年11月12日',range)}).capitalActivity;
  assert.equal(p.executionPeriod,null);assert.equal(p.executionPeriodStatus,'conflict');assert.equal(p.status,'manual-review');
 }
});
test('拟定计划窗口不是已披露执行区间',()=>{
 const p=project({...inputs[1],body:'证券代码：600050\n拟在2025年11月10日至2025年11月12日期间减持100股。'}).capitalActivity;
 assert.equal(p.executionPeriod,null);assert.equal(p.executionPeriodStatus,'unknown');assert.equal(p.periodIncrement,null);
 const approved=project({...inputs[0],body:'证券代码：003025\n在2025年11月10日至2025年11月12日期间，已通过董事会审议回购方案，涉及人民币100万元。'}).capitalActivity;
 assert.equal(approved.executionPeriod,null);assert.ok(approved.rows.every(x=>x.role!=='reported'));
});
test('多个不同执行区间不合并，重复同一区间可保留',()=>{
 const a=inputs[1],line='在2025年11月1日至2025年11月2日期间，已通过集中竞价方式减持100股。';
 let p=project({...a,body:a.body+'\n'+line}).capitalActivity;assert.equal(p.executionPeriod,null);assert.equal(p.executionPeriodStatus,'conflict');
 p=project({...a,body:a.body+'\n在2025年11月10日至2025年11月12日期间，已通过集中竞价方式减持10股。'}).capitalActivity;
 assert.equal(p.executionPeriod.start,'2025-11-10');assert.equal(p.executionPeriod.end,'2025-11-12');
});
test('历史日期可以展示但不能解除事件停用或授予交易时点资格',()=>{
 const p=project(inputs[1],{current:false}).capitalActivity;
 assert.equal(p.status,'inactive');assert.equal(p.documentDate,'2025-11-12');assert.equal(p.executionPeriod.precision,'date-only');
 for(const k of ['canTrade','canTrain','canNotify','canQualify','independentlyVerified'])assert.equal(p[k],false);
 assert.equal(p.actualMarketFlow,null);assert.equal(p.periodIncrement,null);
});
