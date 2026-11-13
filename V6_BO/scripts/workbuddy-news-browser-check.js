'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildWorkBuddyStatic } = require('./build-workbuddy-static');

const SOURCE = process.env.V6_WORKBUDDY_NEWS_SOURCE || path.resolve(__dirname, '../../V6_WEB/workbuddy/index.html');
const ORIGIN = 'http://127.0.0.1';
const START = Date.parse('2026-11-13T07:12:00.000Z');
const report = { sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex'), offline: true, fixtureOnly: true, viewports: [], unexpectedRequests: [] };

function rowsFor(phase) {
  const main = { code: 'fixture-main', title: '隔离测试科技签订新订单', summary: '公开摘要的规则倾向，不是收益认证。', showTime: '2026-11-13 15:10:00', stockList: ['1.600001'], url: 'https://finance.eastmoney.com/a/fixture-main.html' };
  if (phase === 'bad') Object.assign(main, { title: '隔离测试科技拟减持并终止回购', summary: '该事件替换此前同一ID版本，利好不得抵销利空。', showTime: '2026-11-13 15:15:00' });
  if (phase === 'industry' || phase === 'clear') Object.assign(main, { retracted: true, showTime: phase === 'industry' ? '2026-11-13 15:20:00' : '2026-11-13 15:25:00' });
  const result = [main,
    { code: 'fixture-neutral', title: '隔离对照科技召开说明会', summary: '公开日程信息。', showTime: '2026-11-13 15:10:00', stockList: ['1.600002'] },
    { code: 'fixture-unknown', title: '未提供原时点的事项', summary: '缺少原始发布时间，不能补成现在。', showTime: '', stockList: ['1.600007'] },
    { code: 'fixture-future', title: '未来原时点的事项', summary: '未来发布时间不能当作当前已知。', showTime: '2026-11-14 15:10:00', stockList: ['1.600009'] },
    { code: 'fixture-xss', title: '<img src=x onerror="window.__newsXss=1">中标', summary: '<svg onload="window.__newsXss=2">公开摘要</svg>', showTime: '2026-11-13 15:10:00', stockList: ['1.600008'], url: 'javascript:window.__newsXss=3' }
  ];
  if (phase === 'bad') result.push({ code: 'fixture-good-counter', title: '隔离测试科技同时中标', summary: '独立披露的新合同事项。', showTime: '2026-11-13 15:15:00', stockList: ['1.600001'] });
  if (phase === 'industry' || phase === 'clear') result.push({ code: 'fixture-sector', title: '计算机行业遭遇重大处罚', summary: '仅用于验证真实分类名称的间接关联，非实际市场事件。', showTime: phase === 'industry' ? '2026-11-13 15:20:00' : '2026-11-13 15:25:00', stockList: [], ...(phase === 'clear' ? { retracted: true } : {}) });
  return result;
}

async function fixture(browser, width, { shared = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.clock.install({ time: new Date(START) });
  await page.addInitScript(() => {
    const original = window.fetch;
    window.__newsBrowserFixture = { calls: [], source: 'synthetic-browser-only' };
    window.fetch = function (input) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin !== location.origin) window.__newsBrowserFixture.calls.push({ at: Date.now(), host: url.hostname, path: url.pathname, query: url.search, kind: url.hostname === 'np-weblist.eastmoney.com' && url.pathname === '/comm/web/getFastNewsList' ? 'news' : 'other-public' });
      return original.apply(this, arguments);
    };
  });
  const html = buildWorkBuddyStatic({ sourceFile: SOURCE, sha: 'a'.repeat(40) }).html;
  const control = { phase: 'good', fail: false }, records = [], errors = [], api = [], newsRequests = [];
  let ledgerWrites = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'np-weblist.eastmoney.com' && url.pathname === '/comm/web/getFastNewsList') {
      const column = url.searchParams.get('fastColumn');
      newsRequests.push({ column, phase: control.phase, fail: control.fail });
      assert.ok(['101', '104'].includes(column));
      assert.equal(url.searchParams.get('pageSize'), '100');
      return route.fulfill({ status: control.fail ? 500 : 200, contentType: 'application/json', body: JSON.stringify(control.fail ? { error: 'synthetic-source-unavailable' } : { data: { fastNewsList: column === '101' ? rowsFor(control.phase) : [] } }) });
    }
    if (url.origin !== ORIGIN) {
      report.unexpectedRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort();
    }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/records') {
      api.push({ method: request.method() });
      if (!shared) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' });
      assert.equal(url.searchParams.get('sharecode'), 'fixture-only-access');
      if (request.method() === 'POST') {
        const incoming = request.postDataJSON();
        if (incoming.name === 'v6.app.state') ledgerWrites++;
        const index = records.findIndex(record => record.name === incoming.name);
        const record = { ...incoming, id: index < 0 ? 'fixture-' + (records.length + 1) : records[index].id };
        if (index < 0) records.push(record); else records[index] = record;
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, records, record: records[0] }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + (shared ? '/?sharecode=fixture-only-access' : '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.V6NewsPool && document.querySelector('#main [data-module-id="news-pool"]'));
  if (shared) await page.waitForFunction(() => window.V6NewsPool.snapshot.validatedInThisPage === true);
  return { page, control, records, errors, api, newsRequests, get ledgerWrites() { return ledgerWrites; } };
}

