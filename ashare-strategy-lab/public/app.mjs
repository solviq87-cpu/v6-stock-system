import { evaluate, normalizeCase } from './engine.mjs';
import { GROUPS } from './schema.mjs';
import {
  loadDraft, saveDraft, loadRecords, saveRecords, makeRecord,
  recordsToJSON, recordsToCSV, downloadText
} from './records.mjs';
import { demoCase } from './demo.mjs';
import {
  el, button, link, tag, fmt, pct, signedPct, signedTone, stateLabel, stateTone, kindLabel,
  heading, panel, empty, labelField, metric, factorCoverage, marketBars, breadthBar, reviewBars
} from './ui.mjs';

const main = document.querySelector('main');
const breadcrumb = document.querySelector('#breadcrumb');
const toast = document.querySelector('#toast');
const navigation = [...document.querySelectorAll('[data-page]')];
const pageLabels = { overview: '分析总览', input: '证据录入', rules: '因子校验', history: '复盘记录' };
const tone = { block: 'danger', warn: 'warn', review: 'warn', watch: 'warn', candidate: 'good', info: 'good', unknown: 'dim' };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const day = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ stock: {}, market: {}, portfolio: {}, evidence: {} });

let draft = loadDraft() || { case: blank(), demo: false };
let records = loadRecords();
let result = evaluate(draft.case);
let activePage = '';
let inputGroup = 'stock';
let kindFilter = 'all';
let statusFilter = 'all';
let query = '';
let historyFilter = 'all';
let activeRecord = null;
let toastTimer;
let draftWarning = false;

const openRules = new Set();
const safeTime = time => Number.isFinite(Date.parse(time)) ? dateFormat.format(new Date(time)) : '时间未知';
const isRiskHit = rule => rule.clauses.some(clause => clause.status === 'matched' && ['block', 'warn'].includes(clause.level));
const selectedRule = (kind, status = 'all') => {
  kindFilter = kind;
  statusFilter = status;
  query = '';
  if (activePage === 'rules') render();
  else location.hash = 'rules';
};

function notify(message, kind = '') {
  clearTimeout(toastTimer);
  toast.className = 'toast ' + kind;
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3300);
}

function updateDraft() {
  result = evaluate(draft.case);
  if (saveDraft(draft)) draftWarning = false;
  else if (!draftWarning) {
    draftWarning = true;
    notify('浏览器无法写入草稿，本次录入仍可在当前页面继续。', 'error');
  }
}

function loadExample() {
  if (!draft.demo && Object.values(draft.case).some(group => Object.keys(group).length) &&
      !window.confirm('载入示例会替换当前录入，已保存的复盘会保留。继续？')) return;
  draft = { case: normalizeCase(demoCase()), demo: true };
  updateDraft();
  if (activePage === 'overview') render();
  else location.hash = 'overview';
  notify('已载入模拟案例');
}

function clearInput() {
  if (!window.confirm('清空当前录入和证据？已保存的复盘记录会保留。')) return;
  draft = { case: blank(), demo: false };
  updateDraft();
  render();
  notify('已清空当前录入');
}

function saveReview() {
  if (!/^\d{6}$/.test(result.case.stock.code || '') || !result.case.stock.day) {
    inputGroup = 'stock';
    if (activePage !== 'input') location.hash = 'input';
    else render();
    notify('填写六位股票代码和分析日期后可保存复盘。', 'error');
    return;
  }
  const record = makeRecord(result, { demo: draft.demo });
  if (!saveRecords([record, ...records])) {
    notify('记录未写入，请先导出已有记录或检查浏览器存储。', 'error');
    return;
  }
  records = [record, ...records];
  historyFilter = 'all';
  activeRecord = record.id;
  if (activePage !== 'history') location.hash = 'history';
  else render();
  notify('复盘记录已保存');
}

function caseBanner() {
  const { stock } = result.case;
  const summary = [stock.name, stock.code, stock.sector].filter(Boolean).join(' · ');
  if (!draft.demo && !summary && !stock.day) return null;
  return el('div', { class: 'case-banner' },
    tag(draft.demo ? '模拟案例' : '当前案例', draft.demo ? 'warn' : 'accent'),
    el('strong', {}, summary || '尚未填写股票'),
    el('span', { class: 'muted' }, stock.day || '分析日期待录入'));
}

