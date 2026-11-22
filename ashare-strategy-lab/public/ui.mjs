// All user-controlled content is appended as text, including imported review notes.
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const append = child => {
    if (Array.isArray(child)) child.forEach(append);
    else if (child instanceof Node) node.append(child);
    else if (child != null && child !== false) node.append(document.createTextNode(String(child)));
  };
  children.forEach(append);
  return node;
}

export const button = (label, onClick, kind = 'secondary') => el('button', { type: 'button', class: 'button ' + kind, onClick }, label);
export const link = (label, page, kind = 'secondary') => el('a', { class: 'button ' + kind, href: '#' + page }, label);
export const tag = (label, tone = '') => el('span', { class: 'tag ' + tone }, label);
export const fmt = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '—';
export const pct = value => Number.isFinite(value) ? fmt(value) + '%' : '待录入';
export const signedPct = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + pct(value) : '待录入';
export const signedTone = value => Number.isFinite(value) ? (value > 0 ? 'rise' : value < 0 ? 'fall' : '') : 'muted';
export const stateLabel = { matched: '符合', unmatched: '不符合', unknown: '待核实', yes: '符合', no: '不符合' };
export const stateTone = { matched: 'good', unmatched: 'dim', unknown: 'warn', yes: 'good', no: 'dim' };
export const kindLabel = { strategy: '战法', risk: '风控', index: '指数' };

export function heading(title, description, actions = []) {
  return el('header', { class: 'page-heading' },
    el('div', {}, el('h1', { id: 'main-heading', tabindex: '-1' }, title), description && el('p', {}, description)),
    actions.length && el('div', { class: 'actions heading-actions' }, actions));
}

export function panel(title, content, tail = null, extraClass = '') {
  return el('section', { class: 'panel ' + extraClass },
    el('header', { class: 'panel-head' }, el('h2', {}, title), tail),
    el('div', { class: 'panel-body' }, content));
}

export function empty(title, text = '', action = null) {
  return el('div', { class: 'empty' }, el('strong', {}, title), text && el('p', {}, text), action);
}

export function labelField(label, control, hint = '') {
  return el('label', { class: 'field' }, el('span', {}, label), control, hint && el('small', {}, hint));
}

export function metric(label, value, detail, tone = '') {
  return el('div', { class: 'metric panel' },
    el('span', {}, label), el('strong', { class: tone }, value), el('small', {}, detail));
}

function meter(value, max, tone) {
  const progress = el('progress', { max: max || 1, value: value || 0, class: 'meter ' + tone });
  return progress;
}

export function factorCoverage(result) {
  const defs = [['strategy', '战法', 'accent'], ['risk', '风控', 'warning'], ['index', '指数', 'green']];
  return el('div', { class: 'coverage-list' }, defs.map(([kind, label, tone]) => {
    const rules = result.rules.filter(rule => rule.kind === kind);
    const known = rules.filter(rule => rule.status !== 'unknown').length;
    return el('div', { class: 'coverage-row' },
      el('span', {}, label),
      el('div', {}, meter(known, rules.length, tone)),
      el('span', { class: 'tabular' }, known + ' / ' + rules.length));
  }));
}

// Use an explicit zero axis, and keep exact readable values outside the bar tracks.
export function marketBars(market, states = {}) {
  const trends = { bull: '多头', range: '震荡', bear: '空头' };
  const values = [['全A', market.allAPct, states.allA], ['上证', market.shPct, states.sh], ['创业板', market.cybPct, states.cyb]];
  const scale = Math.max(1, ...values.map(([, value]) => Number.isFinite(value) ? Math.abs(value) : 0));
  return el('div', { class: 'market-bars' }, values.map(([label, value, state]) => {
    const width = Number.isFinite(value) ? Math.abs(value) / scale * 100 : 0;
    return el('div', { class: 'market-bar-row' },
      el('span', {}, label, trends[state] && el('small', { class: 'muted trend-label' }, trends[state])),
      el('div', { class: 'market-track', 'aria-hidden': 'true' },
        el('div', { class: 'market-negative' }, meter(value < 0 ? width : 0, 100, 'negative')),
        el('div', { class: 'market-positive' }, meter(value > 0 ? width : 0, 100, 'positive'))),
      el('strong', { class: signedTone(value) }, signedPct(value)));
  }));
}

export function breadthBar(up, down) {
  if (!Number.isFinite(up) || !Number.isFinite(down) || up + down === 0) {
    return el('div', { class: 'breadth-empty' }, '录入上涨与下跌家数可查看涨跌分布');
  }
  return el('div', { class: 'breadth' },
    el('div', { class: 'breadth-legend' }, el('span', { class: 'rise' }, '上涨 ' + fmt(up)), el('span', { class: 'fall' }, '下跌 ' + fmt(down))),
    meter(up, up + down, 'breadth-meter'));
}

export function reviewBars(records) {
  const rows = records.filter(record => Number.isFinite(record.outcomePct)).slice(0, 12).reverse();
  if (!rows.length) return empty('暂无已填写结果', '在记录中输入观察涨跌幅，统计会在这里更新。');
  const max = Math.max(1, ...rows.map(r => Math.abs(r.outcomePct)));
  return el('div', { class: 'review-bars' }, rows.map(record => el('div', { class: 'market-bar-row' },
    el('span', {}, record.case.stock.code || '未填代码', record.case.stock.day &&
      el('small', { class: 'muted trend-label' }, record.case.stock.day.slice(5))),
    el('div', { class: 'market-track', 'aria-hidden': 'true' },
      el('div', { class: 'market-negative' }, meter(record.outcomePct < 0 ? -record.outcomePct : 0, max, 'negative')),
      el('div', { class: 'market-positive' }, meter(record.outcomePct > 0 ? record.outcomePct : 0, max, 'positive'))),
    el('strong', { class: signedTone(record.outcomePct) }, signedPct(record.outcomePct)))));
}
