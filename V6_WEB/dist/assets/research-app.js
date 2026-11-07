/* Browser-only research workspace. Imported data never leaves this page. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const WATCH_KEY = 'v6.research.watchlist.v1';
  const BACKUP_KEY = WATCH_KEY + '.backup';
  const views = {
    overview: ['研究总览', '筛选机会，核对证据，持续观察。'],
    filters: ['选股筛选', '用明确的条件，缩小研究范围。'],
    linkage: ['联动分析', '保留完整战法，核对同源重叠与独立风险。'],
    factors: ['因子诊断', '在历史截面中，检查因子与后续价格的关系。'],
    models: ['模型对比', '比较可复核的实验结果，再决定研究方向。'],
    watchlist: ['观察列表', '把值得继续核对的股票，留在手边。']
  };
  const featureLabels = { return5: '5日收益', return20: '20日收益', momentum60Skip5: '中期动量', volatility20: '20日波动', volumeRatio20: '20日量比', body: 'K线实体', range: '日内振幅', closeLocation: '收盘位置' };
  const reasonLabels = { TURNOVER20_UNKNOWN: '成交额历史不足', TURNOVER20_LOW: '成交额不足', VOLATILITY20_HIGH: '波动率超出上限', VOLUME_RATIO20_LOW: '量比低于下限', VOLUME_RATIO20_HIGH: '量比高于上限' };
  const icons = {
    grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    filter: ['M3 5h18M6 12h12M10 19h4', 'M8 3v4M16 10v4M12 17v4'],
    link: ['M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2', 'M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2'],
    chart: ['M4 3v17h17', 'M8 14l4-5 4 3 5-7'],
    layers: ['M12 3L2 8l10 5 10-5-10-5z', 'M3 12l9 5 9-5M3 16l9 5 9-5'],
    star: ['M12 3l2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9z'],
    shield: ['M12 3l8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3z', 'M8 12l3 3 5-6'],
    download: ['M12 3v12m-5-5 5 5 5-5', 'M4 16v5h16v-5'],
    upload: ['M12 16V4m-5 5 5-5 5 5', 'M4 16v5h16v-5'],
    search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    document: ['M5 3h10l4 4v14H5z', 'M14 3v5h5M8 12h8M8 16h6'],
    warning: ['M12 3 2 21h20L12 3z', 'M12 9v5M12 17v1']
  };
  const state = { input: null, result: null, factors: null, filters: {}, selected: '', page: 'overview', query: '', resultTab: 'all', chartDays: 40, watch: [], modelReport: null, factorName: 'return5', filename: '', isDemo: true };
  function node(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') n.className = value;
      else if (key.startsWith('on') && typeof value === 'function') n.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) n.setAttribute(key, String(value));
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  function svgNode(tag, attrs, text) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function icon(name) {
    const svg = svgNode('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.55, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const d of icons[name] || icons.grid) svg.append(svgNode('path', { d }));
    return svg;
  }
  function fillIcons() { document.querySelectorAll('[data-icon]').forEach(n => n.replaceChildren(icon(n.dataset.icon))); }
  function clear(id, ...children) { $(id).replaceChildren(...children); }
  function pill(text, style) { return node('span', { class: 'pill ' + (style || 'neutral') }, text); }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function num(v, digits) { return finite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 }) : '—'; }
  function percent(v, fraction) { return finite(v) ? num(v * (fraction ? 100 : 1), 2) + '%' : '—'; }
  function signClass(v) { return !finite(v) || v === 0 ? '' : v > 0 ? 'positive' : 'negative'; }
  function signed(v, fraction) { return finite(v) ? (v > 0 ? '+' : '') + percent(v, fraction) : '—'; }
  function amount(v) { return finite(v) ? num(v / 1e8, 2) + '亿' : '—'; }
  function text(v, fallback) { return typeof v === 'string' ? v.slice(0, 200) : fallback || '—'; }
  function dateOf(ms) { return finite(ms) ? new Date(ms + 8 * 3600000).toISOString().slice(0, 10) : '日期未知'; }
  function showError(message) { $('errorBanner').textContent = message; $('errorBanner').hidden = false; }
  function resetError() { $('errorBanner').hidden = true; $('errorBanner').textContent = ''; }
  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4300); }
  function empty(title, detail, action) {
    const n = node('div', { class: 'empty-state' }, icon('document'), node('strong', {}, title), node('p', {}, detail || ''));
    if (action) n.append(action);
    return n;
  }
  function download(filename, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = node('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function rawStock(symbol) { return state.input?.stocks?.find(s => String(s.symbol || s.code) === symbol); }
  function lastBar(symbol) { return rawStock(symbol)?.bars?.at(-1) || {}; }
  function selectedItem() { return state.result?.items.find(s => s.symbol === state.selected) || state.result?.items[0]; }
  function dailyChange(symbol) { const bars = rawStock(symbol)?.bars || []; return bars.length > 1 && bars.at(-2).close > 0 ? bars.at(-1).close / bars.at(-2).close - 1 : null; }
  function isWatched(symbol) { return state.watch.some(s => s.symbol === symbol); }
  function watchButton(item) {
    const active = isWatched(item.symbol);
    return node('button', { class: 'watch-button' + (active ? ' watched' : ''), 'aria-label': (active ? '移出观察：' : '加入观察：') + item.name, 'aria-pressed': active, onclick: (e) => { e.stopPropagation(); toggleWatch(item); } }, active ? '★' : '☆');
  }
  function stockButton(item, navigate) {
    return node('button', { class: 'stock-button', onclick: () => selectStock(item.symbol, navigate) }, node('span', { class: 'stock-avatar', 'aria-hidden': 'true' }, (item.name || item.symbol).slice(0, 1)), node('span', {}, node('span', { class: 'stock-name' }, item.name || item.symbol), node('span', { class: 'stock-code', style: 'display:block' }, item.symbol)));
  }
  function selectStock(symbol, navigate) { state.selected = symbol; renderTables(); renderDetail(); renderLinkage(); if (navigate) location.hash = 'overview'; }
  function stat(label, value, unit, caption, style, symbol) {
    return node('div', { class: 'stat-card ' + (style || '') }, node('div', { class: 'stat-top' }, label, node('span', { class: 'stat-icon' }, icon(symbol || 'chart'))), node('div', { class: 'stat-value' }, value, unit ? node('small', {}, unit) : null), node('div', { class: 'stat-caption' }, caption));
  }
  function renderOverview() {
    const r = state.result;
    const hit = r.items.filter(i => i.patterns?.positiveCount > 0).length;
    const risk = r.items.filter(i => i.evidence?.riskCount > 0 || i.patterns?.riskCount > 0).length;
    clear('overviewStats', stat('研究范围', r.total, '只股票', '当前导入数据的覆盖范围', '', 'layers'), stat('满足筛选', r.passed, '只股票', '按当前条件与数据质量筛选', 'blue', 'filter'), stat('看涨形态', hit, '只有命中', '完整研究规则命中，仍需核对', 'cyan', 'chart'), stat('形态风险', risk, '只有线索', '与看涨信号分别展示', 'red', 'shield'));
    $('overviewCount').textContent = r.total + ' 只';
    const avgGroups = r.items.reduce((sum, i) => sum + (i.evidence?.familyCount || 0), 0);
    const lines = [
      ['多组证据', r.items.filter(i => (i.evidence?.familyCount || 0) >= 2).length + ' 只', r.items.filter(i => (i.evidence?.familyCount || 0) >= 2).length / Math.max(1, r.total)],
      ['价格来源', new Set(r.items.map(i => i.source).filter(Boolean)).size + ' 类', 1],
      ['平均证据组', num(avgGroups / Math.max(1, r.total), 1) + ' 组', Math.min(1, avgGroups / Math.max(1, r.total * 5))]
    ];
    clear('evidenceOverview', node('div', { class: 'evidence-summary' }, lines.map(([label, value, width]) => node('div', {}, node('div', { class: 'evidence-line' }, label, node('strong', {}, value)), node('div', { class: 'evidence-bars', style: 'margin-top:-7px;margin-bottom:15px' }, node('i', { style: 'width:' + Math.round(width * 100) + '%' }))))));
  }
  function renderStockTable(items, target, detailed) {
    if (!items.length) { clear(target, empty('没有匹配的股票', '调整筛选条件，或导入更多有效历史数据。')); return; }
    const headers = detailed ? ['股票', '收盘价', '日涨跌', '日均成交额', '20日波动', '量比', '筛选', '观察'] : ['股票', '收盘价', '日涨跌', '证据', '观察'];
    const tbody = node('tbody');
    for (const item of items) {
      const bar = lastBar(item.symbol), change = dailyChange(item.symbol);
      const cells = [node('td', {}, stockButton(item, detailed)), node('td', { class: 'number' }, num(bar.close, 2)), node('td', { class: 'number ' + signClass(change) }, signed(change, true))];
      if (detailed) {
        const reasons = (item.conditions?.reasons || []).map(r => typeof r === 'string' ? (reasonLabels[r] || r) : text(r?.message || r?.reason || r?.code, '条件未满足'));
        const title = reasons.join('；') || (item.eligible ? '满足当前筛选条件' : '数据质量或安全条件未满足');
        cells.push(node('td', { class: 'number' }, amount(item.averageTurnover20)), node('td', { class: 'number' }, percent(item.features?.volatility20, true)), node('td', { class: 'number' }, num(item.features?.volumeRatio20, 2)), node('td', { title }, pill(item.eligible ? '满足' : '未满足', item.eligible ? 'blue' : 'neutral')));
      } else cells.push(node('td', {}, pill((item.evidence?.familyCount || 0) + ' 组', 'blue'), (item.evidence?.riskCount || 0) ? node('span', { title: '风险线索独立展示', style: 'margin-left:4px' }, pill('风险', 'red')) : null));
      cells.push(node('td', {}, watchButton(item)));
      tbody.append(node('tr', { class: item.symbol === state.selected ? 'selected-row' : '' }, cells));
    }
    clear(target, node('div', { class: 'table-scroll' }, node('table', { class: detailed ? 'filter-table' : 'stock-table' }, node('thead', {}, node('tr', {}, headers.map(x => node('th', { scope: 'col' }, x)))), tbody)));
  }
  function renderTables() {
    if (!state.result) return;
    renderStockTable(state.result.items.slice(0, 10), 'overviewTable', false);
    const query = state.query.trim().toLowerCase();
    const filtered = state.result.items.filter(i => (!query || (i.name + i.symbol).toLowerCase().includes(query)) && (state.resultTab === 'all' || (state.resultTab === 'passed' ? i.eligible : (i.evidence?.riskCount || 0) > 0)));
    renderStockTable(filtered, 'filterTable', true);
    $('filterResultCount').textContent = filtered.length + ' / ' + state.result.total + ' 只';
  }
  function candleChart(symbol) {
    const source = rawStock(symbol)?.bars || [];
    const bars = source.slice(-state.chartDays);
    if (bars.length < 2) return empty('K 线数据不足', '至少需要两条完整的历史日 K 线。');
    const W = 500, H = 250, L = 12, R = 47, T = 14, B = 190, volumeTop = 204, volumeBottom = 231;
    const hi = Math.max(...bars.map(b => b.high)), lo = Math.min(...bars.map(b => b.low)), margin = (hi - lo || hi * 0.02) * .14;
    const max = hi + margin, min = lo - margin, span = max - min;
    const y = p => T + (max - p) / span * (B - T);
    const step = (W - L - R) / bars.length, x = i => L + (i + .5) * step;
    const svg = svgNode('svg', { class: 'candle-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': (selectedItem()?.name || symbol) + '最近' + bars.length + '条历史日K线，红涨绿跌' });
    for (let i = 0; i < 5; i++) {
      const gy = T + i * (B - T) / 4;
      svg.append(svgNode('line', { x1: L, y1: gy, x2: W - R + 3, y2: gy, stroke: '#21324a', 'stroke-dasharray': '3 5', 'stroke-width': .7 }), svgNode('text', { x: W - R + 10, y: gy + 3, fill: '#607a9a', 'font-size': 8, 'font-family': 'monospace' }, num(max - i * span / 4, 2)));
    }
    const maxVol = Math.max(1, ...bars.map(b => b.volume));
    bars.forEach((b, i) => {
      const color = b.close >= b.open ? '#e77b83' : '#4cb496';
      svg.append(svgNode('line', { x1: x(i), x2: x(i), y1: y(b.high), y2: y(b.low), stroke: color, 'stroke-width': .9 }), svgNode('rect', { x: x(i) - Math.max(1, step * .6) / 2, y: Math.min(y(b.open), y(b.close)), width: Math.max(1, step * .6), height: Math.max(1, Math.abs(y(b.open) - y(b.close))), fill: color, rx: .5 }), svgNode('rect', { x: x(i) - step * .3, y: volumeBottom - b.volume / maxVol * (volumeBottom - volumeTop), width: Math.max(1, step * .6), height: Math.max(1, b.volume / maxVol * (volumeBottom - volumeTop)), fill: color, opacity: .45 }));
    });
    const points = [];
    bars.forEach((b, i) => { const at = source.length - bars.length + i; if (at >= 19) points.push(x(i) + ',' + y(source.slice(at - 19, at + 1).reduce((s, r) => s + r.close, 0) / 20)); });
    if (points.length > 1) svg.append(svgNode('polyline', { points: points.join(' '), fill: 'none', stroke: '#c7a969', 'stroke-width': 1.15, opacity: .9 }));
    for (const i of [0, Math.floor(bars.length / 2), bars.length - 1]) svg.append(svgNode('text', { x: x(i), y: 245, fill: '#597493', 'font-size': 7.5, 'text-anchor': i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle' }, bars[i].date?.slice(5) || ''));
    return svg;
  }
  function renderDetail() {
    const item = selectedItem(); if (!item) { clear('stockDetail', empty('选择一只股票', '导入历史数据后查看 K 线与证据。')); return; }
    const change = dailyChange(item.symbol), bar = lastBar(item.symbol);
    const intervalButtons = node('div', { class: 'segmented', role: 'group', 'aria-label': '图表显示范围' }, [20, 40, 60].map(days => node('button', { class: state.chartDays === days ? 'active' : '', 'aria-pressed': state.chartDays === days, onclick: () => { state.chartDays = days; renderDetail(); } }, days + '日')));
    const tags = (item.patterns?.matched || []).slice(0, 5).map(p => pill(p.label, p.side === 'bearish' ? 'red' : 'blue'));
    if (!tags.length) tags.push(pill('暂无形态命中', 'neutral'));
    clear('stockDetail',
      node('div', { class: 'detail-heading' }, node('div', { class: 'detail-title' }, node('h2', {}, item.name || item.symbol), node('span', { class: 'stock-code' }, item.symbol)), watchButton(item)),
      node('div', { class: 'detail-price-row' }, node('div', {}, node('span', { class: 'detail-price number ' + signClass(change) }, num(bar.close, 2)), node('span', { class: 'detail-change number ' + signClass(change) }, signed(change, true))), node('div', { class: 'detail-date' }, item.date || bar.date || '—', node('br'), '历史收盘')),
      node('div', { class: 'chart-toolbar' }, node('span', {}, '日 K 线'), intervalButtons), node('div', { class: 'chart-wrap' }, candleChart(item.symbol)),
      node('div', { class: 'chart-legend' }, node('span', {}, node('i', { class: 'legend-line' }), 'MA20'), node('span', {}, '红涨绿跌 · 下方为成交量')),
      node('dl', { class: 'detail-metrics' }, [['20日均成交额', amount(item.averageTurnover20)], ['20日波动率', percent(item.features?.volatility20, true)], ['20日量比', num(item.features?.volumeRatio20, 2)]].map(([k, v]) => node('div', {}, node('dt', {}, k), node('dd', { class: 'number' }, v)))),
      node('div', { class: 'detail-tags' }, tags));
  }
  function renderLinkage() {
    if (!state.result) return;
    const families = new Map();
    for (const item of state.result.items) for (const f of item.evidence?.families || []) families.set(f.id, f.label);
    const columns = [...families.entries()].slice(0, 6);
    const body = node('tbody');
    state.result.items.forEach(item => {
      const own = new Set((item.evidence?.families || []).map(f => f.id));
      body.append(node('tr', { class: item.symbol === state.selected ? 'selected-row' : '' }, node('td', {}, stockButton(item, false)), columns.map(([id]) => node('td', {}, node('span', { class: own.has(id) ? 'matrix-hit' : 'matrix-none', 'aria-label': own.has(id) ? '命中' : '未命中' }, own.has(id) ? '●' : '—'))), node('td', {}, pill((item.evidence?.rawPositiveCount || 0) + ' 项', 'neutral')), node('td', {}, pill((item.evidence?.familyCount || 0) + ' 组', 'blue')), node('td', {}, (item.evidence?.riskCount || 0) ? pill(item.evidence.riskCount + ' 项', 'red') : node('span', { class: 'muted' }, '未命中'))));
    });
    clear('linkageMatrix', node('div', { class: 'table-scroll' }, node('table', { class: 'matrix-table' }, node('thead', {}, node('tr', {}, ['股票', ...columns.map(f => f[1]), '原始命中', '证据组', '形态风险'].map(t => node('th', { scope: 'col' }, t)))), body)));
    const item = selectedItem();
    if (!item) return;
    $('linkageStockName').textContent = (item.name || '') + ' ' + item.symbol;
    const groups = (item.evidence?.families || []).map(f => node('div', { class: 'evidence-group' }, node('strong', {}, f.label), node('div', { class: 'tags' }, (f.labels || []).map(label => pill(label, 'blue')))));
    if (item.evidence?.risks?.length) groups.push(node('div', { class: 'evidence-group' }, node('strong', { class: 'positive' }, '独立风险线索'), node('div', { class: 'tags' }, item.evidence.risks.map(r => pill(r.label, 'red')))));
    clear('linkageDetail', groups.length ? node('div', { class: 'evidence-detail' }, groups, node('p', { class: 'page-footnote' }, item.evidence.note || '同源指标归组，不代表统计独立。')) : empty('暂无形态命中', '未命中形态不代表没有风险；市场、行业和公告资料仍需核对。'));
  }
  function renderFactors() {
    const report = state.factors;
    if (!report) { clear('factorTable', empty('暂无可分析样本', '导入完整历史数据后重试。')); return; }
    const rows = report.features || [], valid = rows.filter(r => finite(r.meanRankIC));
    clear('factorSummary', stat('研究因子', rows.length, '项', '固定的历史价量特征', '', 'layers'), stat('有可用截面', valid.length, '项', '每个日期需至少 ' + report.minSamples + ' 只股票', 'blue', 'chart'), stat('收益口径', '毛收益', '', '未计费用与成交约束', '', 'document'));
    const body = node('tbody');
    rows.forEach(f => body.append(node('tr', { class: 'factor-row' + (state.factorName === f.name ? ' selected-row' : '') }, node('td', {}, node('button', { class: 'stock-button', onclick: () => { state.factorName = f.name; renderFactors(); } }, text(f.label, featureLabels[f.name] || f.name))), node('td', { class: 'number ' + signClass(f.meanRankIC) }, num(f.meanRankIC, 3)), node('td', { class: 'number' }, f.validDates || 0), node('td', { class: 'number' }, percent(f.coverage, true)))));
    clear('factorTable', node('div', { class: 'table-scroll' }, node('table', { class: 'factor-table' }, node('thead', {}, node('tr', {}, ['因子', '平均 Rank IC', '有效日期', '覆盖率'].map(t => node('th', { scope: 'col' }, t)))), body)));
    const f = rows.find(r => r.name === state.factorName) || rows[0];
    if (!f) { clear('factorChart', empty('样本不足', '没有可用的因子数据。')); return; }
    $('factorChartTitle').textContent = text(f.label, featureLabels[f.name] || f.name) + ' · 分组表现';
    const qs = f.quantiles || [];
    if (!qs.some(q => finite(q.meanReturn))) { clear('factorChart', empty('有效截面不足', '增加同日股票数量及完整的后续开盘数据。')); return; }
    const maxAbs = Math.max(.00001, ...qs.filter(q => finite(q.meanReturn)).map(q => Math.abs(q.meanReturn)));
    clear('factorChart', node('div', { class: 'factor-chart' }, node('div', { class: 'quantile-bars', role: 'img', 'aria-label': '按因子值由低到高分为五组的平均毛收益' }, qs.map(q => node('div', { class: 'quantile-col', title: '第' + q.quantile + '组，' + q.samples + '个样本' }, node('span', { class: 'quantile-value number ' + signClass(q.meanReturn) }, signed(q.meanReturn, true)), node('div', { class: 'quantile-bar' + (q.meanReturn < 0 ? ' negative' : ''), style: 'height:' + (finite(q.meanReturn) ? Math.max(3, Math.abs(q.meanReturn) / maxAbs * 135) : 0) + 'px' })))), node('div', { class: 'quantile-labels' }, qs.map(q => node('span', {}, 'Q' + q.quantile))), node('p', { class: 'chart-caption' }, '因子值由 Q1 低组到 Q5 高组。柱高表示收益绝对幅度，蓝色柱为正、绿色柱为负。有效样本 ' + (f.sampleCount || 0) + ' 个；数据缺口保留为空。')));
  }
  const modelNames = { v6Original: '原 V6 基线', ridge: 'Ridge', extraTrees: 'Extra Trees', histBoost: 'HistGradientBoosting', lightgbm: 'LightGBM', xgboost: 'XGBoost', momentum: '动量对照', lowVol: '低波动对照', chinaValue: '中国价值对照' };
  function renderModelCards() {
    const cards = [
      ['LightGBM / XGBoost', '离线可选', 'CPU 树模型对照已支持离线实验。需要单独安装依赖，再用相同数据和账本参数比较。', 'https://github.com/microsoft/LightGBM', 'gold'],
      ['Qlib', '研究参考', '研究流程、时间切分与样本外评价。适合建立统一的实验协议。', 'https://github.com/microsoft/qlib', 'blue'],
      ['Alphalens', '分析参考', '因子 IC、分组收益与换手诊断。本页为本地计算，尚未连接外部分析包。', 'https://github.com/stefan-jansen/alphalens-reloaded', 'blue'],
      ['HIST', '未接入', '显式与隐含概念关联模型。需要可追溯的历史概念关系和统一样本外比较。', 'https://github.com/zhangchuheng123/HIST', 'neutral'],
      ['MASTER', '未接入', '市场引导的股票关系建模。需更完整的点时数据、训练资源与独立验证。', 'https://github.com/SJTU-DMTai/MASTER', 'neutral']
    ];
    clear('modelCards', ...cards.map(([name, status, description, url, style]) => node('article', { class: 'model-card' }, node('div', { class: 'model-card-top' }, node('h3', {}, name), pill(status, style)), node('p', {}, description), node('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '官方项目 ↗'))));
  }
  function validateModelReport(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !input.summaries || typeof input.summaries !== 'object' || Array.isArray(input.summaries)) throw Error('请导入包含 summaries 的 V6 模型实验报告。');
    if (!['imported', 'simulated'].includes(input.source)) throw Error('模型报告需要明确的 source：imported 或 simulated。');
    const entries = Object.entries(input.summaries);
    if (!entries.length || entries.length > 20) throw Error('模型报告的比较组数量无效。');
    const allowedMetrics = ['returnPct', 'maxDrawdownPct', 'sharpe', 'winRatePct', 'closedTrades', 'finalEquity', 'totalFees'];
    const normalized = {};
    for (const [key, metrics] of entries) {
      if (!Object.hasOwn(modelNames, key) || !metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw Error('报告中包含不支持的模型组。');
      if (!finite(metrics.returnPct) || !finite(metrics.maxDrawdownPct)) throw Error('每个模型组需要有效的收益率和最大回撤。');
      normalized[key] = {};
      for (const field of allowedMetrics) {
        if (metrics[field] !== undefined && metrics[field] !== null && !finite(metrics[field])) throw Error('模型报告指标必须是数字或空值。');
        normalized[key][field] = metrics[field] ?? null;
      }
    }
    return { source: input.source, asOf: text(input.asOf, '未知'), firstEvaluationDate: text(input.firstEvaluationDate, '未知'), trainingRows: Number.isSafeInteger(input.trainingRows) && input.trainingRows >= 0 ? input.trainingRows : null, summaries: normalized };
  }
  function renderModels() {
    const r = state.modelReport;
    $('clearModelReport').hidden = !r;
    if (!r) { clear('modelReport', empty('等待你的实验报告', '这里不展示预设收益。导入 V6 离线模型报告后，可查看各模型真实输出的指标。', node('button', { class: 'button secondary', onclick: () => $('modelFile').click() }, icon('upload'), '选择报告文件'))); return; }
    const body = node('tbody', {}, Object.entries(r.summaries).map(([name, m]) => node('tr', {}, node('td', {}, node('strong', { style: 'font-weight:500' }, modelNames[name])), node('td', { class: 'number ' + signClass(m.returnPct) }, signed(m.returnPct, false)), node('td', { class: 'number' }, percent(m.maxDrawdownPct, false)), node('td', { class: 'number' }, num(m.sharpe, 2)), node('td', { class: 'number' }, percent(m.winRatePct, false)), node('td', { class: 'number' }, finite(m.closedTrades) ? num(m.closedTrades, 0) : '—'))));
    clear('modelReport', node('div', { class: 'table-scroll' }, node('table', { class: 'model-table' }, node('thead', {}, node('tr', {}, ['比较组', '累计收益', '最大回撤', '夏普', '胜率', '已平仓'].map(t => node('th', { scope: 'col' }, t)))), body)), node('div', { class: 'report-meta' }, pill(r.source === 'simulated' ? '合成数据实验' : '导入历史实验', r.source === 'simulated' ? 'gold' : 'blue'), node('span', {}, r.firstEvaluationDate + ' → ' + r.asOf), node('span', {}, '训练样本 ' + num(r.trainingRows, 0))), node('p', { class: 'report-notice' }, '指标来自导入文件，尚未核验数据与实验过程。历史结果不证明未来收益，单次留出结果仍需滚动样本外对照。'));
  }
  function parseWatchlist(raw) {
    const input = JSON.parse(raw);
    if (!input || input.schemaVersion !== 1 || !Array.isArray(input.rows) || input.rows.length > 200) throw Error('观察列表格式无效');
    const seen = new Set();
    return input.rows.map(r => {
      if (!r || !/^\d{6}$/.test(r.symbol) || seen.has(r.symbol) || typeof r.name !== 'string') throw Error('观察列表记录无效');
      seen.add(r.symbol);
      return { symbol: r.symbol, name: r.name.slice(0, 80), date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '', source: text(r.source, '未知来源'), price: finite(r.price) && r.price > 0 ? r.price : null, savedAt: finite(r.savedAt) ? r.savedAt : null };
    });
  }
  function loadWatchlist() {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return [];
      try { return parseWatchlist(raw); } catch {
        const backup = localStorage.getItem(BACKUP_KEY);
        if (!backup) { toast('观察列表已损坏，当前页面使用空列表；可尝试恢复备份。'); return []; }
        const rows = parseWatchlist(backup); toast('已从上次备份恢复观察列表。'); return rows;
      }
    } catch { toast('浏览器未允许本地存储，观察列表将只保留在当前页面。'); return []; }
  }
  function saveWatchlist(rows) {
    const old = state.watch;
    state.watch = rows;
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ schemaVersion: 1, rows: old })); localStorage.setItem(WATCH_KEY, JSON.stringify({ schemaVersion: 1, rows })); } catch { toast('无法写入本地存储，请导出观察列表备份。'); }
    renderWatchlist(); renderTables(); renderDetail();
  }
  function toggleWatch(item) {
    if (isWatched(item.symbol)) { saveWatchlist(state.watch.filter(s => s.symbol !== item.symbol)); toast('已移出观察，上次列表可恢复。'); return; }
    if (state.watch.length >= 200) { toast('观察列表最多保存 200 只股票。'); return; }
    const bar = lastBar(item.symbol);
    saveWatchlist([...state.watch, { symbol: item.symbol, name: item.name || item.symbol, date: item.date || bar.date || '', source: item.source || '未知来源', price: finite(bar.close) ? bar.close : null, savedAt: Date.now() }]);
    toast('已加入观察列表。');
  }
  function renderWatchlist() {
    $('watchCount').textContent = state.watch.length;
    $('watchSummary').textContent = '已保存 ' + state.watch.length + ' 只股票 · 本机观察记录';
    if (!state.watch.length) { clear('watchlistTable', empty('把值得关注的股票留在这里', '点击股票旁的星标加入观察。这里保存关注记录，不会自动获取行情或发送提醒。', node('a', { href: '#overview', class: 'button secondary' }, '查看候选股票 →'))); return; }
    const tbody = node('tbody');
    state.watch.forEach(w => {
      const current = state.result?.items.find(i => i.symbol === w.symbol);
      tbody.append(node('tr', {}, node('td', {}, current ? stockButton(current, true) : node('div', {}, node('div', { class: 'stock-name' }, w.name), node('div', { class: 'stock-code' }, w.symbol))), node('td', { class: 'number' }, num(w.price, 2)), node('td', { class: 'number' }, w.date || '—'), node('td', { title: w.source }, text(w.source)), node('td', {}, current ? pill('当前数据可查', 'blue') : pill('待导入历史', 'neutral')), node('td', {}, node('button', { class: 'text-button', 'aria-label': '移出观察：' + w.name, onclick: () => { saveWatchlist(state.watch.filter(s => s.symbol !== w.symbol)); toast('已移出，上次列表可恢复。'); } }, '移出'))));
    });
    clear('watchlistTable', node('div', { class: 'table-scroll' }, node('table', { class: 'watch-table' }, node('thead', {}, node('tr', {}, ['股票', '记录时收盘', '数据日期', '来源', '状态', '操作'].map(t => node('th', { scope: 'col' }, t)))), tbody)));
  }
  function applyDataset(input, filename, demo) {
    const result = window.V6Research.analyzeSnapshot(input, state.filters);
    const factors = window.V6Research.analyzeFactors(input);
    state.input = input; state.result = result; state.factors = factors; state.filename = filename; state.isDemo = demo;
    if (!result.items.some(i => i.symbol === state.selected)) state.selected = result.items[0]?.symbol || '';
    resetError(); renderAll();
  }
  function renderAll() {
    $('datasetLabel').textContent = state.isDemo ? '合成示例 · 用于体验，非真实行情' : (state.result.simulated ? '已导入合成数据 · ' : '已导入历史数据 · ') + state.filename;
    $('datasetDate').textContent = '截至 ' + dateOf(state.result.asOf);
    $('datasetStrip').classList.toggle('imported', !state.isDemo);
    renderOverview(); renderTables(); renderDetail(); renderLinkage(); renderFactors(); renderModels(); renderWatchlist();
  }
  function navigate() {
    const page = location.hash.slice(1);
    state.page = Object.hasOwn(views, page) ? page : 'overview';
    for (const el of document.querySelectorAll('[data-page]')) el.hidden = el.dataset.page !== state.page;
    for (const el of document.querySelectorAll('[data-nav]')) { const active = el.dataset.nav === state.page; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }
    $('pageTitle').textContent = views[state.page][0]; $('breadcrumbTitle').textContent = views[state.page][0]; $('pageDescription').textContent = views[state.page][1];
    document.title = views[state.page][0] + ' · 天枢智策 V6';
    closeMenu();
  }
  function closeMenu() { $('sidebar').classList.remove('open'); $('mobileShade').hidden = true; $('menuButton').setAttribute('aria-expanded', 'false'); }
  async function readFile(file) {
    if (!file) return null;
    if (file.size > 8 * 1024 * 1024) throw Error('文件超过 8 MB，请缩小历史范围后再导入。');
    try { return JSON.parse(await file.text()); } catch { throw Error('文件不是有效的 JSON，请下载示例核对格式。'); }
  }
  function bind() {
    $('importButton').onclick = () => $('datasetFile').click();
    $('modelImportButton').onclick = () => $('modelFile').click();
    $('exampleButton').onclick = $('dialogExample').onclick = () => download('v6-history-example.json', window.V6Research.demoDataset());
    $('formatButton').onclick = () => $('formatDialog').showModal();
    $('closeFormat').onclick = () => $('formatDialog').close();
    $('resetDemoButton').onclick = () => { try { applyDataset(window.V6Research.demoDataset(), '', true); toast('已切换到合成示例。'); } catch (e) { showError(e.message); } };
    $('datasetFile').onchange = async (event) => { const file = event.target.files[0]; if (!file) return; try { const input = await readFile(file); applyDataset(input, file.name.slice(0, 100), false); toast('已导入 ' + state.result.total + ' 只股票。'); } catch (e) { showError(e.message || '导入失败，当前数据已保留。'); } finally { event.target.value = ''; } };
    $('modelFile').onchange = async (event) => { const file = event.target.files[0]; if (!file) return; try { state.modelReport = validateModelReport(await readFile(file)); renderModels(); location.hash = 'models'; resetError(); toast('模型报告已载入。'); } catch (e) { showError(e.message); } finally { event.target.value = ''; } };
    $('clearModelReport').onclick = () => { state.modelReport = null; renderModels(); toast('已移除当前报告。'); };
    $('filterForm').onsubmit = (event) => {
      event.preventDefault();
      try {
        const next = {};
        for (const [id, scale] of [['minAverageTurnover20', 1e8], ['maxVolatility20', .01], ['minVolumeRatio20', 1], ['maxVolumeRatio20', 1]]) {
          const raw = $(id).value.trim();
          if (!raw) continue;
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0) throw Error('筛选条件需要非负数字。');
          next[id] = value * scale;
        }
        if (next.minVolumeRatio20 !== undefined && next.maxVolumeRatio20 !== undefined && next.minVolumeRatio20 > next.maxVolumeRatio20) throw Error('量比下限不能高于上限。');
        const result = window.V6Research.analyzeSnapshot(state.input, next);
        state.filters = next; state.result = result; resetError(); renderAll(); toast('筛选已更新，' + result.passed + ' 只满足条件。');
      } catch (e) { showError(e.message); }
    };
    $('resetFilters').onclick = () => { $('filterForm').reset(); state.filters = {}; state.query = ''; $('stockSearch').value = ''; state.resultTab = 'all'; document.querySelectorAll('[data-result]').forEach(n => n.classList.toggle('active', n.dataset.result === 'all')); state.result = window.V6Research.analyzeSnapshot(state.input, {}); renderAll(); resetError(); toast('已重置筛选。'); };
    $('stockSearch').oninput = event => { state.query = event.target.value; renderTables(); };
    document.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => { state.resultTab = button.dataset.result; document.querySelectorAll('[data-result]').forEach(n => n.classList.toggle('active', n === button)); renderTables(); }));
    $('exportAnalysisButton').onclick = () => { if (!state.result) return; download('v6-research-' + dateOf(state.result.asOf) + '.json', { schemaVersion: 1, snapshot: state.result, factors: state.factors, modelReport: state.modelReport }); };
    $('exportWatchlist').onclick = () => download('v6-watchlist.json', { schemaVersion: 1, rows: state.watch });
    $('clearWatchlist').onclick = () => { if (!state.watch.length) { toast('观察列表已经为空。'); return; } if (confirm('清空当前观察列表？清空后可以恢复上次列表。')) { saveWatchlist([]); toast('已清空，可恢复上次列表。'); } };
    $('recoverWatchlist').onclick = () => { try { const backup = localStorage.getItem(BACKUP_KEY); if (!backup) { toast('暂无可恢复的上次列表。'); return; } const rows = parseWatchlist(backup); saveWatchlist(rows); toast('已恢复上次列表。'); } catch { toast('备份不可用，当前列表已保留。'); } };
    $('menuButton').onclick = () => { const open = !$('sidebar').classList.contains('open'); $('sidebar').classList.toggle('open', open); $('mobileShade').hidden = !open; $('menuButton').setAttribute('aria-expanded', String(open)); };
    $('mobileShade').onclick = closeMenu;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('hashchange', navigate);
  }
  try {
    fillIcons(); bind(); navigate(); renderModelCards(); state.watch = loadWatchlist();
    if (!window.V6Research) throw Error('研究模块未加载，请刷新页面重试。');
    applyDataset(window.V6Research.demoDataset(), '', true);
  } catch (e) { showError(e.message || '页面加载失败，请刷新重试。'); }
})();