async function navigate(page, view) {
  const link = page.locator(`#navigation a[href="#${view}"]`);
  if (await link.isVisible()) await link.click();
  else {
    await page.locator('#mobile-menu-button').click();
    await page.locator(`#menu-dialog a[href="#${view}"]`).click();
  }
  await page.waitForFunction(target => location.hash === '#' + target && document.querySelector('#navigation a.active')?.getAttribute('href') === '#' + target, view);
}

async function installPolicyFixture(page) {
  return page.evaluate(() => {
    const time = '2026-11-13T07:12:00.000Z';
    const stock = (symbol, patch = {}) => ({ symbol, name: '隔离测试科技', sector: '计算机', sectorNode: 'sw1_710000', sectorSource: 'isolated-fixture-classification', sectorUpdatedAt: time, sectorClassificationKnown: true, price: 10, previousClose: 9.8, change: 2, volume: 1e6, amount: 1e8, turnover: 3, marketCap: 1e10, floatMarketCap: 5e9, pe: 10, pb: 1, ma5: 10, ma20: 9, momentum: 8, dayVolumeRatio: 1.5, volatility: 1, providerTime: time, providerDateKnown: true, receivedAt: time, fetchedAt: time, historyGap: false, historyAsOfDate: '2026-11-13', source: 'isolated-public-fixture', ...patch });
    const snapshot = { schemaVersion: 2, source: 'isolated-public-fixture', fetchedAt: time, providerTime: time, stocks: [stock('600001'), stock('600002', { name: '隔离对照科技', marketCap: 2e10, price: 11, pe: 12, pb: 1.2, ma5: 10.5, ma20: 10, momentum: 7, dayVolumeRatio: 1.3 })], universe: { count: 2, complete: true }, indices: [] };
    const realMarket = window.V6Market;
    // Keep stock-click UI behavior, but never let its real-market closure
    // publish a different (empty) quote pool into this news-only fixture.
    window.V6Market = { ...realMarket, snapshot, universe: snapshot.universe, loadSeries: async () => [] };
    window.V6Core.setMarketData(snapshot);
    window.__newsPolicyFixture = { snapshot, state: window.V6Core.createDefaultState(), marketDataVersion: window.V6Core.marketDataVersion };
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const risk = window.V6NewsPool.riskFor(snapshot.stocks[0]);
    const screen = window.V6Policy.screen(window.__newsPolicyFixture.state, snapshot, 'value');
    return { risk, items: screen.items.map(row => row.symbol), pending: screen.pending.map(row => row.symbol), version: window.V6Core.marketDataVersion, quoteObservation: window.V6SelectionClock?.check(snapshot.stocks[0]) };
  });
}

async function policyState(page) {
  return page.evaluate(() => {
    const f = window.__newsPolicyFixture;
    const result = window.V6Policy.screen(f.state, f.snapshot, 'value');
    return { items: result.items.map(row => row.symbol), pending: result.pending.map(row => row.symbol), excluded: result.excluded.map(row => row.symbol), risk: window.V6NewsPool.riskFor(f.snapshot.stocks[0]), marketDataVersion: window.V6Core.marketDataVersion, quoteObservation: window.V6SelectionClock?.check(f.snapshot.stocks[0]), counts: result.counts };
  });
}

async function refreshAt(f, phase, time, { failure = false } = {}) {
  const previous = await f.page.evaluate(() => window.V6NewsPool.snapshot.version);
  f.control.phase = phase; f.control.fail = failure;
  await f.page.clock.setSystemTime(new Date(time));
  await navigate(f.page, 'home');
  await f.page.locator('[data-module-id="news-pool"] [data-news-refresh]').click();
  await f.page.waitForFunction(({ previous, failure }) => window.V6NewsPool.snapshot.version > previous && (failure ? !!window.V6NewsPool.snapshot.lastError : window.V6NewsPool.snapshot.validatedInThisPage === true), { previous, failure });
}

