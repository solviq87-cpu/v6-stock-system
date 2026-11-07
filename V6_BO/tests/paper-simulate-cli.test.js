'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeResultAtomic } = require('../scripts/paper-simulate-intents');

test('paper simulation result is atomically created with restrictive permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-paper-atomic-'));
  const file = path.join(dir, 'result.json');
  try {
    writeResultAtomic(file, { mode: 'offline-paper-intent-simulation', fills: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mode: 'offline-paper-intent-simulation', fills: [] });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => writeResultAtomic(file, { overwritten: true }), /已存在/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mode: 'offline-paper-intent-simulation', fills: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('paper simulation result refuses symlink destination', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-paper-link-'));
  const target = path.join(dir, 'target.json'), link = path.join(dir, 'link.json');
  try {
    fs.writeFileSync(target, 'safe'); fs.symlinkSync(target, link);
    assert.throws(() => writeResultAtomic(link, { x: 1 }), /符号链接/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'safe');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
