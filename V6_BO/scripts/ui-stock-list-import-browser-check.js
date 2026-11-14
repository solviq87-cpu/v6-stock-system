#!/usr/bin/env node
'use strict';
// Serve actual workbench assets; all API replies are isolated test fixtures.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');
const output = process.env.V6_UI_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'v6-stock-import-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: '合成权限拒绝' })); return;
  }
  if (pathname !== '/research.html' && !/^\/assets\/[a-zA-Z0-9.-]+$/.test(pathname)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(fs.readFileSync(path.join(root, pathname.slice(1))));
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.V6_UI_BROWSER || undefined, args: ['--no-sandbox'] });
    for (const width of [320, 390, 430, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [], calls = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      page.on('request', r => { if (r.url().includes('/api/')) calls.push({ url: r.url(), method: r.method(), body: r.postData() }); });
      await page.goto('http://127.0.0.1:' + server.address().port + '/research.html', { waitUntil: 'networkidle' });
      await page.locator('#token').fill('synthetic-test-token');
      await page.locator('#stockListImport summary').first().click();
      const before = calls.length;
      await page.locator('#stockListText').fill('代码,名称,数量\n000001,测试甲,600519\n600000,测试乙,100\nSZ000001,测试甲,0\nsh000001,指数,0');
      await page.locator('#stockListParse').click();
      assert.equal(await page.locator('#stockListStatus').innerText(), '2 只待核验 · 1 条重复 · 1 条未识别');
      assert.equal(calls.length, before, 'preview must not call any API');
      await page.locator('#captureSummary').evaluate(n => { n.textContent = 'OLD RESULT'; });
      await page.getByRole('button', { name: '选择研究 000001', exact: true }).click();
      assert.equal(await page.locator('#captureSymbol').inputValue(), '000001');
      assert.equal(await page.locator('#captureSummary').innerText(), '');
      assert.equal(calls.length, before, 'selection must not capture');
      await page.locator('#captureRun').click();
      await page.waitForFunction(() => document.querySelector('#captureStatus').textContent.includes('合成权限拒绝'));
      const capture = calls.filter(x => x.url.endsWith('/api/research/observe-stock'));
      assert.equal(capture.length, 1); assert.equal(JSON.parse(capture[0].body).symbol, '000001');
      await page.locator('#stockListFile').setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('code,name\n600519,<img onerror=bad>') });
      await page.getByRole('button', { name: '选择研究 600519', exact: true }).waitFor();
      assert.equal(await page.locator('#stockListPreview img').count(), 0);
      await page.locator('#stockListText').fill('000001,600000');
      assert.equal(await page.locator('#stockListPreview button').count(), 0);
      await page.locator('#stockListParse').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow at ' + width);
      const rows = await page.locator('.stock-import-row').evaluateAll(nodes => nodes.map(n => ({ right: n.getBoundingClientRect().right, width: n.clientWidth, scroll: n.scrollWidth })));
      assert.ok(rows.every(r => r.right <= width && r.scroll <= r.width), 'preview rows fit at ' + width);
      await page.locator('#stockCapture').screenshot({ path: path.join(output, 'stock-import-' + width + '.png') });
      await page.locator('#token').fill('changed-test-token');
      assert.equal(await page.locator('#stockListText').inputValue(), '');
      assert.equal(await page.locator('#stockListPreview button').count(), 0);
      assert.deepEqual(errors, []); await page.close();
      console.log('PASS: stock import preview, selection, permission rejection, file, clear and layout at ' + width);
    }
    console.log('Screenshots: ' + output);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
