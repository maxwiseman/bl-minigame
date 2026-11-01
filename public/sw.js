/**
 * Offline support: keeps the game cached so it loads and plays with no connection.
 * The leaderboard API is left to the network; the game queues scores until it's back.
 */
const CACHE = "big-liquid-v1";
/* How long to wait on a slow connection before falling back to the cached page */
const NETWORK_TIMEOUT_MS = 3000;

// Cache the page and every build file it references, so one visit is enough to play offline
self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            const page = await fetch("/", { cache: "no-store" });
            const html = await page.clone().text();
            await cache.put("/", page);
            const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? []);
            await cache.addAll(["/manifest.webmanifest", ...assets]);
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            for (const key of await caches.keys()) if (key != CACHE) await caches.delete(key);
            await self.clients.claim();
        })(),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method != "GET" || url.origin != self.location.origin || url.pathname.startsWith("/api/")) return;
    // Build files are content-hashed, so a cached copy is always right
    if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
    // The page, icons and manifest: fresh when online so deploys show up, cached when not
    else event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
}

async function networkFirst(request) {
    try {
        const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS)),
        ]);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
    } catch (error) {
        const cached = (await caches.match(request)) ?? (request.mode == "navigate" ? await caches.match("/") : null);
        if (cached) return cached;
        throw error;
    }
}