function reasonList(reasons) {
  if (!reasons?.length) return null;
  return el('ul', { class: 'reason-list' }, reasons.map(reason => el('li', {}, reason)));
}

function summaryCards() {
  const { advice, environment, summary } = result;
  const cap = Number.isFinite(advice.capPct) ? pct(advice.capPct) : '待校验';
  return el('div', { class: 'metric-grid' }, [
    metric('匹配战法', fmt(summary.matchedStrategies), '全部判定条件符合', 'cyan'),
    metric('命中风险', fmt(summary.triggeredRisks), '风控规则与指数风险', summary.triggeredRisks ? 'amber' : 'cyan'),
    metric('全A指数环境', environment.label, '按当前录入判断', tone[environment.level]),
    metric('模拟新增仓位上限', cap, '占总资产比例', Number.isFinite(advice.capPct) ? tone[advice.status] : 'muted')
  ]);
}

function overview() {
  const { market } = result.case;
  const { summary, environment, advice } = result;
  const strategies = result.rules.filter(rule => rule.kind === 'strategy' && rule.status === 'matched');
  const risks = result.rules.filter(isRiskHit);
  return [
    heading('盘面与战法分析', '按录入的证据校验战法、风险和全A指数环境。', [
      button('载入示例', loadExample, 'secondary'), link('录入个股与盘面', 'input', 'primary')
    ]),
    caseBanner(),
    summaryCards(),
    el('div', { class: 'dashboard-grid' },
      panel('指数与市场广度', [
        marketBars(market, environment.indexStates), breadthBar(market.advances, market.declines),
        el('dl', { class: 'mini-values' },
          el('div', {}, el('dt', {}, '两市成交额'), el('dd', {}, Number.isFinite(market.amount) ? fmt(market.amount) + ' 亿元' : '待录入')),
          el('div', {}, el('dt', {}, '成交额变动'), el('dd', { class: signedTone(environment.amountChangePct) }, signedPct(environment.amountChangePct)))),
        el('p', { class: 'body-caption' }, environment.description),
        reasonList(environment.reasons)
      ], tag(environment.label, tone[environment.level])),
      panel('开仓条件校验', [
        el('div', { class: 'advice-title ' + tone[advice.status] }, advice.label),
        el('p', { class: 'advice-copy' }, advice.message),
        reasonList(advice.reasons),
        el('div', { class: 'actions advice-actions' }, button('保存复盘', saveReview, 'primary'), link('查看因子', 'rules'))
      ], tag('模拟研究', 'accent'), 'advice-panel')),
    el('div', { class: 'dashboard-grid secondary-grid' },
      panel('匹配战法', strategies.length ? el('ul', { class: 'summary-list' }, strategies.slice(0, 6).map(rule =>
        el('li', {}, el('strong', {}, rule.name), tag('条件符合', 'good')))) :
        empty('暂无完整匹配', '打开因子校验查看已通过和待核实的条件。'),
      button('查看战法', () => selectedRule('strategy', strategies.length ? 'matched' : 'all'), 'quiet')),
      panel('风险提示', risks.length ? el('ul', { class: 'summary-list' }, risks.slice(0, 6).map(rule =>
        el('li', {}, el('strong', {}, rule.name), tag(rule.clauses.some(c => c.status === 'matched' && c.level === 'block') ? '拦截' : '预警', 'warn')))) :
        empty('暂无已确认的风险触发', '未填写的风险证据在因子校验中显示为待核实。'),
      button('查看风险', () => selectedRule(risks.length ? 'risk-hit' : 'risk'), 'quiet')),
      panel('规则校验覆盖', factorCoverage(result), tag(summary.knownCriteria + ' / ' + summary.totalCriteria + ' 条证据', 'dim')))
  ];
}

function optionField(options, value, placeholder = '待确认') {
  const select = el('select', {}, el('option', { value: '' }, placeholder),
    options.map(([key, label]) => el('option', { value: key }, label)));
  select.value = value == null ? '' : String(value);
  return select;
}

