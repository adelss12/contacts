/* يحفظ ملفات البرنامج لكي يفتح دون إنترنت.
   غيّر رقم الإصدار عند كل تحديث لإجبار الأجهزة على جلب النسخة الجديدة. */
const CACHE = "dalil-v2";
const ASSETS = [
    "./",
    "index.html",
    "style.css",
    "app.js",
    "manifest.webmanifest",
    "assets/icon.svg",
    "assets/apple-touch-icon.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// يعرض النسخة المحفوظة فورًا ويحدّثها في الخلفية
self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    if (new URL(request.url).origin !== location.origin) return;

    event.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(request, { ignoreSearch: true });
            const network = fetch(request)
                .then(response => {
                    if (response.ok) cache.put(request, response.clone());
                    return response;
                })
                .catch(() => cached || Response.error());
            return cached || network;
        })
    );
});
