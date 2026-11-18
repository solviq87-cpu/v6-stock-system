/* Presentation only. Hidden sections keep their original controllers and permission gates. */
(() => {
  'use strict';
  function start() {
    const desktop = document.body.classList.contains('desktop-workspace');
    const dashboard = document.getElementById('vx-dashboard');
    if (!dashboard) return;

    // Deep links select the original module, rather than sending the user down
    // a document containing every account, research and administration form.
    if (desktop) {
      const modules = [...document.querySelectorAll('.workspace-module')];
      const directory = document.querySelector('.workspace-directory');
      const settings = document.getElementById('workspace-settings');
      const health = document.querySelector('.v6-ui-health');
      if (settings && health) settings.append(health);
      const heading = document.createElement('header');
      heading.className = 'ow-module-heading';
      heading.innerHTML = '<span class="ow-eyebrow">TIANSHU / WORKSPACE</span><h1></h1><a href="#vx-dashboard">← 返回市场工作台</a>';
      heading.hidden = true;
      dashboard.after(heading);
      function navigate() {
        let target;
        try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (_) {}
        const active = target?.closest('.workspace-module');
        // A deep link can target a card inside a collapsed legacy section.
        // Open its ancestor details and scroll only after its module is shown.
        if (target && active) {
          for (let p = target.parentElement; p; p = p.parentElement) {
            if (p.tagName === 'DETAILS') p.open = true;
            if (p === active) break;
          }
        }
        dashboard.hidden = !!active;
        heading.hidden = !active;
        if (active) heading.querySelector('h1').textContent = active.getAttribute('aria-label') || '工作台';
        modules.forEach(node => { node.hidden = !!active ? node !== active : true; });
        if (directory) directory.hidden = active !== settings;
        if (active && target) requestAnimationFrame(() => target.scrollIntoView({block:'start',behavior:'auto'}));
        document.querySelectorAll('.vx-sidebar>a,.vx-mainnav>a').forEach(link => {
          let node;
          try { node = document.getElementById(link.hash.slice(1)); } catch (_) {}
          const current = active ? node?.closest('.workspace-module') === active : link.hash === '#vx-dashboard';
          if (current) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
        });
      }
      navigate();
      addEventListener('hashchange', navigate);
    }

    const providerLinks = document.getElementById('vx-provider-links');
    if (providerLinks) {
      const disclosure = document.createElement('details');
      disclosure.className = 'ow-provider-details';
      const summary = document.createElement('summary');
      summary.textContent = '外部行情参考';
      providerLinks.before(disclosure);
      disclosure.append(summary, providerLinks);
    }

    // The chart and short explanation stay visible. Longer evidence is one
    // navigable tray so five empty cards never occupy the whole right column.
    const detail = dashboard.querySelector('.vx-detail-column');
    const definitions = [
      ['vx-condition-panel','命中条件'], ['vx-issuer-panel','公司公告'],
      ['vx-pattern-panel','形态研究'], ['vx-research-panel','研究预演']
    ];
    if (detail) {
      const tray = document.createElement('section');
      tray.className = 'ow-evidence-tray';
      tray.setAttribute('aria-label','所选股票的研究证据');
      const nav = document.createElement('div');
      nav.className = 'ow-detail-nav';
      nav.setAttribute('role','tablist');
      nav.setAttribute('aria-label','研究证据分类');
      const panels = [];
      definitions.forEach(([id,label], index) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'ow-tab-' + id;
        button.textContent = label;
        button.setAttribute('role','tab');
        button.setAttribute('aria-controls', id);
        panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',button.id);
        panel.classList.add('ow-detail-panel');
        panels.push([button,panel]);
        nav.append(button);
      });
      function activate(index, focus) {
        panels.forEach(([button,panel],i) => {
          button.setAttribute('aria-selected', String(i === index));
          button.tabIndex = i === index ? 0 : -1;
          panel.hidden = i !== index;
        });
        if (focus) panels[index][0].focus();
      }
      panels.forEach(([button],index) => button.addEventListener('click',() => activate(index,false)));
      nav.addEventListener('keydown', event => {
        const index = panels.findIndex(([button]) => button === event.target);
        if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
        activate(next,true);
      });
      tray.append(nav, ...panels.map(([,panel]) => panel));
      detail.append(tray);
      if (panels.length) activate(0,false);
    }

    const banner = document.getElementById('ow-snapshot-banner');
    function showSnapshot(data) {
      if (!banner) return;
      // Dates originate at the server snapshot boundary, never from a refresh
      // clock: a Sunday HTTP success cannot make Friday's price live.
      const rawDay = typeof data?.snapshotDay === 'string' ? data.snapshotDay : '';
      const day = /^\d{8}$/.test(rawDay) ? rawDay.slice(0,4)+'-'+rawDay.slice(4,6)+'-'+rawDay.slice(6,8) : /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : '';
      const retained = data?.snapshotRetained === true || data?.trading === false || data?.isSnapshot === true;
      banner.hidden = !data || !retained;
      if (!data || !retained) return;
      banner.textContent = day ? `${data.trading===true?'保留快照':'休市快照'} · ${day}　保留最近交易日行情与股票池，资讯继续更新。` : '当前展示历史快照 · 原始交易日待核验；行情与资讯分别更新时间。';
    }
    showSnapshot(window.__v6Dashboard);
    addEventListener('v6-dashboard-data', event => showSnapshot(event.detail));
    addEventListener('v6-dashboard-offline', () => {
      if (!banner || !window.__v6Dashboard) return;
      banner.hidden = false;
      banner.textContent = '连接暂时中断 · 保留上次成功读取的行情与股票池，当前内容不代表实时。';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();


/* Navigation-only enhancement. Keep the approved index/mobile documents and all
 * business controllers untouched; reuse their existing CSS/JS load points. */
(function(){
 'use strict';
 function attach(){
   // This shell exists only on the two primary original V6 entry pages.
   if(!document.querySelector('.vx-shell')||document.querySelector('script[data-v6-feature-hub-loader]'))return;
   const style=document.createElement('link');
   style.rel='stylesheet';style.href='/assets/feature-hub.css?v=20261117nav1';
   style.setAttribute('data-v6-feature-hub-style','');
   document.head.appendChild(style);
   const script=document.createElement('script');
   script.src='/assets/feature-hub.js?v=20261117nav1';
   script.async=true;script.setAttribute('data-v6-feature-hub-loader','');
   document.head.appendChild(script);
   if(!document.querySelector('script[data-v6-live-home-loader]')){
     const liveStyle=document.createElement('link');
     liveStyle.rel='stylesheet';liveStyle.href='/assets/live-home.css?v=20261117live1';
     document.head.appendChild(liveStyle);
     const liveScript=document.createElement('script');
     liveScript.src='/assets/live-home.js?v=20261117live1';
     liveScript.async=true;liveScript.setAttribute('data-v6-live-home-loader','');
     document.head.appendChild(liveScript);
   }
   if(!document.querySelector('script[data-v6-reference-portal-loader]')){
     const referenceCss=document.createElement('link');
     referenceCss.rel='stylesheet';referenceCss.href='/assets/reference-portal.css?v=20261117ref1';
     referenceCss.setAttribute('data-v6-reference-portal-style','');
     document.head.appendChild(referenceCss);
     const referenceScript=document.createElement('script');
     referenceScript.src='/assets/reference-portal.js?v=20261117ref1';
     referenceScript.async=true;referenceScript.setAttribute('data-v6-reference-portal-loader','');
     document.head.appendChild(referenceScript);
   }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});
 else attach();
})();

/* Preserve the frozen mobile HTML and its login gates. Add a read-only
 * review preview from the SAME mobile digest, never a second market feed. */
(function(){
 'use strict';
 function attachMobileReview(){
  if(!document.body?.classList.contains('mobile-workspace')||
     document.querySelector('script[data-v6-mobile-review-loader]'))return;
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.href='/assets/mobile-review-bridge.css?v=20261118review1';
  style.setAttribute('data-v6-mobile-review-style','');
  document.head.appendChild(style);
  const script=document.createElement('script');
  script.src='/assets/mobile-review-bridge.js?v=20261118review1';
  script.async=true;
  script.setAttribute('data-v6-mobile-review-loader','');
  document.head.appendChild(script);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attachMobileReview,{once:true});
 else attachMobileReview();
})();
