#!/usr/bin/env node
'use strict';
// Exercise an actual old controlling worker, unchanged URLs, a worker upgrade,
// offline shell and revoked/private API behavior. No application account exists.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
let current = false, online = true;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (!online && url.pathname !== '/sw.js') return res.destroy();
  if (url.pathname === '/sw.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(fs.readFileSync(path.join(root, current ? 'public/sw.js' : 'tests/fixtures/service-worker-before-20261115.js')));
  }
  if (url.pathname === '/assets/upgrade-probe.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(current ? '/* new-executable */' : '/* old-executable */');
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({role: current ? 'revoked' : 'view', syntheticPrivate: !current}));
  }
  if (url.pathname === '/manifest.json') {
    res.setHeader('Content-Type', 'application/json'); return res.end('{}');
  }
  if (url.pathname === '/icon.svg') {
    res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>合成缓存升级验证</title><main>公共离线外壳，无账户数据</main>');
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.V6_UI_BROWSER || undefined, args:['--no-sandbox','--disable-dev-shm-usage']});
    const context = await browser.newContext(), page = await context.newPage();
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/m');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'});
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const read = () => page.evaluate(async () => ({
      script:await (await fetch('/assets/upgrade-probe.js?v=unchanged')).text(),
      api:await (await fetch('/api/account?token=synthetic-only')).json()
    }));
    assert.match((await read()).script, /old-executable/);
    current = true;
    // Prove the stale-worker regression before changing the controlling worker.
    assert.match((await read()).script, /old-executable/);
    // The old implementation does not await its cache.put. Settle that known
    // in-flight write before testing activation cleanup, rather than racing an
    // unrelated legacy writer that can recreate its cache after deletion.
    await page.waitForFunction(async () => {
      const cache = await caches.open('quant-dashboard-m-20261109cv');
      const response = await cache.match('/api/account?token=synthetic-only');
      return response && (await response.json()).role === 'revoked';
    });
    await page.evaluate(async () => {
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
      await (await navigator.serviceWorker.getRegistration()).update();
      await changed;
    });
    const updated = await read();
    assert.match(updated.script, /new-executable/, 'same URL must refresh without hard reload');
    assert.equal(updated.api.role, 'revoked');
    await page.waitForFunction(async () => !(await caches.keys()).includes('quant-dashboard-m-20261109cv'), null, {timeout:5000});
    const names = await page.evaluate(() => caches.keys());
    assert.ok(!names.includes('quant-dashboard-m-20261109cv'), 'old account-bearing cache must be removed: '+JSON.stringify(names));
    // Even a malicious/legacy private response placed in the CURRENT shell
    // cache cannot be used as offline authorization or account evidence.
    await page.evaluate(async () => {
      const name = (await caches.keys()).find(key => key.startsWith('quant-dashboard-m-'));
      const cache = await caches.open(name);
      await cache.put('/api/account?token=synthetic-only', new Response('{"syntheticPrivate":true}'));
    });
    online = false;
    const offline = await page.evaluate(async () => {
      const response = await fetch('/api/account?token=synthetic-only');
      return {status:response.status, body:await response.json()};
    });
    assert.equal(offline.status, 503);
    assert.equal(offline.body.offline, true);
    assert.equal(offline.body.syntheticPrivate, undefined);
    await page.reload({waitUntil:'domcontentloaded'});
    assert.match(await page.locator('main').innerText(), /公共离线外壳/);
    console.log(JSON.stringify({oldWorkerCacheRegressionReproduced:true, sameUrlUpgraded:true, legacyCacheRemoved:true, revokedRoleFresh:true, privateOfflineDenied:true, publicOfflineShell:true}));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
