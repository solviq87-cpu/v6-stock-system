#!/usr/bin/env node
'use strict';
// Real native app, real isolated backend and synthetic CSV only. This does not
// authenticate market data or write to a user's account or production model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createFixture } = require('../tests/helpers/v6-studio-fixture');
const W = require('../src/core/research-workspace');
const { fixture } = require('../tests/helpers/research-workspace-fixtures');

const dates = [];
for (let date = new Date('2026-07-01T00:00:00Z'); dates.length < 65;
  date = new Date(date.getTime() + 86400000)) {
  if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
}
const stockHeader = '代码,名称,日期,开盘,最高,最低,收盘,成交量,涨停价,所属板块,来源,数据截至,黑天鹅,可重复标准样本';
const stockRows = dates.map((date, index) => [
  '000001', '合成学习', date, 10, index === 30 ? 11.1 : 10.2, 9.9,
  index === 30 ? 11 : 10, index === 30 ? 300000 : 100000, 11,
  '合成题材', 'synthetic-stock', date + 'T15:10:00+08:00', index === 50 ? '是' : '否', '是',
].join(','));
const stockCSV = stockHeader + '\n' + stockRows.slice(0, 60).join('\n');
const appendedCSV = stockHeader + '\n' + stockRows.slice(60).join('\n');
const sectorCSV = '板块,日期,收盘,来源,数据截至,题材阶段\n' +
  dates.map((date, index) => `合成题材,${date},${100 + index},synthetic-sector,${date}T15:10:00+08:00,发酵`).join('\n');
const marketCSV = '日期,收盘,全A趋势,来源,数据截至\n' +
  dates.map((date, index) => `${date},${1000 + index},多头,synthetic-market,${date}T15:10:00+08:00`).join('\n');
const file = (name, contents) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(contents) });

async function geometry(page, label) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    duplicateIds: [...document.querySelectorAll('[id]')].map(node => node.id)
      .filter((id, index, all) => all.indexOf(id) !== index),
    iframes: document.querySelectorAll('iframe').length,
  }));
  assert.ok(result.scrollWidth <= result.width + 1,
    label + ' has no horizontal page overflow: ' + JSON.stringify(result));
  assert.deepEqual(result.duplicateIds, [], label + ' has no duplicate DOM IDs');
  assert.equal(result.iframes, 0, label + ' uses native modules');
  return result;
}

