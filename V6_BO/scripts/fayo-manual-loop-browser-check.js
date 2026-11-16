#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict'),
  path = require('node:path');
const { chromium } = require('playwright'),
  { createFixture } = require('../tests/helpers/v6-studio-fixture');
const W = require('../src/core/research-workspace'),
  { fixture } = require('../tests/helpers/research-workspace-fixtures');
(async () => {
  const f = await createFixture({ count: 1 });
  let browser;
  try {
    W.saveObservation(
      fixture(),
      { workspaceRoot: path.join(f.tmp, 'data', 'research-workspace') },
      { requestId: 'synthetic_browser_source' },
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.V6_UI_BROWSER || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    });
    const origin = 'http://127.0.0.1:' + f.port,
      errors = [],
      external = [];
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) {
        external.push(u.href);
        return route.abort();
      }
      if (u.pathname === '/__manual_loop_test')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/nova/fayo.css"><main id="mount" class="fy-main"></main>',
        });
      return route.continue();
    });
    await page.goto(origin + '/__manual_loop_test');
    await page.evaluate(
      async ({ token }) => {
        const { renderOperations } = await import('/nova/operations.js');
        window.calls = [];
        window.testRole = 'edit';
        window.renderLoop = () => {
          window.controller?.abort();
          window.controller = new AbortController();
          window.listeners = [];
          const ctx = {
            get role() {
              return window.testRole;
            },
            signal: window.controller.signal,
            onState: (fn) => window.listeners.push(fn),
            notify: () => {},
            navigate: () => {},
            api: async (url, options = {}) => {
              window.calls.push({
                url,
                method: options.method || 'GET',
                body: options.body,
              });
              const r = await fetch(url, {
                ...options,
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
                body: options.body ? JSON.stringify(options.body) : undefined,
                cache: 'no-store',
              });
              return r.json();
            },
          };
          document
            .getElementById('mount')
            .replaceChildren(
              renderOperations({ view: 'assets', sub: 'closure' }, ctx),
            );
        };
        window.renderLoop();
      },
      { token: f.token },
    );
    const form = (name) =>
      page
        .locator('form')
        .filter({ has: page.getByRole('heading', { name, exact: true }) });
    const wait = async () => {
      try {
        await page.waitForFunction(() =>
          document.querySelector('[data-manual-loop]'),
        );
      } catch (e) {
        console.error(
          await page.locator('body').innerText(),
          await page.evaluate(() => window.calls),
          errors,
        );
        throw e;
      }
    };
    async function submit(name, values) {
      const box = form(name);
      for (const [key, value] of Object.entries(values)) {
        const control = box.locator(`[name="${key}"]`);
        if (await control.evaluate((e) => e.tagName === 'SELECT'))
          await control.selectOption(String(value));
        else await control.fill(String(value));
      }
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/research/manual-loop' &&
          r.request().method() === 'POST',
      );
      await box.locator('button[type=submit]').click();
      const saved = await (await response).json();
      if (saved.ok)
        await page.waitForFunction(
          (revision) =>
            document.querySelector('[data-manual-loop]')?.dataset
              .loopRevision === String(revision),
          saved.result.revision,
        );
    }
    for (const width of [320, 390, 1366]) {
      await page.setViewportSize({ width, height: 1000 });
      await wait();
      const before = (await f.request('/api/research/manual-loop')).body.result
        .revision;
      await submit('冻结一条建议', { shares: 100, limitPrice: '10' });
      await page.waitForFunction(() =>
        document
          .querySelector('[data-manual-loop]')
          ?.textContent.includes('计划 100 股'),
      );
      assert.equal(
        (await f.request('/api/research/manual-loop')).body.result.revision,
        before + 1,
      );
      const prefix = 'synthetic-ui-' + width;
      const buy = {
          reference: prefix + '-buy',
          side: 'buy',
          quantity: 100,
          price: '10',
          fee: '5',
          executedAt: '2026-11-12T10:00:00+08:00',
        },
        sell = {
          reference: prefix + '-sell',
          side: 'sell',
          quantity: 100,
          price: '11',
          fee: '6',
          executedAt: '2026-11-13T10:00:00+08:00',
        };
      for (const row of [buy, sell]) {
        await submit('登记人工成交', {
          ...row,
          executedAt: row.executedAt.slice(0, 16),
        });
        await page.waitForFunction(
          (ref) =>
            [...document.querySelectorAll('td')].some(
              (e) => e.textContent === ref,
            ),
          row.reference,
        );
      }
      await submit('核对交割记录', {
        sourceLabel: 'synthetic independent user statement',
        rows: JSON.stringify([buy, { ...sell, fee: '7' }]),
      });
      await page
        .getByText('交割记录不一致，不能完成复盘。', { exact: true })
        .waitFor();
      assert.equal(await form('冻结复盘').count(), 0);
      await submit('核对交割记录', {
        sourceLabel: 'synthetic corrected statement',
        rows: JSON.stringify([buy, sell]),
      });
      await form('冻结复盘').waitFor();
      await submit('冻结复盘', { note: '合成浏览器复盘，扣除费用后净额89元' });
      await page
        .getByRole('heading', { name: '已冻结复盘', exact: true })
        .waitFor();
      await submit('提交验证候选', {
        hypothesis: '合成未来验证候选',
        trainEnd: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
        validationEnd: '2026-12-31',
        holdoutEnd: '2027-02-01',
      });
      await page.getByText('等待冻结期及私有数据', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: '运行冻结验证', exact: true })
        .click();
      await page.getByText('冻结样本外期尚未结束', { exact: true }).waitFor();
      assert.ok(
        (await page.locator('[data-manual-loop]').innerText()).includes(
          '89.00',
        ),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        'no horizontal page overflow at ' + width,
      );
      if (process.env.V6_UI_QA_DIR) {
        fs.mkdirSync(process.env.V6_UI_QA_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(
            process.env.V6_UI_QA_DIR,
            'synthetic-manual-loop-' + width + '.png',
          ),
          fullPage: true,
        });
      }
    }
    // Editing a draft never writes or gets overwritten by automatic state events.
    const box = form('冻结一条建议');
    await box.locator('[name=shares]').fill('200');
    const count = await page.evaluate(
      () => window.calls.filter((c) => c.method === 'POST').length,
    );
    await page.evaluate(() => window.listeners.forEach((fn) => fn()));
    assert.equal(await box.locator('[name=shares]').inputValue(), '200');
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((c) => c.method === 'POST').length,
      ),
      count,
    );
    // A role downgrade clears already rendered private data, including dirty drafts.
    await page.evaluate(() => {
      window.testRole = 'view';
      window.listeners.forEach((fn) => fn());
    });
    await page.getByText('这是你的私人工作区', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-manual-loop]').count(), 0);
    await page.evaluate(() => {
      window.testRole = 'edit';
      window.renderLoop();
    });
    await wait();
    await submit('冻结一条建议', { shares: 100, limitPrice: '10' });
    await form('记为未执行').waitFor();
    await submit('记为未执行', { reason: '合成浏览器未执行' });
    await form('冻结复盘').waitFor();
    await submit('冻结复盘', { note: '保留未执行，不估算收益' });
    await page
      .getByRole('heading', { name: '已冻结复盘', exact: true })
      .waitFor();
    // Simulate a stale second device: user sees a conflict, no silent overwrite.
    const v = (await f.request('/api/research/manual-loop')).body.result;
    await f.request('/api/research/manual-loop', 'POST', {
      action: 'freeze',
      runId: v.plans[0].runId,
      shares: 100,
      limitPrice: '10',
      expectedRevision: v.revision,
      requestId: 'synthetic_second_device',
    });
    await submit('冻结一条建议', { shares: 300, limitPrice: '10' });
    await page
      .getByText('另一端已更新，请重新读取后再操作', { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      JSON.stringify({
        ok: true,
        widths: [320, 390, 1366],
        actualHttp: true,
        roundtrips: 3,
        statementMismatchBlocked: true,
        feesChecked: true,
        unexecuted: true,
        roleDowngrade: true,
        draftPreserved: true,
        staleDeviceBlocked: true,
        productionReleased: false,
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
