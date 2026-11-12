'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const {createFixture}=require('./helpers/v6-studio-fixture');
const crypto=require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const pages = ['public/v6-studio.html','public/v6-matches.html'];

test('V6 studio has a new and separate decision-first homepage and all-matches page', () => {
  const home = read(pages[0]), all = read(pages[1]);
  for (const html of [home, all]) {
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /\/assets\/v6-studio\.css/);
    assert.match(html, /\/assets\/v6-studio\.js/);
    assert.match(html, /\/v6-matches\.html/);
    assert.match(html, /全部命中个股/);
    assert.doesNotMatch(html, /id="btnPublish"|id="pendingPublish"|待发布请求/);
  }
  assert.match(home, /今日判断/);
  assert.match(home, /市场判断/);
  assert.match(all, /id="stock-list"/);
  assert.match(all, /id="detail-panel"/);
  assert.match(all, /id="filter-rule"/);
  assert.match(all, /id="filter-board"/);
  assert.match(all, /id="count-signals"/);
});

test('V6 studio read-only JS compiles and neither forces a scan nor submits an order', () => {
  const src = read('public/assets/v6-studio.js');
  new vm.Script(src);
  assert.match(src, /\/api\/v6\/matches\?limit=100/);
  assert.doesNotMatch(src, /\/api\/quant-picks/);
  assert.match(src, /readAllSixRulePages/);
  assert.match(src, /snapshotId/);
  assert.match(src, /\/api\/kline\?code=/);
  assert.match(src, /function combine\(items\)/);
  assert.match(src, /a\.reasons\.push\(x\)/);
  assert.match(src, /incoming\.forEach/);
  assert.match(src, /const raw=Array\.isArray\(item\.hit\)/);
  assert.match(src, /没有可核对的完整快照/);
  assert.match(src, /六项量化条件的整份扫描快照已按游标全部读取/);
  assert.doesNotMatch(src, /\bforce=1\b|method\s*:\s*['"]POST['"]|\/api\/paper\/submit|\/api\/trade\/execute/);
  assert.match(src, /createElementNS/);
  assert.match(src, /get\("\/api\/reference-indexes"\)/);
});

test('V6 studio is responsive, accessible and does not include old terminal theme', () => {
  const css = read('public/assets/v6-studio.css');
  assert.match(css, /@media\(max-width:740px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.mobile-tabbar/);
  assert.match(css, /--bg:#f5f4ef/);
  for (const html of pages.map(read)) {
    assert.doesNotMatch(html, /terminal-theme\.css|original-reference-fidelity\.css|reference-match\.css/);
    assert.match(html, /aria-label/);
  }
});

test('isolated real HTTP serves prototypes and enforces read-only pinned snapshot authorization', {timeout:25000}, async t=>{
  const server=await createFixture();t.after(()=>server.close());
  for(const url of ['/v6-studio.html','/v6-matches.html','/v6-research.html','/v6-validation.html','/v6-paper.html','/v6-market-radar.html',
    '/assets/v6-studio.css','/assets/v6-studio.js','/assets/v6-studio-areas.js','/assets/v6-market-radar.css','/assets/v6-market-radar.js']){
    const r=await server.request(url,'GET',null,'');assert.equal(r.status,200,url);assert.ok(r.raw.length>100,url);
  }
  const anonymous=await server.request('/api/v6/matches','GET',null,'');assert.equal(anonymous.body.locked,true);
  for(let i=0;i<3;i++)assert.equal((await server.request('/api/v6/matches?limit=100')).body.status,'not-ready','reads must never initialize a scanner');
  const scanned=await server.scan();assert.equal(scanned.body.items.length,50);assert.equal(scanned.body.count,250);
  let cursor='',id='',codes=[],signals=0;
  do{
    const d=(await server.request('/api/v6/matches?limit=37'+(cursor?'&cursor='+encodeURIComponent(cursor):''))).body;
    assert.equal(d.ok,true);assert.equal(d.scope,'quant-picks-six-rules');assert.equal(d.completeForScope,true);
    assert.equal(d.coverage.fullMarketCertified,false);assert.equal(d.coverage.allStrategyEngines,false);
    assert.equal(d.coverage.rule5,'not-evaluated');if(id)assert.equal(d.snapshotId,id);id=d.snapshotId;
    codes.push(...d.items.map(x=>x.code));signals+=d.items.reduce((n,x)=>n+x.hit.length,0);cursor=d.nextCursor||'';
  }while(cursor);
  assert.equal(codes.length,250);assert.equal(new Set(codes).size,250);assert.equal(signals,500);
  assert.equal((await server.request('/api/v6/matches?limit=101')).body.status,'invalid-limit');
  const write=await server.request('/api/v6/matches','POST',{items:[]});assert.notEqual(write.body?.ok,true);
  const viewSetup=await server.request('/api/lock/change','POST',{role:'view',newPassword:'studio-only-view-password',token:server.token});assert.equal(viewSetup.body.ok,true);
  const login=await server.request('/api/lock/unlock','POST',{role:'view',password:'studio-only-view-password',fp:'studio-viewer',name:'studio-viewer'},'');
  assert.equal(login.body.pending,true);
  const approved=await server.request('/api/lock/pending-approve','POST',{req:login.body.req,allow:true});assert.equal(approved.body.state,'allowed');
  const view=(await server.request('/api/lock/pending-status?req='+login.body.req,'GET',null,'')).body.token;assert.ok(view);
  assert.equal((await server.request('/api/v6/matches','GET',null,view)).body.ok,true);
  assert.notEqual((await server.request('/api/paper','GET',null,view)).body.ok,true,'viewer cannot read private paper balances');
  assert.equal((await server.request('/api/paper')).body.ok,true);
  const revoke=await server.request('/api/lock/revoke','POST',{id:crypto.createHash('sha256').update(view).digest('hex')});assert.equal(revoke.body.ok,true);
  assert.equal((await server.request('/api/v6/matches','GET',null,view)).body.locked,true,'revoked viewers lose the new API too');
  assert.equal((await server.request('/api/v6/matches')).body.snapshotId,id,'read paging and permission checks never republish the snapshot');
});

test('same stock retains all distinct strategy hits and never invents missing bars', () => {
  const src = read('public/assets/v6-studio.js');
  const instrumented=src.replace(/\}\)\(\);\s*$/, 'window.__test={combine,reasons,rowsValid,aggregate};})();');
  assert.notEqual(instrumented,src,'test instrumentation must attach to script');
  const sandbox={window:{},document:{body:{dataset:{page:'matches'}},readyState:'loading',addEventListener(){}}};
  vm.runInNewContext(instrumented,sandbox);
  const {combine,rowsValid,aggregate}=sandbox.window.__test;
  const stocks=combine([
    {code:'000001',name:'样例一',strategy:'十四条',hit:[{id:1,text:'规则一'},{id:2,text:'规则二'}]},
    {code:'000001',name:'样例一',strategy:'八字',hit:[{id:1,text:'规则一'},{id:3,text:'规则三'}]},
    {code:'300750',name:'样例二',hit:[{id:4,text:'规则四'}]}
  ]);
  assert.equal(stocks.length,2);
  const first=stocks.find(s=>s.code==='000001');
  assert.equal(first.rawSignals,2);
  assert.equal(first.reasons.length,3);
  assert.deepEqual([...first.strategies],['十四条','八字']);
  const daily=rowsValid([
    {date:'2026-11-02',open:10,high:11,low:9,close:10.5},
    {date:'2026-11-03',open:10.5,high:12,low:10,close:11.4},
    {date:'2026-11-04',open:11.4,high:12,low:11,close:11.8},
    {date:'2026-11-05',open:0,high:12,low:11,close:11.5}
  ]);
  assert.equal(daily.length,3);
  const monthly=aggregate(daily,'month');
  assert.equal(monthly.length,1);
  assert.equal(monthly[0].open,10);
  assert.equal(monthly[0].high,12);
  assert.equal(monthly[0].low,9);
  assert.equal(monthly[0].close,11.8);
});


test('new full-match API is routed after the existing token gate and sourced from complete scan results', () => {
  const source=read('server.js');
  assert.match(source, /p === '\/api\/v6\/matches' && req\.method === 'GET'/);
  assert.match(source, /v6MatchesSnapshotStore\.page\(\{ limit, cursor \}\)/);
  assert.match(source, /v6MatchesSnapshotStore\.publish\(\{ items: uniq, asOf: now,/);
  assert.match(source, /p === '\/v6-studio\.html'/);
  assert.match(source, /p === '\/v6-matches\.html'/);
  assert.ok(source.indexOf("if (!isAsset && !isAuth && !isLocalReq(req))") <
    source.indexOf("p === '/api/v6/matches'"), 'new read API cannot bypass authentication');
  assert.ok(source.indexOf("uniq.sort((a, b)") <
    source.indexOf("v6MatchesSnapshotStore.publish"),'publish after complete sorted scan, before limit');
  assert.ok(source.indexOf("v6MatchesSnapshotStore.publish") <
    source.indexOf("items: uniq.slice(0, max)"),'snapshot may not contain truncated results');
});


test('all five new daily workspaces stay within new navigation and no paper writes are exposed',()=>{
  for(const p of ['v6-research.html','v6-validation.html','v6-paper.html']){
    const html=read('public/'+p);
    assert.match(html,/\/v6-studio\.html/);
    assert.match(html,/\/v6-matches\.html/);
    assert.match(html,/\/v6-research\.html/);
    assert.match(html,/\/v6-validation\.html/);
    assert.match(html,/\/v6-paper\.html/);
    assert.doesNotMatch(html, /href="\/#v6-paper"|href="\/research.html"|一键发布|待发布请求/);
  }
  const controller=read('public/assets/v6-studio-areas.js');
  new vm.Script(controller);
  assert.match(controller,/\/api\/paper/);
  assert.match(controller,/getItem\('qd_device'\)/);
  assert.doesNotMatch(controller,/method\s*:\s*['"]POST['"]|\/api\/trade|force=1|\/api\/release/);
  const srv=read('server.js');
  for(const p of ['/v6-research.html','/v6-validation.html','/v6-paper.html'])
    assert.ok(srv.includes("p === '"+p+"'"),p+' static route not allowed');
});