(async () => {
  const f = await createFixture({ count: 1 });
  let browser;
  try {
    W.saveObservation(fixture(), { workspaceRoot: path.join(f.tmp, 'data', 'research-workspace') },
      { requestId: 'synthetic_kline_browser_source' });
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.V6_UI_BROWSER || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const origin = 'http://127.0.0.1:' + f.port;
    const checks = [];
    for (const width of [320, 390, 1366]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 },
        serviceWorkers: 'block', acceptDownloads: true });
      await context.addInitScript(token => {
        localStorage.setItem('qd_device', token);
        localStorage.setItem('qd_role', 'edit');
      }, f.token);
      const page = await context.newPage();
      const errors = [], external = [], calls = [], responses = [];
      page.on('response', response => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        responses.push(response.text().then(raw => {
          let detail='';
          try { detail=JSON.parse(raw).error||''; } catch {}
          errors.push(response.status()+' '+response.request().method()+' '+url.pathname+' '+String(detail).slice(0,160));
        }, () => errors.push(response.status()+' '+url.pathname)));
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/'))
          calls.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() });
      });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { external.push(url.href); return route.abort(); }
        return route.continue();
      });
      await page.goto(origin + '/#/lab/learning');
      await page.getByRole('heading', { name: '战法验证与智能学习中心', exact: true }).waitFor();
      const tabs = page.getByRole('navigation', { name: '智能学习中心分区', exact: true });
      await tabs.getByRole('button', { name: '已有学习进度', exact: true }).waitFor();
      assert.equal(await tabs.evaluate(nav => nav.querySelectorAll('button').length), 4);
      await page.getByLabel('历史日K CSV（必选）', { exact: true }).setInputFiles(file('synthetic-stock.csv', stockCSV));
      await page.getByLabel('同期板块 CSV', { exact: true }).setInputFiles(file('synthetic-sector.csv', sectorCSV));
      await page.getByLabel('同期全A指数 CSV', { exact: true }).setInputFiles(file('synthetic-market.csv', marketCSV));
      await page.getByRole('button', { name: '导入并自动标注', exact: true }).click();
      await page.getByText(/^已生成60条历史标签/).waitFor();
      assert.equal(await page.getByText('K线样本', { exact: true }).locator('..').locator('strong').innerText(), '60');
      const initial = await geometry(page, 'history-import-' + width);

      // Correct a missed signal on a previously unlabelled bar, then preserve
      // both decisions when undoing the annotation.
      await page.getByLabel('样本范围', { exact: true }).selectOption('missing');
      await page.getByLabel('按信号日期筛选', { exact: true }).fill(dates[59]);
      await page.getByRole('button', { name: `合成学习 000001 · ${dates[59]}`, exact: true }).click();
      await page.getByLabel('修正战法', { exact: true }).selectOption('弱转强');
      await page.getByLabel('人工修正原因', { exact: true }).fill('合成漏标纠正证据');
      await page.getByRole('button', { name: '保存本次人工修正', exact: true }).click();
      await page.getByLabel('样本范围', { exact: true }).selectOption('signals');
      await page.getByLabel('战法筛选', { exact: true }).selectOption('弱转强');
      assert.equal(await page.getByRole('button', { name: `合成学习 000001 · ${dates[59]}`, exact: true }).count(), 1);
      await page.getByLabel('修正动作', { exact: true }).selectOption('remove');
      await page.getByLabel('人工修正原因', { exact: true }).fill('合成复核后撤销');
      await page.getByRole('button', { name: '保存本次人工修正', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: `合成学习 000001 · ${dates[59]}`, exact: true }).count(), 0);
      await page.getByLabel('战法筛选', { exact: true }).selectOption('');
      await page.getByLabel('按信号日期筛选', { exact: true }).fill('');
      await page.getByLabel('样本范围', { exact: true }).selectOption('all');
      await geometry(page, 'corrected-history-' + width);

      // The same native manual ledger remains connected to the actual isolated
      // HTTP service. Merely switching tabs must not submit a trade or plan.
      await tabs.getByRole('button', { name: '人工交易样本', exact: true }).click();
      await page.locator('[data-manual-loop]').waitFor();
      const manualForm = page.locator('form').filter({
        has: page.getByRole('heading', { name: '冻结一条建议', exact: true }) });
      await manualForm.locator('[name=shares]').fill('200');
      assert.ok(calls.some(call => call.path === '/api/research/manual-loop' && call.method === 'GET'));
      await geometry(page, 'manual-tab-' + width);
      await tabs.getByRole('button', { name: '战法校验与回测', exact: true }).click();
      for (const name of ['规则交叉检验', '战法实验台', '历史实验', '四套策略的独立归属', '原生策略逐日回放'])
        await page.getByRole('heading', { name, exact: true }).waitFor();
      await geometry(page, 'verify-tab-' + width);
      await tabs.getByRole('button', { name: '已有学习进度', exact: true }).click();
      await page.getByRole('heading', { name: '学习进度与复访', exact: true }).waitFor();
      await geometry(page, 'progress-tab-' + width);
      await tabs.getByRole('button', { name: '人工交易样本', exact: true }).click();
      assert.equal(await manualForm.locator('[name=shares]').inputValue(), '200', 'manual draft survives tab switching');
      await tabs.getByRole('button', { name: '历史K线样本', exact: true }).click();
      assert.equal(await page.getByText('K线样本', { exact: true }).locator('..').locator('strong').innerText(), '60');

      await page.getByLabel('追加日K CSV（可选）', { exact: true }).setInputFiles(file('synthetic-more.csv', appendedCSV));
      await page.getByRole('button', { name: '追加新日K并重新计算', exact: true }).click();
      await page.getByText(/^新增 5 根日K/).waitFor();
      assert.equal(await page.getByText('K线样本', { exact: true }).locator('..').locator('strong').innerText(), '65');
      // Selecting an unimported file must not silently relabel the provenance
      // of the dataset and corrections already calculated.
      await page.getByLabel('历史日K CSV（必选）', { exact: true }).setInputFiles(file('unimported.csv', stockCSV));
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出回测学习报告 JSON', exact: true }).click();
      const download = await downloaded;
      const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.equal(report.mode, 'offline-observational-research');
      assert.equal(report.report.counts.bars, 65);
      assert.equal(report.samples.length + report.blackSwanSamples.length, 65);
      assert.equal(report.blackSwanSamples.length, 1);
      assert.equal(report.corrections.length, 2);
      assert.deepEqual(report.corrections.map(item => item.action), ['add', 'remove']);
      assert.equal(report.sourceFiles.stock, 'synthetic-stock.csv');
      assert.deepEqual(report.sourceFiles.appendedStock, ['synthetic-more.csv']);
      assert.ok(!report.samples.find(item => item.date === dates[59]).signals.some(item => item.name === '弱转强'));
      assert.ok(calls.some(call => call.method === 'GET' && call.path === '/api/research/shortline'),
        'native historical learning reads the authorized shortline archive');
      assert.equal(calls.filter(call => call.method !== 'GET').length, 0,
        'local import, corrections and tab changes never write an account or upload CSV');
      await Promise.all(responses);
      assert.deepEqual(errors, [], 'no browser errors at ' + width);
      assert.deepEqual(external, [], 'no external requests at ' + width);
      const final = await geometry(page, 'exported-history-' + width);
      if (process.env.V6_UI_QA_DIR) {
        fs.mkdirSync(process.env.V6_UI_QA_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.V6_UI_QA_DIR, 'synthetic-kline-learning-' + width + '.png'), fullPage: true });
      }
      checks.push({ width, initial, final, imported: 60, appended: 5, correctionEvents: report.corrections.length,
        actualAppRoute: true, actualManualHttp: true, allFourTabs: true });
      await context.close();
    }
    console.log(JSON.stringify({ ok: true, checks, productionReleased: false }));
  } finally {
    await browser?.close();
    await f.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
