'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const parser = require('../public/assets/stock-list-parser');
const parse = parser.parseStockList;
test('list separators, leading zeroes and exchange suffixes produce stable deduplicated selection', () => {
  const r = parse('\ufeff000001，SH600000、600000.SH; 300750\nSZ000001；688001');
  assert.deepEqual(r.items.map(x => x.code), ['000001', '600000', '300750', '688001']);
  assert.deepEqual(r.items.map(x => x.exchange), ['SZ', 'SH', 'SZ', 'SH']);
  assert.equal(r.duplicates.length, 2); assert.equal(r.rejected.length, 0);
  assert.ok(r.items.every(x => x.identityVerified === false));
});
test('header table only reads named code column, never balances, positions or price fields', () => {
  const r = parse('名称,数量,代码,价格\n测试甲,600519,000001,600000\n测试乙,0,600000,0');
  assert.deepEqual(r.items.map(x => x.code), ['000001', '600000']);
  assert.equal(r.items[0].name, '测试甲');
  assert.equal(r.format, 'table');
});
test('CSV quoting and copied TSV names preserve cells; duplicate name conflict is visible', () => {
  const r = parse('code,name\r\n"000001","测试,甲"\r\n600000,"测试""乙"\r\n000001,另一名称');
  assert.equal(r.items[0].name, '测试,甲'); assert.equal(r.items[1].name, '测试"乙');
  assert.equal(r.duplicates[0].nameConflict, true);
  assert.equal(parse('代码\t名称\n000001\t测试,甲').items[0].name, '测试,甲');
});
test('unsupported markets, index collisions, exchange conflicts and spreadsheet conversions are explicit rejections', () => {
  const inputs = ['sh000001', '000001.SH', 'sz600000', 'SH600000.SZ', 'bj920001', '920001', '430001', '510300', '399001', 'AAPL', 'hk00700', '2330.TW', '1', '600000.0', '6E5', '=600000', "'000001", '贵州茅台'];
  for (const input of inputs) { const r = parse(input); assert.equal(r.items.length, 0, input); assert.equal(r.rejected.length, 1, input); }
  assert.equal(parse('000001').items[0].exchange, 'SZ');
});
test('malformed table never silently shifts the code field or recovers bad code from its name', () => {
  assert.throws(() => parse('code,symbol\n600000,000001'), /唯一/);
  assert.throws(() => parse('名称\n测试甲'), /唯一/);
  assert.throws(() => parse('code,name,name\n600000,a,b'), /唯一/);
  const r = parse('code,name\n600000,测试甲,extra\nBAD,000001\n600519,测试乙');
  assert.deepEqual(r.items.map(x => x.code), ['600519']); assert.equal(r.rejected.length, 2);
  for (const text of ['code,name\n600000,"missing', '600000"extra', '"600000"x']) assert.throws(() => parse(text), /引号/);
});
test('size, token and unique symbol caps fail as a whole; blank text remains empty', () => {
  assert.throws(() => parse('股'.repeat(35000)), /100 KB/);
  assert.throws(() => parse('bad '.repeat(1001)), /条目/);
  assert.throws(() => parse('bad\n'.repeat(1001)), /行/);
  assert.throws(() => parse(Array.from({ length: 101 }, (_, i) => String(600000 + i)).join(',')), /100 只/);
  assert.throws(() => parse('600000\u0000'), /无效/);
  assert.throws(() => parse('code,name\n600000,\ufffd'), /无效/);
  assert.deepEqual(parse('  \n\t').items, []);
});
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.value = ''; this.handlers = {}; this.files = []; this.text = ''; }
  set textContent(v) { this.text = String(v); this.children = []; }
  get textContent() { return this.text + this.children.map(n => n.textContent).join(' '); }
  set innerHTML(_) { throw Error('unsafe HTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  async dispatchEvent(e) { for (const fn of this.handlers[e.type] || []) await fn(e); }
  setAttribute() {}
  focus() { this.focused = true; }
  click() { return this.dispatchEvent({ type: 'click' }); }
}
function setup() {
  const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const window = new Element(); let selected = 0;
  get('captureSymbol').addEventListener('input', () => selected++);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/stock-list-import.js'), 'utf8'), {
    V6StockListParser: parser, document: { getElementById: get, createElement: tag => new Element(tag) }, window, Event,
    fetch() { throw Error('preview or selection must not fetch'); }, localStorage: { setItem() { throw Error('no persistent import data'); } }
  });
  return { get, window, selected: () => selected };
}
test('preview uses text nodes, selection triggers existing invalidation but no capture or storage', async () => {
  const { get, selected } = setup(); get('stockListText').value = 'code,name\n000001,<img onerror=bad>';
  await get('stockListParse').click();
  assert.match(get('stockListPreview').textContent, /<img onerror=bad>/);
  const row = get('stockListPreview').children[0]; await row.children[1].click();
  assert.equal(get('captureSymbol').value, '000001'); assert.equal(selected(), 1);
  assert.equal(get('captureSymbol').focused, true);
  assert.match(get('captureStatus').textContent, /请点击/);
});
test('editing input invalidates old selection buttons and clears stale preview on parse error', async () => {
  const { get, selected } = setup(); get('stockListText').value = '600000'; await get('stockListParse').click();
  const button = get('stockListPreview').children[0].children[1];
  get('stockListText').value = '"bad'; await get('stockListText').dispatchEvent({ type: 'input' }); await button.click();
  assert.equal(selected(), 0); assert.equal(get('stockListPreview').textContent, '');
  await get('stockListParse').click(); assert.match(get('stockListStatus').textContent, /引号/);
});
test('file loading cannot resurrect cleared text after credentials, navigation, offline or paste changes', async () => {
  for (const action of ['token', 'pagehide', 'offline', 'paste', 'clear']) {
    const { get, window } = setup(); let done;
    get('stockListFile').files = [{ name: 'stocks.csv', size: 12, text: () => new Promise(resolve => { done = resolve; }) }];
    const pending = get('stockListFile').dispatchEvent({ type: 'change' });
    if (action === 'token') await get('token').dispatchEvent({ type: 'input' });
    else if (action === 'paste') { get('stockListText').value = '000001'; await get('stockListText').dispatchEvent({ type: 'input' }); }
    else if (action === 'clear') await get('stockListClear').click();
    else await window.dispatchEvent({ type: action });
    done('600000'); await pending;
    assert.equal(get('stockListPreview').textContent, '', action);
    assert.equal(get('stockListText').value, action === 'paste' ? '000001' : '', action);
  }
});
test('file validation rejects oversized or unsupported files before reading and safely reports read errors', async () => {
  for (const file of [{ name: 'stocks.xlsx', size: 1 }, { name: 'stocks.csv', size: parser.MAX_BYTES + 1 }]) {
    const { get } = setup(); get('stockListFile').files = [{ ...file, text() { throw Error('must not read'); } }];
    await get('stockListFile').dispatchEvent({ type: 'change' });
    assert.equal(get('stockListPreview').textContent, ''); assert.doesNotMatch(get('stockListStatus').textContent, /must not read/);
  }
  const { get } = setup(); get('stockListFile').files = [{ name: 'stocks.csv', size: 1, text: async () => { throw Error('读取失败'); } }];
  await get('stockListFile').dispatchEvent({ type: 'change' }); assert.equal(get('stockListStatus').textContent, '读取失败');
});