test('news pool controls, real candidate caches and source failures are safe in mobile and desktop Chromium', { timeout: 150000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const width of [390, 1440]) await t.test(`${width}px source-to-pool-to-candidate flow`, async () => {
    const f = await fixture(browser, width), { page } = f;
    try {
      const pool = page.locator('#main [data-module-id="news-pool"]');
      assert.equal(await pool.count(), 1);
      const toggle = pool.locator('[data-module-toggle]').first();
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await pool.locator('[data-news-filter="unknown"]').click();
      assert.equal(await pool.locator('[data-news-id="fixture-unknown"]').count(), 1);
      assert.equal(await pool.locator('[data-news-id="fixture-future"]').count(), 1);
      await pool.locator('[data-news-filter="good"]').click();
      assert.equal(await pool.locator('[data-news-id="fixture-main"]').count(), 1);
      await pool.locator('[data-news-filter="all"]').click();
      assert.equal(await pool.locator('img,script').count(), 0, 'news content became executable markup');
      assert.equal(await page.evaluate(() => window.__newsXss), undefined);
      assert.deepEqual(await pool.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => /^(?:javascript|data):/i.test(href || ''))), []);
      let initial = await installPolicyFixture(page);
      assert.equal(initial.risk.status, 'checked'); assert.deepEqual(initial.items, ['600001']);
      assert.equal(initial.quoteObservation?.ok, true, 'news cache test began with a quote already rejected by the source clock');
      assert.equal(initial.quoteObservation.code, 'latest-close-observation');
      await page.waitForFunction(() => !!document.querySelector('.tj-signals-panel [data-focus="600001"]'));
      const directLink = pool.locator('[data-news-id="fixture-main"] [data-news-linkage="direct"][data-focus="600001"]');
      assert.equal(await directLink.count(), 1); assert.match(await directLink.innerText(), /600001/);
      assert.match(await directLink.innerText(), /隔离测试科技/, 'direct association lost the supplied stock name');
      await directLink.click();
      await page.waitForFunction(() => document.querySelector('.tj-linkage')?.textContent.includes('600001'));
      await page.waitForFunction(version => window.V6Core.marketDataVersion > version, initial.version);
      // Focus selection legitimately re-applies its quote snapshot. Start the
      // unchanged-market cache assertions only after that work has completed.
      initial = await installPolicyFixture(page);
      assert.deepEqual(initial.items, ['600001']);
      const ledgerBefore = f.records.find(record => record.name === 'v6.app.state')?.content;
      assert.equal(typeof ledgerBefore, 'string', 'fixture account was never created');
      const ledgerWritesBefore = f.ledgerWrites;
      await refreshAt(f, 'bad', START + 360000);
      const blocked = await policyState(page);
      assert.equal(blocked.risk.status, 'blocked');
      assert.equal(blocked.marketDataVersion, initial.version, 'candidate input changed during news-only test: '+JSON.stringify({width,initial,blocked}));
      assert.ok(blocked.excluded.includes('600001'), 'negative did not exclude candidate: '+JSON.stringify({width,initial,blocked})); assert.ok(!blocked.items.includes('600001'));
      assert.equal(blocked.quoteObservation?.ok, true, 'a stale quote masked the news exclusion');
      assert.equal(blocked.marketDataVersion, initial.version, 'test accidentally invalidated market caches instead of news caches');
      await page.waitForFunction(() => !document.querySelector('.tj-signals-panel [data-focus="600001"]'));
      assert.equal(await pool.locator('[data-news-id="fixture-main"]').count(), 1, 'revised ID left a second old positive row');
      assert.match(await pool.locator('[data-news-id="fixture-main"]').innerText(), /减持/);
      assert.ok(blocked.risk.articles.some(row => row.id === 'fixture-good-counter' && row.sentiment === 'good'), 'test omitted the simultaneous positive article');
      assert.equal(blocked.risk.status, 'blocked', 'positive news cancelled a separate negative article');
      if (process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, { recursive: true });
        await pool.screenshot({ path: path.join(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, `news-negative-${width}.png`) });
      }
      await navigate(page, 'picks');
      const review = page.locator('[data-module-id="news-push-review"]');
      assert.equal(await review.count(), 1); assert.match(await review.innerText(), /600001/);
      if (process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR) await review.screenshot({ path: path.join(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, `news-exclusion-${width}.png`) });
      await refreshAt(f, 'industry', START + 720000);
      const indirect = await policyState(page);
      assert.equal(indirect.risk.status, 'blocked');
      assert.ok(indirect.risk.articles.some(row => row.id === 'fixture-sector' && row.linkage === 'indirect'));
      assert.ok(indirect.risk.reasons.some(reason => /间接/.test(reason)));
      const indirectLink = pool.locator('[data-news-id="fixture-sector"] [data-news-linkage="indirect"][data-focus="600001"]');
      assert.equal(await indirectLink.count(), 1);
      assert.match(await indirectLink.innerText(), /隔离测试科技/, 'indirect member lost the supplied stock name');
      await refreshAt(f, 'clear', START + 1080000);
      const clear = await policyState(page);
      assert.equal(clear.risk.status, 'checked'); assert.deepEqual(clear.items, ['600001']);
      await page.waitForFunction(() => !!document.querySelector('.tj-signals-panel [data-focus="600001"]'));
      await pool.locator('[data-news-filter="retracted"]').click();
      assert.equal(await pool.locator('[data-news-id="fixture-main"]').count(), 1);
      assert.equal(await pool.locator('[data-news-id="fixture-sector"]').count(), 1);
      await pool.locator('[data-news-filter="all"]').click();
      const newsSourceTime = await page.evaluate(() => window.V6NewsPool.snapshot.items.find(row => row.id === 'fixture-main').publishedAt);
      await page.clock.setSystemTime(new Date(START + 1686000));
      const expired = await policyState(page);
      assert.equal(expired.risk.status, 'unknown'); assert.ok(expired.pending.includes('600001')); assert.ok(!expired.items.includes('600001'));
      assert.equal(expired.quoteObservation?.ok, true, 'TTL test was actually stopped by a quote failure');
      assert.ok(expired.counts.newsPending > 0);
      assert.equal(expired.marketDataVersion, initial.version);
      assert.equal(await page.evaluate(() => window.V6NewsPool.snapshot.items.find(row => row.id === 'fixture-main').publishedAt), newsSourceTime, 'TTL check rewrote original publication time');
      await refreshAt(f, 'clear', START + 2040000, { failure: true });
      const failed = await policyState(page);
      assert.equal(failed.risk.status, 'unknown'); assert.ok(failed.pending.includes('600001'));
      assert.equal(failed.quoteObservation?.ok, true, 'source failure test was actually stopped by a quote failure');
      await page.waitForFunction(() => !document.querySelector('.tj-signals-panel [data-focus="600001"]'));
      assert.equal(f.ledgerWrites, ledgerWritesBefore, 'news collection/filter changed the shared account');
      assert.equal(f.records.find(record => record.name === 'v6.app.state')?.content, ledgerBefore);
      const sharedNews = f.records.find(record => record.name === 'v6.news.pool');
      assert.ok(sharedNews, 'public news was not shared through the existing records boundary');
      const sharedPayload = await page.evaluate(async content => window.V6StorageCodec.decode(content), sharedNews.content);
      assert.equal(sharedPayload.kind, 'workbuddy-news-pool');
      assert.ok(!['positions', 'cash', 'orders', 'watchlist'].some(key => Object.hasOwn(sharedPayload, key)), 'news record included account state');
      const calls = await page.evaluate(() => window.__newsBrowserFixture.calls);
      assert.ok(calls.filter(call => call.kind === 'news').length >= 8);
      assert.deepEqual(calls.filter(call => call.kind !== 'news'), [], 'after-close news collection started quote/history or another public transport');
      assert.equal(await page.evaluate(() => window.V6Market.status.collectionEnabled), false);
      assert.deepEqual(f.errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 2);
      if (process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, { recursive: true });
        await pool.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, `news-pool-${width}.png`), fullPage: true });
        await navigate(page, 'picks');
        await page.screenshot({ path: path.join(process.env.V6_WORKBUDDY_NEWS_SCREENSHOT_DIR, `news-review-${width}.png`), fullPage: true });
      }
      report.viewports.push({ width, sourceCalls: calls.length, initial: { items: initial.items }, blocked: { status: blocked.risk.status, excluded: blocked.excluded }, indirect: indirect.risk.status, retracted: clear.risk.status, expired: expired.risk.status, sourceFailure: failed.risk.status, marketDataVersionUnchanged: failed.marketDataVersion === initial.version, sourceQuoteRemainedValid: failed.quoteObservation.ok && expired.quoteObservation.ok, ledgerUnchanged: true, pageErrors: f.errors });
    } finally { await page.close(); }
  });
  assert.deepEqual(report.unexpectedRequests, []);
});

test('missing runtime share parameter starts neither news nor account transport', { timeout: 45000 }, async t => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const f = await fixture(browser, 390, { shared: false });
  t.after(() => f.page.close());
  await f.page.waitForTimeout(200);
  assert.equal(f.api.length, 0); assert.equal(f.newsRequests.length, 0);
  assert.deepEqual(await f.page.evaluate(() => window.__newsBrowserFixture.calls), []);
  assert.deepEqual(f.errors, []); assert.deepEqual(report.unexpectedRequests, []);
  report.missingShare = { accountRequests: 0, newsRequests: 0, pageErrors: [] };
  if (process.env.V6_WORKBUDDY_NEWS_REPORT) fs.writeFileSync(process.env.V6_WORKBUDDY_NEWS_REPORT, JSON.stringify(report, null, 2) + '\n');
});
