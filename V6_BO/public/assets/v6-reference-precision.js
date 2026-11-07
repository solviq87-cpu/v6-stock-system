/* Bind reference dashboard summary tiles to existing live DOM state. No synthetic quote values. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const textOf = id => {
    const el = byId(id);
    return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };
  const set = (id, value, fallback) => {
    const el = byId(id);
    if (el) el.textContent = value || fallback;
  };
  function sync() {
    const market = textOf('mkt');
    const tick = textOf('tickinfo');
    const mood = textOf('moodBox');
    const pool = textOf('poolInfo');
    const strategy = textOf('strategySummary');
    set('v6RefMarket', market, '未连接');
    set('v6RefMarketNote', tick, '等待行情服务状态');
    set('v6RefMood', mood, '等待真实情绪数据');
    set('v6RefPool', pool, '等待选股池数据');
    set('v6RefPoolNote', textOf('pool').split('\n').slice(0, 2).join(' ').slice(0, 56), '尚无候选数据');
    set('v6RefStrategy', strategy.slice(0, 42), '等待策略接口');
    const now = new Date();
    set('v6RefDate', new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now) + '（北京时间）', '时间待同步');
    set('v6RefConnection', market || '行情连接状态待服务端确认', '行情连接状态待服务端确认');
  }
  document.addEventListener('DOMContentLoaded', () => {
    sync();
    ['mkt','tickinfo','moodBox','poolInfo','pool','strategySummary'].forEach(id => {
      const el = byId(id);
      if (el && typeof MutationObserver !== 'undefined') new MutationObserver(sync).observe(el, { childList: true, subtree: true, characterData: true });
    });
    window.setInterval(sync, 5000);
  }, { once: true });
})();
