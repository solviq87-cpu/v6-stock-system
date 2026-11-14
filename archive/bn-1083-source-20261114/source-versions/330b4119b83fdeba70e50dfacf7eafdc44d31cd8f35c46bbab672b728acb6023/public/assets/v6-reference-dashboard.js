(() => {
  'use strict';
  const date = document.getElementById('trade-date');
  const update = () => {
    if (!date) return;
    date.textContent = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()) + ' · A股行情';
  };
  update(); window.setInterval(update,1000);
})();
