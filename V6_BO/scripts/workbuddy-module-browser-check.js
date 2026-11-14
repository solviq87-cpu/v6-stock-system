'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildWorkBuddyStatic } = require('./build-workbuddy-static');

const SOURCE = path.resolve(__dirname, '../../V6_WEB/workbuddy/index.html');
const ORIGIN = 'http://127.0.0.1';
const VIEWS = ['home', 'picks', 'scanner', 'strategies', 'portfolio', 'risk', 'factors', 'watchlist'];
const FOCUS_MODULES = ['auction-strength', 'one-to-two', 'two-to-three', 'intraday-strength'];
const report = { sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex'), offline: true, fixtureOnly: true, viewports: [], externalRequests: [] };

// Every request, including supplier requests, is intercepted before transport.
// The only writes are to this in-memory synthetic records fixture.
async function fixture(browser, width, { time = '2026-11-13T07:12:00.000Z', marketMock = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  // The supplied screenshot is after close. The clock starts there and keeps
  // advancing, so the table-scroll quiet window retains its real semantics.
  await page.clock.install({ time: new Date(time) });
  if (marketMock) await page.addInitScript(() => {
    const original = window.fetch;
    window.__moduleMarketFixture = { calls: [], active: 0, maxActive: 0 };
    window.fetch = async function (input, options = {}) {
      const url = new URL(String(input), location.href);
      // News remains allowed after close. Count quote/history separately and
      // fulfill this explicit news feed through the browser route fixture.
      if (url.hostname === 'np-weblist.eastmoney.com' && url.pathname === '/comm/web/getFastNewsList') return original.apply(this, arguments);
      const publicHost = ['gtimg.cn', 'gtimg.com', 'qq.com', 'sina.com.cn', 'sina.cn', 'sinajs.cn', 'eastmoney.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
      if (!publicHost) return original.apply(this, arguments);
      const fixture = window.__moduleMarketFixture;
      fixture.calls.push({ at: Date.now(), host: url.hostname, path: url.pathname });
      fixture.active++; fixture.maxActive = Math.max(fixture.maxActive, fixture.active);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 20);
          options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('fixture aborted', 'AbortError')); }, { once: true });
        });
        if (url.href.includes('/q=')) {
          const ids = url.href.split('/q=')[1].split(','), stamp = new Date(Date.now() + 8 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const body = ids.map(id => {
            const fields = Array(50).fill('0');
            fields[1] = 'fixture'; fields[2] = id.slice(2); fields[3] = '10'; fields[4] = '10'; fields[5] = '10'; fields[6] = '1000'; fields[30] = stamp; fields[32] = '0'; fields[33] = '10.1'; fields[34] = '9.9';
            return 'v_' + id + '="' + fields.join('~') + '";';
          }).join('\n');
          return new Response(body, { status: 200 });
        }
        return new Response('[]', { status: 200 });
      } finally { fixture.active--; }
    };
  });
  const html = buildWorkBuddyStatic({ sourceFile: SOURCE, sha: 'a'.repeat(40) }).html;
  const records = [], errors = [], requests = [];
  let writes = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method() });
    if (url.origin !== ORIGIN) {
      if (url.hostname === 'np-weblist.eastmoney.com' && url.pathname === '/comm/web/getFastNewsList') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { fastNewsList: [] } }) });
      }
      report.externalRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort();
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/records') {
      assert.equal(url.searchParams.get('sharecode'), 'fixture-only-access');
      if (request.method() === 'POST') {
        const incoming = request.postDataJSON();
        // Independent public news/market updates are not account writes.
        if (incoming.name === 'v6.app.state') writes++;
        const index = records.findIndex(record => record.name === incoming.name);
        const record = { ...incoming, id: index < 0 ? `fixture-${records.length + 1}` : records[index].id };
        if (index < 0) records.push(record);
        else records[index] = record;
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, records, record: records[0], allowCreateInitialState: true /* fixture-only: explicit first-use contract */ }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  async function ready() {
    await page.waitForFunction(() => document.querySelector('#navigation a') && document.querySelector('#sync-text').textContent.includes('已同步') && document.querySelector('#main [data-v6-module]') && window.V6Market.status.collectionRequested === true);
    // Allow the initial bounded news round to settle. A reload may retain an
    // unverified cache and its persisted five-minute cooldown; it must not be
    // forced into another source request merely for this presentation test.
    await page.waitForFunction(() => !window.V6NewsPool || !!window.V6NewsPool.snapshot.fetchedAt || !!window.V6NewsPool.snapshot.lastError);
  }
  await page.goto(ORIGIN + '/?sharecode=fixture-only-access', { waitUntil: 'domcontentloaded' });
  await ready();
  return { page, errors, requests, records, ready, get writes() { return writes; } };
}