function inputField(group, field) {
  const oldValue = draft.case[group]?.[field.key];
  const control = field.type === 'select' ? optionField(field.options || [], oldValue) :
    el('input', {
      type: field.type, min: field.type === 'date' ? '0001-01-01' : field.min,
      max: field.type === 'date' ? '9999-12-31' : field.max, step: field.type === 'number' ? field.step || 'any' : null,
      inputmode: field.key === 'code' ? 'numeric' : field.type === 'number' ? 'decimal' : null,
      pattern: field.key === 'code' ? '[0-9]{6}' : null,
      maxlength: field.maxLength,
      placeholder: field.type === 'date' ? null : field.key === 'code' ? '六位代码' : '未录入',
      autocomplete: 'off'
    });
  control.name = group + '.' + field.key;
  if (field.type !== 'select') control.value = oldValue ?? '';
  control.addEventListener('change', () => {
    const valid = control.checkValidity();
    if (!valid) {
      control.setAttribute('aria-invalid', 'true');
      control.reportValidity();
    } else control.removeAttribute('aria-invalid');
    const values = draft.case[group];
    const prior = values[field.key];
    const next = !valid || control.value === '' ? undefined : field.type === 'number' ? Number(control.value) : control.value.trim();
    if (next === undefined || next === '') delete values[field.key];
    else values[field.key] = next;
    if (group === 'stock' && (field.key === 'code' || field.key === 'day') && next !== prior) {
      resetIdentityInputs(field.key, prior, control);
    }
    updateDraft();
    if (!valid) notify('输入超出字段范围，该项暂按未知处理。', 'error');
  });
  return labelField(field.label, control, field.hint || '');
}

// A different security or session must not inherit dated measurements or approvals.
function resetIdentityInputs(key, prior, changedControl) {
  const hadEvidence = Object.keys(draft.case.evidence).length > 0;
  if (prior !== undefined) {
    const stableKeys = key === 'day' ? ['day', 'code', 'name', 'sector', 'themeStatus'] : ['day', 'code'];
    for (const field of Object.keys(draft.case.stock)) {
      if (!stableKeys.includes(field)) delete draft.case.stock[field];
    }
    if (key === 'day') draft.case.market = {};
    draft.case.portfolio = {};
    for (const input of main.querySelectorAll('form [name^="stock."]')) {
      if (input !== changedControl) input.value = draft.case.stock[input.name.slice(6)] ?? '';
    }
    notify('已清除与原股票或日期绑定的录入及证据。');
  } else if (hadEvidence) {
    notify('股票代码或日期已变更，当前案例的手工证据已清空。');
  }
  draft.case.evidence = {};
}

function inputView() {
  const group = GROUPS.find(group => group.key === inputGroup) || GROUPS[0];
  const groupTips = {
    stock: '填写股票和观察日期。量比、换手、竞价和均线用于自动校验。',
    market: '填写同一日期的指数、家数和成交额。参考成交额可填前一交易日或你采用的统一基准。',
    portfolio: '这里用于模拟仓位和纪律判断。仓位以总资产百分比填写。'
  };
  const advanced = group.fields.filter((field, index) => field.advanced ?? index >= 12);
  const primary = group.fields.filter(field => !advanced.includes(field));
  const switcher = el('div', { class: 'segments', role: 'group', 'aria-label': '录入类别' },
    GROUPS.map(item => el('button', {
      type: 'button', class: item.key === group.key ? 'selected' : '',
      'aria-pressed': String(item.key === group.key), onClick: () => {
        inputGroup = item.key;
        render();
        main.querySelector('.segments .selected')?.focus();
      }
    }, item.label)));
  const forms = el('form', { class: 'section-form', onSubmit: event => event.preventDefault() },
    el('div', { class: 'field-grid' }, primary.map(field => inputField(group.key, field))),
    advanced.length && el('details', { class: 'advanced-fields' }, el('summary', {}, '展开更多字段'),
      el('div', { class: 'field-grid' }, advanced.map(field => inputField(group.key, field)))));
  return [
    heading('证据录入', '空白字段保留为未知。核对交易日与数据口径后再保存。', [
      button('清空录入', clearInput, 'quiet'), button('保存复盘', saveReview, 'primary')
    ]),
    draft.demo && el('p', { class: 'inline-alert' }, '当前使用模拟示例。开始自己的案例前，可选择清空录入。'),
    switcher,
    panel(group.label, [el('p', { class: 'body-caption form-tip' }, groupTips[group.key]), forms,
      el('div', { class: 'actions form-footer' }, link('校验因子', 'rules', 'primary'), link('返回分析总览', 'overview'))])
  ];
}

