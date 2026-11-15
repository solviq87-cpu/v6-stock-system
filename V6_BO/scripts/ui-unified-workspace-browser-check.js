#!/usr/bin/env node
'use strict';
// Complete production HTML/scripts, synthetic read-only HTTP transport. This
// verifies rendering/navigation; it is deliberately not a real trading session.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../public');
const output = process.env.V6_UI_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'v6-unified-ui-'));
fs.mkdirSync(output, {recursive:true});
const version = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/APP_VER\s*=\s*'([^']+)/)[1];
const dashboard = {
  observedAt:Date.now(), indexObservedAt:Date.now(), source:'合成界面测试 · 非真实行情',
  indices:[['1.000001',3100,.5],['0.399001',9600,-.5],['0.399006',1900,.2],['1.000688',900,-.1]].map(([code,price,pct])=>({code,price,pct})),
  counts:{candidates:2,focused:1,signals:0,risk:1}, mood:{upRatio:50,label:'测试休市',note:'仅合成布局证据，不可交易'},
  strategies:[['十四条选股',1],['八字口诀',1],['GPT 五策略',0],['Python 三轮筛选',0]].map(([label,count])=>({label,count})),
  rows:[{code:'600519',name:'合成测试甲',price:10,pct:1,score:70,signals:['合成测试'],explanation:['缺失实时来源，不可交易'],fourteen:true},
    {code:'000001',name:'合成测试乙',price:20,pct:-1,score:60,signals:[],bazi:{verdict:'仅研究'}}]
};
const requests = [];
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname.startsWith('/api/')) {
    requests.push({path:url.pathname, method:req.method});
    res.setHeader('Content-Type','application/json; charset=utf-8');
    let result;
    if (url.pathname === '/api/lock/status') result = {ok:true,role:'view',hasPassword:true,hasViewPassword:true,appVer:version,pushRole:'replica'};
    else if (url.pathname === '/api/state' || url.pathname === '/api/mobile-digest') result = {
      now:Date.now(),role:'view',trading:false,ready:false,isSnapshot:true,snapshotDay:'2026-11-13',
      dashboard,global:[],pool:[],signals:[],sectors:[],stocks:[],config:{},mood:null
    };
    else if (url.pathname === '/api/quant-picks') result = {snapshotDay:'2026-11-13',items:dashboard.rows};
    else result = {ok:false,locked:true,items:[],rows:[],error:'合成测试未配置该数据，保持未知'};
    return res.end(JSON.stringify(result));
  }
  try {
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname === '/m' ? 'mobile.html' : url.pathname.slice(1));
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  } catch (_) { res.writeHead(404);res.end(); }
});
const allPages = ['/', '/m', '/picks.html', '/research.html', '/model-library.html', '/auction-picks.html',
  '/v6-studio.html','/v6-matches.html','/v6-research.html','/v6-validation.html','/v6-paper.html','/v6-market-radar.html'];
const pages = process.env.V6_UI_PAGES ? process.env.V6_UI_PAGES.split(',') : allPages;
const widths = [320,375,390,393,430,1366,1536,1920];
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const report = [];
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
    for (const url of pages) for (const width of widths) {
      const page = await browser.newPage({viewport:{width,height:width<500?900:1080},serviceWorkers:'block'});
      const errors = [], external = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route => {
        if (new URL(route.request().url()).origin !== origin) {external.push(route.request().url());return route.abort();}
        return route.continue();
      });
      await page.addInitScript(() => {
        localStorage.setItem('qd_token','synthetic-read-only-session');
        localStorage.setItem('qd_role','view');
      });
      await page.goto(origin + url);
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => {
        const visible = e => {const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
        const ids = [...document.querySelectorAll('[id]')].map(e=>e.id);
        const nav = document.querySelector('.workspace-bottom-nav') || document.querySelector('.vx-mobile-dock');
        return {
          width:document.documentElement.scrollWidth, viewport:innerWidth,
          background:getComputedStyle(document.body).backgroundColor,
          duplicateIds:ids.filter((id,index)=>ids.indexOf(id)!==index),
          visibleDocks:[...document.querySelectorAll('.workspace-bottom-nav,.vx-mobile-dock')].filter(visible).length,
          dockLinks:nav?[...nav.querySelectorAll('a')].map(a=>({text:a.innerText.trim(),href:a.getAttribute('href')})):[],
          brokenLocalAnchors:[...document.querySelectorAll('nav a[href^="#"]')].map(a=>a.getAttribute('href')).filter(h=>h.length>1&&!document.getElementById(decodeURIComponent(h.slice(1))))
        };
      });
      const label = (url === '/' ? 'desktop-home' : url === '/m' ? 'mobile-home' : url.slice(1,-5)) + '-' + width;
      assert.deepEqual(errors,[],label+' script errors');
      assert.deepEqual(external,[],label+' unexpected external transport');
      assert.ok(metrics.width<=width+1,label+' horizontal overflow '+JSON.stringify(metrics));
      assert.deepEqual(metrics.duplicateIds,[],label+' duplicate business controls');
      assert.deepEqual(metrics.brokenLocalAnchors,[],label+' unreachable navigation');
      if (width <= 430 && url !== '/') {
        assert.equal(metrics.visibleDocks,1,label+' exactly one visible mobile navigation');
        assert.equal(metrics.dockLinks.length,7,label+' seven mobile destinations');
      }
      const menu = page.locator('.workspace-more').first();
      if (await menu.count()) {
        await menu.locator('summary').click();
        assert.equal(await menu.getAttribute('open'),'');
        const menuSize = await menu.locator('nav').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};});
        assert.ok(menuSize.left>=-1&&menuSize.right<=width+1,label+' expanded feature directory must fit');
        await menu.locator('summary').press('Escape');
        assert.equal(await menu.getAttribute('open'),null);
      }
      const offlineIndicator = page.locator('[data-workspace-connection]').first();
      if (await offlineIndicator.count()) {
        await page.evaluate(() => {Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline'));});
        assert.match(await offlineIndicator.innerText(),/断开/);
        await page.evaluate(() => {Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});dispatchEvent(new Event('online'));});
      }
      await page.screenshot({path:path.join(output,'unified-'+label+'.png')});
      report.push({page:url,width,...metrics,errors,external});
      await page.close();
    }
    const writes = requests.filter(request=>request.method!=='GET'&&!['/api/online/beat'].includes(request.path));
    assert.deepEqual(writes,[],'browsing redesigned pages must not trigger business writes');
    fs.writeFileSync(path.join(output,'unified-workspace-report.json'),JSON.stringify({scope:'isolated synthetic read-only HTTP; real production HTML/scripts; no physical-device certification',report,requests},null,2));
    console.log('Unified UI: '+report.length+' real page/viewport checks passed; '+requests.length+' synthetic API requests.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