async function navigate(page, view) {
  // Native links and the responsive menu remain the actual navigation path.
  const link = page.locator(`#navigation a[href="#${view}"]`);
  if (await link.isVisible()) await link.click();
  else {
    await page.locator('#mobile-menu-button').click();
    await page.locator(`#menu-dialog a[href="#${view}"]`).click();
  }
  await page.waitForFunction(target => location.hash === `#${target}` && document.querySelector('#navigation a.active')?.getAttribute('href') === `#${target}`, view);
}

async function coverage(page) {
  return page.locator('#main').evaluate(main => {
    const business = [...main.querySelectorAll('section,article.tj-watch-card,.panel,.tj-panel,.vb-panel,.tj-market-coverage,.tj-push-policy-bar,.tj-factor-chooser,.tj-index-card,.strategy-card,.stat-card,.vb-coverage,.vb-filter-audit,.vb-assets-panel,.vb-evidence-sources')];
    return business.filter(node => !node.closest('details')).map(node => ({
      title: node.querySelector('h2,h3,strong')?.textContent,
      decorated: node.hasAttribute('data-v6-module'),
      buttons: [...node.querySelectorAll('[data-module-toggle]')].filter(button => button.closest('[data-v6-module]') === node).length,
      controls: [...node.querySelectorAll('[data-module-toggle]')].filter(button => button.closest('[data-v6-module]') === node).every(button => button.getAttribute('aria-controls') === node.id && ['true', 'false'].includes(button.getAttribute('aria-expanded'))),
      nestedInteractive: [...node.querySelectorAll('[data-module-toggle]')].filter(button => button.closest('[data-v6-module]') === node).some(button => !!button.closest('a')),
      specificStatLabel: !node.matches('.stat-card') || [...node.querySelectorAll('[data-module-toggle]')].filter(button => button.closest('[data-v6-module]') === node).every(button => !button.getAttribute('aria-label').includes('内容模块'))
    }));
  });
}

