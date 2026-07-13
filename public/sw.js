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
