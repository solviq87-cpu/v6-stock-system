'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseIndex} = require('../src/research/dabanke-index');
const {parseDisclosures, parsePocket} = require('../src/research/dabanke-disclosures');
const {createDabankeRequests} = require('../src/research/dabanke-requests');
const {createDabankeReview, stockFacts} = require('../src/research/dabanke-review');

const day = '2026-01-05';
const asOf = Date.parse('2026-01-06T20:00:00+08:00');
const symbol = '600100';
const detail = '/lhbd-600100-20260105.html';
const indexPage = `
  <h1 id="page-title">2026-01-05 连板梯队</h1>
  <section class="home-market-overview"><p class="home-market-meta">2026-01-05
  <b class="home-market-state">收盘</b> 更新时间：15:10</p>
  <div class="home-index-item"><span>合成指数</span><strong>0.00%</strong></div></section>
  <section class="home-limit-up-ecosystem"><header>2026-01-05 短线池不含 ST</header>
  <article><span>昨日晋级</span><strong>0/2只</strong><small>晋级率 0%</small></article></section>
  <section id="home-ladder"><article class="ladder-view-tier">
  <div class="ladder-view-tier-heading"><h3>1进2</h3><p>晋级 0 / 1 只</p></div>
  <div class="stock-line status-failed" data-symbol="600100.SH"><a class="stock-detail-link" href="/gupiao-600100.html?review_date=2026-01-05">
  <b class="stock-name">合成甲</b></a><span class="stock-change">-4.00%</span>
  <div class="ladder-stock-reason"><p>此前公布的原因<small>资料日期 · 2025-12-31</small></p></div></div></article></section>`;
const disclosure = `
  <div class="dragon-intro"><h1>最后发布时间：2026-01-05 17:15:00</h1>
  1 条披露 · 1 只股票 · 单日榜 0 条 · 多日榜 1 条</div>
  <div class="dragon-summary-list"><article>
  <a class="dragon-summary-stock" href="${detail}">合成甲</a><b class="dragon-summary-period">12-31 至 01-05</b>
  <p class="dragon-summary-reason">三个交易日累计偏离</p><i class="dragon-summary-concept">测试题材</i>
  <span class="dragon-summary-amount">2.00亿</span><span class="dragon-summary-amount">2.10亿</span>
  <span class="dragon-summary-amount">-1,000.00万</span></article></div>`;
const pocket = `
  <div class="fpb-dev-review-date"><time datetime="2026-01-05">2026-01-05</time> · 收盘已确认</div>
  <section id="fpb-dev-dragon"><p class="fpb-dev-meta">上榜 1只</p><article class="fpb-dev-dragon-stock">
  <a class="fpb-dev-dragon-detail" href="${detail}"><i class="fpb-dev-card-rank">1</i><b class="fpb-dev-stock-name">合成甲</b>
  <span class="fpb-dev-stock-change">+0.00%</span></a><span class="fpb-dev-dragon-period">多日榜 · 12-31 至 01-05</span>
  <b class="fpb-dev-dragon-buy"><strong>2.00亿</strong></b><b class="fpb-dev-dragon-net"><strong>-1,000.00万</strong></b>
  <div class="fpb-dev-dragon-seats"><a title="测试营业部 · 买 1.00亿 / 卖 0元">测试席位</a></div></article></section>
  <section id="fpb-dev-popularity"><p class="fpb-dev-popularity-note">观察 2026-01-06 08:00:00 · 行情日 2026-01-05</p>
  <div class="fpb-dev-popularity-row"><i class="fpb-dev-popularity-rank">1</i><a href="/gupiao-600100.html">合成甲</a></div></section>
  <footer>行情日 2026-01-05 · 行情快照 2026-01-05 15:41:35</footer>`;

