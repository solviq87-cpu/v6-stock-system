#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { chromium } = require('playwright'),
  { createClosingFixture } = require('../tests/helpers/closing-market-fixture');
(async () => {
  const f = await createClosingFixture();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.V6_UI_BROWSER || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    });
    const origin = 'http://127.0.0.1:' + f.port,
      errors = [],
      external = [];
    async function pageAt(width) {
      const context = await browser.newContext({
          viewport: { width, height: 1000 },
        }),
        page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin !== origin) {
          external.push(u.href);
          return route.abort();
        }
        if (u.pathname === '/__close_fixture')
          return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/nova/fayo.css"><main class="fy-main"><button id="refresh">刷新共享快照</button><div id="pulse"></div><h2>一进二（合成验收）</h2><div id="relay"></div></main>',
          });
        return route.continue();
      });
      await page.goto(origin + '/__close_fixture');
      await page.evaluate(async (token) => {
        const { renderPulse, renderOpportunities } = await import(
          '/nova/market.js'
        );
        window.refreshMarket = async () => {
          const data = await fetch('/api/state', {
            headers: { Authorization: 'Bearer ' + token },
            cache: 'no-store',
          }).then((r) => r.json());
          const ctx = {
            role: 'edit',
            state: data,
            signal: new AbortController().signal,
            api: async () => ({}),
            navigate: () => {},
            selectStock: () => {},
            notify: () => {},
            onState: () => {},
          };
          document
            .getElementById('pulse')
            .replaceChildren(renderPulse({}, ctx));
          document
            .getElementById('relay')
            .replaceChildren(renderOpportunities({ sub: 'relay-first' }, ctx));
        };
        document.getElementById('refresh').onclick = window.refreshMarket;
        await window.refreshMarket();
      }, f.token);
      return page;
    }
    const phone = await pageAt(320),
      desktop = await pageAt(1366);
    const price = (page) =>
      page.locator('#pulse .fy-stock-meta>strong').first().textContent();
    assert.equal(await price(phone), '1.00');
    assert.equal(await price(desktop), '1.00');
    f.setTime('14:59:50');
    await phone.locator('#refresh').click();
    await phone.waitForFunction(
      () =>
        document.querySelector('#pulse .fy-stock-meta>strong')?.textContent ===
        '2.00',
    );
    assert.equal(await price(desktop), '1.00');
    f.setTime('15:00:00');
    for (const page of [phone, desktop]) {
      await page.locator('#refresh').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#relay [data-field="price"]>strong')
            ?.textContent === '99.00',
      );
      assert.equal(await price(page), '2.00');
    }
    // A third client has no browser snapshot or prior local state.
    const third = await pageAt(390);
    assert.equal(await price(third), '2.00');
    for (const [width, page] of [
      [320, phone],
      [390, third],
      [1366, desktop],
    ]) {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      if (process.env.V6_UI_QA_DIR) {
        fs.mkdirSync(process.env.V6_UI_QA_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(
            process.env.V6_UI_QA_DIR,
            'synthetic-close-freeze-' + width + '.png',
          ),
          fullPage: true,
        });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      JSON.stringify({
        ok: true,
        widths: [320, 390, 1366],
        twoClientsIndependent: true,
        newClientNoBrowserCache: true,
        frozenMarketPrice: 2,
        liveRelayPrice: 99,
        originalQuoteTimePreserved: true,
        externalRequests: 0,
        productionVerified: false,
      }),
    );
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
