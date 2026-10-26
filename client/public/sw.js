// Football Insider service worker: caches the app shell so the site installs and opens
// offline. API data is always network-first (scores are never served stale while online);
// the last response is only used when the network is unavailable.
const VERSION = 'afi-v1';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const API = `${VERSION}-api`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_URLS);
    // Precache the hashed bundles referenced by the current shell.
    const html = await (await cache.match('/')).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    if (assets.length) await (await caches.open(STATIC)).addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first; `cacheKey` null means "don't store this response", `fallback` is the offline answer.
const networkFirst = async (request, cacheName, { cacheKey = request, fallback = request } = {}) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && cacheKey) cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(fallback);
    if (cached) return cached;
    throw error;
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin')) return;
  if (url.pathname.startsWith('/api/')) { event.respondWith(networkFirst(request, API)); return; }
  // Pages: always the network; offline, any route falls back to the cached app shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, { cacheKey: url.pathname === '/' ? '/' : null, fallback: '/' }).catch(() => Response.error()));
    return;
  }
  if (/^\/(assets|logos|icons)\//.test(url.pathname)) event.respondWith(cacheFirst(request));
});