function ruleTone(rule) {
  const hit = rule.clauses.filter(c => c.status === 'matched').map(c => c.level);
  if (hit.includes('block')) return 'danger';
  if (hit.includes('warn')) return 'warn';
  return stateTone[rule.status];
}

function criterionRow(criterion, repaint) {
  let control;
  if (criterion.source === 'automatic') {
    control = tag('自动 · ' + (stateLabel[criterion.state] || '待核实'), stateTone[criterion.state]);
  } else {
    control = optionField([['yes', '符合'], ['no', '不符合']], draft.case.evidence[criterion.id], '待核实');
    control.className = 'criterion-choice';
    control.id = 'criterion-' + criterion.id;
    control.setAttribute('aria-label', criterion.id + ' ' + criterion.label);
    control.addEventListener('change', () => {
      if (control.value) draft.case.evidence[criterion.id] = control.value;
      else delete draft.case.evidence[criterion.id];
      updateDraft();
      repaint();
      document.getElementById(control.id)?.focus({ preventScroll: true });
    });
  }
  return el('div', { class: 'criterion' },
    el('div', {}, el('span', {}, criterion.label),
      criterion.detail && el('small', {}, criterion.detail)), control);
}

function ruleCard(rule, repaint) {
  const details = el('details', { class: 'rule-card', 'data-rule-id': rule.id, open: openRules.has(rule.id) });
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) openRules.add(rule.id);
    else openRules.delete(rule.id);
  });
  details.append(el('summary', {},
    el('span', { class: 'rule-number' }, String(rule.id).padStart(2, '0')),
    el('strong', {}, rule.name),
    tag(kindLabel[rule.kind], 'dim'), tag(stateLabel[rule.status], ruleTone(rule))));
  details.append(el('div', { class: 'rule-detail' }, rule.clauses.map(clause => el('section', { class: 'rule-clause' },
    el('div', { class: 'clause-head' },
      el('strong', {}, clause.label || rule.name),
      el('span', { class: 'muted' }, clause.logic === 'any' ? '任一条件符合' : '全部条件符合'),
      tag(stateLabel[clause.status], clause.status === 'matched' && tone[clause.level] || stateTone[clause.status])),
    clause.criteria.map(criterion => criterionRow(criterion, repaint)),
    clause.advice && el('p', { class: 'clause-advice' }, clause.advice)))));
  return details;
}

