'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
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
  assert.match(src, /\/api\/quant-picks\?board=all&max=50/);
  assert.match(src, /readAllSixRulePages/);
  assert.match(src, /snapshotId/);
  assert.match(src, /\/api\/kline\?code=/);
  assert.match(src, /function combine\(items\)/);
  assert.match(src, /a\.reasons\.push\(x\)/);
  assert.match(src, /incoming\.forEach/);
  assert.match(src, /const raw=Array\.isArray\(item\.hit\)/);
  assert.match(src, /当前仅显示旧接口实际返回的候选/);
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

test('isolated HTTP server serves both actual new pages and required assets', { timeout: 25000 }, async () => {
  const port = await new Promise((resolve,reject)=>{
    const s=net.createServer();s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
  const child=spawn(process.execPath,['server.js'],{
    cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1'},
    stdio:['ignore','pipe','pipe']
  });
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  function get(url){
    return new Promise((resolve,reject)=>{
      const req=http.get({host:'127.0.0.1',port,path:url,timeout:2500},res=>{
        let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body,contentType:res.headers['content-type']}));
      });
      req.on('timeout',()=>req.destroy(Error('timeout')));
      req.on('error',reject);
    });
  }
  try{
    let ok=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error('server exited: '+logs.slice(-1100));
      try{const r=await get('/api/lock/status');if(r.status===200){ok=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ok, 'server failed to start: '+logs.slice(-1000));
    for(const [url,expected] of [
      ['/v6-studio.html','今日判断'],
      ['/v6-matches.html','全部命中个股'],
      ['/assets/v6-studio.css','.stock-list'],
      ['/assets/v6-studio.js','function combine(items)']
    ]){
      const r=await get(url);
      assert.equal(r.status,200,url+' must be truly served');
      assert.ok(r.body.includes(expected),url+' is not the new page/asset');
    }
  }finally{
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,1200))
    ]);
    if(child.exitCode===null)child.kill('SIGKILL');
  }
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
