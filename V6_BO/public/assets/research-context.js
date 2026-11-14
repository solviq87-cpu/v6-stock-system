(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 if (root.document) {
  root.V6ResearchContext = api;
  api.mount(root);
 }
})(typeof window === 'object' ? window : globalThis, function () {
 'use strict';
 const providers = new Set(['eastmoney', 'tencent']);
 const targets = Object.freeze({
  workspace: { section: 'researchWorkspace', input: 'workspaceSymbol' },
  capture: { section: 'stockCapture', input: 'captureSymbol' },
  news: { section: 'newsEvidence', input: 'newsEvidenceSymbol' },
  memory: { section: 'linkedIntelligence', input: 'linkedMemorySymbol' },
  public: { section: 'linkedIntelligence', input: 'linkedPublicSymbol' },
  rules: { section: 'research36Workspace', input: 'research36Symbol' }
 });
 const symbolInputs = ['workspaceSymbol', 'captureSymbol', 'newsEvidenceSymbol',
  'linkedMemorySymbol', 'linkedPublicSymbol', 'research36Symbol'];
 const providerInputs = ['workspaceProvider', 'captureProvider'];
 function normalizeContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.symbol !== 'string' || !/^\d{6}$/.test(value.symbol)) return null;
  if (value.provider !== undefined && value.provider !== '' && !providers.has(value.provider)) return null;
  return { symbol: value.symbol, ...(providers.has(value.provider) ? { provider: value.provider } : {}) };
 }
 function readContext(search = '', hash = '') {
  if (typeof search !== 'string' || search.length > 1024 || typeof hash !== 'string') return null;
  const query = new URLSearchParams(search);
  if (query.getAll('symbol').length !== 1 || query.getAll('provider').length > 1) return null;
  const context = normalizeContext({ symbol: query.get('symbol'), provider: query.get('provider') || undefined });
  if (!context) return null;
  const target = !hash ? 'workspace' : Object.keys(targets).find(key => '#' + targets[key].section === hash);
  return target ? { ...context, target } : null;
 }
 function researchHref(symbol, provider) {
  if (typeof symbol !== 'string' || !/^\d{6}$/.test(symbol)) return '/research.html#researchWorkspace';
  const query = new URLSearchParams({ symbol });
  if (providers.has(provider)) query.set('provider', provider);
  return '/research.html?' + query + '#researchWorkspace';
 }
 function mount(root) {
  const doc = root.document, $ = id => doc.getElementById(id), strip = $('researchContext');
  if (!strip || strip.dataset.contextMounted === 'true') return null;
  strip.dataset.contextMounted = 'true';
  const form = $('researchContextForm'), input = $('researchContextSymbol'), provider = $('researchContextProvider');
  const status = $('researchContextStatus'), current = $('researchContextCurrent');
  let context = null;
  const buttons = Array.from(strip.querySelectorAll('[data-research-target]'));
  function historicalNote() {
   return $('workspaceAsOf')?.value ? ' · 研究记录保留历史时点；新闻、记忆和采集各按自身证据日期查看' : '';
  }
  function sync() {
   current.textContent = context ? '联动股票 ' + context.symbol +
    (context.provider === 'tencent' ? ' · 腾讯' : context.provider === 'eastmoney' ? ' · 东方财富' : '') : '尚未选择股票';
   for (const button of buttons) {
    const target = targets[button.dataset.researchTarget];
    button.disabled = !context || !target || !$(target.input);
   }
   $('researchContextClear').disabled = !context && !input.value;
  }
  function draftNote() {
   const count = context ? symbolInputs.filter(id => $(id) && $(id).value !== context.symbol).length : 0;
   return count ? ' · 有 ' + count + ' 个分区代码不同；分区按钮只带入目标分区' : '';
  }
  function apply(value) {
   const next = normalizeContext(value);
   if (!next || doc.hidden) {
    status.textContent = '请输入六位股票代码，来源只支持腾讯或东方财富。';
    return false;
   }
   // Fill every participating input before emitting invalidation events. No
   // listener can observe half of a stock switch, and no action is clicked.
   const changed = [];
   for (const id of symbolInputs) {
    const element = $(id);
    if (element && element.value !== next.symbol) { element.value = next.symbol; changed.push(element); }
   }
   if (next.provider) for (const id of providerInputs) {
    const element = $(id);
    if (element && element.value !== next.provider) { element.value = next.provider; changed.push(element); }
   }
   context = next; input.value = next.symbol; provider.value = next.provider || '';
   for (const element of changed) element.dispatchEvent(new root.Event('input', { bubbles: true }));
   status.textContent = '代码已带入各分区；点击分区内的读取或采集按钮后才会请求数据。' + historicalNote();
   sync(); return true;
  }
  function clear(reason = '股票选择已清除。', wipe = false) {
   const old = context?.symbol;
   context = null; input.value = ''; provider.value = '';
   if (wipe && old) {
    const changed = [];
    for (const id of symbolInputs) {
     const element = $(id);
     // Keep a separately edited module draft instead of erasing unrelated work.
     if (element?.value === old) { element.value = ''; changed.push(element); }
    }
    for (const element of changed) element.dispatchEvent(new root.Event('input', { bubbles: true }));
   }
   status.textContent = reason; sync();
  }
  function focusTarget(key) {
   const target = targets[key];
   if (!context || doc.hidden || !target || !$(target.input)) return false;
   // A targeted intent only repairs that panel. Other independently edited
   // stock drafts and frozen runs are not reset merely to open news or memory.
   const updates = [[target.input, context.symbol]];
   if (context.provider && key === 'workspace') updates.push(['workspaceProvider', context.provider]);
   if (context.provider && key === 'capture') updates.push(['captureProvider', context.provider]);
   const changed = [];
   for (const [id, value] of updates) {
    const element = $(id);
    if (element && element.value !== value) { element.value = value; changed.push(element); }
   }
   for (const element of changed) element.dispatchEvent(new root.Event('input', { bubbles: true }));
   const focus = $(target.input), section = $(target.section) || focus;
   for (let parent = focus.parentElement; parent; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
   section.scrollIntoView?.({ block: 'start', behavior: 'auto' });
   focus.focus({ preventScroll: true });
   status.textContent = '已定位该分区；点击分区内的读取或采集按钮后才会请求数据。' + historicalNote() + draftNote();
   return true;
  }
  form.addEventListener('submit', event => {
   event.preventDefault();
   if (!apply({ symbol: input.value.trim(), provider: provider.value })) input.focus();
  });
  input.addEventListener('input', sync);
  $('researchContextClear').addEventListener('click', () => clear('股票选择已清除；各分区仍需显式读取。', true));
  for (const button of buttons) button.addEventListener('click', () => focusTarget(button.dataset.researchTarget));
  for (const id of symbolInputs) $(id)?.addEventListener('input', () => {
   if (context) status.textContent = '联动股票选择保留；各分区仍需显式读取。' + historicalNote() + draftNote();
  });
  root.addEventListener('v6:research-context', event => apply(event.detail));
  // The selection never contains a token, account, run, forecast or response.
  // Other modules own their private-result invalidation; retain their public
  // input drafts on lifecycle/auth changes so authentication does not lose a pick.
  for (const event of ['input', 'change']) $('token')?.addEventListener(event,
   () => clear('认证输入已变化，联动选择已清除；各分区代码保留，请重新读取。'));
  root.addEventListener('offline', () => clear('网络离线，联动选择已清除。'));
  root.addEventListener('pagehide', () => clear('页面已离开，联动选择已清除。'));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clear('页面隐藏，联动选择已清除。'); });
  $('workspaceAsOf')?.addEventListener('input', () => {
   if (context) status.textContent = '代码选择保留；请核对各分区的证据日期。' + historicalNote();
  });
  sync();
  const initial = readContext(root.location?.search || '', root.location?.hash || '');
  if (initial) apply(initial);
  // Initial links only prefill public identity. No read, capture, POST, URL
  // rewrite, browser storage or synthetic "capture completed" event occurs.
  return { apply, clear, focusTarget, get context() { return context ? { ...context } : null; } };
 }
 return { normalizeContext, readContext, researchHref, mount, targets };
});
