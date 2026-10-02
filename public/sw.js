/*
 * Сервис-воркер LifeDashboard — только для push-уведомлений.
 *
 * Ничего не кэширует: приложение онлайн-только, и кэш свежих списков между
 * устройствами дал бы больше путаницы, чем пользы. Его задачи:
 *  - push: показать уведомление о деле (сервер шлёт в момент напоминания,
 *    см. src/lib/push.ts);
 *  - клик по уведомлению: открыть LifeDashboard на вкладке напоминаний;
 *  - кнопка «Сделано» (Android/Chrome — iOS кнопок у уведомлений не
 *    показывает): отметить дело, не открывая приложение. Запрос same-origin,
 *    кука входа уходит вместе с ним сама.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'LifeDashboard', body: event.data ? event.data.text() : '' };
  }
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/task/icon-192.png',
    badge: '/task/badge-96.png',
    lang: 'ru',
    renotify: !!data.tag,
    data: { url: data.url || '/task#reminders', reminderId: data.reminderId, day: data.day },
    actions: data.reminderId ? [{ action: 'done', title: 'Сделано' }] : [],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'LifeDashboard', options));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  const { url, reminderId, day } = n.data || {};

  if (event.action === 'done' && reminderId && day) {
    event.waitUntil(
      fetch(`/task/api/reminders/${reminderId}/done`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, done: true }),
      }).catch(() => {}),
    );
    return;
  }

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => new URL(c.url).pathname.startsWith('/task'));
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url || '/task#reminders');
        return;
      }
      await self.clients.openWindow(url || '/task#reminders');
    })(),
  );
});
