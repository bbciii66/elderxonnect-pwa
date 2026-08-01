const CACHE_NAME = "elderxonnect-v8";
const STATIC_ASSETS = [
  "/manifest.json",
  "/fixes.js",
  "/supabase-config.js",
  "/supabase-sync.js",
  "/caregiver-access.js",
  "/caregiver.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
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

async function injectRuntimeScripts(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  const scripts = ["/fixes.js", "/supabase-config.js", "/supabase-sync.js", "/caregiver-access.js"];
  const tags = scripts
    .filter((src) => !html.includes(`src="${src}"`))
    .map((src) => `<script src="${src}" defer></script>`)
    .join("\n");

  if (tags) html = html.replace("</body>", `${tags}\n</body>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put(url.pathname === "/caregiver.html" ? "/caregiver.html" : "/index.html", networkResponse.clone());
        return url.pathname === "/caregiver.html" ? networkResponse : injectRuntimeScripts(networkResponse);
      } catch (error) {
        const fallbackPath = url.pathname === "/caregiver.html" ? "/caregiver.html" : "/index.html";
        const cached = await caches.match(fallbackPath) || await caches.match("/");
        if (cached) return url.pathname === "/caregiver.html" ? cached : injectRuntimeScripts(cached);
        throw error;
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const networkPromise = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      });
      return cached || networkPromise;
    })());
  }
});
