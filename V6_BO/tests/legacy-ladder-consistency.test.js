'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyLimitLadder,rankLadderCandidates}=require('../src/strategy/limit-ladder-engine');
const {evaluatePlaybooks}=require('../src/strategy/research-playbook-engine');
function stock(){return {code:'000001',market:'main',sealQualityScore:90,auctionQualityScore:90,sectorHeatScore:90,promotionScore:90,bars:Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:10,high:10,low:10,close:10,volume:100000}))};}
function closeAt(bar,price){Object.assign(bar,{open:price,high:price,low:price,close:price});}
const play=(s,id)=>evaluatePlaybooks(s).playbooks.find(p=>p.id===id);
test('旧入口差一分钱不能计首板或进入首板战法候选',()=>{
 const s=stock();closeAt(s.bars.at(-1),10.99);
 assert.equal(classifyLimitLadder(s).streak,0);
 assert.equal(play(s,'first_board_quality').status,'not_matched');
 assert.equal(play(s,'first_to_second').status,'not_matched');
});
test('旧入口实际封在涨停价时仍进入首板及一进二候选',()=>{
 const s=stock();closeAt(s.bars.at(-1),11);
 assert.equal(classifyLimitLadder(s).stage,'首板');
 assert.equal(play(s,'first_board_quality').status,'candidate');
 assert.equal(play(s,'first_to_second').status,'candidate');
 assert.equal(play(s,'first_board_quality').autoTrade,false);
});
test('旧入口接近涨停的一天不能接入连续涨停计数',()=>{
 const s=stock();closeAt(s.bars.at(-2),10.99);closeAt(s.bars.at(-1),12.09);
 assert.equal(classifyLimitLadder(s).streak,1);
 assert.equal(play(s,'second_to_third').status,'not_matched');
});
test('旧入口除权首板沿用完整盘前证据及当日参考价',()=>{
 const s=stock(),b=s.bars.at(-1);closeAt(b,5.5);
 b.corporateAction={type:'cash-and-shares',source:'fixture',netCashPerShare:0,shareMultiplier:2,referenceClose:5,publishedAt:b.date+'T09:00:00+08:00',cashDate:b.date,sharesAvailableDate:b.date};
 assert.equal(classifyLimitLadder(s).streak,1);
 assert.equal(play(s,'first_board_quality').status,'candidate');
 b.corporateAction.publishedAt=b.date+'T10:00:00+08:00';
 assert.equal(classifyLimitLadder(s).eligible,false);
 assert.equal(play(s,'first_board_quality').status,'not_matched');
});
test('旧入口使用逐日ST及涨跌幅制度',()=>{
 const s=stock(),b=s.bars.at(-1);b.isST=true;closeAt(b,10.5);
 assert.equal(classifyLimitLadder(s).streak,1);
 b.isST=false;b.limitPct=20;closeAt(b,12);
 assert.equal(classifyLimitLadder(s).streak,1);
});
test('旧入口无效显式涨停价不产生首板候选',()=>{
 const s=stock(),b=s.bars.at(-1);closeAt(b,11);b.upperLimit=0;
 assert.equal(classifyLimitLadder(s).eligible,false);
 assert.equal(play(s,'first_board_quality').status,'not_matched');
});
test('旧入口批量梯队排序保留标的名称及风险顺序',()=>{
 const valid=stock(),blocked=stock();valid.name='正常样本';blocked.code='000002';blocked.isST=true;
 closeAt(valid.bars.at(-1),11);closeAt(blocked.bars.at(-1),10.5);
 const rows=rankLadderCandidates([blocked,valid]);
 assert.equal(rows[0].symbol,'000001');assert.equal(rows[0].name,'正常样本');assert.equal(rows[1].eligible,false);
});
