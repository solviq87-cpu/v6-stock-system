(function () {
'use strict';
const el = id => document.getElementById(id);
if (!el('stockCapture')) return;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const val = x => x === null || x === undefined || x === '' ? '未知' : String(x);
const list = x => Array.isArray(x) ? x : [];
const time = x => finite(x) && Number.isFinite(new Date(x).getTime()) ? new Date(x).toISOString() : val(x);
const issues = x => Array.isArray(x) ? x : x && typeof x === 'object' ? Object.entries(x).map(([key, error]) => ({ key, error })) : x ? [x] : [];
const pct = x => finite(x) ? (x * 100).toFixed(1) + '%' : '等待状态 / 行动证据';
function node(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function line(p, label, x) { p.append(node('p', label + '：' + val(x))); }
let sequence = 0, active = null, resolved = null;
function clear() { for (const id of ['captureSummary', 'captureChart', 'captureAnalysis', 'captureEvidence', 'captureDecision', 'captureOutput']) el(id).replaceChildren(); }
function invalidate() {
  sequence++; active?.abort(); active = null; resolved = null; clear();
  el('captureStatus').textContent = '输入已更改，请重新采集或读取。';
  el('captureRun').disabled = el('captureRead').disabled = false;
}
for (const id of ['captureSymbol', 'captureProvider', 'token']) {
  el(id)?.addEventListener('input', invalidate);
  el(id)?.addEventListener('change', invalidate);
}
function chart(input) {
  const p = el('captureChart');
  const bars = list(input).filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
    [b.open, b.high, b.low, b.close, b.volume].every(finite) && b.low > 0 && b.volume >= 0 &&
    b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)).slice(-120);
  if (!bars.length) { p.append(node('p', '暂无有效日K，不生成示例行情。')); return; }
  p.append(node('h3', '日K · 最近 ' + bars.length + ' 根'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 720 270'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', bars[0].date + ' 至 ' + bars.at(-1).date + ' 真实日K；下方滑块查看逐日价格');
  const low = Math.min(...bars.map(b => b.low)), high = Math.max(...bars.map(b => b.high));
  const y = price => 220 - (price - low) / (high - low || 1) * 190;
  function shape(tag, attrs, title) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    if (title) { const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = title; n.append(t); }
    svg.append(n); return n;
  }
  const label = (x, yy, text) => { shape('text', { x, y: yy, fill: '#b6cbe5', 'font-size': 13 }).textContent = text; };
  label(0, 17, '最高 ' + high); label(0, 245, '最低 ' + low);
  const step = 620 / bars.length;
  bars.forEach((b, i) => {
    const x = 70 + (i + .5) * step, color = b.close >= b.open ? '#f26c79' : '#48cc9b';
    const text = b.date + ' 开 ' + b.open + ' 高 ' + b.high + ' 低 ' + b.low + ' 收 ' + b.close + ' 量 ' + b.volume;
    shape('line', { x1: x, x2: x, y1: y(b.high), y2: y(b.low), stroke: color }, text);
    shape('rect', { x: x - Math.max(1, step * .65) / 2, y: Math.min(y(b.open), y(b.close)), width: Math.max(1, step * .65), height: Math.max(1, Math.abs(y(b.open) - y(b.close))), fill: color }, text);
  });
  label(70, 267, bars[0].date); label(590, 267, bars.at(-1).date); p.append(svg);
  const detail = node('p'), control = node('input'); control.type = 'range'; control.min = '0'; control.max = String(bars.length - 1); control.value = control.max;
  control.setAttribute('aria-label', '选择日K日期查看开高低收与成交量');
  function describe() { const b = bars[Number(control.value)]; detail.textContent = b.date + ' · 开 ' + b.open + ' · 高 ' + b.high + ' · 低 ' + b.low + ' · 收 ' + b.close + ' · 成交量 ' + b.volume; }
  control.addEventListener('input', describe); describe(); p.append(control, detail);
}
function render(r) {
  const p = el('captureSummary'), h = r.history || {}, s = r.stock || {}, o = r.observation || {};
  p.append(node('h3', [s.name, s.symbol].filter(Boolean).join(' ') || '个股历史'));
  line(p, '来源 / 价格口径', val(h.source ?? s.source) + ' / ' + val(h.provider ?? s.provider) + ' / ' + val(h.priceBasis ?? s.priceBasis));
  line(p, '数据截止交易日', h.tradeDate); line(p, '本轮获取时间', time(h.retrievedAt));
  line(p, '来源原始时间', time(h.sourceTimestamp)); line(p, '该内容版本观测时间', time(s.observedAt));
  const lastBar = list(s.bars).at(-1);
  line(p, '最新K线内容首次已知时间', time(lastBar?.firstObservedAt ?? lastBar?.knownAt));
  line(p, '本轮状态', h.status);
  line(p, '归档内容', o.changed === true ? '新增或变化 · 版本 ' + val(o.revision) : o.changed === false ? '内容未变化 · 版本 ' + val(o.revision) : '归档状态未知');
  line(p, '单位', h.units ? JSON.stringify(h.units) : null);
  line(p, '研究记忆', val(r.memory?.status) + ' · 版本 ' + val(r.memory?.revision));
  chart(s.bars);
  const a = el('captureAnalysis'), study = r.patternStudy || r.analysis?.patternStudy;
  const current = r.currentFormation || r.analysis?.currentFormation || study?.currentFormation;
  a.append(node('h3', '当前形态与研究证据'));
  if (current) {
    line(a, '当前形态', val(current.status) + ' · 仅价格证据，未核验（price-only）');
    line(a, '形态日期 / 首次可用时间', val(current.date) + ' / ' + time(current.availableAt));
    line(a, '历史样本资格', current.historicalEligible === true ? '可进入历史研究，仍需验证' : current.historicalEligible === false ? '尚不具备' : '未知');
    const matches = list(current.patterns?.matched);
    line(a, '命中形态', matches.length ? matches.map(x => val(x.label || x.id)).join('；') : '暂无匹配或证据不足');
    for (const c of list(current.patterns?.checks).slice(0, 30)) line(a, val(c.label || c.id), val(c.status) + ' · ' + val(c.detail));
  } else line(a, '当前形态', '等待有效价格证据');
  const forecast = r.analysis?.forecast || r.analysis || {};
  line(a, '下一交易日上涨概率', pct(forecast.direction?.probability));
  line(a, '下一交易日涨停概率', pct(forecast.limitUp?.probability));
  for (const pat of list(study?.patterns).filter(x => x.currentlyMatched).slice(0, 8)) {
    line(a, val(pat.label || pat.id) + ' · 历史上涨频率', pct(pat.direction?.probability) + ' · 样本 ' + val(pat.direction?.samples));
  }
  line(a, '下一交易日 / 日历状态', val(r.calendar?.nextTradeDate) + ' / ' + val(r.calendar?.status));
  line(a, '市场 / 板块证据', val(r.marketContext?.status) + ' / ' + val(r.sectorRelations?.status));
  const blockers = list(r.readiness?.blockers).concat(issues(h.errors), issues(h.sourceErrors), issues(r.sourceErrors), list(r.limitations));
  if (blockers.length) line(a, '缺失与限制', blockers.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('；'));
  a.append(node('p', '当前形态独立于历史概率；历史频率不等于前瞻验证或可成交收益。本页仅供研究。'));
  renderEvidence(r);
  if (globalThis.V6DecisionReview && el('captureDecision')) globalThis.V6DecisionReview.render(el('captureDecision'), r.decisionReview);
  el('captureOutput').textContent = JSON.stringify(r, null, 2);
}
function renderEvidence(r) {
  const host = el('captureEvidence');
  const event = r.priceEventResearch || {}, h = event.currentHypothesis || {}, v = event.forwardValidation || {};
  line(host, '原始日K研究状态 / 目标日', val(event.status) + ' / ' + val(h.targetDate));
  const p = node('details'); p.append(node('summary', '冻结研究事件与证据快照')); host.append(p);
  line(p, '研究目标', event.objective);
  p.append(node('p', '原始日K方向研究：收盘C相对开盘O（C>O、C<O、C=O），与前收盘收益、涨停及可成交结果分开。'));
  line(p, '假设方向 / 状态', val(h.prediction) + ' / ' + val(h.state));
  line(p, '目标交易日 / 复访到期', val(h.targetDate) + ' / ' + time(h.dueAt));
  line(p, '决策时间 / 冻结记录时间', time(h.decisionAt) + ' / ' + time(h.recordedAt));
  line(p, '日K三态条件概率', h.probabilities ? ['up', 'down', 'flat'].map(k => k + ' ' + pct(h.probabilities[k])).join(' · ') : '等待冻结后独立目标日证据');
  line(p, '已评价 / 独立目标日', val(v.evaluated) + ' / ' + val(v.independentTargetDays));
  line(p, '原始日K方向匹配频率', pct(v.rawCandleMatchFrequency));
  line(p, 'Brier / 可评分样本', (finite(v.brier) ? v.brier.toFixed(3) : '等待概率与结果证据') + ' / ' + val(v.brierEvaluated));
  line(p, '待复访目标', Array.isArray(event.pendingTargets) ? event.pendingTargets.length : '未知');
  line(p, '研究版本', event.version ? JSON.stringify(event.version) : null);
  const b = r.evidenceBundle || {}, frozen = r.hypothesisEvidence || {}, status = b.stockStatus || r.stockStatus || {};
  if (b.hash && h.evidenceBundleHash && b.hash !== h.evidenceBundleHash) host.append(node('p', '本次观察与预测封存证据不同；更新后的上下文不作为旧判断依据。'));
  const details = node('details'); details.append(node('summary', '本次观察 · 上下文与股票状态事实'));
  line(details, '本次观察哈希', b.hash);
  line(details, '本次观察决策 / 记录时间', time(b.decisionAt) + ' / ' + time(b.recordedAt));
  line(details, '市场 / 板块状态', val(b.marketContext?.status) + ' / ' + val(b.sectorContext?.status));
  const indices = b.marketContext?.indices || r.marketContext?.indices;
  if (indices) {
    line(details, '指数来源 / 截止日 / 获取时间', val(indices.source) + ' / ' + val(indices.tradeDate) + ' / ' + time(indices.retrievedAt));
    line(details, '指数原始时间', time(indices.sourceTimestamp));
    for (const row of list(indices.records).slice(-5)) line(details, val(row.tradeDate) + ' · 上证 / 深证', val(row.shanghaiClose) + ' / ' + val(row.shenzhenClose) + ' · 涨跌幅 ' + val(row.shanghaiChangePct) + ' / ' + val(row.shenzhenChangePct));
  }
  line(details, '股票状态事实', Object.keys(status).length ? JSON.stringify(status) : '未知');
  line(details, '来源引用', b.sourceRefs ? JSON.stringify(b.sourceRefs) : '未知');
  details.append(node('p', '涨跌停价、分红及停牌记录仅是来源事实；无记录不表示正常交易或公司行为完整覆盖。'));
  const linkage = r.linkage || {};
  line(details, '个股日期 / 市场日期', val(linkage.tradeDate) + ' / ' + val(linkage.marketTradeDate));
  line(details, '市场同日匹配', linkage.sameMarketTradeDate === true ? '同一交易日；描述性共现，未核验因果' : linkage.sameMarketTradeDate === false ? '日期不同或缺失，禁止混作同日证据' : '未知');
  const index = linkage.sameMarketTradeDate === true ? linkage.indices : null;
  line(details, '同日上证 / 深证', val(index?.shanghaiClose) + ' / ' + val(index?.shenzhenClose) + ' · 涨跌幅 ' + val(index?.shanghaiChangePct) + ' / ' + val(index?.shenzhenChangePct));
  line(details, '个股同日主力净流入（元）', linkage.stockMainNetInflow);
  line(details, '同日情绪', linkage.sameMarketTradeDate === true && linkage.sentiment ? JSON.stringify(linkage.sentiment) : '未知');
  if (!list(linkage.memberBoards).length) line(details, '当前所属板块', '未知；未列出不代表无归属');
  for (const board of list(linkage.memberBoards).slice(0, 6)) {
    line(details, '当前成员归属', [board.name, board.code, board.category].map(val).join(' · '));
    line(details, '板块报价日 / 原始时间 / 成员观测', val(board.quoteDate) + ' / ' + time(board.quoteAt) + ' / ' + time(board.membersObservedAt));
    line(details, '板块同日涨跌幅 / 主力净流入', board.sameQuoteDate === true ? val(board.changePct) + ' / ' + val(board.mainNetInflow) : '日期不同或缺失，数值未知');
    line(details, '归属范围', '仅本次观测（' + val(board.membershipScope) + '），不回填历史');
  }
  line(details, '联动限制', linkage.limitation);
  p.append(details);
  const sealed = node('details'); sealed.append(node('summary', '预测封存 · 原判断使用的证据'));
  line(sealed, '预测引用哈希', h.evidenceBundleHash);
  line(sealed, '预测封存原文哈希', frozen.hash);
  line(sealed, '预测封存决策 / 记录时间', time(frozen.decisionAt) + ' / ' + time(frozen.recordedAt));
  const verifiedFrozen = !!h.evidenceBundleHash && frozen.hash === h.evidenceBundleHash;
  line(sealed, '封存核对', verifiedFrozen ? '哈希与当前冻结假设一致' : '封存原文缺失或引用不匹配；保持未知');
  if (verifiedFrozen) {
    line(sealed, '封存市场 / 板块状态', val(frozen.marketContext?.status) + ' / ' + val(frozen.sectorContext?.status));
    line(sealed, '封存来源引用', frozen.sourceRefs ? JSON.stringify(frozen.sourceRefs) : '未知');
    sealed.append(node('pre', JSON.stringify(frozen, null, 2)));
  }
  p.append(sealed);
}
async function run(readOnly) {
  const symbol = el('captureSymbol').value.trim(), selected = el('captureProvider').value || 'auto', token = el('token')?.value || '';
  const status = el('captureStatus');
  if (!/^\d{6}$/.test(symbol)) { status.textContent = '股票代码需要六位数字'; return; }
  if (!['auto', 'eastmoney', 'tencent'].includes(selected)) { status.textContent = '请选择有效来源'; return; }
  const provider = readOnly && selected === 'auto' ? resolved?.symbol === symbol ? resolved.provider : null : selected;
  if (!provider) { status.textContent = '读取已存历史需明确选择来源，或先完成一次自动采集。'; return; }
  active?.abort(); const controller = new AbortController(); active = controller; const id = ++sequence;
  const unchanged = () => id === sequence && symbol === el('captureSymbol').value.trim() && selected === (el('captureProvider').value || 'auto') && token === (el('token')?.value || '');
  clear(); el('captureRun').disabled = el('captureRead').disabled = true;
  status.textContent = readOnly ? '正在读取云端已存历史…' : '正在采集日K并研究…';
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(readOnly ? '/api/research/stock-observations?symbol=' + encodeURIComponent(symbol) + '&provider=' + encodeURIComponent(provider) : '/api/research/observe-stock', {
      method: readOnly ? 'GET' : 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      ...(readOnly ? {} : { body: JSON.stringify({ symbol, provider, historyDays: 120, includeContext: true }) }) });
    const body = await response.json(); if (!unchanged()) return;
    if (!response.ok || !body.ok || !body.result || typeof body.result !== 'object') throw Error(body.error || '研究请求未完成');
    const r = body.result, actual = r.history?.provider || r.stock?.provider;
    if (r.stock && (r.stock.symbol !== symbol || provider !== 'auto' && actual !== provider)) throw Error('返回股票或来源与请求不一致');
    if (!readOnly && ['eastmoney', 'tencent'].includes(actual)) resolved = { symbol, provider: actual };
    render(r); status.textContent = (readOnly ? '已读取云端已存历史' : '本轮采集完成') + ' · ' + val(r.status) + '；请核对截止日与缺失证据。';
  } catch (e) {
    if (unchanged()) { clear(); status.textContent = e.name === 'AbortError' ? '请求超时，请稍后重试' : e.message || '请求失败'; }
  } finally {
    clearTimeout(timer);
    if (id === sequence) { active = null; el('captureRun').disabled = el('captureRead').disabled = false; if (!unchanged()) { clear(); status.textContent = '输入或令牌已更改，请重新读取。'; } }
  }
}
globalThis.addEventListener?.('offline', invalidate);
globalThis.addEventListener?.('pagehide', invalidate);
el('captureRun').addEventListener('click', () => run(false));
el('captureRead').addEventListener('click', () => run(true));
})();
