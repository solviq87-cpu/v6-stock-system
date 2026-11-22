'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../public/nova/shortline/catalog.json');
const modules=Promise.all([import('../public/nova/shortline/settings.mjs'),import('../public/nova/shortline/market.mjs'),import('../public/nova/shortline/recognize.mjs')]);
test('人工预设有生效时点；备份恢复只变更配置并保留命名预设',async()=>{
 const [{settingsAction,settingsAt,settingsBackup}]=await modules;
 const sample=[{code:'600001',legacy:true}],s={catalog,trades:sample,candidates:[],versions:[]};
 assert.equal(settingsAt(s,1).decayEnabled,false);
 const r=settingsAction(s,'settings:preset',{preset:'conservative'});
 const at=Date.parse(r.effectiveAt);
 assert.equal(settingsAt(s,at-1).version,0);assert.equal(settingsAt(s,at).maxPosition,10);
 const current=settingsBackup(s).config;current.blockedStocks=['600002'];current.blockedFactors=['1:0'];current.customTags=['回踩确认'];current.dailyReviewTime='15:36';
 settingsAction(s,'settings:save',{config:current});settingsAction(s,'settings:profile-save',{name:'保守组合'});
 settingsAction(s,'settings:preset',{preset:'aggressive'});assert.equal(settingsAt(s).maxPosition,20);
 const pack=settingsBackup(s);assert.deepEqual(Object.keys(pack).sort(),['config','profiles','schema']);assert.equal(pack.profiles.length,1);
 const dest={catalog,trades:sample,candidates:[{id:'unapproved'}],versions:[]};
 settingsAction(dest,'settings:restore',{backup:JSON.parse(JSON.stringify(pack))});
 settingsAction(dest,'settings:profile-apply',{name:'保守组合'});
 assert.equal(settingsAt(dest).maxPosition,10);assert.deepEqual(settingsAt(dest).customTags,['回踩确认']);assert.equal(settingsAt(dest).dailyReviewTime,'15:36');
 assert.equal(dest.trades,sample);assert.deepEqual(dest.candidates,[{id:'unapproved'}]);assert.deepEqual(dest.versions,[]);
});
test('无效数值、字段、标签、提醒时间及伪造历史恢复均拒绝且无部分写入',async()=>{
 const [{settingsAction,settingsBackup}]=await modules;
 const s={catalog};const base=settingsBackup(s);
 for(const patch of [{turnoverMin:19,turnoverMax:18},{maxPosition:21},{minAssist:'2'},{decayEnabled:null},{blockedFactors:['1:99']},
     {mutedAlertTypes:['x']},{customTags:['x','x']},{blockedStocks:['90000']},{dailyReviewTime:'14:59'},{dailyReviewTime:'99:59'},
     {trades:[]},{approvedAt:'2000-01-01'},{blockedSectors:Array.from({length:41},(_,i)=>'题材'+i)}]){
   assert.throws(()=>settingsAction(s,'settings:restore',{backup:{...base,config:{...base.config,...patch}}}));assert.equal(s.settingsHistory,undefined);
 }
 assert.throws(()=>settingsAction(s,'settings:restore',{backup:{...base,profiles:[{name:'x',config:{}}]}}));assert.equal(s.settingsProfiles,undefined);
 assert.throws(()=>settingsAction(s,'settings:preset',{preset:'aggressive',effectiveAt:'2000-01-01'}));
});
test('名单与三类特殊标的严格遵守证据可知时间，分类静默保留硬性风控',async()=>{
 const [{settingsAt,blacklistReason}, {validate}]=await modules;
 const s={...settingsAt({}),blockedStocks:['600001'],blockedSectors:['机器人'],mutedAlertTypes:['risk']},date='2026-11-20',asOf=date+' 15:00';
 assert.match(blacklistReason(s,{code:'600001',asOf}),/黑名单/);assert.match(blacklistReason(s,{sector:'机器人',asOf}),/板块/);
 assert.equal(blacklistReason(s,{name:'*ST样本',date,knownAt:asOf,asOf}), '');
 assert.match(blacklistReason(s,{name:'*ST样本',nameKnownAt:asOf,asOf}),/ST风险/);
 for(const field of [{isST:true},{unlockPct30d:8},{regulationStatus:'重点监控'}]){
   assert.ok(blacklistReason(s,{...field,availableAt:asOf,asOf}));
   assert.equal(blacklistReason(s,{...field,availableAt:'2026-11-21 09:00',asOf}),'');
 }
 const {version,effectiveAt,...cfg}=s;
 const archive={catalog,market:[],trades:[],settingsHistory:[{effectiveAt:'2026-11-01T00:00:00Z',version:1,config:cfg}]};
 const r=validate(archive,{code:'600001',name:'测试',date,selected:[]},{skipPrediction:true});
 assert.equal(r.position,0);assert.equal(r.settingsVersion,1);assert.ok(r.risks.some(x=>x.includes('个股黑名单')));
});
test('日历风控仅使用相应窗口与可见资料，月底、季末、长假、披露分别可核对',async()=>{
 const [{settingsAt,calendarWarnings}]=await modules,s=settingsAt({});
 const d='2026-09-30',t=d+' 15:00',m={date:d,nextTradingDay:'2026-10-09',calendarKnownAt:'2025-12-22 16:00',calendarSource:'已发布交易日历'};
 assert.ok(calendarWarnings(s,m,d,t).some(x=>x.includes('季末')));assert.ok(calendarWarnings(s,m,d,t).some(x=>x.includes('长假')));
 assert.ok(!calendarWarnings(s,{...m,calendarKnownAt:'2026-10-02 12:00'},d,t).some(x=>x.includes('长假')));
 assert.deepEqual(calendarWarnings(s,{...m,knownAt:'2026-10-01 15:00'},d,t),[]);
 assert.ok(calendarWarnings(s,{date:'2026-10-12'},'2026-10-12','2026-10-12 15:00').some(x=>x.includes('披露月')));
 assert.ok(!calendarWarnings(s,{date:d},d,t,{reportDate:'2026-10-01',reportKnownAt:'2026-10-01 11:00',reportSource:'公告'}).some(x=>x.includes('已公告报告')));
});
test('切换阈值实际改变历史证据，低流动性风险不会被激进模式解除',async()=>{
 const [{settingsAction,settingsAt},,{inferEvidence}]=await modules;
 const state={catalog};settingsAction(state,'settings:preset',{preset:'conservative'});
 const b={date:'2026-11-20',code:'600003',turnover:2.4,amount:2e7},f={ratio:1.45,sectorAssists:2},s=settingsAt(state);
 const stable=inferEvidence(b,[],f,{},'未判定',{},catalog,s).facts;
 assert.equal(stable.get('1:2').pass,false);assert.equal(stable.get('57:0').pass,true);assert.equal(stable.get('29:3').pass,false);
 settingsAction(state,'settings:preset',{preset:'aggressive'});const fast=inferEvidence(b,[],f,{},'未判定',{},catalog,settingsAt(state)).facts;
 assert.equal(fast.get('1:2').pass,true);assert.equal(fast.get('29:3').pass,true);
 assert.equal(inferEvidence({...b,amount:1e6},[],f,{},'未判定',{},catalog,settingsAt(state)).facts.get('57:0').pass,true);
});
