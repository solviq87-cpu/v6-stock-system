'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../public/assets/research-context');

function fixture(search = '', hash = '') {
 class Element extends EventTarget {
  constructor(id) { super(); this.id = id; this.value = ''; this.textContent = ''; this.disabled = false; this.dataset = {}; this.parentElement = null; this.tagName = 'INPUT'; }
  focus() { doc.activeElement = this; }
  scrollIntoView() { this.scrolled = true; }
 }
 const doc = new EventTarget(); doc.hidden = false;
 const elements = new Map();
 for (const id of ['researchContext', 'researchContextForm', 'researchContextSymbol', 'researchContextProvider',
  'researchContextStatus', 'researchContextCurrent', 'researchContextClear', 'token', 'workspaceAsOf',
  'workspaceProvider', 'captureProvider', 'workspaceSymbol', 'captureSymbol', 'newsEvidenceSymbol',
  'linkedMemorySymbol', 'linkedPublicSymbol', 'research36Symbol',
  ...Object.values(C.targets).map(t => t.section)]) elements.set(id, new Element(id));
 const buttons = Object.keys(C.targets).map(key => {
  const element = new Element(key); element.dataset.researchTarget = key; return element;
 });
 elements.get('researchContext').querySelectorAll = () => buttons;
 doc.getElementById = id => elements.get(id) || null;
 const root = new EventTarget(); root.document = doc; root.location = { search, hash }; root.Event = Event;
 let requests = 0;
 root.fetch = () => { requests++; throw Error('selection issued a request'); };
 Object.defineProperty(root, 'localStorage', { get() { throw Error('selection touched storage'); } });
 const changes = [];
 for (const id of ['workspaceSymbol', 'captureSymbol', 'newsEvidenceSymbol', 'linkedMemorySymbol', 'linkedPublicSymbol', 'research36Symbol', 'workspaceProvider', 'captureProvider']) {
  elements.get(id).addEventListener('input', () => changes.push({ id,
   symbols: ['workspaceSymbol', 'captureSymbol', 'newsEvidenceSymbol', 'linkedMemorySymbol', 'linkedPublicSymbol', 'research36Symbol'].map(key => elements.get(key).value) }));
 }
 const controller = C.mount(root);
 function emit(detail) { const e = new Event('v6:research-context'); Object.defineProperty(e, 'detail', { value: detail }); root.dispatchEvent(e); }
 return { root, doc, elements, buttons, controller, changes, emit, requests: () => requests };
}

test('only public six-digit identity and supported source survive normalization', () => {
 assert.deepEqual(C.normalizeContext({ symbol: '600000', provider: 'tencent', token: 'private', runId: 'private' }), { symbol: '600000', provider: 'tencent' });
 assert.deepEqual(C.normalizeContext({ symbol: '000001' }), { symbol: '000001' });
 for (const value of [null, [], '600000', { symbol: 600000 }, { symbol: '<img>' }, { symbol: ' 600000' }, { symbol: '６０００００' }, { symbol: '600000', provider: 'auto' }]) assert.equal(C.normalizeContext(value), null);
});

test('URL context rejects ambiguous identity, source and unknown intent', () => {
 assert.deepEqual(C.readContext('?symbol=600000&provider=eastmoney', '#newsEvidence'), { symbol: '600000', provider: 'eastmoney', target: 'news' });
 for (const search of ['?symbol=600000&symbol=600001', '?symbol=600000&provider=tencent&provider=eastmoney', '?symbol=600000&provider=evil', '?symbol=javascript%3Aalert(1)', '?symbol=%20600000', '?symbol=600000&x=' + 'a'.repeat(1024)]) assert.equal(C.readContext(search), null);
 for (const hash of ['#javascript:alert(1)', '#https://evil.example', '#missing', '#newsEvidence<script>']) assert.equal(C.readContext('?symbol=600000', hash), null);
});

test('private URL keys never enter selection or generated candidate links', () => {
 const value = C.readContext('?symbol=600000&token=secret&runId=private&asOf=123&account=hidden');
 assert.deepEqual(value, { symbol: '600000', target: 'workspace' });
 assert.equal(C.researchHref(value.symbol, value.provider), '/research.html?symbol=600000#researchWorkspace');
 assert.equal(C.researchHref('600000', 'tencent'), '/research.html?symbol=600000&provider=tencent#researchWorkspace');
 assert.equal(C.researchHref('600000&token=secret'), '/research.html#researchWorkspace');
 assert.equal(C.researchHref('600000', 'javascript:evil'), '/research.html?symbol=600000#researchWorkspace');
});

test('candidate URL prefills all module drafts atomically without data requests', () => {
 const f = fixture('?symbol=600000&provider=tencent', '#researchWorkspace');
 assert.equal(f.changes.length, 8);
 for (const change of f.changes) assert.deepEqual(change.symbols, Array(6).fill('600000'));
 assert.equal(f.elements.get('token').value, '');
 assert.equal(f.requests(), 0);
 assert.ok(f.buttons.every(b => !b.disabled));
 assert.equal(C.mount(f.root), null, 'mount must be idempotent');
});

