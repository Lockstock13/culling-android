const CACHE_NAME = 'photocull-v13-SVG';
const ASSETS = [
    './',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    'icons/icon.svg',
    'icons/icon-512.png',
    'https://unpkg.com/hammerjs@2.0.8/hammer.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/exif-js'
];

// Install: Cache all assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .catch((err) => console.error('Cache install failed:', err))
    );
    self.skipWaiting(); // Force new SW to activate immediately
});

// Activate: Clean up any old caches from previous versions
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim(); // Take control of all pages immediately
});

// Fetch: Network-first strategy with cache fallback for offline support
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then((networkResponse) => {
                // Update cache with fresh network response
                if (e.request.method === 'GET') {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // If offline, serve from cache
                return caches.match(e.request);
            })
    );
});