// ============================================
// Minimal service worker — exists mainly to satisfy "installability" criteria
// so the site can be added to a phone's home screen with its own icon and a
// standalone launch (no browser address bar).
//
// Deliberately NETWORK-FIRST, not cache-first: this app's whole point is live,
// shared, frequently-changing data (scores, questions), and a cache-first
// strategy risks someone getting stuck on a stale cached copy of app.js after
// a bug fix ships. This only ever falls back to a cached file if the network
// request genuinely fails (e.g. no signal) — when you're online, you always
// get the current version.
//
// Bump CACHE_NAME (e.g. "v2", "v3") if you ever want to force everyone's
// offline fallback cache to refresh — not required for normal updates, since
// those are always fetched fresh from the network whenever it's available.
// ============================================

const CACHE_NAME = "daily-trivia-shell-v1";

// Only the app shell — never JSONBin or OpenTDB requests (those are cross-origin
// and this worker never touches them anyway; see the fetch handler's guard below).
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./jsonbin.js",
  "./lib/trivia-core.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {
      // Best-effort — if a file fails to pre-cache, the site still works fine online.
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET requests for the app shell. Everything else
  // (JSONBin reads/writes, OpenTDB, fonts, any POST/PUT) passes straight through
  // untouched — this worker never caches or intercepts live data.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
