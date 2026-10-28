// Combined with coi-serviceworker at build time; no second registration/scope.
const PWA_VERSION = '__PWA_VERSION__';
const PWA_PATHS = ['__PWA_ASSETS__'].filter(path => !path.startsWith('__'));
const PWA_ENABLED = PWA_PATHS.length > 0;
const PWA_SCOPE = new URL('./', self.location.href);
const PWA_PREFIX = `lama-app:${PWA_SCOPE.pathname}:`;
const PWA_CACHE = PWA_PREFIX + PWA_VERSION;
const PWA_INDEX = new URL('index.html', PWA_SCOPE).href;
const PWA_ASSETS = new Set(PWA_PATHS.map(path => new URL(path, PWA_SCOPE).href));

if (typeof window === 'undefined' && PWA_ENABLED) {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(PWA_CACHE).then(cache => cache.addAll(
      [...PWA_ASSETS].map(url => new Request(url, { cache: 'reload' }))
    )));
  });
  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(names
      .filter(name => name.startsWith(PWA_PREFIX) && name !== PWA_CACHE)
      .map(name => caches.delete(name)))));
  });
}

async function pwaFetch(request) {
  const url = new URL(request.url);
  // The inference Worker owns the model cache. Never prefetch or duplicate it.
  if (!PWA_ENABLED || !url.pathname.startsWith(PWA_SCOPE.pathname)
      || url.pathname.startsWith(new URL('models/', PWA_SCOPE).pathname)
      || request.headers.has('range')) return fetch(request);
  // A directly-opened image or manifest must never replace the offline editor.
  if (request.mode === 'navigate' && url.pathname !== PWA_SCOPE.pathname
      && url.pathname !== new URL('index.html', PWA_SCOPE).pathname) return fetch(request);

  let cache;
  try { cache = await caches.open(PWA_CACHE); } catch { return fetch(request); }
  if (request.mode === 'navigate') {
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(PWA_INDEX, response.clone()).catch(() => {});
      if (response.status < 500) return response;
      return (await cache.match(PWA_INDEX, { ignoreVary: true })) || response;
    } catch (error) {
      const cached = await cache.match(PWA_INDEX, { ignoreVary: true });
      if (cached) return cached;
      throw error;
    }
  }
  const runtime = url.pathname.startsWith(new URL('ort/', PWA_SCOPE).pathname)
    || url.pathname.startsWith(new URL('assets/', PWA_SCOPE).pathname);
  if (!PWA_ASSETS.has(url.href) && !runtime) return fetch(request);
  // These are public app assets. Dev/static hosts may vary CORS headers by
  // Origin, while module requests and installation requests send different ones.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status === 200) await cache.put(request, response.clone()).catch(() => {});
  return response;
}
