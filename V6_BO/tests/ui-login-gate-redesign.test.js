'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const app = fs.readFileSync(path.join(publicDir, 'assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'assets', 'original-reference-fidelity.css'), 'utf8');
const desktop = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(publicDir, 'mobile.html'), 'utf8');
const start = app.indexOf('function showGate(msg) {');
const end = app.indexOf('\nasync function gateSubmit()', start);
assert.ok(start >= 0 && end > start, 'the existing login gate function is retained');
const gateSource = app.slice(start, end);

test('desktop login uses the Tian Shu V6 name without changing either homepage entrypoint', () => {
  assert.match(gateSource, /天枢智策/);
  assert.doesNotMatch(gateSource, /量化看盘平台/);
  assert.match(gateSource, /className = 'v6-auth-gate'/);
  assert.match(desktop, /original-reference-fidelity\.css/);
  assert.match(desktop, /assets\/app\.js/);
  assert.match(mobile, /id="gate"/);
});

test('developer, read-only and authorization-code flows remain wired to the existing handlers', () => {
  for (const id of ['gateTabView', 'gateTabEdit', 'gatePwd', 'gateCode', 'gateRemember', 'gateHint', 'gateTip', 'gateForgot']) {
    assert.ok(gateSource.includes('id="' + id + '"'), 'missing existing gate control ' + id);
  }
  for (const handler of ['gateRole', 'gatePaste', 'gateEye', 'gateSubmit', 'gateRedeem', 'showForgot']) {
    assert.ok(gateSource.includes(handler + '('), 'missing auth handler ' + handler);
  }
  assert.match(gateSource, /type="password" id="gatePwd"/);
  assert.match(gateSource, /autocomplete="current-password"/);
});

test('new login overlay is created with a scoped class and the original password input', () => {
  let gate;
  const input = { focus() {} };
  const tip = { textContent: '' };
  const document = {
    createElement(tag) {
      assert.equal(tag, 'div');
      return { id: '', className: '', style: {}, innerHTML: '' };
    },
    getElementById(id) {
      if (id === 'gate') return gate || null;
      if (id === 'gatePwd') return input;
      if (id === 'gateTip') return tip;
      return null;
    },
    body: { appendChild(el) { gate = el; } },
  };
  const context = {
    document,
    GATE: { mode: 'edit' },
    fgMaybeShow() {},
    gateRoleUI() {},
    setTimeout(fn) { fn(); },
  };
  vm.runInNewContext(gateSource + '\nshowGate("")', context, { timeout: 1000 });
  assert.equal(gate.id, 'gate');
  assert.equal(gate.className, 'v6-auth-gate');
  assert.equal(gate.style.display, 'flex');
  assert.match(gate.innerHTML, /天枢智策/);
  assert.match(gate.innerHTML, /id="gatePwd"/);
  assert.match(gate.innerHTML, /onclick="gateSubmit\(\)"/);
});

test('V6 login theme is dark, keyboard accessible and responsive without global security overrides', () => {
  assert.match(css, /#gate\.v6-auth-gate\s*\{/);
  assert.match(css, /#040d1d/);
  assert.match(css, /#gate\.v6-auth-gate \.btn:focus-visible/);
  assert.match(css, /#gate\.v6-auth-gate input:focus-visible/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /#gate\{display:none/);
});
