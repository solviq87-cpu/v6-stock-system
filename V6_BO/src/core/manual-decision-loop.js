'use strict';
// User-declared execution evidence. This journal has no account or broker authority.
const fs = require('node:fs'),
  path = require('node:path');
const S = require('./research-workspace-store');
const { createTradingCalendar } = require('./trading-calendar');
const L = require('./learning-profile-registry');
const FLAGS = {
  ...S.FLAGS,
  brokerVerified: false,
  accountWrites: false,
  autoPromotion: false,
};
const day = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const date = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
function fail(message, code = 'LOOP_INPUT') {
  const e = Error(message);
  e.code = code;
  throw e;
}
function object(v, keys) {
  if (
    !v ||
    Array.isArray(v) ||
    typeof v !== 'object' ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail('字段无效或包含未允许的配置');
}
function text(v, max = 500) {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u001f]/.test(v) ||
    /(?:https?:\/\/|webhook|sharecode|api[_ -]?key|password|bearer\s|token\s*[:=])/i.test(
      v,
    )
  )
    fail('文字无效，禁止写入网址或凭据');
  return v.trim();
}
function id(v) {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('记录编号无效');
  return v;
}
function integer(v, max = 10000000) {
  if (!Number.isSafeInteger(v) || v < 1 || v > max)
    fail('数量须为限额内正整数');
  return v;
}
function decimal(v, places, zero = false) {
  if (
    typeof v !== 'string' ||
    !new RegExp('^(0|[1-9]\\d{0,7})(\\.\\d{1,' + places + '})?$').test(v)
  )
    fail('价格或费用须为精确十进制字符串');
  const [a, b = ''] = v.split('.'),
    n = Number(a) * 10 ** places + Number(b.padEnd(places, '0'));
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1)) fail('价格或费用无效');
  return n;
}
function timestamp(v, now) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+08:00)$/.test(v) ||
    !date(v.slice(0, 10))
  )
    fail('成交时间须含秒及 Z 或 +08:00 时区');
  const n = Date.parse(v);
  if (
    Number.isFinite(n) &&
    new Date(n + (v.endsWith('+08:00') ? 8 * 3600000 : 0))
      .toISOString()
      .slice(0, 19) !== v.slice(0, 19)
  )
    fail('成交时间不是有效日内时点');
  if (!Number.isSafeInteger(n) || n <= 0 || n > now)
    fail('成交时间无效或晚于当前时点');
  return n;
}
function fillInput(v, now) {
  object(v, ['reference', 'side', 'quantity', 'price', 'fee', 'executedAt']);
  if (!['buy', 'sell'].includes(v.side)) fail('成交方向无效');
  const reference = text(v.reference, 80);
  if (!/^[A-Za-z0-9_.:-]+$/.test(reference))
    fail('成交编号只允许字母、数字和 ._:-');
  const quantity = integer(v.quantity),
    priceUnits = decimal(v.price, 4),
    feeCents = decimal(v.fee, 2, true),
    executedAt = timestamp(v.executedAt, now);
  const amountCents = Number(
    (BigInt(quantity) * BigInt(priceUnits) + 50n) / 100n,
  );
  if (!Number.isSafeInteger(amountCents) || amountCents > 1e13)
    fail('成交金额超限');
  return {
    reference,
    side: v.side,
    quantity,
    priceUnits,
    feeCents,
    amountCents,
    executedAt,
  };
}
function totals(plan) {
  let quantity = 0,
    buyCents = 0,
    sellCents = 0;
  const lots = [],
    deviations = [];
  const calendar = createTradingCalendar(plan.calendar);
  for (const f of plan.fills) {
    const d = day(f.executedAt);
    let open = false;
    try {
      open = calendar.isOpen(d);
    } catch {
      deviations.push('成交日期不在冻结日历范围');
    }
    if (!open) deviations.push('成交日期不是冻结日历开市日');
    if (f.executedAt < plan.frozenAt) deviations.push('成交早于建议冻结时点');
    if (f.side === 'buy') {
      quantity += f.quantity;
      buyCents += f.amountCents + f.feeCents;
      lots.push({ date: d, quantity: f.quantity });
      if (f.priceUnits > plan.limitPriceUnits)
        deviations.push('买价高于建议上限');
      if (quantity > plan.shares) deviations.push('数量超过建议数量');
    } else {
      if (f.quantity > quantity) fail('卖出超过本建议已记录的持仓');
      let left = f.quantity;
      for (const lot of lots) {
        const n = Math.min(left, lot.quantity);
        if (n && lot.date >= d) deviations.push('卖出未满足 T+1');
        lot.quantity -= n;
        left -= n;
        if (!left) break;
      }
      quantity -= f.quantity;
      sellCents += f.amountCents - f.feeCents;
    }
  }
  return {
    quantity,
    buyCents,
    sellCents,
    netPnlCents:
      plan.fills.length && quantity === 0 ? sellCents - buyCents : null,
    deviations: [...new Set(deviations)],
  };
}
function project(events) {
  const plans = new Map();
  for (const e of events) {
    if (e.kind !== 'manual-loop' || e.data?.schemaVersion !== 1)
      fail('闭环历史类型无效', 'LOOP_INTEGRITY');
    const d = e.data;
    if (d.type === 'freeze') {
      plans.set(e.hash, {
        id: e.hash,
        frozenAt: e.recordedAt,
        ...d.snapshot,
        fills: [],
        voids: [],
        reconciliations: [],
        review: null,
        candidates: [],
        notExecuted: null,
        history: [{ id: e.hash, type: 'freeze', recordedAt: e.recordedAt }],
      });
      continue;
    }
    const p = plans.get(d.planId);
    if (!p) fail('闭环历史缺少原建议', 'LOOP_INTEGRITY');
    p.history.push({
      id: e.hash,
      type: d.type,
      recordedAt: e.recordedAt,
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.type === 'review' ? { note: d.note, result: d.result } : {}),
    });
    if (d.type === 'fill') {
      p.fills.push({ id: e.hash, ...d.fill });
      p.reconciliation = null;
    } else if (d.type === 'void-fill') {
      p.fills = p.fills.filter((f) => f.id !== d.fillId);
      p.voids.push({ id: e.hash, fillId: d.fillId, reason: d.reason });
      p.reconciliation = null;
    } else if (d.type === 'not-executed')
      p.notExecuted = { reason: d.reason, recordedAt: e.recordedAt };
    else if (d.type === 'reconcile') {
      p.reconciliation = { id: e.hash, ...d.result };
      p.reconciliations.push(p.reconciliation);
    } else if (d.type === 'review')
      p.review = {
        id: e.hash,
        recordedAt: e.recordedAt,
        note: d.note,
        result: d.result,
      };
    else if (d.type === 'reopen') {
      p.review = null;
      p.reconciliation = null;
      p.notExecuted = null;
    } else if (d.type === 'propose')
      p.candidates.push({
        id: e.hash,
        reviewId: d.reviewId,
        hypothesis: d.hypothesis,
        parameters: d.parameters,
        protocol: d.protocol,
        proposedAt: e.recordedAt,
        validation: null,
      });
    else if (d.type === 'validate') {
      const c = p.candidates.find((c) => c.id === d.candidateId);
      if (!c) fail('缺少冻结候选', 'LOOP_INTEGRITY');
      c.validation = { id: e.hash, ...d.result };
    } else fail('闭环历史动作无效', 'LOOP_INTEGRITY');
  }
  for (const p of plans.values()) {
    p.totals = totals(p);
    p.status = p.review
      ? 'reviewed'
      : p.notExecuted
        ? 'not-executed'
        : p.fills.length
          ? p.totals.quantity
            ? 'holding'
            : p.reconciliation?.matched
              ? 'reconciled'
              : 'needs-reconciliation'
          : 'frozen';
  }
  return [...plans.values()];
}
function publicPlan(p) {
  const { calendar, ...out } = p;
  return {
    ...out,
    calendar: { ...createTradingCalendar(calendar).metadata },
    ...FLAGS,
  };
}
function sourceList(workspaceRoot) {
  if (!workspaceRoot) return { status: 'unconfigured', total: 0, rows: [] };
  try {
    const events = S.readEvents(workspaceRoot).filter(
      (e) => e.kind === 'analysis',
    );
    return {
      status: 'available',
      total: events.length,
      rows: events
        .slice(-100)
        .reverse()
        .map((e) => ({
          id: e.hash,
          symbol: e.data.symbol,
          name: e.data.name || '',
          tradeDate: e.data.tradeDate || null,
          recordedAt: e.recordedAt,
        })),
    };
  } catch {
    return { status: 'unavailable', total: null, rows: [] };
  }
}
function view(root, options = {}) {
  const events = S.readEvents(root),
    plans = project(events);
  return {
    research: sourceList(options.workspaceRoot),
    schemaVersion: 1,
    revision: events.length,
    headHash: events.at(-1)?.hash ?? null,
    plans: plans.reverse().map(publicPlan),
    summary: {
      frozen: plans.length,
      notExecuted: plans.filter((p) => p.notExecuted).length,
      reviewed: plans.filter((p) => p.review).length,
    },
    ...FLAGS,
  };
}
function protocol(v, now) {
  object(v, ['trainEnd', 'validationEnd', 'holdoutEnd', 'gates']);
  const today = day(now);
  if (
    ![v.trainEnd, v.validationEnd, v.holdoutEnd].every(date) ||
    v.trainEnd < today ||
    v.validationEnd <= v.trainEnd ||
    v.validationEnd <= today ||
    v.holdoutEnd <= v.validationEnd
  )
    fail('训练末日不得早于候选冻结日；验证期和样本外期须在其后且顺序递增');
  object(v.gates, [
    'minClosedTrades',
    'maxDrawdownPct',
    'minReturnPct',
    'minExcessReturnPct',
    'costStressBps',
  ]);
  const g = v.gates;
  if (
    !Number.isSafeInteger(g.minClosedTrades) ||
    g.minClosedTrades < 3 ||
    g.minClosedTrades > 10000 ||
    !Number.isFinite(g.maxDrawdownPct) ||
    g.maxDrawdownPct <= 0 ||
    g.maxDrawdownPct > 50 ||
    !Number.isFinite(g.minReturnPct) ||
    g.minReturnPct < 0 ||
    g.minReturnPct > 100 ||
    !Number.isFinite(g.minExcessReturnPct) ||
    g.minExcessReturnPct < 0 ||
    g.minExcessReturnPct > 100 ||
    !Number.isFinite(g.costStressBps) ||
    g.costStressBps < 10 ||
    g.costStressBps > 100
  )
    fail('须冻结有效的样本数、回撤、收益和成本压力门槛');
  return S.canonical(v);
}
function validationInput(file) {
  if (!file)
    fail(
      '尚未配置私有验证数据；候选继续等待，不改变生产参数',
      'LOOP_VALIDATION_UNCONFIGURED',
    );
  if (typeof file !== 'string' || !path.isAbsolute(file))
    fail('验证数据配置无效');
  S.privateRoot(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.mode & 0o077 || s.size > 8 * 1024 * 1024)
      fail('验证文件权限或容量无效');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally {
    fs.closeSync(fd);
  }
}
function execute(root, input, options = {}) {
  object(input, [
    'action',
    'requestId',
    'expectedRevision',
    'runId',
    'shares',
    'limitPrice',
    'planId',
    'fill',
    'fillId',
    'reason',
    'statement',
    'note',
    'hypothesis',
    'parameters',
    'protocol',
    'candidateId',
  ]);
  const keys = {
    freeze: ['runId', 'shares', 'limitPrice'],
    fill: ['planId', 'fill'],
    'void-fill': ['planId', 'fillId', 'reason'],
    'not-executed': ['planId', 'reason'],
    reconcile: ['planId', 'statement'],
    review: ['planId', 'note'],
    reopen: ['planId', 'reason'],
    propose: ['planId', 'hypothesis', 'parameters', 'protocol'],
    validate: ['planId', 'candidateId'],
  };
  if (
    !keys[input.action] ||
    Object.keys(input).some(
      (k) =>
        ![
          'action',
          'requestId',
          'expectedRevision',
          ...keys[input.action],
        ].includes(k),
    )
  )
    fail('闭环动作或字段无效');
  if (
    typeof input.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    fail('需要请求编号及服务端修订号');
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0 || now > Date.now())
    fail('当前时点无效');
  const events = S.readEvents(root),
    commandHash = S.digest(input),
    old = events.find((e) => e.requestId === input.requestId);
  if (old) {
    if (old.data.commandHash !== commandHash)
      fail('同请求编号内容冲突', 'LOOP_CONFLICT');
    return {
      revision: events.length,
      recordId: old.hash,
      reused: true,
      ...FLAGS,
    };
  }
  if (events.length !== input.expectedRevision)
    fail('另一端已更新，请重新读取后再操作', 'LOOP_CONFLICT');
  const plans = project(events),
    type = input.action,
    data = { schemaVersion: 1, type, commandHash };
  let p;
  if (type === 'freeze') {
    const source = S.readEvents(options.workspaceRoot).find(
      (e) => e.hash === id(input.runId) && e.kind === 'analysis',
    );
    if (!source || source.recordedAt > now || source.data.asOf > now)
      fail('原始冻结研究不存在或晚于当前时点');
    const calendar = S.canonical(
      options.calendar || require('../../config/research-calendar-2026.json'),
    );
    createTradingCalendar(calendar);
    const cfg = options.riskPolicy || {};
    object(cfg, ['stopPct', 'reducePct', 'takePct', 'maxPosPct']);
    for (const v of Object.values(cfg))
      if (typeof v !== 'number' || !Number.isFinite(v))
        fail('原风控配置不可核验');
    data.snapshot = {
      runId: source.hash,
      symbol: source.data.symbol,
      name: source.data.name || '',
      sourceHash: S.digest(source.data),
      sourceAsOf: source.data.asOf,
      sourceVersion: source.data.codeVersion || null,
      shares: integer(input.shares),
      limitPriceUnits: decimal(input.limitPrice, 4),
      calendar,
      roles: {
        selection: source.data.systems || [],
        regime: source.data.regime ?? 'unknown',
        regimeMeaning: source.data.regimeMeaning || 'unknown',
        sizing: 'manual-proposal-unvalidated',
      },
      risk: {
        policy: S.canonical(cfg),
        status: 'not-authorized',
        reason:
          '冻结原配置仅供复核，缺少组合/实时行情认证；本记录不构成下单放行',
        aiMayChangeLimits: false,
      },
    };
  } else {
    p = plans.find((p) => p.id === id(input.planId));
    if (!p) fail('建议不存在');
    data.planId = p.id;
    if (p.review && !['reopen', 'propose', 'validate'].includes(type))
      fail('复盘已冻结；纠错须先重开，旧证据保留');
    if (p.notExecuted && !['reopen', 'review'].includes(type))
      fail('已记未执行，须先重开');
    if (type === 'fill') {
      if (p.fills.length >= 100) fail('单建议最多100笔成交');
      const f = fillInput(input.fill, now);
      if (
        plans.some(
          (p) =>
            p.fills.some((x) => x.reference === f.reference) ||
            p.voids.some(
              (v) =>
                events.find((e) => e.hash === v.fillId)?.data.fill.reference ===
                f.reference,
            ),
        )
      )
        fail('成交编号已使用，不能重复计入');
      if (p.fills.length && f.executedAt < p.fills.at(-1).executedAt)
        fail('请按成交时间顺序登记');
      if (p.fills.length && p.totals.quantity === 0)
        fail('已平仓建议不可追加新一轮交易');
      totals({ ...p, fills: [...p.fills, f] });
      data.fill = f;
    } else if (type === 'void-fill') {
      data.fillId = id(input.fillId);
      if (!p.fills.some((f) => f.id === data.fillId)) fail('待纠错成交不存在');
      data.reason = text(input.reason);
      totals({ ...p, fills: p.fills.filter((f) => f.id !== data.fillId) });
    } else if (type === 'not-executed') {
      if (p.fills.length) fail('已有成交不能记为未执行');
      data.reason = text(input.reason);
    } else if (type === 'reconcile') {
      object(input.statement, ['sourceLabel', 'rows']);
      const s = input.statement;
      if (!p.fills.length || !Array.isArray(s.rows) || s.rows.length > 100)
        fail('交割记录需包含限额内成交行');
      const rows = s.rows.map((f) => fillInput(f, now)),
        refs = rows.map((f) => f.reference);
      if (new Set(refs).size !== refs.length) fail('交割记录成交编号重复');
      const sort = (xs) =>
        xs
          .map(({ id, ...f }) => f)
          .sort((a, b) => a.reference.localeCompare(b.reference));
      data.result = {
        sourceLabel: text(s.sourceLabel, 80),
        rows,
        statementHash: S.digest(s),
        fillsHash: S.digest(p.fills),
        matched: S.digest(sort(rows)) === S.digest(sort(p.fills)),
        recordedAt: now,
        brokerVerified: false,
      };
    } else if (type === 'review') {
      if (
        !p.notExecuted &&
        (!p.fills.length ||
          p.totals.quantity !== 0 ||
          !p.reconciliation?.matched ||
          p.reconciliation.fillsHash !== S.digest(p.fills))
      )
        fail('须先平仓并逐字段对账一致，或明确记为未执行');
      data.note = text(input.note, 1000);
      data.result = {
        ...p.totals,
        outcome: p.notExecuted
          ? 'not-executed'
          : p.totals.deviations.length
            ? 'closed-with-deviations'
            : 'closed-user-reconciled',
        reconciliationId: p.reconciliation?.id ?? null,
        brokerVerified: false,
      };
    } else if (type === 'reopen') {
      if (!p.review && !p.notExecuted) fail('仅已复盘或未执行建议需要重开');
      data.reason = text(input.reason);
    } else if (type === 'propose') {
      if (!p.review) fail('先完成冻结复盘');
      if (p.candidates.length >= 10) fail('单建议最多10个候选');
      object(input.parameters, ['learningConfig', 'selectionPolicy']);
      data.reviewId = p.review.id;
      data.hypothesis = text(input.hypothesis, 1000);
      data.parameters = L.config(input.parameters);
      data.protocol = protocol(input.protocol, now);
      // Each immutable experiment gets a fresh future validation/holdout span.
      // Reopening a review cannot erase a previously read holdout.
      const prior = plans.flatMap((plan) =>
        plan.candidates.filter(
          (c) => c.validation || c.reviewId === plan.review?.id,
        ),
      );
      if (prior.some((c) => data.protocol.trainEnd < c.protocol.holdoutEnd))
        fail('候选验证区间与已有冻结实验重叠；请使用新的未来区间');
    } else if (type === 'validate') {
      const c = p.candidates.find((c) => c.id === id(input.candidateId));
      if (!c || c.reviewId !== p.review?.id)
        fail('候选不存在或关联复盘已重开失效');
      if (c.validation) fail('候选已检验，禁止反复窥看样本外');
      if (day(now) < c.protocol.holdoutEnd) fail('冻结样本外期尚未结束');
      const source = validationInput(options.validationFile);
      if (
        !date(source.asOf) ||
        source.asOf > day(now) ||
        source.asOf !== c.protocol.holdoutEnd
      )
        fail('验证数据时点须等于冻结样本外末日，且不得晚于当前日');
      // Configuration is frozen in the candidate; the client cannot upload prices,
      // pass flags, file paths, alternative parameters or production risk limits.
      const plan = {
        schemaVersion: 1,
        version: 'manual-loop-' + c.id.slice(0, 24),
        ...c.protocol,
        candidates: [{ id: 'candidate', parameters: c.parameters }],
      };
      const evaluation = L.validation(source, plan),
        holdout = L.holdout(source, plan, evaluation);
      data.candidateId = c.id;
      data.result = {
        status: holdout.eligible ? 'research-validated' : 'rejected',
        inputHash: S.digest(source),
        protocolHash: S.digest(plan),
        evaluation,
        holdout,
        checkedAt: now,
        ...FLAGS,
      };
    }
  }
  let event;
  try {
    event = S.appendEvent(root, 'manual-loop', data, {
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      now,
    });
  } catch (error) {
    const current = S.readEvents(root),
      prior = current.find((e) => e.requestId === input.requestId);
    if (prior?.data.commandHash === commandHash)
      return {
        revision: current.length,
        recordId: prior.hash,
        reused: true,
        ...FLAGS,
      };
    if (current.length !== events.length)
      fail('另一端已更新，请重新读取后再操作', 'LOOP_CONFLICT');
    throw error;
  }
  return {
    revision: event.revision,
    recordId: event.hash,
    reused: event.reused,
    ...FLAGS,
  };
}
module.exports = { FLAGS, view, execute, totals };