test('daily market/tier parser keeps zeros, disclosure dates and limits eligible population to that date', () => {
  const info = parseIndex(indexPage, day, asOf);
  assert.equal(info.market.indices[0].change, 0);
  assert.equal(info.ecology[0].success, 0);
  assert.deepEqual(info.tiers[0].members.map(r=>[r.code,r.status,r.change,r.reasonDay]), [[symbol,'未晋级',-4,'2025-12-31']]);
  assert.equal(stockFacts({day,index:info}, asOf)[symbol].logic, undefined);
  assert.deepEqual(stockFacts({day,index:info}, asOf-1), {});
  assert.equal(parseIndex(indexPage, '2026-01-06', asOf), null);
  assert.equal(parseIndex(indexPage, day, Date.parse(day+'T14:59:00+08:00')), null);
  assert.equal(parseIndex(indexPage.replace('晋级 0 / 1','晋级 0 / 2'), day, asOf).tiers, null);
  const during = indexPage.replace('>收盘<','>盘中<').replace('15:10','10:10');
  assert.ok(parseIndex(during, day, Date.parse(day+'T10:15:00+08:00'), {intraday:true}));
  assert.equal(parseIndex(during, day, Date.parse(day+'T14:15:00+08:00'), {intraday:true}), null);
});

test('daily disclosures reconcile counts, currency, multi-day period and publication time', () => {
  const result = parseDisclosures(disclosure, day, asOf);
  assert.deepEqual(result.rows[0].span, {start:'2025-12-31',end:day,multi:true});
  assert.deepEqual([result.single,result.multi,result.stocks,result.rows[0].buy,result.rows[0].net], [0,1,1,200000000,-10000000]);
  assert.equal(parseDisclosures(disclosure.replace('1 条披露','2 条披露'), day, asOf), null);
  assert.equal(parseDisclosures(disclosure.replace(detail,'https://example.org'+detail), day, asOf), null);
  assert.equal(parseDisclosures(disclosure.replace(detail,'/lhbd-600100-20260106.html'), day, asOf), null);
  assert.equal(parseDisclosures(disclosure, day, Date.parse(day+'T16:00:00+08:00')), null);
});

test('pocket ranking, disclosures and seats preserve their own observation dates and monetary scopes', () => {
  const info = parsePocket(pocket, day, asOf);
  const first = info.dragon.rows[0];
  assert.deepEqual([first.rank, first.change, first.buy, first.net, first.seats[0].sell], [1,0,200000000,-10000000,0]);
  assert.equal(info.popularity.observedDay, '2026-01-06');
  const facts = stockFacts({day,pocket:info},asOf);
  assert.equal(facts[symbol].dragon.rank, 1);
  assert.equal(facts[symbol].popularityRank, undefined);
  assert.deepEqual(stockFacts({day,pocket:info}, asOf-1), {});
  assert.equal(parsePocket(pocket, '2026-01-06', asOf), null);
  assert.equal(parsePocket(pocket.replace('行情日 2026-01-05 · 行情快照','行情日 2026-01-04 · 行情快照'),day,asOf),null);
  assert.equal(parsePocket(pocket.replace(detail,'/lhbd-600100-20260104.html'),day,asOf).dragon,null);
});

test('both clients share the first request; an unavailable source retains the original archived receipts after restart', async t => {
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dabanke-'));
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const directory=path.join(parent,'archive');
  let now=asOf, calls=0, offline=false, notifications=0;
  const request=async url=>{
    ++calls;
    if(offline)throw Error('offline');
    return {raw:Buffer.from(url.includes('/lhb-')?disclosure:url.includes('/fpb.')?pocket:indexPage),receivedAt:now};
  };
  const options={directory,clock:()=>now,request,onChange:()=>{++notifications;}};
  const service=createDabankeReview(options);
  // The first snapshot must stay usable even while the volume is read-only.
  fs.writeFileSync(directory,'test volume unavailable');
  const [first,second]=await Promise.all([service.refresh(day),service.refresh(day)]);
  assert.equal(second,first);
  assert.deepEqual([first.day,first.disclosures.rows.length,calls,notifications],[day,1,3,1]);
  assert.equal(service.summary(day,'收盘').facts[symbol].status,'未晋级');
  fs.unlinkSync(directory);
  now+=5*3600000;offline=true;
  assert.equal(await service.refresh(day),first);
  const restart=createDabankeReview(options);
  assert.equal(restart.peek(day).knownAt,asOf);
  assert.equal(restart.peek(day).revision,first.revision);
  assert.equal(restart.peek('2026-01-04'),null);
  assert.equal(await restart.refresh('2026-01-08'),null);
  assert.equal(await restart.refresh(day,{intraday:true}),null);
  assert.deepEqual([calls,notifications],[6,1]);
});

