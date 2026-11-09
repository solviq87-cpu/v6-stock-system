(() => {
  'use strict';
  // A client-side projection of the EXISTING cached selection endpoint. No orders,
  // scanning "force", persistence, or browser-owned portfolio authority.
  const $ = id => document.getElementById(id);
  const state = { items: [], hasData: false, lastRefresh: 0, requestId: 0, controller: null };
  const number = value => {
    if (value === null || value === undefined || value === '' ||
        typeof value === 'boolean' || typeof value === 'object') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const node = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  const authToken = () => {
    try { return localStorage.getItem('qd_device') || localStorage.getItem('qd_token') || ''; }
    catch (_) { return ''; }
  };
  const status = (message, kind = '') => {
    $('status').textContent = message;
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  };
  const displayDay = response => {
    // Snapshot day and candidate generation time are NEVER quote provenance.
    const day = response?.snapshotDay || response?.tradeDate || response?.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : '未知';
  };
  const fmtPercent = raw => {
    const p = number(raw);
    return p === null ? '涨跌未知' : (p > 0 ? '+' : '') + p.toFixed(2) + '%';
  };
  const reasonRows = item => {
    const raw = Array.isArray(item.hit) ? item.hit : Array.isArray(item.reasons) ? item.reasons : [];
    return raw.slice(0, 30).map(value => {
      if (typeof value === 'string') return value.trim().slice(0, 220);
      if (!value || typeof value !== 'object') return '';
      const id = value.id == null ? '' : '条件' + String(value.id).slice(0, 18) + ' · ';
      const detail = value.text || value.reason || '';
      return (id + String(detail).slice(0, 220)).trim();
    }).filter(Boolean);
  };
  const formatAt = at => {
    if (typeof at !== 'string' && typeof at !== 'number') return '';
    const date = new Date(at);
    return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  };
  const showItem = item => {
    const card = node('article', 'pick');
    const head = node('div', 'pickhead');
    const title = node('div', 'picktitle');
    title.append(node('span', '', item.name || '名称未知'));
    title.append(node('span', 'code', item.code || item.symbol || '代码未知'));
    head.append(title);
    const score = number(item.score ?? item.finalScore);
    const scoreBox = node('div', 'score', score === null ? '—' : score.toFixed(1));
    scoreBox.append(node('small', '', ' 分'));
    head.append(scoreBox);
    card.append(head);

    const tags = node('div', 'rowmeta');
    const pct = number(item.pct ?? item.changePct);
    tags.append(node('span', 'tag ' + (pct === null ? 'flat' : pct > 0 ? 'gain' : pct < 0 ? 'loss' : 'flat'), fmtPercent(item.pct ?? item.changePct)));
    tags.append(node('span', 'tag', item.sector ? '板块 ' + item.sector : '板块未知'));
    tags.append(node('span', 'tag', item.strategyName || item.strategy || '策略归属待核验'));
    const risk = item.riskStatus || item.risk?.status || item.risk?.level || item.riskLevel;
    tags.append(node('span', 'tag', risk ? '风险 ' + risk : '风险未评估'));
    card.append(tags);

    const reasons = reasonRows(item);
    card.append(node('div', 'muted', '命中条件（原接口返回）'));
    if (!reasons.length) {
      card.append(node('p', 'muted', '暂无可核实的条件解释，不能视作已命中。'));
    } else {
      const first = node('ul', 'reason');
      for (const reason of reasons.slice(0, 2)) first.append(node('li', '', reason));
      card.append(first);
      if (reasons.length > 2) {
        const more = document.createElement('details');
        more.append(node('summary', 'muted', '展开剩余 ' + (reasons.length - 2) + ' 条条件'));
        const list = node('ul', 'reason');
        for (const reason of reasons.slice(2)) list.append(node('li', '', reason));
        more.append(list);
        card.append(more);
      }
    }
    const quoteAt = item.vendorQuoteAt || item.quoteAt;
    const quoteTime = formatAt(quoteAt);
    card.append(node('p', 'footnote', quoteTime ?
      '第三方自报报价时点：' + quoteTime + ' · 未经交易所实时性认证' :
      '逐票报价原始时点：未知（不能当实时价）'));
    const link = node('a', '', '查看策略研究与详细风控');
    link.href = '/research.html#decisionWorkspace';
    card.append(link);
    return card;
  };
  const render = () => {
    const search = $('search').value.trim().toLowerCase();
    const sort = $('sort').value;
    const items = state.items.filter(x =>
      !search || String(x.code || x.symbol || '').includes(search) ||
      String(x.name || '').toLowerCase().includes(search)
    );
    if (sort !== 'original') {
      const field = sort === 'pct' ? x => number(x.pct ?? x.changePct) : x => number(x.score ?? x.finalScore);
      items.sort((a, b) => (field(b) ?? -Infinity) - (field(a) ?? -Infinity));
    }
    $('total').textContent = state.hasData ? state.items.length : '—';
    $('visible').textContent = state.hasData ? items.length : '—';
    $('explained').textContent = state.hasData ? state.items.filter(x => reasonRows(x).length > 0).length : '—';
    const root = $('candidates');
    root.replaceChildren();
    if (!state.hasData) { root.append(node('p', 'empty', '尚未取得云端候选结果。')); return; }
    if (!items.length) { root.append(node('p', 'empty', state.items.length ? '没有匹配当前搜索条件的股票。' : '当前候选池为空，没有可展示的股票。')); return; }
    const fragment = document.createDocumentFragment();
    for (const x of items.slice(0, 100)) fragment.append(showItem(x));
    root.append(fragment);
  };
  const load = async () => {
    const id = ++state.requestId;
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    $('reload').disabled = true;
    status('正在从云端读取已有选股结果…');
    const query = new URLSearchParams({ board: $('board').value, max: '40' });
    const token = authToken();
    if (token) query.set('token', token);
    try {
      const response = await fetch('/api/quant-picks?' + query, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('没有只读查看权限，请先到手机速览页登录。');
        throw new Error('接口 HTTP ' + response.status);
      }
      const data = await response.json();
      if (id !== state.requestId) return;
      if (data?.locked === true) throw new Error('当前身份无权查看候选池，请先登录。');
      if (data?.ok === false) throw new Error(String(data.error || data.note || '云端候选数据不可用'));
      if (data?.isMock === true || data?.simulated === true) throw new Error('服务端返回演示数据，已拒绝展示为真实选股');
      if (!Array.isArray(data?.items)) throw new Error('候选接口未返回有效列表');
      state.items = data.items.filter(x => x && typeof x === 'object').slice(0, 100);
      state.hasData = true;
      state.lastRefresh = Date.now();
      $('day').textContent = displayDay(data);
      $('cloudSync').textContent = '客户端最近成功读取：' + new Date(state.lastRefresh).toLocaleTimeString('zh-CN', { hour12: false }) + ' · 这不是股票报价时间';
      status('云端已返回 ' + state.items.length + ' 只研究候选。' +
        (data.isSnapshot ? ' 休市或历史快照，不触发新的买卖信号。' : '') +
        ' 逐票报价时效未统一认证。', data.isSnapshot ? 'warn' : '');
      render();
    } catch (error) {
      if (id !== state.requestId || error.name === 'AbortError') return;
      status((state.hasData ? '云端暂时不可用，保留本页上次读取结果（非实时）。' : '云端读取失败。') +
        ' ' + String(error.message || error), 'error');
      render();
    } finally {
      if (id === state.requestId) $('reload').disabled = false;
    }
  };
  $('reload').addEventListener('click', load);
  $('board').addEventListener('change', load);
  $('search').addEventListener('input', render);
  $('sort').addEventListener('change', render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastRefresh > 15000) load();
  });
  window.addEventListener('pageshow', () => {
    if (!document.hidden && state.lastRefresh && Date.now() - state.lastRefresh > 15000) load();
  });
  window.setInterval(() => {
    if (!document.hidden && Date.now() - state.lastRefresh >= 60000) load();
  }, 60000);
  load();
})();