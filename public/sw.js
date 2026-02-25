// public/sw.js
// Service Worker for chat push notifications.
// Handles click → navigate to the relevant channel.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle notification click — open or focus the relevant channel tab
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a tab with this URL is already open, focus it
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(url, self.location.origin);
          if (clientUrl.pathname === targetUrl.pathname && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});