test('collapsible business modules preserve mobile/desktop interactions and local view preferences', { timeout: 120000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const width of [390, 1440]) {
    await t.test(`${width}px actual browser layout and controls`, async () => {
      const f = await fixture(browser, width), { page } = f;
      try {
        const views = [];
        for (const view of VIEWS) {
          await navigate(page, view);
          const modules = await coverage(page);
          assert.ok(modules.length > 0, `${view} has no business modules`);
          assert.deepEqual(modules.filter(module => !module.decorated || module.buttons !== 1 || !module.controls || module.nestedInteractive || !module.specificStatLabel), [], `${view} has a module without one accessible, labeled toggle`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 2, `${view} overflows viewport by ${overflow}px`);
          views.push({ view, modules: modules.length, overflow });

          const module = page.locator('#main [data-v6-module]').first();
          const toggle = module.locator('[data-module-toggle]').first();
          // News may render between locator resolution and evaluation. Resolve
          // and click in one browser task to isolate this synchronous handler.
          const ownHandlerKeptNode = await page.evaluate(() => {
            const button = document.querySelector('#main [data-v6-module]')?.querySelector('[data-module-toggle]');
            if (!button) throw new Error('module toggle missing before synchronous click');
            button.dataset.fixtureSentinel = 'same-node';
            button.click();
            const kept = document.contains(button) && button.dataset.fixtureSentinel === 'same-node';
            button.click();
            return kept && document.contains(button);
          });
          assert.equal(ownHandlerKeptNode, true, `${view}: the collapse handler replaced its own DOM synchronously`);
          const key = await module.getAttribute('data-v6-module');
          const beforeWrites = f.writes;
          await toggle.click();
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          assert.equal(await module.evaluate(node => node.classList.contains('v6-module-collapsed')), true);
          assert.equal(await module.evaluate(node => [...node.children].filter(child => !child.classList.contains('v6-module-header')).every(child => getComputedStyle(child).display === 'none')), true);
          assert.equal(f.writes, beforeWrites, 'presentation collapse wrote the cloud ledger');
          await toggle.focus();
          await page.keyboard.press('Enter');
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');

          await page.locator('[data-module-all="collapse"]').click();
          assert.equal(await page.locator('#main [data-module-toggle][aria-expanded="true"]').count(), 0);
          await page.locator('[data-module-all="expand"]').click();
          assert.equal(await page.locator('#main [data-module-toggle][aria-expanded="false"]').count(), 0);
          // Selectively collapse then force a real full render through navigation.
          const chosen = page.locator('#main [data-v6-module]').filter({ has: page.locator(`[data-module-toggle]`) }).first();
          await chosen.locator('[data-module-toggle]').first().click();
          await navigate(page, view === 'home' ? 'risk' : 'home');
          await navigate(page, view);
          const restored = page.locator('#main [data-v6-module]').filter({ has: page.locator('[data-module-toggle]') });
          assert.equal(await restored.evaluateAll((nodes, wanted) => nodes.find(node => node.dataset.v6Module === wanted)?.classList.contains('v6-module-collapsed'), key), true, `${view} lost collapse across render`);
          await page.locator('[data-module-all="expand"]').click();

          if (view === 'risk') {
            const before = f.writes;
            await page.locator('#risk-save').click();
            await page.waitForFunction(() => !document.querySelector('#risk-save')?.disabled);
            assert.ok(f.writes > before, 'risk-save stopped working after module enhancement');
          }
        }
        // Create one synthetic ledger through the original pure account core,
        // then reload it through the mocked records boundary. No real account
        // or quote endpoint is used. This produces the actual orders table.
        const ledger = await page.evaluate(() => {
          const core = window.V6Core;
          core.setMarketData({ schemaVersion: 2, fetchedAt: '2026-11-13T07:12:00Z', providerTime: '2026-11-13T07:12:00Z', source: 'isolated-browser-fixture', stocks: [{ symbol: '600000', name: '隔离测试股票', price: 10, change: 0, providerTime: '2026-11-13T07:12:00Z', providerDateKnown: true }] });
          const result = core.trade(core.createDefaultState(), { symbol: '600000', side: 'buy', quantity: 100 });
          if (!result.ok) throw new Error(result.error);
          return JSON.stringify(result.state);
        });
        const record = f.records.find(record => record.name === 'v6.app.state');
        assert.ok(record, 'synthetic ledger record missing');
        record.content = ledger;
        await page.locator('#sync-button').click();
        await page.waitForFunction(() => document.querySelector('#sync-text').textContent.includes('已同步'));
        await navigate(page, 'portfolio');
        await page.locator('[data-portfolio-tab="orders"]').click();
        const table = page.locator('#main .table-wrap').first();
        const maxScroll = await table.evaluate(node => node.scrollWidth - node.clientWidth);
        if (width === 390) assert.ok(maxScroll > 100, 'actual mobile orders table does not expose horizontal scrolling');
        if (maxScroll > 0) {
          await table.evaluate(node => { node.dataset.fixtureTable = 'same-table'; node.scrollLeft = Math.min(140, node.scrollWidth - node.clientWidth); });
          const scroll = await table.evaluate(node => node.scrollLeft);
          const holder = table.locator('xpath=ancestor::*[@data-v6-module][1]');
          await holder.locator('[data-module-toggle]').first().click();
          await holder.locator('[data-module-toggle]').first().click();
          assert.equal(await table.getAttribute('data-fixture-table'), 'same-table', 'collapse rebuilt the real orders table');
          assert.ok(Math.abs(await table.evaluate(node => node.scrollLeft) - scroll) <= 1, 'collapse lost the orders scroll position');
          await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
          await page.waitForFunction(() => !document.querySelector('[data-fixture-table]'));
          assert.ok(Math.abs(await page.locator('#main .table-wrap').first().evaluate(node => node.scrollLeft) - scroll) <= 1, 'market-style re-render lost the orders scroll position');
        }
        await navigate(page, 'home');
        const mainModule = page.locator('#main [data-v6-module]').first();
        const homeKey = await mainModule.getAttribute('data-v6-module');
        await mainModule.locator('[data-module-toggle]').first().click();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await f.ready();
        assert.equal(await page.locator('#main [data-v6-module]').evaluateAll((nodes, key) => nodes.find(node => node.dataset.v6Module === key)?.classList.contains('v6-module-collapsed'), homeKey), true, 'reload lost collapse preference');
        await page.locator('[data-module-all="expand"]').click();
        // Existing native evidence disclosures remain native, independently usable.
        await navigate(page, 'scanner');
        const disclosure = page.locator('#main details').first();
        if (await disclosure.count()) {
          const before = await disclosure.getAttribute('open');
          await disclosure.locator('summary').first().click();
          assert.notEqual(await disclosure.getAttribute('open'), before);
        }
        if (process.env.V6_WORKBUDDY_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.V6_WORKBUDDY_SCREENSHOT_DIR, { recursive: true });
          await navigate(page, 'home');
          await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_SCREENSHOT_DIR, `workbuddy-modules-${width}.png`), fullPage: true });
          await page.locator('[data-module-all="collapse"]').click();
          await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_SCREENSHOT_DIR, `workbuddy-modules-collapsed-${width}.png`), fullPage: true });
          await page.locator('[data-module-all="expand"]').click();
          await navigate(page, 'scanner');
          await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_SCREENSHOT_DIR, `workbuddy-scanner-modules-${width}.png`), fullPage: true });
        }
        assert.deepEqual(f.errors, []);
        report.viewports.push({ width, views, pageErrors: f.errors, recordWrites: f.writes });
      } finally { await page.close(); }
    });
  }
  assert.deepEqual(report.externalRequests, []);
});

