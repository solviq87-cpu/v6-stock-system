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
})();
