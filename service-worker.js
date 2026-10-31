const CACHE_NAME = "elderxonnect-v36";
const STATIC_ASSETS = [
  "/manifest.json",
  "/push-config.js",
  "/push-client.js",
  "/fixes.js",
  "/supabase-config.js",
  "/safe-cloud-reconcile.js",
  "/supabase-sync.js",
  "/recipient-account-restore.js",
  "/profile-name-backfill.js",
  "/profile-display-refresh.js",
  "/care-recipient-display-name-sync.js",
  "/care-recipient-profile-snapshot-sync.js",
  "/caregiver-access.js",
  "/reminder-schedule.js",
  "/reminder-schedule-cloud.js",
  "/role-router.js",
  "/caregiver-reminder-schedule.js",
  "/caregiver-onboarding.js",
  "/caregiver-onboarding-fix.js",
  "/caregiver-password-reset.js",
  "/caregiver-access-manager.js",
  "/caregiver-care-list.js",
  "/caregiver-profile-snapshot.js",
  "/caregiver.html",
  "/circle.html",
  "/circle.js",
  "/theme.js",
  "/theme.css",
  "/ui.css",
  "/ui-polish.js",
  "/games-logic.js",
  "/games.js",
  "/weather-logic.js",
  "/weather.js",
  "/unlock-settings.js",
  "/circle-logic.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
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

async function injectScripts(response, scripts) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  const tags = scripts
    .filter((src) => !html.includes(`src="${src}"`))
    .map((src) => `<script src="${src}" defer></script>`)
    .join("\n");
  if (tags) html = html.replace("</body>", `${tags}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function enhanceResponse(response, pathname) {
  if (pathname !== "/index.html" && pathname !== "/caregiver.html") return response;
  if (pathname === "/caregiver.html") {
    return injectScripts(response, [
      "/caregiver-reminder-schedule.js",
      "/caregiver-onboarding.js",
      "/caregiver-onboarding-fix.js",
      "/caregiver-password-reset.js",
      "/caregiver-access-manager.js",
      "/caregiver-care-list.js",
      "/caregiver-profile-snapshot.js"
    ]);
  }
  return injectScripts(response, [
    "/fixes.js",
    "/supabase-config.js",
    "/safe-cloud-reconcile.js",
    "/supabase-sync.js",
    "/recipient-account-restore.js",
    "/profile-name-backfill.js",
    "/profile-display-refresh.js",
    "/care-recipient-display-name-sync.js",
    "/care-recipient-profile-snapshot-sync.js",
    "/caregiver-access.js",
    "/reminder-schedule.js",
    "/reminder-schedule-cloud.js",
    "/role-router.js",
    "/ui-polish.js",
    "/games-logic.js",
    "/games.js",
    "/weather-logic.js",
    "/weather.js",
    "/unlock-settings.js"
  ]);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    // Each page is cached under its own address, so the Care Circle page never replaces the home page offline.
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request, { cache: "no-store" });
        if (networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(path, networkResponse.clone());
        }
        return enhanceResponse(networkResponse, path);
      } catch (error) {
        const cached = await caches.match(path) || await caches.match("/index.html");
        if (cached) return enhanceResponse(cached, path);
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

// Push alerts: show the nudge the sender made, and open the circle page when it is tapped.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = String(data.title || "ElderXonnect").slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || "").slice(0, 200),
    icon: "/icons/icon-192.png",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/circle.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/circle.html";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes(url) && "focus" in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
