'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('const _configBeforeSave = { ...S.config };');
const end = source.indexOf("// ⛔ 2026-10-07 补", start);
assert.ok(start > 0 && end > start);
const fragment = source.slice(start, end);
function run(saveOk) {
  const initial = { feishuWebhook: 'original-public', feishuSecWebhook: 'original-private', qqMail: {user:'original'}, extra: 1 };
  const config = { ...initial };
  const ctx = { S: {config}, _pending: {feishuWebhook:'replacement-public', feishuSecWebhook:'replacement-private'},
    _cfgIn: {pushMaxPerDay: 12}, _setIn: {}, CFG_SET: {}, c: {qqMail:{user:'changed'}},
    saveCfg: () => saveOk, json: (_r, obj) => obj, res: {}, fsNote: '' };
  const result = vm.runInNewContext(`(function(){ ${fragment}; return {ok:true}; })()`, ctx);
  return { result, config, initial };
}
test('failed persistence restores public and private bot addresses', () => {
  const {result,config,initial} = run(false);
  assert.equal(result.ok, false);
  assert.equal(config.feishuWebhook, initial.feishuWebhook);
  assert.equal(config.feishuSecWebhook, initial.feishuSecWebhook);
});
test('failed persistence restores all edited fields and removes newly added fields', () => {
  const {config} = run(false);
  assert.equal(config.pushMaxPerDay, undefined);
  assert.equal(config.qqMail.user, 'original');
  assert.equal(config.extra, 1);
});
test('successful persistence commits both channels and other fields', () => {
  const {result,config} = run(true);
  assert.equal(result.ok, true);
  assert.equal(config.feishuWebhook, 'replacement-public');
  assert.equal(config.feishuSecWebhook, 'replacement-private');
  assert.equal(config.pushMaxPerDay, 12);
});