function rulesView() {
  const list = el('div', { class: 'rule-list' });
  const count = el('span', { class: 'muted rules-count', role: 'status' });
  const search = el('input', { type: 'search', 'aria-label': '搜索规则', placeholder: '搜索编号、名称或条件' });
  search.value = query;
  const status = optionField([['matched', '符合'], ['unknown', '待核实'], ['unmatched', '不符合']], statusFilter === 'all' ? '' : statusFilter, '全部结果');
  status.setAttribute('aria-label', '筛选匹配结果');
  const groups = el('div', { class: 'segments', role: 'group', 'aria-label': '因子分类' },
    [['all', '全部'], ...Object.entries(kindLabel), ['risk-hit', '命中风险']].map(([kind, label]) => el('button', {
      type: 'button', class: kind === kindFilter ? 'selected' : '', 'aria-pressed': String(kind === kindFilter),
      onClick: event => {
        kindFilter = kind;
        for (const node of groups.children) {
          node.classList.toggle('selected', node === event.currentTarget);
          node.setAttribute('aria-pressed', String(node === event.currentTarget));
        }
        repaint();
      }
    }, label)));
  function repaint() {
    // A change event can arrive before the asynchronous details toggle event.
    for (const card of list.querySelectorAll('details[data-rule-id]')) {
      const id = Number(card.dataset.ruleId);
      if (card.open) openRules.add(id);
      else openRules.delete(id);
    }
    const term = query.trim().toLocaleLowerCase('zh-CN');
    const visible = result.rules.filter(rule => (kindFilter === 'all' || rule.kind === kindFilter ||
      kindFilter === 'risk-hit' && isRiskHit(rule)) &&
      (statusFilter === 'all' || rule.status === statusFilter) &&
      (!term || [rule.id, rule.name, ...rule.clauses.flatMap(clause => clause.criteria.map(c => c.label))]
        .some(value => String(value).toLocaleLowerCase('zh-CN').includes(term))));
    count.textContent = '显示 ' + visible.length + ' / ' + result.rules.length + ' 项';
    list.replaceChildren(...(visible.length ? visible.map(rule => ruleCard(rule, repaint)) : [empty('没有匹配的因子', '换一个关键词或筛选条件。')]));
  }
  search.addEventListener('input', () => { query = search.value; repaint(); });
  status.addEventListener('change', () => { statusFilter = status.value || 'all'; repaint(); });
  repaint();
  return [
    heading('因子校验', '展开规则查看判定依据。可计算的条件使用录入数据，其余条件可逐项标记。', [
      link('补录数据', 'input'), link('查看分析结果', 'overview', 'primary')
    ]),
    caseBanner(),
    el('div', { class: 'rule-toolbar' }, groups,
      el('div', { class: 'filter-fields' }, search, status), count),
    list
  ];
}

function persistRecords(next) {
  if (!saveRecords(next)) {
    notify('更改未写入，请先导出已有记录或检查浏览器存储。', 'error');
    return false;
  }
  records = next;
  return true;
}

function editRecord(record) {
  const outcome = el('input', { name: 'outcomePct', type: 'number', min: '-100', max: '10000', step: 'any', placeholder: '未记录' });
  outcome.value = record.outcomePct ?? '';
  const note = el('textarea', { name: 'note', rows: 3, maxlength: 2000, placeholder: '记录计划、原始证据及实际观察' });
  note.value = record.note || '';
  const raw = JSON.stringify(record, null, 2);
  const savedReasons = [...new Set([...(record.environment.reasons || []), ...(record.advice.reasons || [])])];
  const form = el('form', { class: 'record-form', onSubmit: event => {
    event.preventDefault();
    const updated = { ...record, outcomePct: outcome.value === '' ? null : Number(outcome.value), note: note.value.trim() };
    if (persistRecords(records.map(item => item.id === record.id ? updated : item))) {
      render();
      document.querySelector('#record-edit h2')?.focus();
      notify('复盘结果已更新');
    }
  } },
  labelField('实际观察涨跌幅（%）', outcome, '按自己的观察周期手工填写。'),
  labelField('复盘笔记', note),
  el('div', { class: 'actions' },
    el('button', { type: 'submit', class: 'button primary' }, '保存复盘结果'),
    button('载入此案例', () => {
      if (!window.confirm('载入会替换当前未保存的录入，是否继续？')) return;
      draft = { case: normalizeCase(record.case), demo: record.demo };
      updateDraft();
      location.hash = 'overview';
    }),
    button('下载此条记录', () => downloadText('复盘-' + (record.case.stock.code || '案例') + '.json', raw, 'application/json')),
    button('删除', () => {
      if (window.confirm('删除这条复盘记录？') && persistRecords(records.filter(item => item.id !== record.id))) {
        activeRecord = null;
        render();
        notify('已删除');
      }
    }, 'quiet danger')));
  const editor = panel('复盘明细', [
    el('dl', { class: 'mini-values' },
      el('div', {}, el('dt', {}, '保存时的环境'), el('dd', {}, record.environment.label)),
      el('div', {}, el('dt', {}, '保存时的开仓条件'), el('dd', {}, record.advice.label))),
    record.strategies.length && el('p', { class: 'body-caption' }, '匹配：' + record.strategies.join('、')),
    record.risks.length && el('p', { class: 'body-caption amber' }, '风险：' + record.risks.join('、')),
    savedReasons.length && el('details', { class: 'advanced-fields saved-reasons' },
      el('summary', {}, '保存时的判断依据'), reasonList(savedReasons)),
    form
  ], el('div', { class: 'actions' }, record.demo && tag('模拟案例', 'warn'), button('返回统计', () => {
    activeRecord = null;
    render();
  }, 'quiet')));
  editor.id = 'record-edit';
  editor.querySelector('h2').tabIndex = -1;
  return editor;
}

