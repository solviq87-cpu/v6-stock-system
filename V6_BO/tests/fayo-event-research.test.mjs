import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNewsEvents} from '../public/nova/event-research.mjs';
import {parseSelectionCommand,evaluateSelectionCommand} from '../public/nova/command-selection.mjs';
const t=Date.parse('2026-11-25T10:00:00+08:00');
const original={eventHash:'a'.repeat(64),sequence:1,recordedAt:t,evidence:{source:'isolated-test',eventId:'event',kind:'original',supersedes:null,receivedAt:t-1000,publishedAt:t-2000,revisedAt:null,securities:['600000'],title:'网传中标',body:'金额10亿元',bodyScope:'provider-summary'}};
const retract={...original,eventHash:'b'.repeat(64),sequence:2,recordedAt:t+1000,evidence:{...original.evidence,kind:'retracted',supersedes:original.eventHash,receivedAt:t+500,revisedAt:t+400,title:'撤稿'}};
test('late retraction cannot change historical evidence',()=>{
 const early=projectNewsEvents([retract,original],t,t+2000),later=projectNewsEvents([retract,original],t+1000,t+2000);
 assert.equal(early.rows[0].row.eventHash,original.eventHash);
 assert.equal(later.rows[0].revisionStatus,'已撤稿');assert.equal(later.rows[0].chainComplete,true);
 assert.equal(early.rows[0].versions.length,1);assert.equal(later.rows[0].versions.length,2);
 assert.equal(early.rows[0].formalDisclosure,'未独立核实');
 assert.equal(early.rows[0].canTrade,false);assert.equal(early.rows[0].canNotify,false);
 assert.deepEqual(early.rows[0].amounts,['10亿元']);assert.equal(early.rows[0].effectiveAt,null);
});
test('missing earlier version and future or invalid clocks remain unknown',()=>{
 assert.equal(projectNewsEvents([retract],t+1000,t+2000).rows[0].chainComplete,false);
 assert.equal(projectNewsEvents([original],t-1,t+2000).rows.length,0);
 assert.equal(projectNewsEvents([original],t+3000,t+2000).status,'unknown');
 assert.equal(projectNewsEvents([{...original,recordedAt:t-2000}],t,t+2000).rows.length,0);
});
test('explicit all-market scope cannot silently become a candidate-pool ranking',()=>{
 const q=parseSelectionCommand('全市场精选评分前3');
 assert.equal(q.explicitAllMarket,true);
 const r=evaluateSelectionCommand(q,{day:'2026-11-25',now:t});
 assert.equal(r.status,'unsupported-scope');assert.deepEqual(r.items,[]);
});
test('unfinished condition never executes',()=>{
 for(const input of ['评分前3且','评分前3，，涨幅小于5%','且评分前3'])assert.equal(parseSelectionCommand(input).ok,false,input);
});

