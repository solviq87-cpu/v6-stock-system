'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWorkBuddyStatic } = require('./build-workbuddy-static');

const SOURCE = path.resolve(__dirname, '../../V6_WEB/workbuddy/index.html');
const SHA = 'a'.repeat(40);

// This fixture never reaches the actual platform or quote providers.
// Run explicitly in the browser CI job; missing Playwright/Chromium is a failure.
test('current site preserves desktop/mobile navigation and query records authentication', {
  timeout: 90000
}, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const original = fs.readFileSync(SOURCE, 'utf8');
  const artifact = buildWorkBuddyStatic({ sourceFile: SOURCE, sha: SHA }).html;
  for (const width of [390, 1440]) {
    const snapshots = [];
    for (const html of [original, artifact]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      let records = [], authenticatedRequests = 0, blockedExternal = 0;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== 'http://workbuddy.test') { blockedExternal++; return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/api/records') {
          assert.equal(url.searchParams.get('sharecode'), 'fixture-only-access');
          authenticatedRequests++;
          if (request.method() === 'POST') {
            const incoming = request.postDataJSON();
            // Background market/strategy caches and the ledger are separate
            // records. Match the platform's name-based upsert semantics.
            const index = records.findIndex(record => record.name === incoming.name);
            const record = { ...incoming, id: index < 0 ? `fixture-${records.length + 1}` : records[index].id };
            if (index < 0) records.push(record);
            else records[index] = record;
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, records, record: records[0] }) });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      await page.goto('http://workbuddy.test/?sharecode=fixture-only-access', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#navigation a') && document.querySelector('#sync-text').textContent.includes('已同步'));
      const snapshot = [];
      for (const view of ['home', 'picks', 'scanner', 'strategies', 'portfolio', 'risk']) {
        const navigation = page.locator(`#navigation a[href="#${view}"]`);
        if (await navigation.isVisible()) await navigation.click();
        else {
          await page.locator('#mobile-menu-button').click();
          await page.locator(`#menu-dialog a[href="#${view}"]`).click();
        }
        await page.waitForFunction(target => location.hash === `#${target}` && document.querySelector('#navigation a.active')?.getAttribute('href') === `#${target}`, view);
        snapshot.push(await page.locator('#main').evaluate(main => ({
          heading: main.querySelector('h1,h2')?.textContent,
          buttons: [...main.querySelectorAll('button')].map(button => [button.id, button.getAttribute('type'), button.getAttribute('data-action')]),
          forms: [...main.querySelectorAll('form')].map(form => form.id)
        })));
        if (view === 'risk') {
          await assert.doesNotReject(() => page.locator('#risk-save').click());
          await page.waitForFunction(() => !document.querySelector('#risk-save')?.disabled);
        }
      }
      assert.ok(authenticatedRequests > 0);
      assert.deepEqual(errors, []);
      if (process.env.V6_WORKBUDDY_SCREENSHOT_DIR && html === artifact) {
        await page.locator('#navigation a[href="#home"]').click();
        await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_SCREENSHOT_DIR, `workbuddy-static-${width}.png`), fullPage: true });
      }
      assert.ok(snapshot.every(view => view.heading));
      snapshots.push(snapshot);
      await page.close();
    }
    assert.deepEqual(snapshots[0], snapshots[1]);
  }
});
