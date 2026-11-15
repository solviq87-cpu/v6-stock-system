/* Navigation presentation only: no data requests, account storage, or automatic actions. */
(function () {
  'use strict';
  const indicators = document.querySelectorAll('[data-workspace-connection]');
  function reflectConnection() {
    const offline = navigator.onLine === false;
    indicators.forEach(node => {
      node.dataset.offline = String(offline);
      node.textContent = offline ? '网络已断开 · 现有内容不作实时依据' : '数据时间与状态见各卡片';
    });
  }
  reflectConnection();
  window.addEventListener('online', reflectConnection);
  window.addEventListener('offline', reflectConnection);
  document.querySelectorAll('.workspace-more').forEach(menu => {
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.open) return;
      menu.open = false;
      menu.querySelector('summary').focus();
      event.stopPropagation();
    });
    menu.addEventListener('click', event => {
      if (event.target.closest('a')) menu.open = false;
    });
  });

  // Keep every controller and draft mounted. Functional navigation changes
  // visibility only; it never runs a read, scan, collection or account action.
  const nav = document.querySelector('.workspace-section-nav');
  const context = document.getElementById('researchContext');
  if (!nav || !context || context.parentElement?.tagName !== 'MAIN') return;
  const main = context.parentElement;
  const definitions = [
    { key:'decision', label:'研究决策', anchor:'decisionWorkspace',
      targets:['decisionWorkspace','liveBreadth','liveMarketResearch','marketResearch'] },
    { key:'records', label:'研究记录', anchor:'researchWorkspace',
      targets:['researchWorkspace','researchEvidence'] },
    { key:'data', label:'行情与记忆', anchor:'stockCapture',
      targets:['stockCapture','linkedIntelligence'] },
    { key:'strategy', label:'策略与因子', anchor:'factorAgentHeading',
      targets:['factorAgentHeading','adaptiveHeading','learningWorkbench','ruleComparison','research36Workspace'] },
    { key:'account', label:'账户与回测', anchor:'completeHeading',
      targets:['completeHeading','authorityHeading','riskCenter','capabilities','status','summary','results'] },
    { key:'news', label:'新闻证据', anchor:'newsEvidence', targets:['newsEvidence'] }
  ];
  function mainChild(element) {
    while (element && element.parentElement !== main) element = element.parentElement;
    return element;
  }
  // The same credential input is used by several modules. Keep it available
  // above the filters, including when its original data-input panel is closed.
  const credential = document.getElementById('token');
  const credentialRow = credential?.closest('p');
  if (credentialRow && main.contains(credentialRow)) {
    const access = document.createElement('div');
    access.className = 'ow-research-access';
    access.append(credentialRow);
    nav.before(access);
  }
  const groups = new Map();
  for (const definition of definitions) {
    const nodes = new Set(definition.targets.map(id => mainChild(document.getElementById(id))).filter(Boolean));
    // The original data-input card still owns the payload/scanning controls.
    if (definition.key === 'account') {
      const inputCard = mainChild(document.getElementById('payload'));
      if (inputCard) nodes.add(inputCard);
    }
    if (!nodes.size) continue;
    const panel = document.createElement('div');
    panel.className = 'ow-research-group';
    panel.dataset.owResearchGroup = definition.key;
    panel.id = 'ow-research-' + definition.key;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', definition.label);
    main.append(panel);
    for (const node of nodes) panel.append(node);
    const link = document.createElement('a');
    link.href = '#' + definition.anchor;
    link.textContent = definition.label;
    link.dataset.owResearchTarget = definition.key;
    link.setAttribute('aria-controls', panel.id);
    groups.set(definition.key, { ...definition, panel, link });
  }
  if (!groups.size) return;
  nav.replaceChildren(...[...groups.values()].map(group => group.link));
  const filter = document.createElement('div');
  filter.className = 'ow-research-filter';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'ow-research-all';
  all.textContent = '全部工具';
  all.setAttribute('aria-pressed', 'true');
  const status = document.createElement('span');
  status.className = 'ow-research-filter-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  filter.append(all, status);
  nav.after(filter);
  let active = null;
  function select(key) {
    active = groups.has(key) ? key : null;
    for (const [id, group] of groups) {
      group.panel.hidden = active !== null && id !== active;
      if (active === id) group.link.setAttribute('aria-current', 'location');
      else group.link.removeAttribute('aria-current');
    }
    all.setAttribute('aria-pressed', String(active === null));
    status.textContent = active === null ? '全部 ' + groups.size + ' 个研究分区' : groups.get(active).label + ' · 其他工具可随时切换';
  }
  function reveal(target) {
    const group = [...groups.values()].find(item => item.panel.contains(target));
    if (group) select(group.key);
    else if (target === context || context.contains(target)) select(null);
    if (target) for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    return group;
  }
  function followHash(scroll) {
    let target;
    try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch (_) { return; }
    if (!target) return;
    reveal(target);
    if (scroll) target.scrollIntoView({ block:'start', behavior:'auto' });
  }
  all.addEventListener('click', () => {
    select(null);
    // Give back/forward a concrete location for the complete view.
    if (window.location.hash !== '#researchContext') window.location.hash = 'researchContext';
  });
  // Reveal before existing context-button handlers focus their target input.
  const contextTargets = { workspace:'researchWorkspace', capture:'stockCapture', news:'newsEvidence',
    memory:'linkedIntelligence', public:'linkedIntelligence', rules:'research36Workspace' };
  document.addEventListener('click', event => {
    const contextButton = event.target.closest('[data-research-target]');
    if (contextButton && !contextButton.disabled) {
      reveal(document.getElementById(contextTargets[contextButton.dataset.researchTarget]));
      return;
    }
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || !url.hash) return;
    let target;
    try { target = document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch (_) { return; }
    if (target) reveal(target);
  }, true);
  nav.addEventListener('keydown', event => {
    const links = [...groups.values()].map(group => group.link);
    const index = links.indexOf(event.target);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? (index + 1) % links.length :
      event.key === 'ArrowLeft' ? (index + links.length - 1) % links.length :
      event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    links[next].focus();
  });
  window.addEventListener('hashchange', () => followHash(true));
  select(null);
  followHash(false);
})();
