'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessNews,newsIsCurrent}=require('../src/core/news-sentiment');
const cases=[
 ['公司拟出售不超过610.36万股已回购股份','bad'],
 ['公司对已回购股份拟予出售','bad'],
 ['公司回购股份将予以出售注销','bad'],
 ['公司取消出售已回购股份','neutral'],
 ['公司拟回购不超过2亿元股份','good'],
 ['公司已完成回购，累计回购股份500万股','good'],
 ['子公司出售资产实现收益3000万元','neutral'],
 ['公司签订日常经营重大合同','good'],
 ['公司发布年度报告','neutral'],
 ['股东拟减持不超过3%公司股份','bad'],
 ['公司收到监管函','bad'],
 ['预计半年度净利润亏损','bad'],
 ['股东终止减持计划','neutral'],
 ['公司解除股份质押','neutral'],
 ['公司未被立案调查','neutral'],
 ['公司不存在债务违约','neutral'],
 ['公司未发生安全事故','neutral'],
 ['公司终止回购股份计划','bad'],
 ['公司暂停实施回购计划','bad'],
 ['公司取消重大资产重组','bad'],
 ['重组申请未获批','bad'],
 ['重组申请尚未获批','neutral'],
 ['公司不涉及重大资产重组','neutral'],
 ['公司暂无回购计划','neutral'],
 ['网传公司中标重大订单','neutral'],
 ['公司否认重组传闻','neutral'],
 ['公司否认被调查，但收到监管函','bad'],
 ['公司终止减持计划，因涉嫌违规被立案调查','bad'],
 ['公司解除质押，同时业绩预亏','bad'],
 ['公司回购股份，但预计全年亏损','bad'],
 ['公司亏损收窄','bad'],
 ['公司股价涨停创新高','neutral'],
 ['公司中标项目，股价涨停','good'],
 ['公司股东不排除减持可能','bad'],
 ['公司股东不会减持','neutral'],
 ['公司股份质押尚未解除','bad'],
 ['公司未解除质押','bad'],
 ['股东未终止减持计划','bad'],
 ['公司收到监管函并澄清重组传闻','bad']
];
for(const [title,type] of cases)test('context assessment: '+title,()=>{
 const r=assessNews(title,'');assert.equal(r.type,type,r.why);assert.equal(r.status,'heuristic');assert.ok(r.why);assert.equal(r.probability,undefined);
});
test('full provider body catches adverse events after the display excerpt and a contradictory denial',()=>{
 const r=assessNews('公司中标项目','一般项目进展。'.repeat(30)+'公司收到立案调查通知');
 assert.equal(r.type,'bad');assert.ok(r.matched.includes('立案'));
 assert.equal(assessNews('公司中标重大订单','公司表示相关中标传闻不属实').type,'neutral');
 assert.equal(assessNews('公司拟出售','已回购股份500万股').type,'good','a reversal cannot be invented across title and body');
});
test('invalid inputs are unknown and bounded; type reasoning is repeatable',()=>{
 for(const args of [[{},''],['title',null],['title','x'.repeat(50001)],['x'.repeat(1001),'']])assert.equal(assessNews(...args).status,'unknown');
 assert.deepEqual(assessNews('公司解除质押',''),assessNews('公司解除质押',''));
});
test('three China calendar days expire at midnight without reception-time substitution',()=>{
 const now=Date.parse('2026-11-13T00:00:00+08:00');
 for(const [value,expected] of [
  ['2026-11-11T00:00:00+08:00',true],['2026-11-10T23:59:59+08:00',false],
  ['2026-11-13T00:00:00+08:00',true],['2026-11-13T00:00:01+08:00',false]])
  assert.equal(newsIsCurrent(Date.parse(value),now),expected,value);
 for(const t of [null,undefined,0,NaN,Infinity,'2026-11-12'])assert.equal(newsIsCurrent(t,now),false);
 assert.equal(newsIsCurrent(Date.parse('2026-12-30T16:00:00Z'),Date.parse('2027-01-02T00:00:00+08:00')),true);
});
