#!/usr/bin/env node
'use strict';
// Real production HTML and controllers with explicit synthetic read-only data.
// These browser checks prove navigation and rendering, not production prices or
// the owner's physical devices. No upstream service is contacted.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../public');
const output = process.env.V6_UI_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'v6-original-ui-'));
fs.mkdirSync(output, {recursive:true});
// This fixture serves the retained legacy documents, whose bytes/version stay frozen.
const version = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8').match(/APP_VER\s*=\s*'([^']+)/)[1];
const quoteAt = Date.parse('2026-11-13T07:00:00.000Z');
const dashboard = {
  observedAt:Date.now(), indexObservedAt:quoteAt,
  source:'合成浏览器验收 · 非真实行情',
  snapshotDay:'2026-11-13', snapshotRetained:true, isSnapshot:true, trading:false,
  indices:[['1.000001',3100,.5],['0.399001',9600,-.5],['0.399006',1900,.2],['1.000688',900,-.1]]
    .map(([code,price,pct])=>({code,price,pct,quoteAt,quoteSource:'synthetic-browser'})),
  counts:{candidates:2,focused:1,signals:0,risk:1},
  mood:{upRatio:50,label:'休市观察',note:'合成数据只用于布局验收'},
  strategies:[['十四条选股',1],['八字口诀',1],['GPT 五策略',0],['Python 三轮筛选',0]]
    .map(([label,count])=>({label,count})),
  rows:[
    {code:'600519',name:'合成测试甲',price:10,pct:1,score:70,signals:['合成条件甲'],explanation:['合成研究依据'],fourteen:true,focused:true,quoteAt,quoteSource:'synthetic-browser'},
    {code:'000001',name:'合成测试乙',price:20,pct:-1,score:60,signals:[],bazi:{verdict:'仅研究'},quoteAt,quoteSource:'synthetic-browser'}
  ]
};
const candles = Array.from({length:36},(_,index)=>{
  const day = new Date(Date.UTC(2026,8,25+index));
  return {date:day.toISOString().slice(0,10),open:9+index*.03,high:9.3+index*.03,low:8.8+index*.03,close:9.1+index*.03,volume:100+index*5};
}).filter(bar=>![0,6].includes(new Date(bar.date+'T00:00:00Z').getUTCDay()));
const requests = [];
let fixturePhase = 'snapshot';
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname.startsWith('/api/')) {
    requests.push({path:url.pathname,method:req.method,fixturePhase});
    res.setHeader('Content-Type','application/json; charset=utf-8');
    let result;
    if (url.pathname === '/api/lock/status') result = {ok:true,role:fixturePhase==='revoked'?null:'view',needAuth:fixturePhase==='revoked',hasPassword:true,hasViewPassword:true,appVer:version,pushRole:'replica'};
    else if (url.pathname === '/api/state' || url.pathname === '/api/mobile-digest') {
      const live=fixturePhase==='live';
      result=fixturePhase==='revoked'?{ok:false,locked:true,needAuth:true,error:'Synthetic fixture authorization revoked'}:{
        now:Date.now(),role:'view',trading:live,ready:true,isSnapshot:!live,snapshotRetained:!live,snapshotDay:dashboard.snapshotDay,
        dashboard:{...dashboard,fixturePhase,trading:live,isSnapshot:!live,snapshotRetained:!live},global:[],pool:[],signals:[],sectors:[],stocks:[],config:{},mood:null
      };
    }
    else if (url.pathname === '/api/kline') result = {
      ok:true,asOf:'2026-11-13',source:'synthetic-browser',rows:candles,
      dataQuality:{tradeDate:'2026-11-13',source:'tx',cacheLayer:'disk',freshness:'snapshot-only'}
    };
    else if (url.pathname === '/api/quant-picks') result = {snapshotDay:dashboard.snapshotDay,items:dashboard.rows};
    else result = {ok:false,locked:true,items:[],rows:[],error:'该合成测试未配置此数据，保留未知状态'};
    return res.end(JSON.stringify(result));
  }
  try {
    const requested = url.pathname === '/' ? 'index.html' : url.pathname === '/m' ? 'mobile.html' : url.pathname.slice(1);
    const file = path.resolve(root, requested);
    if (!file.startsWith(root+path.sep)) throw Error('outside public root');
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  } catch (_) {res.writeHead(404);res.end();}
});

