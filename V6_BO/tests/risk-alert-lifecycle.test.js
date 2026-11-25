'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawn} = require('node:child_process');
const {createRiskAlertLifecycle, normalizeRiskReceipt, MAX_DAILY_SENDS} = require('../src/core/risk-alert-lifecycle');
const {sendPrivateRiskSummary} = require('../src/core/private-risk-feishu-delivery');
const {createQueue} = require('../feishuq');
const epoch = Date.parse('2026-11-26T10:00:00+08:00');
const key = {accountId: 'pool', accountEpoch: 'original-ledger-period-1'};
function risk(extra = {}) {
  return {id: 'risk-1', rootCauseId: 'quote:600001', category: 'data', object: {type: 'stock', id: '600001'},
    severity: 'warning', evidenceStatus: 'missing', executionStatus: 'blocked', status: 'active', sourceAt: epoch,
    source: 'original-quote-gate', facts: ['缺少当前原始报价'], impact: '当前权益估值覆盖不足',
    restrictions: ['暂停依赖该报价的新判断'], checks: ['核对原始源端报价'], releaseConditions: ['获得同股15秒内合格报价'], ...extra};
}
function space(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-risk-alerts-'));
  let now = epoch, primary = true;
  const factory = () => createRiskAlertLifecycle({root, clock: () => now, canWrite: () => primary});
  return Promise.resolve().then(() => fn({root, store: factory(), restart: factory,
    advance: ms => { now += ms; }, setPrimary: value => { primary = value; }, now: () => now}))
    .finally(() => fs.rmSync(root, {recursive: true, force: true}));
}
const observe = (store, risks = [risk()], extra = {}) => store.observe({...key, risks, ...extra});
test('one root groups home, stock and account evidence without losing individual facts or restrictions', () => space(({store}) => {
  const value = observe(store, [risk(), risk({id: 'risk-2', object: {type: 'account', id: 'pool'},
    facts: ['同一报价故障影响账户估值'], restrictions: ['权益精确值未知']})]);
  assert.equal(value.groups.length, 1); assert.equal(value.groups[0].risks.length, 2);
  assert.deepEqual(value.groups[0].risks.map(row => row.id), ['risk-1', 'risk-2']);
  assert.equal(value.groups[0].firstSeenAt, epoch); assert.equal(value.groups[0].events[0].kind, 'first-seen');
  assert.equal(value.groups[0].events[0].evidence[1].restrictions[0], '权益精确值未知');
  assert.equal(value.groups[0].notification.receiverConfirmed, false); assert.equal(value.canTrade, false);
}));
test('repeated observations and process restart retain reservation and never schedule the same event twice', () => space(({store, restart, advance}) => {
  const first = observe(store); const group = first.groups[0];
  const queued = store.reserveDelivery({...key, rootCauseId: group.rootCauseId, eventId: group.notificationEventId});
  assert.equal(queued.reserved, true); assert.equal(queued.status, 'queued');
  advance(5000); observe(store);
  const rebooted = restart(), next = rebooted.reserveDelivery({...key, rootCauseId: group.rootCauseId});
  assert.equal(next.reserved, false); assert.equal(next.deliveryId, queued.deliveryId);
  assert.equal(rebooted.read(key).groups[0].events.length, 1);
  advance(30001);
  assert.equal(rebooted.read(key).groups[0].notification.status, 'unconfirmed');
  assert.equal(rebooted.reserveDelivery({...key, rootCauseId: group.rootCauseId}).reserved, false);
}));
test('two isolated processes compete for one durable reservation and only one obtains permission to enqueue', () => space(async ({store, root}) => {
  observe(store);
  const moduleFile = require.resolve('../src/core/risk-alert-lifecycle');
  const source = `const {createRiskAlertLifecycle}=require(process.argv[1]);
    const store=createRiskAlertLifecycle({root:process.argv[2],clock:()=>${epoch},canWrite:()=>true});
    process.stdin.once('data',()=>{try{const r=store.reserveDelivery(${JSON.stringify({...key, rootCauseId: 'quote:600001'})});
      process.stdout.write(JSON.stringify({reserved:r.reserved}));}catch(e){process.stdout.write(JSON.stringify({reserved:false,blocked:true}));}});`;
  const workers = [0, 1].map(() => {
    const child = spawn(process.execPath, ['-e', source, moduleFile, root], {stdio: ['pipe', 'pipe', 'pipe']});
    const result = new Promise((resolve, reject) => {
      let output = '', stderr = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { stderr += data; });
      child.once('error', reject); child.once('exit', code => {
        try { assert.equal(code, 0, stderr); resolve(JSON.parse(output)); } catch (error) { reject(error); }
      });
    });
    return {child, result};
  });
  for (const worker of workers) worker.child.stdin.end('reserve');
  const results = await Promise.all(workers.map(worker => worker.result));
  assert.equal(results.filter(result => result.reserved).length, 1);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001'}).reserved, false);
}));
test('severity escalation is a distinct event, separates critical notices and bypasses ordinary cooldown', () => space(({store, advance}) => {
  observe(store); store.reserveDelivery({...key, rootCauseId: 'quote:600001'});
  advance(1000); const value = observe(store, [risk({severity: 'critical', facts: ['报价冲突覆盖全部持仓']})]);
  assert.deepEqual(value.groups[0].events.map(event => event.kind), ['first-seen', 'escalated']);
  assert.equal(value.groups[0].classification, 'critical');
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001'}).reserved, true);
  advance(1000); observe(store, [risk({severity: 'warning'})]);
  advance(1000); observe(store, [risk({severity: 'critical'})]);
  assert.equal(store.read(key).groups[0].events.length, 2);
}));
test('explicit usable resolution closes the incident, missing and stale evidence cannot call it safe', () => space(({store, advance, now}) => {
  observe(store); advance(1000);
  observe(store, [risk({status: 'resolved', evidenceStatus: 'stale'})]);
  assert.equal(store.read(key).groups[0].status, 'unknown');
  assert.equal(store.read(key).groups[0].resolvedAt, null);
  advance(1000); observe(store, [risk({status: 'resolved', evidenceStatus: 'available', sourceAt: now()})]);
  const closed = store.read(key).groups[0];
  assert.equal(closed.status, 'resolved'); assert.equal(closed.events.at(-1).kind, 'resolved');
  assert.equal(closed.resolvedAt, now());
  advance(1000); observe(store);
  const reopened = store.read(key).groups[0];
  assert.equal(reopened.occurrence, 2); assert.equal(reopened.events.at(-1).kind, 'reopened');
  assert.equal(reopened.firstSeenAt, epoch);
}));
test('an absent root in a complete observation records a gap and keeps site restrictions', () => space(({store, advance}) => {
  observe(store); advance(1000);
  observe(store, [], {complete: true});
  const group = store.read(key).groups[0];
  assert.equal(group.status, 'unknown'); assert.equal(group.evidenceStatus, 'missing');
  assert.equal(group.observationGap, true); assert.equal(group.resolvedAt, null);
  assert.equal(group.lastSeenAt, epoch); assert.deepEqual(group.risks[0].restrictions, ['暂停依赖该报价的新判断']);
  assert.equal(store.reserveDelivery({...key, rootCauseId: group.rootCauseId}).status, 'observation-gap');
}));
test('partial observations preserve unrelated roots and account resets cannot reuse old reservations', () => space(({store, advance}) => {
  observe(store); store.reserveDelivery({...key, rootCauseId: 'quote:600001'}); advance(1000);
  observe(store, [risk({id: 'risk-2', rootCauseId: 'quote:600002'})]);
  assert.equal(store.read(key).groups.find(group => group.rootCauseId === 'quote:600001').observationGap, false);
  const other = {...key, accountId: 'pre'};
  assert.equal(store.read(other).groups.length, 0);
  store.observe({...other, risks: [risk()]});
  assert.equal(store.reserveDelivery({...other, rootCauseId: 'quote:600001'}).reserved, true);
  const reset = {...key, accountEpoch: 'original-ledger-period-2'};
  assert.equal(store.read(reset).groups.length, 0); store.observe({...reset, risks: [risk()]});
  assert.equal(store.reserveDelivery({...reset, rootCauseId: 'quote:600001'}).reserved, true);
}));
test('gateway acceptance is not receiver delivery; user viewing is distinct from transport evidence', () => space(({store}) => {
  observe(store); const queued = store.reserveDelivery({...key, rootCauseId: 'quote:600001'});
  const accepted = store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'gateway-accepted'});
  assert.equal(accepted.gatewayAccepted, true); assert.equal(accepted.receiverConfirmed, false);
  const first = store.read({...key, actor: 'editor-1'});
  assert.equal(first.groups[0].viewed, false);
  const viewed = store.markViewed({...key, rootCauseId: 'quote:600001', actor: 'editor-1', expectedRevision: first.revision});
  assert.equal(viewed.groups[0].viewed, true); assert.equal(viewed.groups[0].viewedAt, epoch);
  assert.equal(viewed.groups[0].notification.status, 'gateway-accepted');
  assert.equal(store.read({...key, actor: 'editor-2'}).groups[0].viewed, false);
  assert.throws(() => store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'receiver-confirmed'}), /可信来源/);
}));
test('refreshing only the source clock keeps a viewed incident viewed while escalation creates unread evidence', () => space(({store, advance, now}) => {
  const first = observe(store);
  store.markViewed({...key, rootCauseId: 'quote:600001', actor: 'editor', expectedRevision: first.revision});
  advance(5000); observe(store, [risk({sourceAt: now()})]);
  assert.equal(store.read({...key, actor: 'editor'}).groups[0].viewed, true);
  advance(5000); observe(store, [risk({sourceAt: now(), severity: 'critical'})]);
  assert.equal(store.read({...key, actor: 'editor'}).groups[0].viewed, false);
}));
test('nested original plan and order references survive grouping and cannot become trading authority', () => space(({store}) => {
  const value = observe(store, [risk({priceDependent: true, references: {planId: 'plan-original', orderIds: ['order-original'],
    entryEventId: 'fill-original', arbitrary: 'ignored'}, relatedRiskIds: ['risk-1', 'risk-detail']})]);
  const row = value.groups[0].risks[0];
  assert.deepEqual(row.references, {entryEventId: 'fill-original', orderIds: ['order-original'], planId: 'plan-original'});
  assert.equal(row.priceDependent, true); assert.equal(value.canTrade, false);
}));
test('receiver confirmation needs exact retained reservation and a trusted timed receipt, and cannot be downgraded', () => space(({store, advance, now}) => {
  observe(store); const queued = store.reserveDelivery({...key, rootCauseId: 'quote:600001'}); advance(1000);
  const evidence = {receiptId: 'receiver-event-1', source: 'isolated-receiver', receivedAt: now(), trustedReceiver: true};
  assert.throws(() => store.recordReceipt({...key, deliveryId: 'a'.repeat(64), status: 'receiver-confirmed', evidence}), /预留/);
  assert.throws(() => store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'receiver-confirmed', evidence: {...evidence, receivedAt: now() + 1}}), /实际接收时点/);
  const confirmed = store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'receiver-confirmed', evidence});
  assert.equal(confirmed.receiverConfirmed, true);
  assert.equal(store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'unconfirmed'}).status, 'receiver-confirmed');
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001'}).reserved, false);
}));
test('unknown results and contradictory gateway receipts retain the single reservation', () => space(({store, advance}) => {
  observe(store); const queued = store.reserveDelivery({...key, rootCauseId: 'quote:600001'});
  store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'unconfirmed'});
  advance(1000); store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'gateway-accepted'});
  assert.equal(store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'unconfirmed'}).status, 'gateway-accepted');
  assert.equal(store.recordReceipt({...key, deliveryId: queued.deliveryId, status: 'gateway-rejected'}).status, 'unconfirmed');
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001'}).reserved, false);
  assert.equal(store.read(key).groups[0].notification.receipts.length, 3);
}));
test('root and class mute affect only notification, retain site risks and require current authorized-user revision', () => space(({store, now}) => {
  let state = observe(store, [risk(), risk({id: 'critical-1', rootCauseId: 'portfolio:loss', severity: 'critical'})]);
  state = store.setMuted({...key, classification: 'general', mutedUntil: now() + 60000, actor: 'editor', expectedRevision: state.revision});
  assert.equal(state.groups.find(group => group.classification === 'general').muted, true);
  assert.equal(state.groups.find(group => group.classification === 'critical').muted, false);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001'}).status, 'muted');
  assert.equal(state.groups.length, 2); assert.equal(state.groups[1].restrictionsStillApply, true);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'portfolio:loss'}).reserved, true);
  assert.throws(() => store.setMuted({...key, rootCauseId: 'portfolio:loss', mutedUntil: null, actor: 'editor', expectedRevision: state.revision}), /版本冲突/);
  const latest = store.read(key);
  const unmuted = store.setMuted({...key, classification: 'general', mutedUntil: null, actor: 'editor', expectedRevision: latest.revision});
  assert.equal(unmuted.groups.find(group => group.rootCauseId === 'quote:600001').muted, false);
}));
test('cooldown, daily cap and superseded lifecycle events make oscillating alerts bounded', () => space(({store, advance}) => {
  observe(store); const old = store.read(key).groups[0].notificationEventId;
  store.reserveDelivery({...key, rootCauseId: 'quote:600001'});
  advance(1000); observe(store, [risk({id: 'risk-2', rootCauseId: 'quote:600002'})]);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600002'}).status, 'cooldown');
  for (let i = 1; i < MAX_DAILY_SENDS; i++) {
    advance(120000); const rootCauseId = 'risk:' + i;
    observe(store, [risk({id: rootCauseId, rootCauseId})]);
    assert.equal(store.reserveDelivery({...key, rootCauseId}).reserved, true);
  }
  advance(120000); observe(store, [risk({id: 'extra', rootCauseId: 'extra'})]);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'extra'}).status, 'daily-limit');
  advance(1000); observe(store, [risk({severity: 'critical'})]);
  assert.equal(store.reserveDelivery({...key, rootCauseId: 'quote:600001', eventId: old}).status, 'superseded');
}));
test('corrupt evidence, linked files, clock rollback and replica writes fail closed before reserving', () => space(({store, root, setPrimary}) => {
  observe(store); setPrimary(false);
  assert.throws(() => store.reserveDelivery({...key, rootCauseId: 'quote:600001'}), /原主实例/);
  assert.equal(store.read(key).groups.length, 1); setPrimary(true);
  assert.throws(() => observe(store, [risk()], {observedAt: epoch - 1}), /倒序/);
  const filename = fs.readdirSync(root).find(name => name.endsWith('.json'));
  const file = path.join(root, filename), prior = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, prior.replace('warning', 'critical'));
  assert.throws(() => store.reserveDelivery({...key, rootCauseId: 'quote:600001'}), /完整性/);
  fs.unlinkSync(file); fs.symlinkSync(path.join(root, 'other.json'), file);
  assert.throws(() => store.read(key), /ELOOP/);
}));
test('future or missing source time cannot resolve a root and duplicate IDs are rejected', () => space(({store}) => {
  observe(store);
  observe(store, [risk({status: 'resolved', evidenceStatus: 'available', sourceAt: epoch + 1})]);
  assert.equal(store.read(key).groups[0].status, 'unknown');
  observe(store, [risk({status: 'resolved', evidenceStatus: 'available', sourceAt: null})]);
  assert.equal(store.read(key).groups[0].resolvedAt, null);
  assert.throws(() => observe(store, [risk(), risk()]), /标识重复/);
}));
test('legacy risk sender treats contradictory gateway code envelopes and HTTP 408 as uncertain, with no retry', () => space(async ({root}) => {
  const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/isolated-fixture-not-a-real-webhook';
  const report = {schemaVersion: 1, mode: 'manual-holding-risk-readonly', status: 'evaluated', asOf: new Date(epoch).toISOString(),
    canTrade: false, canNotify: false, verifiedLive: false, alerts: [{id: 'private-risk', code: 'loss-warning', severity: 'warning', canNotify: false}],
    counts: {positions: 1, warningAlerts: 1, withRecentSourceQuote: 0, conflictingQuotes: 0}};
  for (const [label, response] of [['conflicting', {ok: true, status: 200, json: async () => ({code: 0, StatusCode: 1})}],
    ['timeout', {ok: false, status: 408}], ['malformed', {ok: true, status: 200, json: async () => ({})}]]) {
    let calls = 0;
    const options = {report, webhookUrl: url, stateFile: path.join(root, label + '.json'), now: epoch, enableDelivery: true,
      fetchImpl: async () => { calls++; return response; }};
    const first = await sendPrivateRiskSummary(options), next = await sendPrivateRiskSummary(options);
    assert.equal(first.status, 'pending-unknown'); assert.equal(first.gatewayAccepted, false);
    assert.equal(next.status, 'deduplicated-pending-unknown'); assert.equal(calls, 1);
  }
}));
test('old queue retries only definite rate rejection; uncertain 429 and thrown errors never duplicate transport', () => {
  for (const mode of ['uncertain', 'thrown', 'definite']) {
    let calls = 0, settled = 0;
    const queue = createQueue((_text, cb) => {
      calls++;
      if (mode === 'thrown') throw Error('HTTP 429 after dispatch');
      cb(false, mode === 'uncertain' ? '送达结果未知：HTTP 429 response lost' : 'HTTP 429 Too Many Requests');
    }, {minGap: 0, retry: 2, sleep: (_ms, run) => run(), setTimer: () => 1, clearTimer() {}});
    queue.send('isolated-risk', () => { settled++; });
    assert.equal(calls, mode === 'definite' ? 3 : 1); assert.equal(settled, 1); assert.equal(queue.running, false);
  }
});
test('old sender result normalization requires affirmative gateway evidence and never invents receiver proof', () => {
  for (const r of [null, {}, {ok: false}, {ok: false, msg: 'unexpected failure'},
    {ok: true, status: 'rejected'}, {ok: false, status: 'accepted'}, {ok: true, msg: '送达结果未知：矛盾回执'},
    {ok: false, msg: 'HTTP 408 请求超时'}, {ok: false, msg: 'HTTP 408'}, new Error('HTTP 429 after dispatch'), {status: 'receiver-confirmed'}]) {
    assert.equal(normalizeRiskReceipt(r).status, 'unconfirmed'); assert.equal(normalizeRiskReceipt(r).receiverConfirmed, false);
  }
  for (const r of [{ok: true, msg: 'ok'}, {status: 'accepted'}, {status: 'gateway-accepted'}]) {
    assert.equal(normalizeRiskReceipt(r).status, 'gateway-accepted'); assert.equal(normalizeRiskReceipt(r).receiverConfirmed, false);
  }
  for (const r of [{blocked: true}, {ok: false, msg: '私密通道未配置'}, {ok: false, msg: 'code=9499 业务拒绝'},
    {ok: false, msg: 'HTTP 429'}, {localReview: {ok: false}}]) assert.equal(normalizeRiskReceipt(r).status, 'gateway-rejected');
  assert.doesNotMatch(JSON.stringify(normalizeRiskReceipt({ok: false, msg: 'network webhook=private-value'})), /private-value/);
});