test('four dedicated focus modules have separate accessible collapse controls', { timeout: 45000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const f = await fixture(browser, 390);
  t.after(() => f.page.close());
  for (const id of FOCUS_MODULES) {
    const module = f.page.locator(`#main [data-module-id="${id}"]`);
    assert.equal(await module.count(), 1, `missing independent ${id} module`);
    const toggle = module.locator('[data-module-toggle]').first();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    const evidence = module.locator('a[data-focus-module-group]').first();
    assert.equal(await evidence.count(), 1, `${id} has no route to its underlying strategy evidence`);
    const expectedGroup = await evidence.getAttribute('data-focus-module-group');
    await evidence.click();
    await f.page.waitForFunction(() => location.hash === '#scanner');
    assert.equal(await f.page.locator('.vb-group-tabs [data-group].is-active').getAttribute('data-group'), expectedGroup, `${id} opened the wrong scanner group`);
    await navigate(f.page, 'home');
  }
  assert.deepEqual(f.errors, []);
  if (process.env.V6_WORKBUDDY_MODULE_REPORT) fs.writeFileSync(process.env.V6_WORKBUDDY_MODULE_REPORT, JSON.stringify(report, null, 2) + '\n');
});

test('automatic collection waits after close and uses the same bounded budget during a trading session', { timeout: 45000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const f = await fixture(browser, 390, { marketMock: true });
  t.after(() => f.page.close());
  const { page } = f;
  await page.waitForTimeout(100);
  const closed = await page.evaluate(() => ({ status: window.V6Market.status, calls: window.__moduleMarketFixture.calls.length }));
  assert.equal(closed.status.collectionRequested, true, 'new page should retain automatic-schedule intent');
  assert.equal(closed.status.collectionEnabled, false, '15:12 after-close collection must be off');
  assert.equal(closed.calls, 0, 'after-close page started public quote/history work');
  await page.clock.setSystemTime(new Date('2026-11-13T01:45:00.000Z'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await f.ready();
  await page.waitForFunction(() => window.__moduleMarketFixture.calls.length >= 2);
  const running = await page.evaluate(() => ({ status: window.V6Market.status, fixture: window.__moduleMarketFixture }));
  assert.equal(running.status.collectionRequested, true);
  assert.equal(running.status.collectionEnabled, true, '09:45 trading session did not enable collection');
  assert.equal(running.fixture.maxActive, 1, 'public wire concurrency exceeded one');
  const byFamily = new Map();
  for (const call of running.fixture.calls) {
    const family = /(?:gtimg\.(?:cn|com)|qq\.com)$/.test(call.host) ? 'tencent' : /eastmoney\.com$/.test(call.host) ? 'eastmoney' : 'sina';
    if (byFamily.has(family)) assert.ok(call.at - byFamily.get(family) >= 1050, `same-family starts too close: ${family}: ${JSON.stringify(running.fixture.calls)}`);
    byFamily.set(family, call.at);
  }
  await page.locator('[data-scan-market]').click();
  const paused = await page.evaluate(() => ({ status: window.V6Market.status, calls: window.__moduleMarketFixture.calls.length }));
  assert.equal(paused.status.collectionRequested, false, 'manual pause did not clear automatic intent');
  assert.equal(paused.status.collectionEnabled, false);
  await page.waitForTimeout(1250);
  assert.equal(await page.evaluate(() => window.__moduleMarketFixture.calls.length), paused.calls, 'queued work continued after manual pause');
  assert.deepEqual(f.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.sessions = { closed: { requested: true, enabled: false, calls: closed.calls }, trading: { enabled: true, peak: running.fixture.maxActive, mockedStarts: running.fixture.calls.length }, manualPauseStopsQueue: true };
  if (process.env.V6_WORKBUDDY_MODULE_REPORT) fs.writeFileSync(process.env.V6_WORKBUDDY_MODULE_REPORT, JSON.stringify(report, null, 2) + '\n');
});
