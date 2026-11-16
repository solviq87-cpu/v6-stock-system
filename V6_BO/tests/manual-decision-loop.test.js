'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const M = require('../src/core/manual-decision-loop'),
  S = require('../src/core/research-workspace-store');
const { fixture } = require('./helpers/research-workspace-fixtures'),
  D = require('../src/core/research-workspace-decision');
const at = (s) => Date.parse(s + '+08:00');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-manual-loop-')),
    root = path.join(dir, 'loop'),
    workspaceRoot = path.join(dir, 'research');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = D.buildWorkspaceDecision(fixture()),
    source = S.appendEvent(workspaceRoot, 'analysis', data, {
      requestId: 'synthetic_source',
      now: data.asOf,
    });
  let now = at('2026-08-17T08:00:00'),
    seq = 0;
  const options = {
    workspaceRoot,
    riskPolicy: { stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90 },
  };
  const run = (action, body = {}, extra = {}) =>
    M.execute(
      root,
      {
        action,
        requestId: 'command_' + String(++seq).padStart(8, '0'),
        expectedRevision: M.view(root).revision,
        ...body,
        ...extra,
      },
      { ...options, now },
    );
  const setTime = (s) => {
    now = at(s);
  };
  const freeze = () =>
    run('freeze', { runId: source.hash, shares: 100, limitPrice: '10.00' })
      .recordId;
  return {
    dir,
    root,
    workspaceRoot,
    options,
    run,
    freeze,
    setTime,
    source,
    view: () => M.view(root),
    plan: () => M.view(root).plans[0],
  };
}
const buy = {
  reference: 'synthetic-buy',
  side: 'buy',
  quantity: 100,
  price: '10.00',
  fee: '5.00',
  executedAt: '2026-08-17T10:00:00+08:00',
};
const sell = {
  reference: 'synthetic-sell',
  side: 'sell',
  quantity: 100,
  price: '11.00',
  fee: '6.00',
  executedAt: '2026-08-18T10:00:00+08:00',
};
function filled(x) {
  const planId = x.freeze();
  x.setTime('2026-08-17T10:01:00');
  x.run('fill', { planId, fill: buy });
  x.setTime('2026-08-18T10:01:00');
  x.run('fill', { planId, fill: sell });
  return planId;
}
function reviewed(x) {
  const planId = filled(x);
  x.run('reconcile', {
    planId,
    statement: {
      sourceLabel: 'synthetic independent statement',
      rows: [buy, sell],
    },
  });
  x.run('review', { planId, note: '合成复盘：全部申报成本已计入' });
  return planId;
}
const protocol = {
  trainEnd: '2026-08-19',
  validationEnd: '2026-09-23',
  holdoutEnd: '2026-10-28',
  gates: {
    minClosedTrades: 3,
    maxDrawdownPct: 10,
    minReturnPct: 0,
    minExcessReturnPct: 0,
    costStressBps: 10,
  },
};
function candidate(x, planId) {
  x.setTime('2026-08-19T16:30:00');
  return x.run('propose', {
    planId,
    hypothesis: '冻结先验强度后在未来两段数据比较',
    parameters: { learningConfig: { minimumSamples: 20, priorStrength: 4 } },
    protocol,
  }).recordId;
}
function researchInput() {
  const v = require('./helpers/adaptive-fixture').fixture(150);
  for (const s of v.stocks)
    s.bars.forEach((b, i) => {
      const c = (s.symbol === '600000' ? 20 : 30) * 1.01 ** i;
      Object.assign(b, {
        close: c,
        open: c * 0.9998,
        high: c * 1.0005,
        low: c * 0.9995,
      });
    });
  v.simulation = {
    initialCash: 100000,
    topN: 2,
    holdDays: 1,
    feeBps: 8,
    slippageBps: 10,
    sellTaxBps: 5,
  };
  return v;
}
test('GET creates no directories; full roundtrip matches all fields and deducts actual fees', (t) => {
  const x = setup(t);
  assert.equal(x.view().revision, 0);
  assert.equal(fs.existsSync(x.root), false);
  const id = reviewed(x),
    p = x.plan();
  assert.equal(p.id, id);
  assert.equal(p.status, 'reviewed');
  assert.equal(p.totals.netPnlCents, 8900);
  assert.deepEqual(p.totals.deviations, []);
  assert.equal(p.review.result.reconciliationId, p.reconciliation.id);
  assert.equal(p.brokerVerified, false);
  assert.equal(p.canTrade, false);
  assert.equal(p.risk.aiMayChangeLimits, false);
  assert.equal(p.risk.status, 'not-authorized');
  assert.equal(fs.statSync(x.root).mode & 0o777, 0o700);
  assert.equal(
    fs.statSync(path.join(x.root, '000001.json')).mode & 0o777,
    0o600,
  );
});
test('unexecuted ideas are retained without invented profit', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.run('not-executed', { planId, reason: '没有执行' });
  x.run('review', { planId, note: '保留未执行分母' });
  assert.equal(x.view().summary.notExecuted, 1);
  assert.equal(x.plan().review.result.netPnlCents, null);
  assert.throws(() => x.run('fill', { planId, fill: buy }));
});
test('source, strategy roles and risk policy stay frozen when inputs change', (t) => {
  const x = setup(t);
  x.freeze();
  x.options.riskPolicy.stopPct = -99;
  S.appendEvent(
    x.workspaceRoot,
    'analysis',
    { ...x.source.data, regime: 'new-regime' },
    { requestId: 'another_source', now: at('2026-08-17T08:00:00') },
  );
  assert.equal(x.plan().risk.policy.stopPct, -8);
  assert.equal(x.plan().sourceHash, S.digest(x.source.data));
  assert.equal(S.readEvents(x.workspaceRoot).length, 2);
});
test('exact retries work after later progress; changed payload and stale second device fail', (t) => {
  const x = setup(t),
    input = {
      action: 'freeze',
      requestId: 'stable_request',
      expectedRevision: 0,
      runId: x.source.hash,
      shares: 100,
      limitPrice: '10',
    };
  const one = M.execute(x.root, input, {
    ...x.options,
    now: at('2026-08-17T08:00:00'),
  });
  x.setTime('2026-08-17T10:01:00');
  x.run('fill', { planId: one.recordId, fill: buy });
  assert.equal(M.execute(x.root, input, x.options).reused, true);
  assert.equal(x.view().revision, 2);
  assert.throws(
    () => M.execute(x.root, { ...input, shares: 200 }, x.options),
    /冲突/,
  );
  assert.throws(
    () =>
      x.run(
        'not-executed',
        { planId: one.recordId, reason: 'stale' },
        { expectedRevision: 0 },
      ),
    /另一端/,
  );
});
test('a reference cannot be counted twice across plans or after a void', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.setTime('2026-08-17T10:01:00');
  x.run('fill', { planId, fill: buy });
  const other = x.freeze();
  assert.throws(() => x.run('fill', { planId: other, fill: buy }), /已使用/);
  const original = x.view().plans.find((p) => p.id === planId).fills[0];
  x.run('void-fill', { planId, fillId: original.id, reason: '录入错误' });
  assert.throws(() => x.run('fill', { planId, fill: buy }), /已使用/);
  assert.equal(x.view().plans.find((p) => p.id === planId).voids.length, 1);
});
test('partial sales have no invented realized total; no overselling or out-of-order rows', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.setTime('2026-08-18T10:01:00');
  x.run('fill', { planId, fill: buy });
  x.run('fill', { planId, fill: { ...sell, quantity: 50 } });
  assert.equal(x.plan().totals.netPnlCents, null);
  assert.throws(() => x.run('review', { planId, note: '不能平仓' }), /先平仓/);
  assert.throws(
    () =>
      x.run('fill', {
        planId,
        fill: { ...sell, reference: 'oversell', quantity: 51 },
      }),
    /卖出超过/,
  );
  assert.throws(
    () => x.run('fill', { planId, fill: { ...buy, reference: 'earlier' } }),
    /时间顺序/,
  );
});
test('T+1 and plan deviations are kept as evidence, never passed as clean execution', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.setTime('2026-08-17T15:00:00');
  x.run('fill', { planId, fill: { ...buy, price: '10.01' } });
  const sameDay = { ...sell, executedAt: '2026-08-17T14:00:00+08:00' };
  x.run('fill', { planId, fill: sameDay });
  x.run('reconcile', {
    planId,
    statement: {
      sourceLabel: 'synthetic',
      rows: [{ ...buy, price: '10.01' }, sameDay],
    },
  });
  x.run('review', { planId, note: '保留违规回填' });
  assert.equal(x.plan().review.result.outcome, 'closed-with-deviations');
  assert.ok(x.plan().totals.deviations.some((s) => s.includes('T+1')));
  assert.ok(x.plan().totals.deviations.some((s) => s.includes('买价')));
});
test('statement must match fees, side, quantity, price and timestamps; mismatches stay in history', (t) => {
  const x = setup(t),
    planId = filled(x);
  for (const changed of [
    { fee: '6.01' },
    { price: '11.01' },
    { quantity: 99 },
    { side: 'buy' },
    { executedAt: '2026-08-18T10:00:01+08:00' },
  ]) {
    x.run('reconcile', {
      planId,
      statement: {
        sourceLabel: 'synthetic mismatch',
        rows: [buy, { ...sell, ...changed }],
      },
    });
    assert.equal(x.plan().reconciliation.matched, false);
    assert.throws(() => x.run('review', { planId, note: '不能通过' }));
  }
  x.run('reconcile', {
    planId,
    statement: { sourceLabel: 'synthetic matched', rows: [sell, buy] },
  });
  assert.equal(x.plan().reconciliation.matched, true);
  assert.equal(x.plan().reconciliations.length, 6);
});
test('reopen retains prior review and candidate but makes candidate inapplicable', (t) => {
  const x = setup(t),
    planId = reviewed(x),
    candidateId = candidate(x, planId);
  x.run('reopen', { planId, reason: '原成交费用需纠错' });
  assert.equal(x.plan().review, null);
  assert.equal(x.plan().reconciliation, null);
  assert.equal(x.plan().history.filter((e) => e.type === 'review').length, 1);
  assert.equal(x.plan().candidates.length, 1);
  assert.throws(() => x.run('validate', { planId, candidateId }), /失效/);
});
test('proposal cannot relax hard risk, backdate validation, or assert its own pass flag', (t) => {
  const x = setup(t),
    planId = reviewed(x);
  x.setTime('2026-08-19T16:30:00');
  const base = { planId, hypothesis: '合成协议', parameters: {}, protocol };
  for (const parameters of [
    { stopPct: -99 },
    { learningConfig: { maxDrawdownPausePct: 99 } },
    { selectionPolicy: { maxIndexWeightPct: 10 } },
  ])
    assert.throws(() => x.run('propose', { ...base, parameters }));
  assert.throws(() =>
    x.run('propose', {
      ...base,
      protocol: { ...protocol, validationEnd: '2026-08-19' },
    }),
  );
  assert.throws(() => x.run('propose', { ...base, passed: true }));
  assert.throws(
    () =>
      x.run('propose', {
        ...base,
        protocol: { ...protocol, trainEnd: '2026-08-18' },
      }),
    /训练末日/,
  );
  const first = x.run('propose', base).recordId;
  assert.throws(() => x.run('propose', base), /重叠/);
  assert.equal(x.plan().candidates[0].id, first);
});
test('actual frozen validation and cost stress run once over server-owned future data', (t) => {
  const x = setup(t),
    planId = reviewed(x),
    candidateId = candidate(x, planId);
  assert.throws(() => x.run('validate', { planId, candidateId }), /尚未结束/);
  x.setTime('2026-10-29T10:00:00');
  assert.throws(() => x.run('validate', { planId, candidateId }), /尚未配置/);
  const file = path.join(x.dir, 'input.json'),
    source = researchInput();
  fs.writeFileSync(file, JSON.stringify(source), { mode: 0o600 });
  x.options.validationFile = file;
  x.run('validate', { planId, candidateId });
  const c = x.plan().candidates[0];
  assert.equal(c.validation.status, 'research-validated');
  assert.equal(c.validation.inputHash, S.digest(source));
  assert.equal(c.validation.evaluation.holdoutRead, false);
  assert.equal(c.validation.holdout.eligible, true);
  assert.equal(c.validation.autoPromotion, false);
  assert.equal(c.validation.productionWeightsChanged, false);
  assert.throws(() => x.run('validate', { planId, candidateId }), /反复/);
});
test('cost/sample failure remains rejected, with no production changes', (t) => {
  const x = setup(t),
    planId = reviewed(x);
  x.setTime('2026-08-19T16:30:00');
  const candidateId = x.run('propose', {
    planId,
    hypothesis: '不可达样本数',
    parameters: {},
    protocol: {
      ...protocol,
      gates: { ...protocol.gates, minClosedTrades: 9999 },
    },
  }).recordId;
  x.setTime('2026-10-29T10:00:00');
  x.options.validationFile = path.join(x.dir, 'input.json');
  fs.writeFileSync(x.options.validationFile, JSON.stringify(researchInput()), {
    mode: 0o600,
  });
  x.run('validate', { planId, candidateId });
  assert.equal(x.plan().candidates[0].validation.status, 'rejected');
});
test('reject invalid precision, negative fees, time rollovers, future times and secret fields without writes', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.setTime('2026-08-17T11:00:00');
  for (const changed of [
    { price: 10 },
    { price: '10.00001' },
    { price: '1e2' },
    { fee: '-1' },
    { fee: '1.001' },
    { quantity: 1.5 },
    { side: 'short' },
    { executedAt: '2026-08-17T24:00:00+08:00' },
    { executedAt: '2026-08-18T10:00:00+08:00' },
    { executedAt: '2026-08-17 10:00:00' },
    { reference: 'token=private' },
  ])
    assert.throws(() =>
      x.run('fill', { planId, fill: { ...buy, ...changed } }),
    );
  assert.throws(() =>
    x.run('not-executed', { planId, reason: 'https://private.test/token' }),
  );
  assert.equal(x.view().revision, 1);
});
test('integer money rounding is deterministic at fractional cent boundaries', (t) => {
  const x = setup(t),
    planId = x.freeze();
  x.setTime('2026-08-17T11:00:00');
  x.run('fill', {
    planId,
    fill: { ...buy, quantity: 1, price: '0.015', fee: '0' },
  });
  assert.equal(x.plan().totals.buyCents, 2);
});
test('restart replay is stable and corruption fails closed', (t) => {
  const x = setup(t);
  reviewed(x);
  const v = x.view();
  delete require.cache[require.resolve('../src/core/manual-decision-loop')];
  assert.deepEqual(require('../src/core/manual-decision-loop').view(x.root), v);
  const f = path.join(x.root, '000002.json');
  fs.appendFileSync(f, 'x');
  assert.throws(() => x.view());
  assert.throws(() =>
    x.run('freeze', { runId: x.source.hash, shares: 100, limitPrice: '10' }),
  );
});
test('private storage rejects public paths and symlinks', (t) => {
  const x = setup(t);
  assert.throws(() => M.view(path.join(x.dir, 'public', 'loop')));
  fs.symlinkSync(x.dir, path.join(x.dir, 'link'));
  assert.throws(() => M.view(path.join(x.dir, 'link', 'loop')));
});
