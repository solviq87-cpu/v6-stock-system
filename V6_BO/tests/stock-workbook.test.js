'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { workbook, sheet, ns } = require('./helpers/stock-workbook-fixture');
const { runStockWorkbookJob: run, MAX_REQUEST } = require('../src/server/stock-workbook-job');
const payload = options => ({ base64: workbook(options).toString('base64') });
test('XLSX preserves text zeroes, numeric full codes, names, deduplication and rejects formulas/short numbers', async () => {
  const r = await run(payload({ sheets: [{ name: '股票', rows: [['数量', '代码', '名称'],
    ['600519', '000001', '测试甲'], ['1', { xml: '<v>600000</v>' }, '测试乙'],
    ['0', 'SZ000001', '不同名称'], ['0', { xml: '<f>600519</f><v>600519</v>' }, '公式'],
    ['0', { attrs: 's="1"', xml: '<v>1</v>' }, '前导零丢失'],
    ['0', 'SH000001', '指数'], ['0', '600519', '<img onerror=x>']] }] }));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.preview.items.map(x => x.code), ['000001', '600000', '600519']);
  assert.equal(r.result.preview.duplicates[0].nameConflict, true);
  assert.equal(r.result.preview.rejected.length, 3);
  assert.equal(r.result.preview.rejected[0].line, 5);
  assert.ok(r.result.preview.items.every(i => i.identityVerified === false));
  assert.equal(r.result.canTrade, false); assert.equal(r.result.persisted, false);
  assert.equal(Object.hasOwn(r.result, 'rows'), false);
});
test('multiple sheets require explicit selection; hidden/unknown sheets fail and no implicit merge', async () => {
  const p = payload({ sheets: [
    { name: '一', rows: [['代码'], ['000001']] }, { name: '二', rows: [['symbol'], ['600000']] },
    { name: '隐藏', hidden: true, rows: [['code'], ['600519']] }] });
  const first = await run(p); assert.equal(first.result.selected, null); assert.equal(first.result.preview, null);
  const second = await run({ ...p, sheet: '二' }); assert.deepEqual(second.result.preview.items.map(x => x.code), ['600000']);
  for (const name of ['隐藏', '不存在']) assert.equal((await run({ ...p, sheet: name })).ok, false);
});
test('shared strings and rich text are read without phonetic annotations; sparse rows retain source line', async () => {
  const r = await run(payload({ entries: {
    'xl/sharedStrings.xml': `<sst xmlns="${ns}"><si><t>代码</t></si><si><r><t>000</t></r><r><t>001</t></r><rPh><t>ignored</t></rPh></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c></row><row r="5"><c r="B5" t="s"><v>1</v></c></row></sheetData></worksheet>`
  } }));
  assert.equal(r.ok, true, r.error); assert.equal(r.result.preview.items[0].code, '000001'); assert.equal(r.result.preview.items[0].line, 5);
});
test('headers cannot be guessed from a portfolio, duplicated or recovered from stock names', async () => {
  for (const rows of [[['600519', '000001']], [['code', 'symbol'], ['000001', '600000']], [['名称'], ['000001']]]) {
    const r = await run(payload({ sheets: [{ name: '一', rows }] })); assert.equal(r.ok, false);
  }
  const r = await run(payload({ sheets: [{ name: '一', rows: [['code', 'name'], ['BAD', '000001']] }] }));
  assert.equal(r.result.preview.items.length, 0); assert.equal(r.result.preview.rejected.length, 1);
});
test('row, symbol, byte, archive expansion and cell limits fail as a whole', async () => {
  const cases = [
    payload({ sheets: [{ name: '一', rows: [['代码'], ...Array.from({ length: 101 }, (_, i) => [String(600000 + i)])] }] }),
    payload({ sheets: [{ name: '一', rows: [['代码'], ...Array.from({ length: 1000 }, () => ['000001'])] }], compress: true }),
    payload({ entries: { 'xl/bomb.xml': 'x'.repeat(1024 * 1024 + 1) }, compress: true }),
    payload({ sheets: [{ name: '一', rows: [['代码'], ['x'.repeat(4097)]] }] }),
    { base64: Buffer.alloc(512 * 1024 + 1).toString('base64') }, { base64: 'AAAA$===' }
  ];
  for (const p of cases) assert.equal((await run(p)).ok, false);
});
test('malicious ZIP paths, duplicates, macros, external relationships, DTD and merged cells are rejected', async () => {
  const original = sheet([['代码'], ['000001']]);
  const cases = [
    { extra: [['../evil.xml', 'x']] }, { extra: [['xl/workbook.xml', 'x']] },
    { entries: { 'xl/vbaProject.bin': 'x' } },
    { entries: { 'xl/_rels/sheet1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="e" TargetMode="External" Target="https://example.invalid"/></Relationships>' } },
    { entries: { 'xl/worksheets/sheet1.xml': '<!DOCTYPE worksheet [<!ENTITY x "test">]>' + original } },
    { entries: { 'xl/worksheets/sheet1.xml': original.replace('</worksheet>', '<mergeCells/></worksheet>') } },
    { entries: { 'xl/worksheets/sheet1.xml': original.replace('r="A2"', 'r="A1"') } },
    { entries: { 'xl/worksheets/sheet1.xml': Buffer.from(original, 'utf16le').toString('binary') } }
  ];
  for (const options of cases) assert.equal((await run(payload(options))).ok, false);
});
test('formula names and Excel errors are visible rejections; unused amounts never leak into response', async () => {
  const r = await run(payload({ sheets: [{ name: '一', rows: [['code', 'name', '金额'],
    ['000001', { xml: '<f>"SECRET"</f><v>cached-private-name</v>' }, 'private-amount-987'],
    [{ attrs: 't="e"', xml: '<v>#REF!</v>' }, '错误', 'private-amount-987'], ['600000', '测试乙', 'private-amount-987']] }] }));
  assert.equal(r.ok, true, r.error); assert.equal(r.result.preview.rejected.length, 2);
  assert.doesNotMatch(JSON.stringify(r), /SECRET|cached-private|private-amount/);
});
test('only one workbook process can run and the slot is reusable after failure', async () => {
  const p = payload(); const first = run(p); const busy = await run(p);
  assert.match(busy.error, /正在解析/); assert.equal((await first).ok, true);
  assert.equal((await run({ base64: 'AAAA' })).ok, false); assert.equal((await run(p)).ok, true);
});
test('HTTP route requires editor before parsing and bounds requests and methods', async () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const route = server.slice(server.indexOf("  if (p === '/api/research/import-workbook')"), server.indexOf("  if (p === '/api/research/public-factors')"));
  async function call(method, body, editor = true) {
    const calls = [], headers = {}; let result;
    await vm.runInNewContext('(function(){' + route + '})()', { p: '/api/research/import-workbook', req: { method }, body, Buffer,
      requireEditor: () => editor, require: () => ({ MAX_REQUEST, runStockWorkbookJob: async p => { calls.push(p); return { ok: true }; } }),
      res: { setHeader: (k, v) => { headers[k] = v; }, writeHead: code => { result = { code }; }, end: b => { result.body = JSON.parse(b); } } });
    return { calls, result, headers };
  }
  assert.equal((await call('POST', '{}', false)).calls.length, 0);
  for (const [method, body, code] of [['GET', '{}', 405], ['POST', 'x', 400], ['POST', ' '.repeat(MAX_REQUEST + 1), 413]]) {
    const r = await call(method, body); assert.equal(r.result.code, code); assert.equal(r.calls.length, 0);
  }
  const r = await call('POST', '{"base64":"AAAA"}'); assert.equal(r.result.code, 200); assert.equal(r.headers['Cache-Control'], 'no-store');
});
