self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || '홀가 학부모 포털', { body: data.body || '새로운 학교 알림이 도착했습니다. 앱에서 확인해주세요.', icon: '/icons/holy-guide-192.png', data: { url: data.url || '/dashboard', noticeId: data.noticeId || null }, tag: data.noticeId || 'holga-notice' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil((async () => { const all = await clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const client of all) { if ('focus' in client) { await client.focus(); if ('navigate' in client) return client.navigate(url); } } return clients.openWindow(url); })());
});

// The browser can replace a push subscription on its own (expiry, key rotation). Without this the
// server keeps sending to the dead endpoint and the device silently stops getting notifications.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const previousEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
    let subscription = event.newSubscription;
    if (!subscription) {
      const applicationServerKey = event.oldSubscription && event.oldSubscription.options ? event.oldSubscription.options.applicationServerKey : null;
      if (!applicationServerKey) return;
      subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), previousEndpoint }),
    });
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isDynamicPortalData = url.origin === self.location.origin && (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/account') ||
    url.pathname.startsWith('/login')
  );
  if (isDynamicPortalData) {
    event.respondWith(fetch(request));
  }
});
