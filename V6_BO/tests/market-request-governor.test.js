'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {marketRequests, createMarketRequestGovernor, isMarketRestrictionError} = require('../src/core/market-request-governor');

const EM = 'https://push2.eastmoney.com/api/qt/stock/get?secret=not-for-status';
const EM_HISTORY = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_NUMBERED = 'https://72.push2.eastmoney.com/api/qt/clist/get';
const TX = 'https://qt.gtimg.cn/q=sh600000';
const TX_HISTORY = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function fakeClock() {
  const epoch = Date.UTC(2026, 10, 13);
  let at = epoch, nextId = 1;
  const timers = new Map();
  const clock = {
    now: () => at,
    setTimeout: (fn, delay) => { const id = nextId++; timers.set(id, {fn, at: at + delay}); return id; },
    clearTimeout: id => { timers.delete(id); },
    elapsed: () => at - epoch,
    timerCount: () => timers.size,
    stall: ms => { at += ms; },
    async advance(ms) {
      const target = at + ms;
      for (;;) {
        await flush();
        const due = [...timers].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        at = Math.max(at, due[1].at);
        timers.delete(due[0]);
        due[1].fn();
      }
      at = target;
      await flush();
    }
  };
  return clock;
}
const create = (clock, options = {}) => createMarketRequestGovernor({
  now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...options
});
const errorOf = promise => promise.then(() => { throw Error('Expected rejection'); }, error => error);

test('default singleton API is available without starting any request', () => {
  assert.equal(typeof marketRequests.run, 'function');
  assert.equal(typeof marketRequests.checkResponse, 'function');
  assert.equal(marketRequests.state(EM).active, 0);
});

test('supplier aliases share FIFO starts at least 1000ms apart, with only one active task', async () => {
  const clock = fakeClock(), governor = create(clock), first = deferred();
  const starts = []; let active = 0, peak = 0;
  const task = (name, wait = Promise.resolve()) => async () => {
    starts.push([name, clock.elapsed()]); peak = Math.max(peak, ++active);
    try { await wait; return name; } finally { active--; }
  };
  const promises = [governor.run(EM, task('first', first.promise)),
    governor.run(EM_HISTORY, task('second')), governor.run(EM_NUMBERED, task('third'))];
  assert.deepEqual(starts, [['first', 0]]);
  await clock.advance(500); first.resolve(); await flush();
  await clock.advance(499); assert.equal(starts.length, 1);
  await clock.advance(1); assert.deepEqual(starts[1], ['second', 1000]);
  await clock.advance(1000);
  assert.deepEqual(starts, [['first', 0], ['second', 1000], ['third', 2000]]);
  assert.deepEqual(await Promise.all(promises), ['first', 'second', 'third']);
  assert.equal(peak, 1); assert.equal(clock.timerCount(), 0);
});

test('start reservations also prevent a burst when maxActive is greater than one', async () => {
  const clock = fakeClock(), governor = create(clock, {maxActive: 2}), one = deferred(), two = deferred();
  const starts = [];
  const a = governor.run(TX, () => { starts.push(clock.elapsed()); return one.promise; });
  const b = governor.run(TX_HISTORY, () => { starts.push(clock.elapsed()); return two.promise; });
  const c = governor.run('https://gu.qq.com/history', () => { starts.push(clock.elapsed()); return 3; });
  await clock.advance(1000); assert.deepEqual(starts, [0, 1000]);
  await clock.advance(1000); assert.deepEqual(starts, [0, 1000]);
  one.resolve(1); await flush();
  assert.deepEqual(starts, [0, 1000, 2000]);
  two.resolve(2); assert.deepEqual(await Promise.all([a, b, c]), [1, 2, 3]);
});

test('different supplier families have independent bounded queues', async () => {
  const clock = fakeClock(), governor = create(clock), starts = [];
  const result = await Promise.all([EM, TX, 'https://hq.sinajs.cn/list=a', 'https://d.10jqka.com.cn/line', 'https://example.org/data']
    .map(url => governor.run(url, () => { starts.push(clock.elapsed()); return governor.state(url).provider; })));
  assert.deepEqual(result, ['eastmoney', 'tencent', 'sina', 'ths', 'other']);
  assert.deepEqual(starts, [0, 0, 0, 0, 0]);
  assert.equal(governor.state('https://eastmoney.com.example.org/').provider, 'other');
  assert.equal(governor.state('https://evilgtimg.cn/').provider, 'other');
});