async function checkEvidenceTabs(page, label) {
  const tabs = page.locator('.ow-detail-nav [role="tab"]');
  assert.equal(await tabs.count(),4,label+' keeps all four evidence categories');
  const check = async index => {
    const states = await tabs.evaluateAll(nodes=>nodes.map(node=>({
      selected:node.getAttribute('aria-selected'),tabIndex:node.tabIndex,
      controls:node.getAttribute('aria-controls'),id:node.id,
      hidden:document.getElementById(node.getAttribute('aria-controls'))?.hidden,
      labelledBy:document.getElementById(node.getAttribute('aria-controls'))?.getAttribute('aria-labelledby')
    })));
    states.forEach((state,i)=>{
      assert.equal(state.selected,String(i===index),label+' selected evidence tab');
      assert.equal(state.tabIndex,i===index?0:-1,label+' evidence roving tabindex');
      assert.equal(state.hidden,i!==index,label+' only active evidence panel is shown');
      assert.equal(state.labelledBy,state.id,label+' evidence panel has its tab label');
    });
    assert.equal(await page.locator('.vx-chart-panel').isVisible(),true,label+' chart survives evidence switching');
  };
  await check(0);
  await tabs.nth(1).click();
  await check(1);
  await tabs.nth(1).press('ArrowRight');
  await check(2);
  await tabs.nth(2).press('End');
  await check(3);
  await tabs.nth(3).press('Home');
  await check(0);
}

async function readFixturePhase(page, phase) {
  // Change the authoritative fixture before reading it through the real
  // controller. A local-only event is otherwise overwritten by the next mobile
  // poll, which correctly reads the fixture's still-historical server state.
  fixturePhase=phase;
  await page.evaluate(async()=>{
    if(typeof manualMobileRefresh==='function')await manualMobileRefresh();
    else await refresh();
  });
  await page.waitForFunction(expected=>expected==='revoked'
    ?window.__v6Dashboard===null
    :window.__v6Dashboard?.fixturePhase===expected,phase);
}