function historyView() {
  const visible = records.filter(record => historyFilter === 'all' || (historyFilter === 'demo' ? record.demo : !record.demo));
  const selected = visible.find(record => record.id === activeRecord);
  const completed = visible.filter(record => Number.isFinite(record.outcomePct));
  const mean = completed.length ? completed.reduce((sum, record) => sum + record.outcomePct, 0) / completed.length : null;
  const stats = el('div', { class: 'metric-grid history-metrics' },
    metric('已保存', fmt(visible.length), visible.some(record => record.demo) ? '含已标记的模拟案例' : '当前筛选下的记录', 'cyan'),
    metric('已填写观察结果', fmt(completed.length), '仅统计手工录入的结果', 'cyan'),
    metric('观察均值', mean === null ? '待填写' : signedPct(mean), '等权算术平均', signedTone(mean)));
  const filter = optionField([['real', '手工案例'], ['demo', '模拟案例']], historyFilter === 'all' ? '' : historyFilter, '全部案例');
  filter.setAttribute('aria-label', '筛选复盘记录');
  filter.addEventListener('change', () => {
    historyFilter = filter.value || 'all';
    render();
    main.querySelector('[aria-label="筛选复盘记录"]')?.focus();
  });
  const remaining = visible.length ? el('div', { class: 'record-list' }, visible.map(record =>
    el('button', { type: 'button', class: 'record-row ' + (record.id === activeRecord ? 'selected' : ''),
      'aria-pressed': String(record.id === activeRecord), onClick: () => {
        activeRecord = record.id;
        render();
        document.querySelector('#record-edit h2')?.focus();
      } },
      el('div', {},
        el('strong', {}, record.case.stock.name || record.case.stock.code || '未命名案例'),
        el('small', {}, [record.case.stock.code, record.case.stock.day, safeTime(record.savedAt)].filter(Boolean).join(' · '))),
      el('div', { class: 'record-labels' }, record.demo && tag('模拟', 'warn'),
        tag(record.advice.label, tone[record.advice.status]),
        Number.isFinite(record.outcomePct) && tag(signedPct(record.outcomePct), signedTone(record.outcomePct)))))) :
    empty('还没有复盘记录', '录入并校验证据后，可在分析总览保存案例。', link('去录入', 'input'));
  return [
    heading('复盘记录', '保留当时的输入和判定，支持补填实际观察结果。导出文件可用于备份。',
      visible.length ? [
        button('导出 CSV', () => downloadText('短线复盘-' + day() + '.csv', recordsToCSV(visible), 'text/csv')),
        button('导出 JSON', () => downloadText('短线复盘-' + day() + '.json', recordsToJSON(visible), 'application/json'))
      ] : []),
    stats,
    el('div', { class: 'dashboard-grid' },
      panel('案例列表', remaining, filter),
      selected ? editRecord(selected) : panel('近期观察结果', reviewBars(visible)))
  ];
}

function render() {
  const current = location.hash.slice(1);
  const page = Object.hasOwn(pageLabels, current) ? current : 'overview';
  const moved = activePage && activePage !== page;
  activePage = page;
  breadcrumb.textContent = '研究台 / ' + pageLabels[page];
  document.title = pageLabels[page] + ' · 天枢智策';
  for (const item of navigation) {
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  const views = { overview, input: inputView, rules: rulesView, history: historyView };
  main.replaceChildren(...views[page]().filter(Boolean));
  if (moved) {
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  }
}
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  main.querySelector('h1')?.focus();
});
window.addEventListener('hashchange', render);
render();