test('429 rejects queued and new requests across the supplier family, and never sends them after cooldown', async () => {
  const clock = fakeClock(), governor = create(clock), pending = deferred(), starts = [];
  const active = governor.run(EM, () => { starts.push('active'); return pending.promise; });
  const queued = errorOf(governor.run(EM_HISTORY, () => starts.push('queued')));
  let restriction;
  assert.throws(() => governor.checkResponse(EM_NUMBERED, 429, {'Retry-After': '90', Authorization: 'never-copy'}), error => {
    restriction = error;
    return isMarketRestrictionError(error) && error.resumeAt === clock.now() + 90000;
  });
  const rejected = await queued;
  assert.equal(rejected.code, 'MARKET_RESTRICTED'); assert.equal(rejected.status, 429);
  assert.equal(rejected.resumeAt, restriction.resumeAt);
  assert.equal((await errorOf(governor.run(EM_HISTORY, () => starts.push('during-cooldown')))).code, 'MARKET_RESTRICTED');
  pending.resolve('done'); await active;
  await clock.advance(90000);
  assert.deepEqual(starts, ['active']);
  assert.equal(await governor.run(EM_HISTORY, () => 'fresh'), 'fresh');
  assert.equal(clock.timerCount(), 0);
});

test('Retry-After supports seconds, HTTP dates, Headers objects, and minimum cooldowns', () => {
  for (const sample of [
    {status: 429, headers: {}, expected: 60000},
    {status: 429, headers: {'retry-after': 'bad-value'}, expected: 60000},
    {status: 429, headers: {'retry-after': '1'}, expected: 60000},
    {status: 429, headers: {'RETRY-AFTER': '120'}, expected: 120000},
    {status: 429, headers: {get: key => key === 'retry-after' ? '180' : null}, expected: 180000},
    {status: 403, headers: {}, expected: 900000},
    {status: 403, headers: {'retry-after': '10'}, expected: 900000},
    {status: 403, headers: {'retry-after': '1800'}, expected: 1800000}
  ]) {
    const clock = fakeClock(), governor = create(clock);
    assert.throws(() => governor.checkResponse(TX, sample.status, sample.headers), error => error.resumeAt === clock.now() + sample.expected);
    assert.equal(governor.state(TX_HISTORY).cooldownLeftMs, sample.expected);
  }
  const clock = fakeClock(), governor = create(clock);
  const until = clock.now() + 120000;
  assert.throws(() => governor.checkResponse(EM, 429, {'retry-after': new Date(until).toUTCString()}), error => error.resumeAt === until);
  assert.throws(() => governor.checkResponse(EM, 429, {'retry-after': '1'}), error => error.resumeAt === until);
  governor.checkResponse(EM, 200, {});
  assert.equal(governor.state(EM).cooldownUntil, until);
});

test('a restriction found inside an active task releases its slot but does not dispatch queued work', async () => {
  const clock = fakeClock(), governor = create(clock), response = deferred(); let calls = 0;
  const first = errorOf(governor.run(TX, async () => {
    calls++; await response.promise; governor.checkResponse(TX, 403, {});
  }));
  const second = errorOf(governor.run(TX_HISTORY, () => { calls++; }));
  response.resolve();
  assert.equal((await first).code, 'MARKET_RESTRICTED');
  assert.equal((await second).code, 'MARKET_RESTRICTED');
  assert.equal(governor.state(TX).active, 0);
  await clock.advance(900000); assert.equal(calls, 1);
});

test('queue capacity and the 30s deadline bound work even if the active request hangs', async () => {
  const clock = fakeClock(), governor = create(clock, {maxQueue: 2}), pending = deferred(); let calls = 0;
  const active = governor.run(EM, () => { calls++; return pending.promise; });
  const waiting = [errorOf(governor.run(EM, () => { calls++; })), errorOf(governor.run(EM_HISTORY, () => { calls++; }))];
  assert.equal((await errorOf(governor.run(EM, () => { calls++; }))).code, 'MARKET_QUEUE_FULL');
  assert.equal(governor.state(EM).queued, 2);
  await clock.advance(30000);
  assert.deepEqual((await Promise.all(waiting)).map(error => error.code), ['MARKET_QUEUE_TIMEOUT', 'MARKET_QUEUE_TIMEOUT']);
  assert.equal(governor.state(EM).active, 1); assert.equal(governor.state(EM).queued, 0);
  pending.resolve(); await active; await clock.advance(60000);
  assert.equal(calls, 1); assert.equal(clock.timerCount(), 0);
});

