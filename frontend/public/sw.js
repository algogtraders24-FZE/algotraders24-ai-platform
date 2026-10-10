/* AT24 service worker - PUSH NOTIFICATIONS ONLY.
 *
 * It deliberately has NO fetch handler and caches NOTHING: pages and API answers of a signed-in dashboard must never be
 * served from a cache (stale numbers, or one user's data left on a shared device). All it does is show a notification when a
 * push arrives and open the right AT24 page when it is tapped.
 *
 * Safety: the payload is untrusted text (title/body are shown as plain text by the browser) and the tap target is only ever a
 * PATH on this site; anything else falls back to the dashboard.
 */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

function safePath(url) {
  if (typeof url !== "string" || url.charAt(0) !== "/" || url.charAt(1) === "/" || url.indexOf("\\") !== -1) return "/dashboard";
  return url.slice(0, 200);
}

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = typeof data.title === "string" && data.title ? data.title.slice(0, 90) : "AT24";
  var body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  var tag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 40) : "at24";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "/pwa/icon-192.png",
      badge: "/pwa/badge-96.png",
      tag: tag,
      renotify: true,
      data: { url: safePath(data.url) },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
          return c.focus().then(function (w) {
            return w && "navigate" in w ? w.navigate(target) : undefined;
          });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
