'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/picks.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'public/assets/picks-page.js'), 'utf8');

test('selection results is a usable separate phone/desktop entry with a seven-item dock', () => {
  new vm.Script(code);
  for (const id of ['reload', 'board', 'sort', 'search', 'candidates', 'status', 'day']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.equal((html.match(/class="bottom"/g) || []).length, 1);
  const dock = html.match(/<nav class="bottom"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((dock.match(/<a /g) || []).length, 7);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /智能选股结果/);
});

test('selection viewer has no browser-side scan, order, push or authoritative candidate persistence', () => {
  assert.match(code, /fetch\('\/api\/quant-picks\?'/);
  assert.match(code, /method: 'GET'/);
  assert.match(code, /cache: 'no-store'/);
  assert.doesNotMatch(code, /force=1|setItem\(|method:\s*['"]POST['"]|\/api\/paper/);
  assert.match(code, /data\?\.isMock === true \|\| data\?\.simulated === true/);
  assert.match(code, /document\.hidden/);
  assert.match(code, /replaceChildren\(/);
  assert.doesNotMatch(code, /\.innerHTML\s*=/);
});

test('real candidate fields display safely; missing prices or original quote time stay unknown', async () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.className = ''; this.value = ''; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute(name, value) { this[name] = String(value); }
  }
  const ids = Object.fromEntries(['reload','board','sort','search','candidates','status','cloudSync','total','visible','explained','day']
    .map(x => [x, new Element('div')]));
  ids.board.value = 'all'; ids.sort.value = 'original';
  const calls = [];
  const context = {
    document: { hidden: false, getElementById: x => ids[x], createElement: x => new Element(x),
      createDocumentFragment: () => new Element('fragment'), addEventListener() {}, dispatchEvent() {} },
    window: { addEventListener() {}, setInterval() {} },
    localStorage: { getItem: () => '' },
    URLSearchParams, AbortController, Date, Number, String, Array, RegExp, Error, Event:class Event{constructor(type){this.type=type;}},
    fetch: async (url, options) => {
      calls.push({url, options});
      return { ok: true, json: async () => ({
        items: [{code: '000001', name: '<img src=x onerror=alert(1)>', score: 0, pct: null,
          hit: [{id: 2, text: '<script>bad()</script>'}], sector: null}],
        isSnapshot: true, snapshotDay: '2026-11-06'
      })};
    }
  };
  vm.runInNewContext(code, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.doesNotMatch(calls[0].url, /force=1/);
  assert.equal(ids.total.textContent, 1);
  assert.equal(ids.explained.textContent, 1);
  assert.equal(ids.day.textContent, '2026-11-06');
  const strings = [];
  const visit = el => { if (el && typeof el.textContent === 'string') strings.push(el.textContent);
    for (const child of el?.children || []) visit(child); };
  visit(ids.candidates);
  assert.ok(strings.includes('<img src=x onerror=alert(1)>'));
  assert.ok(strings.some(x => x.includes('<script>bad()</script>')));
  assert.ok(strings.includes('涨跌未知'));
  assert.ok(strings.some(x => x.includes('逐票报价原始时点：未知')));
  assert.match(ids.status.textContent, /历史快照/);
});