// HubX service worker: closed-tab Web Push notifications.
// The push payload carries ONLY a count ("у вас N новых сообщений") — message
// content never goes through the push gateway (it stays inside XMPP/E2E).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* */ }
  e.waitUntil(self.registration.showNotification(d.title || "HubX", {
    body: d.body || "У вас новые сообщения",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: "hubx-offline", // collapse repeated count pushes into one
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("/");
  }));
});