test('default queue admits 100 waiting tasks and rejects task 101', async () => {
  const clock = fakeClock(), governor = create(clock), pending = deferred();
  const active = governor.run(EM, () => pending.promise);
  const waiting = Array.from({length: 100}, () => errorOf(governor.run(EM_HISTORY, () => { throw Error('Must expire'); })));
  assert.equal(governor.state(EM).queued, 100);
  assert.equal((await errorOf(governor.run(EM, () => {}))).code, 'MARKET_QUEUE_FULL');
  await clock.advance(30000);
  assert.ok((await Promise.all(waiting)).every(error => error.code === 'MARKET_QUEUE_TIMEOUT'));
  pending.resolve(); await active;
});

test('an overdue dispatch timer discards expired work after an event-loop stall', async () => {
  const clock = fakeClock(), governor = create(clock); let calls = 0;
  await governor.run(EM, () => { calls++; });
  const queued = errorOf(governor.run(EM_HISTORY, () => { calls++; }));
  clock.stall(40000); await clock.advance(0);
  assert.equal((await queued).code, 'MARKET_QUEUE_TIMEOUT');
  assert.equal(calls, 1); assert.equal(clock.timerCount(), 0);
});

test('task errors free capacity without bypassing the start interval', async () => {
  const clock = fakeClock(), governor = create(clock), original = Error('fixture failure');
  const first = errorOf(governor.run(EM, () => { throw original; }));
  const starts = [];
  const second = governor.run(EM_HISTORY, () => { starts.push(clock.elapsed()); return 2; });
  assert.equal(await first, original);
  await clock.advance(999); assert.deepEqual(starts, []);
  await clock.advance(1); assert.equal(await second, 2); assert.deepEqual(starts, [1000]);
});

test('state is a detached read-only snapshot without raw URLs or response headers', async () => {
  const clock = fakeClock(), governor = create(clock), before = governor.state(EM);
  assert.equal(before.lastStartAt, null); assert.equal(clock.timerCount(), 0);
  await governor.run(EM, () => {});
  assert.equal(before.lastStartAt, null);
  assert.throws(() => { before.queued = 100; }, TypeError);
  const snapshot = governor.state(EM);
  assert.deepEqual(Object.keys(snapshot).sort(), ['active', 'cooldownLeftMs', 'cooldownUntil', 'lastStartAt', 'provider', 'queued', 'stateUnavailable']);
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  assert.ok(!JSON.stringify(snapshot).includes('eastmoney.com'));
  assert.equal(isMarketRestrictionError(Error('429')), false);
});

test('invalid inputs cannot call a task or create a timer', async () => {
  const clock = fakeClock(), governor = create(clock); let calls = 0;
  await assert.rejects(governor.run('not-a-url', () => { calls++; }), /Invalid market request URL/);
  await assert.rejects(governor.run(EM, null), /must be a function/);
  assert.equal(calls, 0); assert.equal(clock.timerCount(), 0);
  assert.throws(() => create(clock, {maxActive: 0}), /maxActive/);
  assert.throws(() => create(clock, {cooldown429Ms: 1}), /cooldown429Ms/);
});

function privateFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-request-state-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, directory: path.join(root, 'private'), stateFile: path.join(root, 'private', 'cooldown.json')};
}
function storedState(stateFile, providers) {
  fs.mkdirSync(path.dirname(stateFile), {recursive: true, mode: 0o700});
  fs.writeFileSync(stateFile, JSON.stringify({schemaVersion: 1, providers}), {mode: 0o600});
  fs.chmodSync(stateFile, 0o600);
}
async function assertStopped(governor, target = EM) {
  let calls = 0;
  const error = await errorOf(governor.run(target, () => { calls++; }));
  assert.equal(error.code, 'MARKET_RESTRICTED');
  assert.equal(error.stateUnavailable, true);
  assert.equal(error.resumeAt, Number.MAX_SAFE_INTEGER);
  assert.equal(isMarketRestrictionError(error), true);
  assert.equal(calls, 0);
  assert.equal(governor.state(target).stateUnavailable, true);
  assert.ok(!error.message.includes('cooldown.json'));
}

