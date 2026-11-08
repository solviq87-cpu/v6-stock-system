/* V6 factor catalog: only user-visible observed evidence, no fabricated scores. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.V6FactorEvidence = api;
  const doc = root.document;
  const dialog = doc.getElementById('factor-catalog-dialog');
  const toggle = doc.getElementById('factor-catalog-toggle');
  const close = doc.getElementById('factor-catalog-close');
  if (!dialog || !toggle || !close) return;
  let factors = [], selected = null;
  const title = doc.getElementById('factor-stock-state');
  const list = doc.getElementById('factor-catalog-items');
  const node = (tag, cls, value) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = String(value ?? '');
    return el;
  };
  const render = () => {
    title.textContent = selected ? '当前标的：' + String(selected.name || selected.code || selected.symbol || '未命名') + ' · 分数须有来源与时间戳' : '请选择排行榜中的股票，核对因子证据。';
    list.replaceChildren();
    for (const factor of factors) {
      const check = api.evaluateFactor(selected, factor);
      const item = node('article', 'factor-entry', '');
      item.dataset.state = check.state;
      item.setAttribute('role','listitem');
      item.append(
        node('b','',factor.label),
        node('small','',factor.group + ' · ' + factor.id),
        node('strong','factor-value',check.score === null ? '未验证' : check.score.toFixed(1) + ' / 100'),
        node('small','',check.state === 'verified' ? '近15分钟有效证据' : check.state === 'historical' ? '历史证据（不得当作实时）' : '无有效证据'),
        node('span','factor-proof',check.reason || (check.source + ' · ' + new Date(check.timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})))
      );
      list.appendChild(item);
    }
    if (!factors.length) list.textContent = '因子清单未加载，不能显示推测分数。';
  };
  toggle.addEventListener('click', () => { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open',''); render(); });
  close.addEventListener('click', () => dialog.close ? dialog.close() : dialog.removeAttribute('open'));
  dialog.addEventListener('click', ev => { if (ev.target === dialog && ev.offsetY < 0) dialog.close(); });
  root.addEventListener('v6:stock-selected', ev => { selected = ev.detail; if (dialog.open) render(); });
  root.fetch('/assets/v6-extended-factors.json',{cache:'no-store'})
    .then(r => {if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(d => {if(!Array.isArray(d.factors)||d.factors.length!==15)throw new Error('因子数量与仓库不一致');factors=d.factors;render();})
    .catch(() => {factors=[];render();});
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  function evaluateFactor(stock, factor, now=Date.now()) {
    const no=(reason)=>({state:'unverified',score:null,source:null,timestamp:null,reason});
    if (!stock || !factor || !factor.field) return no('未选择有效股票');
    if (stock.isMock === true || stock.simulated === true || stock.mode === 'simulation') return no('模拟数据不能作为因子证据');
    const proof = stock.factorEvidence?.[factor.field];
    if (!proof || typeof proof !== 'object' || !proof.source || proof.simulated === true || proof.mode === 'simulation') return no('缺少非模拟且可追溯的因子来源');
    if (proof.code && String(proof.code).replace(/[^0-9]/g,'').slice(-6) !== String(stock.code||stock.symbol||'').replace(/[^0-9]/g,'').slice(-6)) return no('因子证据与股票代码不匹配');
    const raw = stock[factor.field] ?? stock.extendedFactors?.signals?.find(s=>s.id===factor.id)?.score;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw<0 || raw>100) return no('未提供0—100范围内的有效因子分数');
    const stamp = typeof proof.timestamp === 'number' ? proof.timestamp : Date.parse(proof.timestamp);
    if (!Number.isFinite(stamp) || stamp>now+60000) return no('因子时间戳不存在或处于未来');
    const age = now-stamp;
    return {state:age<=15*60*1000?'verified':'historical',score:raw,source:String(proof.source),timestamp:stamp,reason:''};
  }
  return {evaluateFactor};
});