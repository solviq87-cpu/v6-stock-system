// 量化看盘 /m PWA Service Worker（eg 轮）
// 只缓存静态资源；API 和动态数据走 network-first，避免展示 stale 行情。
// ja 轮修正：APP_VER 原硬编码 20261017eo，与 server.js 长期不同步，导致 iz 轮改了 mobile.html 后 PWA 仍返回旧缓存，手机上看不见「所属板块」。_publish.py 已改为 sync 阶段自动同步此处 APP_VER = server.js APP_VER。
const APP_VER = '20261105ag';
const CACHE_NAME = 'quant-dashboard-m-' + APP_VER;

const PRECACHE = [
  '/m',
  '/mobile.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  } catch (e) {
    return new Response('offline', { status: 503, statusText: 'offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('offline', { status: 503, statusText: 'offline' });
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  const pathname = url.pathname;
  // /m /mobile.html 也走 network-first（jd 轮修正）：手机速览页更新频繁，cache-first 会导致用户「收不到更新」。
  // 离线时 networkFirst 内部会 fallback 到缓存，不会完全断网。
  const isEntry = pathname === '/' || pathname === '/index.html' || pathname === '/m' || pathname === '/mobile.html';
  const isStatic = pathname === '/manifest.json' ||
                   pathname === '/icon.svg' ||
                   pathname === '/favicon.ico' ||
                   /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico)$/.test(pathname);

  if (isEntry || pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
  } else if (isStatic) {
    event.respondWith(cacheFirst(event.request));
  }
});