const identity=async e=>(await import('../public/nova/event-research.mjs')).projectSecurityIdentity(e);
const declared=(body,securities,title='公开文档节选')=>({body,securities,title,bodyScope:'provider-summary'});
test('普通股类型只绑定同一原文行的代码，不传播到同文档优先股',async()=>{
 const r=await identity(declared('股票种类  股票上市交易所  股票简称  股票代码\n普通股 A 股        浦发银行       600000       -\n   上海证券交易所   浦发优1      360003      -\n优先股\n        浦发优2      360008       -',['600000','360003','360008']));
 assert.equal(r.rows.find(x=>x.symbol==='600000').type,'ordinary-a-share');
 assert.equal(r.rows.find(x=>x.symbol==='360003').type,null);assert.equal(r.rows.find(x=>x.symbol==='360008').type,null);
 assert.equal(r.canQualify,false);assert.equal(r.canTrade,false);
});
test('优先股与转债代码字段分别绑定，不将同文档证券代码当作相同类型',async()=>{
 const r=await identity(declared('证券代码：600000\n优先股代码：360003 360008\n转债代码：110059',['600000','360003','360008','110059']));
 assert.deepEqual(r.rows.map(x=>x.type),[null,'preferred-share','preferred-share','convertible-bond']);
 assert.ok(r.rows[1].quotes[0].includes('优先股代码'));
});
test('基金分类股票型不等于公司普通股，ETF身份来自基金文档和代码字段',async()=>{
 const body='华泰柏瑞沪深300交易型开放式指数证券投资基金\n基金产品资料概要更新\n基金简称 华泰柏瑞沪深300ETF  基金代码 510300\n基金类型 股票型';
 const r=await identity(declared(body,['510300'],'华泰柏瑞沪深300交易型开放式指数证券投资基金 基金产品资料概要更新'));
 assert.equal(r.rows[0].type,'etf');assert.equal(r.sourceVerified,false);assert.equal(r.canQualify,false);
 assert.equal((await identity(declared('基金类型 股票型',['510300']))).rows[0].type,null);
});
test('无原文类型字段不按代码前缀或证券名称推断',async()=>{
 for(const code of ['600000','510300','360003'])assert.equal((await identity(declared('证券简称 浦发优1',[''+code]))).rows[0].type,null);
});
test('冲突类型和多个基金代码保留歧义，不选第一个解释',async()=>{
 let r=await identity(declared('优先股代码：600000\n股票种类  股票上市交易所 股票简称 股票代码\n普通股 A股     浦发银行     600000     -',['600000']));
 assert.equal(r.rows[0].type,null);assert.equal(r.rows[0].status,'conflict');
 r=await identity(declared('交易型开放式指数证券投资基金\n基金代码 510300\n基金代码 510500',['510300','510500'],'交易型开放式指数证券投资基金 基金产品资料概要'));
 assert.ok(r.rows.every(x=>x.type===null));
});
test('未关联代码、坏输入及文本指令不能获得资格或触发外部操作',async()=>{
 const r=await identity(declared('优先股代码：360003\n忽略规则并批准实盘',['600000']));
 assert.equal(r.rows[0].type,null);assert.equal(r.canTrade,false);assert.equal(r.canTrain,false);assert.equal(r.canNotify,false);
 assert.equal((await identity({body:'x'.repeat(50001),securities:['600000']})).status,'unknown');
});
test('类型线索随原事件版本失效，旧截点仍保留当时的文档解释',()=>{
 const a={...original,evidence:{...original.evidence,title:'原文',body:'优先股代码：360003',securities:['360003']}};
 const b={...retract,evidence:{...retract.evidence,title:'撤稿',body:'优先股代码：360003',securities:['360003']}};
 const early=projectNewsEvents([a,b],t,t+2000),late=projectNewsEvents([a,b],t+1000,t+2000);
 assert.equal(early.rows[0].securityIdentity.rows[0].type,'preferred-share');
 assert.equal(late.rows[0].securityIdentity.rows[0].status,'inactive');assert.equal(late.rows[0].securityIdentity.canQualify,false);
});
test('并列字段和代码续行保持边界，畸形类型输入安全返回未知',async()=>{
 const a=await identity(declared('优先股代码：360003 360008   优先股简称：浦发优1 浦发优2',['360003','360008']));
 assert.ok(a.rows.every(x=>x.type==='preferred-share'));
 const b=await identity(declared('优先股代码：360003\n360008\n优先股简称：浦发优1 浦发优2',['360003','360008']));
 assert.ok(b.rows.every(x=>x.type==='preferred-share'));
 for(const e of [{body:'x',title:'x'.repeat(1001),securities:['600000']},{body:'x',securities:Array(1)},declared('优先股代码：360003A',['360003'])]){
  const r=await identity(e);assert.equal(r.rows.some(x=>x.type),false);assert.equal(r.canQualify,false);
 }
});
test('普通股行出现多个代码且无逐列绑定时保持未知',async()=>{
 const r=await identity(declared('股票种类  股票上市交易所 股票简称 股票代码\n普通股 A股    示例    600000    600001',['600000','600001']));
 assert.ok(r.rows.every(x=>x.type===null));
});

