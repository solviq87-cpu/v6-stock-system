#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {createFixture} = require('../tests/helpers/v6-studio-fixture');

async function verify() {
  const service = await createFixture({count: 0});
  const origin = 'http://127.0.0.1:' + service.port;
  const output = process.env.FAYO_OFFLINE_ENTRY_QA_DIR;
  const results = [];
  let browser, stopped = false;
  try {
    browser = await chromium.launch({executablePath: process.env.V6_UI_BROWSER || undefined});
    const entries = [];
    for (const [route, width, height] of [['/', 1536, 1000], ['/m', 390, 844]]) {
      const context = await browser.newContext({viewport: {width, height}});
      const seed = await context.newPage();
      // Install the real worker without ever running the application code online.
      await seed.goto(origin + '/manifest.json');
      await seed.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      });
      await seed.close();
      entries.push({route, width, height, context});
    }
    await service.close();
    stopped = true;
    for (const {route, width, height, context} of entries) {
      const page = await context.newPage();
      await page.goto(origin + route, {waitUntil: 'domcontentloaded'});
      await page.locator('main.fy-gate').waitFor({timeout: 8000});
      const result = await page.evaluate(async () => {
        const response = await fetch('/api/state');
        const body = await response.json();
        const cached = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const req of await cache.keys()) cached.push(new URL(req.url).pathname);
        }
        return {controlled: Boolean(navigator.serviceWorker.controller), gate: Boolean(document.querySelector('.fy-gate')),
          offline: body.offline, apiStatus: response.status, privateCache: cached.filter(url => url.startsWith('/api/')),
          cacheHasIndexView: cached.includes('/nova/index-continuity-view.mjs'),
          overflow: document.documentElement.scrollWidth - innerWidth};
      });
      assert.deepEqual(result, {controlled: true, gate: true, offline: true, apiStatus: 503, privateCache: [],
        cacheHasIndexView: true, overflow: 0});
      results.push({route, width, height, ...result});
      if (output) {
        fs.mkdirSync(output, {recursive: true});
        await page.screenshot({path: path.join(output, '断网登录入口-' + width + '.png')});
      }
      await context.close();
    }
    const report = {freshInstall: true, serviceStopped: true, realDevice: false, results};
    if (output) fs.writeFileSync(path.join(output, 'offline-entry.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    await browser?.close();
    if (!stopped) await service.close();
  }
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