test('source requests are coalesced across breadth, historical ladder and structured review readers',async()=>{
  let now=asOf,calls=0;
  const read=createDabankeRequests({clock:()=>now,request:async()=>{++calls;return {raw:Buffer.from('ok')};}});
  const u='https://www.dabanke.com/index-20260105.html';
  const r=await Promise.all([read(u),read(u),read(u)]);
  assert.equal(calls,1);
  assert.equal(r[0].receivedAt,now);
  now+=29999;await read(u);assert.equal(calls,1);
  now+=2;await read(u);assert.equal(calls,2);
  assert.throws(()=>read('https://www.dabanke.com/other.html'));
});

test('stock badges distinguish tied leaders, deputy, comparable float-cap and amount, and a confirmed zero score',async()=>{
  const {groupRoles,sectorRoles,observedBadge}=await import('../public/nova/stock-roles.js');
  const rows=[
    {code:'600101',level:4,firstSeal:'09:30:00',amount:80,floatCap:80},
    {code:'600102',level:4,firstSeal:'09:35:00',amount:100,floatCap:200},
    {code:'600103',level:2,firstSeal:'10:00:00',amount:60,floatCap:150},
    {code:'600104',level:1,firstSeal:'11:00:00',amount:20,floatCap:60}];
  const roles=groupRoles(rows,'测试题材');
  assert.equal(roles.get('600101').label,'并列龙头');
  assert.equal(roles.get('600102').also.label,'中军');
  assert.equal(roles.get('600103').label,'龙二');
  assert.equal(roles.get('600104').label,'跟风');
  assert.equal(groupRoles(rows,'测试题材',8).size,0);
  assert.equal(groupRoles([rows[0]],'测试题材').size,0);
  assert.equal(groupRoles(rows.map(r=>({...r,floatCap:null})),'测试题材').get('600102').also,undefined);
  const state={ztDay:'20260105',ztBySector:[{sector:'测试题材',count:4,stocks:rows}]};
  assert.equal(sectorRoles(state,day,'测试题材').get('600101').key,'coLead');
  assert.equal(sectorRoles(state,'2026-01-06').size,0);
  assert.equal(observedBadge({score:0,level:1}).value,'0');
  assert.equal(observedBadge({level:1}).value,'首板');
  assert.equal(observedBadge({result:'待评估'}),null);
});

test('a first-board failure with an explicit broken seal joins the failed-seal pool; breadth keeps its population', async () => {
  const {closingLadder}=await import('../public/nova/dabanke-view.js');
  const html=indexPage.replace('1进2','首板').replace('晋级 0 / 1','封住 0 / 1')
    .replace('昨日晋级','当日封板').replace('0/2只','0/1只')
    .replace('<div class="ladder-stock-reason">','<span class="ladder-performance">炸板</span><div class="ladder-stock-reason">');
  const parsed=parseIndex(html,day,asOf);
  assert.equal(parsed.tiers[0].members[0].status,'炸板');
  const fallback=closingLadder(parsed,day);
  assert.deepEqual(fallback.broken,[[symbol,'合成甲',-4]]);
  assert.deepEqual(fallback.rows,[]);
  assert.equal(fallback.sealed.total,1);
  assert.equal(fallback.distribution,null);
  assert.deepEqual(closingLadder(parsed,'2026-01-06'),{});
  assert.deepEqual(closingLadder({...parsed,mode:'盘中'},day),{});
  assert.equal(closingLadder({...parsed,tiers:[]},day).broken,null);
});

test('a complete past close reopens without polling any supplier after a server restart', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v6-closed-weekend-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const settled={day,mode:'收盘',version:1,knownAt:asOf,revision:'archived',
    index:{day,knownAt:asOf,tiers:[],signals:{groups:[]},ecology:[],themes:[]},
    pocket:{day,knownAt:asOf,dragon:{rows:[]}},disclosures:{day,knownAt:asOf,rows:[]}};
  fs.writeFileSync(path.join(directory,day+'.json'),JSON.stringify(settled));
  let calls=0;
  const service=createDabankeReview({directory,clock:()=>asOf+86400000,request:async()=>{calls++;throw Error('offline');}});
  assert.deepEqual(await service.refresh(day),settled);
  assert.equal(calls,0);
});