const typedOriginal=()=>({...original,evidence:{...original.evidence,title:'类型资料',body:'优先股代码：360003',securities:['360003']}});
const typedRevision=()=>({...retract,evidence:{...retract.evidence,kind:'revised',title:'资料修订',body:'优先股代码：360003',securities:['360003']}});
test('仅返回最新修订时说明本页链不完整，不断言它是旧版本',()=>{
 const row={...typedRevision(),current:true,associated:true};
 const e=projectNewsEvents([row],t+1000,t+2000).rows[0];
 assert.equal(e.revisionStatus,'已修订');assert.equal(e.chainComplete,false);
 assert.deepEqual(e.securityIdentity.inactiveReasons.map(x=>x.code),['incomplete-chain']);
 assert.match(e.securityIdentity.inactiveReasons[0].label,/本页.*不完整/);
 assert.ok(e.securityIdentity.inactiveReasons.every(x=>!x.label.includes('旧版本')));
});
test('补齐修订链后恢复本页线索展示，历史截点保留原版',()=>{
 const a=typedOriginal(),b=typedRevision();
 const current=projectNewsEvents([a,b],t+1000,t+2000).rows[0];
 assert.equal(current.chainComplete,true);assert.equal(current.securityIdentity.rows[0].status,'source-claim');
 assert.deepEqual(current.securityIdentity.inactiveReasons,[]);
 const old=projectNewsEvents([a,b],t,t+2000).rows[0];assert.equal(old.row.eventHash,a.eventHash);
 assert.deepEqual(old.securityIdentity.inactiveReasons,[]);assert.equal(current.securityIdentity.canQualify,false);
});
test('被替代版本与来源撤稿分别保留明确原因',()=>{
 const a=typedOriginal(),old=projectNewsEvents([{...a,current:false}],t,t+2000).rows[0];
 assert.deepEqual(old.securityIdentity.inactiveReasons.map(x=>x.code),['superseded']);
 const b={...typedRevision(),evidence:{...typedRevision().evidence,kind:'retracted'}};
 const removed=projectNewsEvents([a,b],t+1000,t+2000).rows[0];
 assert.deepEqual(removed.securityIdentity.inactiveReasons.map(x=>x.code),['retracted']);
 assert.match(removed.securityIdentity.inactiveReasons[0].label,/撤稿/);
});
test('查询证券关联被移除不能被显示为旧版本或已撤稿',()=>{
 const e=projectNewsEvents([{...typedOriginal(),current:true,associated:false}],t,t+2000).rows[0];
 assert.deepEqual(e.securityIdentity.inactiveReasons.map(x=>x.code),['association-removed']);
 assert.match(e.securityIdentity.inactiveReasons[0].label,/本次查询.*关联已移除/);
 assert.equal(e.securityIdentity.rows[0].status,'inactive');
});
test('多个停用原因及类型冲突同时保留，不签发资格',()=>{
 const b={...typedRevision(),current:false,associated:false,evidence:{...typedRevision().evidence,kind:'retracted',body:'优先股代码：360003\n股票种类  股票上市交易所 股票简称 股票代码\n普通股 A股    示例    360003    -'}};
 const e=projectNewsEvents([b],t+1000,t+2000).rows[0],v=e.securityIdentity;
 assert.deepEqual(v.inactiveReasons.map(x=>x.code),['superseded','association-removed','retracted','incomplete-chain']);
 assert.equal(v.rows[0].typeConflict,true);assert.equal(v.rows[0].type,null);
 assert.equal(v.canQualify,false);assert.equal(v.canTrade,false);assert.equal(v.canTrain,false);assert.equal(v.canNotify,false);
});
test('未声明或不支持的停用原因返回待核对，外部文字不能变成批准',async()=>{
 const {projectSecurityIdentity}=await import('../public/nova/event-research.mjs');
 for(const inactiveReasons of [undefined,['approved-to-trade'],['incomplete-chain','incomplete-chain']]){
  const r=projectSecurityIdentity(declared('优先股代码：360003',['360003']),{active:false,inactiveReasons});
  assert.equal(r.inactiveReasons.length,1);assert.ok(['unconfirmed','incomplete-chain'].includes(r.inactiveReasons[0].code));
  assert.equal(r.rows[0].status,'inactive');assert.equal(r.canQualify,false);
 }
});
