// Only the public application shell is available offline. Private responses and
// market prices must always come from the server, including after revocation.
const APP_VER = '20261122as';
const CACHE_PREFIX = 'quant-dashboard-m-';
const CACHE_NAME = CACHE_PREFIX + APP_VER + '-source-review-1';
const PRECACHE = ['/', '/m', '/manifest.json', '/nova/mark.svg', '/nova/fayo.css?v=20261122as', '/nova/app.js?v=20261122as', '/nova/client.js', '/nova/ui.js', '/nova/market.js', '/nova/market-evidence.js', '/nova/review-pool.js', '/nova/terminal-workbench.js', '/nova/close-review.js', '/nova/data/close-review-20261120.js', '/nova/tactics-view.js', '/nova/data/tactics.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
    .then(() => self.skipWaiting()));
});

function purgeLegacyCaches() {
  return caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key))));
}

self.addEventListener('activate', event => {
  event.waitUntil(purgeLegacyCaches().then(() => self.clients.claim()));
});

function unavailable() {
  return new Response(JSON.stringify({ok:false, offline:true, error:'offline',
    message:'连接已断开，行情和账户状态不可用，请联网后重新验证身份。'}), {
    status:503, statusText:'Offline',
    headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
  });
}

async function networkOnly(request) {
  try { return await fetch(request, {cache:'no-store'}); }
  catch (_) { return unavailable(); }
  finally {
    // An old worker's in-flight cache.put can complete after activation. Remove
    // that recreated cache after current requests as well; never read it.
    try { await purgeLegacyCaches(); } catch (_) { /* network-only remains enforced */ }
  }
}

async function publicShell(request) {
  try {
    // Revalidate even unchanged resource URLs. A cache-first worker previously
    // kept old CSS/JS alive after a successful server deployment.
    const response = await fetch(request, {cache:'no-store'});
    if (response.status === 200 && response.type !== 'opaque') {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch (_) { /* Storage quota must not replace a fresh response with stale UI. */ }
    }
    return response;
  } catch (_) {
    try {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) || unavailable();
    } catch (_) { return unavailable(); }
  } finally {
    try { await purgeLegacyCaches(); } catch (_) { /* only this version is read */ }
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  // Credentials and source downloads are never offline resources, even when
  // the filename appears static.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/srcpkg/') || request.headers.has('Authorization') || request.headers.has('X-QD-Token') ||
      [...url.searchParams.keys()].some(key => /token|auth|password|sharecode/i.test(key))) {
    event.respondWith(networkOnly(request));
    return;
  }
  const entry = ['/', '/index.html', '/m', '/mobile.html'].includes(url.pathname);
  const asset = /\.(?:html|js|css|png|jpg|jpeg|gif|svg|woff2?|ico)$/.test(url.pathname) ||
    url.pathname === '/manifest.json';
  if (entry || asset) event.respondWith(publicShell(request));
});
