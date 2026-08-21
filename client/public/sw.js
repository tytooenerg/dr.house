// Real Web Push service worker — receives the actual push events the browser's push
// service delivers (server/src/lib/webPush.ts sends via the standard Web Push protocol,
// RFC 8030/8292), shows a real OS-level notification, and focuses/opens the app on click.
// No caching, no offline support — this service worker exists solely to receive push
// events, nothing more claimed.
self.addEventListener('push', (event) => {
  let data = { title: 'Lastro', body: 'Você tem uma nova atualização.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Lastro', body: event.data.text() };
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lastro', {
      body: data.body || '',
      data: { url: data.url || '/app/dashboard' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