for (const status of [429, 403]) test(`HTTP ${status} cooldown survives a new governor and expires without rewriting state`, async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  const governor = create(clock, {stateFile: fixture.stateFile});
  assert.equal(fs.existsSync(fixture.directory), false);
  let resumeAt;
  assert.throws(() => governor.checkResponse(EM, status, {}), error => {
    resumeAt = error.resumeAt; return error.code === 'MARKET_RESTRICTED';
  });
  assert.equal(fs.statSync(fixture.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(fixture.stateFile).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(fixture.directory), ['cooldown.json']);
  const bytes = fs.readFileSync(fixture.stateFile, 'utf8'), modified = fs.statSync(fixture.stateFile).mtimeMs;
  assert.deepEqual(JSON.parse(bytes), {schemaVersion: 1, providers: {eastmoney: {blockedUntil: resumeAt, status}}});
  const restarted = create(clock, {stateFile: fixture.stateFile});
  const error = await errorOf(restarted.run(EM_HISTORY, () => assert.fail('must not send during persisted cooldown')));
  assert.equal(error.resumeAt, resumeAt); assert.equal(error.status, status);
  await clock.advance(resumeAt - clock.now());
  assert.equal(await restarted.run(EM_NUMBERED, () => 'allowed after expiry'), 'allowed after expiry');
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), bytes);
  assert.equal(fs.statSync(fixture.stateFile).mtimeMs, modified);
});

test('long Retry-After survives restart, and writers merge both other families and longer cooldowns', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  const first = create(clock, {stateFile: fixture.stateFile}), second = create(clock, {stateFile: fixture.stateFile});
  assert.throws(() => first.checkResponse(EM, 429, {'retry-after': '7200'}));
  const longest = first.state(EM).cooldownUntil;
  assert.throws(() => second.checkResponse(TX, 403, {}));
  assert.throws(() => second.checkResponse(EM_HISTORY, 429, {'retry-after': '60'}), error => error.resumeAt === longest);
  const restarted = create(clock, {stateFile: fixture.stateFile});
  assert.equal((await errorOf(restarted.run(EM, () => {}))).resumeAt, longest);
  assert.equal((await errorOf(restarted.run(TX_HISTORY, () => {}))).status, 403);
  const stored = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
  assert.equal(stored.providers.eastmoney.blockedUntil, longest);
  assert.equal(stored.providers.tencent.status, 403);
});

test('queued physical dispatch reloads a restriction written by another instance', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  const reader = create(clock, {stateFile: fixture.stateFile}), writer = create(clock, {stateFile: fixture.stateFile});
  let calls = 0;
  await reader.run(EM, () => { calls++; });
  const pending = errorOf(reader.run(EM_HISTORY, () => { calls++; }));
  assert.throws(() => writer.checkResponse(EM_NUMBERED, 429, {}));
  await clock.advance(1000);
  assert.equal((await pending).code, 'MARKET_RESTRICTED');
  assert.equal(calls, 1); assert.equal(reader.state(EM).queued, 0);
});

test('successful and failed ordinary requests never create or rewrite persistent files', async t => {
  const fixture = privateFixture(t), clock = fakeClock(), governor = create(clock, {stateFile: fixture.stateFile});
  const sourceFile = path.join(fixture.root, '.universe_cache.json');
  fs.writeFileSync(sourceFile, '["000001"]', {mode: 0o600});
  assert.equal(await governor.run(EM, () => 'success'), 'success');
  const failure = errorOf(governor.run(TX, () => { throw Error('ordinary failure'); }));
  assert.match((await failure).message, /ordinary failure/);
  governor.checkResponse(EM, 200, {'retry-after': '99999', Authorization: 'never-persist'});
  assert.equal(fs.existsSync(fixture.directory), false);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), '["000001"]');
  const pure = create(clock, {stateFile: null});
  assert.throws(() => pure.checkResponse(EM, 429, {}));
  assert.equal(fs.existsSync(fixture.directory), false);
});

test('restriction-only persistence does not alter source caches or serialize URLs and headers', t => {
  const fixture = privateFixture(t), clock = fakeClock(), governor = create(clock, {stateFile: fixture.stateFile});
  const sourceFile = path.join(fixture.root, 'stocks_snapshot.json');
  fs.writeFileSync(sourceFile, '{"retained":"source data"}', {mode: 0o600});
  assert.throws(() => governor.checkResponse(EM, 429, {'Retry-After': '120', Cookie: 'private-token', Authorization: 'secret-token'}));
  const bytes = fs.readFileSync(fixture.stateFile, 'utf8');
  for (const secret of ['secret', 'not-for-status', 'http', 'token', 'Cookie', 'Authorization', 'Retry']) assert.ok(!bytes.includes(secret));
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), '{"retained":"source data"}');
});

test('corrupt, unknown-schema, oversized and unexpected-family state fail closed', async t => {
  for (const body of [
    '{broken', JSON.stringify({schemaVersion: 2, providers: {}}), ' '.repeat(17000),
    JSON.stringify({schemaVersion: 1, providers: {eastmoney: {blockedUntil: -1, status: 429}}}),
    JSON.stringify({schemaVersion: 1, providers: {'url-secret.example': {blockedUntil: 42, status: 403}}}),
    JSON.stringify({schemaVersion: 1, providers: {}, credential: 'not-supported'})
  ]) {
    const fixture = privateFixture(t), clock = fakeClock();
    fs.mkdirSync(fixture.directory, {mode: 0o700});
    fs.writeFileSync(fixture.stateFile, body, {mode: 0o600});
    await assertStopped(create(clock, {stateFile: fixture.stateFile}));
  }
});

