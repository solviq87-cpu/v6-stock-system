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

// Isolated dated OHLCV exercises both native aliases and their real consumers.
const researchLadder=require('../src/strategy/research-v2-limit-ladder-engine');
const researchPlaybooks=require('../src/strategy/research-v2-research-playbook-engine');
const ladderPlaybooks=['first_board_quality','first_to_second','second_to_third'];
test('股票级无限幅标记完整进入原入口、研究入口及两套战法',()=>{
 for(const key of ['noPriceLimit','ipoNoLimit']){
  const s=stock();s[key]=true;closeAt(s.bars.at(-1),11);
  for(const classify of [classifyLimitLadder,researchLadder.classifyLimitLadder]){
   const r=classify(s);assert.equal(r.eligible,false,key);assert.equal(r.stage,undefined);
   assert.match(r.reason,/无涨跌幅限制/);
  }
  for(const evaluate of [evaluatePlaybooks,researchPlaybooks.evaluatePlaybooks])
   for(const p of evaluate(s).playbooks.filter(p=>ladderPlaybooks.includes(p.id)))
    assert.notEqual(p.status,'candidate',key+' '+p.id);
 }
});
test('完整逐日普通制度可覆盖当前无限幅或未知限幅默认值',()=>{
 for(const defaults of [{noPriceLimit:true,ipoNoLimit:true},{limitPct:null},{limitPct:0}]){
  const s=Object.assign(stock(),defaults);
  for(const b of s.bars)Object.assign(b,{isST:false,noPriceLimit:false,ipoNoLimit:false,limitPct:10});
  closeAt(s.bars.at(-1),11);
  const r=classifyLimitLadder(s);assert.equal(r.eligible,true);assert.equal(r.stage,'首板');
  for(const evaluate of [evaluatePlaybooks,researchPlaybooks.evaluatePlaybooks])
   assert.equal(evaluate(s).playbooks.find(p=>p.id==='first_board_quality').status,'candidate');
 }
});
test('历史窗口内未知或无限幅日不能被当前普通制度洗白',()=>{
 for(const [key,value] of [['noPriceLimit',true],['ipoNoLimit',true],['limitPct',null]]){
  const s=stock();s.bars[10][key]=value;closeAt(s.bars.at(-1),11);
  const r=classifyLimitLadder(s);assert.equal(r.eligible,false);assert.equal(r.stage,undefined);
  assert.ok(r.reason);
 }
});
test('原扫描与研究扫描保留不适用原因且不产生相关战法候选',()=>{
 const now=Date.parse('2026-01-30T15:00:00+08:00');
 for(const moduleName of ['universe-scanner','research-v2-universe-scanner']){
  const s=stock();s.noPriceLimit=true;s.feed={source:'imported',timestamp:now};closeAt(s.bars.at(-1),11);
  const row=require('../src/strategy/'+moduleName).scanUniverse({stocks:[s],now}).items[0];
  assert.equal(row.quality.usable,true);assert.equal(row.ladder.eligible,false);
  assert.match(row.ladder.reason,/无涨跌幅限制/);assert.equal(row.ladder.stage,undefined);
  for(const p of row.strategy.playbookAnalysis.playbooks.filter(p=>ladderPlaybooks.includes(p.id)))
   assert.notEqual(p.status,'candidate',moduleName+' '+p.id);
 }
});
test('梯队研究按最后历史行判断ST且不解除原扫描风险保护',()=>{
 const s=stock();s.isST=true;for(const b of s.bars)b.isST=false;closeAt(s.bars.at(-1),11);
 const before=structuredClone(s),r=classifyLimitLadder(s);
 assert.equal(r.eligible,true);assert.equal(r.stage,'首板');assert.equal(r.autoTrade,false);
 const now=Date.parse('2026-01-30T15:00:00+08:00');
 const row=require('../src/strategy/universe-scanner').scanUniverse({stocks:[{...s,feed:{source:'imported',timestamp:now}}],now}).items[0];
 assert.equal(row.blockedBySafety,true);assert.equal(row.tradable,false);
 assert.deepEqual(s,before);
});
