/* Progressive enhancement only: does not alter stock-selection or server permissions. */
(function(){
  'use strict';
  const nav=document.querySelector('.v6-quick-nav');
  if(!nav)return;
  const links=Array.from(nav.querySelectorAll('a[href^="#v6-"]'));
  const targets=links.map(a=>({link:a,target:document.getElementById(a.getAttribute('href').slice(1))})).filter(x=>x.target);
  function mark(id){for(const x of targets){if(x.target.id===id)x.link.setAttribute('aria-current','location');else x.link.removeAttribute('aria-current');}}
  function syncHash(){const id=decodeURIComponent(location.hash.slice(1));if(targets.some(x=>x.target.id===id))mark(id);}
  addEventListener('hashchange',syncHash);
  syncHash();
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      const visible=entries.filter(x=>x.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
      if(visible.length)mark(visible[0].target.id);
    },{rootMargin:'-85px 0px -65% 0px',threshold:0});
    targets.forEach(x=>observer.observe(x.target));
  }
})();
