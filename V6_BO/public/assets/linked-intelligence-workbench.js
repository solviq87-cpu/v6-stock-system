(function () {
'use strict';
const el = id => document.getElementById(id);
if (!el('linkedIntelligence')) return;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const value = x => x === null || x === undefined || x === '' ? '未知' : String(x);
const percent = x => finite(x) ? (x * 100).toFixed(1) + '%' : '数据不足';
const number = x => finite(x) ? x.toFixed(3) : '未知';
const money = x => finite(x) ? x.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' 元' : '未知';
const limit = x => Array.isArray(x) ? x.slice(0, 100) : [];
let publicContext = null;
const lanes = {
  public: { button: 'linkedPublicRun', status: 'linkedPublicStatus', inputs: ['linkedPublicSymbol', 'linkedSectorCode', 'linkedPublicDate'], outputs: ['linkedPublicSummary', 'linkedPublicOutput'] },
  analysis: { button: 'linkedIntelligenceRun', status: 'linkedIntelligenceStatus', inputs: ['linkedIntelligenceFile', 'linkedPersist'], outputs: ['linkedMarketSummary', 'linkedStockSummary', 'linkedSectorSummary', 'linkedIntelligenceOutput'] },
  memory: { button: 'linkedMemoryRead', status: 'linkedMemoryStatus', inputs: ['linkedMemorySymbol'], outputs: ['linkedMemorySummary', 'linkedMemoryOutput'] }
};
for (const lane of Object.values(lanes)) { lane.version = 0; lane.controller = null; lane.timer = null; }
function clearOutput(name) {
  if (name === 'public') publicContext = null;
  for (const id of lanes[name].outputs) el(id).replaceChildren();
}
function invalidate(name, message = '输入已变化，请重新读取') {
  const lane = lanes[name]; lane.version++; lane.controller?.abort(); lane.controller = null;
  clearTimeout(lane.timer); lane.timer = null; clearOutput(name);
  el(lane.button).disabled = false; el(lane.status).textContent = message;
}
function invalidatePublic(message) {
  invalidate('public', message); invalidate('analysis', '公共上下文已变化，请重新分析所选文件');
}
function invalidateAll(message) {
  for (const name of Object.keys(lanes)) invalidate(name, message);
  el('linkedIntelligenceFile').value = ''; el('linkedPersist').checked = false;
}
function selection(name) {
  const inputs = lanes[name].inputs.map(id => id === 'linkedIntelligenceFile' ? el(id).files?.[0] :
    id === 'linkedPersist' ? el(id).checked : el(id).value);
  return name === 'analysis' ? [...inputs, publicContext] : inputs;
}
function stale() { const error = Error('研究上下文已变化'); error.name = 'AbortError'; return error; }
function assertCurrent(context) {
  const lane = lanes[context.name];
  if (lane.version !== context.version || context.controller.signal.aborted) throw stale();
  if (context.token !== (el('token')?.value || '')) { invalidateAll('开发者令牌已更改，请重新读取'); throw stale(); }
  if (document.hidden) { invalidateAll('页面已隐藏，研究证据已清空'); throw stale(); }
  if (selection(context.name).some((v, i) => v !== context.selection[i])) {
    if (context.name === 'public') invalidatePublic(); else invalidate(context.name);
    throw stale();
  }
}
function node(tag, content, className) {
  const n = document.createElement(tag);
  if (content !== undefined) n.textContent = content;
  if (className) n.className = className;
  return n;
}
function line(parent, label, content) { parent.append(node('p', label + '：' + content)); }
function time(x) {
  if (x === null || x === undefined || x === '') return '原始时间缺失';
  const t = typeof x === 'number' ? x : typeof x === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;
  return finite(t) && Number.isFinite(new Date(t).getTime()) ? new Date(t).toISOString() : '原始时间缺失';
}
function raw(id, data) { el(id).textContent = JSON.stringify(data, null, 2); }
async function request(url, options, context) {
  assertCurrent(context);
  const response = await fetch(url, { ...options, cache: 'no-store', signal: context.controller.signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + context.token } });
  assertCurrent(context);
  if (response.status === 401 || response.status === 403) { invalidateAll('读取权限已失效，研究证据已清空'); throw stale(); }
  const body = await response.json(); assertCurrent(context);
  if (body.locked === true || body.needPassword === true) { invalidateAll('读取权限已失效，研究证据已清空'); throw stale(); }
  if (!response.ok || !body.ok) throw Error(body.error || '研究请求未完成');
  if (!body.result || typeof body.result !== 'object') throw Error('研究响应格式无效');
  return body.result;
}
async function action(buttonId, statusId, clear, run) {
  const button = el(buttonId), status = el(statusId);
  if (button.disabled || document.hidden) return;
  const name = Object.keys(lanes).find(key => lanes[key].button === buttonId), lane = lanes[name];
  if (name === 'public') invalidatePublic(); else invalidate(name);
  const context = { name, version: lane.version, token: el('token')?.value || '', selection: selection(name), controller: new AbortController() };
  lane.controller = context.controller; button.disabled = true;
  lane.timer = setTimeout(() => { if (lane.version === context.version) invalidate(name, '请求超时，请稍后重试'); }, 45000);
  status.textContent = '正在读取研究证据…';
  clear();
  try { await run(status, context); }
  catch (error) { if (lane.version === context.version) { clear(); status.textContent = error.name === 'AbortError' ? '请求已停止，请重新读取' : error.message || '请求失败'; } }
  finally { if (lane.version === context.version) { clearTimeout(lane.timer); lane.timer = null; lane.controller = null; button.disabled = false; } }
}
function renderFlow(parent, label, evidence) {
  const card = node('article', undefined, 'card'); card.append(node('h4', label));
  const rows = Array.isArray(evidence) ? evidence : Array.isArray(evidence?.records) ? evidence.records : Array.isArray(evidence?.rows) ? evidence.rows : evidence ? [evidence] : [];
  if (!rows.length) line(card, '主力净流入', '未知');
  if (rows.length > 1) card.append(node('p', '最近提供的最多8个交易日，最新在前', 'muted'));
  for (const row of rows.slice(-8).reverse()) {
    if (!row || typeof row !== 'object') continue;
    if (row.name || row.code || row.symbol) card.append(node('p', [row.name, row.code || row.symbol].filter(Boolean).join(' ')));
    const flow = row.mainNetInflow ?? row.mainInflow;
    line(card, '主力净流入', money(flow));
    line(card, '来源', value(row.source ?? evidence?.source));
    line(card, '资金口径', value(row.fundsMethod ?? evidence?.fundsMethod));
    line(card, '交易日期', value(row.tradeDate ?? evidence?.tradeDate));
    line(card, '原始观测时间', time(row.sourceTimestamp ?? evidence?.sourceTimestamp ?? row.observedAt ?? evidence?.observedAt));
    line(card, '本次获取时间', time(row.retrievedAt ?? evidence?.retrievedAt));
    if (row.status) line(card, '证据状态', value(row.status));
  }
  if (!rows.length) line(card, '原始观测时间', '原始时间缺失');
  parent.append(card);
}
function renderPublic(r) {
  const parent = el('linkedPublicSummary'); parent.replaceChildren();
  renderFlow(parent, '全市场资金', r.marketFlow);
  renderFlow(parent, '板块资金', r.sectorFlow);
  renderFlow(parent, '个股资金', r.stockFlow);
  const pool = node('article', undefined, 'card'); pool.append(node('h4', '涨停池与来源'));
  line(pool, '交易日期', value(r.tradeDate)); line(pool, '本次获取时间', time(r.retrievedAt));
  const pools = r.limitPools;
  if (pools && typeof pools === 'object' && !Array.isArray(pools)) {
    line(pool, '涨停池交易日期', value(pools.tradeDate));
    line(pool, '池覆盖', pools.complete === true ? '完整' : pools.complete === false ? '不完整' : '未知');
    for (const [key, label] of [['sealed', '封板'], ['broken', '炸板未封']]) {
      const data = pools[key];
      const count = finite(data?.fetchedCount) ? data.fetchedCount : Array.isArray(data?.records) ? data.records.length : null;
      line(pool, label + '数量', '已获取 ' + value(count) + ' / 来源总数 ' + value(data?.totalCount));
      line(pool, label + '覆盖', data?.partial === true ? '部分数据' : data?.complete === true ? '完整' : data?.complete === false ? '不完整' : '未知');
      line(pool, label + '原始观测时间', time(data?.sourceTimestamp));
    }
    const complete = pools.complete === true;
    line(pool, '封板占比', complete && finite(pools.sealRate) ? percent(pools.sealRate) : '未知（需完整池数据）');
    line(pool, '炸板未封占比', complete && finite(pools.breakRate) ? percent(pools.breakRate) : '未知（需完整池数据）');
    line(pool, '封板 / 炸板未封数量比', complete && finite(pools.limitUpToBrokenRatio) ? number(pools.limitUpToBrokenRatio) : '未知（需完整池数据）');
    line(pool, '两池成员重叠', pools.overlapDetected === true ? '已检测到重叠，需核对' : pools.overlapDetected === false ? '未检测到' : '未知');
    pool.append(node('p', '池占比与数量比只描述本次数据，不是交易成功率或收益。', 'muted'));
  } else line(pool, '涨停池', '未知');
  const errors = Array.isArray(r.errors) ? r.errors : r.errors && typeof r.errors === 'object' ? Object.entries(r.errors).map(([key, v]) => ({ key, error: v })) : [];
  if (errors.length) line(pool, '缺失与来源异常', errors.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('；'));
  parent.append(pool); raw('linkedPublicOutput', r);
}
function probability(parent, label, data) {
  const d = data || {}, part = node('div', undefined, 'linked-summary');
  part.append(node('h4', label + '：' + percent(d.probability)));
  line(part, '匹配历史样本量', finite(d.samples) ? d.samples : '未知');
  const ci = d.confidenceInterval;
  line(part, '95% 概率区间', Array.isArray(ci) && ci.length === 2 && ci.every(finite) ? percent(ci[0]) + ' ～ ' + percent(ci[1]) : '数据不足');
  line(part, '样本外 Brier', finite(d.outOfSample?.brier) ? number(d.outOfSample.brier) : '尚无可用验证');
  line(part, '样本外验证数', finite(d.outOfSample?.evaluated) ? d.outOfSample.evaluated : '未知');
  line(part, '估计状态', value(d.status));
  parent.append(part);
}
function renderLinkage(parent, linkage) {
  const d = linkage || {}, status = x => ({ unknown: '证据未知', 'observed-unverified': '已观测，未独立核验',
    'stale-or-invalid': '证据过时或无效' })[x] || value(x);
  line(parent, '市场联动证据', status(d.marketStatus));
  line(parent, '板块联动证据', status(d.sectorStatus));
  line(parent, '风险冲突', d.riskConflict === true ? '存在形态与上下文风险冲突' : d.riskConflict === false ? '未检测到已定义冲突' : '未知');
  line(parent, '支持依据', limit(d.support).length ? limit(d.support).map(value).join('；') : '暂无已知支持依据');
  line(parent, '风险依据', limit(d.risks).length ? limit(d.risks).map(value).join('；') : '暂无已知风险依据，不代表无风险');
}
function renderCurrentFormation(parent, current) {
  if (!current) return;
  const part = node('div', undefined, 'linked-summary');
  part.append(node('h4', '当前形态 · 仅价格证据（price-only，未核验）'));
  line(part, '证据状态', value(current.status));
  line(part, '形态日期 / 首次可用时间', value(current.date) + ' / ' + time(current.availableAt));
  const checks = limit(current.patterns?.checks);
  for (const c of checks) line(part, value(c.label || c.id), value(c.status) + ' · ' + value(c.detail));
  if (!checks.length) line(part, '形态证据', value(current.patterns?.reason));
  parent.append(part);
}
function renderPatternStudy(parent, study) {
  const patterns = Array.isArray(study?.patterns) ? study.patterns.filter(p => p.currentlyMatched === true).slice(0, 8) : [];
  if (!patterns.length) return;
  const details = node('details'); details.append(node('summary', '历史形态与后续表现'));
  details.append(node('p', '仅显示当前匹配的前8个形态。历史条件频率为回顾性描述，非前瞻验证；同股样本可能相关，频率不等于可成交收益。', 'muted'));
  for (const p of patterns) {
    details.append(node('h4', value(p.label || p.id)));
    line(details, '形态方向', ({ bullish: '看涨', bearish: '看跌', neutral: '中性' })[p.side] || value(p.side));
    for (const [key, label] of [['direction', '后续上涨历史频率'], ['limitUp', '后续涨停历史频率']]) {
      const d = p[key] || {}, ci = d.confidenceInterval;
      line(details, label, percent(d.probability));
      line(details, '匹配历史样本量', finite(d.samples) ? d.samples : '未知');
      line(details, '95% 概率区间', Array.isArray(ci) && ci.length === 2 && ci.every(finite) ? percent(ci[0]) + ' ～ ' + percent(ci[1]) : '数据不足');
    }
  }
  parent.append(details);
}
function renderSectors(relations) {
  const parent = el('linkedSectorSummary'); parent.replaceChildren(node('h3', '板块关系与轮动证据'));
  if (!relations) { parent.append(node('p', '板块证据不足，关系未知。')); return; }
  const nodes = new Map(limit(relations.nodes).map(n => [n.id, n]));
  const label = id => { const n = nodes.get(id); return n ? [n.name, n.code].filter(Boolean).join(' ') : value(id); };
  line(parent, '来源', value(relations.sources?.join('、')));
  line(parent, '有效日 / 日历日', value(relations.coverage?.acceptedDays) + ' / ' + value(relations.coverage?.expectedDays));
  const edges = limit(relations.edges);
  if (!edges.length) line(parent, '关系状态', '未知 · ' + value(relations.reason));
  for (const edge of edges) {
    const card = node('article', undefined, 'card'); card.append(node('h4', label(edge.from) + ' ↔ ' + label(edge.to)));
    for (const [key, name] of [['sameDayCorrelation', '同日相关'], ['marketResidualCorrelation', '去市场相关']]) {
      const d = edge[key] || {};
      line(card, name, number(d.coefficient) + ' · 匹配 ' + value(d.knownMatchedCount) + ' 日' + (d.reason ? ' · ' + d.reason : ''));
    }
    line(card, '成员重叠（Jaccard）', finite(edge.membershipOverlap?.jaccard) ? percent(edge.membershipOverlap.jaccard) : '未知');
    line(card, '原始观测时间', time(edge.observedAt)); parent.append(card);
  }
  for (const n of nodes.values()) {
    const p = node('p');
    p.textContent = label(n.id) + ' · 资金净流入 ' + money(n.mainNetInflow) + ' · 3日 ' + value(n.flowContinuity?.threeSession?.direction) +
      ' · 5日 ' + value(n.flowContinuity?.fiveSession?.direction) + ' · ' + time(n.observedAt); parent.append(p);
  }
  if (relations.rotation?.length) line(parent, '反向流向观察', relations.rotation.length + ' 项；不证明板块之间发生资金转移');
}
function renderAnalysis(r) {
  const market = el('linkedMarketSummary'); market.replaceChildren(node('h3', '市场与资金上下文'));
  const context = r.marketContext || {};
  line(market, '研究时点', time(r.asOf)); line(market, '市场状态', value(context.status ?? context.regime ?? context.label));
  line(market, '来源', value(context.source)); line(market, '原始观测时间', time(context.sourceTimestamp ?? context.observedAt));
  line(market, '本次获取时间', time(context.retrievedAt));
  line(market, '情绪证据', value(context.sentiment?.status) + ' · ' + value(context.sentiment?.reason));
  if (context.funds) {
    const funds = node('div', undefined, 'cards');
    renderFlow(funds, '全市场资金', context.funds.market);
    renderFlow(funds, '板块资金', context.funds.sector);
    renderFlow(funds, '个股资金', context.funds.stock); market.append(funds);
  }
  const parent = el('linkedStockSummary'); parent.replaceChildren();
  for (const stock of limit(r.stocks)) {
    const card = node('article', undefined, 'card'); card.append(node('h3', [stock.name, stock.symbol].filter(Boolean).join(' ')));
    probability(card, '下一明确交易日上涨概率', stock.forecast?.direction);
    probability(card, '下一明确交易日涨停概率', stock.forecast?.limitUp);
    line(card, '历史来源 / 价格口径', value(stock.forecast?.source) + ' / ' + value(stock.forecast?.priceBasis));
    line(card, '已知收盘K线 / 提供数', value(stock.forecast?.coverage?.closedKnown) + ' / ' + value(stock.forecast?.coverage?.provided));
    line(card, '预测目标交易日', value(stock.forecast?.targetDate));
    renderLinkage(card, stock.linkage);
    renderCurrentFormation(card, stock.currentFormation || stock.analysis?.currentFormation || stock.patternStudy?.currentFormation);
    renderPatternStudy(card, stock.patternStudy);
    const conditions = limit(stock.conditions);
    card.append(node('h4', '逐项条件与缺失证据'));
    const ul = node('ul');
    for (const c of conditions) ul.append(node('li', value(c.label || c.id) + ' · ' + value(c.status) + ' · ' + value(c.detail)));
    if (!conditions.length) ul.append(node('li', '条件证据未知'));
    card.append(ul);
    const checks = limit((stock.currentFormation || stock.analysis?.currentFormation || stock.patternStudy?.currentFormation)?.patterns?.checks || stock.forecast?.patterns?.checks);
    if (checks.length) {
      const details = node('details'); details.append(node('summary', '形态条件明细'));
      const items = node('ul'); for (const c of checks) items.append(node('li', value(c.label) + ' · ' + value(c.status) + ' · ' + value(c.detail)));
      details.append(items); card.append(details);
    }
    line(card, '个股记忆', value(stock.memory?.status) + ' · 版本 ' + value(stock.memory?.revision));
    parent.append(card);
  }
  if (!limit(r.stocks).length) parent.append(node('p', '尚无可分析的个股数据。'));
  renderSectors(r.sectorRelations);
  for (const item of limit(r.limitations)) market.append(node('p', value(item), 'muted'));
  raw('linkedIntelligenceOutput', r);
}
function renderMemory(r) {
  const parent = el('linkedMemorySummary'); parent.replaceChildren();
  line(parent, '股票 / 历史版本数', value(r.symbol) + ' / ' + value(r.totalRevisions));
  for (const [kind, label] of [['direction', '方向'], ['limitUp', '涨停']]) {
    const v2 = r.newProtocolForwardValidation?.[kind], legacy = r.legacyForwardValidation?.[kind];
    const v = v2 || r.forwardValidation?.[kind];
    line(parent, label + (v2 ? 'v2冻结预测后续验证' : '冻结预测后续验证（兼容摘要，协议未分层）'), '样本 ' + value(v?.evaluated) + ' · Brier ' + (finite(v?.brier) ? number(v.brier) : '尚无可用验证'));
    line(parent, label + '验证协议分层', '旧协议 ' + value(legacy?.evaluated ?? v?.legacyEvaluated ?? r.forwardValidation?.legacyEvaluated) + ' · v2新协议 ' + value(v2?.evaluated ?? v?.newProtocolEvaluated ?? r.forwardValidation?.newProtocolEvaluated) + '；总样本不代表v2已验证');
  }
  for (const revision of limit(r.revisions)) {
    const details = node('details');
    details.append(node('summary', '版本 ' + value(revision.revision) + ' · 决策 ' + time(revision.decisionAt) + ' · 记录 ' + time(revision.recordedAt)));
    details.append(node('pre', JSON.stringify(revision, null, 2))); parent.append(details);
  }
  raw('linkedMemoryOutput', r);
}

el('linkedPublicRun').addEventListener('click', () => action('linkedPublicRun', 'linkedPublicStatus', () => {
  publicContext = null; el('linkedPublicSummary').replaceChildren(); el('linkedPublicOutput').textContent = '';
}, async (status, context) => {
  const symbol = el('linkedPublicSymbol').value.trim(), sectorCode = el('linkedSectorCode').value.trim(), date = el('linkedPublicDate').value;
  if (symbol && !/^\d{6}$/.test(symbol)) throw Error('股票代码需要六位数字');
  if (sectorCode && !/^BK\d{4}$/.test(sectorCode)) throw Error('板块代码需要 BK 加四位数字');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw Error('交易日期无效');
  const payload = { ...(symbol ? { symbol } : {}), ...(sectorCode ? { sectorCode } : {}), ...(date ? { date } : {}) };
  const r = await request('/api/research/public-context', { method: 'POST', body: JSON.stringify(payload) }, context);
  assertCurrent(context);
  // A study may have begun after this public read started, before its result
  // arrived. It cannot remain beside newer context that it never consumed.
  invalidate('analysis', '公共上下文已更新，请重新分析所选文件');
  publicContext = r; renderPublic(r); status.textContent = '已读取公共上下文；请核对来源、原始时点与缺失项。';
}));
el('linkedIntelligenceRun').addEventListener('click', () => action('linkedIntelligenceRun', 'linkedIntelligenceStatus', () => {
  for (const id of ['linkedMarketSummary', 'linkedStockSummary', 'linkedSectorSummary']) el(id).replaceChildren();
  el('linkedIntelligenceOutput').textContent = '';
}, async (status, context) => {
  const file = el('linkedIntelligenceFile').files?.[0];
  if (!file) throw Error('请选择带来源与原始时点的历史 JSON');
  if (file.size > 2 * 1024 * 1024) throw Error('文件不能超过2MiB');
  const payload = JSON.parse(await file.text());
  assertCurrent(context);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schemaVersion !== 1 || !Number.isSafeInteger(payload.asOf) ||
      !Array.isArray(payload.tradeDates) || !Array.isArray(payload.stocks)) throw Error('需要 schemaVersion:1、数字 asOf、tradeDates 和 stocks 数组');
  payload.persist = el('linkedPersist').checked;
  if (!Object.prototype.hasOwnProperty.call(payload, 'publicContext') && publicContext) payload.publicContext = publicContext;
  const r = await request('/api/research/linked-intelligence', { method: 'POST', body: JSON.stringify(payload) }, context);
  assertCurrent(context);
  renderAnalysis(r); status.textContent = '联动研究已完成；概率与形态不代表可成交收益。';
}));
el('linkedMemoryRead').addEventListener('click', () => action('linkedMemoryRead', 'linkedMemoryStatus', () => {
  el('linkedMemorySummary').replaceChildren(); el('linkedMemoryOutput').textContent = '';
}, async (status, context) => {
  const symbol = el('linkedMemorySymbol').value.trim();
  if (!/^\d{6}$/.test(symbol)) throw Error('股票代码需要六位数字');
  const r = await request('/api/research/stock-memory?symbol=' + encodeURIComponent(symbol), {}, context);
  assertCurrent(context);
  if (r.symbol !== symbol) throw Error('个股记忆的股票代码不匹配，请重新读取');
  renderMemory(r); status.textContent = r.totalRevisions ? '已读取个股历史版本与冻结预测后续验证。' : '该股票尚无已保存的研究版本。';
}));
for (const [name, lane] of Object.entries(lanes)) for (const id of lane.inputs) for (const event of ['input', 'change']) {
  el(id).addEventListener(event, () => { if (name === 'public') invalidatePublic(); else invalidate(name); });
}
for (const event of ['input', 'change']) el('token')?.addEventListener(event, () => invalidateAll('身份已变化，请重新读取研究证据'));
document.addEventListener?.('visibilitychange', () => { if (document.hidden) invalidateAll('页面已隐藏，研究证据已清空'); });
globalThis.addEventListener?.('offline', () => invalidateAll('网络离线，研究证据已清空'));
globalThis.addEventListener?.('pagehide', () => invalidateAll('页面已离开，研究证据已清空'));
el('linkedTemplate').addEventListener('click', () => {
  const template = { schemaVersion: 1, asOf: null, tradeDates: [], stocks: [], persist: false };
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
  const a = node('a'); a.href = url; a.download = 'linked-intelligence-empty.json'; a.click(); URL.revokeObjectURL(url);
  el('linkedIntelligenceStatus').textContent = '空白模板已下载；请填入真实数据、数字研究时点和明确交易日历。';
});
})();