async function checkDesktopModules(page) {
  const before = await page.locator('.workspace-module').count();
  const market = page.locator('.vx-sidebar>a[href="#v6-market"]');
  await market.click();
  await page.waitForFunction(()=>location.hash==='#v6-market' && document.getElementById('vx-dashboard').hidden);
  assert.equal(await market.getAttribute('aria-current'),'page','selected sidebar destination has current-page state');
  assert.equal(await page.locator('[data-workspace-module="v6-market"]').isVisible(),true,'market sidebar opens original market controls');
  assert.equal(await page.locator('#aucSectors').count(),1,'auction control identity retained');
  const targets = await page.locator('.workspace-module').evaluateAll(nodes=>nodes.map(node=>({
    target:node.id || node.dataset.workspaceModule || node.querySelector('[id]')?.id,
    label:node.getAttribute('aria-label')
  })));
  for (const {target,label} of targets) {
    assert.ok(target,label+' has a reachable section identity');
    await page.evaluate(target=>{location.hash=target;},target);
    await page.waitForFunction(target=>{
      const node=document.getElementById(target);
      return node && !node.closest('.workspace-module').hidden;
    },target);
    const state = await page.locator('.workspace-module').evaluateAll(nodes=>({
      shown:nodes.filter(node=>!node.hidden).length,total:nodes.length
    }));
    assert.equal(state.shown,1,label+' is the sole selected business module');
    assert.equal(state.total,before,label+' retains every other module for later navigation');
  }
  await page.locator('.ow-module-heading a[href="#vx-dashboard"]').click();
  await page.waitForFunction(()=>!document.getElementById('vx-dashboard').hidden);
  assert.equal(await page.locator('.workspace-module:not([hidden])').count(),0,'returning home closes module workspace');
  assert.equal(await page.locator('#vx-rows').innerText().then(text=>text.includes('合成测试甲')),true,'returning home preserves the candidate pool');
  return targets;
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const report=[];
  let browser;
  try {
    const executablePath=process.env.V6_UI_BROWSER || '/usr/bin/chromium';
    browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']});
    const origin='http://127.0.0.1:'+server.address().port;
    for (const {url,width} of [{url:'/',width:1366},{url:'/m',width:390},{url:'/m',width:402},{url:'/m',width:320},{url:'/picks.html',width:1366},{url:'/research.html',width:1366}]) {
      fixturePhase='snapshot';
      const label=(url==='/'?'desktop-home':url==='/m'?'mobile-home':url.slice(1,-5))+'-'+width;
      const page=await browser.newPage({viewport:{width,height:width===402?874:width<500?844:900},serviceWorkers:'block'});
      const errors=[],external=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{
        if (new URL(route.request().url()).origin!==origin) {external.push(route.request().url());return route.abort();}
        return route.continue();
      });
      await page.addInitScript(()=>{
        localStorage.setItem('qd_token','synthetic-read-only-session');
        localStorage.setItem('qd_role','view');
      });
      await page.goto(origin+url);
      await page.waitForFunction(()=>document.readyState==='complete');
      const originalStylesLoaded=await page.evaluate(()=>[...document.styleSheets].some(sheet=>{
        if (!sheet.href?.includes('/assets/original-workspace.css')) return false;
        try {return sheet.cssRules.length>0;} catch (_) {return false;}
      }));
      assert.equal(originalStylesLoaded,true,label+' loads the original workspace stylesheet');
      let modules;
      if (url==='/' || url==='/m') {
        await page.locator('#vx-chart svg').waitFor({state:'visible'});
        assert.match(await page.locator('#vx-rows').innerText(),/合成测试甲/,'Friday candidates remain available');
        const banner=page.locator('#ow-snapshot-banner');
        assert.equal(await banner.isVisible(),true,label+' has visible historical-session status');
        assert.match(await banner.innerText(),/2026-11-13/,label+' identifies the original Friday date');
        const provenance=await page.locator('#vx-selected-provenance').innerText();
        assert.match(provenance,/2026[\/-]11[\/-]13/,label+' displays the original Friday quote date');
        assert.match(provenance,/synthetic-browser/,label+' displays original quote provider');
        assert.match(provenance,/旧快照/,label+' identifies historical prices as old snapshots');
        await checkEvidenceTabs(page,label);
        if (url==='/') {
          modules=await checkDesktopModules(page);
          await page.evaluate(()=>window.scrollTo(0,0));
          const rankTop=await page.locator('#vx-ranking').evaluate(node=>node.getBoundingClientRect().top);
          assert.ok(rankTop<=700,label+' exposes the candidate pool in the first viewport, instead of empty summary acreage');
        }
        if (url==='/m') {
          const dock=page.locator('.vx-mobile-dock');
          assert.equal(await dock.isVisible(),true,label+' retains authenticated mobile navigation');
          assert.equal(await dock.locator('a').count(),7,label+' retains all mobile destinations');
          const indices=await page.locator('#vx-indices .vx-index').evaluateAll(nodes=>nodes.map(node=>{
            const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width};
          }).filter(r=>r.width>0));
          assert.equal(indices.length,3,label+' displays three mobile indices');
          assert.ok(Math.abs(indices[0].top-indices[2].top)<2,label+' indices share one compact readable row');
          assert.ok(indices[0].right<=indices[1].left+1&&indices[1].right<=indices[2].left+1,label+' indices never overlap');
          assert.ok(indices[0].left>=0&&indices[2].right<=width,label+' indices stay inside viewport');
        }
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(output,'original-'+label+'.png'),fullPage:false});
        await readFixturePhase(page,'live');
        assert.equal(await banner.isVisible(),false,label+' live weekday data removes historical-session banner');
        await readFixturePhase(page,'revoked');
        const cleared=await page.evaluate(()=>{
          return {
            bannerHidden:document.getElementById('ow-snapshot-banner').hidden,
            rows:document.getElementById('vx-rows').innerText,
            chart:document.getElementById('vx-chart').innerText,
            provenance:document.getElementById('vx-selected-provenance').innerText
          };
        });
        assert.equal(cleared.bannerHidden,true,label+' revoked access clears historical-session banner');
        assert.doesNotMatch(cleared.rows,/合成测试甲|600519/,label+' revoked access clears private rows');
        assert.match(cleared.chart,/登录/,label+' revoked access clears chart');
        assert.match(cleared.provenance,/登录/,label+' revoked access clears provenance');
      } else {
        await page.screenshot({path:path.join(output,'original-'+label+'.png'),fullPage:false});
      }
      const metrics=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,duplicateIds:[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,ids)=>ids.indexOf(id)!==index)}));
      assert.ok(metrics.scrollWidth<=width+1,label+' no horizontal overflow '+JSON.stringify(metrics));
      assert.deepEqual(metrics.duplicateIds,[],label+' unique business control IDs');
      assert.deepEqual(errors,[],label+' no browser script errors');
      assert.deepEqual(external,[],label+' no external network requests');
      report.push({page:url,width,modules,metrics,errors,external});
      await page.close();
    }
    const writes=requests.filter(request=>request.method!=='GET'&&request.path!=='/api/online/beat');
    assert.deepEqual(writes,[],'browsing original workspace must not cause business writes');
    fs.writeFileSync(path.join(output,'original-workspace-report.json'),JSON.stringify({scope:'real production scripts with synthetic read-only HTTP; no production or physical-device claim',browser:await browser.version(),node:process.version,report,requests},null,2));
    console.log('Original workspace: '+report.length+' page/viewport checks passed. Report and screenshots: '+output);
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