test('insecure directory/file permission bits fail closed even for a root process', async t => {
  for (const mode of ['directory', 'file']) {
    const fixture = privateFixture(t), clock = fakeClock();
    storedState(fixture.stateFile, {});
    fs.chmodSync(mode === 'directory' ? fixture.directory : fixture.stateFile, mode === 'directory' ? 0o755 : 0o644);
    await assertStopped(create(clock, {stateFile: fixture.stateFile}));
  }
});

test('symlinked private files and parent directories are rejected without altering their targets', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  storedState(fixture.stateFile, {});
  const before = fs.readFileSync(fixture.stateFile, 'utf8');
  const aliasDirectory = path.join(fixture.root, 'alias');
  fs.symlinkSync(fixture.directory, aliasDirectory);
  await assertStopped(create(clock, {stateFile: path.join(aliasDirectory, 'cooldown.json')}));
  const aliasFile = path.join(fixture.directory, 'alias.json');
  fs.symlinkSync(fixture.stateFile, aliasFile);
  await assertStopped(create(clock, {stateFile: aliasFile}));
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), before);
});

test('a state file changed to corrupt after startup blocks the very next physical request', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  storedState(fixture.stateFile, {});
  const governor = create(clock, {stateFile: fixture.stateFile});
  fs.writeFileSync(fixture.stateFile, 'corrupt-after-startup');
  await assertStopped(governor);
  fs.writeFileSync(fixture.stateFile, JSON.stringify({schemaVersion: 1, providers: {}}));
  await assertStopped(governor); // An availability failure is sticky until operator recovery/restart.
});

test('an exclusive restriction-write lock prevents stale writers from overwriting state', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  storedState(fixture.stateFile, {eastmoney: {blockedUntil: clock.now() + 7200000, status: 429}});
  const before = fs.readFileSync(fixture.stateFile, 'utf8');
  const lockFile = fixture.stateFile + '.lock';
  fs.writeFileSync(lockFile, '', {mode: 0o600});
  const governor = create(clock, {stateFile: fixture.stateFile});
  assert.throws(() => governor.checkResponse(TX, 403, {}), error => error.code === 'MARKET_RESTRICTED' && error.stateUnavailable === true);
  await assertStopped(governor, TX_HISTORY);
  assert.equal(fs.readFileSync(fixture.stateFile, 'utf8'), before);
  assert.equal(fs.existsSync(lockFile), true); // Never remove another process's or a stale lock.
});

test('a crash lock without a published state file fails closed on restart and dispatch', async t => {
  const fixture = privateFixture(t), clock = fakeClock();
  fs.mkdirSync(fixture.directory, {mode: 0o700});
  const beforeCrash = create(clock, {stateFile: fixture.stateFile});
  fs.writeFileSync(fixture.stateFile + '.lock', '', {mode: 0o600});
  assert.equal(fs.existsSync(fixture.stateFile), false);
  await assertStopped(create(clock, {stateFile: fixture.stateFile}));
  await assertStopped(beforeCrash);
  assert.equal(fs.existsSync(fixture.stateFile + '.lock'), true);
  assert.equal(fs.existsSync(fixture.stateFile), false);
});

test('atomic rename failure fails closed and removes only this writer temporary and lock files', async t => {
  const fixture = privateFixture(t), clock = fakeClock(), governor = create(clock, {stateFile: fixture.stateFile});
  const original = fs.renameSync;
  fs.renameSync = (...args) => { if (args[1] === fixture.stateFile) throw Error('fixture denied rename'); return original(...args); };
  try {
    assert.throws(() => governor.checkResponse(EM, 429, {}), error => error.code === 'MARKET_RESTRICTED' && error.stateUnavailable === true);
  } finally { fs.renameSync = original; }
  await assertStopped(governor);
  assert.deepEqual(fs.readdirSync(fixture.directory), []);
});

test('invalid persistence locations fail closed rather than falling back to another directory', async t => {
  const clock = fakeClock();
  await assertStopped(create(clock, {stateFile: 'https://example.org/private'}));
  await assertStopped(create(clock, {stateFile: 42}));
  await assertStopped(create(clock, {stateFile: '/cooldown.json'}));
});