test('same-stock explicit intents preserve selected-run input state', () => {
 const f = fixture('?symbol=600000&provider=tencent');
 const count = f.changes.length;
 f.elements.get('workspaceAsOf').value = '2026-11-13T15:00';
 let invalidated = 0;
 f.elements.get('workspaceSymbol').addEventListener('input', () => invalidated++);
 f.emit({ symbol: '600000', provider: 'tencent', source: 'screening', runId: 'never-transported' });
 assert.equal(f.controller.focusTarget('workspace'), true);
 assert.equal(invalidated, 0);
 assert.equal(f.changes.length, count);
 assert.equal(f.elements.get('workspaceAsOf').value, '2026-11-13T15:00');
 assert.match(f.elements.get('researchContextStatus').textContent, /历史时点/);
});

test('different stock emits invalidation once per changed module and no completed-capture event', () => {
 const f = fixture('?symbol=600000'); let completed = 0;
 f.root.addEventListener('v6:stock-research', () => completed++);
 f.changes.length = 0; f.emit({ symbol: '600001' });
 assert.equal(f.changes.length, 6);
 assert.ok(f.changes.every(c => c.symbols.every(s => s === '600001')));
 assert.equal(completed, 0); assert.equal(f.requests(), 0);
 f.changes.length = 0; f.emit({ symbol: '600001', provider: 'eastmoney' });
 assert.deepEqual(f.changes.map(c => c.id), ['workspaceProvider', 'captureProvider']);
});

test('target actions reveal existing details and focus without requesting data', () => {
 const f = fixture('?symbol=600000');
 const details = { tagName: 'DETAILS', open: false, parentElement: null };
 f.elements.get('newsEvidenceSymbol').parentElement = details;
 f.buttons.find(b => b.dataset.researchTarget === 'news').dispatchEvent(new Event('click'));
 assert.equal(details.open, true);
 assert.equal(f.doc.activeElement.id, 'newsEvidenceSymbol');
 assert.equal(f.elements.get('newsEvidence').scrolled, true);
 assert.equal(f.controller.focusTarget('https://evil.example'), false);
 assert.equal(f.requests(), 0);
});

test('opening news repairs only news and keeps unrelated stock drafts intact', () => {
 const f = fixture('?symbol=600000&provider=tencent');
 f.elements.get('workspaceSymbol').value = '600001';
 f.elements.get('captureSymbol').value = '000003';
 f.elements.get('captureProvider').value = 'eastmoney';
 f.elements.get('newsEvidenceSymbol').value = '000002';
 f.changes.length = 0;
 assert.equal(f.controller.focusTarget('news'), true);
 assert.equal(f.elements.get('newsEvidenceSymbol').value, '600000');
 assert.equal(f.elements.get('workspaceSymbol').value, '600001');
 assert.equal(f.elements.get('captureSymbol').value, '000003');
 assert.equal(f.elements.get('captureProvider').value, 'eastmoney');
 assert.deepEqual(f.changes.map(c => c.id), ['newsEvidenceSymbol']);
 assert.match(f.elements.get('researchContextCurrent').textContent, /联动股票/);
 assert.match(f.elements.get('researchContextStatus').textContent, /分区代码不同/);
 assert.equal(f.requests(), 0);
});

test('explicit clear removes only shared-stock drafts and keeps unrelated drafts/date', () => {
 const f = fixture('?symbol=600000');
 f.elements.get('newsEvidenceSymbol').value = '000002';
 f.elements.get('workspaceAsOf').value = '2026-11-13T15:00';
 f.elements.get('researchContextClear').dispatchEvent(new Event('click'));
 assert.equal(f.controller.context, null);
 assert.equal(f.elements.get('workspaceSymbol').value, '');
 assert.equal(f.elements.get('newsEvidenceSymbol').value, '000002');
 assert.equal(f.elements.get('workspaceAsOf').value, '2026-11-13T15:00');
 assert.ok(f.buttons.every(b => b.disabled));
});

test('auth and lifecycle clear active strip but retain existing public module drafts', () => {
 for (const event of ['token', 'offline', 'pagehide', 'hidden']) {
  const f = fixture('?symbol=600000&token=never-read');
  if (event === 'token') f.elements.get('token').dispatchEvent(new Event('input'));
  else if (event === 'hidden') { f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange')); }
  else f.root.dispatchEvent(new Event(event));
  assert.equal(f.controller.context, null);
  assert.equal(f.elements.get('researchContextSymbol').value, '');
  assert.equal(f.elements.get('workspaceSymbol').value, '600000');
  assert.ok(f.buttons.every(b => b.disabled)); assert.equal(f.requests(), 0);
 }
});

test('invalid or hidden-page events cannot overwrite an active stock', () => {
 const f = fixture('?symbol=600000');
 for (const detail of [{ symbol: '<img>' }, { symbol: '600001', provider: 'evil' }, null]) f.emit(detail);
 assert.equal(f.elements.get('workspaceSymbol').value, '600000');
 f.doc.hidden = true; f.emit({ symbol: '600001' });
 assert.equal(f.elements.get('workspaceSymbol').value, '600000');
 const copy = f.controller.context; copy.symbol = '000001';
 assert.equal(f.controller.context.symbol, '600000');
});
