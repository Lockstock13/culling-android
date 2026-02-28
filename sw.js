const CACHE_NAME = 'photocull-v7-PRO'; // FORCE UPDATE CACHE
const ASSETS = [
    './',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    'https://unpkg.com/hammerjs@2.0.8/hammer.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/exif-js',
    'https://cdn-icons-png.flaticon.com/512/1040/1040241.png'
];

// Install: Cache all assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting(); // Force new SW to activate immediately
});

// Activate: Cleanup old caches
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

// Fetch: NETWORK FIRST, Fallback to Cache (Biar update kodingan langsung masuk ke HP)
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then((networkResponse) => {
                // Update cache dengan yang baru dari network
                if (e.request.method === 'GET') {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(e.request, clone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Kalau offline, baru pake cache
                return caches.match(e.request);
            })
    );
});