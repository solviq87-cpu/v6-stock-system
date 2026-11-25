'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {prepareRiskSummary, sendPrivateRiskSummary} = require('../src/core/private-risk-feishu-delivery');
const epoch = Date.parse('2026-11-09T10:00:00+08:00');
const webhookUrl = 'https://open.feishu.cn/open-apis/bot/v2/hook/12345678-1234-1234-1234-123456789012';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function report(levels, now = epoch) {
  const alerts = levels.map(([symbol, severity]) => ({id: symbol + ':cost-loss', symbol,
    code: severity === 'critical' ? 'loss-critical' : 'loss-warning', severity, canNotify: false}));
  return {schemaVersion: 1, mode: 'manual-holding-risk-readonly', status: 'evaluated',
    asOf: new Date(now).toISOString(), canTrade: false, canNotify: false, verifiedLive: false,
    alerts, counts: {positions: levels.length, warningAlerts: levels.length,
      withRecentSourceQuote: levels.length, conflictingQuotes: 0}};
}
async function workspace(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-risk-escalation-'));
  try { await fn(path.join(dir, 'receipt.json')); }
  finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
test('a severity swap between two objects is a distinct event despite unchanged totals', () => {
  const before = prepareRiskSummary(report([['600001', 'critical'], ['600002', 'warning']]), {now: epoch});
  const after = prepareRiskSummary(report([['600001', 'warning'], ['600002', 'critical']]), {now: epoch});
  assert.deepEqual(before.counts, after.counts);
  assert.notEqual(before.fingerprint, after.fingerprint);
  const reordered = prepareRiskSummary(report([['600002', 'critical'], ['600001', 'warning']]), {now: epoch});
  assert.equal(after.fingerprint, reordered.fingerprint);
  assert.doesNotMatch(JSON.stringify(after), /600001|600002|cost-loss/);
});
test('a different critical object bypasses ordinary cooldown and remains reserved after restart', () => workspace(async stateFile => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return {ok: true, json: async () => ({code: 0})}; };
  const send = (levels, now) => sendPrivateRiskSummary({report: report(levels, now), now,
    stateFile, webhookUrl, fetchImpl, enableDelivery: true});
  assert.equal((await send([['600001', 'critical'], ['600002', 'warning']], epoch)).status, 'gateway-accepted');
  assert.equal((await send([['600001', 'warning'], ['600002', 'critical']], epoch + 1000)).status, 'gateway-accepted');
  assert.equal((await send([['600001', 'warning'], ['600002', 'critical']], epoch + 2000)).status, 'deduplicated-gateway-accepted');
  assert.equal(calls, 2);
  assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /600001|600002|cost-loss/);
}));
test('unknown delivery of a new critical object is never retried after restart', () => workspace(async stateFile => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error('connection reset'); };
  const send = (symbol, now) => sendPrivateRiskSummary({report: report([[symbol, 'critical']], now), now,
    stateFile, webhookUrl, fetchImpl, enableDelivery: true});
  assert.equal((await send('600001', epoch)).status, 'pending-unknown');
  assert.equal((await send('600002', epoch + 1000)).status, 'pending-unknown');
  assert.equal((await send('600002', epoch + 2000)).status, 'deduplicated-pending-unknown');
  assert.equal(calls, 2);
}));
test('changes to ordinary risks do not keep bypassing cooldown beside the same critical object', () => workspace(async stateFile => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return {ok: true, json: async () => ({code: 0})}; };
  const send = (symbol, now) => sendPrivateRiskSummary({report: report([['600001', 'critical'], [symbol, 'warning']], now), now,
    stateFile, webhookUrl, fetchImpl, enableDelivery: true});
  assert.equal((await send('600002', epoch)).status, 'gateway-accepted');
  assert.equal((await send('600003', epoch + 1000)).status, 'cooldown');
  assert.equal(calls, 1);
}));
test('legacy aggregate receipts remain reserved instead of being replayed by an identity migration', () => workspace(async stateFile => {
  const input = report([['600001', 'critical']]);
  const counts = {positions: 1, critical: 1, warning: 0, unknown: 0, validQuotes: 1, conflicts: 0};
  const history = [{day: '2026-11-09', fingerprint: hash({day: '2026-11-09', counts,
    codes: ['loss-critical'], privateEventIds: ['600001:cost-loss']}),
    status: 'pending-unknown', at: epoch, critical: 1}];
  const old = {schemaVersion: 2, mode: 'v6-private-feishu-gateway-receipt', history};
  fs.writeFileSync(stateFile, JSON.stringify({...old, digest: hash(old)}));
  let calls = 0;
  const result = await sendPrivateRiskSummary({report: input, now: epoch, stateFile, webhookUrl,
    fetchImpl: async () => { calls++; throw Error('must not resend'); }, enableDelivery: true});
  assert.equal(result.status, 'deduplicated-pending-unknown');
  assert.equal(result.legacyIdentityUnverified, true);
  assert.equal(calls, 0);
}));
test('duplicate private risk IDs cannot manufacture independent critical evidence', () => {
  assert.throws(() => prepareRiskSummary(report([['600001', 'critical'], ['600001', 'warning']]), {now: epoch}), /事件ID/);
});
test('an old aggregate acceptance cannot certify the current objects after a severity swap', () => workspace(async stateFile => {
  const input = report([['600001', 'warning'], ['600002', 'critical']]);
  const counts = {positions: 2, critical: 1, warning: 1, unknown: 0, validQuotes: 2, conflicts: 0};
  const history = [{day: '2026-11-09', fingerprint: hash({day: '2026-11-09', counts,
    codes: ['loss-critical', 'loss-warning'], privateEventIds: ['600001:cost-loss', '600002:cost-loss']}),
    status: 'gateway-accepted', at: epoch, critical: 1}];
  const old = {schemaVersion: 2, mode: 'v6-private-feishu-gateway-receipt', history};
  fs.writeFileSync(stateFile, JSON.stringify({...old, digest: hash(old)}));
  const result = await sendPrivateRiskSummary({report: input, now: epoch, stateFile, webhookUrl,
    fetchImpl: async () => { throw Error('must not replay ambiguous legacy delivery'); }, enableDelivery: true});
  assert.equal(result.legacyIdentityUnverified, true);
  assert.equal(result.previousGatewayAccepted, true);
  assert.equal(result.gatewayAccepted, false);
  assert.equal(result.deliveredToDevice, false);
}));
