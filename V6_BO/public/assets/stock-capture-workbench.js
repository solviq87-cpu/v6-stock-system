(function () {
'use strict';
const el = id => document.getElementById(id);
if (!el('stockCapture')) return;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const val = x => x === null || x === undefined || x === '' ? '未知' : String(x);
const list = x => Array.isArray(x) ? x : [];
const issues = x => Array.isArray(x) ? x : x && typeof x === 'object' ? Object.entries(x).map(([key, error]) => ({ key, error })) : x ? [x] : [];
const pct = x => finite(x) ? (x * 100).toFixed(1) + '%' : '等待状态 / 行动证据';
function node(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function line(p, label, x) { p.append(node('p', label + '：' + val(x))); }
let sequence = 0, active = null, resolved = null;
function clear() { for (const id of ['captureSummary', 'captureChart', 'captureAnalysis', 'captureOutput']) el(id).replaceChildren(); }
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
  line(p, '数据截止交易日', h.tradeDate); line(p, '本轮获取时间', h.retrievedAt);
  line(p, '来源原始时间', h.sourceTimestamp); line(p, '该内容版本观测时间', s.observedAt);
  const lastBar = list(s.bars).at(-1);
  line(p, '最新K线内容首次已知时间', lastBar?.firstObservedAt ?? lastBar?.knownAt);
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
    line(a, '形态日期 / 首次可用时间', val(current.date) + ' / ' + val(current.availableAt));
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
  el('captureOutput').textContent = JSON.stringify(r, null, 2);
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
    if (!readOnly && ['eastmoney', 'tencent'].includes(actual)) resolved = { symbol, provider: actual };
    render(r); status.textContent = (readOnly ? '已读取云端已存历史' : '本轮采集完成') + ' · ' + val(r.status) + '；请核对截止日与缺失证据。';
  } catch (e) {
    if (unchanged()) { clear(); status.textContent = e.name === 'AbortError' ? '请求超时，请稍后重试' : e.message || '请求失败'; }
  } finally {
    clearTimeout(timer);
    if (id === sequence) { active = null; el('captureRun').disabled = el('captureRead').disabled = false; if (!unchanged()) { clear(); status.textContent = '输入或令牌已更改，请重新读取。'; } }
  }
}
el('captureRun').addEventListener('click', () => run(false));
el('captureRead').addEventListener('click', () => run(true));
})();
